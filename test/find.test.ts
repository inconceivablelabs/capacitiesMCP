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

import { setupFindTools, PAGE_BUDGET_MAX, MAX_REQUESTS_PER_CALL } from "../src/tools/find.js";

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
  assert.match(res.content[0].text, /title_hint must contain at least one letter or digit/);
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

test("find_objects: an escalated seed of 50 with fetch_cap 50 still takes exactly one bounded window sleep", async () => {
  // The 31st GET crosses the 30/60s object window; acquireWithWait sleeps once.
  // Inject a fake clock so that sleep resolves instantly instead of ~60s.
  const clock = fakeClock();
  const handler = getFind(clock);
  const fifty = summaries(1, 50, n => `Note ${n}`);
  installFind(enumRouter({ base: { search: { Note: fifty } }, structurePages: { meeting: pagesOf(fifty) } }));
  const res = await handler({ structure: "Meeting", title_hint: "Note", fetch_cap: 50, sort: { by: "Date", order: "asc" } });
  assert.equal(res.isError, undefined);
  assert.equal(res.structuredContent.seed_method, "search+enumeration", "a raw seed of 50 escalates (M3)");
  assert.deepEqual(clock.sleeps, [60000], "exactly one bounded one-window sleep for the 31st fetch");
  assert.doesNotMatch(res.content[0].text, /returned the maximum 50/);
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
  const res = await handler({ structure: "Meeting", title_hint: "Note", fetch_cap: 2, sort: { by: "Date", order: "asc" } });
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
  const res = await handler({ structure: "Meeting", title_hint: "Note", sort: { by: "Date", order: "asc" } });
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
  const res = await handler({ structure: "Meeting", title_hint: "Note", sort: { by: "Date", order: "asc" } });
  assert.equal(res.isError, undefined);
  assert.match(res.content[0].text, /1 candidate\(s\) could not be read and were skipped/);
  assert.match(res.content[0].text, /ID: m1/);
});

// === cap-1kc: the seed search also returns matches BY MEANING ==============
// POST /objects/search interleaves semantic hits with title matches. find_objects
// must drop them before stage 2, so an extra is never fetched and never answers.
// Synthetic titles only — this repo is public.

// ids handed to GET /object, in call order — asserts on the ARGUMENT, not the output.
function fetchedIds(calls: FCall[]): string[] {
  return calls
    .filter(c => (c.opts?.method ?? "GET") === "GET" && c.url.includes("/object?id="))
    .map(c => decodeURIComponent(c.url.match(/\/object\?id=([^&]+)/)![1]));
}

test("find_objects: semantic extras in the seed are never fetched, never returned, and counted in a note", async () => {
  const handler = getFind();
  const calls = installFind(findRouter({
    search: { "Weekly Roadmap Review": [
      { id: "x1", title: "Team Offsite - 2026-07-10", structureId: "meeting" },          // rank 0 extra
      { id: "m1", title: "Weekly Roadmap Review - 2026-07-07", structureId: "meeting" },
      { id: "x2", title: "Quarterly Planning", structureId: "meeting" },
      { id: "m2", title: "weekly  roadmap/review", structureId: "meeting" }
    ] },
    objects: {
      x1: meetingObj("x1", {}), m1: meetingObj("m1", {}),
      x2: meetingObj("x2", {}), m2: meetingObj("m2", {})
    }
  }));

  const res = await handler({ structure: "Meeting", title_hint: "Weekly Roadmap Review", sort: { by: "Date", order: "asc" } });

  assert.equal(res.isError, undefined);
  assert.deepEqual(fetchedIds(calls), ["m1", "m2"], "only title matches reach stage 2");
  const text = res.content[0].text;
  assert.match(text, /Found 2 Meetings/);
  assert.match(text, /ID: m1/);
  assert.match(text, /ID: m2/);
  assert.doesNotMatch(text, /ID: x1/);
  assert.doesNotMatch(text, /ID: x2/);
  assert.match(text, /2 search result\(s\) were ignored because their titles don't contain "Weekly Roadmap Review"/);
  assert.match(text, /matches by meaning/);
  // Contract with consumers: EVERY "Note:" line means the sweep is incomplete
  // (personal-assistant scripts/backfill_meeting_titles.py _NOTE_RE fails the
  // run on any). Dropping semantic extras is not incompleteness, and this
  // response is otherwise complete — so it must carry no Note: line at all.
  assert.doesNotMatch(text, /^[ \t]*Note:/im, "the dropped-count line must not be a Note:");
});

test("find_objects: sort desc + limit 1 — a newer semantic extra must not win", async () => {
  const handler = getFind();
  const calls = installFind(findRouter({
    search: { "Weekly Roadmap Review": [
      { id: "x1", title: "Staff Meeting - 2026-07-10", structureId: "meeting" },
      { id: "m1", title: "Weekly Roadmap Review", structureId: "meeting" },
      { id: "m2", title: "Weekly Roadmap Review", structureId: "meeting" }
    ] },
    objects: {
      x1: meetingObj("x1", { date: dateProp("2026-07-10T15:00:00.000Z") }), // newest — but not a title match
      m1: meetingObj("m1", { date: dateProp("2026-07-07T15:00:00.000Z") }),
      m2: meetingObj("m2", { date: dateProp("2026-06-30T15:00:00.000Z") })
    }
  }));
  const res = await handler({
    structure: "Meeting", title_hint: "Weekly Roadmap Review",
    filters: { Date: { before: "2026-07-13" } }, sort: { by: "Date", order: "desc" }, limit: 1
  });
  assert.equal(res.isError, undefined);
  assert.equal(fetchedIds(calls).includes("x1"), false, "the extra is never fetched");
  assert.match(res.content[0].text, /ID: m1/);
  assert.doesNotMatch(res.content[0].text, /ID: x1/);
});

test("find_objects: fetch_cap and candidate counts are over the title matches, not the raw seed", async () => {
  const handler = getFind();
  const calls = installFind(findRouter({
    search: { Note: [
      { id: "x1", title: "Journal", structureId: "meeting" },
      { id: "m1", title: "Note A", structureId: "meeting" },
      { id: "x2", title: "Diary", structureId: "meeting" },
      { id: "m2", title: "Note B", structureId: "meeting" },
      { id: "m3", title: "Note C", structureId: "meeting" }
    ] }
  }));
  const res = await handler({ structure: "Meeting", title_hint: "Note", fetch_cap: 2, sort: { by: "Date", order: "asc" } });
  assert.equal(res.isError, undefined);
  assert.deepEqual(fetchedIds(calls), ["m1", "m2"]);
  assert.match(res.content[0].text, /fetched the first 2 of 3 candidates/);
});

test("find_objects: no title matches and the seed was NOT truncated → the existing not-found text, nothing fetched", async () => {
  const handler = getFind();
  const calls = installFind(findRouter({
    search: { "Weekly Roadmap Review": [
      { id: "x1", title: "Quarterly Planning", structureId: "meeting" },
      { id: "x2", title: "Team Offsite", structureId: "meeting" }
    ] }
  }));
  const res = await handler({ structure: "Meeting", title_hint: "Weekly Roadmap Review" });
  assert.equal(res.isError, undefined);
  assert.deepEqual(fetchedIds(calls), []);
  assert.match(res.content[0].text, /No Meetings found with a title matching "Weekly Roadmap Review"/);
});

test("find_objects: a saturated seed with ZERO title matches escalates — matches beyond the cap are found (U8/U9)", async () => {
  const extras = summaries(1001, 1050, n => `Related Thing ${n}`);
  const listing = [...summaries(1, 118, n => `Standup ${n}`),
    { id: uid(119), title: "Roadmap Sync", structureId: "meeting" },
    { id: uid(120), title: "roadmap/planning", structureId: "meeting" }];
  let handler = getFind();
  let calls = installFind(enumRouter({ base: { search: { Roadmap: extras } }, structurePages: { meeting: pagesOf(listing) } }));
  let res = await handler({ structure: "Meeting", title_hint: "Roadmap", sort: SORT_DATE_DESC });
  assert.equal(res.isError, undefined);
  assert.equal(enumCalls(calls).length, 2);
  let text = res.content[0].text;
  assert.match(text, /^Found 2 Meetings matching "Roadmap"/);
  assert.ok(text.includes(`ID: ${uid(119)}`) && text.includes(`ID: ${uid(120)}`));
  assert.doesNotMatch(text, /may exist beyond/);

  // A COMPLETE enumeration with zero matches is a genuine none.
  handler = getFind();
  calls = installFind(enumRouter({ base: { search: { Roadmap: extras } }, structurePages: { meeting: pagesOf(summaries(1, 118, n => `Standup ${n}`)) } }));
  res = await handler({ structure: "Meeting", title_hint: "Roadmap" });
  text = res.content[0].text;
  assert.match(text, /^No Meetings found with a title matching "Roadmap"/);
  assert.doesNotMatch(text, /^[ \t]*Note:/im);
  assert.equal(res.structuredContent.seed_complete, true);
});

test("find_objects: an all-punctuation title_hint is an error before any network call (U5)", async () => {
  const handler = getFind();
  const calls = installFind(findRouter({ search: { "///": [{ id: "m1", title: "Alpha", structureId: "meeting" }] } }));
  const res = await handler({ structure: "Meeting", title_hint: "///" });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /title_hint must contain at least one letter or digit/);
  assert.equal(calls.length, 0);
});

