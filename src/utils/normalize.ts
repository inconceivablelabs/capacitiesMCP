// File: src/utils/normalize.ts
//
// Shared name-normalization for case-insensitive, trimmed equality. Used by
// entity resolution (relation NAMES → object ids) and property/label key
// matching (cap-6dy.24 #4 — was a byte-identical dupe in object.ts +
// resolution.ts).
//
// #PATH_DECISION: exact-title / property-name match uses case-insensitive,
// trimmed equality. Capacities titles and property names are user-facing and
// case is very likely insignificant — this is a deliberate judgement call
// (e.g. "alice" matches "Alice").
export function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}
