import { test } from "node:test";
import assert from "node:assert/strict";
import { CapacitiesClient, CapacitiesAPIError } from "../src/client/capacities.js";
import { enumerateAll } from "../src/tools/enumerate.js";

// Synthetic, spec-shaped ids (this repo is public).
function uid(n: number): string { return `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`; }
function rows(from: number, to: number) {
  const out: { id: string; structureId: string; title: string }[] = [];
  for (let n = from; n <= to; n++) out.push({ id: uid(n), structureId: "meeting", title: `Item ${n}` });
  return out;
}
function resp(body: unknown, status = 200, contentType = "application/json") {
  const headers = { get: (n: string) => (n.toLowerCase() === "content-type" ? contentType : null) };
  return {
    ok: status >= 200 && status < 300, status, headers,
    async json() { return body; },
    async text() { return typeof body === "string" ? body : JSON.stringify(body); }
  };
}
interface Call { url: string; }
// Serves pages by the cursor the client sends: no cursor → pages[0];
// cursor === pages[i-1].nextCursor → pages[i]; anything else → 400, as the real
// API would answer an unknown cursor. A page may be a function returning a raw response.
function installPages(pages: any[]): Call[] {
  const calls: Call[] = [];
  (globalThis as any).fetch = async (url: string) => {
    calls.push({ url });
    const cursor = new URL(url).searchParams.get("cursor");
    const idx = cursor === null ? 0 : pages.findIndex((_p, i) => i > 0 && pages[i - 1]?.nextCursor === cursor);
    if (idx < 0) return resp({ error: `unknown cursor ${cursor}` }, 400);
    const p = pages[idx];
    return typeof p === "function" ? p() : resp(p);
  };
  return calls;
}
function fakeClock() {
  let t = 0;
  const sleeps: number[] = [];
  return { now: () => t, sleep: async (ms: number) => { t += ms; sleeps.push(ms); }, sleeps };
}
function client(clock?: { now: () => number; sleep: (ms: number) => Promise<void> }): any {
  return new CapacitiesClient({
    apiToken: "t", baseUrl: "https://api.capacities.io",
    ...(clock ? { now: clock.now, sleep: clock.sleep } : {})
  });
}
const THREE_PAGES = () => [
  { results: rows(1, 100), nextCursor: uid(100), hasMore: true },
  { results: rows(101, 200), nextCursor: uid(200), hasMore: true },
  { results: rows(201, 230), nextCursor: null, hasMore: false }
];

test("enumerateAll threads the cursor, includes the last partial page, and stops on hasMore:false", async () => {
  const calls = installPages(THREE_PAGES());
  const r = await enumerateAll(client(), "structure", "meeting", 12);
  assert.equal(calls.length, 3);
  assert.equal(new URL(calls[0].url).searchParams.has("cursor"), false);
  assert.equal(new URL(calls[1].url).searchParams.get("cursor"), uid(100));
  assert.equal(new URL(calls[2].url).searchParams.get("cursor"), uid(200));
  assert.equal(r.results.length, 230);
  assert.equal(new Set(r.results.map(x => x.id)).size, 230, "no duplicate ids");
  assert.equal(r.results[229].id, uid(230), "the last partial page is included, in enumeration order");
  assert.deepEqual(
    { complete: r.complete, stopReason: r.stopReason, pagesRead: r.pagesRead, requestsIssued: r.requestsIssued },
    { complete: true, stopReason: "done", pagesRead: 3, requestsIssued: 3 }
  );
});

test("enumerateAll stops at the page budget with hasMore still true — partial, never complete (structure AND tag)", async () => {
  for (const [kind, id] of [["structure", "meeting"], ["tag", uid(0xa001)]] as const) {
    const calls = installPages(THREE_PAGES());
    const r = await enumerateAll(client(), kind, id, 2);
    assert.equal(calls.length, 2, kind);
    assert.equal(new URL(calls[0].url).pathname, `/objects/${kind}`);
    assert.equal(r.results.length, 200, kind);
    assert.equal(r.complete, false, kind);
    assert.equal(r.stopReason, "page-budget", kind);
    assert.equal(r.pagesRead, 2, kind);
  }
});