test("find_objects: the description says results are limited to titles containing title_hint", () => {
  const tools: Record<string, any> = {};
  const server: any = { registerTool(name: string, config: any, handler: any) { tools[name] = { name, config, handler }; } };
  setupFindTools(server, findClient());
  assert.match(tools["find_objects"].config.description, /limited to objects whose title contains `title_hint`/);
});

// === cap-i93: enumeration seeds ============================================
// Synthetic, spec-shaped data only — this repo is public.

const SPEC_UUID = /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/;
function uid(n: number): string { return `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`; }
const TAG_PRODUCT = uid(0xa0001);
const SORT_DATE_DESC = { by: "Date", order: "desc" as const };
interface Summary { id: string; title: string; structureId: string; }
function summaries(from: number, to: number, title: (n: number) => string, structureId = "meeting"): Summary[] {
  const out: Summary[] = [];
  for (let n = from; n <= to; n++) out.push({ id: uid(n), title: title(n), structureId });
  return out;
}
type PageSpec =
  | { results: Summary[]; nextCursor: string | null; hasMore: boolean }
  | { fail: { status: number; text: string } }
  | { html: string };
// Keyset pages: nextCursor is the page's last id (design fact 4); the last page has hasMore:false.
function pagesOf(all: Summary[], size = 100): PageSpec[] {
  const out: PageSpec[] = [];
  for (let i = 0; i < all.length; i += size) {
    const results = all.slice(i, i + size);
    const hasMore = i + size < all.length;
    out.push({ results, hasMore, nextCursor: hasMore ? results[results.length - 1].id : null });
  }
  return out.length ? out : [{ results: [], hasMore: false, nextCursor: null }];
}
// Routes /objects/structure and /objects/tag, delegating everything else to
// findRouter. STRICT like the real API (global rule 8q): unknown params, a
// pageSize other than 100, a non-UUID tag id or cursor, and an unknown cursor are
// 400s. An unregistered id is 200-empty, as the real API answers a bogus id
// (design fact 3). Structure ids are not UUID-checked: the fixtures use "meeting".
function enumRouter(opts: {
  base?: Parameters<typeof findRouter>[0];
  structurePages?: Record<string, PageSpec[]>;
  tagPages?: Record<string, PageSpec[]>;
}) {
  const fallback = findRouter(opts.base ?? {});
  return (call: FCall) => {
    const u = new URL(call.url);
    const kind = u.pathname === "/objects/structure" ? "structure" : u.pathname === "/objects/tag" ? "tag" : null;
    if (!kind) return fallback(call);
    const bad = (why: string) => fRouteResp({ ok: false, status: 400, text: why });
    if ((call.opts?.method ?? "GET") !== "GET") return bad("method");
    for (const k of u.searchParams.keys()) if (!["id", "cursor", "pageSize"].includes(k)) return bad(`unknown param ${k}`);
    if (u.searchParams.get("pageSize") !== "100") return bad("pageSize must be pinned at 100");
    const id = u.searchParams.get("id") ?? "";
    if (kind === "tag" && !SPEC_UUID.test(id)) return bad("tag id must be a UUID");
    const cursor = u.searchParams.get("cursor");
    if (cursor !== null && !SPEC_UUID.test(cursor)) return bad("cursor must be a UUID");
    const pages = (kind === "structure" ? opts.structurePages : opts.tagPages)?.[id];
    if (!pages) return fRouteResp({ body: { results: [], nextCursor: null, hasMore: false } });
    let idx = 0;
    if (cursor !== null) {
      idx = pages.findIndex((_p, i) => i > 0 && (pages[i - 1] as any).nextCursor === cursor);
      if (idx < 0) return bad(`unknown cursor ${cursor}`);
    }
    const page = pages[idx];
    if ("fail" in page) return fRouteResp({ ok: false, status: page.fail.status, text: page.fail.text });
    if ("html" in page) return fRouteResp({ contentType: "text/html", text: page.html });
    return fRouteResp({ body: page });
  };
}
function enumCalls(calls: FCall[]): string[] {
  return calls.map(c => c.url).filter(u => /\/objects\/(structure|tag)\?/.test(u));
}
function searchQueries(calls: FCall[]): string[] {
  return calls.filter(c => c.url.endsWith("/objects/search")).map(c => JSON.parse(c.opts.body).query);
}
function findHarness(clock?: { now: () => number; sleep: (ms: number) => Promise<void> }) {
  const tools: Record<string, any> = {};
  const server: any = { registerTool(name: string, config: any, handler: any) { tools[name] = { name, config, handler }; } };
  const client: any = new CapacitiesClient({
    apiToken: "t", baseUrl: "https://api.capacities.io",
    ...(clock ? { now: clock.now, sleep: clock.sleep } : {})
  });
  setupFindTools(server, client);
  return { handler: tools["find_objects"].handler, client, config: tools["find_objects"].config };
}

test("find_objects: a title_hint with no letters or digits is an error before ANY network call — title and tag+title shapes", async () => {
  for (const hint of ["///", "()", "—", "", "   ", " -- : "]) {
    for (const extra of [{}, { tag: "product" }]) {
      const handler = getFind();
      const calls = installFind(findRouter({}));
      const res = await handler({ structure: "Meeting", title_hint: hint, ...extra });
      const label = `${JSON.stringify(hint)} ${JSON.stringify(extra)}`;
      assert.equal(res.isError, true, label);
      assert.match(res.content[0].text, /title_hint must contain at least one letter or digit/, label);
      assert.equal(calls.length, 0, `${label}: no network call of any kind`);
    }
  }
});

test("find_objects: a non-Latin title_hint is accepted and filters normally (U1 known-positive)", async () => {
  const handler = getFind();
  const calls = installFind(findRouter({ search: { "会議": [
    { id: "m1", title: "週次会議", structureId: "meeting" },
    { id: "x1", title: "Quarterly Planning", structureId: "meeting" }
  ] } }));
  const res = await handler({ structure: "Meeting", title_hint: "会議", sort: SORT_DATE_DESC });
  assert.equal(res.isError, undefined);
  assert.deepEqual(fetchedIds(calls), ["m1"]);
  assert.match(res.content[0].text, /Found 1 Meetings matching "会議"/);
});

test("find_objects: title_hint over 512 characters errors before any call on BOTH shapes; 512 is accepted", async () => {
  for (const extra of [{}, { tag: "product" }]) {
    const handler = getFind();
    const calls = installFind(findRouter({}));
    const res = await handler({ structure: "Meeting", title_hint: "a".repeat(513), ...extra });
    assert.equal(res.isError, true, JSON.stringify(extra));
    assert.match(res.content[0].text, /title_hint is 513 characters; the maximum is 512/);
    assert.equal(calls.length, 0);
  }
  const handler = getFind();
  const calls = installFind(findRouter({}));
  const res = await handler({ structure: "Meeting", title_hint: "a".repeat(512) });
  assert.equal(res.isError, undefined, "512 is within the spec's maxLength");
  assert.equal(searchQueries(calls).length, 1, "the 512-character hint reached the seed search");
});

