// File: src/tools/find/render.ts
//
// find_objects output (split out of find.ts, cap-0ot): the result body, the
// informational and Note: lines in their trailer order, and the content[1]
// exactness block.
//
// Contract: every "Note:" line means the result may be INCOMPLETE —
// personal-assistant's backfill_meeting_titles.py fails a run on any Note: line,
// and its pacer reads "checked N of M candidates" as the stage-2 rate Note.
// Informational lines must not start with "Note:".
import { Seed } from "./seed.js";
import { Fetched, FetchOutcome } from "./stage2.js";
import { CompiledFilter, CompiledSort, readDate, readLabels, readEntityIds, readScalar } from "./query.js";
import { Candidate, FindExactness, MAX_REQUESTS_PER_CALL, SHORT_CIRCUIT_ROW_LIMIT } from "./shared.js";

export type FindResult = { content: { type: "text"; text: string }[] };

// Compact JSON: content[0] stays the human text consumers parse, and JSON of
// these fields can never form a Note: line or a count phrase. The leading
// newline is because text blocks were seen joined with no separator (Claude Code
// 2.1.305 via mcp-gateway, 2026-10-22) — without it the JSON lands on the end of
// the last text line, which may be a Note:.
function exactnessBlock(exactness: FindExactness): { type: "text"; text: string } {
  return { type: "text", text: "\n" + JSON.stringify(exactness) };
}

// Both row renderers: a listing row may carry a null or empty title, which would
// otherwise render as **null** or an empty ****.
function displayTitle(title: string | null | undefined): string {
  return typeof title === "string" && title.trim() !== "" ? title : "(untitled)";
}

// "1 candidate" / "2 candidates" for the sampling body and the extremum caveat.
function candidatesPhrase(n: number): string {
  return `${n} candidate${n === 1 ? "" : "s"}`;
}

/** Human-readable one-liner for a surfaced (filtered/sorted) property value. */
function surfaceValue(v: any): string {
  if (!v || typeof v.type !== "string") return "—";
  switch (v.type) {
    case "date": { const d = readDate(v); return d?.start ?? "—"; }
    case "label": { const ns = readLabels(v).map(o => o.name); return ns.length ? ns.join(", ") : "—"; }
    case "entity": { const ids = readEntityIds(v); return ids.length ? `${ids.length} linked (${ids.join(", ")})` : "—"; }
    default: { const s = readScalar(v); return s === null || s === undefined ? "—" : String(s); }
  }
}

function result(text: string, exactness: FindExactness): FindResult {
  return { content: [{ type: "text", text }, exactnessBlock(exactness)] };
}

function trailerText(trailer: string[]): string {
  return trailer.length ? "\n\n" + trailer.join("\n") : "";
}

/** A complete seed with no candidates: the genuine none. */
export function renderNone(seed: Seed, stamp: string): FindResult {
  return result(seed.noneText(stamp), {
    seed_method: seed.method, seed_complete: true, candidates_complete: true,
    seed_size: 0, considered: 0, errored: 0, matched: 0, returned: 0
  });
}

// What the caller is told about how the candidates were ordered before a cut.
export interface Ordering {
  plural: string;
  stamp: string;
  enumerated: boolean;     // a listing (title-date ordered), not a plain search (rank order)
  allUndated: boolean;     // a listing where no title carries a date
  dir: "asc" | "desc";
}

// When no title carries a date the ordering is a no-op, so a cut keeps listing
// order — say so, rather than let it pass for "most recent" (S-M1).
function undatedLine(o: Ordering, seedSize: number, kept: number): string | null {
  return o.allUndated && kept < seedSize
    ? `(None of the ${seedSize} candidate titles carries a date, so the ${kept} kept were taken in listing order, not by date.)`
    : null;
}

/** Short-circuit: no filters and no sort, so list the seed itself with zero GET /object (design Example C). */
export function renderShortCircuit(
  seed: Seed,
  candidates: Candidate[],
  limit: number | undefined,
  o: Ordering
): FindResult {
  const seedSize = candidates.length;
  const rows = candidates.slice(0, limit ?? SHORT_CIRCUIT_ROW_LIMIT);
  const info = [...seed.infoLines];
  const notes = [...seed.notes];
  // Only the DEFAULT row cap hides rows the caller did not ask to lose. A
  // caller's limit is what they asked for: the same informational line as
  // stage 2, with the slice carried by matched vs returned (D3).
  const defaultCapCut = limit === undefined && rows.length < seedSize;
  if (defaultCapCut) {
    notes.push(`Note: showing the first ${rows.length} of ${seedSize} matching ${o.plural} (limit) — raise limit or narrow the seed.`);
  } else if (rows.length < seedSize) {
    info.push(`(showing ${rows.length} of ${seedSize} matches — limit)`);
  }
  const undated = undatedLine(o, seedSize, rows.length);
  if (undated) info.push(undated);
  const body = rows.length
    ? rows.map(r => `**${displayTitle(r.title)}**\nID: ${r.id}`).join("\n---\n")
    : `(no matching ${o.plural} in the part of the listing that was read)`;
  return result(`${seed.header(rows.length, o.stamp)}\n\n${body}${trailerText([...info, ...notes])}`, {
    seed_method: seed.method,
    seed_complete: seed.complete,
    candidates_complete: !defaultCapCut,
    seed_size: seedSize,
    considered: seedSize,
    errored: 0,
    matched: seedSize,
    returned: rows.length
  });
}

