import { test } from "node:test";
import assert from "node:assert/strict";
import { CapacitiesClient } from "../src/client/capacities.js";
import { setupObjectTools } from "../src/tools/object.js";

// --- Mock fetch plumbing (mirrors test/capacities.test.ts) ----------------

interface CapturedCall {
  url: string;
  opts: any;
}

interface RouteResponse {
  ok?: boolean;
  status?: number;
  body?: unknown;
  text?: string;
  contentType?: string | null;
  contentLength?: string | null;
}

function makeResponse(init: RouteResponse) {
  const {
    ok = true,
    status = 200,
    contentType = "application/json",
    contentLength = null,
    body = {},
    text = ""
  } = init;
  const headers = {
    get(name: string): string | null {
      const key = name.toLowerCase();
      if (key === "content-type") return contentType;
      if (key === "content-length") return contentLength;
      return null;
    }
  };
  return {
    ok,
    status,
    headers,
    async json() {
      return body;
    },
    async text() {
      return text;
    }
  };
}

/**
 * Install a mock fetch that routes on url + method. `responder` receives the
 * captured call and returns a RouteResponse (or throws to signal a 4xx path
 * via makeResponse ok:false).
 */
function installFetch(responder: (call: CapturedCall) => RouteResponse) {
  const calls: CapturedCall[] = [];
  (globalThis as any).fetch = async (url: string, opts: any) => {
    const call = { url, opts };
    calls.push(call);
    return makeResponse(responder(call));
  };
  return calls;
}

function newClient() {
  return new CapacitiesClient({
    apiToken: "test-token",
    baseUrl: "https://api.capacities.io"
  });
}

// --- Minimal MCP server stub to capture the registered tool handler --------

interface RegisteredTool {
  name: string;
  config: any;
  handler: (args: any) => Promise<any>;
}

function makeServerStub() {
  const tools: Record<string, RegisteredTool> = {};
  const server: any = {
    registerTool(name: string, config: any, handler: any) {
      tools[name] = { name, config, handler };
    }
  };
  return { server, tools };
}

function getCreateObject() {
  const { server, tools } = makeServerStub();
  const client = newClient();
  setupObjectTools(server, client);
  return { handler: tools["create_object"].handler, client };
}

function getUpdateObject() {
  const { server, tools } = makeServerStub();
  const client = newClient();
  setupObjectTools(server, client);
  return { handler: tools["update_object"].handler, client };
}

function getTool(name: string) {
  const { server, tools } = makeServerStub();
  const client = newClient();
  setupObjectTools(server, client);
  return { handler: tools[name].handler, client };
}

// --- Shared structure fixture ---------------------------------------------

function structuresPayload() {
  return {
    structures: [
      {
        id: "RootTask",
        title: "Task",
        pluralName: "Tasks",
        labelColor: "blue",
        collections: [],
        propertyDefinitions: [
          { id: "title", name: "Title", type: "title", writable: true },
          { id: "note", name: "Note", type: "text", writable: true },
          { id: "due", name: "Due Date", type: "date", writable: true },
          { id: "active", name: "Active", type: "boolean", writable: true },
          {
            id: "status",
            name: "Status",
            type: "label",
            writable: true,
            multiple: false,
            labelSet: [
              { id: "s-backlog", name: "Backlog", color: "gray" },
              { id: "s-doing", name: "Doing", color: "yellow" },
              { id: "s-done", name: "Done", color: "green" }
            ]
          },
          {
            id: "tags",
            name: "Tags",
            type: "label",
            writable: true,
            multiple: true,
            labelSet: [
              { id: "t-a", name: "Alpha" },
              { id: "t-b", name: "Beta" }
            ]
          },
          {
            id: "assignee",
            name: "Assignee",
            type: "entity",
            writable: true,
            allowedStructures: ["person"]
          },
          { id: "count", name: "Count", type: "number", writable: false }
        ]
      },
      {
        id: "person",
        title: "Person",
        pluralName: "People",
        labelColor: "red",
        collections: [],
        propertyDefinitions: [
          { id: "title", name: "Name", type: "title", writable: true }
        ]
      }
    ]
  };
}

