import { test } from "node:test";
import assert from "node:assert/strict";
import { CapacitiesClient } from "../src/client/capacities.js";
import { setupContextTools } from "../src/tools/context.js";

// cap-9cg: link_to_context / unlink_from_context. Synthetic ids/titles only.

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
  const { ok = true, status = 200, contentType = "application/json", contentLength = null, body = {}, text = "" } = init;
  return {
    ok,
    status,
    headers: {
      get(name: string): string | null {
        const key = name.toLowerCase();
        if (key === "content-type") return contentType;
        if (key === "content-length") return contentLength;
        return null;
      }
    },
    async json() {
      return body;
    },
    async text() {
      return text;
    }
  };
}

function installFetch(responder: (call: CapturedCall) => RouteResponse) {
  const calls: CapturedCall[] = [];
  (globalThis as any).fetch = async (url: string, opts: any) => {
    const call = { url, opts };
    calls.push(call);
    return makeResponse(responder(call));
  };
  return calls;
}

function getTool(name: string) {
  const tools: Record<string, any> = {};
  const server: any = {
    registerTool(n: string, config: any, handler: any) {
      tools[n] = { config, handler };
    }
  };
  const client = new CapacitiesClient({ apiToken: "test-token", baseUrl: "https://api.capacities.io" });
  setupContextTools(server, client);
  return tools[name];
}

const TASK = "task-1111";
const TARGET = "person-2222";

function obj(id: string, structureId: string, title: string, blocks: Record<string, unknown[]> = {}) {
  return {
    id,
    structureId,
    collections: [],
    properties: { title: { type: "title", title: { value: title } } },
    blocks
  };
}

function entity(id: string, entityId: string) {
  return { id, type: "EntityBlock", entityId };
}

const method = (c: CapturedCall) => c.opts?.method ?? "GET";
const isAppend = (c: CapturedCall) => c.url.endsWith("/blocks/append") && method(c) === "POST";
const isDelete = (c: CapturedCall) => c.url.includes("/block?") && method(c) === "DELETE";

function router(opts: {
  objects: Record<string, any>;
  appendResponse?: RouteResponse;
  deleteFailOn?: string; // blockId whose DELETE fails
}) {
  return (call: CapturedCall): RouteResponse => {
    const m = method(call);
    const get = call.url.match(/\/object\?id=([^&]+)$/);
    if (get && m === "GET") {
      const o = opts.objects[decodeURIComponent(get[1])];
      if (!o) return { ok: false, status: 404, text: "cap_not_found: synthetic" };
      return { body: o };
    }
    if (isAppend(call)) return opts.appendResponse ?? { contentType: null, contentLength: "0" };
    if (isDelete(call)) {
      const blockId = new URL(call.url).searchParams.get("blockId");
      if (blockId === opts.deleteFailOn) return { ok: false, status: 500, text: "boom" };
      return { body: { id: "x" } };
    }
    throw new Error(`unexpected call: ${m} ${call.url}`);
  };
}

// --- link_to_context --------------------------------------------------------

test("link_to_context: same id rejected with ZERO fetches", async () => {
  const calls = installFetch(router({ objects: {} }));
  const res = await getTool("link_to_context").handler({ task_id: TASK, object_id: TASK });
  assert.equal(res.isError, true);
  assert.equal(calls.length, 0);
});

test("link_to_context: non-task rejected naming the structure, nothing written", async () => {
  const calls = installFetch(
    router({ objects: { [TASK]: obj(TASK, "RootPage", "Synthetic Page"), [TARGET]: obj(TARGET, "person", "Pat Example") } })
  );
  const res = await getTool("link_to_context").handler({ task_id: TASK, object_id: TARGET });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /RootPage/);
  assert.equal(calls.filter(c => method(c) !== "GET").length, 0, "no write");
});

test("link_to_context: request body sent on append is exactly {id, blocks:[{type:'EntityBlock', entityId}]}; confirmed from the response", async () => {
  const calls = installFetch(
    router({
      objects: {
        [TASK]: obj(TASK, "RootTask", "Synthetic Task"),
        [TARGET]: obj(TARGET, "person", "Pat Example", { notes: [entity("old", "other")] })
      },
      appendResponse: { body: obj(TARGET, "person", "Pat Example", { notes: [entity("old", "other"), entity("new-blk", TASK)] }) }
    })
  );
  const res = await getTool("link_to_context").handler({ task_id: TASK, object_id: TARGET });

  assert.equal(res.isError, undefined);
  const appends = calls.filter(isAppend);
  assert.equal(appends.length, 1);
  assert.deepEqual(JSON.parse(appends[0].opts.body), {
    id: TARGET,
    blocks: [{ type: "EntityBlock", entityId: TASK }]
  });
  const text: string = res.content[0].text;
  assert.match(text, /Synthetic Task/);
  assert.match(text, /Pat Example/);
  assert.match(text, /new-blk/);
  assert.doesNotMatch(text, /not confirmed/);
});

test("link_to_context: nested EntityBlock (depth 2 inside a TextBlock) → already in Context, NO append", async () => {
  const calls = installFetch(
    router({
      objects: {
        [TASK]: obj(TASK, "RootTask", "Synthetic Task"),
        [TARGET]: obj(TARGET, "person", "Pat Example", {
          notes: [
            { id: "t1", type: "TextBlock", blocks: [{ id: "t2", type: "TextBlock", blocks: [entity("nested-blk", TASK)] }] }
          ]
        })
      }
    })
  );
  const res = await getTool("link_to_context").handler({ task_id: TASK, object_id: TARGET });

  assert.equal(res.isError, undefined);
  assert.equal(calls.filter(isAppend).length, 0, "must not POST /blocks/append");
  assert.match(res.content[0].text, /already in.*Context/i);
  assert.match(res.content[0].text, /nested-blk/);
});

