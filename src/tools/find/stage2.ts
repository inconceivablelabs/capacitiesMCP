// File: src/tools/find/stage2.ts
//
// find_objects stage 2 (split out of find.ts, cap-0ot): one GET /object per
// candidate, then client-side filter and sort over the typed property values.
import { CapacitiesClient, CapacitiesAPIError, WaitBudget } from "../../client/capacities.js";
import { CompiledFilter, CompiledSort, matchesFilter, sortKey, compareForSort } from "./query.js";
import { Candidate, briefError } from "./shared.js";

// Stage 2 stops after this many read errors in a row (cap-fvb).
const MAX_CONSECUTIVE_READ_ERRORS = 3;

export type Fetched = { id: string; title: string; props: Record<string, any> };

export interface FetchOutcome {
  fetched: Fetched[];
  rateStopped: boolean;
  erroredCount: number;
  breakerStop: string | null;   // why the circuit breaker tripped, when it did
}

/**
 * Reads the first `planned` candidates in order. Fail-open: a rate stop ends the
 * loop with partial results; a non-rate read error skips the candidate and
 * continues, unless the circuit breaker trips.
 */
export async function fetchCandidates(
  client: CapacitiesClient,
  candidates: Candidate[],
  planned: number,
  budget: WaitBudget
): Promise<FetchOutcome> {
  const fetched: Fetched[] = [];
  let rateStopped = false;
  let erroredCount = 0;
  // Circuit breaker (cap-fvb): a Cloudflare ban can arrive as a 403, and every
  // further GET extends an IP-level ban shared by every client on our egress.
  // Stop at once on a 403, or after a run of failures a success would reset.
  let consecutiveErrors = 0;
  let breakerStop: string | null = null;
  for (let i = 0; i < planned; i++) {
    const cand = candidates[i];
    try {
      const obj = await client.getObject(cand.id, budget);
      fetched.push({ id: cand.id, title: cand.title, props: (obj.properties ?? {}) as Record<string, any> });
      consecutiveErrors = 0;
    } catch (e) {
      if (e instanceof CapacitiesAPIError && e.code === "RATE_LIMIT_EXCEEDED") { rateStopped = true; break; }
      erroredCount++;
      consecutiveErrors++;
      const detail = briefError(e instanceof Error ? e.message : String(e));
      if (e instanceof CapacitiesAPIError && e.details?.status === 403) {
        breakerStop = `a 403 from the server (${detail})`;
        break;
      }
      if (consecutiveErrors >= MAX_CONSECUTIVE_READ_ERRORS) {
        breakerStop = `${consecutiveErrors} consecutive read errors (${detail})`;
        break;
      }
    }
  }
  return { fetched, rateStopped, erroredCount, breakerStop };
}

/** Filter, sort (missing last), then the post-filter limit. `matchedCount` is before the slice (D3). */
export function filterAndSort(
  fetched: Fetched[],
  compiled: CompiledFilter[],
  compiledSort: CompiledSort | null,
  limit: number | undefined
): { matches: Fetched[]; matchedCount: number } {
  let matches = fetched.filter(f => compiled.every(cf => matchesFilter(f.props, cf)));
  if (compiledSort) {
    const cs = compiledSort;
    matches = matches.slice().sort((a, b) =>
      compareForSort(sortKey(a.props[cs.propId]), sortKey(b.props[cs.propId]), cs.order)
    );
  }
  const matchedCount = matches.length;
  if (limit !== undefined) matches = matches.slice(0, limit);
  return { matches, matchedCount };
}