// Route helper: dispatch by endpoint. `search` maps a query to results,
// `createId` is the id returned by POST /object (the MAIN object).
function router(opts: {
  search?: Record<string, any[]>;
  createId?: string;
  createFail?: { status: number; text: string };
  onCreate?: (body: any) => void;
  // update_object plumbing:
  getObject?: any; // structured object returned by GET /object?id=
  getFail?: { status: number; text: string };
  updateId?: string;
  updateFail?: { status: number; text: string };
  onUpdate?: (body: any) => void;
  // thin-tool plumbing (cap-6dy.13):
  markdown?: { id: string; structureId: string; markdown: string }; // GET /object/markdown?id=
  markdownFail?: { status: number; text: string };
  deleteFail?: { status: number; text: string };
}) {
  return (call: CapturedCall): RouteResponse => {
    const method = call.opts?.method ?? "GET";
    if (call.url.endsWith("/space/structures")) {
      return { body: structuresPayload() };
    }
    // GET /object/markdown?id=… → object rendered as Markdown (get_object).
    if (call.url.includes("/object/markdown?id=") && method === "GET") {
      if (opts.markdownFail) {
        return { ok: false, status: opts.markdownFail.status, text: opts.markdownFail.text };
      }
      return {
        body:
          opts.markdown ?? { id: "obj-1", structureId: "RootTask", markdown: "" }
      };
    }
    // DELETE /object?id=…&hardDelete=… → soft/hard delete (delete_object).
    if (call.url.includes("/object?id=") && method === "DELETE") {
      if (opts.deleteFail) {
        return { ok: false, status: opts.deleteFail.status, text: opts.deleteFail.text };
      }
      return { status: 200, contentType: null, contentLength: "0" };
    }
    if (call.url.endsWith("/objects/search") && method === "POST") {
      const body = JSON.parse(call.opts.body);
      const results = opts.search?.[body.query] ?? [];
      return { body: { results } };
    }
    // GET /object?id=… → structured object read (update_object step 1).
    if (call.url.includes("/object?id=") && method === "GET") {
      if (opts.getFail) {
        return { ok: false, status: opts.getFail.status, text: opts.getFail.text };
      }
      return { body: opts.getObject ?? {} };
    }
    // PATCH /object → update.
    if (call.url.endsWith("/object") && method === "PATCH") {
      const body = JSON.parse(call.opts.body);
      if (opts.onUpdate) opts.onUpdate(body);
      if (opts.updateFail) {
        return { ok: false, status: opts.updateFail.status, text: opts.updateFail.text };
      }
      return {
        body: {
          id: opts.updateId ?? body.id,
          structureId: opts.getObject?.structureId ?? "RootTask",
          collections: [],
          properties: {},
          blocks: {}
        }
      };
    }
    if (call.url.endsWith("/object") && method === "POST") {
      const body = JSON.parse(call.opts.body);
      if (opts.onCreate) opts.onCreate(body);
      if (opts.createFail) {
        return { ok: false, status: opts.createFail.status, text: opts.createFail.text };
      }
      // Entity auto-create is title-only; give it a distinct id.
      const isEntityCreate = body.structureId === "person";
      return {
        body: {
          id: isEntityCreate ? "person-new" : opts.createId ?? "obj-1",
          structureId: body.structureId,
          collections: [],
          properties: {},
          blocks: {}
        }
      };
    }
    if (call.url.endsWith("/blocks/append") && method === "POST") {
      return { status: 200, contentType: null, contentLength: "0" };
    }
    throw new Error(`unexpected call: ${method} ${call.url}`);
  };
}

// A structured object fixture for GET /object?id=. `props` are typed wrappers.
function objectFixture(props: Record<string, any> = {}, structureId = "RootTask") {
  return {
    id: "obj-1",
    structureId,
    collections: [],
    properties: props,
    blocks: {}
  };
}

// --- 1. Happy path ---------------------------------------------------------

