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
}) {
  return (call: CapturedCall): RouteResponse => {
    const method = call.opts?.method ?? "GET";
    if (call.url.endsWith("/space/structures")) {
      return { body: structuresPayload() };
    }
    if (call.url.endsWith("/objects/search") && method === "POST") {
      const body = JSON.parse(call.opts.body);
      const results = opts.search?.[body.query] ?? [];
      return { body: { results } };
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
