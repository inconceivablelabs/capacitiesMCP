import { test } from "node:test";
import assert from "node:assert/strict";
import { CapacitiesClient } from "../src/client/capacities.js";
import { setupWebLinkTools } from "../src/tools/weblink.js";

// --- Mock fetch plumbing (mirrors test/object.test.ts) ---------------------

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

function getSaveWeblink() {
  const { server, tools } = makeServerStub();
  const client = newClient();
  setupWebLinkTools(server, client);
  return { handler: tools["save_weblink"].handler, client };
}

// /object/url returns a CapacitiesObject: `id` is top-level, but title and
// description are nested under `properties` — NOT top-level (code review fix #5).
function weblinkObjectFixture() {
  return {
    id: "wl-1",
    structureId: "MediaWebResource",
    collections: [],
    properties: {
      title: { type: "title", title: { value: "Auto-fetched Title" } },
      description: { type: "text", text: { value: "Auto-fetched description" } }
    },
    blocks: {}
  };
}

// --- save_weblink success message (code review fix #5) ---------------------

test("save_weblink: with title/description overrides, success text reports the PROVIDED values, not '(auto-generated)'", async () => {
  const { handler } = getSaveWeblink();
  installFetch(() => ({ body: weblinkObjectFixture() }));

  const res = await handler({
    url: "https://example.com",
    title: "Q3 Planning",
    description: "Custom desc"
  });

  assert.equal(res.isError, undefined);
  assert.match(res.content[0].text, /Q3 Planning/);
  assert.match(res.content[0].text, /Custom desc/);
  assert.doesNotMatch(res.content[0].text, /\(auto-generated\)/);
});

test("save_weblink: without title/description, success text shows '(auto-generated)' for both", async () => {
  const { handler } = getSaveWeblink();
  installFetch(() => ({ body: weblinkObjectFixture() }));

  const res = await handler({ url: "https://example.com" });

  assert.equal(res.isError, undefined);
  assert.match(res.content[0].text, /\*\*Title:\*\* \(auto-generated\)/);
  assert.match(res.content[0].text, /\*\*Description:\*\* \(auto-generated\)/);
  assert.match(res.content[0].text, /\*\*ID:\*\* wl-1/);
});