test("happy path: builds correct wrappers and appends body", async () => {
  const { handler } = getCreateObject();
  const calls = installFetch(
    router({
      search: { Alice: [{ id: "p-alice", title: "Alice", structureId: "person" }] },
      createId: "task-1"
    })
  );

  const res = await handler({
    structure_id: "RootTask",
    title: "My Task",
    properties: { note: "hello", due: "2026-07-10T12:00:00.000Z" },
    labels: { status: "Doing" },
    relations: { assignee: "Alice" },
    body: "some markdown body",
    create_missing_relations: false
  });

  assert.equal(res.isError, undefined);

  // Find the POST /object call
  const createCall = calls.find(
    c => c.url.endsWith("/object") && c.opts.method === "POST"
  );
  assert.ok(createCall, "POST /object must happen");
  const created = JSON.parse(createCall!.opts.body);
  assert.equal(created.structureId, "RootTask");

  const props = created.properties;
  assert.deepEqual(props.title, { type: "title", title: { value: "My Task" } });
  assert.deepEqual(props.note, { type: "text", text: { value: "hello" } });
  assert.deepEqual(props.due, {
    type: "date",
    date: { start: "2026-07-10T12:00:00.000Z", dateResolution: "time" }
  });
  assert.deepEqual(props.status, {
    type: "label",
    label: [{ id: "s-doing", name: "Doing" }]
  });
  assert.deepEqual(props.assignee, { type: "entity", entity: [{ id: "p-alice" }] });

  // /blocks/append must be called with {id, markdown}
  const appendCall = calls.find(c => c.url.endsWith("/blocks/append"));
  assert.ok(appendCall, "append must happen");
  const appendBody = JSON.parse(appendCall!.opts.body);
  assert.deepEqual(appendBody, { id: "task-1", markdown: "some markdown body" });
});

// --- 2. Unknown property ---------------------------------------------------

test("unknown property -> isError, no create", async () => {
  const { handler } = getCreateObject();
  const calls = installFetch(router({}));

  const res = await handler({
    structure_id: "RootTask",
    title: "T",
    properties: { nope: "x" },
    create_missing_relations: false
  });

  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /unknown property `nope`/);
  assert.equal(
    calls.some(c => c.url.endsWith("/object") && c.opts.method === "POST"),
    false,
    "no create must happen"
  );
});

// --- 3. Read-only property -------------------------------------------------

test("read-only property -> isError, no create", async () => {
  const { handler } = getCreateObject();
  const calls = installFetch(router({}));

  const res = await handler({
    structure_id: "RootTask",
    title: "T",
    properties: { count: 5 },
    create_missing_relations: false
  });

  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /`count` is read-only/);
  assert.equal(
    calls.some(c => c.url.endsWith("/object") && c.opts.method === "POST"),
    false
  );
});

// --- 4. Unknown label option ----------------------------------------------

test("unknown label option -> isError listing valid names, no create", async () => {
  const { handler } = getCreateObject();
  const calls = installFetch(router({}));

  const res = await handler({
    structure_id: "RootTask",
    title: "T",
    labels: { status: "Nonexistent" },
    create_missing_relations: false
  });

  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /unknown option `Nonexistent` for `status`/);
  assert.match(res.content[0].text, /Backlog, Doing, Done/);
  assert.equal(
    calls.some(c => c.url.endsWith("/object") && c.opts.method === "POST"),
    false
  );
});

// --- 5. Single-select label with 2 names -----------------------------------

test("single-select label with 2 names -> isError, no create", async () => {
  const { handler } = getCreateObject();
  const calls = installFetch(router({}));

  const res = await handler({
    structure_id: "RootTask",
    title: "T",
    labels: { status: ["Doing", "Done"] },
    create_missing_relations: false
  });

  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /`status` is single-select/);
  assert.equal(
    calls.some(c => c.url.endsWith("/object") && c.opts.method === "POST"),
    false
  );
});

// --- 6. Relation unmatched, create=false -----------------------------------

test("relation unmatched with create_missing_relations:false -> isError, no create", async () => {
  const { handler } = getCreateObject();
  const calls = installFetch(router({ search: { Ghost: [] } }));

  const res = await handler({
    structure_id: "RootTask",
    title: "T",
    relations: { assignee: "Ghost" },
    create_missing_relations: false
  });

  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /unresolved `assignee` names: Ghost/);
  assert.equal(
    calls.some(c => c.url.endsWith("/object") && c.opts.method === "POST"),
    false
  );
});

// --- 7. Relation unmatched, create=true -> createEntity fires --------------

test("relation unmatched with create_missing_relations:true -> creates entity then links", async () => {
  const { handler } = getCreateObject();
  const createBodies: any[] = [];
  const calls = installFetch(
    router({
      search: { Newbie: [] },
      createId: "task-1",
      onCreate: b => createBodies.push(b)
    })
  );

  const res = await handler({
    structure_id: "RootTask",
    title: "T",
    relations: { assignee: "Newbie" },
    create_missing_relations: true
  });

  assert.equal(res.isError, undefined);

  // Two POST /object calls: the title-only person, then the main task.
  const objectCreates = calls.filter(
    c => c.url.endsWith("/object") && c.opts.method === "POST"
  );
  assert.equal(objectCreates.length, 2, "entity create + main create");

  // The entity create is a title-only person.
  const entityCreate = createBodies.find(b => b.structureId === "person");
  assert.ok(entityCreate);
  assert.deepEqual(entityCreate.properties.title, {
    type: "title",
    title: { value: "Newbie" }
  });

  // The main create links the created id.
  const mainCreate = createBodies.find(b => b.structureId === "RootTask");
  assert.deepEqual(mainCreate.properties.assignee, {
    type: "entity",
    entity: [{ id: "person-new" }]
  });

  assert.match(res.content[0].text, /Created relation targets: Newbie/);
});

