import { test } from "node:test";
import assert from "node:assert/strict";
import { CapacitiesClient } from "../src/client/capacities.js";
import { resolveEntities } from "../src/tools/resolution.js";
import type { SearchResult } from "../src/client/types.js";

// --- Mock fetch plumbing (mirrors test/capacities.test.ts) ----------------

interface CapturedCall {
  url: string;
  opts: any;
}

function makeSearchResponse(results: SearchResult[]) {
  const headers = {
    get(name: string): string | null {
      const key = name.toLowerCase();
      if (key === "content-type") return "application/json";
      return null;
    },
  };
  return {
    ok: true,
    status: 200,
    headers,
    async json() {
      return { results };
    },
    async text() {
      return "";
    },
  };
}

/**
 * Install a mock fetch whose search responder is keyed on the POST query.
 * `byQuery` maps a search query string to the results it returns.
 */
function installSearchFetch(byQuery: Record<string, SearchResult[]>) {
  const calls: CapturedCall[] = [];
  (globalThis as any).fetch = async (url: string, opts: any) => {
    calls.push({ url, opts });
    const body = JSON.parse(opts.body);
    const results = byQuery[body.query] ?? [];
    return makeSearchResponse(results);
  };
  return calls;
}

function newClient() {
  return new CapacitiesClient({
    apiToken: "test-token",
    baseUrl: "https://api.capacities.io",
  });
}

// --- 1. Single exact match -> linked --------------------------------------

test("single exact-title match is linked", async () => {
  installSearchFetch({
    Alice: [{ id: "a1", title: "Alice", structureId: "person" }],
  });
  const client = newClient();

  const res = await resolveEntities(client, ["Alice"], ["person"]);

  assert.deepEqual(res.linked, [{ name: "Alice", id: "a1" }]);
  assert.deepEqual(res.unmatched, []);
  assert.deepEqual(res.ambiguous, []);
});

// --- 2. Case-insensitive / trim match -------------------------------------

test("match is case-insensitive and trimmed", async () => {
  // The input name is what gets sent as the search query.
  installSearchFetch({
    "  alice ": [{ id: "a1", title: "Alice", structureId: "person" }],
  });
  const client = newClient();

  const res = await resolveEntities(client, ["  alice "], ["person"]);

  assert.deepEqual(res.linked, [{ name: "  alice ", id: "a1" }]);
  assert.equal(res.unmatched.length, 0);
  assert.equal(res.ambiguous.length, 0);
});

// --- 3. Non-exact filtered out --------------------------------------------

test("a partial (non-exact) title match does NOT link; name is unmatched", async () => {
  installSearchFetch({
    Alice: [{ id: "b", title: "Alice Smith", structureId: "person" }],
  });
  const client = newClient();

  const res = await resolveEntities(client, ["Alice"], ["person"]);

  assert.deepEqual(res.linked, []);
  assert.deepEqual(res.unmatched, ["Alice"]);
  assert.deepEqual(res.ambiguous, []);
});

// --- 4. Zero matches, create=false -> unmatched ---------------------------

test("zero matches with create=false is unmatched", async () => {
  installSearchFetch({ Nobody: [] });
  const client = newClient();

  const res = await resolveEntities(client, ["Nobody"], ["person"]);

  assert.deepEqual(res.unmatched, ["Nobody"]);
  assert.deepEqual(res.linked, []);
  assert.deepEqual(res.ambiguous, []);
});

// --- 5. >1 exact match -> ambiguous ---------------------------------------

test("more than one exact match is ambiguous and never linked", async () => {
  installSearchFetch({
    Alice: [
      { id: "a1", title: "Alice", structureId: "person" },
      { id: "a2", title: "alice", structureId: "person" },
    ],
  });
  const client = newClient();

  const res = await resolveEntities(client, ["Alice"], ["person"]);

  assert.deepEqual(res.linked, []);
  assert.deepEqual(res.unmatched, []);
  assert.equal(res.ambiguous.length, 1);
  assert.equal(res.ambiguous[0].name, "Alice");
  assert.deepEqual(res.ambiguous[0].candidates, [
    { id: "a1", title: "Alice", structureId: "person" },
    { id: "a2", title: "alice", structureId: "person" },
  ]);
});

