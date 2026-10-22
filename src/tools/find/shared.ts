// File: src/tools/find/shared.ts
//
// Constants, exactness types and small helpers shared by find_objects' seed,
// stage-2 and render modules (split out of find.ts, cap-0ot).
import { firstLineBrief } from "../../utils/error-text.js";

// --- Seed shapes + exactness (cap-i93) --------------------------------------

export const PAGE_BUDGET_DEFAULT = 12;
export const PAGE_BUDGET_MAX = 25;
export const FETCH_CAP_DEFAULT = 30;
export const FETCH_CAP_MAX = 50;
export const TITLE_HINT_MAX = 512;           // spec: /objects/search query maxLength
// Every request an ENUMERATING call makes (space read, relation searches, seed
// search, listing pages, GETs) fits this per-call budget; a plain title search
// that does not escalate is exempt and keeps the limiter's own pacing (D5).
export const MAX_REQUESTS_PER_CALL = 45;
// Each relation filter costs one name-resolution search, so capping them is what
// makes MAX_REQUESTS_PER_CALL a true ceiling (D2).
export const MAX_ENTITY_FILTERS = 5;
// Fetches reserved out of the budget before listing, so a long listing cannot
// starve stage 2: one object-bucket window.
export const FETCH_RESERVE_MAX = 30;
// Rows the zero-GET short-circuit lists when the caller gives no `limit`. Not a
// fetch count — nothing is fetched on that path — so it is not FETCH_CAP_DEFAULT.
export const SHORT_CIRCUIT_ROW_LIMIT = 30;

export type SeedMethod = "search" | "search+enumeration" | "tag-enumeration" | "structure-enumeration";
// Returned as a second text block of compact JSON (content[1]) on every non-error
// result, so a caller can tell a genuine none from a partial one without parsing
// Note: lines. NOT structuredContent: observed 2026-10-22 in Claude Code 2.1.305
// via mcp-gateway, the model received only the structuredContent JSON and no
// content[0].text, which hid every id; the layer responsible was not isolated (cap-ul0).
export type FindExactness = {
  seed_method: SeedMethod;
  seed_complete: boolean;
  candidates_complete: boolean;
  seed_size: number;    // candidates after structure/title filtering
  considered: number;   // stage 2: fetched + errored; short-circuit: seed_size (nothing to read)
  errored: number;
  matched: number;      // matches after filtering, BEFORE the limit slice (D3)
  returned: number;     // rows in the response
};

export type Candidate = { id: string; title: string };

const ERROR_DETAIL_MAX = 200;

// An API error message is server-controlled text landing in tool output, and a
// JSON body in it may span lines. Keep the first non-blank line, which holds the
// status, capped and with the count phrase neutralised (cap-dnf).
export function briefError(message: string | undefined): string {
  return firstLineBrief(message, ERROR_DETAIL_MAX) || "unknown error";
}

// zod's bounds and defaults are applied by the MCP SDK's input parse, NOT on a
// direct handler call (A11). NaN slips through Math.min/Math.max and disables the
// bound, so anything non-finite gets the default.
export function clampCount(v: number | undefined, def: number, max: number): number {
  if (v === undefined || !Number.isFinite(v)) return def;
  return Math.min(Math.max(Math.floor(v), 1), max);
}