// --- 8. Relation ambiguous -------------------------------------------------

test("relation ambiguous -> isError, no main create", async () => {
  const { handler } = getCreateObject();
  const calls = installFetch(
    router({
      search: {
        Bob: [
          { id: "b1", title: "Bob", structureId: "person" },
          { id: "b2", title: "Bob", structureId: "person" }
        ]
      }
    })
  );

  const res = await handler({
    structure_id: "RootTask",
    title: "T",
    relations: { assignee: "Bob" },
    create_missing_relations: false
  });

  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /ambiguous relation `Bob`/);
  assert.equal(
    calls.some(c => c.url.endsWith("/object") && c.opts.method === "POST"),
    false
  );
});

// --- 9. Structure not found ------------------------------------------------

test("structure not found -> isError", async () => {
  const { handler } = getCreateObject();
  const calls = installFetch(router({}));

  const res = await handler({
    structure_id: "Nope",
    title: "T",
    create_missing_relations: false
  });

  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /not found/);
  assert.match(res.content[0].text, /RootTask/);
  assert.equal(
    calls.some(c => c.url.endsWith("/object") && c.opts.method === "POST"),
    false
  );
});

// --- 10. Create 400 surfaced -----------------------------------------------

test("create 400 body is surfaced in isError text", async () => {
  const { handler } = getCreateObject();
  installFetch(
    router({
      createFail: { status: 400, text: "cap_invalid_input: bad structure" }
    })
  );

  const res = await handler({
    structure_id: "RootTask",
    title: "T",
    create_missing_relations: false
  });

  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /cap_invalid_input: bad structure/);
});

// --- 11. Multi-select label maps multiple option ids -----------------------

test("multi-select label maps multiple names to option ids", async () => {
  const { handler } = getCreateObject();
  const createBodies: any[] = [];
  installFetch(router({ onCreate: b => createBodies.push(b) }));

  const res = await handler({
    structure_id: "RootTask",
    title: "T",
    labels: { tags: ["Alpha", "Beta"] },
    create_missing_relations: false
  });

  assert.equal(res.isError, undefined);
  const main = createBodies.find(b => b.structureId === "RootTask");
  assert.deepEqual(main.properties.tags, {
    type: "label",
    label: [
      { id: "t-a", name: "Alpha" },
      { id: "t-b", name: "Beta" }
    ]
  });
});

// --- 12. Fail-before-create holds for auto-created relation targets --------

test("no orphan: a later validation problem aborts BEFORE any entity is auto-created", async () => {
  const { handler } = getCreateObject();
  const createBodies: any[] = [];
  // Search returns no match for "Ghost" -> unmatched -> would auto-create a person.
  // But an unknown label option is ALSO present, so validation must fail and
  // NOTHING (neither the person nor the main object) may be POSTed.
  const calls = installFetch(
    router({ search: { Ghost: [] }, onCreate: b => createBodies.push(b) })
  );

  const res = await handler({
    structure_id: "RootTask",
    title: "T",
    labels: { status: "Nope" }, // unknown option -> a problem
    relations: { assignee: "Ghost" }, // unmatched -> would auto-create
    create_missing_relations: true
  });

  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /unknown option `Nope`/);
  // The core guarantee: no POST /object happened at all — no orphaned person.
  const posts = calls.filter(
    c => c.url.endsWith("/object") && c.opts.method === "POST"
  );
  assert.equal(posts.length, 0, "must not create the entity target before the problem gate");
  assert.equal(createBodies.length, 0);
});

// --- 13. Boolean scalar coercion (code review fix #1) ----------------------

