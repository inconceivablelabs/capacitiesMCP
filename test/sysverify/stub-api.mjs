// Strict local stand-in for api.capacities.io (cap-i93 System Verification).
// Synthetic data only — this repo is public. Rejects what the real API rejects.
import http from "node:http";

const UUID = /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/;
export const uid = (n) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
export const MEETING = uid(0x5001), LOG = uid(0x5002), TAG = uid(0xa001), TOKEN = "cap-api-stub";
const day = (n) => new Date(Date.UTC(2025, 0, 1 + n)).toISOString().slice(0, 10);

const meetings = [
  ...Array.from({ length: 60 }, (_, i) => ({ id: uid(i + 1), structureId: MEETING, title: `Sync - ${day(i)}` })),
  ...Array.from({ length: 60 }, (_, i) => ({ id: uid(i + 61), structureId: MEETING, title: `Retro ${i + 60}` }))
];
const logs = Array.from({ length: 1300 }, (_, i) => ({ id: uid(0x10000 + i), structureId: LOG, title: `Log ${i}` }));
const tagged = [...meetings.slice(0, 5), { id: uid(0x9001), structureId: "RootPage", title: "Tagged page" }];
const prop = (id, name, type) => ({ id, name, type, writable: true });
const structures = { structures: [
  { id: MEETING, title: "Meeting", pluralName: "Meetings", labelColor: "blue", collections: [], propertyDefinitions: [prop("title", "Title", "title"), prop("date", "Date", "date")] },
  { id: LOG, title: "Log", pluralName: "Logs", labelColor: "gray", collections: [], propertyDefinitions: [prop("title", "Title", "title")] },
  { id: "RootTag", title: "Tag", pluralName: "Tags", labelColor: "green", collections: [], propertyDefinitions: [prop("title", "Name", "title")] }
] };

function page(all, cursor) {
  const start = cursor ? all.findIndex(r => r.id === cursor) + 1 : 0;
  if (cursor && start === 0) return null;
  const results = all.slice(start, start + 100);
  const hasMore = start + 100 < all.length;
  return { results, hasMore, nextCursor: hasMore ? results[results.length - 1].id : null };
}

export function startStub() {
  const requests = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", c => (raw += c));
    req.on("end", () => {
      const u = new URL(req.url, "http://stub");
      requests.push({ method: req.method, path: u.pathname, query: u.search });
      const send = (status, body, type = "application/json") => {
        res.writeHead(status, { "content-type": type });
        res.end(typeof body === "string" ? body : JSON.stringify(body));
      };
      if (req.headers.authorization !== `Bearer ${TOKEN}` || req.headers["x-capacities-api-version"] !== "0.1.0") return send(401, { error: "auth" });
      if (req.method === "GET" && u.pathname === "/space/structures") return send(200, structures);
      if (req.method === "POST" && u.pathname === "/objects/search") {
        const b = JSON.parse(raw || "{}");
        if (typeof b.query !== "string" || b.query.length < 1 || b.query.length > 512) return send(400, { error: "query" });
        if (b.limit !== undefined && (b.limit < 1 || b.limit > 50)) return send(400, { error: "limit" });
        const scope = b.structureIds ?? [];
        const pool = scope.includes("RootTag") ? [{ id: TAG, structureId: "RootTag", title: "product" }]
          : [...meetings, ...logs].filter(r => scope.length === 0 || scope.includes(r.structureId));
        const q = b.query.toLowerCase();
        return send(200, { results: pool.filter(r => r.title.toLowerCase().includes(q)).slice(0, b.limit ?? 20) });
      }
      const m = u.pathname.match(/^\/objects\/(structure|tag)$/);
      if (req.method === "GET" && m) {
        for (const k of u.searchParams.keys()) if (!["id", "cursor", "pageSize"].includes(k)) return send(400, { error: `param ${k}` });
        const ps = u.searchParams.get("pageSize");
        if (ps !== null && (!/^\d+$/.test(ps) || +ps < 1 || +ps > 100)) return send(400, { error: "pageSize" });
        const id = u.searchParams.get("id") ?? "", cursor = u.searchParams.get("cursor");
        if (m[1] === "tag" && !UUID.test(id)) return send(400, { error: "id" });
        if (cursor !== null && !UUID.test(cursor)) return send(400, { error: "cursor" });
        const all = m[1] === "tag" ? (id === TAG ? tagged : []) : id === MEETING ? meetings : id === LOG ? logs : [];
        const p = page(all, cursor);
        return p ? send(200, p) : send(400, { error: "unknown cursor" });
      }
      if (req.method === "GET" && u.pathname === "/object") {
        const id = u.searchParams.get("id");
        const row = [...meetings, ...logs].find(r => r.id === id);
        if (!row) return send(404, { error: "not found" });
        return send(200, { id, structureId: row.structureId, collections: [], blocks: {},
          properties: { date: { type: "date", date: { start: `${row.title.slice(-10)}T09:00:00.000Z`, end: null, dateResolution: "time" } } } });
      }
      send(404, { error: `no route ${req.method} ${u.pathname}` });
    });
  });
  return new Promise(resolve => server.listen(0, "127.0.0.1", () =>
    resolve({ url: `http://127.0.0.1:${server.address().port}`, requests, close: () => new Promise(r => server.close(r)) })));
}
