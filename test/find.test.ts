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

import { setupFindTools, PAGE_BUDGET_MAX, PAGE_BUDGET_DEFAULT, MAX_REQUESTS_PER_CALL, FETCH_CAP_MAX } from "../src/tools/find.js";

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
// The FindExactness fields arrive as content[1], compact JSON. structuredContent
// must stay absent: observed 2026-10-22 in Claude Code 2.1.305 via mcp-gateway,
// the model received only the structuredContent JSON and no content[0].text, which
// hid every id and Note: line; the layer responsible was not isolated (cap-ul0).
function exactnessOf(res: any): any {
  assert.equal(res.structuredContent, undefined, "find_objects must not return structuredContent (cap-ul0)");
  assert.equal(res.content.length, 2, "content[0] = human text, content[1] = exactness JSON");
  assert.equal(res.content[1].type, "text");
  return JSON.parse(res.content[1].text);
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

test("find_objects: an escalated seed of 50 with fetch_cap 50 is clamped to 42 GETs by the request budget and still crosses the object window once", async () => {
  // The 31st GET crosses the 30/60s object window; acquireWithWait sleeps once.
  // Inject a fake clock so that sleep resolves instantly instead of ~60s.
  const clock = fakeClock();
  const handler = getFind(clock);
  const fifty = summaries(1, 50, n => `Note ${n}`);
  const calls = installFind(enumRouter({ base: { search: { Note: fifty } }, structurePages: { meeting: pagesOf(fifty) } }));
  const res = await handler({ structure: "Meeting", title_hint: "Note", fetch_cap: 50, sort: { by: "Date", order: "asc" } });
  assert.equal(res.isError, undefined);
  assert.equal(exactnessOf(res).seed_method, "search+enumeration", "a raw seed of 50 escalates (M3)");
  // 45 − space − search − 1 listing page = 42 > 30, so one window wait.
  assert.equal(fetchedIds(calls).length, 42);
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
  assert.equal(exactnessOf(res).seed_complete, true);
});

test("find_objects: an all-punctuation title_hint is an error before any network call (U5)", async () => {
  const handler = getFind();
  const calls = installFind(findRouter({ search: { "///": [{ id: "m1", title: "Alpha", structureId: "meeting" }] } }));
  const res = await handler({ structure: "Meeting", title_hint: "///" });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /title_hint must contain at least one letter or digit/);
  assert.equal(calls.length, 0);
});

test("find_objects: the REGISTERED description advertises tag and no-seed listing and no longer requires title_hint", () => {
  const { config } = findHarness();
  const d: string = config.description;
  assert.match(d, /limited to objects whose title contains `title_hint`/);   // kept from cap-1kc
  assert.match(d, /`tag`/);
  assert.match(d, /omit `title_hint`/i);
  assert.match(d, /letter or digit/);
  assert.match(d, /50/);                                                      // the escalation threshold
  assert.match(d, /"Note:"/);                                                 // tells the LLM what a Note means
  assert.match(d, /`matched`/);                                               // D3: completeness needs matched === returned
  assert.match(d, /`returned`/);
  assert.match(d, /45 requests/);                                             // per-call limits stated up front
  assert.match(d, /5 relation filters/);
  assert.match(d, /exact instant/);                                           // a full timestamp is not day-granularity
  assert.doesNotMatch(d, /day-granularity/);
  assert.doesNotMatch(d, /CANNOT enumerate/i);
  assert.doesNotMatch(d, /REQUIRED: `title_hint`/);
  assert.match(config.inputSchema.title_hint.description, /optional/i);
  assert.match(config.inputSchema.tag.description, /tag NAME/);
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
  assert.equal(exactnessOf(res).seed_method, "structure-enumeration");
  assert.equal(exactnessOf(res).seed_complete, true);
  assert.equal(exactnessOf(res).seed_size, 3);
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
  assert.equal(exactnessOf(res).seed_complete, false);
  assert.equal(exactnessOf(res).seed_size, 200);
});