test("boolean scalar: string \"false\" writes false, not true", async () => {
  const { handler } = getCreateObject();
  const createBodies: any[] = [];
  installFetch(router({ onCreate: b => createBodies.push(b) }));

  const res = await handler({
    structure_id: "RootTask",
    title: "T",
    properties: { active: "false" },
    create_missing_relations: false
  });

  assert.equal(res.isError, undefined);
  const main = createBodies.find(b => b.structureId === "RootTask");
  assert.deepEqual(main.properties.active, { type: "boolean", boolean: { value: false } });
});

test("boolean scalar: string \"true\" writes true", async () => {
  const { handler } = getCreateObject();
  const createBodies: any[] = [];
  installFetch(router({ onCreate: b => createBodies.push(b) }));

  const res = await handler({
    structure_id: "RootTask",
    title: "T",
    properties: { active: "true" },
    create_missing_relations: false
  });

  assert.equal(res.isError, undefined);
  const main = createBodies.find(b => b.structureId === "RootTask");
  assert.deepEqual(main.properties.active, { type: "boolean", boolean: { value: true } });
});

test("boolean scalar: actual boolean true writes true", async () => {
  const { handler } = getCreateObject();
  const createBodies: any[] = [];
  installFetch(router({ onCreate: b => createBodies.push(b) }));

  const res = await handler({
    structure_id: "RootTask",
    title: "T",
    properties: { active: true },
    create_missing_relations: false
  });

  assert.equal(res.isError, undefined);
  const main = createBodies.find(b => b.structureId === "RootTask");
  assert.deepEqual(main.properties.active, { type: "boolean", boolean: { value: true } });
});

test("boolean scalar: unparseable string -> isError, no create", async () => {
  const { handler } = getCreateObject();
  const calls = installFetch(router({}));

  const res = await handler({
    structure_id: "RootTask",
    title: "T",
    properties: { active: "maybe" },
    create_missing_relations: false
  });

  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /`active` value is not a boolean/);
  assert.equal(
    calls.some(c => c.url.endsWith("/object") && c.opts.method === "POST"),
    false,
    "no create must happen"
  );
});

// --- 14. Numeric date rejected, only ISO strings parsed (code review fix #2) -

test("date scalar: numeric value is rejected, nothing written", async () => {
  const { handler } = getCreateObject();
  const calls = installFetch(router({}));

  const res = await handler({
    structure_id: "RootTask",
    title: "T",
    properties: { due: 20260710 },
    create_missing_relations: false
  });

  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /`due` date must be an ISO-8601 string/);
  assert.equal(
    calls.some(c => c.url.endsWith("/object") && c.opts.method === "POST"),
    false,
    "no create must happen"
  );
});

test("date scalar: valid ISO string writes the correct date", async () => {
  const { handler } = getCreateObject();
  const createBodies: any[] = [];
  installFetch(router({ onCreate: b => createBodies.push(b) }));

  const res = await handler({
    structure_id: "RootTask",
    title: "T",
    properties: { due: "2026-07-10T00:00:00Z" },
    create_missing_relations: false
  });

  assert.equal(res.isError, undefined);
  const main = createBodies.find(b => b.structureId === "RootTask");
  assert.deepEqual(main.properties.due, {
    type: "date",
    date: { start: "2026-07-10T00:00:00.000Z", dateResolution: "time" }
  });
});

test("date scalar: unparseable string -> isError, no create", async () => {
  const { handler } = getCreateObject();
  const calls = installFetch(router({}));

  const res = await handler({
    structure_id: "RootTask",
    title: "T",
    properties: { due: "not-a-date" },
    create_missing_relations: false
  });

  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /`due` value is not a valid date/);
  assert.equal(
    calls.some(c => c.url.endsWith("/object") && c.opts.method === "POST"),
    false
  );
});

// --- 15. Orphaned relation targets are reported transparently (fix #3) -----

