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
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  CapacitiesClient,
  CapacitiesAPIError,
  WaitBudget,
  WINDOW_MS
} from "../client/capacities.js";
import { CapacitiesStructure } from "../client/types.js";
import { PropertyIndex, buildPropertyIndex, resolvePropertyKey } from "./object.js";
import { resolveEntities, SEARCH_LIMIT } from "./resolution.js";
import { enumerateAll, EnumerationResult } from "./enumerate.js";
import { normalizeName as normalize, normalizeForTitleMatch, matchesTitle } from "../utils/normalize.js";
import { isSpecUuid } from "../utils/validation.js";
import { parseTitleDate, orderEnumerated } from "../utils/title-date.js";

// --- Seed shapes + exactness (cap-i93) --------------------------------------

export const PAGE_BUDGET_DEFAULT = 12;
export const PAGE_BUDGET_MAX = 25;
export const TITLE_HINT_MAX = 512;           // spec: /objects/search query maxLength
export const MAX_REQUESTS_PER_CALL = 45;    // used from Task 8

export type SeedMethod = "search" | "search+enumeration" | "tag-enumeration" | "structure-enumeration";
// Returned as structuredContent on every non-error result, so a caller can tell a
// genuine none from a partial one without parsing Note: lines. A type alias, not
// an interface: the SDK's structuredContent needs an implicit index signature.
export type FindExactness = {
  seed_method: SeedMethod;
  seed_complete: boolean;
  candidates_complete: boolean;
  seed_size: number;    // candidates after structure/title filtering
  considered: number;   // stage 2: fetched + errored
  errored: number;
  matched: number;      // matches after filtering, BEFORE the limit slice (D3)
  returned: number;     // rows in the response
};

const ERROR_DETAIL_MAX = 200;

// An API error message carries the whole HTTP body (a Cloudflare page runs to
// thousands of characters), and that body is server-controlled text landing in
// tool output. Keep the first line, which holds the status, and cap it.
function briefError(message: string | undefined): string {
  const first = (message ?? "").split("\n", 1)[0].trim();
  if (!first) return "unknown error";
  return first.length > ERROR_DETAIL_MAX ? first.slice(0, ERROR_DETAIL_MAX) + "…" : first;
}

