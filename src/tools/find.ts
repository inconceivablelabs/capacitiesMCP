// File: src/tools/find.ts
//
// find_objects (cap-0yu) — a live LOCATE primitive. It composes the two read
// endpoints the v2 API already gives us into a property/date/label/tag query the
// API itself cannot express:
//   stage 1  seed:   POST /objects/search scoped to one structure, then kept to
//                    titles containing title_hint (the search also returns
//                    matches by meaning — cap-1kc); a search that returns its
//                    50-result maximum escalates to listing the structure (cap-i93)
//   stage 2  fetch:  GET /object (JSON) per candidate, paced by a WaitBudget
//   stage 3  filter + sort client-side over the typed property values
// It returns ids + titles + the surfaced (filtered/sorted) property values and NO
// bodies — body reads compose with the existing get_object tool. It holds no
// state; the day Capacities adds property search, stage 1 becomes the direct
// query and stage 2 evaporates. See
// project-internals/capacitiesMCP/plans/2026-07-12-find-objects-live-query-design.md
//
// This file is the tool's schema and orchestration; the stages live in find/
// (cap-0ot): seed.ts (stage 1), stage2.ts (fetch, filter, sort), render.ts
// (output), query.ts (filter/sort compilation), shared.ts (constants, exactness).
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  CapacitiesClient,
  CapacitiesAPIError,
  WaitBudget,
  WINDOW_MS
} from "../client/capacities.js";
import { buildPropertyIndex, resolvePropertyKey } from "./object.js";
import { normalizeForTitleMatch } from "../utils/normalize.js";
import { parseTitleDate, orderEnumerated } from "../utils/title-date.js";
import {
  PAGE_BUDGET_DEFAULT, PAGE_BUDGET_MAX, FETCH_CAP_DEFAULT, FETCH_CAP_MAX, TITLE_HINT_MAX,
  MAX_REQUESTS_PER_CALL, MAX_ENTITY_FILTERS, FETCH_RESERVE_MAX, clampCount
} from "./find/shared.js";
import { filterValueSchema, compileFilters, compileSort, resolveStructure } from "./find/query.js";
import { seedCandidates } from "./find/seed.js";
import { fetchCandidates, filterAndSort } from "./find/stage2.js";
import { renderNone, renderShortCircuit, renderStage2, Ordering } from "./find/render.js";

// Re-exported so callers and tests keep importing from find.js.
export {
  PAGE_BUDGET_DEFAULT, PAGE_BUDGET_MAX, FETCH_CAP_DEFAULT, FETCH_CAP_MAX, TITLE_HINT_MAX,
  MAX_REQUESTS_PER_CALL, MAX_ENTITY_FILTERS
} from "./find/shared.js";
export type { SeedMethod, FindExactness } from "./find/shared.js";
export {
  dayOf, readDate, readLabels, readEntityIds, readScalar, matchesFilter, sortKey,
  compareForSort, resolveStructure, filterValueSchema, compileFilters, compileSort
} from "./find/query.js";
export type { CompiledFilter, CompiledSort, FilterValue } from "./find/query.js";

