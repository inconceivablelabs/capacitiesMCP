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