test("link_to_context: embed in a SECOND block field → already in Context, NO append", async () => {
  const calls = installFetch(
    router({
      objects: {
        [TASK]: obj(TASK, "RootTask", "Synthetic Task"),
        [TARGET]: obj(TARGET, "person", "Pat Example", {
          notes: [entity("e1", "other")],
          agenda: [entity("second-field-blk", TASK)]
        })
      }
    })
  );
  const res = await getTool("link_to_context").handler({ task_id: TASK, object_id: TARGET });

  assert.equal(res.isError, undefined);
  assert.equal(calls.filter(isAppend).length, 0, "must not POST /blocks/append");
  assert.match(res.content[0].text, /second-field-blk/);
});

test("link_to_context: empty-body append response → success saying appended but not confirmed", async () => {
  installFetch(
    router({
      objects: { [TASK]: obj(TASK, "RootTask", "Synthetic Task"), [TARGET]: obj(TARGET, "person", "Pat Example") }
    })
  );
  const res = await getTool("link_to_context").handler({ task_id: TASK, object_id: TARGET });
  assert.equal(res.isError, undefined);
  assert.match(res.content[0].text, /not confirmed/);
});

test("link_to_context: target read 404 → isError with surfaced body, no append", async () => {
  const calls = installFetch(router({ objects: { [TASK]: obj(TASK, "RootTask", "Synthetic Task") } }));
  const res = await getTool("link_to_context").handler({ task_id: TASK, object_id: TARGET });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /API error 404: cap_not_found: synthetic/);
  assert.equal(calls.filter(isAppend).length, 0);
});

test("link_to_context: append failure → isError with the API message", async () => {
  installFetch(
    router({
      objects: { [TASK]: obj(TASK, "RootTask", "Synthetic Task"), [TARGET]: obj(TARGET, "person", "Pat Example") },
      appendResponse: { ok: false, status: 400, text: "bad block" }
    })
  );
  const res = await getTool("link_to_context").handler({ task_id: TASK, object_id: TARGET });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /API error 400: bad block/);
});

test("link_to_context: title falls back to the id when the title property is absent", async () => {
  const bare = { id: TARGET, structureId: "person", collections: [], properties: {}, blocks: {} };
  installFetch(
    router({
      objects: { [TASK]: obj(TASK, "RootTask", "Synthetic Task"), [TARGET]: bare },
      appendResponse: { body: { ...bare, blocks: { notes: [entity("nb", TASK)] } } }
    })
  );
  const res = await getTool("link_to_context").handler({ task_id: TASK, object_id: TARGET });
  assert.equal(res.isError, undefined);
  assert.match(res.content[0].text, new RegExp(TARGET));
});

// --- unlink_from_context ----------------------------------------------------

test("unlink_from_context: not embedded → 'not in Context; nothing removed', no DELETE", async () => {
  const calls = installFetch(router({ objects: { [TARGET]: obj(TARGET, "person", "Pat Example", { notes: [entity("e", "other")] }) } }));
  const res = await getTool("unlink_from_context").handler({ task_id: TASK, object_id: TARGET });
  assert.equal(res.isError, undefined);
  assert.match(res.content[0].text, /not in.*Context; nothing removed/i);
  assert.equal(calls.filter(isDelete).length, 0);
});

test("unlink_from_context: deletes BOTH duplicate embeds with the right query params", async () => {
  const calls = installFetch(
    router({
      objects: {
        [TARGET]: obj(TARGET, "person", "Pat Example", {
          notes: [entity("dup-1", TASK), { id: "g", type: "GroupBlock", blocks: [entity("dup-2", TASK)] }]
        })
      }
    })
  );
  const res = await getTool("unlink_from_context").handler({ task_id: TASK, object_id: TARGET });

  assert.equal(res.isError, undefined);
  const dels = calls.filter(isDelete).map(c => {
    const u = new URL(c.url);
    return { path: u.pathname, objectId: u.searchParams.get("objectId"), blockId: u.searchParams.get("blockId") };
  });
  assert.deepEqual(dels, [
    { path: "/block", objectId: TARGET, blockId: "dup-1" },
    { path: "/block", objectId: TARGET, blockId: "dup-2" }
  ]);
  assert.match(res.content[0].text, /Removed 2/);
});

test("unlink_from_context: partial DELETE failure → isError with the count removed before it", async () => {
  const calls = installFetch(
    router({
      objects: {
        [TARGET]: obj(TARGET, "person", "Pat Example", {
          notes: [entity("d1", TASK), entity("d2", TASK), entity("d3", TASK)]
        })
      },
      deleteFailOn: "d2"
    })
  );
  const res = await getTool("unlink_from_context").handler({ task_id: TASK, object_id: TARGET });

  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /removed 1 of 3/i);
  assert.match(res.content[0].text, /API error 500: boom/);
  assert.equal(calls.filter(isDelete).length, 2, "stops at the first failure");
});

test("unlink_from_context: target read failure → isError, no DELETE", async () => {
  const calls = installFetch(router({ objects: {} }));
  const res = await getTool("unlink_from_context").handler({ task_id: TASK, object_id: TARGET });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /cap_not_found: synthetic/);
  assert.equal(calls.filter(isDelete).length, 0);
});

test("context tools: text output only, no structuredContent", async () => {
  installFetch(router({ objects: { [TARGET]: obj(TARGET, "person", "Pat Example") } }));
  const res = await getTool("unlink_from_context").handler({ task_id: TASK, object_id: TARGET });
  assert.equal(res.structuredContent, undefined);
  assert.equal(res.content[0].type, "text");
});
