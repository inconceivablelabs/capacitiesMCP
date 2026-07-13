import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dayOf, readDate, readLabels, readEntityIds, readScalar,
  matchesFilter, sortKey, compareForSort, resolveStructure,
  CompiledFilter
} from "../src/tools/find.js";

// --- read-shape extractors -------------------------------------------------

test("readDate/readLabels/readEntityIds/readScalar extract the spec-verified shapes", () => {
  assert.deepEqual(readDate({ type: "date", date: { start: "2026-07-13T09:00:00.000Z", end: null, dateResolution: "time" } }),
    { start: "2026-07-13T09:00:00.000Z", resolution: "time" });
  assert.deepEqual(readDate({ type: "date", date: { start: null, end: null, dateResolution: "day" } }),
    { start: null, resolution: "day" });
  assert.equal(readDate({ type: "text", text: { value: "x" } }), null);

  assert.deepEqual(readLabels({ type: "label", label: [{ id: "s-done", name: "Done", color: "green" }] }),
    [{ id: "s-done", name: "Done" }]);
  assert.deepEqual(readLabels({ type: "label", label: [] }), []);

  assert.deepEqual(readEntityIds({ type: "entity", entity: [{ id: "t-1" }, { id: "t-2" }] }), ["t-1", "t-2"]);
  assert.deepEqual(readEntityIds({ type: "entity", entity: [] }), []);

  assert.equal(readScalar({ type: "text", text: { value: "hello" } }), "hello");
  assert.equal(readScalar({ type: "number", number: { value: 42 } }), 42);
  assert.equal(readScalar({ type: "boolean", boolean: { value: false } }), false);
  assert.equal(readScalar({ type: "title", title: { value: "T" } }), "T");
  assert.equal(readScalar({ type: "text", text: { value: null } }), null);
});

// --- date-equals: day-granularity matches any time in the day (P4) ---------

test("date-equals with a date-only filter matches any time within that day", () => {
  const f: CompiledFilter = { propId: "date", propName: "Date", kind: "date-equals", day: "2026-07-13", hasTime: false, instant: Date.parse("2026-07-13") };
  assert.equal(matchesFilter({ date: { type: "date", date: { start: "2026-07-13T09:30:00.000Z", end: null, dateResolution: "time" } } }, f), true);
  assert.equal(matchesFilter({ date: { type: "date", date: { start: "2026-07-14T00:00:00.000Z", end: null, dateResolution: "time" } } }, f), false);
});

test("date-equals with a full timestamp filter on a time-resolution value matches the exact instant", () => {
  const iso = "2026-07-13T09:30:00.000Z";
  const f: CompiledFilter = { propId: "date", propName: "Date", kind: "date-equals", day: "2026-07-13", hasTime: true, instant: Date.parse(iso) };
  assert.equal(matchesFilter({ date: { type: "date", date: { start: iso, end: null, dateResolution: "time" } } }, f), true);
  assert.equal(matchesFilter({ date: { type: "date", date: { start: "2026-07-13T10:00:00.000Z", end: null, dateResolution: "time" } } }, f), false);
});

test("date-range: after inclusive, before exclusive; null start never matches", () => {
  const f: CompiledFilter = { propId: "date", propName: "Date", kind: "date-range", afterMs: Date.parse("2026-07-01"), beforeMs: Date.parse("2026-07-13") };
  assert.equal(matchesFilter({ date: { type: "date", date: { start: "2026-07-06T00:00:00.000Z", end: null, dateResolution: "time" } } }, f), true);
  assert.equal(matchesFilter({ date: { type: "date", date: { start: "2026-07-13T00:00:00.000Z", end: null, dateResolution: "time" } } }, f), false); // == before → excluded
  assert.equal(matchesFilter({ date: { type: "date", date: { start: null, end: null, dateResolution: "day" } } }, f), false);
});

// --- label / entity / scalar equals ----------------------------------------

