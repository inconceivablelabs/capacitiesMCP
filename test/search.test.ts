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
