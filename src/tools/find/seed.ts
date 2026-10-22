// File: src/tools/find/seed.ts
//
// find_objects stage 1 (split out of find.ts, cap-0ot): seed the candidates by
// title search, tag listing, tag listing + title, or a listing of the whole
// structure. A title search that returns its 50-result maximum escalates to a
// listing. Seeding never fetches an object.
import { CapacitiesClient, WaitBudget } from "../../client/capacities.js";
import { CapacitiesStructure, SearchResult } from "../../client/types.js";
import { resolveEntities, SEARCH_LIMIT } from "../resolution.js";
import { enumerateAll, EnumerationResult } from "../enumerate.js";
import { matchesTitle } from "../../utils/normalize.js";
import { isSpecUuid } from "../../utils/validation.js";
import { Candidate, SeedMethod, MAX_REQUESTS_PER_CALL, PAGE_BUDGET_MAX, briefError } from "./shared.js";

export interface Seed {
  method: SeedMethod;
  complete: boolean;
  candidates: Candidate[];
  header: (n: number, stamp: string) => string;
  noneText: (stamp: string) => string;
  infoLines: string[];
  notes: string[];                       // stage-1 Notes (an incomplete listing)
  enumeration: EnumerationResult | null; // null for a plain title search
  spentBeforeEnumeration: number;        // requests spent before any listing page
}

export interface SeedInput {
  struct: CapacitiesStructure;
  titleHint: string | undefined;
  tag: string | undefined;
  pageBudget: number;
  // Requests already spent: the structure read plus one search per relation filter.
  spentBeforeEnumeration: number;
  fetchReserve: number;
}

/** Rows of `structureId` whose title contains `titleHint` (every row when there is no hint). */
export function inStructureMatching(rows: SearchResult[], structureId: string, titleHint: string | undefined): SearchResult[] {
  return rows.filter(r =>
    r.structureId === structureId && (titleHint === undefined || matchesTitle(r.title, titleHint))
  );
}

// Stage-1 Note for an incomplete listing. Never uses stage 2's "checked N of M
// candidates" phrase: personal-assistant's backfill keys on it (U6).
// `requestedPages` is the caller's page_budget; when the request budget clamped it
// below that, raising page_budget would not help, so the Note says so instead. At
// the maximum there is nothing to raise, so that advice is dropped too.
function enumerationNote(e: EnumerationResult, requestedPages: number, effectivePages: number): string | null {
  if (e.complete) return null;
  switch (e.stopReason) {
    case "page-budget":
      if (effectivePages < requestedPages) {
        return `Note: listing stopped at the page budget (${e.pagesRead} pages, clamped from ${requestedPages} by the per-call request budget of ${MAX_REQUESTS_PER_CALL}) — ` +
          `read ${e.results.length} summaries and more remain; results may be incomplete. Narrow the seed (title_hint or tag).`;
      }
      return `Note: listing stopped at the page budget — read ${e.pagesRead} pages (${e.results.length} summaries) and more remain; ` +
        `results may be incomplete. Narrow the seed (title_hint or tag)` +
        (requestedPages < PAGE_BUDGET_MAX ? ` or raise page_budget (max ${PAGE_BUDGET_MAX}).` : ".");
    case "rate-limit":
      return `Note: rate limit reached while listing — read ${e.pagesRead} page(s) before stopping; results may be incomplete (retry shortly).`;
    case "no-cursor":
      return `Note: the listing reported more pages but returned no usable cursor — read ${e.pagesRead} page(s); results may be incomplete.`;
    default:
      return `Note: listing stopped after ${e.pagesRead} page(s) because a page could not be read (${briefError(e.errorMessage)}); results may be incomplete.`;
  }
}

// U4 fidelity canary. Every title-matching search hit should appear in a COMPLETED
// listing of the same structure; one that does not means the listing missed rows
// (design A2) or the two endpoints disagree. Only a completed listing is evidence —
// a partial one lacks rows by construction — so callers gate on `complete`. One
// stderr line, ids only (titles stay out of gateway logs, D6). Never console.log:
// stdout is the stdio MCP channel. It never adds a Note and never fails the call.
function logFidelityCanary(
  structureId: string,
  titleSeed: { id: string }[],
  candidates: { id: string }[]
): void {
  const candidateIds = new Set(candidates.map(c => c.id));
  const missing = titleSeed.filter(h => !candidateIds.has(h.id));
  if (missing.length === 0) return;
  console.error(
    `[find_objects] fidelity canary: ${missing.length} title-matching search hit(s) absent from the completed listing of ${structureId}: ` +
    missing.map(h => h.id).join(", ")
  );
}

/** Tag NAME → tag id, strictly: anything but one exact, spec-valid match is a problem. */
async function resolveTag(
  client: CapacitiesClient,
  tag: string,
  pace: WaitBudget
): Promise<{ id: string } | { problem: string }> {
  // Scoped to RootTag so a same-named Page or Meeting can never resolve as the tag.
  const r = await resolveEntities(client, [tag], ["RootTag"], { pace });
  if (r.linked.length === 1) {
    const id = r.linked[0].id;
    if (!isSpecUuid(id)) return { problem: `tag "${tag}" resolved to "${id}", which is not a valid tag id; nothing was listed.` };
    return { id };
  }
  if (r.ambiguous.length > 0) {
    const cands = r.ambiguous[0].candidates;
    const list = cands.map(c => `${c.title} (${c.id})`).join(", ");
    return { problem: `tag "${tag}" is ambiguous — ${cands.length} tags have that name: ${list}; rename one or use a more specific name.` };
  }
  if (r.truncated.length > 0) {
    return { problem: `could not confirm the tag "${tag}" — the tag search returned the maximum ${SEARCH_LIMIT} results with no exact name match; use a more specific name.` };
  }
  return { problem: `no tag named "${tag}" — check the name with search_content (tags are objects of type Tag).` };
}

