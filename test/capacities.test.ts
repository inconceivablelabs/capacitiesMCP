import { test } from "node:test";
import assert from "node:assert/strict";
import { CapacitiesClient } from "../src/client/capacities.js";

// --- Mock fetch plumbing -------------------------------------------------

interface CapturedCall {
  url: string;
  opts: any;
}

interface MockResponseInit {
  ok?: boolean;
  status?: number;
  contentType?: string | null;
  contentLength?: string | null;
  body?: unknown;      // parsed via json()
  text?: string;       // raw text
  jsonThrows?: boolean;
}

function makeResponse(init: MockResponseInit) {
  const {
    ok = true,
    status = 200,
    contentType = "application/json",
    contentLength = null,
    body = {},
    text = "",
    jsonThrows = false,
  } = init;

  const headers = {
    get(name: string): string | null {
      const key = name.toLowerCase();
      if (key === "content-type") return contentType;
      if (key === "content-length") return contentLength;
      return null;
    },
  };

  return {
    ok,
    status,
    headers,
    async json() {
      if (jsonThrows) throw new Error("invalid json");
      return body;
    },
    async text() {
      return text;
    },
  };
}

/**
 * Install a mock fetch that returns the given response(s). Returns the
 * captured-calls array so tests can assert on url/opts.
 */
function installFetch(responder: (call: CapturedCall) => any) {
  const calls: CapturedCall[] = [];
  (globalThis as any).fetch = async (url: string, opts: any) => {
    const call = { url, opts };
    calls.push(call);
    return responder(call);
  };
  return calls;
}

function newClient() {
  return new CapacitiesClient({
    apiToken: "test-token",
    baseUrl: "https://api.capacities.io",
  });
}

// --- makeRequest headers -------------------------------------------------

test("makeRequest sends the X-Capacities-Api-Version header", async () => {
  const calls = installFetch(() =>
    makeResponse({ body: { id: "s1", title: "Space", icon: { type: "emoji", val: "x" } } })
  );
  const client = newClient();
  await client.getSpaces();

  assert.equal(calls.length, 1);
  const headers = calls[0].opts.headers;
  assert.equal(headers["X-Capacities-Api-Version"], "0.1.0");
  assert.equal(headers["Authorization"], "Bearer test-token");
  assert.equal(headers["Content-Type"], "application/json");
});

// --- getSpaces -----------------------------------------------------------

test("getSpaces GETs /space and wraps the single space in an array", async () => {
  const space = { id: "space-1", title: "My Space", icon: { type: "emoji", val: "📚" } };
  const calls = installFetch(() => makeResponse({ body: space }));
  const client = newClient();

  const spaces = await client.getSpaces();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.capacities.io/space");
  assert.equal((calls[0].opts.method ?? "GET"), "GET");
  assert.ok(Array.isArray(spaces));
  assert.equal(spaces.length, 1);
  assert.deepEqual(spaces[0], space);
});

// --- getSpaceInfo --------------------------------------------------------

test("getSpaceInfo GETs /space/structures with no query string and parses new propertyDefinition shape", async () => {
  const payload = {
    structures: [
      {
        id: "struct-1",
        title: "Person",
        pluralName: "People",
        labelColor: "blue",
        propertyDefinitions: [
          { id: "p1", name: "Email", type: "text", writable: true },
        ],
        collections: [{ id: "c1", title: "Team" }],
      },
    ],
  };
  const calls = installFetch(() => makeResponse({ body: payload }));
  const client = newClient();

  // spaceId arg is kept for call-site compat but must be ignored (no query string)
  const info = await client.getSpaceInfo("ignored-space-id");

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.capacities.io/space/structures");
  assert.ok(!calls[0].url.includes("?"), "URL must not contain a query string");

  const prop = info.structures[0].propertyDefinitions[0];
  assert.equal(prop.name, "Email");
  assert.equal(prop.type, "text");
  assert.equal(prop.writable, true);
  assert.equal((prop as any).dataType, undefined);
});

// --- searchContent -------------------------------------------------------