test("enumerateAll: hasMore:true with nextCursor:null stops after ONE request (never re-fetches page 1)", async () => {
  const calls = installPages([{ results: rows(1, 100), nextCursor: null, hasMore: true }]);
  const r = await enumerateAll(client(), "structure", "meeting", 12);
  assert.equal(calls.length, 1);
  assert.equal(r.results.length, 100);
  assert.equal(r.complete, false);
  assert.equal(r.stopReason, "no-cursor");
});

test("enumerateAll: a nextCursor equal to the cursor just sent stops as no-cursor (no progress)", async () => {
  const calls = installPages([
    { results: rows(1, 100), nextCursor: uid(100), hasMore: true },
    { results: rows(101, 150), nextCursor: uid(100), hasMore: true }   // stuck
  ]);
  const r = await enumerateAll(client(), "structure", "meeting", 12);
  assert.equal(calls.length, 2);
  assert.equal(r.results.length, 150);
  assert.equal(r.stopReason, "no-cursor");
  assert.equal(r.complete, false);
});

test("enumerateAll drops a duplicate id across pages, keeping the first occurrence", async () => {
  installPages([
    { results: rows(1, 100), nextCursor: uid(100), hasMore: true },
    { results: [{ id: uid(100), structureId: "meeting", title: "Item 100 (again)" }, ...rows(101, 150)], nextCursor: null, hasMore: false }
  ]);
  const r = await enumerateAll(client(), "structure", "meeting", 12);
  assert.equal(r.results.length, 150);
  assert.equal(r.results.find(x => x.id === uid(100))!.title, "Item 100");
  assert.equal(r.complete, true);
});

test("enumerateAll: an unreadable page (HTML 200, or a 500) ENDS the listing as partial — it is not an empty page", async () => {
  const bad: [string, () => any][] = [
    ["html 200", () => resp("<!doctype html><title>Just a moment</title>", 200, "text/html")],
    ["500", () => resp("boom", 500, "text/plain")]
  ];
  for (const [name, page2] of bad) {
    const calls = installPages([{ results: rows(1, 100), nextCursor: uid(100), hasMore: true }, page2]);
    const r = await enumerateAll(client(), "structure", "meeting", 12);
    assert.equal(calls.length, 2, `${name}: does not continue past the bad page`);
    assert.equal(r.results.length, 100, `${name}: keeps what it read`);
    assert.equal(r.complete, false, name);
    assert.equal(r.stopReason, "error", name);
    assert.match(r.errorMessage ?? "", name === "html 200" ? /not a valid enumeration page/ : /API error 500/, name);
  }
});

test("enumerateAll: a 429 on page 1 is a rate-limited partial with zero results, not an empty listing", async () => {
  const calls = installPages([() => resp("<!doctype html>banned", 429, "text/html")]);
  const r = await enumerateAll(client(), "structure", "meeting", 12);
  assert.equal(calls.length, 1);
  assert.deepEqual(r.results, []);
  assert.equal(r.complete, false);
  assert.equal(r.stopReason, "rate-limit");
});

test("enumerateAll never sleeps: a full enumerate window ends the listing as rate-limited instead of waiting", async () => {
  const clock = fakeClock();
  const c = client(clock);
  installPages([{ results: rows(1, 1), nextCursor: null, hasMore: false }]);
  for (let i = 0; i < 30; i++) await c.enumerateObjects("structure", "meeting"); // fill the window (limit 30)
  const r = await enumerateAll(c, "structure", "meeting", 12);
  assert.equal(r.stopReason, "rate-limit", "the window boundary was reached — proves the scenario ran");
  assert.deepEqual(clock.sleeps, [], "enumeration uses a NON-waiting budget");
  assert.equal(r.complete, false);
});

test("enumerateAll rethrows an authentication failure — a bad token is not a partial listing", async () => {
  installPages([() => resp("bad token", 401, "text/plain")]);
  await assert.rejects(
    enumerateAll(client(), "structure", "meeting", 12),
    (e: any) => e instanceof CapacitiesAPIError && e.code === "AUTHENTICATION_FAILED"
  );
});
