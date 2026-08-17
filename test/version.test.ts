import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { SERVER_VERSION } from "../src/version.js";

// Compiled tests live at <repo>/test-dist/test/, so the repo root is two levels up.
const repoRoot = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");

function readVersion(relPath: string): string {
  const parsed = JSON.parse(readFileSync(path.join(repoRoot, relPath), "utf8"));
  return parsed.version;
}

// The version a client sees over MCP comes from SERVER_VERSION, but the release
// artifacts each carry their own copy. They drifted once (server reported 2.0.0
// while the repo and the shipped .dxt said 2.1.0) — this pins them together so a
// release that bumps only some of them fails the suite instead of shipping.
test("SERVER_VERSION matches the root package.json version", () => {
  assert.equal(SERVER_VERSION, readVersion("package.json"));
});

test("server/package.json version matches the root package.json version", () => {
  assert.equal(readVersion("server/package.json"), readVersion("package.json"));
});

test("manifest.json version matches the root package.json version", () => {
  assert.equal(readVersion("manifest.json"), readVersion("package.json"));
});
