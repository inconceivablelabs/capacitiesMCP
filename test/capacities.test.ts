import { test } from "node:test";
import assert from "node:assert/strict";
import { CapacitiesClient, CapacitiesAPIError } from "../src/client/capacities.js";

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

test("searchContent includes structureIds and limit in the POST body when provided, omits them otherwise", async () => {
  const calls = installFetch(() => makeResponse({ body: { results: [] } }));
  const client = newClient();

  await client.searchContent({ query: "q", structureIds: ["st-1", "st-2"], limit: 5 });

  const body = JSON.parse(calls[0].opts.body);
  assert.equal(body.query, "q");
  assert.deepEqual(body.structureIds, ["st-1", "st-2"]);
  assert.equal(body.limit, 5);

  const calls2 = installFetch(() => makeResponse({ body: { results: [] } }));
  const client2 = newClient();

  await client2.searchContent({ query: "q2" });

  const body2 = JSON.parse(calls2[0].opts.body);
  assert.equal("structureIds" in body2, false);
  assert.equal("limit" in body2, false);
});

// --- saveWeblink ---------------------------------------------------------

test("saveWeblink POSTs /object/url with url, markdown, and constrained title/description properties", async () => {
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
    title: "My Title",
    description: "My Description",
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.capacities.io/object/url");
  assert.equal(calls[0].opts.method, "POST");

  const body = JSON.parse(calls[0].opts.body);
  assert.equal(body.url, "https://example.com");
  assert.equal(body.markdown, "some note");
  assert.deepEqual(body.properties, {
    title: { type: "title", title: { value: "My Title" } },
    description: { type: "text", text: { value: "My Description" } },
  });
  // tags/titleOverwrite/spaceId are not part of the /object/url contract
  assert.equal("tags" in body, false);
  assert.equal("titleOverwrite" in body, false);
  assert.equal("spaceId" in body, false);

  assert.equal(result.id, "obj-1");
  assert.equal(result.structureId, "st-weblink");
});

