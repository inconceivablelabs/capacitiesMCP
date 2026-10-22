// enumerateAll: walks /objects/structure|tag pages by cursor and returns what it read.
//
// Pagination is keyset (`nextCursor` is the last id), so a delete cannot shift a page
// boundary, but an insert whose UUID sorts behind the cursor is missed (design A2,
// untestable here). A listing is only `complete` when the last page said hasMore:false.
import { CapacitiesClient, CapacitiesAPIError, EnumerationKind, WaitBudget } from "../client/capacities.js";
import { SearchResult } from "../client/types.js";

export type EnumerationStop = "done" | "page-budget" | "no-cursor" | "rate-limit" | "error";

export interface EnumerationResult {
  results: SearchResult[];   // deduped by id, first occurrence kept, enumeration order
  complete: boolean;         // true iff the last page read had hasMore === false
  stopReason: EnumerationStop;
  pagesRead: number;         // successful pages
  requestsIssued: number;    // every enumerateObjects call made, successful or not
  errorMessage?: string;     // set when stopReason is "error" or "rate-limit"
}

export async function enumerateAll(
  client: CapacitiesClient,
  kind: EnumerationKind,
  id: string,
  pageBudget: number
): Promise<EnumerationResult> {
  const maxPages = Math.max(1, pageBudget);
  // A zero budget makes the limiter throw RATE_LIMIT_EXCEEDED instead of sleeping, so a
  // full window ends the listing as a partial rather than stalling the caller for 60s.
  const pace: WaitBudget = { remainingMs: 0 };
  const results: SearchResult[] = [];
  const seen = new Set<string>();
  let pagesRead = 0;
  let requestsIssued = 0;
  let cursor: string | undefined;

  const finish = (
    complete: boolean, stopReason: EnumerationStop, errorMessage?: string
  ): EnumerationResult => ({
    results, complete, stopReason, pagesRead, requestsIssued,
    ...(errorMessage !== undefined ? { errorMessage } : {})
  });

  for (;;) {
    requestsIssued++;
    let page;
    try {
      page = await client.enumerateObjects(kind, id, cursor, pace);
    } catch (e) {
      if (e instanceof CapacitiesAPIError) {
        if (e.code === "RATE_LIMIT_EXCEEDED") return finish(false, "rate-limit", e.message);
        if (e.code === "API_ERROR") return finish(false, "error", e.message);
      }
      if (!(e instanceof CapacitiesAPIError)) {
        // Network failure etc.: end as a partial so rows and the request count survive.
        return finish(false, "error", e instanceof Error ? e.message : String(e));
      }
      throw e;
    }
    pagesRead++;
    for (const row of page.results) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      results.push(row);
    }
    if (!page.hasMore) return finish(true, "done");
    if (typeof page.nextCursor !== "string" || page.nextCursor === "" || page.nextCursor === cursor) {
      return finish(false, "no-cursor");
    }
    if (pagesRead >= maxPages) return finish(false, "page-budget");
    cursor = page.nextCursor;
  }
}