test("find_objects: a blank tag is an error before any network call", async () => {
  const handler = getFind();
  const calls = installFind(findRouter({}));
  const res = await handler({ structure: "Meeting", tag: "  " });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /tag must be a non-empty tag name/);
  assert.equal(calls.length, 0);
});

test("find_objects schema: page_budget 1..25 default 12; title_hint optional, max 512, needs a letter or digit; tag optional; budget < enumerate bucket", () => {
  const { config, client } = findHarness();
  const s = config.inputSchema;
  assert.equal(s.page_budget.safeParse(26).success, false);
  assert.equal(s.page_budget.safeParse(0).success, false);
  assert.equal(s.page_budget.safeParse(25).success, true);
  assert.equal(s.page_budget.parse(undefined), 12);
  assert.equal(s.title_hint.safeParse(undefined).success, true);
  assert.equal(s.title_hint.safeParse("x".repeat(513)).success, false);
  assert.equal(s.title_hint.safeParse("x".repeat(512)).success, true);
  assert.equal(s.tag.safeParse(undefined).success, true);
  assert.equal(s.structure.safeParse(undefined).success, false, "structure stays required (QA A12)");
  // U5: the LLM reads the rule from the parameter description (S-M2: lands with the guard).
  assert.match(s.title_hint.description, /letter or digit/);
  assert.doesNotMatch(s.title_hint.description, /REQUIRED/);
  // One call can never exhaust its own enumerate bucket — the premise of the
  // non-waiting enumeration budget (design § Rate limiting; 08-21 QA row E4).
  assert.ok(PAGE_BUDGET_MAX < client.rateLimiter.limits.enumerate.maxRequests);
});