test("searchContent makes exactly ONE POST /objects/search with query and NO spaceId, even when spaceIds passed", async () => {
  const calls = installFetch(() =>
    makeResponse({ body: { results: [{ id: "o1", structureId: "st1", title: "Hit" }] } })
  );
  const client = newClient();

  const results = await client.searchContent({
    query: "hello",
    spaceIds: ["sp-a", "sp-b", "sp-c"],
  });

  assert.equal(calls.length, 1, "must be a single request, no per-space loop");
  assert.equal(calls[0].url, "https://api.capacities.io/objects/search");
  assert.equal(calls[0].opts.method, "POST");

  const body = JSON.parse(calls[0].opts.body);
  assert.equal(body.query, "hello");
  assert.equal("spaceId" in body, false);
  assert.equal("spaceIds" in body, false);

  assert.equal(results.length, 1);
  assert.equal(results[0].id, "o1");
  assert.equal(results[0].structureId, "st1");
  assert.equal(results[0].title, "Hit");
  assert.equal((results[0] as any).spaceId, undefined);
});

// --- saveWeblink ---------------------------------------------------------

test("saveWeblink POSTs /object/url with body {url, markdown} and returns the created object", async () => {
  const created = {
    id: "obj-1",
    structureId: "st-weblink",
    collections: [],
    properties: {},
    blocks: {},
  };
  const calls = installFetch(() => makeResponse({ body: created }));
  const client = newClient();

  const result: any = await client.saveWeblink({
    spaceId: "ignored",
    url: "https://example.com",
    notes: "some note",
    title: "ignored title",
    description: "ignored desc",
    tags: ["ignored"],
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.capacities.io/object/url");
  assert.equal(calls[0].opts.method, "POST");

  const body = JSON.parse(calls[0].opts.body);
  assert.equal(body.url, "https://example.com");
  assert.equal(body.markdown, "some note");
  // Deferred fields must NOT be sent in this task
  assert.equal("spaceId" in body, false);
  assert.equal("tags" in body, false);
  assert.equal("titleOverwrite" in body, false);

  assert.equal(result.id, "obj-1");
  assert.equal(result.structureId, "st-weblink");
});

// --- saveToDailyNote -----------------------------------------------------

test("saveToDailyNote POSTs /blocks/daily-note/append with markdown+noTimeStamp, no spaceId/origin, empty 200 handled", async () => {
  const calls = installFetch(() =>
    // daily-note returns HTTP 200 with an EMPTY body
    makeResponse({ status: 200, contentType: null, contentLength: "0", body: {} })
  );
  const client = newClient();

  await client.saveToDailyNote({
    spaceId: "ignored",
    content: "today I learned",
    noTimestamp: true,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.capacities.io/blocks/daily-note/append");
  assert.equal(calls[0].opts.method, "POST");

  const body = JSON.parse(calls[0].opts.body);
  assert.equal(body.markdown, "today I learned");
  assert.equal(body.noTimeStamp, true);
  assert.equal("spaceId" in body, false);
  assert.equal("origin" in body, false);
});

test("saveToDailyNote defaults noTimeStamp to false when noTimestamp omitted", async () => {
  const calls = installFetch(() =>
    makeResponse({ status: 200, contentType: null, contentLength: "0" })
  );
  const client = newClient();

  await client.saveToDailyNote({ spaceId: "x", content: "c" });

  const body = JSON.parse(calls[0].opts.body);
  assert.equal(body.noTimeStamp, false);
});

// --- rate limiter path -> category mapping -------------------------------

test("getEndpointType maps v2 paths to correct categories (incl. /object/url before /object)", async () => {
  const client: any = newClient();
  const map = (endpoint: string) => client.getEndpointType(endpoint);

  assert.equal(map("/space"), "space");
  assert.equal(map("/space/structures"), "space");
  assert.equal(map("/objects/search"), "search");
  assert.equal(map("/object/url"), "weblink"); // MUST match before /object
  assert.equal(map("/object?id=abc&hardDelete=true"), "object");
  assert.equal(map("/object/markdown"), "object");
  assert.equal(map("/blocks/daily-note/append"), "blocks");
});

test("rate limiter enforces the v2 per-category limits", async () => {
  const client: any = newClient();
  const limits = client.rateLimiter.limits;

  assert.equal(limits.space.maxRequests, 10);
  assert.equal(limits.search.maxRequests, 30);
  assert.equal(limits.weblink.maxRequests, 10);
  assert.equal(limits.object.maxRequests, 30);
  assert.equal(limits.blocks.maxRequests, 30);
});