test("relation target creation failure mid-batch -> isError names created entities, notes reuse, main object not created", async () => {
  const { handler } = getCreateObject();
  const calls: CapturedCall[] = [];
  let entityCreateCount = 0;
  (globalThis as any).fetch = async (url: string, opts: any) => {
    const call = { url, opts };
    calls.push(call);
    const method = opts?.method ?? "GET";
    if (url.endsWith("/space/structures")) {
      return makeResponse({ body: structuresPayload() });
    }
    if (url.endsWith("/objects/search") && method === "POST") {
      // Neither name resolves -> both are unmatched -> both queued for auto-create.
      return makeResponse({ body: { results: [] } });
    }
    if (url.endsWith("/object") && method === "POST") {
      const body = JSON.parse(opts.body);
      entityCreateCount += 1;
      if (entityCreateCount === 1) {
        // First entity target creates fine.
        return makeResponse({
          body: {
            id: "person-1",
            structureId: body.structureId,
            collections: [],
            properties: {},
            blocks: {}
          }
        });
      }
      // Second entity target hits a transient failure.
      return makeResponse({ ok: false, status: 500, text: "cap_internal: transient failure" });
    }
    throw new Error(`unexpected call: ${method} ${url}`);
  };

  const res = await handler({
    structure_id: "RootTask",
    title: "T",
    relations: { assignee: ["Newbie1", "Newbie2"] },
    create_missing_relations: true
  });

  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /Failed while creating relation targets/);
  assert.match(res.content[0].text, /Newbie1/);
  assert.match(res.content[0].text, /reused/i);
  assert.match(res.content[0].text, /not created/i);
  // The parent object itself must never be created — only the two entity
  // creation attempts (one success, one failure) hit POST /object.
  const posts = calls.filter(
    c => c.url.endsWith("/object") && c.opts.method === "POST"
  );
  assert.equal(posts.length, 2, "only the two entity-create attempts, no main create");
});

// === update_object ==========================================================

// --- U1. Happy path: title + scalar + label-by-name ------------------------

test("update_object: PATCHes only the named props with correct wrappers", async () => {
  const { handler } = getUpdateObject();
  const updateBodies: any[] = [];
  const calls = installFetch(
    router({
      getObject: objectFixture({}, "RootTask"),
      onUpdate: b => updateBodies.push(b)
    })
  );

  const res = await handler({
    id: "obj-1",
    title: "Renamed Task",
    properties: { note: "updated" },
    labels: { status: "Done" },
    create_missing_relations: false
  });

  assert.equal(res.isError, undefined);

  const patchCall = calls.find(
    c => c.url.endsWith("/object") && c.opts.method === "PATCH"
  );
  assert.ok(patchCall, "PATCH /object must happen");
  const patched = JSON.parse(patchCall!.opts.body);
  assert.equal(patched.id, "obj-1");

  const props = patched.properties;
  assert.deepEqual(props.title, { type: "title", title: { value: "Renamed Task" } });
  assert.deepEqual(props.note, { type: "text", text: { value: "updated" } });
  assert.deepEqual(props.status, { type: "label", label: [{ id: "s-done", name: "Done" }] });
  // Only the named props are present — nothing else was written.
  assert.deepEqual(Object.keys(props).sort(), ["note", "status", "title"]);

  assert.match(res.content[0].text, /Updated Task obj-1/);
});

// --- U2. Replace-audit surfaced --------------------------------------------

test("update_object: replace-audit reports prior values for multi-value props", async () => {
  const { handler } = getUpdateObject();
  // Prior: assignee already links two people; tags already has Alpha.
  const prior = objectFixture(
    {
      assignee: { type: "entity", entity: [{ id: "p-1" }, { id: "p-2" }] },
      tags: { type: "label", label: [{ id: "t-a", name: "Alpha" }] }
    },
    "RootTask"
  );
  installFetch(
    router({
      getObject: prior,
      search: { Alice: [{ id: "p-alice", title: "Alice", structureId: "person" }] }
    })
  );

  const res = await handler({
    id: "obj-1",
    relations: { assignee: "Alice" },
    labels: { tags: ["Beta"] },
    create_missing_relations: false
  });

  assert.equal(res.isError, undefined);
  // Entity replace-audit is a count (structured value carries ids, not titles).
  assert.match(res.content[0].text, /replaced Assignee: 2 linked → 1 linked/);
  // Label replace-audit shows prior option names → new.
  assert.match(res.content[0].text, /replaced Tags: Alpha → Beta/);
});

// --- U3. Unknown / read-only property -> isError, no PATCH -----------------

test("update_object: unknown property -> isError, no PATCH", async () => {
  const { handler } = getUpdateObject();
  const calls = installFetch(router({ getObject: objectFixture({}, "RootTask") }));

  const res = await handler({
    id: "obj-1",
    properties: { nope: "x" },
    create_missing_relations: false
  });

  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /unknown property `nope`/);
  assert.equal(
    calls.some(c => c.url.endsWith("/object") && c.opts.method === "PATCH"),
    false,
    "no PATCH must happen"
  );
});

