// File: src/tools/find.ts
//
// find_objects (cap-0yu) — a live LOCATE primitive. It composes the two read
// endpoints the v2 API already gives us into a property/date/label/tag query the
// API itself cannot express:
//   stage 1  seed:   POST /objects/search (title-only) scoped to one structure
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
import { normalizeName as normalize } from "../utils/normalize.js";

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
        "(the only query the API allows), fetches candidates, then filters and sorts client-side. Returns " +
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
        title_hint: z.string().describe("Title text to seed the search (REQUIRED, non-empty — the only seed the API allows)"),
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
        )
      }
    },
    async ({ structure, title_hint, filters, sort, limit, fetch_cap }) => {
      try {
        // 0. Validate the seed BEFORE any call — a blank title_hint is never fired
        //    as an empty search (the API's only seed lever must be meaningful).
        if (!title_hint || !title_hint.trim()) {
          return { content: [{ type: "text", text: "title_hint is required and must be non-empty — it is the title seed for stage 1." }], isError: true };
        }

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

        // 3. Seed: title search scoped to the one structure (search bucket).
        const seed = await client.searchContent(
          { query: title_hint, structureIds: [struct.id], limit: SEARCH_LIMIT },
          budget
        );
        const seedTruncated = seed.length >= SEARCH_LIMIT;
        const stamp = new Date().toISOString();

        if (seed.length === 0) {
          return { content: [{ type: "text", text: `No ${struct.pluralName} found with a title matching "${title_hint}" (live as of ${stamp}).` }] };
        }

        // 4. Fetch candidates (object bucket, paced) — one GET /object per
        //    candidate, up to fetch_cap, in search-rank order. Fail-open: a rate
        //    stop ends the loop with partial results; a non-rate read error skips
        //    the candidate and continues.
        // NOTE: zod's .default(30) is applied by the MCP SDK's input parse, NOT on a
        // direct handler call (tests invoke the handler directly), so default here too.
        const cap = fetch_cap ?? 30;
        const planned = Math.min(seed.length, cap);
        const fetched: { id: string; title: string; props: Record<string, any> }[] = [];
        let rateStopped = false;
        let erroredCount = 0;
        for (let i = 0; i < planned; i++) {
          const cand = seed[i];
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

        const header = `Found ${matches.length} ${struct.pluralName} matching "${title_hint}" (live as of ${stamp}):`;
        const notes: string[] = [];
        if (seedTruncated) notes.push(`Note: the title search returned the maximum ${SEARCH_LIMIT} candidates — a match may exist beyond it; narrow title_hint.`);
        if (rateStopped) notes.push(`Note: rate budget reached — checked ${consideredCount} of ${seed.length} candidates; results may be incomplete (retry shortly or narrow the query).`);
        else if (planned < seed.length) notes.push(`Note: fetched the first ${planned} of ${seed.length} candidates (fetch_cap) in search-rank order; raise fetch_cap or narrow title_hint.`);
        else if (erroredCount > 0) notes.push(`Note: ${erroredCount} candidate(s) could not be read and were skipped.`);

        const body = blocks.length ? blocks.join("\n---\n") : "(no candidates matched the filters)";
        const noteLine = notes.length ? "\n\n" + notes.join("\n") : "";
        return { content: [{ type: "text", text: `${header}\n\n${body}${noteLine}` }] };
      } catch (error) {
        const message = error instanceof CapacitiesAPIError ? error.message : error instanceof Error ? error.message : String(error);
        return { content: [{ type: "text", text: `Failed to find objects: ${message}` }], isError: true };
      }
    }
  );
}