export function setupFindTools(server: McpServer, client: CapacitiesClient) {
  server.registerTool(
    "find_objects",
    {
      title: "Find Capacities Objects",
      description:
        "Locate objects of one `structure` (NAME or id from get_space_info), then filter and sort client-side " +
        "on properties the API cannot search. Seed by `title_hint`, by `tag` (a tag NAME), both, or neither — " +
        "omit `title_hint` to list by tag or list the whole type. Results are limited to objects whose title " +
        "contains `title_hint` (case, accents and punctuation ignored; it needs a letter or digit); short " +
        "numeric hints also match dates (\"1:1\" matches 2024-11-12). A title search that returns 50 results " +
        "lists the whole type instead. A listing reads up to `page_budget` pages of 100 (default 12, max 25) " +
        "and orders candidates by the date in their title, newest first (oldest first for an ascending date " +
        "sort; undated titles last), before " +
        "`fetch_cap` (default 30, max 50) cuts them. With no filters and no sort, matches are listed without " +
        "fetching each object (up to `limit`, default 30). Per call: at most 5 relation filters, and a call " +
        "that lists makes at most 45 requests. `filters` are keyed by property NAME or id: a date is an " +
        "absolute ISO string (a date-only value matches that day, a full timestamp that exact instant) or " +
        "{after,before}; a label is an option NAME; a " +
        "relation/tag is an object NAME; text/number/boolean are equals. `sort` is {by, order}; missing " +
        "values sort last. A line starting \"Note:\" means the result may be incomplete; `seed_complete` and " +
        "`candidates_complete` (in the result's second text block, a JSON object) say which part, and it is the full answer only when both are true and " +
        "`matched` equals `returned`. Returns ids + titles + filtered/sorted values, NO bodies (use " +
        "get_object); cannot follow backlinks.",
      inputSchema: {
        structure: z.string().describe("Object type to search — structure NAME or id (from get_space_info)"),
        title_hint: z.string().max(TITLE_HINT_MAX).optional().describe(
          "Optional. Title text the object's title must contain (needs at least one letter or digit). Omit to list by tag or the whole type."
        ),
        tag: z.string().optional().describe(
          "Optional. A tag NAME; lists objects of this structure carrying the tag (combine with title_hint to filter their titles)."
        ),
        filters: z.record(filterValueSchema).optional().describe(
          "Client-side filters keyed by property NAME or id. Date: ISO string (equals) or {after,before} (ISO range). Label: option NAME. Relation/tag: object NAME. Scalars: equals."
        ),
        sort: z.object({
          by: z.string().describe("Property NAME or id to sort by"),
          order: z.enum(["asc", "desc"]).default("asc")
        }).optional().describe("Sort by a property; missing values sort last"),
        limit: z.number().int().positive().optional().describe("Max results to return after filtering"),
        fetch_cap: z.number().int().min(1).max(FETCH_CAP_MAX).default(FETCH_CAP_DEFAULT).describe(
          "Max candidates to fetch in stage 2 (default 30 fits one rate window; max 50 may add one ~60s wait). A call that lists gets what is left of its 45-request budget."
        ),
        page_budget: z.number().int().min(1).max(PAGE_BUDGET_MAX).default(PAGE_BUDGET_DEFAULT).describe(
          `Max pages of 100 to list when enumerating — by tag, by the whole structure, or after a title search returns 50 (default ${PAGE_BUDGET_DEFAULT}, max ${PAGE_BUDGET_MAX})`
        )
      }
    },
    async ({ structure, title_hint, tag, filters, sort, limit, fetch_cap, page_budget }) => {
      try {
        // 0. Validate the seed BEFORE any call. A hint that normalizes to "" (blank
        //    or all punctuation) would match every title, so it is refused rather
        //    than fired as a search that cannot be filtered (cap-i93 U5).
        if (title_hint !== undefined && normalizeForTitleMatch(title_hint) === "") {
          return { content: [{ type: "text", text: "title_hint must contain at least one letter or digit — omit it to list by tag or by the whole structure." }], isError: true };
        }
        if (title_hint !== undefined && title_hint.length > TITLE_HINT_MAX) {
          return { content: [{ type: "text", text: `title_hint is ${title_hint.length} characters; the maximum is ${TITLE_HINT_MAX}.` }], isError: true };
        }
        if (tag !== undefined && tag.trim() === "") {
          return { content: [{ type: "text", text: "tag must be a non-empty tag name." }], isError: true };
        }
        // A tag name is resolved by the same search, so the same query limit applies.
        if (tag !== undefined && tag.length > TITLE_HINT_MAX) {
          return { content: [{ type: "text", text: `tag is ${tag.length} characters; the maximum is ${TITLE_HINT_MAX}.` }], isError: true };
        }
        const pageBudget = clampCount(page_budget, PAGE_BUDGET_DEFAULT, PAGE_BUDGET_MAX);

        // 1. Resolve the structure (space bucket — one call, reused).
        const { structures } = await client.getSpaceInfo();
        const sres = resolveStructure(structures, structure);
        if ("problem" in sres) {
          return { content: [{ type: "text", text: sres.problem }], isError: true };
        }
        const struct = sres.structure;
        const index = buildPropertyIndex(struct);

        // D2: cap relation filters BEFORE compileFilters resolves them, so a rejected
        // call spends nothing past the structure read. Keys that do not resolve are
        // not counted; compileFilters reports them below.
        const entityKeys = Object.keys(filters ?? {}).filter(key => {
          const r = resolvePropertyKey(index, key);
          return !("problem" in r) && r.def.type === "entity";
        });
        if (entityKeys.length > MAX_ENTITY_FILTERS) {
          return { content: [{ type: "text", text:
            `Cannot run find_objects:\n- filters: ${entityKeys.length} relation filters given (${entityKeys.join(", ")}); ` +
            `the maximum is ${MAX_ENTITY_FILTERS} per call, because each one costs a name-resolution search.` }], isError: true };
        }

        // Operation-level bounded-wait budget: buys exactly ONE object-window
        // boundary sleep across the whole call (entity-filter searches + seed
        // search + the fetch loop). Past it, acquireWithWait throws
        // RATE_LIMIT_EXCEEDED and the fetch loop returns partial results.
        const budget: WaitBudget = { remainingMs: WINDOW_MS };

        // 2. Compile filters + sort (fail-before-fetch). Entity filters resolve a
        //    NAME → id here (a search call), so a bad filter fails fast.
        const { compiled, problems } = await compileFilters(client, index, filters, budget);
        const { sort: compiledSort, problems: sortProblems } = compileSort(index, sort);
        const allProblems = [...problems, ...sortProblems];
        if (allProblems.length > 0) {
          return { content: [{ type: "text", text: "Cannot run find_objects:\n- " + allProblems.join("\n- ") }], isError: true };
        }

        // 3. Seed. Per-call request budget (D5: only a call that lists): the
        //    structure read plus one search per relation filter are already spent;
        //    the seed adds its own search on the path that makes one.
        //    `cap` defaults here: zod's .default(30) is applied by the MCP SDK's
        //    input parse, NOT on a direct handler call.
        const cap = clampCount(fetch_cap, FETCH_CAP_DEFAULT, FETCH_CAP_MAX);
        const shortCircuit = compiled.length === 0 && !compiledSort;
        const seed = await seedCandidates(client, {
          struct,
          titleHint: title_hint,
          tag,
          pageBudget,
          spentBeforeEnumeration: 1 + compiled.filter(c => c.kind === "entity-equals").length,
          fetchReserve: shortCircuit ? 0 : Math.min(cap, FETCH_RESERVE_MAX)
        }, budget);
        if ("problem" in seed) {
          return { content: [{ type: "text", text: seed.problem }], isError: true };
        }
        const stamp = new Date().toISOString();

        if (seed.complete && seed.candidates.length === 0) return renderNone(seed, stamp);

        // A listing has no useful order of its own, so put the most recent title
        // dates first BEFORE anything is cut; a search keeps its rank order. Only an
        // ascending sort on a date property flips that (design § Stage 2 (a)).
        const enumerated = seed.method !== "search";
        const dir: "asc" | "desc" =
          compiledSort?.order === "asc" && index.byId.get(compiledSort.propId)?.type === "date" ? "asc" : "desc";
        const candidates = enumerated ? orderEnumerated(seed.candidates, dir) : seed.candidates;
        const seedSize = candidates.length;
        const ordering: Ordering = {
          plural: struct.pluralName,
          stamp,
          enumerated,
          allUndated: enumerated && candidates.every(c => parseTitleDate(c.title) === null),
          dir
        };

        // Short-circuit: nothing to filter or sort on means nothing to surface.
        if (shortCircuit) return renderShortCircuit(seed, candidates, limit, ordering);

        // 4. Fetch candidates (object bucket, paced), up to fetch_cap, in the order
        //    above. A listing call gets what is left of the request budget
        //    (requestsIssued counts failed pages too); a plain title search keeps
        //    the whole cap and the limiter's wait (D5).
        const fetchAllowance = seed.enumeration
          ? Math.max(0, Math.min(cap, MAX_REQUESTS_PER_CALL - seed.spentBeforeEnumeration - seed.enumeration.requestsIssued))
          : cap;
        const planned = Math.min(seedSize, fetchAllowance);
        const outcome = await fetchCandidates(client, candidates, planned, budget);

        // 5-6. Filter client-side over the typed JSON values, sort, then limit.
        const { matches, matchedCount } = filterAndSort(outcome.fetched, compiled, compiledSort, limit);

        // 7. Render.
        return renderStage2(seed, {
          seedSize, planned, fetchAllowance, cap, limit, compiled, compiledSort, outcome, matches, matchedCount
        }, ordering);
      } catch (error) {
        const message = error instanceof CapacitiesAPIError ? error.message : error instanceof Error ? error.message : String(error);
        return { content: [{ type: "text", text: `Failed to find objects: ${message}` }], isError: true };
      }
    }
  );
}
