// File: src/tools/resolution.ts
//
// Entity resolution helper. Underpins multi-value relations in create_object /
// update_object (cap-6dy.11 / .12). It maps human-readable entity NAMES to
// Capacities object IDs by title-searching, and classifies each name as
// linked / unmatched / ambiguous. It NEVER guesses among multiple exact matches.
//
// This module is WRITE-FREE: its only outward call is `client.searchContent`
// (a read). Auto-creation of missing relation targets lives entirely in
// object.ts's finalizeRelationPlans (cap-6dy.11) — this helper only classifies.
import { CapacitiesClient, WaitBudget } from "../client/capacities.js";
import { normalizeName } from "../utils/normalize.js";

// v2 /objects/search caps `limit` at 50 (spec max) with no pagination. A search
// that returns exactly this many results may be truncated (cap-6dy.22).
export const SEARCH_LIMIT = 50;

export interface EntityCandidate {
  id: string;
  title: string;
  structureId: string;
}

export interface ResolutionResult {
  // Exactly one exact-title match.
  linked: { name: string; id: string }[];
  // Zero exact matches, and the search was NOT truncated (we saw every candidate).
  unmatched: string[];
  // >1 exact-title match — never guessed; caller must disambiguate.
  ambiguous: { name: string; candidates: EntityCandidate[] }[];
  // Zero exact matches but the search hit the 50-result cap, so a matching object
  // may exist beyond it. Distinct from `unmatched`: the caller must NOT treat these
  // as "safe to auto-create" — doing so risks a duplicate (cap-6dy.22).
  truncated: string[];
}

export interface ResolveEntitiesOptions {
  // Operation-level bounded-wait budget, forwarded to the paced search calls so a
  // many-relation composite write can absorb one window reset (cap-6dy.19).
  pace?: WaitBudget;
}

export async function resolveEntities(
  client: CapacitiesClient,
  names: string[],
  structureIds: string[] | undefined,
  opts?: ResolveEntitiesOptions
): Promise<ResolutionResult> {
  const result: ResolutionResult = { linked: [], unmatched: [], ambiguous: [], truncated: [] };

  // Dedupe by normalized name, preserving first-seen order, so a repeated name
  // yields one search and one output entry.
  const seen = new Set<string>();
  const uniqueNames: string[] = [];
  for (const name of names) {
    const key = normalizeName(name);
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueNames.push(name);
  }

  for (const name of uniqueNames) {
    const target = normalizeName(name);
    // cap-6dy.22: v2 search is title-only, caps `limit` at 50, has no pagination,
    // no exact-title query mode, and no total/hasMore in the response. Live probing
    // (2026-07-12) shows exact-title matches DO rank first, so a *unique* exact
    // match is very unlikely to be pushed past hit 50 — but we can't prove ranking,
    // so a 50-result search with no exact match is treated as truncated (below)
    // rather than a confident "not found" that would auto-create a duplicate.
    const results = await client.searchContent({
      query: name,
      structureIds,
      limit: SEARCH_LIMIT,
    }, opts?.pace);

    const exact = results.filter((r) => normalizeName(r.title) === target);

    if (exact.length === 1) {
      result.linked.push({ name, id: exact[0].id });
    } else if (exact.length > 1) {
      result.ambiguous.push({
        name,
        candidates: exact.map((r) => ({
          id: r.id,
          title: r.title,
          structureId: r.structureId,
        })),
      });
    } else if (results.length >= SEARCH_LIMIT) {
      // Zero exact matches BUT the search was capped — a match may exist beyond the
      // cap. Never guessed, and never treated as safe-to-auto-create (cap-6dy.22).
      result.truncated.push(name);
    } else {
      // Zero exact matches in a complete result set — genuinely not found.
      // Auto-creation (when requested) is handled by finalizeRelationPlans, not here.
      result.unmatched.push(name);
    }
  }

  return result;
}
