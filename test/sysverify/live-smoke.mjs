// Live READ-ONLY smoke of find_objects against a real Capacities space (cap-i93 Task 13).
// Not part of `npm test`. Run from the repo root after `npm run build`, with the token in the
// environment (never printed):
//   CAPACITIES_API_TOKEN=... node test/sysverify/live-smoke.mjs "<series title>" "<saturating title>" "<tag name>"
// The three queries are arguments, not literals: this repo is PUBLIC, and real space titles and
// tag names must not be committed. Output is flags and counts only — never object titles.
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const [series, saturating, tagName] = process.argv.slice(2);
if (!series || !saturating || !tagName) {
  console.error('usage: live-smoke.mjs "<series title>" "<saturating title>" "<tag name>"');
  process.exit(2);
}
const token = process.env.CAPACITIES_API_TOKEN;
assert.ok(token?.startsWith("cap-api-"), "CAPACITIES_API_TOKEN must be a cap-api- token");

const entry = path.resolve("server/dist/index.js");
// Empty cwd so dotenv cannot load the repo's local placeholder .env.
const spawn = (logLevel, stderr) => new StdioClientTransport({
  command: process.execPath,
  args: [entry],
  cwd: mkdtempSync(path.join(tmpdir(), "cap-i93-live-")),
  // CAPACITIES_API_BASE_URL is passed through only so the script can be dry-run against
  // test/sysverify/stub-api.mjs before spending live requests; unset, the server uses the real API.
  env: {
    CAPACITIES_API_TOKEN: token, LOG_LEVEL: logLevel,
    ...(process.env.CAPACITIES_API_BASE_URL ? { CAPACITIES_API_BASE_URL: process.env.CAPACITIES_API_BASE_URL } : {})
  },
  ...(stderr ? { stderr } : {})
});

// Titles are stripped: keep only "Found N Plural" / "No Plural found", every Note: line and
// every parenthesised info line (none of which carry object titles).
const summarize = (r) => {
  const text = r.content[0].text;
  const lines = text.split("\n");
  const head = lines[0].match(/^(Found \d+ \w+|No \w+ found)/)?.[1] ?? "<unrecognised first line>";
  const trailer = lines.filter(l => /^Note:/.test(l) || /^\(/.test(l));
  return { isError: r.isError ?? false, head, trailer, structured: r.structuredContent ?? null };
};
const show = (label, s, extra = {}) => {
  console.log(`\n== ${label}`);
  console.log(JSON.stringify({ ...s, ...extra }, null, 2));
};

// --- Transport A: calls 1 and 2 at LOG_LEVEL info ---
const a = new Client({ name: "cap-i93-live", version: "0" });
await a.connect(spawn("info"));
let c1, c2;
try {
  // 1. Plain title seed, no filters / sort → zero-GET short-circuit (design Example A).
  c1 = summarize(await a.callTool({ name: "find_objects", arguments: { structure: "Meeting", title_hint: series } }));
  show("1 series (short-circuit)", c1);
  // 2. Saturating title → escalation to a full listing (design Example B).
  c2 = summarize(await a.callTool({ name: "find_objects", arguments: { structure: "Meeting", title_hint: saturating } }));
  show("2 saturating title (escalation)", c2);
} finally {
  await a.close();
}

// --- Transport B: LOG_LEVEL debug with stderr PIPED and only counted. Debug lines print response
// bodies (titles), so nothing from this stream may reach the terminal. ---
const tb = spawn("debug", "pipe");
let objectGets = 0;
tb.stderr.on("data", (chunk) => {
  for (const line of String(chunk).split("\n")) if (line.includes("'/object?id=")) objectGets++;
});
const b = new Client({ name: "cap-i93-live-debug", version: "0" });
await b.connect(tb);
let c3, control;
try {
  // Counter known-positive: the series seed with a sort and fetch_cap 1 must make exactly one GET.
  let before = objectGets;
  await b.callTool({ name: "find_objects", arguments: { structure: "Meeting", title_hint: series, sort: { by: "Date", order: "desc" }, fetch_cap: 1 } });
  await new Promise(r => setTimeout(r, 300));
  control = objectGets - before;
  console.log(`\n== counter control (expect 1 GET /object): ${control}`);
  // 3. Tag seed, no filters / sort → zero GET /object (design Example C).
  before = objectGets;
  c3 = summarize(await b.callTool({ name: "find_objects", arguments: { structure: "Meeting", tag: tagName } }));
  await new Promise(r => setTimeout(r, 300));
  show("3 tag (zero GET)", c3, { objectGets: objectGets - before });
  c3.objectGets = objectGets - before;
} finally {
  await b.close();
}

// STOP rule: any error, any incomplete seed on these small queries, or a broken counter.
const s1 = c1.structured, s2 = c2.structured, s3 = c3.structured;
assert.equal(c1.isError, false, "call 1 errored");
assert.equal(s1.seed_method, "search");
assert.equal(s1.seed_complete, true);
assert.equal(s1.returned, Math.min(s1.seed_size, 30));
assert.equal(s1.matched, s1.seed_size);
if (s1.seed_size > 30) assert.ok(c1.trailer.some(l => /^Note: showing the first 30 of/.test(l)), "default-cap Note missing");
assert.equal(c2.isError, false, "call 2 errored");
assert.equal(s2.seed_method, "search+enumeration");
assert.equal(s2.seed_complete, true);
assert.equal(control, 1, "GET counter known-positive failed — the zero below would prove nothing");
assert.equal(c3.isError, false, "call 3 errored");
assert.equal(s3.seed_method, "tag-enumeration");
assert.equal(s3.seed_complete, true);
assert.equal(s3.returned, s3.matched);
assert.equal(c3.objectGets, 0, "tag short-circuit made GET /object calls");
console.log("\nOK — live smoke passed (3 calls + counter control)");