test("find_objects: a resolved structure that enumerates to [] is a genuine none", async () => {
  const handler = getFind();
  installFind(enumRouter({ structurePages: { meeting: pagesOf([]) } }));
  const res = await handler({ structure: "Meeting" });
  assert.equal(res.isError, undefined);
  assert.match(res.content[0].text, /^No Meetings found \(live as of /);
  assert.equal(exactnessOf(res).seed_complete, true);
  assert.equal(exactnessOf(res).returned, 0);
});

test("find_objects: no return path sends structuredContent; content[0] is the human text, content[1] the exactness JSON (cap-ul0)", async () => {
  // Observed in Claude Code 2.1.305 via mcp-gateway: with structuredContent present
  // the model saw only that JSON, hiding every id and Note: line. One row per return site.
  const keys = ["candidates_complete", "considered", "errored", "matched", "returned", "seed_complete", "seed_method", "seed_size"];
  const rows: { name: string; res: any; text: RegExp }[] = [];
  let calls: FCall[];

  let handler = getFind();
  calls = installFind(enumRouter({ structurePages: { meeting: pagesOf([]) } }));
  rows.push({ name: "genuine none", res: await handler({ structure: "Meeting" }), text: /^No Meetings found \(live as of / });

  handler = getFind();
  calls = installFind(enumRouter({ structurePages: { meeting: pagesOf(summaries(1, 3, n => `Kickoff ${n}`)) } }));
  const shortRes = await handler({ structure: "Meeting" });
  assert.equal(fetchedIds(calls).length, 0, "short-circuit: zero GET /object");
  rows.push({ name: "short-circuit", res: shortRes, text: /^Found 3 Meetings \(live as of [^\n]*\n\n\*\*Kickoff / });

  handler = getFind();
  calls = installFind(findRouter({
    search: { "Weekly Roadmap Review": [
      { id: "m1", title: "Weekly Roadmap Review", structureId: "meeting" },
      { id: "m2", title: "Weekly Roadmap Review", structureId: "meeting" }
    ] },
    objects: { m1: meetingObj("m1", { date: dateProp("2026-07-14T15:00:00.000Z") }), m2: meetingObj("m2", { date: dateProp("2026-07-07T15:00:00.000Z") }) }
  }));
  const stage2Res = await handler({ structure: "Meeting", title_hint: "Weekly Roadmap Review", filters: { Date: "2026-07-14" } });
  assert.equal(fetchedIds(calls).length, 2, "stage 2: both candidates were read");
  rows.push({ name: "stage 2", res: stage2Res, text: /^Found 1 Meetings matching "Weekly Roadmap Review"[^]*\nID: m1$/m });

  for (const { name, res, text } of rows) {
    assert.equal(res.isError, undefined, name);
    assert.equal("structuredContent" in res, false, `${name}: structuredContent must be absent`);
    assert.equal(res.content.length, 2, `${name}: two content blocks`);
    assert.equal(res.content[0].type, "text", name);
    assert.match(res.content[0].text, text, `${name}: content[0] is the human text`);
    assert.doesNotMatch(res.content[0].text, /seed_method/, `${name}: the JSON stays out of content[0]`);
    assert.equal(res.content[1].type, "text", name);
    const parsed = JSON.parse(res.content[1].text);
    assert.deepEqual(Object.keys(parsed).sort(), keys, `${name}: exactness keys`);
    // Blocks were seen joined with no separator (Claude Code 2.1.305 via mcp-gateway),
    // so the JSON needs its own line.
    assert.ok(res.content[1].text.startsWith("\n"), `${name}: content[1] starts with a newline`);
    assert.equal(res.content[1].text, "\n" + JSON.stringify(parsed), `${name}: one newline, then compact JSON`);
  }
});

test("find_objects: a 429 on page 1 is PARTIAL, never 'No … found' (rate-stop poisons exactness)", async () => {
  const handler = getFind();
  installFind(enumRouter({ structurePages: { meeting: [{ fail: { status: 429, text: "<!doctype html>banned" } }] } }));
  const res = await handler({ structure: "Meeting" });
  assert.equal(res.isError, undefined, "fail-open: partial, not an error");
  const text = res.content[0].text;
  assert.doesNotMatch(text, /No Meetings found/);
  assert.match(text, /^Note: rate limit reached while listing — read 0 page\(s\) before stopping/m);
  assert.equal(exactnessOf(res).seed_complete, false);
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
  assert.equal(exactnessOf(res).seed_complete, false);
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
  assert.equal(exactnessOf(res).seed_method, "tag-enumeration");
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
  assert.equal(exactnessOf(res).seed_method, "tag-enumeration");
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
  assert.equal(exactnessOf(res).seed_complete, true);

  handler = getFind();
  const calls = installFind(enumRouter({
    base: { search: { product: [{ id: TAG_PRODUCT, title: "product", structureId: "RootTag" }] } },
    tagPages: { [TAG_PRODUCT]: pagesOf(summaries(1, 250, n => `Tagged ${n}`)) }
  }));
  res = await handler({ structure: "Meeting", tag: "product", page_budget: 2 });
  assert.equal(enumCalls(calls).length, 2);
  assert.match(res.content[0].text, /^Note: listing stopped at the page budget/m);
  assert.equal(exactnessOf(res).seed_complete, false);
});

test("find_objects: seed_complete and candidates_complete are independent — a complete seed over a truncated fetch", async () => {
  const handler = getFind();
  const three = [1, 2, 3].map(n => ({ id: `m${n}`, title: "Note", structureId: "meeting" }));
  installFind(findRouter({ search: { Note: three } }));
  let res = await handler({ structure: "Meeting", title_hint: "Note", fetch_cap: 2, sort: SORT_DATE_DESC });
  assert.deepEqual(
    { ...exactnessOf(res) },
    { seed_method: "search", seed_complete: true, candidates_complete: false, seed_size: 3, considered: 2, errored: 0, matched: 2, returned: 2 }
  );
  // Known-positive: the same call with room to fetch everything is complete on both axes.
  installFind(findRouter({ search: { Note: three } }));
  res = await handler({ structure: "Meeting", title_hint: "Note", fetch_cap: 30, sort: SORT_DATE_DESC });
  assert.equal(exactnessOf(res).candidates_complete, true);
  assert.equal(exactnessOf(res).considered, 3);
});

test("find_objects: a candidate that errors in stage 2 makes candidates_complete false", async () => {
  const handler = getFind();
  installFind(findRouter({
    search: { Note: [{ id: "m1", title: "Note", structureId: "meeting" }, { id: "m2", title: "Note", structureId: "meeting" }] },
    getFail: { m2: { status: 404, text: "gone" } }
  }));
  const res = await handler({ structure: "Meeting", title_hint: "Note", sort: SORT_DATE_DESC });
  assert.equal(exactnessOf(res).candidates_complete, false);
  assert.equal(exactnessOf(res).errored, 1);
  assert.equal(exactnessOf(res).considered, 2, "considered counts the errored one");
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
  assert.equal(exactnessOf(res).candidates_complete, false);
  assert.equal(exactnessOf(res).considered, 1);
  assert.equal(exactnessOf(res).seed_size, 3);
});

test("find_objects: a listing that fails on page 2 keeps and shows page 1's rows (M1)", async () => {
  const handler = getFind();
  installFind(enumRouter({ structurePages: { meeting: onePageThenFail(10, { status: 500, text: "boom" }) } }));
  const res = await handler({ structure: "Meeting" });
  assert.equal(res.isError, undefined);
  const text = res.content[0].text;
  for (let n = 1; n <= 10; n++) assert.ok(text.includes(`ID: ${uid(n)}`), `row ${n} shown`);
  assert.match(text, /^Note: listing stopped after 1 page\(s\) because a page could not be read/m);
  assert.equal(exactnessOf(res).seed_complete, false);
  assert.equal(exactnessOf(res).seed_size, 10);
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
  // Fake clock: these GETs equal the object window, so a real clock would turn an
  // over-fetch into a 60s wait instead of a failure.
  let handler = getFind(fakeClock());
  let calls = installFind(enumRouter({ base: { search: { Retro: listing.slice(0, 49) } }, structurePages: { meeting: pagesOf(listing) } }));
  let res = await handler({ structure: "Meeting", title_hint: "Retro", sort: SORT_DATE_DESC });
  assert.equal(enumCalls(calls).length, 0, "49 is an exact seed");
  assert.equal(exactnessOf(res).seed_method, "search");
  assert.equal(exactnessOf(res).seed_size, 49);

  handler = getFind(fakeClock());
  calls = installFind(enumRouter({ base: { search: { Retro: listing.slice(0, 50) } }, structurePages: { meeting: pagesOf(listing) } }));
  res = await handler({ structure: "Meeting", title_hint: "Retro", sort: SORT_DATE_DESC });
  assert.equal(enumCalls(calls).length, 1, "50 escalates");
  assert.equal(exactnessOf(res).seed_method, "search+enumeration");
  assert.equal(exactnessOf(res).seed_size, 60);
  assert.equal(exactnessOf(res).seed_complete, true);
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
  assert.equal(exactnessOf(res).seed_complete, true);
});

test("find_objects: an escalation that hits the page budget is partial with a stage-1 Note", async () => {
  const handler = getFind();
  const listing = summaries(1, 250, n => `Retro ${n}`);
  installFind(enumRouter({ base: { search: { Retro: listing.slice(0, 50) } }, structurePages: { meeting: pagesOf(listing) } }));
  const res = await handler({ structure: "Meeting", title_hint: "Retro", page_budget: 2 });
  assert.match(res.content[0].text, /^Note: listing stopped at the page budget — read 2 pages \(200 summaries\)/m);
  assert.equal(exactnessOf(res).seed_complete, false);
  assert.equal(exactnessOf(res).seed_size, 200);
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
    assert.equal(exactnessOf(r.value).seed_complete, false, `${name}: the listing really was partial`);
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
  assert.equal(exactnessOf(res).seed_method, "search+enumeration");
  assert.equal(exactnessOf(res).seed_complete, false);
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
  assert.equal(exactnessOf(res).candidates_complete, false);
  assert.equal(exactnessOf(res).returned, 30);
  // D3 on the zero-GET path: every candidate "matches" (no filters), so matched is the
  // whole seed and the cut shows as matched 40 vs returned 30; nothing was read or errored.
  assert.equal(exactnessOf(res).matched, 40);
  assert.equal(exactnessOf(res).considered, 40);
  assert.equal(exactnessOf(res).errored, 0);

  // limit governs the cap; a cap that does not bite is complete.
  handler = getFind();
  calls = installFind(enumRouter({ structurePages: { meeting: pagesOf(dated) } }));
  res = await handler({ structure: "Meeting", limit: 100 });
  text = res.content[0].text;
  assert.match(text, /^Found 40 Meetings/);
  assert.doesNotMatch(text, /^[ \t]*Note:/im);
  assert.equal(exactnessOf(res).candidates_complete, true);
  // A full answer: both flags true AND matched === returned (D3).
  assert.equal(exactnessOf(res).seed_complete, true);
  assert.equal(exactnessOf(res).returned, 40);
  assert.equal(exactnessOf(res).matched, exactnessOf(res).returned);
  assert.equal(exactnessOf(res).considered, 40);
  assert.equal(exactnessOf(res).errored, 0);

  // Known-positive: with a sort, stage 2 runs and the GET channel is live.
  // Fake clock: 30 GETs equals the object window, so on a real clock an
  // over-fetch would wait 60s and then rate-stop at exactly 30.
  const clock = fakeClock();
  handler = getFind(clock);
  calls = installFind(enumRouter({ structurePages: { meeting: pagesOf(dated) } }));
  await handler({ structure: "Meeting", sort: SORT_DATE_DESC });
  assert.equal(fetchedIds(calls).length, 30);
  assert.deepEqual(clock.sleeps, [], "30 GETs with no window wait");
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
  assert.equal(exactnessOf(res).candidates_complete, true);
  assert.equal(exactnessOf(res).matched, 3, "matches after filtering, BEFORE the limit slice");
  assert.equal(exactnessOf(res).returned, 1);
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
  // Short-circuit cut by a caller limit. The limit info line proves the rows WERE cut.
  let handler = getFind();
  installFind(findRouter({ search: { Note: five } }));
  let res = await handler({ structure: "Meeting", title_hint: "Note", limit: 2 });
  assert.equal(exactnessOf(res).seed_method, "search");
  assert.match(res.content[0].text, /^\(showing 2 of 5 matches — limit\)$/m);
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
  assert.match(text, /^\(none of the 1 candidate read matched the filters — 2 could not be read, 2 were not fetched\)$/m);   // singular
  assert.match(text, /^Note: 2 candidate\(s\) could not be read and were skipped\.$/m);
  assert.match(text, /^Note: fetched the first 3 of 5 candidates \(fetch_cap\)/m);
  assert.equal(exactnessOf(res).errored, 2);
  // Caveat on the same fixture, sorted: the order holds over the ONE candidate read.
  handler = getFind();
  installFind(findRouter({ search: { Note: five }, getFail }));
  text = (await handler({ structure: "Meeting", title_hint: "Note", fetch_cap: 3, sort: SORT_DATE_DESC })).content[0].text;
  assert.match(text, /^\(Sorted within the 1 candidate read only — the true first\/last by Date may lie among the 4 candidates not read\.\)$/m);   // singular
  // And the singular on the not-read side: 4 of 5 read, all readable.
  handler = getFind();
  installFind(findRouter({ search: { Note: five } }));
  text = (await handler({ structure: "Meeting", title_hint: "Note", fetch_cap: 4, sort: SORT_DATE_DESC })).content[0].text;
  assert.match(text, /^\(Sorted within the 4 candidates read only — the true first\/last by Date may lie among the 1 candidate not read\.\)$/m);
  // Singular "was" on the not-fetched clause: fetch_cap 4 of 5, two unreadable.
  handler = getFind();
  installFind(findRouter({ search: { Note: five }, getFail }));
  text = (await handler({ structure: "Meeting", title_hint: "Note", fetch_cap: 4, filters: { Status: "Done" } })).content[0].text;
  assert.match(text, /^\(none of the 2 candidates read matched the filters — 2 could not be read, 1 was not fetched\)$/m);
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
    // Fake clock: 30 GETs equals the object window, so on a real clock an
    // over-allocation would wait 60s and then rate-stop at exactly 30.
    const clock = fakeClock();
    const handler = getFind(clock);
    const calls = installFind(enumRouter({ base: c.base, structurePages: { meeting: pagesOf(big) } }));
    const res = await handler({ structure: "Meeting", page_budget: 25, fetch_cap: 50, ...c.args });
    assert.equal(res.isError, undefined, c.name);
    assert.equal(enumCalls(calls).length, c.pages, `${c.name}: pages read`);
    const text = res.content[0].text;
    assert.match(text, new RegExp(`^Note: listing stopped at the page budget \\(${c.pages} pages, clamped from 25 by the per-call request budget of 45\\)`, "m"), c.name);
    assert.match(text, /^Note: fetched the first 30 of \d+ candidates \(per-call request budget of 45\)/m, c.name);
    assert.ok(calls.length <= MAX_REQUESTS_PER_CALL, `${c.name}: ${calls.length} requests`);
    assert.deepEqual(clock.sleeps, [], `${c.name}: the budget, not a window wait, held the GETs to 30`);
  }
});

test("find_objects: without stage 2 nothing is reserved for fetches, and defaults never clamp", async () => {
  const big = summaries(1, 2000, n => `Sync ${n}`);
  let handler = getFind();
  let calls = installFind(enumRouter({ structurePages: { meeting: pagesOf(big) } }));
  let res = await handler({ structure: "Meeting", page_budget: 25 });          // short-circuit
  assert.equal(enumCalls(calls).length, 20, "page_budget 25 honoured in full");
  assert.equal(exactnessOf(res).seed_complete, true);
  assert.doesNotMatch(res.content[0].text, /clamped/);

  // Fake clock: these GETs equal the object window, so a real clock would turn an
  // over-fetch into a 60s wait instead of a failure.
  handler = getFind(fakeClock());
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
  assert.equal(exactnessOf(res).candidates_complete, true);
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
  // Fake clock: 30 GETs equals the object window, so on a real clock an
  // over-allocation would wait 60s and then rate-stop at exactly 30.
  const clock = fakeClock();
  const handler = getFind(clock);
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
  assert.deepEqual(clock.sleeps, [], "30 GETs and no wait: the budget's doing, not the limiter's");
});

test("find_objects: a listing call that FAILED still counts against the request budget (requestsIssued, not pagesRead)", async () => {
  // 1 structure read + 2 listing calls (page 2 fails) = 3 spent; 45 - 3 = 42 GETs, not 43.
  const clock = fakeClock();
  const handler = getFind(clock);
  const calls = installFind(enumRouter({ structurePages: { meeting: onePageThenFail(100, { status: 500, text: "boom" }) } }));
  const res = await handler({ structure: "Meeting", sort: SORT_DATE_DESC, fetch_cap: 50 });
  assert.equal(res.isError, undefined);
  assert.equal(enumCalls(calls).length, 2, "fixture: page 1 read, page 2 failed");
  assert.equal(fetchedIds(calls).length, 42);
  assert.equal(calls.length, MAX_REQUESTS_PER_CALL);
  assert.match(res.content[0].text, /^Note: fetched the first 42 of 100 candidates \(per-call request budget of 45\)/m);
  assert.deepEqual(clock.sleeps, [60000], "42 GETs cross the 30/60s object window once, through the fake clock");
});

// --- Consumer prose contract (cap-i93 design test 17, U6) -------------------

// Copied from personal-assistant scripts/backfill_meeting_titles.py, verified at 27395fb:
//   :133  _COUNTS_RE = re.compile(r"checked\s+(\d+)\s+of\s+(\d+)\s+candidates", re.IGNORECASE)
//   :145  _NOTE_RE = re.compile(r"^[ \t]*Note:", re.IGNORECASE | re.MULTILINE)
//   :419  incomplete = bool(counts) or bool(_NOTE_RE.search(body))
//   :717  pacer.amend(parsed.checked …) — N is read as the GETs the call actually spent
// A cross-repo contract nobody else re-checks. If PA changes these, update here
// from the source — never from memory.
const PA_COUNTS_RE = /checked\s+(\d+)\s+of\s+(\d+)\s+candidates/i;
const PA_NOTE_RE = /^[ \t]*Note:/im;
const paIncomplete = (t: string) => PA_COUNTS_RE.test(t) || PA_NOTE_RE.test(t);
const noteLines = (t: string) => t.split("\n").filter(l => /^[ \t]*Note:/i.test(l));

test("consumer contract: every complete shape reads COMPLETE and every partial shape reads INCOMPLETE to PA's parser, with stage-2 counts only", async () => {
  // Fake clock throughout: on a real clock the object window's 30/60s limit would
  // produce the same GET counts a budget does, and the 42-GET row would sleep 60s.
  const run = async (args: any, route: Parameters<typeof enumRouter>[0]) => {
    const handler = getFind(fakeClock());
    installFind(enumRouter(route));
    return handler({ structure: "Meeting", ...args });
  };
  const SORT_DATE_ASC = { by: "Date", order: "asc" as const };
  const five = [1, 2, 3, 4, 5].map(n => ({ id: `m${n}`, title: "Note", structureId: "meeting" }));
  const mixed = [{ id: "m1", title: "Weekly Review", structureId: "meeting" }, { id: "x1", title: "Planning", structureId: "meeting" }];
  const retroSearch = [...summaries(1, 20, n => `Retro ${n}`), ...summaries(1001, 1030, n => `Planning ${n}`)];
  const retroListing = [...summaries(1, 25, n => `Retro ${n}`), ...summaries(26, 35, n => `Other ${n}`)];
  const forty = summaries(1, 40, n => `Sync ${n}`);
  const fortyDated = summaries(1, 40, n => `Sync - ${new Date(Date.UTC(2025, 0, n)).toISOString().slice(0, 10)}`);
  const many = summaries(1, 250, n => `Sync ${n}`);
  const huge = summaries(1, 2000, n => `Sync ${n}`);
  const slow = { status: 429, text: "slow" };
  // A server-controlled error body: the first line overruns the 200-char cap, and
  // what follows would forge a Note line and the stage-2 phrase if it leaked.
  const longBody = "x".repeat(500) + "\nNote: injected\nchecked 9 of 9 candidates";

  // [name, response, marker proving the fixture produced the intended shape]
  type Row = { name: string; res: any; marker: RegExp; stderr?: string[] };
  const complete: Row[] = [
    { name: "plain search, sorted, all read", marker: /^Found 3 Meetings matching "Note"/m,
      res: await run({ title_hint: "Note", sort: SORT_DATE_DESC }, { base: { search: { Note: five.slice(0, 3) } } }) },
    { name: "search, semantic extras dropped (info line)", marker: /\(1 search result\(s\) were ignored because/m,
      res: await run({ title_hint: "Weekly Review", sort: SORT_DATE_DESC }, { base: { search: { "Weekly Review": mixed } } }) },
    { name: "completed escalation, short-circuit (info line)", marker: /\(The title search returned its 50-result maximum/m,
      res: await run({ title_hint: "Retro" }, { base: { search: { Retro: retroSearch } }, structurePages: { meeting: pagesOf(retroListing) } }) },
    { name: "completed escalation, stage 2 (info line)", marker: /\(The title search returned its 50-result maximum/m,
      res: await run({ title_hint: "Retro", sort: SORT_DATE_DESC }, { base: { search: { Retro: retroSearch } }, structurePages: { meeting: pagesOf(retroListing) } }) },
    { name: "structure, short-circuit within limit", marker: /^Found 40 Meetings \(live/m,
      res: await run({ limit: 100 }, { structurePages: { meeting: pagesOf(forty) } }) },
    { name: "structure, stage 2, undated, nothing cut", marker: /^Found 20 Meetings \(live/m,
      res: await run({ sort: SORT_DATE_DESC }, { structurePages: { meeting: pagesOf(forty.slice(0, 20)) } }) },
    { name: "tag only", marker: /^Found 40 Meetings tagged "product" \(live/m,
      res: await run({ tag: "product", limit: 100 }, { base: { search: { product: PRODUCT_TAG_HIT } }, tagPages: { [TAG_PRODUCT]: pagesOf(forty) } }) },
    { name: "tag + title", marker: /^Found 11 Meetings tagged "product" with a title matching "Sync 1"/m,
      res: await run({ tag: "product", title_hint: "Sync 1" }, { base: { search: { product: PRODUCT_TAG_HIT } }, tagPages: { [TAG_PRODUCT]: pagesOf(forty) } }) },
    { name: "genuine none: structure", marker: /^No Meetings found \(live/m,
      res: await run({}, { structurePages: { meeting: pagesOf([]) } }) },
    { name: "genuine none: search", marker: /^No Meetings found with a title matching "Retro"/m,
      res: await run({ title_hint: "Retro" }, {}) },
    { name: "genuine none: tag", marker: /^No Meetings found tagged "product"/m,
      res: await run({ tag: "product" }, { base: { search: { product: PRODUCT_TAG_HIT } }, tagPages: { [TAG_PRODUCT]: pagesOf([]) } }) },
    { name: "stage-2 limit slice (info line)", marker: /\(showing 1 of 2 matches — limit\)$/m,
      res: await run({ title_hint: "Weekly Review", sort: SORT_DATE_DESC, limit: 1 },
        { base: { search: { "Weekly Review": [mixed[0], { id: "m2", title: "Weekly Review", structureId: "meeting" }] } } }) },
    { name: "filters matched none, every candidate read", marker: /\(no candidates matched the filters\)$/m,
      res: await run({ title_hint: "Note", filters: { Status: "Done" } }, { base: { search: { Note: five } } }) },
    // A caller's limit is what they asked for on the zero-GET path too (D3, final-review I2).
    { name: "short-circuit caller limit slice (info line)", marker: /^\(showing 2 of 3 matches — limit\)$/m,
      res: await run({ limit: 2 }, { structurePages: { meeting: pagesOf(forty.slice(0, 3)) } }) }
  ];
  // The fidelity canary (U4) fires on stderr only — it must never reach the text.
  const canarySearch = [...summaries(1, 20, n => `Retro ${n}`), { id: uid(5000), title: "Retro 5000", structureId: "meeting" },
    ...summaries(1001, 1029, n => `Planning ${n}`)];
  const canary = await captureStderr(() => run({ title_hint: "Retro" },
    { base: { search: { Retro: canarySearch } }, structurePages: { meeting: pagesOf(retroListing) } }));
  complete.push({ name: "completed escalation with the fidelity canary firing", marker: /\(The title search returned its 50-result maximum/m,
    res: canary.value, stderr: canary.lines });

  // [expected Note-line prefixes in order, expected count-phrase captures]
  type PRow = Row & { notes: string[]; counts: [string, string] | null };
  const partial: PRow[] = [
    // cap-dnf: the 403's body forges the count phrase; the stop Note must not carry it.
    { name: "stage-2 circuit breaker, body forging the count phrase", marker: /^Note: stopped reading candidates after a 403/m, counts: null,
      notes: ["Note: stopped reading candidates after a 403 from the server", "Note: 1 candidate(s) could not be read and were skipped."],
      res: await run({ title_hint: "Note", sort: SORT_DATE_DESC }, { base: { search: { Note: five }, getFail: { m1: { status: 403, text: "checked 9 of 9 candidates" } } } }) },
    // cap-fvb: a 403 trips the stage-2 breaker.
    { name: "stage-2 circuit breaker on a 403", marker: /^Note: stopped reading candidates after a 403/m, counts: null,
      notes: ["Note: stopped reading candidates after a 403 from the server", "Note: 1 candidate(s) could not be read and were skipped."],
      res: await run({ title_hint: "Note", sort: SORT_DATE_DESC }, { base: { search: { Note: five }, getFail: { m1: { status: 403, text: "Access denied" } } } }) },
    { name: "page budget, short-circuit", marker: /^Found 30 Meetings/m, counts: null,
      notes: ["Note: listing stopped at the page budget — read 2 pages (200 summaries)", "Note: showing the first 30 of 200 matching Meetings (limit)"],
      res: await run({ page_budget: 2 }, { structurePages: { meeting: pagesOf(many) } }) },
    { name: "tag listing at the page budget", marker: /^Found 30 Meetings tagged "product"/m, counts: null,
      notes: ["Note: listing stopped at the page budget — read 1 pages (100 summaries)", "Note: showing the first 30 of 100"],
      res: await run({ tag: "product", page_budget: 1 }, { base: { search: { product: PRODUCT_TAG_HIT } }, tagPages: { [TAG_PRODUCT]: pagesOf(many) } }) },
    { name: "rate-stopped listing, short-circuit (partial none)", marker: /\(no matching Meetings in the part of the listing that was read\)$/m, counts: null,
      notes: ["Note: rate limit reached while listing — read 0 page(s)"],
      res: await run({}, { structurePages: { meeting: [{ fail: slow }] } }) },
    { name: "rate-stopped listing, stage 2 (partial none)", marker: /\(no matching Meetings in the part of the listing that was read\)$/m, counts: null,
      notes: ["Note: rate limit reached while listing — read 0 page(s)"],
      res: await run({ sort: SORT_DATE_DESC }, { structurePages: { meeting: [{ fail: slow }] } }) },
    { name: "unreadable page (HTML 200)", marker: /\(no matching Meetings in the part/m, counts: null,
      notes: ["Note: listing stopped after 0 page(s) because a page could not be read ("],
      res: await run({}, { structurePages: { meeting: [{ html: "<!doctype html>" }] } }) },
    { name: "listing error with a long multi-line body (capped detail)", marker: /could not be read \(API error 500: x{20}/, counts: null,
      notes: ["Note: listing stopped after 1 page(s) because a page could not be read (API error 500: xxx", "Note: showing the first 30 of 100"],
      res: await run({}, { structurePages: { meeting: onePageThenFail(100, { status: 500, text: longBody }) } }) },
    { name: "no cursor", marker: /^Found 30 Meetings/m, counts: null,
      notes: ["Note: the listing reported more pages but returned no usable cursor — read 1 page(s)", "Note: showing the first 30 of 40"],
      res: await run({}, { structurePages: { meeting: [{ results: forty, hasMore: true, nextCursor: null }] } }) },
    { name: "short-circuit row cap, undated (listing-order line)", marker: /\(None of the 40 candidate titles carries a date, so the 30 kept/m, counts: null,
      notes: ["Note: showing the first 30 of 40 matching Meetings (limit)"],
      res: await run({}, { structurePages: { meeting: pagesOf(forty) } }) },
    { name: "fetch_cap, search-rank order (extremum caveat)", marker: /\(Sorted within the 2 candidates read only/m, counts: null,
      notes: ["Note: fetched the first 2 of 5 candidates (fetch_cap) in search-rank order; raise fetch_cap"],
      res: await run({ title_hint: "Note", sort: SORT_DATE_DESC, fetch_cap: 2 }, { base: { search: { Note: five } } }) },
    { name: "fetch_cap, enumerated, most recent first", marker: /\(Sorted within the 5 candidates read only/m, counts: null,
      notes: ["Note: fetched the first 5 of 40 candidates (fetch_cap) most recent first by title date"],
      res: await run({ sort: SORT_DATE_DESC, fetch_cap: 5 }, { structurePages: { meeting: pagesOf(fortyDated) } }) },
    { name: "fetch_cap, enumerated, oldest first", marker: /\(Sorted within the 5 candidates read only/m, counts: null,
      notes: ["Note: fetched the first 5 of 40 candidates (fetch_cap) oldest first by title date"],
      res: await run({ sort: SORT_DATE_ASC, fetch_cap: 5 }, { structurePages: { meeting: pagesOf(fortyDated) } }) },
    { name: "fetch_cap, enumerated, undated (listing order + listing-order line)", marker: /\(None of the 40 candidate titles carries a date, so the 5 kept/m, counts: null,
      notes: ["Note: fetched the first 5 of 40 candidates (fetch_cap) in listing order"],
      res: await run({ sort: SORT_DATE_DESC, fetch_cap: 5 }, { structurePages: { meeting: pagesOf(forty) } }) },
    { name: "fetch_cap over filters (sampling body, nothing errored)", marker: /\(none of the 2 candidates read matched the filters — 3 were not fetched\)$/m, counts: null,
      notes: ["Note: fetched the first 2 of 5 candidates (fetch_cap) in search-rank order"],
      res: await run({ title_hint: "Note", fetch_cap: 2, filters: { Status: "Done" } }, { base: { search: { Note: five } } }) },
    { name: "errored candidate alone", marker: /^\*\*Weekly Review\*\*\nID: m2$/m, counts: null,
      notes: ["Note: 1 candidate(s) could not be read and were skipped."],
      res: await run({ title_hint: "Weekly Review", sort: SORT_DATE_DESC },
        { base: { search: { "Weekly Review": [mixed[0], { id: "m2", title: "Weekly Review", structureId: "meeting" }] }, getFail: { m1: { status: 500, text: "boom" } } } }) },
    { name: "errored + fetch_cap (sampling body names both)", marker: /\(none of the 1 candidate read matched the filters — 2 could not be read, 2 were not fetched\)$/m, counts: null,
      notes: ["Note: fetched the first 3 of 5 candidates (fetch_cap)", "Note: 2 candidate(s) could not be read and were skipped."],
      res: await run({ title_hint: "Note", fetch_cap: 3, filters: { Status: "Done" } },
        { base: { search: { Note: five }, getFail: { m1: { status: 500, text: "boom" }, m2: { status: 500, text: "boom" } } } }) },
    { name: "errored + stage-2 rate stop", marker: /\(Sorted within the 1 candidate read only/m, counts: ["2", "5"],
      notes: ["Note: rate budget reached — checked 2 of 5 candidates", "Note: 1 candidate(s) could not be read and were skipped."],
      res: await run({ title_hint: "Note", sort: SORT_DATE_DESC }, { base: { search: { Note: five }, getFail: { m1: { status: 500, text: "boom" }, m3: slow } } }) },
    { name: "stage-2 rate stop on the first GET", marker: /\(none of the 0 candidates read/m, counts: ["0", "3"],
      notes: ["Note: rate budget reached — checked 0 of 3 candidates"],
      res: await run({ title_hint: "Note", sort: SORT_DATE_DESC }, { base: { search: { Note: five.slice(0, 3) }, getFail: { m1: slow } } }) },
    // The stage-2 rate Note is the ONLY carrier of the phrase, with plain-integer
    // counts — 1200 must not render as "1,200" (U6). 1200 undated titles keep id
    // order, so the second GET is uid(2).
    { name: "stage-2 rate stop over 1200", marker: /\(Sorted within the 1 candidate read only/m, counts: ["1", "1200"],
      notes: ["Note: rate budget reached — checked 1 of 1200 candidates"],
      res: await run({ sort: SORT_DATE_DESC }, { structurePages: { meeting: pagesOf(summaries(1, 1200, n => `Sync ${n}`)) }, base: { getFail: { [uid(2)]: slow } } }) },
    // Page budget THEN a stage-2 rate stop: the phrase carries stage-2 counts (200
    // candidates), never pages (2) or summaries (250).
    { name: "page budget + stage-2 rate stop", marker: /\(Sorted within the 1 candidate read only/m, counts: ["1", "200"],
      notes: ["Note: listing stopped at the page budget — read 2 pages", "Note: rate budget reached — checked 1 of 200 candidates"],
      res: await run({ sort: SORT_DATE_DESC, page_budget: 2 }, { structurePages: { meeting: pagesOf(many) }, base: { getFail: { [uid(2)]: slow } } }) },
    { name: "request budget clamps pages and fetches", marker: /\(Sorted within the 30 candidates read only/m, counts: null,
      notes: ["Note: listing stopped at the page budget (14 pages, clamped from 25 by the per-call request budget of 45)",
              "Note: fetched the first 30 of 1400 candidates (per-call request budget of 45) in listing order; narrow the seed."],
      res: await run({ page_budget: 25, fetch_cap: 50, sort: SORT_DATE_DESC }, { structurePages: { meeting: pagesOf(huge) } }) },
    { name: "request budget clamps fetches after a failed listing call", marker: /\(Sorted within the 42 candidates read only/m, counts: null,
      notes: ["Note: listing stopped after 1 page(s) because a page could not be read (API error 500: boom)",
              "Note: fetched the first 42 of 100 candidates (per-call request budget of 45)"],
      res: await run({ sort: SORT_DATE_DESC, fetch_cap: 50 }, { structurePages: { meeting: onePageThenFail(100, { status: 500, text: "boom" }) } }) },
    { name: "escalation at the page budget", marker: /read 2 pages \(200 summaries\)/, counts: null,
      notes: ["Note: listing stopped at the page budget — read 2 pages", "Note: showing the first 30 of 200"],
      res: await run({ title_hint: "Sync", page_budget: 2 }, { base: { search: { Sync: many.slice(0, 50) } }, structurePages: { meeting: pagesOf(many) } }) },
    { name: "escalation, rate-stopped listing, zero matches (partial none)", marker: /\(no matching Meetings in the part of the listing that was read\)$/m, counts: null,
      notes: ["Note: rate limit reached while listing — read 0 page(s)"],
      res: await run({ title_hint: "Retro" }, { base: { search: { Retro: summaries(1001, 1050, n => `Planning ${n}`) } }, structurePages: { meeting: [{ fail: slow }] } }) }
  ];

  // Preconditions first, and unanchored so a line that gained a "Note: " prefix
  // still matches — a marker that broke would turn a contract failure into a
  // fixture failure. Without the marker a row could silently test another shape.
  for (const row of [...complete, ...partial]) {
    assert.equal(row.res.isError, undefined, `${row.name}: ${row.res.content[0].text}`);
    assert.match(row.res.content[0].text, row.marker, `${row.name}: fixture did not produce its shape:\n${row.res.content[0].text}`);
  }
  for (const row of complete) {
    const text = row.res.content[0].text as string;
    assert.equal(paIncomplete(text), false, `${row.name} must read complete:\n${text}`);
    assert.deepEqual(noteLines(text), [], `${row.name}: no Note line`);
  }
  for (const row of partial) {
    const text = row.res.content[0].text as string;
    assert.equal(paIncomplete(text), true, `${row.name} must read incomplete:\n${text}`);
    assert.match(text, PA_NOTE_RE, `${row.name}: incompleteness is always a Note: line`);
    const m = text.match(PA_COUNTS_RE);
    assert.deepEqual(m ? [m[1], m[2]] : null, row.counts, `${row.name}: count phrase`);
    // Exactly the expected Notes, in order — so an informational line that turned
    // into a Note is caught even in a shape that already carries real Notes.
    const notes = noteLines(text);
    assert.equal(notes.length, row.notes.length, `${row.name}: Note lines:\n${notes.join("\n")}`);
    row.notes.forEach((p, i) => assert.ok(notes[i].startsWith(p), `${row.name}: Note ${i} = ${notes[i]}`));
  }
  for (const row of [...complete, ...partial]) {
    const text = row.res.content[0].text as string;
    // Any count phrase is the stage-2 rate Note, and N/M are what stage 2 reports
    // as considered/seed_size — never pages or summaries.
    for (const line of text.split("\n").filter(l => PA_COUNTS_RE.test(l))) {
      assert.ok(line.startsWith("Note: rate budget reached — checked "), `${row.name}: count phrase outside the rate Note: ${line}`);
      const m = line.match(PA_COUNTS_RE)!;
      assert.deepEqual([Number(m[1]), Number(m[2])], [exactnessOf(row.res).considered, exactnessOf(row.res).seed_size], `${row.name}: N/M`);
    }
    // PA's verdict agrees with the structured exactness on every shape.
    const sc = exactnessOf(row.res);
    assert.equal(paIncomplete(text), !(sc.seed_complete && sc.candidates_complete), `${row.name}: PA verdict vs the exactness block`);
    // PA reads content[0] today; the JSON block must not trip its parser either,
    // in case a consumer ever joins every text block (cap-ul0).
    const json = row.res.content[1].text as string;
    assert.doesNotMatch(json, PA_NOTE_RE, `${row.name}: content[1] carries no Note: line`);
    assert.doesNotMatch(json, PA_COUNTS_RE, `${row.name}: content[1] carries no count phrase`);
  }

  const canaryRow = complete[complete.length - 1];
  assert.equal(canaryRow.stderr!.length, 1, "the canary fired");
  assert.match(canaryRow.stderr![0], new RegExp(`fidelity canary: 1 .*${uid(5000)}`));
  assert.doesNotMatch(canaryRow.res.content[0].text, /canary/, "the canary stays out of the tool text");
  // The hit the listing missed is still returned (final-review I1), as an ordinary row.
  assert.match(canaryRow.res.content[0].text, new RegExp(`^ID: ${uid(5000)}$`, "m"));
});

// === cap-i93 final-review fixes =============================================

// 45 title hits sorting LATE in id order, behind 250 unrelated rows, plus 5
// semantic extras: the search saturates (50 raw) and escalates, and a partial
// listing reads none of the hits (final-review I1, probe p1).
const WEEKLY = summaries(5001, 5045, n => `Weekly Sync ${n - 5000}`);
const WEEKLY_SEARCH = [...WEEKLY, ...summaries(6001, 6005, n => `Planning ${n}`)];
const WEEKLY_LISTING = [...summaries(1, 250, n => `Standup ${n}`), ...WEEKLY];
const WEEKLY_PARTIALS: [string, any, PageSpec[], RegExp][] = [
  ["page budget", { page_budget: 2 }, pagesOf(WEEKLY_LISTING), /^Note: listing stopped at the page budget — read 2 pages \(200 summaries\)/m],
  ["429 on listing page 1", {}, [{ fail: { status: 429, text: "<!doctype html>banned" } }], /^Note: rate limit reached while listing — read 0 page\(s\)/m]
];

test("find_objects: a PARTIAL escalation still returns every title match its own search found (I1) — page budget and a page-1 429", async () => {
  for (const [name, extra, pages, note] of WEEKLY_PARTIALS) {
    const handler = getFind();
    installFind(enumRouter({ base: { search: { "Weekly Sync": WEEKLY_SEARCH } }, structurePages: { meeting: pages } }));
    const res = await handler({ structure: "Meeting", title_hint: "Weekly Sync", limit: 100, ...extra });
    assert.equal(res.isError, undefined, name);
    const text = res.content[0].text;
    // Precondition: no hit came from the listing, so every one shown came from the search.
    assert.ok(!text.includes("Standup"), `${name}: fixture: the listing read no title match`);
    assert.match(text, /^Found 45 Meetings matching "Weekly Sync"/m, name);
    for (const w of WEEKLY) assert.ok(text.includes(`ID: ${w.id}`), `${name}: ${w.title} returned`);
    assert.ok(!text.includes(uid(6001)), `${name}: a semantic extra is still not a candidate`);
    assert.match(text, note, `${name}: the stage-1 Note stays`);
    assert.equal(exactnessOf(res).seed_method, "search+enumeration", name);
    assert.equal(exactnessOf(res).seed_complete, false, `${name}: the listing really was partial`);
    assert.equal(exactnessOf(res).seed_size, 45, `${name}: seed_size counts the union`);
  }
});

test("find_objects: a PARTIAL escalation with a sort GETs the search's title matches in stage 2 (I1)", async () => {
  const want = new Set(WEEKLY.map(w => w.id));
  for (const [name, extra, pages, note] of WEEKLY_PARTIALS) {
    // Fake clock: 30 GETs equals the object window.
    const handler = getFind(fakeClock());
    const calls = installFind(enumRouter({ base: { search: { "Weekly Sync": WEEKLY_SEARCH } }, structurePages: { meeting: pages } }));
    const res = await handler({ structure: "Meeting", title_hint: "Weekly Sync", sort: SORT_DATE_DESC, ...extra });
    assert.equal(res.isError, undefined, name);
    const got = fetchedIds(calls);
    assert.equal(got.length, 30, `${name}: fetch_cap default`);
    assert.ok(got.every(id => want.has(id)), `${name}: every GET is a search title match`);
    assert.match(res.content[0].text, note, name);
    assert.match(res.content[0].text, /^Note: fetched the first 30 of 45 candidates \(fetch_cap\)/m, name);
    assert.equal(exactnessOf(res).seed_size, 45, name);
  }
});

test("find_objects: a COMPLETE listing missing a search title match still returns it, deduped, and the canary still reports it (I1)", async () => {
  // 21 title matches (Retro 1..20 + Retro 5000) + 29 extras = 50 raw → escalates.
  const search = [...summaries(1, 20, n => `Retro ${n}`), { id: uid(5000), title: "Retro 5000", structureId: "meeting" },
    ...summaries(1001, 1029, n => `Planning ${n}`)];
  const listing = [...summaries(1, 25, n => `Retro ${n}`), ...summaries(26, 35, n => `Other ${n}`)];
  const handler = getFind();
  installFind(enumRouter({ base: { search: { Retro: search } }, structurePages: { meeting: pagesOf(listing) } }));
  const r = await captureStderr<any>(() => handler({ structure: "Meeting", title_hint: "Retro" }));
  const text = r.value.content[0].text;
  assert.equal(exactnessOf(r.value).seed_complete, true);
  assert.ok(text.includes(`ID: ${uid(5000)}`), "the hit the listing missed is returned");
  // 25 listed + 1 search-only: Retro 1..20 sit in both and are counted once.
  assert.equal(exactnessOf(r.value).seed_size, 26);
  assert.match(text, /^Found 26 Meetings matching "Retro"/m);
  assert.equal(r.lines.length, 1, "the canary still reports the disagreement");
  assert.match(r.lines[0], new RegExp(`fidelity canary: 1 .*${uid(5000)}`));
  assert.doesNotMatch(text, /^[ \t]*Note:/im);
});

test("find_objects: a caller limit on the zero-GET path gives the SAME completeness signals as with a sort (I2, D3)", async () => {
  const three = summaries(1, 3, n => `Kickoff ${n}`);
  const signals: Record<string, any> = {};
  for (const [name, extra] of [["no sort", {}], ["sort Title", { sort: { by: "Title", order: "asc" } }]] as [string, any][]) {
    const handler = getFind();
    const calls = installFind(enumRouter({ structurePages: { meeting: pagesOf(three) } }));
    const res = await handler({ structure: "Meeting", limit: 2, ...extra });
    assert.equal(res.isError, undefined, name);
    const text = res.content[0].text;
    // Precondition: the two calls really took the two paths.
    assert.equal(fetchedIds(calls).length, name === "no sort" ? 0 : 3, `${name}: path taken`);
    const sc = exactnessOf(res);
    signals[name] = {
      notes: noteLines(text), limitLine: /^\(showing 2 of 3 matches — limit\)$/m.test(text),
      seed_complete: sc.seed_complete, candidates_complete: sc.candidates_complete, matched: sc.matched, returned: sc.returned
    };
  }
  const want = { notes: [], limitLine: true, seed_complete: true, candidates_complete: true, matched: 3, returned: 2 };
  assert.deepEqual(signals, { "no sort": want, "sort Title": want });

  // Known-positive: the DEFAULT row cap is a real "you did not see everything".
  const handler = getFind();
  installFind(enumRouter({ structurePages: { meeting: pagesOf(summaries(1, 40, n => `Kickoff ${n}`)) } }));
  const res = await handler({ structure: "Meeting" });
  assert.match(res.content[0].text, /^Note: showing the first 30 of 40 matching Meetings \(limit\)/m);
  assert.doesNotMatch(res.content[0].text, /^\(showing \d+ of \d+ matches — limit\)$/m);
  assert.equal(exactnessOf(res).candidates_complete, false);
});

test("find_objects: the page-budget Note offers raising page_budget only below its maximum (M1)", async () => {
  const big = summaries(1, 2600, n => `Sync ${n}`);   // 26 pages
  let handler = getFind();
  let calls = installFind(enumRouter({ structurePages: { meeting: pagesOf(big) } }));
  let text = (await handler({ structure: "Meeting", page_budget: PAGE_BUDGET_MAX })).content[0].text;
  assert.equal(enumCalls(calls).length, PAGE_BUDGET_MAX, "fixture: stopped at the maximum, not clamped");
  assert.match(text, /^Note: listing stopped at the page budget — read 25 pages \(2500 summaries\) and more remain; results may be incomplete\. Narrow the seed \(title_hint or tag\)\.$/m);
  assert.doesNotMatch(text, /raise page_budget/);
  // Known-positive: below the maximum the advice stands.
  handler = getFind();
  calls = installFind(enumRouter({ structurePages: { meeting: pagesOf(big) } }));
  text = (await handler({ structure: "Meeting", page_budget: 2 })).content[0].text;
  assert.match(text, /Narrow the seed \(title_hint or tag\) or raise page_budget \(max 25\)\.$/m);
});

test("find_objects: a direct call with a non-finite page_budget or fetch_cap gets the default, not an unbounded run (M2)", async () => {
  const big = summaries(1, 2000, n => `Sync ${n}`);   // 20 pages
  // NaN page_budget, short-circuit: the default 12 pages.
  let handler = getFind();
  let calls = installFind(enumRouter({ structurePages: { meeting: pagesOf(big) } }));
  let res = await handler({ structure: "Meeting", page_budget: NaN });
  assert.equal(enumCalls(calls).length, PAGE_BUDGET_DEFAULT);
  assert.equal(exactnessOf(res).seed_complete, false);

  // NaN fetch_cap with a sort: NaN would poison the fetch reserve (pages) and the
  // fetch plan (zero GETs); the default 30 gives 45 - 1 - 30 = 14 pages and 30 GETs.
  const clock = fakeClock();
  handler = getFind(clock);
  calls = installFind(enumRouter({ structurePages: { meeting: pagesOf(big) } }));
  res = await handler({ structure: "Meeting", sort: SORT_DATE_DESC, page_budget: 25, fetch_cap: NaN });
  assert.equal(res.isError, undefined);
  assert.equal(enumCalls(calls).length, 14);
  assert.equal(fetchedIds(calls).length, 30);
  assert.ok(calls.length <= MAX_REQUESTS_PER_CALL);
});

// Copied from personal-assistant scripts/backfill_meeting_titles.py:125 (_ENTRY_RE), verified at 146a349.
const PA_ENTRY_RE = /^\*\*(?<title>.*?)\*\*[ \t]*\r?\n[ \t]*ID:[ \t]*(?<id>\S+)[ \t]*\r?\n(?:[ \t]*Date:[ \t]*(?<date>[^\r\n]*)\r?\n)?/gm;
const paEntries = (t: string) => [...(t.endsWith("\n") ? t : t + "\n").matchAll(PA_ENTRY_RE)].map(m => ({ title: m.groups!.title.trim(), id: m.groups!.id }));

test("find_objects: a null or empty title renders as (untitled) on both row renderers, and PA still parses the entry (M4)", async () => {
  const rows: any[] = [
    { id: uid(1), title: null, structureId: "meeting" },
    { id: uid(2), title: "", structureId: "meeting" },
    { id: uid(3), title: "Kickoff", structureId: "meeting" }
  ];
  for (const [name, extra] of [["short-circuit", {}], ["stage 2", { sort: { by: "Title", order: "asc" } }]] as [string, any][]) {
    const handler = getFind();
    installFind(enumRouter({ structurePages: { meeting: pagesOf(rows) } }));
    const text = (await handler({ structure: "Meeting", ...extra })).content[0].text;
    assert.doesNotMatch(text, /\*\*null\*\*|\*\*\*\*/, name);
    const entries = paEntries(text);
    assert.deepEqual(entries.map(e => e.id).sort(), [uid(1), uid(2), uid(3)], `${name}: PA parses every entry`);
    for (const id of [uid(1), uid(2)]) assert.equal(entries.find(e => e.id === id)!.title, "(untitled)", `${name}: ${id}`);
    assert.equal(entries.find(e => e.id === uid(3))!.title, "Kickoff", `${name}: a real title is untouched`);
  }
});

// === cap-fvb: stage-2 circuit breaker =======================================
// A Cloudflare ban can arrive as a 403; every further GET extends an IP-level ban
// that also takes other consumers on the same egress down. Assert on the number
// of GETs actually issued, not only on the output text.

function fiveNotes() {
  return [1, 2, 3, 4, 5].map(n => ({ id: `m${n}`, title: "Note", structureId: "meeting" }));
}

test("find_objects: a 403 on the first stage-2 GET stops the loop at once — exactly 1 GET, a stop Note, candidates incomplete (cap-fvb)", async () => {
  const handler = getFind();
  const calls = installFind(findRouter({
    search: { Note: fiveNotes() },
    getFail: { m1: { status: 403, text: "<!doctype html>\nAccess denied" } }
  }));
  const res = await handler({ structure: "Meeting", title_hint: "Note", sort: SORT_DATE_DESC });
  assert.equal(res.isError, undefined);
  assert.deepEqual(fetchedIds(calls), ["m1"], "no GET after the 403");
  const text = res.content[0].text as string;
  const stop = text.split("\n").find(l => l.startsWith("Note: stopped reading candidates after"));
  assert.ok(stop, `stop Note present:\n${text}`);
  assert.match(stop!, /403/);
  assert.match(stop!, /results may be incomplete\.$/);
  assert.doesNotMatch(text, PA_COUNTS_RE, "the stop Note never uses the reserved rate-budget phrase");
  assert.match(text, /^Note: 1 candidate\(s\) could not be read and were skipped\.$/m);
  const ex = exactnessOf(res);
  assert.equal(ex.candidates_complete, false);
  assert.equal(ex.errored, 1);
  assert.equal(ex.considered, 1, "no request was made after the stop");
});

test("find_objects: three consecutive non-rate failures stop the loop — exactly 3 GETs (cap-fvb)", async () => {
  const handler = getFind();
  const boom = { status: 500, text: "boom" };
  const calls = installFind(findRouter({
    search: { Note: fiveNotes() },
    getFail: { m1: boom, m2: boom, m3: boom }
  }));
  const res = await handler({ structure: "Meeting", title_hint: "Note", sort: SORT_DATE_DESC });
  assert.equal(res.isError, undefined);
  assert.deepEqual(fetchedIds(calls), ["m1", "m2", "m3"]);
  const text = res.content[0].text as string;
  assert.match(text, /^Note: stopped reading candidates after 3 consecutive read errors \(API error 500: boom\); results may be incomplete\.$/m);
  assert.doesNotMatch(text, PA_COUNTS_RE);
  assert.doesNotMatch(text, /fetched the first/, "the loop stopped; the fetch_cap Note would misstate what was read");
  const ex = exactnessOf(res);
  assert.equal(ex.candidates_complete, false);
  assert.equal(ex.errored, 3);
  assert.equal(ex.considered, 3);
});

test("find_objects: a success resets the failure run — fail, ok, fail, fail, ok reads all five, no stop Note (cap-fvb)", async () => {
  const handler = getFind();
  const boom = { status: 500, text: "boom" };
  const calls = installFind(findRouter({
    search: { Note: fiveNotes() },
    getFail: { m1: boom, m3: boom, m4: boom }
  }));
  const res = await handler({ structure: "Meeting", title_hint: "Note", sort: SORT_DATE_DESC });
  assert.deepEqual(fetchedIds(calls), ["m1", "m2", "m3", "m4", "m5"]);
  const text = res.content[0].text as string;
  assert.doesNotMatch(text, /stopped reading candidates/);
  assert.match(text, /^Note: 3 candidate\(s\) could not be read and were skipped\.$/m);
  assert.equal(exactnessOf(res).considered, 5);
});

// === cap-9ti: strict date grammar in filters ================================
// Date.parse accepts "2026" and other short forms, which compiled a date-equals
// filter with day="2026" that silently matched nothing.

test("compileFilters: a date that does not begin YYYY-MM-DD is a problem for equals, after and before (cap-9ti)", async () => {
  installSearch({});
  const idx = buildPropertyIndex(meetingStructure());
  for (const bad of ["2026", "2026-07", "July 4 2026"]) {
    assert.ok(!Number.isNaN(Date.parse(bad)), `fixture: Date.parse accepts ${bad} (else the test proves nothing)`);
    for (const value of [bad, { after: bad }, { before: bad }]) {
      const { compiled, problems } = await compileFilters(findClient(), idx, { Date: value } as any, { remainingMs: 60000 });
      assert.deepEqual(compiled, [], `${JSON.stringify(value)} must not compile`);
      assert.equal(problems.length, 1, `${JSON.stringify(value)}: ${problems.join(" | ")}`);
      assert.match(problems[0], /is not a valid ISO date \(YYYY-MM-DD or full timestamp\): /);
      assert.ok(problems[0].endsWith(bad), `the problem names the value: ${problems[0]}`);
    }
  }
});

test("compileFilters: YYYY-MM-DD and a full timestamp still compile for equals, after and before (cap-9ti)", async () => {
  installSearch({});
  const idx = buildPropertyIndex(meetingStructure());
  for (const good of ["2026-07-04", "2026-07-04T09:00:00Z"]) {
    for (const value of [good, { after: good }, { before: good }, { after: good, before: "2026-12-31" }]) {
      const { compiled, problems } = await compileFilters(findClient(), idx, { Date: value } as any, { remainingMs: 60000 });
      assert.deepEqual(problems, [], `${JSON.stringify(value)}`);
      assert.equal(compiled.length, 1);
    }
  }
  const { compiled } = await compileFilters(findClient(), idx, { Date: "2026-07-04" }, { remainingMs: 60000 });
  assert.equal((compiled[0] as any).day, "2026-07-04");
});

test("compileFilters: a well-shaped but impossible date is still rejected by Date.parse (cap-9ti)", async () => {
  installSearch({});
  const idx = buildPropertyIndex(meetingStructure());
  const { compiled, problems } = await compileFilters(findClient(), idx, { Date: "2026-13-45" }, { remainingMs: 60000 });
  assert.deepEqual(compiled, []);
  assert.match(problems[0], /is not a valid ISO date/);
});

// === cap-dnf: briefError shares the client's first-line logic ===============

test("find_objects: a listing error Note skips leading blank lines, splits CR-only bodies, never splits a surrogate, and neutralises the count phrase (cap-dnf)", async () => {
  const cases: [string, string, (detail: string) => void][] = [
    ["leading blank line", "\n\n  <!doctype html>  \n<p>x</p>", d => assert.equal(d, "API error 503: <!doctype html>")],
    ["CR-only", "first\rLATER-LINE-MARKER\r", d => assert.equal(d, "API error 503: first")],
    ["surrogate at the cut", "a".repeat(184) + "😀".repeat(20), d => {
      assert.ok(d.endsWith("…"), d);
      assert.doesNotMatch(d, /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/, "no lone high surrogate");
      assert.equal(Array.from(d).length, 201);
    }],
    ["forged count phrase", "checked 7 of 7 candidates", d => assert.doesNotMatch(d, PA_COUNTS_RE)]
  ];
  for (const [name, text, check] of cases) {
    const handler = getFind();
    installFind(enumRouter({ structurePages: { meeting: onePageThenFail(3, { status: 503, text }) } }));
    const res = await handler({ structure: "Meeting" });
    const out = res.content[0].text as string;
    const note = out.split("\n").find((l: string) => l.startsWith("Note: listing stopped after"));
    assert.ok(note, `${name}: Note present:\n${out}`);
    const detail = note!.match(/could not be read \((.*)\); results may be incomplete\.$/)?.[1];
    assert.ok(detail !== undefined, `${name}: ${note}`);
    assert.notEqual(detail, "unknown error", name);
    check(detail!);
    assert.ok(!out.includes("LATER-LINE-MARKER"), `${name}: no later line`);
    assert.doesNotMatch(out, PA_COUNTS_RE, `${name}: no count phrase anywhere`);
  }
});

// === cap-0ot: minors parked during the split ===============================

// IDs of the rendered rows, in output order.
const rowIds = (text: string) => [...text.matchAll(/^ID: (\S+)$/gm)].map(m => m[1]);

test("find_objects: a search hit of another structure is never a candidate — plain search path (cap-0ot a)", async () => {
  const handler = getFind();
  const calls = installFind(findRouter({ search: { Retro: [
    { id: "m1", title: "Retro 1", structureId: "meeting" },
    { id: "p1", title: "Retro notes", structureId: "page" },   // the server ignored structureIds
    { id: "m2", title: "Retro 2", structureId: "meeting" }
  ] } }));
  const res = await handler({ structure: "Meeting", title_hint: "Retro", sort: SORT_DATE_DESC });
  assert.equal(res.isError, undefined);
  assert.deepEqual(fetchedIds(calls), ["m1", "m2"], "the foreign hit is never fetched");
  assert.ok(!res.content[0].text.includes("p1"), "nor shown");
  assert.equal(exactnessOf(res).seed_size, 2);

  // Zero-GET path too: the foreign hit is not listed.
  const h2 = getFind();
  installFind(findRouter({ search: { Retro: [
    { id: "m1", title: "Retro 1", structureId: "meeting" },
    { id: "p1", title: "Retro notes", structureId: "page" }
  ] } }));
  const res2 = await h2({ structure: "Meeting", title_hint: "Retro" });
  assert.deepEqual(rowIds(res2.content[0].text), ["m1"]);
  assert.equal(exactnessOf(res2).seed_size, 1);
});

test("find_objects: a search hit of another structure is never a candidate — escalated-union path (cap-0ot a)", async () => {
  const handler = getFind();
  // 50 raw hits, so the search escalates; the listing (partial) holds none of them.
  const search = [
    ...summaries(1001, 1048, n => `Retro ${n}`),
    { id: uid(1049), title: "Retro foreign", structureId: "page" },
    ...summaries(1050, 1050, n => `Retro ${n}`)
  ];
  const listing = summaries(1, 200, n => `Other ${n}`);
  installFind(enumRouter({ base: { search: { Retro: search } }, structurePages: { meeting: pagesOf(listing) } }));
  const res = await handler({ structure: "Meeting", title_hint: "Retro", page_budget: 1, limit: 100 });
  assert.equal(res.isError, undefined);
  assert.equal(exactnessOf(res).seed_method, "search+enumeration", "fixture: the search escalated");
  const ids = rowIds(res.content[0].text);
  assert.ok(ids.includes(uid(1050)), "an in-structure search hit is kept");
  assert.ok(!ids.includes(uid(1049)), "the foreign search hit is not");
  assert.equal(exactnessOf(res).seed_size, 49);
});

test("find_objects: the escalated union lists listing rows first, then search-only hits in search order (cap-0ot b)", async () => {
  const handler = getFind();
  // Undated titles, so title-date ordering is a stable no-op and the union order shows.
  const search = summaries(1001, 1050, n => `Retro ${n}`).reverse();   // rank order != id order
  const listing = [...summaries(1, 3, n => `Retro ${n}`), ...summaries(4, 150, n => `Other ${n}`)];
  installFind(enumRouter({ base: { search: { Retro: search } }, structurePages: { meeting: pagesOf(listing) } }));
  const res = await handler({ structure: "Meeting", title_hint: "Retro", page_budget: 1, limit: 100 });
  assert.equal(exactnessOf(res).seed_method, "search+enumeration", "fixture: the search escalated");
  assert.deepEqual(rowIds(res.content[0].text), [uid(1), uid(2), uid(3), ...search.map(h => h.id)]);
});

test("find_objects: a direct call with limit NaN behaves like an omitted limit on both paths (cap-0ot c)", async () => {
  const rows = summaries(1, 40, n => `Sync - ${new Date(Date.UTC(2025, 0, n)).toISOString().slice(0, 10)}`);
  // Zero-GET path: the default row cap, with its Note.
  for (const limit of [undefined, NaN]) {
    const handler = getFind();
    installFind(enumRouter({ structurePages: { meeting: pagesOf(rows) } }));
    const res = await handler({ structure: "Meeting", limit });
    const text = res.content[0].text;
    assert.match(text, /^Found 30 Meetings/, `limit ${limit}`);
    assert.match(text, /^Note: showing the first 30 of 40 matching Meetings \(limit\)/m, `limit ${limit}`);
    assert.equal(exactnessOf(res).returned, 30, `limit ${limit}`);
  }
  // Stage-2 path: no slice at all.
  for (const limit of [undefined, NaN]) {
    const handler = getFind(fakeClock());
    installFind(enumRouter({ structurePages: { meeting: pagesOf(rows.slice(0, 10)) } }));
    const res = await handler({ structure: "Meeting", sort: SORT_DATE_DESC, limit });
    assert.match(res.content[0].text, /^Found 10 Meetings/, `limit ${limit}`);
    assert.equal(exactnessOf(res).returned, 10, `limit ${limit}`);
    assert.equal(exactnessOf(res).matched, 10, `limit ${limit}`);
  }
});

test("find_objects: a direct call with fetch_cap 500 fetches at most FETCH_CAP_MAX (cap-0ot d)", async () => {
  const clock = fakeClock();
  const handler = getFind(clock);
  const calls = installFind(enumRouter({ base: { search: { Retro: summaries(1, 49, n => `Retro ${n}`) } } }));
  const res = await handler({ structure: "Meeting", title_hint: "Retro", fetch_cap: 500, sort: SORT_DATE_DESC });
  assert.equal(res.isError, undefined);
  assert.ok(fetchedIds(calls).length <= FETCH_CAP_MAX, `${fetchedIds(calls).length} GETs`);
});

test("find_objects: a pretty-printed JSON error body reaches a Note compacted, not as a lone '{' (cap-0ot e)", async () => {
  const handler = getFind();
  const body = JSON.stringify({ code: "bad_request", message: "nope", details: [{ path: "id" }] }, null, 2);
  assert.ok(body.includes("\n"), "fixture is multi-line");
  const fail = { status: 400, text: body };
  installFind(findRouter({ search: { Note: fiveNotes() }, getFail: { m1: fail, m2: fail, m3: fail } }));
  const res = await handler({ structure: "Meeting", title_hint: "Note", sort: SORT_DATE_DESC });
  const text = res.content[0].text as string;
  assert.match(text, /^Note: stopped reading candidates after 3 consecutive read errors \(API error 400: \{"code":"bad_request","message":"nope","details":\[\{"path":"id"\}\]\}\); results may be incomplete\.$/m);
});

// === cap-dnf review I1: a 403 ban page stops stage 2 through the rate path ==

test("find_objects: a 403 Cloudflare ban on the first GET stops stage 2 via the rate Note — exactly 1 GET (I1)", async () => {
  const handler = getFind();
  const ban = "<!DOCTYPE html>\n<h1>Error 1015</h1>\n<p>The owner of this website has banned you temporarily.</p>";
  const calls = installFind(findRouter({ search: { Note: fiveNotes() }, getFail: { m1: { status: 403, text: ban } } }));
  const res = await handler({ structure: "Meeting", title_hint: "Note", sort: SORT_DATE_DESC });
  assert.equal(res.isError, undefined);
  assert.deepEqual(fetchedIds(calls), ["m1"]);
  const text = res.content[0].text as string;
  assert.match(text, /^Note: rate budget reached — checked 0 of 5 candidates/m);
  assert.doesNotMatch(text, /stopped reading candidates/);
  assert.equal(exactnessOf(res).candidates_complete, false);
});
