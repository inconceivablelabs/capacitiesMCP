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