// --- 6. Dedup -------------------------------------------------------------

test("repeated names (varying case) are deduped: one search, one linked entry", async () => {
  const calls = installSearchFetch({
    Alice: [{ id: "a1", title: "Alice", structureId: "person" }],
    alice: [{ id: "a1", title: "Alice", structureId: "person" }],
  });
  const client = newClient();

  const res = await resolveEntities(client, ["Alice", "alice", "Alice"], ["person"]);

  assert.equal(calls.length, 1, "the same normalized name must be searched only once");
  assert.deepEqual(res.linked, [{ name: "Alice", id: "a1" }]);
  assert.equal(res.unmatched.length, 0);
  assert.equal(res.ambiguous.length, 0);
});

// --- 9. Mixed classification in one call ----------------------------------

test("mixed: one linked, one unmatched, one ambiguous — all classified correctly", async () => {
  installSearchFetch({
    Alice: [{ id: "a1", title: "Alice", structureId: "person" }],
    Nobody: [],
    Bob: [
      { id: "b1", title: "Bob", structureId: "person" },
      { id: "b2", title: "Bob", structureId: "person" },
    ],
  });
  const client = newClient();

  const res = await resolveEntities(client, ["Alice", "Nobody", "Bob"], ["person"]);

  assert.deepEqual(res.linked, [{ name: "Alice", id: "a1" }]);
  assert.deepEqual(res.unmatched, ["Nobody"]);
  assert.equal(res.ambiguous.length, 1);
  assert.equal(res.ambiguous[0].name, "Bob");
  assert.equal(res.ambiguous[0].candidates.length, 2);
});

// --- 10. Truncation guard (cap-6dy.22) ------------------------------------

test("no exact match but the search hit the 50-result cap -> truncated, NOT unmatched", async () => {
  // 50 partial matches (none exactly "Standup") — a full/capped page with no exact.
  const partial: SearchResult[] = Array.from({ length: 50 }, (_, i) => ({
    id: `m${i}`,
    title: `Standup ${i}`,
    structureId: "meeting",
  }));
  installSearchFetch({ Standup: partial });
  const client = newClient();

  const res = await resolveEntities(client, ["Standup"], ["meeting"]);

  assert.deepEqual(res.truncated, ["Standup"], "capped-with-no-exact is truncated");
  assert.deepEqual(res.unmatched, [], "must NOT be classified as safe-to-create unmatched");
  assert.deepEqual(res.linked, []);
  assert.deepEqual(res.ambiguous, []);
});

test("no exact match below the cap -> unmatched (we saw the full result set)", async () => {
  const partial: SearchResult[] = Array.from({ length: 49 }, (_, i) => ({
    id: `m${i}`,
    title: `Standup ${i}`,
    structureId: "meeting",
  }));
  installSearchFetch({ Standup: partial });
  const client = newClient();

  const res = await resolveEntities(client, ["Standup"], ["meeting"]);

  assert.deepEqual(res.unmatched, ["Standup"], "49 < cap -> confident not-found");
  assert.deepEqual(res.truncated, []);
});

test("an exact match within a capped page is still linked, not truncated", async () => {
  // 50 results, one of them an exact title -> exact-first classification wins.
  const results: SearchResult[] = [
    { id: "exact", title: "Standup", structureId: "meeting" },
    ...Array.from({ length: 49 }, (_, i) => ({
      id: `m${i}`,
      title: `Standup ${i}`,
      structureId: "meeting",
    })),
  ];
  installSearchFetch({ Standup: results });
  const client = newClient();

  const res = await resolveEntities(client, ["Standup"], ["meeting"]);

  assert.deepEqual(res.linked, [{ name: "Standup", id: "exact" }]);
  assert.deepEqual(res.truncated, []);
  assert.deepEqual(res.unmatched, []);
});