test("label-equals matches on option id; entity-equals matches on id membership", () => {
  const lf: CompiledFilter = { propId: "status", propName: "Status", kind: "label-equals", optionId: "s-done", optionName: "Done" };
  assert.equal(matchesFilter({ status: { type: "label", label: [{ id: "s-done", name: "Done" }] } }, lf), true);
  assert.equal(matchesFilter({ status: { type: "label", label: [{ id: "s-open", name: "Open" }] } }, lf), false);

  const ef: CompiledFilter = { propId: "tags", propName: "Tags", kind: "entity-equals", targetId: "tag-product", targetName: "product" };
  assert.equal(matchesFilter({ tags: { type: "entity", entity: [{ id: "tag-product" }, { id: "tag-x" }] } }, ef), true);
  assert.equal(matchesFilter({ tags: { type: "entity", entity: [{ id: "tag-x" }] } }, ef), false);
});

test("scalar-equals: string case-insensitive, number/boolean exact; missing never matches", () => {
  const sf: CompiledFilter = { propId: "note", propName: "Note", kind: "scalar-equals", value: "Hello" };
  assert.equal(matchesFilter({ note: { type: "text", text: { value: "hello" } } }, sf), true);
  assert.equal(matchesFilter({}, sf), false);

  const nf: CompiledFilter = { propId: "n", propName: "N", kind: "scalar-equals", value: 5 };
  assert.equal(matchesFilter({ n: { type: "number", number: { value: 5 } } }, nf), true);
  assert.equal(matchesFilter({ n: { type: "number", number: { value: 6 } } }, nf), false);
});

// --- sort ------------------------------------------------------------------

test("sortKey returns comparable keys; compareForSort puts missing last in both orders", () => {
  assert.equal(sortKey({ type: "date", date: { start: "2026-07-13T00:00:00.000Z", end: null, dateResolution: "time" } }), Date.parse("2026-07-13T00:00:00.000Z"));
  assert.equal(sortKey({ type: "number", number: { value: 3 } }), 3);
  assert.equal(sortKey(undefined), null);

  // ascending numeric
  assert.ok(compareForSort(1, 2, "asc") < 0);
  assert.ok(compareForSort(2, 1, "asc") > 0);
  // descending numeric
  assert.ok(compareForSort(1, 2, "desc") > 0);
  // missing always last
  assert.ok(compareForSort(null, 5, "asc") > 0);
  assert.ok(compareForSort(null, 5, "desc") > 0);
  assert.ok(compareForSort(5, null, "desc") < 0);
});

// --- structure resolution --------------------------------------------------

test("resolveStructure: id (incl. built-ins) wins; name/pluralName resolves; unknown/ambiguous problem", () => {
  const structs: any[] = [
    { id: "RootTask", title: "Task", pluralName: "Tasks", propertyDefinitions: [], collections: [] },
    { id: "meeting", title: "Meeting", pluralName: "Meetings", propertyDefinitions: [], collections: [] }
  ];
  assert.deepEqual((resolveStructure(structs, "RootTask") as any).structure.id, "RootTask"); // built-in id
  assert.deepEqual((resolveStructure(structs, "Meetings") as any).structure.id, "meeting");   // pluralName
  assert.deepEqual((resolveStructure(structs, "meeting") as any).structure.id, "meeting");    // id
  assert.match((resolveStructure(structs, "Nope") as any).problem, /unknown structure/);
});

// --- compile: needs a client + mocked fetch for entity resolution ----------

import { CapacitiesClient } from "../src/client/capacities.js";
import { buildPropertyIndex } from "../src/tools/object.js";
import { compileFilters, compileSort } from "../src/tools/find.js";

