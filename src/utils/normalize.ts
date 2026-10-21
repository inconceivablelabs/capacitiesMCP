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

// cap-1kc: POST /objects/search also returns objects that match BY MEANING
// (semantic), interleaved with title matches, and a result row carries only
// {id, structureId, title}. So the client decides which hits are title matches.
//
// Over ASCII this is cap-i93's A4 rule (lowercase; collapse every run of
// non-alphanumerics to one space; trim; substring), which reproduced the
// server's title matching exactly in live probes. Two deliberate widenings:
// Unicode letters/numbers are kept (so a non-Latin query does not normalize to
// ""), and accents are folded on both sides (so the filter errs toward
// inclusion — the server's accent handling is unverified).
export function normalizeForTitleMatch(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

// True when `title` contains `query` under normalizeForTitleMatch. A query that
// normalizes to "" (all punctuation) matches EVERYTHING, so callers must check
// `normalizeForTitleMatch(query) === ""` first and skip filtering rather than
// treat every hit as a title match.
export function matchesTitle(title: string | null | undefined, query: string): boolean {
  return normalizeForTitleMatch(title ?? "").includes(normalizeForTitleMatch(query));
}
