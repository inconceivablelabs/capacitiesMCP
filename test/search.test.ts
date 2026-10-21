import { test } from "node:test";
import assert from "node:assert/strict";
import { CapacitiesClient } from "../src/client/capacities.js";
import { setupSearchTools } from "../src/tools/search.js";

function makeResponse(body: unknown) {
  const headers = {
    get(name: string): string | null {
      if (name.toLowerCase() === "content-type") return "application/json";
      return null;
    }
  };
  return {
    ok: true,
    status: 200,
    headers,
    async json() {
      return body;
    },
    async text() {
      return "";
    }
  };
}

function installFetch(body: unknown) {
  (globalThis as any).fetch = async () => makeResponse(body);
}

function makeServerStub() {
  const tools: Record<string, any> = {};
  const server: any = {
    registerTool(name: string, config: any, handler: any) {
      tools[name] = { name, config, handler };
    }
  };
  return { server, tools };
}

test("get_space_info renders label options, multi-select flag, and entity allowedStructures", async () => {
  installFetch({
    structures: [
      {
        id: "RootTask",
        title: "Task",
        pluralName: "Tasks",
        labelColor: "blue",
        collections: [{ id: "c1", title: "Inbox" }],
        propertyDefinitions: [
          { id: "title", name: "Title", type: "title", writable: true },
          {
            id: "status",
            name: "Status",
            type: "label",
            writable: true,
            multiple: false,
            labelSet: [
              { id: "s1", name: "Backlog" },
              { id: "s2", name: "Not Started" }
            ]
          },
          {
            id: "tags",
            name: "Tags",
            type: "label",
            writable: true,
            multiple: true,
            labelSet: [{ id: "t1", name: "Alpha" }]
          },
          {
            id: "assignee",
            name: "Assignee",
            type: "entity",
            writable: true,
            allowedStructures: ["person", "team"]
          },
          { id: "count", name: "Count", type: "number", writable: false }
        ]
      }
    ]
  });

  const { server, tools } = makeServerStub();
  const client = new CapacitiesClient({
    apiToken: "test-token",
    baseUrl: "https://api.capacities.io"
  });
  setupSearchTools(server, client);

  const res = await tools["get_space_info"].handler({});
  const text = res.content[0].text;

  // Property id is visible.
  assert.match(text, /id=status/);
  // Label options rendered by NAME.
  assert.match(text, /options: Backlog, Not Started/);
  // Multi-select flag on the multiple label.
  assert.match(text, /options: Alpha \(multi-select\)/);
  // Entity allowedStructures rendered.
  assert.match(text, /links: person, team/);
  // Read-only still shown.
  assert.match(text, /\[read-only\]/);
});

// cap-6dy.21: a structure returned without propertyDefinitions and/or collections
// must not crash the introspection tool (these arrays come raw from the API).
test("get_space_info renders without throwing when a structure is missing collections/propertyDefinitions", async () => {
  installFetch({
    structures: [
      {
        id: "RootTask",
        title: "Task",
        pluralName: "Tasks",
        labelColor: "blue"
        // NOTE: both propertyDefinitions and collections are absent.
      }
    ]
  });

  const { server, tools } = makeServerStub();
  const client = new CapacitiesClient({
    apiToken: "test-token",
    baseUrl: "https://api.capacities.io"
  });
  setupSearchTools(server, client);

  const res = await tools["get_space_info"].handler({});
  assert.equal(res.isError, undefined, "must not surface an error");
  assert.match(res.content[0].text, /\*\*Task\*\*/);
});

// === cap-1kc: search_content labels matches BY MEANING =====================
// /objects/search interleaves semantic hits with title matches. search_content
// keeps them all but lists title matches first, then a labelled section.
// Synthetic titles only — this repo is public.

function getSearch() {
  const { server, tools } = makeServerStub();
  const client = new CapacitiesClient({ apiToken: "test-token", baseUrl: "https://api.capacities.io" });
  setupSearchTools(server, client);
  return tools["search_content"];
}

test("search_content: title matches first (server order), then a labelled related-by-meaning section (server order)", async () => {
  installFetch({ results: [
    { id: "x1", title: "Quarterly Planning", structureId: "meeting" },
    { id: "a1", title: "Alpha/Beta 1:1", structureId: "meeting" },
    { id: "x2", title: "Team Offsite", structureId: "meeting" },
    { id: "a2", title: "Alpha  Beta Sync", structureId: "meeting" }
  ] });
  const res = await getSearch().handler({ query: "alpha beta" });
  const text: string = res.content[0].text;

  assert.equal(res.isError, undefined);
  assert.match(text, /^Found 4 results for "alpha beta" \(2 title matches, 2 related by meaning\):/);
  const label = "Related by meaning (title does not contain the query):";
  const order = ["ID: a1", "ID: a2", label, "ID: x1", "ID: x2"].map(s => text.indexOf(s));
  assert.ok(order.every(i => i >= 0), `every marker present: ${order}`);
  assert.deepEqual(order, [...order].sort((a, b) => a - b), "a1, a2, label, x1, x2 in that order");
});

test("search_content: only semantic hits → zero title matches, all under the label", async () => {
  installFetch({ results: [
    { id: "x1", title: "Quarterly Planning", structureId: "meeting" }
  ] });
  const res = await getSearch().handler({ query: "roadmap" });
  const text: string = res.content[0].text;
  assert.match(text, /^Found 1 results for "roadmap" \(0 title matches, 1 related by meaning\):/);
  // Assert presence first: an absent label's indexOf is -1, which would pass the order check.
  const labelAt = text.indexOf("Related by meaning (title does not contain the query):");
  assert.ok(labelAt >= 0, "label present");
  assert.ok(labelAt < text.indexOf("ID: x1"));
});

test("search_content: no semantic hits → today's header and no related section", async () => {
  installFetch({ results: [
    { id: "a1", title: "Weekly Connect", structureId: "meeting" },
    { id: "a2", title: "Connect Retro", structureId: "meeting" }
  ] });
  const res = await getSearch().handler({ query: "connect" });
  const text: string = res.content[0].text;
  assert.match(text, /^Found 2 results for "connect":\n/);
  assert.doesNotMatch(text, /related by meaning/i);
  assert.ok(text.indexOf("ID: a1") < text.indexOf("ID: a2"));
});

test("search_content: an all-punctuation query is rendered unpartitioned in server order", async () => {
  installFetch({ results: [
    { id: "x1", title: "Quarterly Planning", structureId: "meeting" },
    { id: "a1", title: "A/B", structureId: "meeting" }
  ] });
  const res = await getSearch().handler({ query: "//" });
  const text: string = res.content[0].text;
  assert.match(text, /^Found 2 results for "\/\/":\n/);
  assert.doesNotMatch(text, /related by meaning/i);
  assert.ok(text.indexOf("ID: x1") < text.indexOf("ID: a1"), "server order kept");
});

test("search_content: description explains semantic matches and the combined limit", () => {
  const desc: string = getSearch().config.description;
  assert.match(desc, /related by meaning/i);
  assert.match(desc, /listed after the title matches/i);
  assert.match(desc, /limit.*combined/i);
});