// Stage-1 Note for an incomplete listing. Never uses stage 2's "checked N of M
// candidates" phrase: personal-assistant's backfill keys on it (U6).
function enumerationNote(e: EnumerationResult): string | null {
  if (e.complete) return null;
  switch (e.stopReason) {
    case "page-budget":
      return `Note: listing stopped at the page budget — read ${e.pagesRead} pages (${e.results.length} summaries) and more remain; ` +
        `results may be incomplete. Narrow the seed (title_hint or tag) or raise page_budget (max ${PAGE_BUDGET_MAX}).`;
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

// --- Read-shape value extractors -------------------------------------------
// GET /object (JSON) returns `properties` as a map of property-definition-id →
// typed value, discriminated on `type`. Shapes are spec-verified against
// components.schemas.ApiObjectPropertyValue in the live OpenAPI (2026-07-13):
//   date    {type:"date",  date:{start:string|null, end:string|null, dateResolution:"time"|"day"}}
//   label   {type:"label", label:[{id,name,color?}]}
//   entity  {type:"entity",entity:[{id}]}                 (id-ONLY — no name)
//   scalar  {type:"text|number|boolean|url|title", <type>:{value:<v>|null}}

/** "YYYY-MM-DD" day slice of an ISO date string. */
export function dayOf(iso: string): string {
  return iso.slice(0, 10);
}

export function readDate(v: any): { start: string | null; resolution: "day" | "time" } | null {
  if (!v || v.type !== "date" || !v.date) return null;
  return {
    start: typeof v.date.start === "string" ? v.date.start : null,
    resolution: v.date.dateResolution === "day" ? "day" : "time"
  };
}

export function readLabels(v: any): { id: string; name: string }[] {
  if (!v || v.type !== "label" || !Array.isArray(v.label)) return [];
  return v.label
    .filter((o: any) => o && typeof o.id === "string")
    .map((o: any) => ({ id: o.id, name: typeof o.name === "string" ? o.name : o.id }));
}

export function readEntityIds(v: any): string[] {
  if (!v || v.type !== "entity" || !Array.isArray(v.entity)) return [];
  return v.entity.map((e: any) => e?.id).filter((x: any) => typeof x === "string");
}

export function readScalar(v: any): string | number | boolean | null {
  if (!v || typeof v.type !== "string") return null;
  const inner = (v as any)[v.type]; // title/text/number/boolean/url → {value}
  if (inner && typeof inner === "object" && "value" in inner) {
    const val = inner.value;
    return val === undefined ? null : val;
  }
  return null;
}

// --- Compiled filters (data, not closures — so matching is unit-testable) ---

export type CompiledFilter =
  | { propId: string; propName: string; kind: "date-equals"; day: string; hasTime: boolean; instant: number }
  | { propId: string; propName: string; kind: "date-range"; afterMs: number | null; beforeMs: number | null }
  | { propId: string; propName: string; kind: "label-equals"; optionId: string; optionName: string }
  | { propId: string; propName: string; kind: "entity-equals"; targetId: string; targetName: string }
  | { propId: string; propName: string; kind: "scalar-equals"; value: string | number | boolean };

// A missing property (not in the object's map) never matches an equals/range.
export function matchesFilter(props: Record<string, any> | undefined, f: CompiledFilter): boolean {
  const v = props?.[f.propId];
  switch (f.kind) {
    case "date-equals": {
      const d = readDate(v);
      if (!d || !d.start) return false;
      // Day-granularity match when the filter is a date-only string OR the stored
      // value is day-resolution — matches any time within that calendar day.
      if (!f.hasTime || d.resolution === "day") return dayOf(d.start) === f.day;
      const ms = Date.parse(d.start);
      return !Number.isNaN(ms) && ms === f.instant;
    }
    case "date-range": {
      const d = readDate(v);
      if (!d || !d.start) return false;
      const ms = Date.parse(d.start);
      if (Number.isNaN(ms)) return false;
      if (f.afterMs !== null && ms < f.afterMs) return false;   // after = inclusive lower
      if (f.beforeMs !== null && ms >= f.beforeMs) return false; // before = exclusive upper
      return true;
    }
    case "label-equals":
      return readLabels(v).some(o => o.id === f.optionId);
    case "entity-equals":
      return readEntityIds(v).includes(f.targetId);
    case "scalar-equals": {
      const val = readScalar(v);
      if (val === null || val === undefined) return false;
      if (typeof f.value === "string") return normalize(String(val)) === normalize(f.value);
      return val === f.value;
    }
  }
}

// --- Sort ------------------------------------------------------------------

/** Comparable sort key for a typed value; null = missing (sorts last). */
export function sortKey(v: any): number | string | null {
  if (!v || typeof v.type !== "string") return null;
  switch (v.type) {
    case "date": {
      const d = readDate(v);
      if (!d || !d.start) return null;
      const ms = Date.parse(d.start);
      return Number.isNaN(ms) ? null : ms;
    }
    case "number": {
      const val = readScalar(v);
      return typeof val === "number" ? val : null;
    }
    case "boolean": {
      const val = readScalar(v);
      return typeof val === "boolean" ? (val ? 1 : 0) : null;
    }
    case "label": {
      const names = readLabels(v).map(o => o.name);
      return names.length ? names.join(", ") : null;
    }
    case "entity": {
      const ids = readEntityIds(v);
      return ids.length ? ids.join(", ") : null;
    }
    default: {
      const val = readScalar(v);
      return val === null || val === undefined ? null : String(val);
    }
  }
}

export function compareForSort(
  a: number | string | null,
  b: number | string | null,
  order: "asc" | "desc"
): number {
  const aNull = a === null;
  const bNull = b === null;
  if (aNull && bNull) return 0;
  if (aNull) return 1;   // missing always last, regardless of order
  if (bNull) return -1;
  let cmp: number;
  if (typeof a === "number" && typeof b === "number") {
    cmp = a - b;
  } else {
    const sa = String(a);
    const sb = String(b);
    cmp = sa < sb ? -1 : sa > sb ? 1 : 0;
  }
  return order === "asc" ? cmp : -cmp;
}

// --- Structure resolution (name or id) -------------------------------------

export function resolveStructure(
  structures: CapacitiesStructure[],
  param: string
): { structure: CapacitiesStructure } | { problem: string } {
  const byId = structures.find(s => s.id === param); // built-in ids (RootTask…) match here
  if (byId) return { structure: byId };
  const norm = normalize(param);
  const byName = structures.filter(
    s => normalize(s.title) === norm || normalize(s.pluralName) === norm
  );
  if (byName.length === 1) return { structure: byName[0] };
  if (byName.length > 1) {
    return { problem: `structure "${param}" is ambiguous — matches ${byName.length} types by name; use the structure id` };
  }
  const available = structures.map(s => `${s.title} (${s.id})`).join(", ");
  return { problem: `unknown structure "${param}". Available: ${available}` };
}

// --- Filter/sort input schema + compilation --------------------------------

// A filter value is a scalar (equals) or a date range object {after?, before?}.
export const filterValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.object({ after: z.string().optional(), before: z.string().optional() })
]);
export type FilterValue = z.infer<typeof filterValueSchema>;

