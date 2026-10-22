import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTitleDate, orderEnumerated } from "../src/utils/title-date.js";

const D = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d);

test("parseTitleDate reads the three live shapes (plus 4-digit slash and month abbreviations)", () => {
  assert.equal(parseTitleDate("Weekly Sync - 2025-05-15"), D(2025, 5, 15));            // ISO — 318 of 321 dated titles
  assert.equal(parseTitleDate("Internship Planning (May 19, 2026)"), D(2026, 5, 19));  // Month D, YYYY
  assert.equal(parseTitleDate("Kickoff (Sep 3, 2025)"), D(2025, 9, 3));
  assert.equal(parseTitleDate("Kickoff (Sept. 3, 2025)"), D(2025, 9, 3));
  assert.equal(parseTitleDate("Prep Call for 3/18/26"), D(2026, 3, 18));               // M/D/YY → 2000+YY (live)
  assert.equal(parseTitleDate("Prep Call for 3/18/2026"), D(2026, 3, 18));
});

test("parseTitleDate returns null when there is no VALID date", () => {
  for (const t of ["Quarterly Planning", "", "Alpha/Bravo 1:1", "Release 2.0 Progress",
                   "Sync 2025-13-40", "18/3/26 recap", "ID 12025-05-150", "Due Feb 30, 2026"]) {
    assert.equal(parseTitleDate(t), null, JSON.stringify(t));
  }
  assert.equal(parseTitleDate(null), null);
  assert.equal(parseTitleDate(undefined), null);
});

test("parseTitleDate takes the LEFTMOST valid date, across shapes; an invalid candidate is skipped", () => {
  assert.equal(parseTitleDate("Moved 2025-01-02 to 2025-02-03"), D(2025, 1, 2));
  assert.equal(parseTitleDate("3/18/26 recap of 2025-01-02"), D(2026, 3, 18));
  assert.equal(parseTitleDate("Sync 2025-13-40 then 2025-02-03"), D(2025, 2, 3));
});

const S = (n: number, title: string) =>
  ({ id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, structureId: "meeting", title });
const ids = (xs: { id: string }[]) => xs.map(x => Number(x.id.slice(-12)));
// Enumeration order (ascending id) is deliberately ANTI-correlated with title-date
// order, so "no sort at all" cannot pass. Includes the empty title and a
// same-date tie (5 and 7) — 08-21 QA plan rows C3, C4, C5.
const FIXTURE = [
  S(1, "Sync - 2024-01-10"), S(2, "Kickoff"), S(3, "Sync - 2026-03-01"), S(4, ""),
  S(5, "Sync - 2025-06-15"), S(6, "Retro (May 19, 2026)"), S(7, "Sync - 2025-06-15"), S(8, "Prep 3/18/26")
];

test("orderEnumerated desc: dated first, newest first; ties and undated keep enumeration order", () => {
  assert.deepEqual(ids(orderEnumerated(FIXTURE, "desc")), [6, 8, 3, 5, 7, 1, 2, 4]);
});

test("orderEnumerated asc: dated first, OLDEST first; ties keep enumeration order; undated still last", () => {
  assert.deepEqual(ids(orderEnumerated(FIXTURE, "asc")), [1, 5, 7, 3, 8, 6, 2, 4]);
});

test("orderEnumerated: an all-undated list keeps enumeration order exactly, and the input is not mutated", () => {
  const undated = [S(3, "Kickoff"), S(1, ""), S(2, "Planning")];
  const before = undated.map(x => x.id);
  assert.deepEqual(ids(orderEnumerated(undated, "desc")), [3, 1, 2]);
  assert.deepEqual(undated.map(x => x.id), before);
});