function makeResp(body: unknown) {
  const headers = { get: (n: string) => (n.toLowerCase() === "content-type" ? "application/json" : null) };
  return { ok: true, status: 200, headers, async json() { return body; }, async text() { return ""; } };
}
function installSearch(resultsByQuery: Record<string, any[]>) {
  const calls: string[] = [];
  (globalThis as any).fetch = async (url: string, opts: any) => {
    calls.push(url);
    if (url.endsWith("/objects/search") && opts?.method === "POST") {
      const q = JSON.parse(opts.body).query;
      return makeResp({ results: resultsByQuery[q] ?? [] });
    }
    throw new Error(`unexpected call in compile test: ${url}`);
  };
  return calls;
}
function findClient() {
  return new CapacitiesClient({ apiToken: "t", baseUrl: "https://api.capacities.io" });
}
function meetingStructure(): any {
  return {
    id: "meeting", title: "Meeting", pluralName: "Meetings", labelColor: "blue", collections: [],
    propertyDefinitions: [
      { id: "title", name: "Title", type: "title", writable: true },
      { id: "date", name: "Date", type: "date", writable: true },
      { id: "status", name: "Status", type: "label", writable: true, multiple: false,
        labelSet: [{ id: "s-open", name: "Open" }, { id: "s-done", name: "Done" }] },
      { id: "tags", name: "Tags", type: "entity", writable: true, allowedStructures: ["RootTag"] },
      { id: "note", name: "Note", type: "text", writable: true }
    ]
  };
}

test("compileFilters: date equals (day) + label by name + no fetch when no entity filter", async () => {
  const calls = installSearch({}); // must NOT be called
  const idx = buildPropertyIndex(meetingStructure());
  const { compiled, problems } = await compileFilters(findClient(), idx, { Date: "2026-07-13", Status: "Done" }, { remainingMs: 60000 });
  assert.deepEqual(problems, []);
  const kinds = compiled.map(c => `${c.propName}:${c.kind}`).sort();
  assert.deepEqual(kinds, ["Date:date-equals", "Status:label-equals"]);
  const label = compiled.find(c => c.kind === "label-equals") as any;
  assert.equal(label.optionId, "s-done");
  assert.equal(calls.length, 0, "no fetch when no entity filter");
});

test("compileFilters: entity/tag filter resolves NAME → id via a title search scoped to RootTag", async () => {
  installSearch({ product: [{ id: "tag-product", title: "product", structureId: "RootTag" }] });
  const idx = buildPropertyIndex(meetingStructure());
  const { compiled, problems } = await compileFilters(findClient(), idx, { Tags: "product" }, { remainingMs: 60000 });
  assert.deepEqual(problems, []);
  const ef = compiled.find(c => c.kind === "entity-equals") as any;
  assert.equal(ef.targetId, "tag-product");
});

test("compileFilters: range on a label prop, unknown option, unknown property, bad ISO all become problems (nothing compiled)", async () => {
  installSearch({});
  const idx = buildPropertyIndex(meetingStructure());
  const { compiled, problems } = await compileFilters(findClient(), idx,
    { Status: { after: "2026-01-01" }, note: "ok", Date: "not-a-date", Nope: "x" } as any,
    { remainingMs: 60000 });
  assert.match(problems.join("\n"), /only valid for date properties/);
  assert.match(problems.join("\n"), /not a valid ISO date/);
  assert.match(problems.join("\n"), /unknown property `Nope`/);
  // Only the valid scalar `note` compiled.
  assert.deepEqual(compiled.map(c => c.propName), ["Note"]);
});

test("compileSort: resolves by name, defaults propagate; unknown property → problem", () => {
  const idx = buildPropertyIndex(meetingStructure());
  const ok = compileSort(idx, { by: "Date", order: "desc" });
  assert.deepEqual(ok.problems, []);
  assert.deepEqual(ok.sort, { propId: "date", propName: "Date", order: "desc" });
  const bad = compileSort(idx, { by: "ghost", order: "asc" });
  assert.equal(bad.sort, null);
  assert.match(bad.problems[0], /unknown property `ghost`/);
});

// === find_objects tool (mocked fetch, node --test) =========================

import { setupFindTools } from "../src/tools/find.js";

interface FCall { url: string; opts: any; }
function fRouteResp(init: { ok?: boolean; status?: number; body?: unknown; text?: string; contentType?: string | null; contentLength?: string | null }) {
  const { ok = true, status = 200, contentType = "application/json", contentLength = null, body = {}, text = "" } = init;
  const headers = { get(n: string): string | null { const k = n.toLowerCase(); if (k === "content-type") return contentType; if (k === "content-length") return contentLength; return null; } };
  return { ok, status, headers, async json() { return body; }, async text() { return text; } };
}
function findStructures(): any {
  return { structures: [ meetingStructure(),
    { id: "RootTag", title: "Tag", pluralName: "Tags", labelColor: "green", collections: [],
      propertyDefinitions: [{ id: "title", name: "Name", type: "title", writable: true }] } ] };
}
function meetingObj(id: string, props: Record<string, any>): any {
  return { id, structureId: "meeting", collections: [], properties: props, blocks: {} };
}
function dateProp(iso: string, res: "day" | "time" = "time") { return { type: "date", date: { start: iso, end: null, dateResolution: res } }; }

