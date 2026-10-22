import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeForTitleMatch, matchesTitle } from "../src/utils/normalize.js";

// cap-1kc: the title matcher that tells a search result's TITLE match apart from
// a semantic ("by meaning") hit. Titles here are synthetic — this repo is public.

test("normalizeForTitleMatch folds case, accents and separator runs to single spaces", () => {
  assert.equal(normalizeForTitleMatch("Alpha/Beta 1:1"), "alpha beta 1 1");
  assert.equal(normalizeForTitleMatch("  Alpha  Beta  "), "alpha beta");
  assert.equal(normalizeForTitleMatch("Café Review"), "cafe review");
  assert.equal(normalizeForTitleMatch("Sync - 2025-07-30"), "sync 2025 07 30");
});

test("matchesTitle: separators in the title match a space-separated query", () => {
  assert.equal(matchesTitle("Alpha/Beta 1:1", "alpha beta"), true);
  assert.equal(matchesTitle("Alpha/Beta 1:1", "Alpha/Beta"), true);
});

test("matchesTitle: double spaces on either side collapse", () => {
  assert.equal(matchesTitle("Alpha  Beta Sync", "alpha beta"), true);
  assert.equal(matchesTitle("Alpha Beta Sync", "alpha  beta"), true);
});

test("matchesTitle: a mid-word query matches", () => {
  assert.equal(matchesTitle("Weekly Connect", "onnect"), true);
});

test("matchesTitle: a date-digit run matches across hyphens", () => {
  assert.equal(matchesTitle("Sync - 2025-07-30", "2025-07"), true);
  assert.equal(matchesTitle("Sync - 2025-08-30", "2025-07"), false);
});

test("matchesTitle: accents fold on both sides", () => {
  assert.equal(matchesTitle("Café Review", "cafe"), true);
  assert.equal(matchesTitle("Cafe Review", "café"), true);
});

test("matchesTitle: a semantically related title that does not contain the query is NOT a match", () => {
  assert.equal(matchesTitle("Quarterly Planning", "roadmap"), false);
  assert.equal(matchesTitle("Team Offsite - 2026-07-10", "weekly roadmap review"), false);
});

test("matchesTitle: null, undefined and empty titles never match a real query", () => {
  assert.equal(matchesTitle(null, "alpha"), false);
  assert.equal(matchesTitle(undefined, "alpha"), false);
  assert.equal(matchesTitle("", "alpha"), false);
});

test("an all-punctuation query normalizes to empty (callers must skip filtering)", () => {
  assert.equal(normalizeForTitleMatch("///"), "");
  assert.equal(normalizeForTitleMatch(" -- : "), "");
});

test("a non-Latin query keeps its letters (does not normalize to empty)", () => {
  assert.notEqual(normalizeForTitleMatch("会議"), "");
  assert.equal(matchesTitle("週次会議", "会議"), true);
});

// cap-i93 design test 2 — parity corpus. SYNTHETIC titles reproducing the shapes
// on which the server's title rule and naive substring matching DIVERGE: slash
// and comma separators, double spaces, mid-word queries, ISO-date digit runs,
// × and —, accents, non-Latin, an empty title. Every expected list is DERIVED by
// hand from the rule — none is a server observation. Server fidelity was
// established once against the private 469-title corpus (16/16 live pairs,
// 2026-10-22, project-internals cap-i93 plan, Assumption A2); it cannot be
// re-proved from a public fixture.
const CORPUS = [
  "Alpha/Bravo 1:1 - 2025-03-04",        // 0
  "Alpha, Bravo & Charlie sync",          // 1
  "alpha bravo planning",                 // 2
  "Staff  Sync - 2024-11-12",             // 3  double space; date digits
  "Staff Sync",                           // 4
  "Weekly Connect",                       // 5
  "Kilo × Lima — Scope & Next Steps",     // 6  U+00D7, U+2014
  "Kilo Lima scope review",               // 7
  "Release 2.0 Progress",                 // 8
  "Café Review",                          // 9
  "週次会議",                              // 10
  "",                                     // 11 empty title
  "Ops Standup (May 19, 2026)",           // 12
  "Prep Call for 3/18/26",                // 13
  "Quarterly Planning",                   // 14
  "Delta/Echo 1:1",                       // 15
  "Echo Retro - 2025-11-12",              // 16
  "PRODUCT Discussion",                   // 17
  "Foxtrot discussion notes",             // 18
  "Golf-Hotel Sync"                       // 19
];
const PARITY: [query: string, expected: number[], why: string][] = [
  ["Alpha/Bravo",  [0, 1, 2],     "derived: slash and comma are separators on both sides"],
  ["alpha bravo",  [0, 1, 2],     "derived: space query reaches slash/comma titles"],
  ["lpha brav",    [0, 1, 2],     "derived: mid-word across a separator"],
  ["staff  sync",  [3, 4],        "derived: double space collapses in the query"],
  ["staff sync",   [3, 4],        "derived: double space collapses in the title"],
  ["onnect",       [5],           "derived: mid-word"],
  ["kilo lima",    [6, 7],        "derived: × is a separator"],
  ["lima scope",   [6, 7],        "derived: — is a separator"],
  ["2 0 progress", [8],           "derived: '2.0' normalizes to '2 0'"],
  ["11 12",        [3, 16],       "derived: ISO date digits are matchable"],
  ["1:1",          [0, 3, 15, 16], "derived: date-digit COLLISION — required, the server does it too (design § numeric)"],
  ["delta echo",   [15],          "derived: slash"],
  ["product",      [17],          "derived: case-insensitive"],
  ["iscussion",    [17, 18],      "derived: mid-word"],
  ["cafe",         [9],           "derived: accents fold (U1)"],
  ["café",         [9],           "derived: accents fold on the query too"],
  ["会議",          [10],          "derived: non-Latin keeps its letters (U1)"],
  ["golf hotel",   [19],          "derived: hyphen"],
  ["Bravo Alpha",  [],            "derived: token order matters (not token-AND)"],
  ["sync planning", [],           "derived: not token-OR"]
];

test("matchesTitle parity corpus (derived rows over synthetic titles)", () => {
  for (const [q, want, why] of PARITY) {
    const got = CORPUS.map((t, i) => (matchesTitle(t, q) ? i : -1)).filter(i => i >= 0);
    assert.deepEqual(got, want, `${JSON.stringify(q)} — ${why}`);
  }
});

test("the parity corpus still discriminates: naive substring disagrees on at least 10 rows", () => {
  const naive = (t: string, q: string) => t.toLowerCase().includes(q.toLowerCase());
  const diverging = PARITY.filter(([q, want]) =>
    JSON.stringify(CORPUS.map((t, i) => (naive(t, q) ? i : -1)).filter(i => i >= 0)) !== JSON.stringify(want));
  assert.ok(diverging.length >= 10, `only ${diverging.length} rows diverge — the corpus lost its separator cases`);
});