test("find_objects: no title_hint and no tag lists the structure — header has no 'undefined', flags complete", async () => {
  const handler = getFind();
  const calls = installFind(enumRouter({ structurePages: { meeting: pagesOf(summaries(1, 3, n => `Kickoff ${n}`)) } }));
  const res = await handler({ structure: "Meeting", sort: SORT_DATE_DESC });
  assert.equal(res.isError, undefined);
  const text = res.content[0].text;
  assert.match(text, /^Found 3 Meetings \(live as of /);
  assert.doesNotMatch(text, /undefined/);
  assert.equal(enumCalls(calls).length, 1);
  const u = new URL(enumCalls(calls)[0]);
  assert.equal(u.pathname, "/objects/structure");
  assert.equal(u.searchParams.get("id"), "meeting");
  assert.deepEqual(searchQueries(calls), [], "no title search on the no-seed shape");
  assert.equal(res.structuredContent.seed_method, "structure-enumeration");
  assert.equal(res.structuredContent.seed_complete, true);
  assert.equal(res.structuredContent.seed_size, 3);
});

test("find_objects: page budget exhausted → stage-1 Note without the stage-2 count phrase; seed incomplete", async () => {
  const handler = getFind();
  const calls = installFind(enumRouter({ structurePages: { meeting: pagesOf(summaries(1, 250, n => `Kickoff ${n}`)) } }));
  const res = await handler({ structure: "Meeting", page_budget: 2 });
  assert.equal(res.isError, undefined);
  assert.equal(enumCalls(calls).length, 2);
  const text = res.content[0].text;
  assert.match(text, /^Note: listing stopped at the page budget — read 2 pages \(200 summaries\) and more remain/m);
  assert.doesNotMatch(text, /checked\s+\d+\s+of\s+\d+\s+candidates/i, "stage-1 counts never use the stage-2 phrase (U6)");
  assert.equal(res.structuredContent.seed_complete, false);
  assert.equal(res.structuredContent.seed_size, 200);
});

test("find_objects: a resolved structure that enumerates to [] is a genuine none", async () => {
  const handler = getFind();
  installFind(enumRouter({ structurePages: { meeting: pagesOf([]) } }));
  const res = await handler({ structure: "Meeting" });
  assert.equal(res.isError, undefined);
  assert.match(res.content[0].text, /^No Meetings found \(live as of /);
  assert.equal(res.structuredContent.seed_complete, true);
  assert.equal(res.structuredContent.returned, 0);
});

test("find_objects: a 429 on page 1 is PARTIAL, never 'No … found' (rate-stop poisons exactness)", async () => {
  const handler = getFind();
  installFind(enumRouter({ structurePages: { meeting: [{ fail: { status: 429, text: "<!doctype html>banned" } }] } }));
  const res = await handler({ structure: "Meeting" });
  assert.equal(res.isError, undefined, "fail-open: partial, not an error");
  const text = res.content[0].text;
  assert.doesNotMatch(text, /No Meetings found/);
  assert.match(text, /^Note: rate limit reached while listing — read 0 page\(s\) before stopping/m);
  assert.equal(res.structuredContent.seed_complete, false);
});

test("find_objects: a non-JSON page (HTML 200) is PARTIAL, never 'No … found'", async () => {
  const handler = getFind();
  const calls = installFind(enumRouter({ structurePages: { meeting: [{ html: "<!doctype html><title>Just a moment</title>" }] } }));
  const res = await handler({ structure: "Meeting" });
  assert.equal(res.isError, undefined);
  const text = res.content[0].text;
  assert.doesNotMatch(text, /No Meetings found/);
  assert.match(text, /^Note: listing stopped after 0 page\(s\) because a page could not be read/m);
  assert.equal(enumCalls(calls).length, 1);
  assert.equal(res.structuredContent.seed_complete, false);
});

test("find_objects: tag only — resolves the NAME by a RootTag-scoped search, enumerates the tag, keeps only this structure", async () => {
  const handler = getFind();
  const tagged: Summary[] = [
    { id: uid(1), title: "Roadmap Sync", structureId: "meeting" },
    { id: uid(2), title: "Product brief", structureId: "RootPage" },
    { id: uid(3), title: "Pricing Review", structureId: "meeting" }
  ];
  const calls = installFind(enumRouter({
    base: { search: { product: [{ id: TAG_PRODUCT, title: "product", structureId: "RootTag" }] } },
    tagPages: { [TAG_PRODUCT]: pagesOf(tagged) }
  }));
  const res = await handler({ structure: "Meeting", tag: "product", sort: SORT_DATE_DESC });
  assert.equal(res.isError, undefined);
  const tagSearch = calls.find(c => c.url.endsWith("/objects/search"))!;
  assert.deepEqual(JSON.parse(tagSearch.opts.body).structureIds, ["RootTag"], "tag names resolve against tags only (08-21 QA F3)");
  const u = new URL(enumCalls(calls)[0]);
  assert.equal(u.pathname, "/objects/tag");
  assert.equal(u.searchParams.get("id"), TAG_PRODUCT);
  const text = res.content[0].text;
  assert.match(text, /^Found 2 Meetings tagged "product" \(live as of /);
  assert.ok(text.includes(`ID: ${uid(1)}`) && text.includes(`ID: ${uid(3)}`));
  assert.ok(!text.includes(`ID: ${uid(2)}`), "a tagged Page is not a Meeting");
  assert.equal(res.structuredContent.seed_method, "tag-enumeration");
});

test("find_objects: tag + title filters the tag listing client-side and issues NO title search", async () => {
  const handler = getFind();
  const tagged: Summary[] = [
    { id: uid(1), title: "Roadmap Sync", structureId: "meeting" },
    { id: uid(3), title: "Pricing Review", structureId: "meeting" },
    { id: uid(4), title: "roadmap/planning", structureId: "meeting" }
  ];
  const calls = installFind(enumRouter({
    base: { search: { product: [{ id: TAG_PRODUCT, title: "product", structureId: "RootTag" }] } },
    tagPages: { [TAG_PRODUCT]: pagesOf(tagged) }
  }));
  const res = await handler({ structure: "Meeting", tag: "product", title_hint: "roadmap", sort: SORT_DATE_DESC });
  assert.equal(res.isError, undefined);
  assert.deepEqual(searchQueries(calls), ["product"], "only the tag-name resolution searches");
  const text = res.content[0].text;
  assert.match(text, /^Found 2 Meetings tagged "product" with a title matching "roadmap" \(live as of /);
  assert.ok(text.includes(`ID: ${uid(1)}`) && text.includes(`ID: ${uid(4)}`));
  assert.ok(!text.includes(`ID: ${uid(3)}`));
  assert.equal(res.structuredContent.seed_method, "tag-enumeration");
});

test("find_objects: unknown / ambiguous / truncated tag each error distinctly and issue NO enumeration call", async () => {
  const cases: [string, any[], RegExp][] = [
    ["unknown", [], /no tag named "product"/],
    ["ambiguous", [
      { id: TAG_PRODUCT, title: "product", structureId: "RootTag" },
      { id: uid(0xa0002), title: "Product", structureId: "RootTag" }
    ], /tag "product" is ambiguous/],
    ["truncated", Array.from({ length: 50 }, (_, i) => ({ id: uid(0xb000 + i), title: `product launch ${i}`, structureId: "RootTag" })),
      /could not confirm the tag "product"/]
  ];
  for (const [name, results, re] of cases) {
    const handler = getFind();
    const calls = installFind(enumRouter({ base: { search: { product: results } } }));
    const res = await handler({ structure: "Meeting", tag: "product" });
    assert.equal(res.isError, true, name);
    assert.match(res.content[0].text, re, name);
    assert.equal(enumCalls(calls).length, 0, `${name}: no enumeration call`);
    if (name === "truncated") assert.doesNotMatch(res.content[0].text, /no tag named/, "truncated is not 'not found'");
    if (name === "ambiguous") assert.ok(res.content[0].text.includes(TAG_PRODUCT) && res.content[0].text.includes(uid(0xa0002)));
  }
});

test("find_objects: a tag search of 50 results that DOES contain the exact name resolves (truncated near-miss control)", async () => {
  const handler = getFind();
  const fifty = Array.from({ length: 49 }, (_, i) => ({ id: uid(0xb000 + i), title: `product launch ${i}`, structureId: "RootTag" }));
  fifty.push({ id: TAG_PRODUCT, title: "product", structureId: "RootTag" });
  const calls = installFind(enumRouter({ base: { search: { product: fifty } }, tagPages: { [TAG_PRODUCT]: pagesOf([]) } }));
  const res = await handler({ structure: "Meeting", tag: "product" });
  assert.equal(res.isError, undefined);
  assert.equal(enumCalls(calls).length, 1);
});

test("find_objects: a tag that resolves to a non-UUID id is an error and is never sent to /objects/tag", async () => {
  const handler = getFind();
  const calls = installFind(enumRouter({ base: { search: { product: [{ id: "tag-product", title: "product", structureId: "RootTag" }] } } }));
  const res = await handler({ structure: "Meeting", tag: "product" });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /resolved to "tag-product", which is not a valid tag id/);
  assert.equal(enumCalls(calls).length, 0);
});

test("find_objects: a resolved tag with no objects is a genuine none; the tag path is page-budgeted too", async () => {
  let handler = getFind();
  installFind(enumRouter({
    base: { search: { product: [{ id: TAG_PRODUCT, title: "product", structureId: "RootTag" }] } },
    tagPages: { [TAG_PRODUCT]: pagesOf([]) }
  }));
  let res = await handler({ structure: "Meeting", tag: "product" });
  assert.match(res.content[0].text, /^No Meetings found tagged "product" \(live as of /);
  assert.equal(res.structuredContent.seed_complete, true);

  handler = getFind();
  const calls = installFind(enumRouter({
    base: { search: { product: [{ id: TAG_PRODUCT, title: "product", structureId: "RootTag" }] } },
    tagPages: { [TAG_PRODUCT]: pagesOf(summaries(1, 250, n => `Tagged ${n}`)) }
  }));
  res = await handler({ structure: "Meeting", tag: "product", page_budget: 2 });
  assert.equal(enumCalls(calls).length, 2);
  assert.match(res.content[0].text, /^Note: listing stopped at the page budget/m);
  assert.equal(res.structuredContent.seed_complete, false);
});

test("find_objects: seed_complete and candidates_complete are independent — a complete seed over a truncated fetch", async () => {
  const handler = getFind();
  const three = [1, 2, 3].map(n => ({ id: `m${n}`, title: "Note", structureId: "meeting" }));
  installFind(findRouter({ search: { Note: three } }));
  let res = await handler({ structure: "Meeting", title_hint: "Note", fetch_cap: 2, sort: SORT_DATE_DESC });
  assert.deepEqual(
    { ...res.structuredContent },
    { seed_method: "search", seed_complete: true, candidates_complete: false, seed_size: 3, considered: 2, errored: 0, matched: 2, returned: 2 }
  );
  // Known-positive: the same call with room to fetch everything is complete on both axes.
  installFind(findRouter({ search: { Note: three } }));
  res = await handler({ structure: "Meeting", title_hint: "Note", fetch_cap: 30, sort: SORT_DATE_DESC });
  assert.equal(res.structuredContent.candidates_complete, true);
  assert.equal(res.structuredContent.considered, 3);
});

test("find_objects: a candidate that errors in stage 2 makes candidates_complete false", async () => {
  const handler = getFind();
  installFind(findRouter({
    search: { Note: [{ id: "m1", title: "Note", structureId: "meeting" }, { id: "m2", title: "Note", structureId: "meeting" }] },
    getFail: { m2: { status: 404, text: "gone" } }
  }));
  const res = await handler({ structure: "Meeting", title_hint: "Note", sort: SORT_DATE_DESC });
  assert.equal(res.structuredContent.candidates_complete, false);
  assert.equal(res.structuredContent.errored, 1);
  assert.equal(res.structuredContent.considered, 2, "considered counts the errored one");
});

// === cap-i93 Task 5 fix round ===============================================

// Page 1 of `n` structure rows (hasMore, cursor = last id), then `fail` on page 2.
function onePageThenFail(n: number, fail: { status: number; text: string }): PageSpec[] {
  const rows = summaries(1, n, k => `Kickoff ${k}`);
  return [{ results: rows, hasMore: true, nextCursor: rows[rows.length - 1].id }, { fail }];
}

test("find_objects: a listing error Note carries only the first line of the error, capped — never the whole HTTP body (I1)", async () => {
  const later = "<title>LATER-LINE-MARKER</title>";
  const bodies = [
    // Long first line: the cap must cut it.
    `<!doctype html><html><head>${"x".repeat(300)}\n${later}\n${"<p>filler</p>\n".repeat(40)}`,
    // Short first line: only the line split keeps the later lines out.
    `<!doctype html>\n${later}\n${"<p>filler</p>\n".repeat(40)}`
  ];
  for (const text of bodies) {
    assert.ok(text.length > 200 && text.includes("\n"), "fixture: a long multi-line body");
    const handler = getFind();
    installFind(enumRouter({ structurePages: { meeting: onePageThenFail(3, { status: 503, text }) } }));
    const res = await handler({ structure: "Meeting" });
    assert.equal(res.isError, undefined);
    const note = res.content[0].text.split("\n").find((l: string) => l.startsWith("Note: listing stopped after"));
    assert.ok(note, "the stage-1 error Note is present");
    // The detail is capped at 200 chars (+ "…"); the sentence around it adds ~100.
    const detail = note.match(/could not be read \((.*)\); results may be incomplete\.$/)?.[1] ?? "";
    assert.ok(detail.startsWith("API error 503"), `detail: ${detail.slice(0, 40)}`);
    assert.ok(detail.length <= 201, `detail is ${detail.length} chars`);
    assert.ok(note.length < 320, `Note is ${note.length} chars`);
    assert.match(note, /503/, "the status survives");
    assert.match(note, /; results may be incomplete\.$/, "the sentence still closes on one line");
    assert.ok(!res.content[0].text.includes("LATER-LINE-MARKER"), "no later line of the body reaches the output");
  }
});

test("find_objects: a stage-2 rate stop makes candidates_complete false (I2)", async () => {
  const handler = getFind();
  installFind(findRouter({
    search: { Note: [1, 2, 3].map(n => ({ id: `m${n}`, title: "Note", structureId: "meeting" })) },
    getFail: { m2: { status: 429, text: "slow down" } }
  }));
  const res = await handler({ structure: "Meeting", title_hint: "Note", sort: SORT_DATE_DESC });
  assert.equal(res.isError, undefined);
  assert.match(res.content[0].text, /^Note: rate budget reached — checked 1 of 3 candidates/m);
  assert.equal(res.structuredContent.candidates_complete, false);
  assert.equal(res.structuredContent.considered, 1);
  assert.equal(res.structuredContent.seed_size, 3);
});

test("find_objects: a listing that fails on page 2 keeps and shows page 1's rows (M1)", async () => {
  const handler = getFind();
  installFind(enumRouter({ structurePages: { meeting: onePageThenFail(10, { status: 500, text: "boom" }) } }));
  const res = await handler({ structure: "Meeting" });
  assert.equal(res.isError, undefined);
  const text = res.content[0].text;
  for (let n = 1; n <= 10; n++) assert.ok(text.includes(`ID: ${uid(n)}`), `row ${n} shown`);
  assert.match(text, /^Note: listing stopped after 1 page\(s\) because a page could not be read/m);
  assert.equal(res.structuredContent.seed_complete, false);
  assert.equal(res.structuredContent.seed_size, 10);
});

test("find_objects: a tag over 512 characters errors before any call; 512 passes the guard (M2)", async () => {
  let handler = getFind();
  let calls = installFind(findRouter({}));
  let res = await handler({ structure: "Meeting", tag: "t".repeat(513) });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /tag is 513 characters; the maximum is 512/);
  assert.equal(calls.length, 0);

  // 512 reaches tag resolution (and then fails as an unknown tag — a later, networked error).
  handler = getFind();
  calls = installFind(findRouter({}));
  res = await handler({ structure: "Meeting", tag: "t".repeat(512) });
  assert.doesNotMatch(res.content[0].text, /the maximum is 512/);
  assert.match(res.content[0].text, /no tag named/);
  assert.equal(searchQueries(calls).length, 1, "the 512-character tag reached the tag search");
});

test("find_objects: a RAW seed of 49 does not escalate; 50 does (>=, judged before title filtering)", async () => {
  const listing = summaries(1, 60, n => `Retro ${n}`);
  let handler = getFind();
  let calls = installFind(enumRouter({ base: { search: { Retro: listing.slice(0, 49) } }, structurePages: { meeting: pagesOf(listing) } }));
  let res = await handler({ structure: "Meeting", title_hint: "Retro", sort: SORT_DATE_DESC });
  assert.equal(enumCalls(calls).length, 0, "49 is an exact seed");
  assert.equal(res.structuredContent.seed_method, "search");
  assert.equal(res.structuredContent.seed_size, 49);

  handler = getFind();
  calls = installFind(enumRouter({ base: { search: { Retro: listing.slice(0, 50) } }, structurePages: { meeting: pagesOf(listing) } }));
  res = await handler({ structure: "Meeting", title_hint: "Retro", sort: SORT_DATE_DESC });
  assert.equal(enumCalls(calls).length, 1, "50 escalates");
  assert.equal(res.structuredContent.seed_method, "search+enumeration");
  assert.equal(res.structuredContent.seed_size, 60);
  assert.equal(res.structuredContent.seed_complete, true);
});

test("find_objects: a COMPLETED escalation emits no Note, says it listed instead, and drops the semantic-extras line", async () => {
  const handler = getFind();
  const search = [...summaries(1, 20, n => `Retro ${n}`), ...summaries(1001, 1030, n => `Planning ${n}`)]; // 50 raw, 20 title matches
  const listing = [...summaries(1, 25, n => `Retro ${n}`), ...summaries(26, 35, n => `Other ${n}`)];
  installFind(enumRouter({ base: { search: { Retro: search } }, structurePages: { meeting: pagesOf(listing) } }));
  const res = await handler({ structure: "Meeting", title_hint: "Retro" });
  assert.equal(res.isError, undefined);
  const text = res.content[0].text;
  assert.match(text, /^Found 25 Meetings matching "Retro"/);
  assert.match(text, /^\(The title search returned its 50-result maximum, so the Meetings were listed instead: 1 page\(s\), 35 summaries\.\)$/m);
  assert.doesNotMatch(text, /^[ \t]*Note:/im, "a completed escalation is complete (U8, mutation x)");
  assert.doesNotMatch(text, /were ignored/, "the dropped-count line belongs to the search path only (U8)");
  assert.equal(res.structuredContent.seed_complete, true);
});

test("find_objects: an escalation that hits the page budget is partial with a stage-1 Note", async () => {
  const handler = getFind();
  const listing = summaries(1, 250, n => `Retro ${n}`);
  installFind(enumRouter({ base: { search: { Retro: listing.slice(0, 50) } }, structurePages: { meeting: pagesOf(listing) } }));
  const res = await handler({ structure: "Meeting", title_hint: "Retro", page_budget: 2 });
  assert.match(res.content[0].text, /^Note: listing stopped at the page budget — read 2 pages \(200 summaries\)/m);
  assert.equal(res.structuredContent.seed_complete, false);
  assert.equal(res.structuredContent.seed_size, 200);
});

async function captureStderr<T>(fn: () => Promise<T>): Promise<{ value: T; lines: string[] }> {
  const original = console.error;
  const lines: string[] = [];
  console.error = (...args: unknown[]) => { lines.push(args.map(String).join(" ")); };
  try { return { value: await fn(), lines }; } finally { console.error = original; }
}

test("find_objects canary (U4): a completed escalation logs ONE stderr line naming every missing title-match id (ids only, no extras); a partial one logs nothing", async () => {
  // 50 raw hits saturate the search: 20 title matches ("Retro n") + 30 semantic extras ("Planning n").
  const search = [...summaries(1, 20, n => `Retro ${n}`), ...summaries(1001, 1030, n => `Planning ${n}`)];
  // Completed listing holds Retro 3..25: uid(1) and uid(2) are title matches it lacks. The
  // extras are absent from it too, but they are not title matches, so they are not missing.
  let handler = getFind();
  installFind(enumRouter({ base: { search: { Retro: search } }, structurePages: { meeting: pagesOf(summaries(3, 25, n => `Retro ${n}`)) } }));
  const stdout: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => { stdout.push(args.map(String).join(" ")); };
  let done: { value: any; lines: string[] };
  try { done = await captureStderr<any>(() => handler({ structure: "Meeting", title_hint: "Retro" })); }
  finally { console.log = originalLog; }
  assert.equal(done.lines.length, 1, "exactly ONE canary line, however many ids are missing");
  assert.ok(done.lines[0].includes(uid(1)) && done.lines[0].includes(uid(2)), "names every missing id");
  assert.ok(!done.lines[0].includes(uid(1001)), "a semantic extra is not a missing title match");
  assert.doesNotMatch(done.lines[0], /Retro|Planning/, "ids only — titles stay out of gateway logs (D6)");
  assert.deepEqual(stdout, [], "never console.log — stdout is the MCP stdio channel (U4)");
  assert.doesNotMatch(done.value.content[0].text, /^[ \t]*Note:/im, "the canary never adds a Note");
  assert.equal(done.value.isError, undefined, "and never fails the call");

  // Partial (page budget 1 of 2): the same gap must NOT fire.
  handler = getFind();
  installFind(enumRouter({ base: { search: { Retro: search } }, structurePages: { meeting: pagesOf(summaries(3, 150, n => `Retro ${n}`)) } }));
  const partial = await captureStderr<any>(() => handler({ structure: "Meeting", title_hint: "Retro", page_budget: 1 }));
  assert.deepEqual(partial.lines, [], "an incomplete listing is not evidence of a missing id (mutation xi)");
});

test("find_objects canary (U4): silent on a rate-stopped and on an unreadable listing — only a COMPLETED listing is evidence", async () => {
  const search = [...summaries(1, 20, n => `Retro ${n}`), ...summaries(1001, 1030, n => `Planning ${n}`)];
  // [name, pages, pages read]: the info line must report pages READ, not requests
  // issued — each stop below issues 1 request (M1).
  const stops: [string, PageSpec[], number][] = [
    ["429 on page 1", [{ fail: { status: 429, text: "<!doctype html>banned" } }], 0],
    ["HTML 200 on page 1", [{ html: "<!doctype html><title>Just a moment</title>" }], 0],
    // Retro 11..20 look missing; a gate listing stop reasons can forget "no-cursor" (M2).
    ["no cursor after page 1", [{ results: summaries(1, 10, n => `Retro ${n}`), hasMore: true, nextCursor: null }], 1]
  ];
  for (const [name, pages, pagesRead] of stops) {
    const handler = getFind();
    installFind(enumRouter({ base: { search: { Retro: search } }, structurePages: { meeting: pages } }));
    const r = await captureStderr<any>(() => handler({ structure: "Meeting", title_hint: "Retro" }));
    assert.equal(r.value.structuredContent.seed_complete, false, `${name}: the listing really was partial`);
    assert.match(r.value.content[0].text, new RegExp(`^\\(The title search returned its 50-result maximum, so the Meetings were listed instead: ${pagesRead} page\\(s\\), `, "m"), `${name}: pages read`);
    assert.deepEqual(r.lines, [], `${name}: all 20 title matches look missing here, and none may be reported`);
  }
});

test("find_objects: an ESCALATED title search whose partial listing has zero matches is partial, never 'No … found'", async () => {
  const handler = getFind();
  const extras = summaries(1001, 1050, n => `Related Thing ${n}`);
  installFind(enumRouter({ base: { search: { Roadmap: extras } }, structurePages: { meeting: pagesOf(summaries(1, 150, n => `Standup ${n}`)) } }));
  const res = await handler({ structure: "Meeting", title_hint: "Roadmap", page_budget: 1 });
  assert.equal(res.isError, undefined);
  const text = res.content[0].text;
  assert.doesNotMatch(text, /No Meetings found/);
  assert.match(text, /^Found 0 Meetings matching "Roadmap"/);
  assert.match(text, /^\(no matching Meetings in the part of the listing that was read\)$/m);
  assert.match(text, /^Note: listing stopped at the page budget — read 1 pages \(100 summaries\)/m);
  assert.equal(res.structuredContent.seed_method, "search+enumeration");
  assert.equal(res.structuredContent.seed_complete, false);
});

test("find_objects: every title-filtering path uses the shared matcher — an accented title meets an unaccented hint on all three paths (U2, QA B6)", async () => {
  const cafe = { id: uid(7), title: "Café Review", structureId: "meeting" };
  const found: Record<string, boolean> = {};
  // Title-only search path.
  let handler = getFind();
  installFind(enumRouter({ base: { search: { cafe: [cafe] } } }));
  let res = await handler({ structure: "Meeting", title_hint: "cafe" });
  found.search = res.content[0].text.includes(`ID: ${uid(7)}`);
  // Escalated path: 50 semantic extras saturate the search; only the listing holds the accented title.
  handler = getFind();
  installFind(enumRouter({ base: { search: { cafe: summaries(1001, 1050, n => `Espresso ${n}`) } }, structurePages: { meeting: pagesOf([cafe]) } }));
  res = await handler({ structure: "Meeting", title_hint: "cafe" });
  found.escalated = res.content[0].text.includes(`ID: ${uid(7)}`);
  // tag + title path.
  handler = getFind();
  installFind(enumRouter({
    base: { search: { product: [{ id: TAG_PRODUCT, title: "product", structureId: "RootTag" }] } },
    tagPages: { [TAG_PRODUCT]: pagesOf([cafe]) }
  }));
  res = await handler({ structure: "Meeting", tag: "product", title_hint: "cafe" });
  found.tagTitle = res.content[0].text.includes(`ID: ${uid(7)}`);
  // One deepEqual, so a failure shows WHICH surface lost the shared matcher (one mutation, three surfaces).
  assert.deepEqual(found, { search: true, escalated: true, tagTitle: true });
});

// === cap-i93 Task 7: ordering before truncation, zero-GET short-circuit =====

const ORDER_FIXTURE: Summary[] = [
  { id: uid(1), title: "Sync - 2024-01-10", structureId: "meeting" },
  { id: uid(2), title: "Kickoff", structureId: "meeting" },
  { id: uid(3), title: "Sync - 2026-03-01", structureId: "meeting" },
  { id: uid(4), title: "", structureId: "meeting" },
  { id: uid(5), title: "Sync - 2025-06-15", structureId: "meeting" },
  { id: uid(6), title: "Retro (May 19, 2026)", structureId: "meeting" }
];

test("find_objects: enumerated candidates are ordered by title date BEFORE fetch_cap truncates", async () => {
  const cases: [string, any, string[], RegExp][] = [
    ["sort Date desc → newest three", SORT_DATE_DESC, [uid(6), uid(3), uid(5)], /most recent first by title date/],
    ["sort Date asc → oldest three", { by: "Date", order: "asc" }, [uid(1), uid(5), uid(3)], /oldest first by title date/],
    ["sort by a LABEL asc → direction ignored, newest three", { by: "Status", order: "asc" }, [uid(6), uid(3), uid(5)], /most recent first by title date/]
  ];
  for (const [name, sort, want, phrase] of cases) {
    const handler = getFind();
    const calls = installFind(enumRouter({ structurePages: { meeting: pagesOf(ORDER_FIXTURE) } }));
    const res = await handler({ structure: "Meeting", sort, fetch_cap: 3 });
    assert.deepEqual(fetchedIds(calls), want, name);
    // The fetch_cap Note names the order the cut was taken in (M2).
    assert.match(res.content[0].text, phrase, name);
  }
});

test("find_objects: the plain search path keeps search-rank order (no title-date reordering)", async () => {
  const handler = getFind();
  const calls = installFind(findRouter({ search: { Sync: [
    { id: "m1", title: "Sync - 2024-01-10", structureId: "meeting" },
    { id: "m3", title: "Sync - 2026-03-01", structureId: "meeting" }
  ] } }));
  await handler({ structure: "Meeting", title_hint: "Sync", sort: SORT_DATE_DESC, fetch_cap: 1 });
  assert.deepEqual(fetchedIds(calls), ["m1"]);
});

test("find_objects: no filters and no sort → ZERO GET /object, most recent first, row cap = limit (default 30) with a Note", async () => {
  const dated = summaries(1, 40, n => `Sync - ${new Date(Date.UTC(2025, 0, n)).toISOString().slice(0, 10)}`);
  let handler = getFind();
  let calls = installFind(enumRouter({ structurePages: { meeting: pagesOf(dated) } }));
  let res = await handler({ structure: "Meeting" });
  assert.deepEqual(fetchedIds(calls), [], "nothing to surface, so nothing is fetched");
  let text = res.content[0].text;
  assert.match(text, /^Found 30 Meetings \(live as of /);
  assert.equal(text.match(/^ID: (\S+)$/m)![1], uid(40), "the newest title date is listed first");
  assert.match(text, /^Note: showing the first 30 of 40 matching Meetings \(limit\) — raise limit or narrow the seed\.$/m);
  assert.equal(res.structuredContent.candidates_complete, false);
  assert.equal(res.structuredContent.returned, 30);

  // limit governs the cap; a cap that does not bite is complete.
  handler = getFind();
  calls = installFind(enumRouter({ structurePages: { meeting: pagesOf(dated) } }));
  res = await handler({ structure: "Meeting", limit: 100 });
  text = res.content[0].text;
  assert.match(text, /^Found 40 Meetings/);
  assert.doesNotMatch(text, /^[ \t]*Note:/im);
  assert.equal(res.structuredContent.candidates_complete, true);

  // Known-positive: with a sort, stage 2 runs and the GET channel is live.
  handler = getFind();
  calls = installFind(enumRouter({ structurePages: { meeting: pagesOf(dated) } }));
  await handler({ structure: "Meeting", sort: SORT_DATE_DESC });
  assert.equal(fetchedIds(calls).length, 30);
});

test("find_objects: a tag-only listing with no filters is zero-GET (design Example C)", async () => {
  const handler = getFind();
  const calls = installFind(enumRouter({
    base: { search: { product: [{ id: TAG_PRODUCT, title: "product", structureId: "RootTag" }] } },
    tagPages: { [TAG_PRODUCT]: pagesOf(summaries(1, 19, n => `Pricing ${n}`)) }
  }));
  const res = await handler({ structure: "Meeting", tag: "product" });
  assert.deepEqual(fetchedIds(calls), []);
  assert.match(res.content[0].text, /^Found 19 Meetings tagged "product"/);
});

test("find_objects: when truncation left filters a SAMPLE, an empty result says so", async () => {
  const five = [1, 2, 3, 4, 5].map(n => ({ id: `m${n}`, title: "Note", structureId: "meeting" }));
  let handler = getFind();
  installFind(findRouter({ search: { Note: five } }));
  let res = await handler({ structure: "Meeting", title_hint: "Note", fetch_cap: 2, filters: { Status: "Done" } });
  assert.match(res.content[0].text, /^\(none of the 2 candidates read matched the filters — 3 were not fetched\)$/m);
  assert.doesNotMatch(res.content[0].text, /^\(no candidates matched the filters\)$/m);
  // Known-positive: everything fetched → the plain wording.
  handler = getFind();
  installFind(findRouter({ search: { Note: five } }));
  res = await handler({ structure: "Meeting", title_hint: "Note", filters: { Status: "Done" } });
  assert.match(res.content[0].text, /^\(no candidates matched the filters\)$/m);
});

test("find_objects: the extremum caveat appears iff a sorted result was truncated, and is never a Note", async () => {
  const five = [1, 2, 3, 4, 5].map(n => ({ id: `m${n}`, title: "Note", structureId: "meeting" }));
  const caveat = /^\(Sorted within the 2 candidates read only — the true first\/last by Date may lie among the 3 candidates not read\.\)$/m;
  let handler = getFind();
  installFind(findRouter({ search: { Note: five } }));
  let res = await handler({ structure: "Meeting", title_hint: "Note", fetch_cap: 2, sort: SORT_DATE_DESC });
  assert.match(res.content[0].text, caveat);
  handler = getFind();
  installFind(findRouter({ search: { Note: five } }));
  res = await handler({ structure: "Meeting", title_hint: "Note", sort: SORT_DATE_DESC });      // not truncated
  assert.doesNotMatch(res.content[0].text, /may lie among/);
  handler = getFind();
  installFind(findRouter({ search: { Note: five } }));
  res = await handler({ structure: "Meeting", title_hint: "Note", fetch_cap: 2, filters: { Status: "Done" } }); // truncated, no sort
  assert.doesNotMatch(res.content[0].text, /may lie among/);
});

test("find_objects: a stage-2 limit slice is informational, not a Note, keeps candidates_complete true, and shows as matched 3 vs returned 1 (D3)", async () => {
  const handler = getFind();
  const three = [1, 2, 3].map(n => ({ id: `m${n}`, title: "Note", structureId: "meeting" }));
  installFind(findRouter({ search: { Note: three } }));
  const res = await handler({ structure: "Meeting", title_hint: "Note", sort: SORT_DATE_DESC, limit: 1 });
  assert.match(res.content[0].text, /^\(showing 1 of 3 matches — limit\)$/m);
  assert.doesNotMatch(res.content[0].text, /^[ \t]*Note:/im);
  assert.equal(res.structuredContent.candidates_complete, true);
  assert.equal(res.structuredContent.matched, 3, "matches after filtering, BEFORE the limit slice");
  assert.equal(res.structuredContent.returned, 1);
});

test("find_objects: when titles carry no dates and rows were cut, an info line says the kept rows are in listing order (design § Stage 2 (b))", async () => {
  const undated = summaries(1, 40, n => `Task ${n}`);
  const line = /^\(None of the 40 candidate titles carries a date, so the (\d+) kept were taken in listing order, not by date\.\)$/m;
  // Short-circuit cut at the default row cap.
  let handler = getFind();
  installFind(enumRouter({ structurePages: { meeting: pagesOf(undated) } }));
  let text = (await handler({ structure: "Meeting" })).content[0].text;
  assert.equal(text.match(line)?.[1], "30");
  // Stage-2 cut at fetch_cap.
  handler = getFind();
  installFind(enumRouter({ structurePages: { meeting: pagesOf(undated) } }));
  text = (await handler({ structure: "Meeting", sort: SORT_DATE_DESC, fetch_cap: 5 })).content[0].text;
  assert.equal(text.match(line)?.[1], "5");
  // With no title dates the cut follows the listing, and the Note must not claim a date order (M1).
  assert.match(text, /^Note: fetched the first 5 of 40 candidates \(fetch_cap\) in listing order; /m);
  // Known-negatives: nothing cut → no line; dated titles cut → no line.
  handler = getFind();
  installFind(enumRouter({ structurePages: { meeting: pagesOf(undated) } }));
  assert.doesNotMatch((await handler({ structure: "Meeting", limit: 100 })).content[0].text, /carries a date/);
  handler = getFind();
  installFind(enumRouter({ structurePages: { meeting: pagesOf(summaries(1, 40, n => `Sync - ${new Date(Date.UTC(2025, 0, n)).toISOString().slice(0, 10)}`)) } }));
  assert.doesNotMatch((await handler({ structure: "Meeting" })).content[0].text, /carries a date/);
});

test("find_objects: the undated listing-order line needs EVERY title undated — one dated title among 40 silences it on both cut surfaces", async () => {
  // 39 undated + 1 dated: a gate that fires when SOME title is undated would emit the line here.
  const mixed = [...summaries(1, 39, n => `Task ${n}`), { id: uid(40), title: "Sync - 2025-01-05", structureId: "meeting" }];
  // Short-circuit cut (default row cap 30). The Note proves the rows WERE cut.
  let handler = getFind();
  installFind(enumRouter({ structurePages: { meeting: pagesOf(mixed) } }));
  let text = (await handler({ structure: "Meeting" })).content[0].text;
  assert.match(text, /^Note: showing the first 30 of 40 /m);
  assert.doesNotMatch(text, /carries a date/);
  // Stage-2 cut at fetch_cap.
  handler = getFind();
  installFind(enumRouter({ structurePages: { meeting: pagesOf(mixed) } }));
  text = (await handler({ structure: "Meeting", sort: SORT_DATE_DESC, fetch_cap: 5 })).content[0].text;
  assert.match(text, /^Note: fetched the first 5 of 40 candidates/m);
  assert.doesNotMatch(text, /carries a date/);
});

test("find_objects: the undated listing-order line never appears on the plain title-search path (search-rank order), cut on either surface", async () => {
  const five = [1, 2, 3, 4, 5].map(n => ({ id: `m${n}`, title: "Note", structureId: "meeting" }));
  // Short-circuit cut by limit. The Note proves the rows WERE cut.
  let handler = getFind();
  installFind(findRouter({ search: { Note: five } }));
  let res = await handler({ structure: "Meeting", title_hint: "Note", limit: 2 });
  assert.equal(res.structuredContent.seed_method, "search");
  assert.match(res.content[0].text, /^Note: showing the first 2 of 5 matching Meetings/m);
  assert.doesNotMatch(res.content[0].text, /carries a date/);
  // Stage-2 cut by fetch_cap.
  handler = getFind();
  installFind(findRouter({ search: { Note: five } }));
  res = await handler({ structure: "Meeting", title_hint: "Note", sort: SORT_DATE_DESC, fetch_cap: 2 });
  assert.match(res.content[0].text, /^Note: fetched the first 2 of 5 candidates \(fetch_cap\) in search-rank order/m);
  assert.doesNotMatch(res.content[0].text, /carries a date/);
});

test("find_objects: unreadable candidates are never counted as read — the sampling body and caveat count reads, and the could-not-be-read Note survives a fetch_cap cut (I1)", async () => {
  const five = [1, 2, 3, 4, 5].map(n => ({ id: `m${n}`, title: "Note", structureId: "meeting" }));
  const getFail = { m1: { status: 500, text: "boom" }, m2: { status: 500, text: "boom" } };
  // 5 candidates, fetch_cap 3: m1/m2 error, m3 is read and does not match, m4/m5 are never requested.
  let handler = getFind();
  installFind(findRouter({ search: { Note: five }, getFail }));
  let res = await handler({ structure: "Meeting", title_hint: "Note", fetch_cap: 3, filters: { Status: "Done" } });
  let text = res.content[0].text;
  assert.match(text, /^\(none of the 1 candidates read matched the filters — 2 could not be read, 2 were not fetched\)$/m);
  assert.match(text, /^Note: 2 candidate\(s\) could not be read and were skipped\.$/m);
  assert.match(text, /^Note: fetched the first 3 of 5 candidates \(fetch_cap\)/m);
  assert.equal(res.structuredContent.errored, 2);
  // Caveat on the same fixture, sorted: the order holds over the ONE candidate read.
  handler = getFind();
  installFind(findRouter({ search: { Note: five }, getFail }));
  text = (await handler({ structure: "Meeting", title_hint: "Note", fetch_cap: 3, sort: SORT_DATE_DESC })).content[0].text;
  assert.match(text, /^\(Sorted within the 1 candidates read only — the true first\/last by Date may lie among the 4 candidates not read\.\)$/m);
  // Zero clause omitted: everything requested, two unreadable, none left unfetched.
  handler = getFind();
  installFind(findRouter({ search: { Note: five }, getFail }));
  text = (await handler({ structure: "Meeting", title_hint: "Note", filters: { Status: "Done" } })).content[0].text;
  assert.match(text, /^\(none of the 3 candidates read matched the filters — 2 could not be read\)$/m);
  assert.doesNotMatch(text, /checked \d+ of \d+ candidates/);
});

// --- Per-call request budget + relation-filter cap (cap-i93 Task 8) ----------

test("find_objects: the per-call request budget clamps page_budget and fetch_cap with Notes, never rejects", async () => {
  const big = summaries(1, 2000, n => `Sync ${n}`);   // 20 pages
  const TAG_HIT = [{ id: TAG_PRODUCT, title: "product", structureId: "RootTag" }];
  const cases: { name: string; args: any; base: any; pages: number }[] = [
    // 45 - 1 (space) - 30 (fetch reserve) = 14
    { name: "structure + sort", args: { sort: SORT_DATE_DESC }, base: {}, pages: 14 },
    // 45 - 1 - 1 (seed search) - 30 = 13
    { name: "escalated title + sort", args: { title_hint: "Sync", sort: SORT_DATE_DESC }, base: { search: { Sync: big.slice(0, 50) } }, pages: 13 },
    // 45 - 1 - 1 (entity-filter resolution) - 30 = 13
    { name: "structure + entity filter", args: { sort: SORT_DATE_DESC, filters: { Tags: "product" } }, base: { search: { product: TAG_HIT } }, pages: 13 }
  ];
  for (const c of cases) {
    const handler = getFind();
    const calls = installFind(enumRouter({ base: c.base, structurePages: { meeting: pagesOf(big) } }));
    const res = await handler({ structure: "Meeting", page_budget: 25, fetch_cap: 50, ...c.args });
    assert.equal(res.isError, undefined, c.name);
    assert.equal(enumCalls(calls).length, c.pages, `${c.name}: pages read`);
    const text = res.content[0].text;
    assert.match(text, new RegExp(`^Note: listing stopped at the page budget \\(${c.pages} pages, clamped from 25 by the per-call request budget of 45\\)`, "m"), c.name);
    assert.match(text, /^Note: fetched the first 30 of \d+ candidates \(per-call request budget of 45\)/m, c.name);
    assert.ok(calls.length <= MAX_REQUESTS_PER_CALL, `${c.name}: ${calls.length} requests`);
  }
});

test("find_objects: without stage 2 nothing is reserved for fetches, and defaults never clamp", async () => {
  const big = summaries(1, 2000, n => `Sync ${n}`);
  let handler = getFind();
  let calls = installFind(enumRouter({ structurePages: { meeting: pagesOf(big) } }));
  let res = await handler({ structure: "Meeting", page_budget: 25 });          // short-circuit
  assert.equal(enumCalls(calls).length, 20, "page_budget 25 honoured in full");
  assert.equal(res.structuredContent.seed_complete, true);
  assert.doesNotMatch(res.content[0].text, /clamped/);

  handler = getFind();
  calls = installFind(enumRouter({ base: { search: { Sync: big.slice(0, 50) } }, structurePages: { meeting: pagesOf(big) } }));
  res = await handler({ structure: "Meeting", title_hint: "Sync", sort: SORT_DATE_DESC }); // defaults: 12 pages, fetch_cap 30
  assert.equal(enumCalls(calls).length, 12);
  assert.match(res.content[0].text, /^Note: listing stopped at the page budget — read 12 pages/m);
  assert.doesNotMatch(res.content[0].text, /clamped|per-call request budget/);
});

test("find_objects: a plain title search that does NOT escalate keeps today's behaviour — fetch_cap 50 honoured, the limiter waits, no budget Note (D5)", async () => {
  const clock = fakeClock();
  const handler = getFind(clock);
  const calls = installFind(enumRouter({ base: { search: { Retro: summaries(1, 49, n => `Retro ${n}`) } } }));
  const res = await handler({ structure: "Meeting", title_hint: "Retro", fetch_cap: 50, sort: SORT_DATE_DESC });
  assert.equal(res.isError, undefined);
  assert.equal(enumCalls(calls).length, 0, "49 does not escalate");
  assert.equal(fetchedIds(calls).length, 49, "fetch_cap 50 honoured: every candidate fetched");
  assert.deepEqual(clock.sleeps, [60000], "the object bucket's own wait paces the 31st GET");
  assert.doesNotMatch(res.content[0].text, /per-call request budget/);
  assert.equal(res.structuredContent.candidates_complete, true);
});

// Meeting plus six more relation properties, so a call can carry six relation filters.
function relationStructures(): any {
  const s = meetingStructure();
  for (let i = 1; i <= 6; i++) s.propertyDefinitions.push({ id: `rel${i}`, name: `Rel${i}`, type: "entity", writable: true, allowedStructures: ["RootTag"] });
  return { structures: [s, ...findStructures().structures.slice(1)] };
}
const PRODUCT_TAG_HIT = [{ id: TAG_PRODUCT, title: "product", structureId: "RootTag" }];

test("find_objects: a 6th relation filter is rejected before any search, naming the limit (D2)", async () => {
  const handler = getFind();
  const calls = installFind(enumRouter({ base: { structures: relationStructures(), search: { product: PRODUCT_TAG_HIT } } }));
  const filters = { Rel1: "product", Rel2: "product", Rel3: "product", Rel4: "product", Rel5: "product", Rel6: "product" };
  const res = await handler({ structure: "Meeting", filters, sort: SORT_DATE_DESC });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /6 relation filters given/);
  assert.match(res.content[0].text, /maximum is 5 per call/);
  assert.deepEqual(calls.map(c => new URL(c.url).pathname), ["/space/structures"],
    "only the structure read that types the filters — no search, no listing, no GET");
});

test("find_objects: five relation filters plus a label and a date filter are accepted, and the worst case is exactly 45 requests (D2)", async () => {
  const handler = getFind();
  const filters = { Rel1: "product", Rel2: "product", Rel3: "product", Rel4: "product", Rel5: "product",
                    Status: "Done", Date: { after: "2020-01-01" } };
  const calls = installFind(enumRouter({
    base: { structures: relationStructures(), search: { product: PRODUCT_TAG_HIT } },
    tagPages: { [TAG_PRODUCT]: pagesOf(summaries(1, 2000, n => `Sync ${n}`)) }
  }));
  const res = await handler({ structure: "Meeting", tag: "product", filters, sort: SORT_DATE_DESC, page_budget: 25, fetch_cap: 50 });
  assert.equal(res.isError, undefined, res.content[0].text);
  // 1 structure read + 5 relation searches + 1 tag search = 7; 45 - 7 - 30 (fetch reserve) = 8 pages; then 30 GETs.
  assert.equal(searchQueries(calls).length, 6);
  assert.equal(enumCalls(calls).length, 8);
  assert.equal(fetchedIds(calls).length, 30);
  assert.equal(calls.length, MAX_REQUESTS_PER_CALL);
});