test("update_object: read-only property -> isError, no PATCH", async () => {
  const { handler } = getUpdateObject();
  const calls = installFetch(router({ getObject: objectFixture({}, "RootTask") }));

  const res = await handler({
    id: "obj-1",
    properties: { count: 5 },
    create_missing_relations: false
  });

  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /`count` is read-only/);
  assert.equal(
    calls.some(c => c.url.endsWith("/object") && c.opts.method === "PATCH"),
    false
  );
});

// --- U4. Strict relation unmatched (create=false) -> isError, no PATCH ------

test("update_object: unmatched relation with create=false -> isError, no PATCH", async () => {
  const { handler } = getUpdateObject();
  const calls = installFetch(
    router({ getObject: objectFixture({}, "RootTask"), search: { Ghost: [] } })
  );

  const res = await handler({
    id: "obj-1",
    relations: { assignee: "Ghost" },
    create_missing_relations: false
  });

  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /unresolved `assignee` names: Ghost/);
  assert.equal(
    calls.some(c => c.url.endsWith("/object") && c.opts.method === "PATCH"),
    false
  );
});

// --- U5a. create_missing_relations:true -> creates target then links --------

test("update_object: create_missing_relations:true creates the target then links in PATCH", async () => {
  const { handler } = getUpdateObject();
  const createBodies: any[] = [];
  const updateBodies: any[] = [];
  const calls = installFetch(
    router({
      getObject: objectFixture({}, "RootTask"),
      search: { Newbie: [] },
      onCreate: b => createBodies.push(b),
      onUpdate: b => updateBodies.push(b)
    })
  );

  const res = await handler({
    id: "obj-1",
    relations: { assignee: "Newbie" },
    create_missing_relations: true
  });

  assert.equal(res.isError, undefined);

  // Exactly one POST /object (the title-only person target).
  const posts = calls.filter(
    c => c.url.endsWith("/object") && c.opts.method === "POST"
  );
  assert.equal(posts.length, 1, "one entity create");
  const entityCreate = createBodies.find(b => b.structureId === "person");
  assert.ok(entityCreate);
  assert.deepEqual(entityCreate.properties.title, {
    type: "title",
    title: { value: "Newbie" }
  });

  // The PATCH links the created id.
  assert.equal(updateBodies.length, 1);
  assert.deepEqual(updateBodies[0].properties.assignee, {
    type: "entity",
    entity: [{ id: "person-new" }]
  });
  assert.match(res.content[0].text, /Created relation targets: Newbie/);
});

// --- U5b. Regression: co-occurring problem aborts before any entity create --

test("update_object: a co-occurring problem aborts BEFORE any entity is auto-created", async () => {
  const { handler } = getUpdateObject();
  const createBodies: any[] = [];
  const calls = installFetch(
    router({
      getObject: objectFixture({}, "RootTask"),
      search: { Ghost: [] },
      onCreate: b => createBodies.push(b)
    })
  );

  const res = await handler({
    id: "obj-1",
    labels: { status: "Nope" }, // unknown option -> a problem
    relations: { assignee: "Ghost" }, // unmatched -> would auto-create
    create_missing_relations: true
  });

  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /unknown option `Nope`/);
  // No POST /object and no PATCH /object may happen.
  const posts = calls.filter(
    c => c.url.endsWith("/object") && c.opts.method === "POST"
  );
  assert.equal(posts.length, 0, "must not create the entity target before the problem gate");
  assert.equal(createBodies.length, 0);
  assert.equal(
    calls.some(c => c.url.endsWith("/object") && c.opts.method === "PATCH"),
    false
  );
});

// --- U6. GET 404 / object not found -> isError, no PATCH -------------------

test("update_object: GET 404 -> isError, no PATCH", async () => {
  const { handler } = getUpdateObject();
  const calls = installFetch(
    router({ getFail: { status: 404, text: "cap_not_found: no such object" } })
  );

  const res = await handler({
    id: "missing",
    title: "X",
    create_missing_relations: false
  });

  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /cap_not_found: no such object/);
  assert.equal(
    calls.some(c => c.url.endsWith("/object") && c.opts.method === "PATCH"),
    false
  );
});

// --- U7. Body appended via /blocks/append after PATCH ----------------------

