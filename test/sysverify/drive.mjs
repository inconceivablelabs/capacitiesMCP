// Real stdio MCP session against the BUILT server (cap-i93 System Verification).
// Run from the repo root after `npm run build`:  node test/sysverify/drive.mjs <out.json>
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { startStub, TOKEN } from "./stub-api.mjs";

const out = process.argv[2] ?? path.join(tmpdir(), "cap-i93-sysverify.json");
const stub = await startStub();
const emptyCwd = mkdtempSync(path.join(tmpdir(), "cap-i93-cwd-"));      // no .env here (A22)
// SERVER_ENTRY lets the control run point the same driver at main's build.
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.resolve(process.env.SERVER_ENTRY ?? "server/dist/index.js")],
  cwd: emptyCwd,
  env: { CAPACITIES_API_TOKEN: TOKEN, CAPACITIES_API_BASE_URL: stub.url, LOG_LEVEL: "info" }
});
const client = new Client({ name: "cap-i93-sysverify", version: "0" });
// Every stdout line must parse as JSON-RPC (QA G7): the SDK reports a line it
// cannot parse through onerror, so collect them and require none.
const protocolErrors = [];
client.onerror = (e) => protocolErrors.push(String(e?.message ?? e));
await client.connect(transport);
const results = {};
try {
  const { tools } = await client.listTools();
  assert.equal(tools.length, 11, "tool count unchanged");
  const find = tools.find(t => t.name === "find_objects");
  const p = find.inputSchema.properties;
  assert.ok(p.page_budget, "page_budget is advertised");   // the control run (main's build) must fail HERE, as an assertion
  assert.equal(p.page_budget.maximum, 25);
  assert.equal(p.title_hint.maxLength, 512);
  assert.ok(p.tag, "tag is advertised");
  assert.ok(!(find.inputSchema.required ?? []).includes("title_hint"), "title_hint no longer required");
  assert.doesNotMatch(find.description, /CANNOT enumerate/i);

  const call = async (name, args) => {
    const before = stub.requests.length;
    const r = await client.callTool({ name: "find_objects", arguments: args });
    const objectGets = stub.requests.slice(before).filter(q => q.path === "/object").length;
    // cap-ul0: observed in Claude Code 2.1.305 via mcp-gateway, the model received only
    // the structuredContent JSON (layer not isolated), so it must never come back; the
    // exactness fields ride in content[1] as JSON.
    assert.equal(r.structuredContent, undefined, `${name}: structuredContent must be absent`);
    const isError = r.isError ?? false;
    if (!isError) assert.equal(r.content.length, 2, `${name}: content[0] text + content[1] exactness JSON`);
    results[name] = { text: r.content[0].text, isError, structured: isError ? null : JSON.parse(r.content[1].text), objectGets };
    return results[name];
  };

  // zod .max(25) through the SDK parse (A11).
  const tooBig = await call("page_budget 26", { structure: "Log", page_budget: 26 });
  assert.equal(tooBig.isError, true);
  assert.match(tooBig.text, /Input validation error/);
  assert.match(tooBig.text, /page_budget/);

  // zod .default(12) for page_budget: 13-page structure, short-circuit → 12 pages.
  const log = await call("Log default page budget", { structure: "Log" });
  assert.match(log.text, /^Note: listing stopped at the page budget — read 12 pages/m);
  assert.equal(log.structured.seed_method, "structure-enumeration");

  // Escalation + zod .default(30) for fetch_cap: 60 'Sync' titles saturate the search.
  const esc = await call("escalated Sync", { structure: "Meeting", title_hint: "Sync", sort: { by: "Date", order: "asc" } });
  assert.equal(esc.structured.seed_method, "search+enumeration");
  assert.equal(esc.structured.seed_complete, true);
  assert.equal(esc.structured.seed_size, 60);
  assert.equal(esc.objectGets, 30, "fetch_cap default 30 applied by the SDK");

  const tag = await call("tag product", { structure: "Meeting", tag: "product" });
  assert.equal(tag.structured.seed_method, "tag-enumeration");
  assert.equal(tag.objectGets, 0, "zero-GET short-circuit");
  assert.match(tag.text, /^Found 5 Meetings tagged "product"/);

  const exact = await call("exact Retro 7", { structure: "Meeting", title_hint: "Retro 7" });
  assert.equal(exact.structured.seed_method, "search");
  assert.equal(exact.structured.seed_complete, true);

  assert.ok(stub.requests.length > 0, "the server talked to the stub (not a live API)");
  assert.deepEqual(protocolErrors, [], "every stdout line parsed as JSON-RPC (QA G7)");
  assert.ok(stub.requests.every(q => q.path !== undefined));
  writeFileSync(out, JSON.stringify(results, null, 2));
  console.log(`OK — ${Object.keys(results).length} calls, ${stub.requests.length} stub requests → ${out}`);
} finally {
  await client.close();
  await stub.close();
}
