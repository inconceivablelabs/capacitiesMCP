import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Compiled tests live at <repo>/test-dist/test/, so the repo root is two levels up
// (same resolution as test/version.test.ts).
const repoRoot = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");

// manifest.json's tools[] is hand-maintained and the standard post-pack check
// (version + 11 tools) passes with a stale description (project CLAUDE.md), so
// the description itself is pinned.
test("manifest.json describes find_objects' tag and whole-type listing, not a title-seed-only search", () => {
  const manifest = JSON.parse(readFileSync(path.join(repoRoot, "manifest.json"), "utf8"));
  const entry = manifest.tools.find((t: any) => t.name === "find_objects");
  assert.ok(entry, "find_objects is listed");
  assert.match(entry.description, /tag/);
  assert.match(entry.description, /lists the whole type/);
  assert.doesNotMatch(entry.description, /title-seed search/);
  assert.equal(manifest.tools.length, 11);
});

test("README's find_objects row describes tag and whole-type listing", () => {
  const row = readFileSync(path.join(repoRoot, "README.md"), "utf8").split("\n").find(l => l.startsWith("| `find_objects` |"));
  assert.ok(row, "the README tool table has a find_objects row");
  assert.match(row!, /`tag`/);
  assert.match(row!, /lists the whole type/);
});