// Detects a time component in an ISO string (e.g. "2026-07-13T09:00"); a bare
// "2026-07-13" is treated as day-granularity (matches any time that day).
function hasTimeComponent(s: string): boolean {
  return /\d{4}-\d{2}-\d{2}[T ]\d/.test(s);
}

/**
 * Resolves each filter key (name-or-id) to a property def, picks the operator
 * from the def's type, and validates the value. Entity-typed filters resolve
 * their NAME → object id via resolveEntities (a title search, paced by `pace`).
 * Accumulates problems; never guesses.
 */
export async function compileFilters(
  client: CapacitiesClient,
  index: PropertyIndex,
  filters: Record<string, FilterValue> | undefined,
  pace: WaitBudget
): Promise<{ compiled: CompiledFilter[]; problems: string[] }> {
  const compiled: CompiledFilter[] = [];
  const problems: string[] = [];

  for (const [key, raw] of Object.entries(filters ?? {})) {
    const resolved = resolvePropertyKey(index, key);
    if ("problem" in resolved) { problems.push(resolved.problem); continue; }
    const def = resolved.def;
    const isRange = typeof raw === "object" && raw !== null;

    if (def.type === "date") {
      if (isRange) {
        const r = raw as { after?: string; before?: string };
        if (r.after === undefined && r.before === undefined) {
          problems.push(`filter \`${key}\` range needs at least one of after/before`);
          continue;
        }
        let afterMs: number | null = null;
        let beforeMs: number | null = null;
        if (r.after !== undefined) {
          afterMs = Date.parse(r.after);
          if (Number.isNaN(afterMs)) { problems.push(`filter \`${key}\` after is not a valid ISO date: ${r.after}`); continue; }
        }
        if (r.before !== undefined) {
          beforeMs = Date.parse(r.before);
          if (Number.isNaN(beforeMs)) { problems.push(`filter \`${key}\` before is not a valid ISO date: ${r.before}`); continue; }
        }
        compiled.push({ propId: def.id, propName: def.name, kind: "date-range", afterMs, beforeMs });
      } else {
        const s = String(raw);
        const instant = Date.parse(s);
        if (Number.isNaN(instant)) { problems.push(`filter \`${key}\` is not a valid ISO date: ${s}`); continue; }
        compiled.push({ propId: def.id, propName: def.name, kind: "date-equals", day: dayOf(s), hasTime: hasTimeComponent(s), instant });
      }
      continue;
    }

    if (isRange) {
      problems.push(`filter \`${key}\`: after/before ranges are only valid for date properties`);
      continue;
    }

    if (def.type === "label") {
      const options = def.labelSet ?? [];
      const opt = options.find(o => normalize(o.name) === normalize(String(raw)));
      if (!opt) {
        const valid = options.map(o => o.name).join(", ");
        problems.push(`filter \`${key}\`: unknown option \`${String(raw)}\`; valid: ${valid}`);
        continue;
      }
      compiled.push({ propId: def.id, propName: def.name, kind: "label-equals", optionId: opt.id, optionName: opt.name });
      continue;
    }

    if (def.type === "entity") {
      const name = String(raw);
      // Entity/tag values in GET /object JSON are id-only (A5), so a name filter
      // must resolve NAME → id via a title search scoped to the relation's targets.
      const r = await resolveEntities(client, [name], def.allowedStructures, { pace });
      if (r.ambiguous.length > 0) {
        const cands = r.ambiguous[0].candidates.map(c => `${c.title} (${c.id})`).join(", ");
        problems.push(`filter \`${key}\`: \`${name}\` is ambiguous: ${cands}`);
        continue;
      }
      if (r.truncated.length > 0) {
        problems.push(`filter \`${key}\`: could not confirm \`${name}\` — the title search returned the maximum ${SEARCH_LIMIT} results with no exact match; use a more specific name`);
        continue;
      }
      if (r.linked.length !== 1) {
        problems.push(`filter \`${key}\`: no object named \`${name}\` to filter on`);
        continue;
      }
      compiled.push({ propId: def.id, propName: def.name, kind: "entity-equals", targetId: r.linked[0].id, targetName: name });
      continue;
    }

    // scalar (text / url / number / boolean / title)
    if (def.type === "number") {
      const n = Number(raw);
      if (Number.isNaN(n)) { problems.push(`filter \`${key}\` value is not a number: ${String(raw)}`); continue; }
      compiled.push({ propId: def.id, propName: def.name, kind: "scalar-equals", value: n });
      continue;
    }
    if (def.type === "boolean") {
      let b: boolean;
      if (typeof raw === "boolean") b = raw;
      else if (String(raw).toLowerCase() === "true") b = true;
      else if (String(raw).toLowerCase() === "false") b = false;
      else { problems.push(`filter \`${key}\` value is not a boolean: ${String(raw)}`); continue; }
      compiled.push({ propId: def.id, propName: def.name, kind: "scalar-equals", value: b });
      continue;
    }
    if (def.type === "text" || def.type === "url" || def.type === "title") {
      compiled.push({ propId: def.id, propName: def.name, kind: "scalar-equals", value: String(raw) });
      continue;
    }

    problems.push(`filter \`${key}\`: cannot filter on property type \`${def.type}\``);
  }

  return { compiled, problems };
}