test("saveWeblink with only url sends exactly {url} — no properties, no markdown", async () => {
  const created = {
    id: "obj-2",
    structureId: "st-weblink",
    collections: [],
    properties: {},
    blocks: {},
  };
  const calls = installFetch(() => makeResponse({ body: created }));
  const client = newClient();

  await client.saveWeblink({ url: "https://example.org" });

  assert.equal(calls.length, 1);
  const body = JSON.parse(calls[0].opts.body);
  assert.deepEqual(body, { url: "https://example.org" });
  assert.equal("properties" in body, false);
  assert.equal("markdown" in body, false);
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

// --- error body surfacing (cap-6dy.8) ------------------------------------

test("makeRequest surfaces a non-ok body as API_ERROR with body in message and details", async () => {
  installFetch(() =>
    makeResponse({ ok: false, status: 400, text: "validation: unknown property foo" })
  );
  const client = newClient();

  const err = await client.searchContent({ query: "x" }).then(
    () => { throw new Error("expected rejection"); },
    (e) => e
  );

  assert.ok(err instanceof CapacitiesAPIError);
  assert.equal(err.code, "API_ERROR");
  assert.ok(err.message.includes("validation: unknown property foo"));
  assert.equal(err.details.body, "validation: unknown property foo");
  assert.equal(err.details.status, 400);
});

test("makeRequest maps 401 to AUTHENTICATION_FAILED with body", async () => {
  installFetch(() => makeResponse({ ok: false, status: 401, text: "bad token" }));
  const client = newClient();

  const err = await client.getSpaces().then(
    () => { throw new Error("expected rejection"); },
    (e) => e
  );

  assert.ok(err instanceof CapacitiesAPIError);
  assert.equal(err.code, "AUTHENTICATION_FAILED");
  assert.ok(err.message.includes("bad token"));
  assert.equal(err.details.body, "bad token");
});

test("makeRequest maps server 429 to RATE_LIMIT_EXCEEDED", async () => {
  installFetch(() => makeResponse({ ok: false, status: 429, text: "slow down" }));
  const client = newClient();

  const err = await client.getSpaces().then(
    () => { throw new Error("expected rejection"); },
    (e) => e
  );

  assert.ok(err instanceof CapacitiesAPIError);
  assert.equal(err.code, "RATE_LIMIT_EXCEEDED");
  assert.equal(err.details.status, 429);
});

// --- client-side rate limiter throws (cap-6dy.8) -------------------------

test("client-side rate limiter throws RATE_LIMIT_EXCEEDED (with retryAfterMs) instead of sleeping", async () => {
  const space = { id: "s1", title: "Space", icon: { type: "emoji", val: "x" } };
  installFetch(() => makeResponse({ body: space }));
  const client = newClient();

  // /space -> "space" category, limit 10. First 10 succeed.
  for (let i = 0; i < 10; i++) {
    await client.getSpaces();
  }

  const err = await client.getSpaces().then(
    () => { throw new Error("expected rejection on 11th call"); },
    (e) => e
  );

  assert.ok(err instanceof CapacitiesAPIError);
  assert.equal(err.code, "RATE_LIMIT_EXCEEDED");
  assert.equal(typeof err.details.retryAfterMs, "number");
  assert.equal(err.details.category, "space");
});

// --- empty/non-JSON 200 guards (cap-6dy.20) ------------------------------

test("searchContent on an empty-body 200 returns [] rather than throwing", async () => {
  // makeRequest returns {success:true} on a content-length:0 / non-JSON 200;
  // the guard must turn that into an empty results array.
  installFetch(() => makeResponse({ status: 200, contentType: null, contentLength: "0" }));
  const client = newClient();

  const results = await client.searchContent({ query: "anything" });
  assert.ok(Array.isArray(results));
  assert.equal(results.length, 0);
});

test("createObject on an id-less (empty-body) 200 throws API_ERROR", async () => {
  installFetch(() => makeResponse({ status: 200, contentType: null, contentLength: "0" }));
  const client = newClient();

  const err = await client.createObject({ structureId: "st-1" }).then(
    () => { throw new Error("expected rejection"); },
    (e) => e
  );

  assert.ok(err instanceof CapacitiesAPIError);
  assert.equal(err.code, "API_ERROR");
  assert.match(err.message, /no object id/);
});

test("updateObject on an id-less (empty-body) 200 throws API_ERROR", async () => {
  installFetch(() => makeResponse({ status: 200, contentType: null, contentLength: "0" }));
  const client = newClient();

  const err = await client.updateObject({ id: "obj-1" }).then(
    () => { throw new Error("expected rejection"); },
    (e) => e
  );

  assert.ok(err instanceof CapacitiesAPIError);
  assert.equal(err.code, "API_ERROR");
  assert.match(err.message, /no object id/);
});

// --- bounded-wait acquire (cap-6dy.19) -----------------------------------

// A fake clock: `now` reads a mutable counter; `sleep` advances it. No real
// time passes, so a "60s" window wait resolves instantly in tests.
function fakeClock() {
  let t = 0;
  const sleeps: number[] = [];
  return {
    now: () => t,
    sleep: async (ms: number) => { t += ms; sleeps.push(ms); },
    sleeps,
    advance: (ms: number) => { t += ms; }
  };
}

test("acquireWithWait sleeps exactly one window when full and budget allows, then takes a slot", async () => {
  const clock = fakeClock();
  const client: any = new CapacitiesClient({
    apiToken: "t", baseUrl: "https://api.capacities.io", now: clock.now, sleep: clock.sleep
  });
  const limiter = client.rateLimiter;

  // Fill the object window (limit 30).
  for (let i = 0; i < 30; i++) await limiter.waitForSlot("object");

  const budget = { remainingMs: 60000 };
  await limiter.acquireWithWait("object", budget);

  assert.deepEqual(clock.sleeps, [60000], "exactly one bounded sleep of one window");
  assert.equal(budget.remainingMs, 0, "budget decremented by the slept window");
});

test("acquireWithWait throws RATE_LIMIT_EXCEEDED when the wait exceeds the remaining budget", async () => {
  const clock = fakeClock();
  const client: any = new CapacitiesClient({
    apiToken: "t", baseUrl: "https://api.capacities.io", now: clock.now, sleep: clock.sleep
  });
  const limiter = client.rateLimiter;

  for (let i = 0; i < 30; i++) await limiter.waitForSlot("object");

  // A budget smaller than the ~60s reset cannot cover the wait → throw, no sleep.
  const budget = { remainingMs: 1000 };
  const err = await limiter.acquireWithWait("object", budget).then(
    () => { throw new Error("expected rejection"); },
    (e: unknown) => e
  );

  assert.ok(err instanceof CapacitiesAPIError);
  assert.equal(err.code, "RATE_LIMIT_EXCEEDED");
  assert.equal(clock.sleeps.length, 0, "must not sleep when the budget can't cover the wait");
});

test("waitForSlot still throws immediately (no sleep) when the window is full", async () => {
  const clock = fakeClock();
  const client: any = new CapacitiesClient({
    apiToken: "t", baseUrl: "https://api.capacities.io", now: clock.now, sleep: clock.sleep
  });
  const limiter = client.rateLimiter;

  for (let i = 0; i < 30; i++) await limiter.waitForSlot("object");

  const err = await limiter.waitForSlot("object").then(
    () => { throw new Error("expected rejection"); },
    (e: unknown) => e
  );

  assert.ok(err instanceof CapacitiesAPIError);
  assert.equal(err.code, "RATE_LIMIT_EXCEEDED");
  assert.equal(clock.sleeps.length, 0, "throw path must never sleep");
});

// --- DEBUG logging gating (cap-6dy.7) ------------------------------------

test("DEBUG logging is gated behind logLevel", async () => {
  const space = { id: "s1", title: "Space", icon: { type: "emoji", val: "x" } };

  // Default logLevel ("info") — no DEBUG lines.
  installFetch(() => makeResponse({ body: space }));
  const original = console.error;
  const captured: unknown[][] = [];
  console.error = (...args: unknown[]) => { captured.push(args); };
  try {
    const client = newClient();
    await client.getSpaces();
  } finally {
    console.error = original;
  }
  const anyDebug = captured.some(
    (args) => typeof args[0] === "string" && args[0].startsWith("DEBUG:")
  );
  assert.equal(anyDebug, false, "no DEBUG lines at default log level");

  // logLevel "debug" — DEBUG lines emitted.
  installFetch(() => makeResponse({ body: space }));
  const captured2: unknown[][] = [];
  console.error = (...args: unknown[]) => { captured2.push(args); };
  try {
    const client = new CapacitiesClient({
      apiToken: "test-token",
      baseUrl: "https://api.capacities.io",
      logLevel: "debug",
    });
    await client.getSpaces();
  } finally {
    console.error = original;
  }
  const anyDebug2 = captured2.some(
    (args) => typeof args[0] === "string" && args[0].startsWith("DEBUG:")
  );
  assert.equal(anyDebug2, true, "DEBUG lines emitted at debug log level");
});

// --- getObject pacing (find_objects stage-2 fetch loop) ------------------

test("getObject WITH a budget sleeps exactly one window when the object bucket is full, then reads", async () => {
  const clock = fakeClock();
  const client: any = new CapacitiesClient({
    apiToken: "t", baseUrl: "https://api.capacities.io", now: clock.now, sleep: clock.sleep
  });
  installFetch(() =>
    makeResponse({ body: { id: "o1", structureId: "RootTask", collections: [], properties: {}, blocks: {} } })
  );

  // Fill the object window (limit 30) via un-paced reads (throw path takes slots).
  for (let i = 0; i < 30; i++) await client.getObject("x");

  // 31st read WITH a one-window budget must sleep once, not throw.
  const budget = { remainingMs: 60000 };
  const obj = await client.getObject("x", budget);

  assert.equal(obj.id, "o1");
  assert.deepEqual(clock.sleeps, [60000], "exactly one bounded one-window sleep");
  assert.equal(budget.remainingMs, 0, "budget decremented by the slept window");
});

test("getObject WITHOUT a budget still throws immediately when the object window is full (no sleep)", async () => {
  const clock = fakeClock();
  const client: any = new CapacitiesClient({
    apiToken: "t", baseUrl: "https://api.capacities.io", now: clock.now, sleep: clock.sleep
  });
  installFetch(() =>
    makeResponse({ body: { id: "o1", structureId: "RootTask", collections: [], properties: {}, blocks: {} } })
  );

  for (let i = 0; i < 30; i++) await client.getObject("x");

  const err = await client.getObject("x").then(
    () => { throw new Error("expected rejection"); },
    (e: unknown) => e
  );

  assert.ok(err instanceof CapacitiesAPIError);
  assert.equal(err.code, "RATE_LIMIT_EXCEEDED");
  assert.equal(clock.sleeps.length, 0, "the throw path must never sleep");
});