// Router: structures, search-by-query, object-by-id, optional per-id failure.
function findRouter(opts: {
  structures?: any;
  search?: Record<string, any[]>;
  objects?: Record<string, any>;
  getFail?: Record<string, { status: number; text: string }>;
}) {
  return (call: FCall) => {
    const method = call.opts?.method ?? "GET";
    if (call.url.endsWith("/space/structures")) return fRouteResp({ body: opts.structures ?? findStructures() });
    if (call.url.endsWith("/objects/search") && method === "POST") {
      const q = JSON.parse(call.opts.body).query;
      return fRouteResp({ body: { results: opts.search?.[q] ?? [] } });
    }
    if (call.url.includes("/object?id=") && method === "GET") {
      const m = call.url.match(/\/object\?id=([^&]+)/);
      const id = m ? decodeURIComponent(m[1]) : "";
      if (opts.getFail?.[id]) return fRouteResp({ ok: false, status: opts.getFail[id].status, text: opts.getFail[id].text });
      return fRouteResp({ body: opts.objects?.[id] ?? meetingObj(id, {}) });
    }
    throw new Error(`unexpected call: ${method} ${call.url}`);
  };
}
function installFind(responder: (c: FCall) => any) {
  const calls: FCall[] = [];
  (globalThis as any).fetch = async (url: string, opts: any) => { const c = { url, opts }; calls.push(c); return responder(c); };
  return calls;
}
// Fake clock (mirrors test/capacities.test.ts): `now` reads a mutable counter,
// `sleep` advances it. A "60s" window wait resolves instantly under test — so a
// test that crosses a rate-window boundary must inject this, or it REAL-sleeps.
function fakeClock() {
  let t = 0;
  const sleeps: number[] = [];
  return { now: () => t, sleep: async (ms: number) => { t += ms; sleeps.push(ms); }, sleeps };
}
function getFind(clock?: { now: () => number; sleep: (ms: number) => Promise<void> }) {
  const tools: Record<string, any> = {};
  const server: any = { registerTool(name: string, config: any, handler: any) { tools[name] = { name, config, handler }; } };
  const client = new CapacitiesClient({
    apiToken: "t", baseUrl: "https://api.capacities.io",
    ...(clock ? { now: clock.now, sleep: clock.sleep } : {})
  });
  setupFindTools(server, client);
  return tools["find_objects"].handler;
}

test("find_objects: seeds, fetches, date-equals narrows to the matching meeting, surfaces Date + freshness stamp", async () => {
  const handler = getFind();
  installFind(findRouter({
    search: { "Weekly Roadmap Review": [
      { id: "m1", title: "Weekly Roadmap Review", structureId: "meeting" },
      { id: "m2", title: "Weekly Roadmap Review", structureId: "meeting" }
    ] },
    objects: {
      m1: meetingObj("m1", { date: dateProp("2026-07-14T15:00:00.000Z") }),
      m2: meetingObj("m2", { date: dateProp("2026-07-07T15:00:00.000Z") })
    }
  }));

  const res = await handler({ structure: "Meeting", title_hint: "Weekly Roadmap Review", filters: { Date: "2026-07-14" } });

  assert.equal(res.isError, undefined);
  assert.match(res.content[0].text, /Found 1 Meetings matching "Weekly Roadmap Review"/);
  assert.match(res.content[0].text, /live as of \d{4}-\d{2}-\d{2}T/);
  assert.match(res.content[0].text, /ID: m1/);
  assert.doesNotMatch(res.content[0].text, /ID: m2/);
  assert.match(res.content[0].text, /Date: 2026-07-14T15:00:00.000Z/);
});