/**
 * Stage 1. A title search when only a hint is given; otherwise a listing of the
 * tag (or the whole structure), filtered client-side. Every tag problem returns
 * before any listing call.
 */
export async function seedCandidates(
  client: CapacitiesClient,
  input: SeedInput,
  budget: WaitBudget
): Promise<Seed | { problem: string }> {
  const { struct, titleHint, tag, pageBudget, fetchReserve } = input;
  const plural = struct.pluralName;
  let spentBeforeEnumeration = input.spentBeforeEnumeration;
  const budgetedPages = (): number =>
    Math.max(1, Math.min(pageBudget, MAX_REQUESTS_PER_CALL - spentBeforeEnumeration - fetchReserve));
  const infoLines: string[] = [];
  const notes: string[] = [];

  if (tag === undefined && titleHint !== undefined) {
    const seed = await client.searchContent(
      { query: titleHint, structureIds: [struct.id], limit: SEARCH_LIMIT },
      budget
    );
    // cap-1kc: the search also returns objects related BY MEANING, interleaved
    // by relevance — a semantic extra can be a newer dated object and win a
    // sort-desc + limit-1. Keep only title matches.
    const titleSeed = seed.filter(r => matchesTitle(r.title, titleHint));
    const header = (n: number, stamp: string) => `Found ${n} ${plural} matching "${titleHint}" (live as of ${stamp}):`;
    const noneText = (stamp: string) => `No ${plural} found with a title matching "${titleHint}" (live as of ${stamp}).`;

    // Saturation is judged on the RAW count: at the cap a title match may sit
    // beyond it whatever the filter kept, so list the whole structure instead
    // and filter that (cap-i93 U3/U8).
    if (seed.length < SEARCH_LIMIT) {
      const droppedCount = seed.length - titleSeed.length;
      if (droppedCount > 0) infoLines.push(`(${droppedCount} search result(s) were ignored because their titles don't contain "${titleHint}" — Capacities search also returns matches by meaning.)`);
      return {
        method: "search", complete: true, candidates: titleSeed, header, noneText,
        infoLines, notes, enumeration: null, spentBeforeEnumeration
      };
    }

    spentBeforeEnumeration += 1;   // the saturated seed search
    const effectivePages = budgetedPages();
    const listing = await enumerateAll(client, "structure", struct.id, effectivePages);
    const listed = inStructureMatching(listing.results, struct.id, titleHint);
    // Never return less than the search already found (final-review I1): a
    // partial listing is a sample in id order and can miss every search hit,
    // and a complete one can still miss some (the canary's case). Listing rows
    // first, then the search's title matches the listing lacks; the caller's
    // ordering sorts the union.
    const seen = new Set(listed.map(r => r.id));
    const candidates: Candidate[] = [...listed];
    for (const h of titleSeed) {
      if (!seen.has(h.id)) { seen.add(h.id); candidates.push(h); }
    }
    infoLines.push(`(The title search returned its ${SEARCH_LIMIT}-result maximum, so the ${plural} were listed instead: ${listing.pagesRead} page(s), ${listing.results.length} summaries.)`);
    const note = enumerationNote(listing, pageBudget, effectivePages);
    if (note) notes.push(note);
    // Judged against the listing alone: the union above always contains every hit.
    if (listing.complete) logFidelityCanary(struct.id, titleSeed, listed);
    return {
      method: "search+enumeration", complete: listing.complete, candidates, header, noneText,
      infoLines, notes, enumeration: listing, spentBeforeEnumeration
    };
  }

  let listing: EnumerationResult;
  let method: SeedMethod;
  let header: (n: number, stamp: string) => string;
  let noneText: (stamp: string) => string;
  let effectivePages: number;
  if (tag !== undefined) {
    const tres = await resolveTag(client, tag, budget);
    if ("problem" in tres) return { problem: tres.problem };
    spentBeforeEnumeration += 1;   // the tag-name search
    effectivePages = budgetedPages();
    listing = await enumerateAll(client, "tag", tres.id, effectivePages);
    method = "tag-enumeration";
    const scope = titleHint !== undefined
      ? `tagged "${tag}" with a title matching "${titleHint}"`
      : `tagged "${tag}"`;
    header = (n, stamp) => `Found ${n} ${plural} ${scope} (live as of ${stamp}):`;
    noneText = stamp => `No ${plural} found ${scope} (live as of ${stamp}).`;
  } else {
    effectivePages = budgetedPages();
    listing = await enumerateAll(client, "structure", struct.id, effectivePages);
    method = "structure-enumeration";
    header = (n, stamp) => `Found ${n} ${plural} (live as of ${stamp}):`;
    noneText = stamp => `No ${plural} found (live as of ${stamp}).`;
  }
  // A tag spans every type, so keep only this structure. The structure
  // listing gets the same filter: harmless when the API honours the id,
  // and it keeps seed_size meaning "candidates of this type".
  const candidates = inStructureMatching(listing.results, struct.id, titleHint);
  const note = enumerationNote(listing, pageBudget, effectivePages);
  if (note) notes.push(note);
  return {
    method, complete: listing.complete, candidates, header, noneText,
    infoLines, notes, enumeration: listing, spentBeforeEnumeration
  };
}