test("update_object: body is appended via /blocks/append after PATCH", async () => {
  const { handler } = getUpdateObject();
  const calls = installFetch(
    router({ getObject: objectFixture({}, "RootTask") })
  );

  const res = await handler({
    id: "obj-1",
    title: "New Title",
    body: "some notes",
    create_missing_relations: false
  });

  assert.equal(res.isError, undefined);

  // PATCH happened before append.
  const patchIdx = calls.findIndex(
    c => c.url.endsWith("/object") && c.opts.method === "PATCH"
  );
  const appendIdx = calls.findIndex(c => c.url.endsWith("/blocks/append"));
  assert.ok(patchIdx >= 0 && appendIdx >= 0);
  assert.ok(appendIdx > patchIdx, "append must follow the PATCH");

  const appendBody = JSON.parse(calls[appendIdx].opts.body);
  assert.deepEqual(appendBody, { id: "obj-1", markdown: "some notes" });
  assert.match(res.content[0].text, /Body: appended/);
});

// --- U8. No-op update ------------------------------------------------------

test("update_object: no fields provided -> friendly no-op, no GET/PATCH", async () => {
  const { handler } = getUpdateObject();
  const calls = installFetch(router({}));

  const res = await handler({ id: "obj-1", create_missing_relations: false });

  assert.equal(res.isError, undefined);
  assert.match(res.content[0].text, /Nothing to update/);
  assert.equal(calls.length, 0, "no network calls for a no-op");
});

// === Thin object tools (cap-6dy.13) =========================================

// --- T1. append_to_object --------------------------------------------------

test("append_to_object: POSTs /blocks/append with exactly {id, markdown}", async () => {
  const { handler } = getTool("append_to_object");
  const calls = installFetch(router({}));

  const res = await handler({ id: "obj-1", markdown: "some notes" });

  assert.equal(res.isError, undefined);
  const appendCall = calls.find(c => c.url.endsWith("/blocks/append"));
  assert.ok(appendCall, "POST /blocks/append must happen");
  assert.equal(appendCall!.opts.method, "POST");
  const body = JSON.parse(appendCall!.opts.body);
  assert.deepEqual(body, { id: "obj-1", markdown: "some notes" });
  assert.match(res.content[0].text, /obj-1/);
});

// --- T2. get_object --------------------------------------------------------

test("get_object: GETs /object/markdown?id= (url-encoded) and returns the markdown", async () => {
  const { handler } = getTool("get_object");
  const calls = installFetch(
    router({
      markdown: {
        id: "obj a/b",
        structureId: "RootTask",
        markdown: "---\ntitle: My Task\n---\n\nBody here"
      }
    })
  );

  const res = await handler({ id: "obj a/b" });

  assert.equal(res.isError, undefined);
  const getCall = calls.find(
    c => c.url.includes("/object/markdown?id=") && (c.opts?.method ?? "GET") === "GET"
  );
  assert.ok(getCall, "GET /object/markdown must happen");
  // id must be url-encoded in the query string.
  assert.match(getCall!.url, /\/object\/markdown\?id=obj%20a%2Fb$/);
  assert.match(res.content[0].text, /Body here/);
});

// --- T3. delete_object default (soft) --------------------------------------

test("delete_object: default hard_delete=false → DELETE with hardDelete=false, trash confirmation", async () => {
  const { handler } = getTool("delete_object");
  const calls = installFetch(router({}));

  const res = await handler({ id: "obj-1", hard_delete: false });

  assert.equal(res.isError, undefined);
  const delCall = calls.find(c => c.opts?.method === "DELETE");
  assert.ok(delCall, "DELETE /object must happen");
  assert.match(delCall!.url, /\/object\?id=obj-1&hardDelete=false$/);
  assert.match(res.content[0].text, /trash|recoverable/i);
});

// --- T4. delete_object hard --------------------------------------------------

test("delete_object: hard_delete=true → DELETE with hardDelete=true, permanent confirmation", async () => {
  const { handler } = getTool("delete_object");
  const calls = installFetch(router({}));

  const res = await handler({ id: "obj-1", hard_delete: true });

  assert.equal(res.isError, undefined);
  const delCall = calls.find(c => c.opts?.method === "DELETE");
  assert.ok(delCall, "DELETE /object must happen");
  assert.match(delCall!.url, /\/object\?id=obj-1&hardDelete=true$/);
  assert.match(res.content[0].text, /permanent/i);
});

// --- T5. error path: get_object 404 surfaced -------------------------------

test("get_object: non-ok response → isError with surfaced body", async () => {
  const { handler } = getTool("get_object");
  installFetch(
    router({ markdownFail: { status: 404, text: "cap_not_found: no such object" } })
  );

  const res = await handler({ id: "missing" });

  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /cap_not_found: no such object/);
});