export interface Stage2Render {
  seedSize: number;
  planned: number;          // candidates the loop set out to read
  fetchAllowance: number;   // what the request budget left for reads
  cap: number;              // the caller's (clamped) fetch_cap
  limit: number | undefined;
  compiled: CompiledFilter[];
  compiledSort: CompiledSort | null;
  outcome: FetchOutcome;
  matches: Fetched[];
  matchedCount: number;
}

/** The stage-2 result: matched rows with their surfaced values, then info lines and Notes. */
export function renderStage2(seed: Seed, s: Stage2Render, o: Ordering): FindResult {
  const { seedSize, planned, fetchAllowance, cap, limit, compiled, compiledSort, outcome, matches, matchedCount } = s;
  const { rateStopped, erroredCount, breakerStop } = outcome;
  const consideredCount = outcome.fetched.length + erroredCount;
  // Only a READ candidate was filtered or sorted; an errored one was requested
  // but never seen, so it is counted apart from those never requested.
  const readCount = outcome.fetched.length;
  const notFetched = seedSize - consideredCount;

  // Surface only the filtered + sorted property values (P9 — not a full dump).
  const surfaceProps: { id: string; name: string }[] = [];
  for (const cf of compiled) if (!surfaceProps.some(p => p.id === cf.propId)) surfaceProps.push({ id: cf.propId, name: cf.propName });
  if (compiledSort && !surfaceProps.some(p => p.id === compiledSort.propId)) surfaceProps.push({ id: compiledSort.propId, name: compiledSort.propName });

  const blocks = matches.map(m => {
    const lines = [`**${displayTitle(m.title)}**`, `ID: ${m.id}`];
    for (const p of surfaceProps) lines.push(`${p.name}: ${surfaceValue(m.props[p.id])}`);
    return lines.join("\n");
  });

  const stage2Info: string[] = [];
  if (compiledSort && readCount < seedSize) {
    stage2Info.push(`(Sorted within the ${candidatesPhrase(readCount)} read only — the true first/last by ${compiledSort.propName} may lie among the ${candidatesPhrase(seedSize - readCount)} not read.)`);
  }
  // Trimming to the caller's limit is what they asked for, not incompleteness.
  if (limit !== undefined && matchedCount > limit) stage2Info.push(`(showing ${limit} of ${matchedCount} matches — limit)`);
  const undated = undatedLine(o, seedSize, planned);
  if (undated) stage2Info.push(undated);

  const stage2Notes: string[] = [];
  if (rateStopped) stage2Notes.push(`Note: rate budget reached — checked ${consideredCount} of ${seedSize} candidates; results may be incomplete (retry shortly or narrow the query).`);
  // Never the "checked N of M candidates" phrase: PA's pacer reads it as the rate Note.
  else if (breakerStop) stage2Notes.push(`Note: stopped reading candidates after ${breakerStop}; results may be incomplete.`);
  else if (planned < seedSize) {
    const order = !o.enumerated ? "in search-rank order"
      : o.allUndated ? "in listing order"
      : o.dir === "asc" ? "oldest first by title date" : "most recent first by title date";
    stage2Notes.push(fetchAllowance < cap
      ? `Note: fetched the first ${planned} of ${seedSize} candidates (per-call request budget of ${MAX_REQUESTS_PER_CALL}) ${order}; narrow the seed.`
      : `Note: fetched the first ${planned} of ${seedSize} candidates (fetch_cap) ${order}; raise fetch_cap or narrow the seed.`);
  }
  // Independent of the cap/rate Notes above, so an unreadable candidate is never hidden by them.
  if (erroredCount > 0) stage2Notes.push(`Note: ${erroredCount} candidate(s) could not be read and were skipped.`);
  const trailer = [...seed.infoLines, ...stage2Info, ...seed.notes, ...stage2Notes];

  // An empty candidate list here is a PARTIAL none (the listing stopped
  // early): never rendered as "No … found". Filters run over a sample when
  // not every candidate was fetched, so an empty result says so.
  const body = blocks.length
    ? blocks.join("\n---\n")
    : seedSize === 0
      ? `(no matching ${o.plural} in the part of the listing that was read)`
      : readCount < seedSize
        ? `(none of the ${candidatesPhrase(readCount)} read matched the filters — ${[
            erroredCount > 0 ? `${erroredCount} could not be read` : null,
            notFetched > 0 ? `${notFetched} ${notFetched === 1 ? "was" : "were"} not fetched` : null
          ].filter(Boolean).join(", ")})`
        : "(no candidates matched the filters)";
  return result(`${seed.header(matches.length, o.stamp)}\n\n${body}${trailerText(trailer)}`, {
    seed_method: seed.method,
    seed_complete: seed.complete,
    candidates_complete: !rateStopped && planned === seedSize && erroredCount === 0,
    seed_size: seedSize,
    considered: consideredCount,
    errored: erroredCount,
    matched: matchedCount,
    returned: matches.length
  });
}