test("find_objects: blank title_hint → isError, no network calls", async () => {
  const handler = getFind();
  const calls = installFind(findRouter({}));
  const res = await handler({ structure: "Meeting", title_hint: "   " });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /title_hint is required/);
  assert.equal(calls.length, 0);
});

test("find_objects: unknown structure → isError, no search", async () => {
  const handler = getFind();
  const calls = installFind(findRouter({}));
  const res = await handler({ structure: "Widgets", title_hint: "x" });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /unknown structure "Widgets"/);
  assert.equal(calls.some(c => c.url.endsWith("/objects/search")), false);
});

test("find_objects: date range {before} + sort desc + limit 1 → most-recent previous occurrence", async () => {
  const handler = getFind();
  installFind(findRouter({
    search: { "Weekly Roadmap Review": [
      { id: "m1", title: "Weekly Roadmap Review", structureId: "meeting" },
      { id: "m2", title: "Weekly Roadmap Review", structureId: "meeting" },
      { id: "m3", title: "Weekly Roadmap Review", structureId: "meeting" }
    ] },
    objects: {
      m1: meetingObj("m1", { date: dateProp("2026-07-14T15:00:00.000Z") }), // future — excluded by before
      m2: meetingObj("m2", { date: dateProp("2026-07-07T15:00:00.000Z") }), // most recent past
      m3: meetingObj("m3", { date: dateProp("2026-06-30T15:00:00.000Z") })
    }
  }));

  const res = await handler({
    structure: "Meeting", title_hint: "Weekly Roadmap Review",
    filters: { Date: { before: "2026-07-13" } }, sort: { by: "Date", order: "desc" }, limit: 1
  });

  assert.equal(res.isError, undefined);
  assert.match(res.content[0].text, /Found 1 Meetings/);
  assert.match(res.content[0].text, /ID: m2/);
  assert.doesNotMatch(res.content[0].text, /ID: m1/);
  assert.doesNotMatch(res.content[0].text, /ID: m3/);
});

test("find_objects: sort wiring — seed order ascends, sort desc must reorder (not pass through)", async () => {
  const handler = getFind();
  installFind(findRouter({
    search: { "Weekly Roadmap Review": [
      { id: "m3", title: "Weekly Roadmap Review", structureId: "meeting" }, // oldest FIRST in seed
      { id: "m2", title: "Weekly Roadmap Review", structureId: "meeting" }
    ] },
    objects: {
      m3: meetingObj("m3", { date: dateProp("2026-06-30T15:00:00.000Z") }),
      m2: meetingObj("m2", { date: dateProp("2026-07-07T15:00:00.000Z") })  // newest — must come out FIRST
    }
  }));
  const res = await handler({
    structure: "Meeting", title_hint: "Weekly Roadmap Review",
    filters: { Date: { before: "2026-07-13" } }, sort: { by: "Date", order: "desc" }, limit: 1
  });
  assert.equal(res.isError, undefined);
  assert.match(res.content[0].text, /ID: m2/, "desc sort must surface the newest, not the seed-first");
  assert.doesNotMatch(res.content[0].text, /ID: m3/);
});

test("find_objects: label-equals filter narrows on option id", async () => {
  const handler = getFind();
  installFind(findRouter({
    search: { Standup: [{ id: "m1", title: "Standup", structureId: "meeting" }, { id: "m2", title: "Standup", structureId: "meeting" }] },
    objects: {
      m1: meetingObj("m1", { status: { type: "label", label: [{ id: "s-done", name: "Done" }] } }),
      m2: meetingObj("m2", { status: { type: "label", label: [{ id: "s-open", name: "Open" }] } })
    }
  }));
  const res = await handler({ structure: "Meeting", title_hint: "Standup", filters: { Status: "Done" } });
  assert.equal(res.isError, undefined);
  assert.match(res.content[0].text, /Found 1 Meetings/);
  assert.match(res.content[0].text, /ID: m1/);
  assert.match(res.content[0].text, /Status: Done/);
});

