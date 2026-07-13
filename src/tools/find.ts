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