export interface CompiledSort { propId: string; propName: string; order: "asc" | "desc"; }

export function compileSort(
  index: PropertyIndex,
  sort: { by: string; order: "asc" | "desc" } | undefined
): { sort: CompiledSort | null; problems: string[] } {
  if (!sort) return { sort: null, problems: [] };
  const resolved = resolvePropertyKey(index, sort.by);
  if ("problem" in resolved) return { sort: null, problems: [resolved.problem] };
  return { sort: { propId: resolved.def.id, propName: resolved.def.name, order: sort.order }, problems: [] };
}

// --- Tool registration + orchestration -------------------------------------

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

export function setupFindTools(server: McpServer, client: CapacitiesClient) {
  server.registerTool(
    "find_objects",
    {
      title: "Find Capacities Objects",
      description:
        "Locate objects by a property/date/label/tag the API cannot search on. It seeds a title search " +
        "(the only query the API allows), fetches candidates, then filters and sorts client-side. Results are " +
        "limited to objects whose title contains `title_hint` (case, accents and punctuation ignored). Returns " +
        "matching ids + titles + the filtered/sorted property values — NO bodies (read a match's body with " +
        "get_object). REQUIRED: `title_hint` (a non-empty title seed) and `structure` (NAME or id from " +
        "get_space_info). `filters` are keyed by property NAME or id: a date value is an ISO string (equals, " +
        "day-granularity) or {after,before} (ISO range); a label value is an option NAME; a relation/tag " +
        "value is an object NAME; text/number/boolean are equals. Dates must be absolute ISO strings — " +
        "relative terms like \"tomorrow\" are NOT supported (compute the date and pass it). `sort` is {by, " +
        "order}; missing values sort last. It CANNOT enumerate a type without a title seed, follow backlinks, " +
        "or read bodies.",
      inputSchema: {
        structure: z.string().describe("Object type to search — structure NAME or id (from get_space_info)"),
        title_hint: z.string().max(TITLE_HINT_MAX).optional().describe(
          "Optional. Title text the object's title must contain (needs at least one letter or digit). Omit to list by tag or the whole type."
        ),
        tag: z.string().optional().describe(
          "Optional. Tag NAME: lists the objects carrying that tag (combine with title_hint to filter their titles)"
        ),
        filters: z.record(filterValueSchema).optional().describe(
          "Client-side filters keyed by property NAME or id. Date: ISO string (equals) or {after,before} (ISO range). Label: option NAME. Relation/tag: object NAME. Scalars: equals."
        ),
        sort: z.object({
          by: z.string().describe("Property NAME or id to sort by"),
          order: z.enum(["asc", "desc"]).default("asc")
        }).optional().describe("Sort by a property; missing values sort last"),
        limit: z.number().int().positive().optional().describe("Max results to return after filtering"),
        fetch_cap: z.number().int().min(1).max(50).default(30).describe(
          "Max candidates to fetch in stage 2 (default 30 fits one rate window; max 50 may add one ~60s wait)"
        ),
        page_budget: z.number().int().min(1).max(PAGE_BUDGET_MAX).default(PAGE_BUDGET_DEFAULT).describe(
          `Max listing pages (100 summaries each) to read when seeding by tag or structure (default ${PAGE_BUDGET_DEFAULT}, max ${PAGE_BUDGET_MAX})`
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
        // zod's bounds and default are applied by the MCP SDK's input parse, NOT on a
        // direct handler call, so clamp here too (A11).
        const pageBudget = Math.min(Math.max(page_budget ?? PAGE_BUDGET_DEFAULT, 1), PAGE_BUDGET_MAX);

        // 1. Resolve the structure (space bucket — one call, reused).
        const { structures } = await client.getSpaceInfo();
        const sres = resolveStructure(structures, structure);
        if ("problem" in sres) {
          return { content: [{ type: "text", text: sres.problem }], isError: true };
        }
        const struct = sres.structure;
        const index = buildPropertyIndex(struct);

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

        // 3. Seed. A title search when only a hint is given; otherwise a listing of
        //    the tag (or the whole structure), filtered client-side.
        const plural = struct.pluralName;
        let seedMethod: SeedMethod;
        let seedComplete: boolean;
        let candidates: { id: string; title: string }[];
        let header: (n: number, stamp: string) => string;
        let noneText: (stamp: string) => string;
        const infoLines: string[] = [];
        const stage1Notes: string[] = [];

        if (tag === undefined && title_hint !== undefined) {
          const seed = await client.searchContent(
            { query: title_hint, structureIds: [struct.id], limit: SEARCH_LIMIT },
            budget
          );
          // cap-1kc: the search also returns objects related BY MEANING, interleaved
          // by relevance — a semantic extra can be a newer dated object and win a
          // sort-desc + limit-1. Keep only title matches.
          const titleSeed = seed.filter(r => matchesTitle(r.title, title_hint));
          header = (n, stamp) => `Found ${n} ${plural} matching "${title_hint}" (live as of ${stamp}):`;
          noneText = stamp => `No ${plural} found with a title matching "${title_hint}" (live as of ${stamp}).`;

          // Saturation is judged on the RAW count: at the cap a title match may sit
          // beyond it whatever the filter kept, so list the whole structure instead
          // and filter that (cap-i93 U3/U8).
          if (seed.length < SEARCH_LIMIT) {
            candidates = titleSeed;
            seedMethod = "search";
            seedComplete = true;
            const droppedCount = seed.length - titleSeed.length;
            if (droppedCount > 0) infoLines.push(`(${droppedCount} search result(s) were ignored because their titles don't contain "${title_hint}" — Capacities search also returns matches by meaning.)`);
          } else {
            const listing = await enumerateAll(client, "structure", struct.id, pageBudget);
            candidates = listing.results.filter(r => r.structureId === struct.id && matchesTitle(r.title, title_hint));
            seedMethod = "search+enumeration";
            seedComplete = listing.complete;
            infoLines.push(`(The title search returned its ${SEARCH_LIMIT}-result maximum, so the ${plural} were listed instead: ${listing.pagesRead} page(s), ${listing.results.length} summaries.)`);
            const note = enumerationNote(listing);
            if (note) stage1Notes.push(note);
            if (listing.complete) logFidelityCanary(struct.id, titleSeed, candidates);
          }
        } else {
          let listing: EnumerationResult;
          if (tag !== undefined) {
            // Every tag problem fails before any enumeration call.
            const tres = await resolveTag(client, tag, budget);
            if ("problem" in tres) {
              return { content: [{ type: "text", text: tres.problem }], isError: true };
            }
            listing = await enumerateAll(client, "tag", tres.id, pageBudget);
            seedMethod = "tag-enumeration";
            const scope = title_hint !== undefined
              ? `tagged "${tag}" with a title matching "${title_hint}"`
              : `tagged "${tag}"`;
            header = (n, stamp) => `Found ${n} ${plural} ${scope} (live as of ${stamp}):`;
            noneText = stamp => `No ${plural} found ${scope} (live as of ${stamp}).`;
          } else {
            listing = await enumerateAll(client, "structure", struct.id, pageBudget);
            seedMethod = "structure-enumeration";
            header = (n, stamp) => `Found ${n} ${plural} (live as of ${stamp}):`;
            noneText = stamp => `No ${plural} found (live as of ${stamp}).`;
          }
          // A tag spans every type, so keep only this structure. The structure
          // listing gets the same filter: harmless when the API honours the id,
          // and it keeps seed_size meaning "candidates of this type".
          candidates = listing.results.filter(r =>
            r.structureId === struct.id && (title_hint === undefined || matchesTitle(r.title, title_hint))
          );
          seedComplete = listing.complete;
          const note = enumerationNote(listing);
          if (note) stage1Notes.push(note);
        }
        const stamp = new Date().toISOString();

        if (seedComplete && candidates.length === 0) {
          const exactness: FindExactness = {
            seed_method: seedMethod, seed_complete: true, candidates_complete: true,
            seed_size: 0, considered: 0, errored: 0, matched: 0, returned: 0
          };
          return { content: [{ type: "text", text: noneText(stamp) }], structuredContent: exactness };
        }

        // A listing has no useful order of its own, so put the most recent title
        // dates first BEFORE anything is cut; a search keeps its rank order. Only an
        // ascending sort on a date property flips that (design § Stage 2 (a)).
        const enumerated = seedMethod !== "search";
        const dir: "asc" | "desc" =
          compiledSort?.order === "asc" && index.byId.get(compiledSort.propId)?.type === "date" ? "asc" : "desc";
        if (enumerated) candidates = orderEnumerated(candidates, dir);
        const seedSize = candidates.length;
        // When no title carries a date the ordering above is a no-op, so a cut keeps
        // listing order — say so, rather than let it pass for "most recent" (S-M1).
        const undatedLine = (kept: number): string | null =>
          enumerated && kept < seedSize && candidates.every(c => parseTitleDate(c.title) === null)
            ? `(None of the ${seedSize} candidate titles carries a date, so the ${kept} kept were taken in listing order, not by date.)`
            : null;

        // Contract: every "Note:" line means the result may be INCOMPLETE —
        // personal-assistant's backfill_meeting_titles.py fails a run on any
        // Note: line. Informational lines must not start with "Note:".

        // Short-circuit: nothing to filter or sort on means nothing to surface, so
        // list the seed itself with zero GET /object (design Example C).
        if (compiled.length === 0 && !compiledSort) {
          const rows = candidates.slice(0, limit ?? 30);
          const info = [...infoLines];
          const undated = undatedLine(rows.length);
          if (undated) info.push(undated);
          const notes = [...stage1Notes];
          if (rows.length < seedSize) {
            notes.push(`Note: showing the first ${rows.length} of ${seedSize} matching ${plural} (limit) — raise limit or narrow the seed.`);
          }
          const trailer = [...info, ...notes];
          const body = rows.length
            ? rows.map(r => `**${r.title}**\nID: ${r.id}`).join("\n---\n")
            : `(no matching ${plural} in the part of the listing that was read)`;
          const exactness: FindExactness = {
            seed_method: seedMethod,
            seed_complete: seedComplete,
            candidates_complete: rows.length === seedSize,
            seed_size: seedSize,
            considered: seedSize,
            errored: 0,
            matched: seedSize,
            returned: rows.length
          };
          const noteLine = trailer.length ? "\n\n" + trailer.join("\n") : "";
          return { content: [{ type: "text", text: `${header(rows.length, stamp)}\n\n${body}${noteLine}` }], structuredContent: exactness };
        }

        // 4. Fetch candidates (object bucket, paced) — one GET /object per
        //    candidate, up to fetch_cap, in the order above. Fail-open: a rate
        //    stop ends the loop with partial results; a non-rate read error skips
        //    the candidate and continues.
        // NOTE: zod's .default(30) is applied by the MCP SDK's input parse, NOT on a
        // direct handler call (tests invoke the handler directly), so default here too.
        const cap = fetch_cap ?? 30;
        const planned = Math.min(seedSize, cap);
        const fetched: { id: string; title: string; props: Record<string, any> }[] = [];
        let rateStopped = false;
        let erroredCount = 0;
        for (let i = 0; i < planned; i++) {
          const cand = candidates[i];
          try {
            const obj = await client.getObject(cand.id, budget);
            fetched.push({ id: cand.id, title: cand.title, props: (obj.properties ?? {}) as Record<string, any> });
          } catch (e) {
            if (e instanceof CapacitiesAPIError && e.code === "RATE_LIMIT_EXCEEDED") { rateStopped = true; break; }
            erroredCount++;
          }
        }
        const consideredCount = fetched.length + erroredCount;

        // 5. Filter client-side over the typed JSON values.
        let matches = fetched.filter(f => compiled.every(cf => matchesFilter(f.props, cf)));

        // 6. Sort (missing last), then apply the post-filter limit.
        if (compiledSort) {
          const cs = compiledSort;
          matches = matches.slice().sort((a, b) =>
            compareForSort(sortKey(a.props[cs.propId]), sortKey(b.props[cs.propId]), cs.order)
          );
        }
        const matchedCount = matches.length;   // D3: before the limit slice
        if (limit !== undefined) matches = matches.slice(0, limit);

        // 7. Surface only the filtered + sorted property values (P9 — not a full dump).
        const surfaceProps: { id: string; name: string }[] = [];
        for (const cf of compiled) if (!surfaceProps.some(s => s.id === cf.propId)) surfaceProps.push({ id: cf.propId, name: cf.propName });
        if (compiledSort && !surfaceProps.some(s => s.id === compiledSort.propId)) surfaceProps.push({ id: compiledSort.propId, name: compiledSort.propName });

        const blocks = matches.map(m => {
          const lines = [`**${m.title}**`, `ID: ${m.id}`];
          for (const s of surfaceProps) lines.push(`${s.name}: ${surfaceValue(m.props[s.id])}`);
          return lines.join("\n");
        });

        const stage2Info: string[] = [];
        if (compiledSort && consideredCount < seedSize) {
          stage2Info.push(`(Sorted within the ${consideredCount} fetched candidates only — the true first/last by ${compiledSort.propName} may lie among the ${seedSize - consideredCount} candidates not fetched.)`);
        }
        // Trimming to the caller's limit is what they asked for, not incompleteness.
        if (limit !== undefined && matchedCount > limit) stage2Info.push(`(showing ${limit} of ${matchedCount} matches — limit)`);
        const undated = undatedLine(planned);
        if (undated) stage2Info.push(undated);

        const stage2Notes: string[] = [];
        if (rateStopped) stage2Notes.push(`Note: rate budget reached — checked ${consideredCount} of ${seedSize} candidates; results may be incomplete (retry shortly or narrow the query).`);
        else if (planned < seedSize) {
          const order = !enumerated ? "in search-rank order" : dir === "asc" ? "oldest first by title date" : "most recent first by title date";
          stage2Notes.push(`Note: fetched the first ${planned} of ${seedSize} candidates (fetch_cap) ${order}; raise fetch_cap or narrow the seed.`);
        }
        else if (erroredCount > 0) stage2Notes.push(`Note: ${erroredCount} candidate(s) could not be read and were skipped.`);
        const trailer = [...infoLines, ...stage2Info, ...stage1Notes, ...stage2Notes];

        // An empty candidate list here is a PARTIAL none (the listing stopped
        // early): never rendered as "No … found". Filters run over a sample when
        // not every candidate was fetched, so an empty result says so.
        const body = blocks.length
          ? blocks.join("\n---\n")
          : seedSize === 0
            ? `(no matching ${plural} in the part of the listing that was read)`
            : consideredCount < seedSize
              ? `(none of the ${consideredCount} fetched candidates matched the filters — ${seedSize - consideredCount} were not fetched)`
              : "(no candidates matched the filters)";
        const noteLine = trailer.length ? "\n\n" + trailer.join("\n") : "";
        const exactness: FindExactness = {
          seed_method: seedMethod,
          seed_complete: seedComplete,
          candidates_complete: !rateStopped && planned === seedSize && erroredCount === 0,
          seed_size: seedSize,
          considered: consideredCount,
          errored: erroredCount,
          matched: matchedCount,
          returned: matches.length
        };
        return { content: [{ type: "text", text: `${header(matches.length, stamp)}\n\n${body}${noteLine}` }], structuredContent: exactness };
      } catch (error) {
        const message = error instanceof CapacitiesAPIError ? error.message : error instanceof Error ? error.message : String(error);
        return { content: [{ type: "text", text: `Failed to find objects: ${message}` }], isError: true };
      }
    }
  );
}