test("find_objects: tag-equals resolves name→id (search scoped to RootTag) then matches the entity id", async () => {
  const handler = getFind();
  installFind(findRouter({
    search: {
      product: [{ id: "tag-product", title: "product", structureId: "RootTag" }],
      "Staff Meeting": [{ id: "m1", title: "Staff Meeting", structureId: "meeting" }, { id: "m2", title: "Staff Meeting", structureId: "meeting" }]
    },
    objects: {
      m1: meetingObj("m1", { tags: { type: "entity", entity: [{ id: "tag-product" }] } }),
      m2: meetingObj("m2", { tags: { type: "entity", entity: [{ id: "tag-other" }] } })
    }
  }));
  const res = await handler({ structure: "Meeting", title_hint: "Staff Meeting", filters: { Tags: "product" } });
  assert.equal(res.isError, undefined);
  assert.match(res.content[0].text, /Found 1 Meetings/);
  assert.match(res.content[0].text, /ID: m1/);
});

test("find_objects: seed truncation (50 candidates) emits the narrow-the-hint note", async () => {
  // fetch_cap:50 fetches all 50 candidates → the 31st GET crosses the 30/60s
  // object-window boundary and acquireWithWait sleeps one window. Inject a fake
  // clock so that sleep resolves instantly instead of a real ~60s wait.
  const clock = fakeClock();
  const handler = getFind(clock);
  const fifty = Array.from({ length: 50 }, (_, i) => ({ id: `m${i}`, title: "Note", structureId: "meeting" }));
  const objects: Record<string, any> = {};
  for (const c of fifty) objects[c.id] = meetingObj(c.id, {});
  installFind(findRouter({ search: { Note: fifty }, objects }));
  const res = await handler({ structure: "Meeting", title_hint: "Note", fetch_cap: 50 });
  assert.equal(res.isError, undefined);
  assert.deepEqual(clock.sleeps, [60000], "exactly one bounded one-window sleep for the 31st fetch");
  assert.match(res.content[0].text, /returned the maximum 50 candidates/);
});

test("find_objects: fetch_cap below the candidate count emits the fetch-cap note", async () => {
  const handler = getFind();
  installFind(findRouter({
    search: { Note: [
      { id: "m1", title: "Note", structureId: "meeting" },
      { id: "m2", title: "Note", structureId: "meeting" },
      { id: "m3", title: "Note", structureId: "meeting" }
    ] },
    objects: { m1: meetingObj("m1", {}), m2: meetingObj("m2", {}), m3: meetingObj("m3", {}) }
  }));
  const res = await handler({ structure: "Meeting", title_hint: "Note", fetch_cap: 2 });
  assert.equal(res.isError, undefined);
  assert.match(res.content[0].text, /fetched the first 2 of 3 candidates/);
});

test("find_objects: a 429 mid-fetch → fail-open partial results with checked-N-of-M note", async () => {
  const handler = getFind();
  installFind(findRouter({
    search: { Note: [
      { id: "m1", title: "Note", structureId: "meeting" },
      { id: "m2", title: "Note", structureId: "meeting" },
      { id: "m3", title: "Note", structureId: "meeting" }
    ] },
    objects: { m1: meetingObj("m1", {}) },
    getFail: { m2: { status: 429, text: "slow down" } }
  }));
  const res = await handler({ structure: "Meeting", title_hint: "Note" });
  assert.equal(res.isError, undefined, "partial results are NOT an error (fail-open)");
  assert.match(res.content[0].text, /rate budget reached — checked 1 of 3 candidates/);
  assert.match(res.content[0].text, /ID: m1/);
});

test("find_objects: a non-rate read error skips the candidate and still returns the rest", async () => {
  const handler = getFind();
  installFind(findRouter({
    search: { Note: [
      { id: "m1", title: "Note", structureId: "meeting" },
      { id: "m2", title: "Note", structureId: "meeting" }
    ] },
    objects: { m1: meetingObj("m1", {}) },
    getFail: { m2: { status: 500, text: "boom" } }
  }));
  const res = await handler({ structure: "Meeting", title_hint: "Note" });
  assert.equal(res.isError, undefined);
  assert.match(res.content[0].text, /1 candidate\(s\) could not be read and were skipped/);
  assert.match(res.content[0].text, /ID: m1/);
});
