# Capacities MCP Server

An MCP server for [Capacities](https://capacities.io): search, property-based object lookup, object CRUD, save weblinks, and daily notes from any MCP-compatible client.

> **⚠️ Use 2.x.** Version **2.x runs on Capacities' current REST API**. Version **1.x used the
> Capacities Beta API, which Capacities scheduled for discontinuation on September 1, 2026**;
> 1.x builds (and any `.dxt` packaged before v2.0.0) depend on it. Reinstall the current
> `capacities-desktop-extension.dxt` (v2.x). See the
> [Capacities API notice](https://docs.capacities.io/developer/api).
>
> **About the name "v2".** Capacities' own docs call the current API **"v1"** (their Beta was
> the first API). This repo calls it **v2** because it is the second API this server has run
> on. Same API, two names.

## Prerequisites

- A [Capacities](https://capacities.io) account with API access
- An API token: Capacities desktop app → Settings → Capacities API → Generate new token. Each
  token is scoped to **one space** and is either read-only or read-write; tools that write need
  a read-write token.
- To run from source: Node.js 22 (the version the Docker image runs)

## Installation

Choose the option that fits your setup:

### Option 1: Claude Desktop Extension (Easiest)

1. Download [`capacities-desktop-extension.dxt`](./capacities-desktop-extension.dxt)
2. In Claude Desktop: Settings → Extensions → Import Extension
3. Select the `.dxt` file and enter your API token when prompted

All dependencies are bundled; no additional setup needed.

### Option 2: Run from Source

```bash
git clone https://github.com/inconceivablelabs/capacitiesMCP.git
cd capacitiesMCP
npm install
npm run build
```

Then add to your MCP client config (e.g. Claude Desktop's `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "capacities": {
      "command": "node",
      "args": ["/path/to/capacitiesMCP/server/dist/index.js"],
      "env": {
        "CAPACITIES_API_TOKEN": "your_token_here"
      }
    }
  }
}
```

### Option 3: Docker Container

For running as a persistent service (e.g. behind an MCP gateway):

```bash
# Build from the repo root: the Dockerfile copies from both src/ and server/.
docker build -f server/Dockerfile -t capacities-mcp .
docker run -d \
  -e CAPACITIES_API_TOKEN=your_token_here \
  capacities-mcp
```

The image is based on `node:22-slim`. Its runtime stage installs only `server/`'s production
dependencies and the compiled output, with no source or dev dependencies. Since 2.2.3 it also
removes the base image's bundled `npm`/`npx`, which the server never runs.

## Available tools

| Tool | Description |
|------|-------------|
| `search_content` | Search objects by title (optionally scoped by `structureIds`, capped by `limit`). When Capacities has semantic search enabled, objects related by meaning are also returned, listed after the title matches under a "Related by meaning" label; `limit` caps the combined list |
| `find_objects` | Locate objects of one type by a property the API can't search on — date, label/status, tag/relation, or scalar. Seed by title (`title_hint`; results limited to titles containing it), by `tag`, both, or neither, which lists the whole type (paged, `page_budget` up to 25 pages of 100). A title search that returns 50 results lists the whole type instead. Listed candidates are taken newest first by the date in their title (oldest first when sorting ascending on a date; undated titles last either way). Filters and sorts client-side over typed property values; returns ids + titles + the matched values (no bodies — compose with `get_object`). With no filters or sort it lists matches without reading each object. Dates are absolute ISO and must start with a real `YYYY-MM-DD`: a date-only value matches that day, a full timestamp that exact instant, or an `{after,before}` range. Reading objects stops early on a 403 or 401, or after 3 read errors with no success between them, rather than continuing against a server that is refusing it. A `Note:` line means the result may be incomplete |
| `list_spaces` | Show the space your API token is scoped to |
| `get_space_info` | List the space's structures: their properties, label options, and relation targets |
| `create_object` | Create an object of any structure with typed properties, labels, and relations (set by name, resolved strictly), plus a markdown body |
| `update_object` | Update an existing object's properties/relations (replaces each named property's value) and append a body |
| `get_object` | Read an object as Markdown (frontmatter + body) |
| `append_to_object` | Append markdown content to an object's body without touching its properties |
| `delete_object` | Delete an object (moves to trash by default; `hard_delete` for permanent) |
| `save_weblink` | Save a URL as a Weblink, auto-fetching page metadata (override `title`/`description`) |
| `add_to_daily_note` | Append content to today's daily note |

> **Single-space per token.** A v2 API token is scoped to exactly one space; `list_spaces`
> returns that one space. To work with multiple spaces, use multiple tokens.

## The object model: properties vs. body

Objects in Capacities hold two kinds of content, and the tools treat them differently:

- **Properties** — the object's *typed fields*: title, text, dates, numbers, **labels**
  (e.g. a task's Status, a weblink's Category), and **entity relations** (tags, a meeting's
  attendees). Set these with the `properties` / `labels` / `relations` inputs on
  `create_object` / `update_object`, keyed by property name or id (get them, plus label options
  and relation targets, from `get_space_info`). **Relations and labels are set by *name* and
  resolved strictly**: an unknown name is an error, never a guess; pass
  `create_missing_relations: true` to auto-create unmatched relation targets.
- **Body** — freeform Markdown, set via the `body` / `notes` / `content` / `markdown`
  parameter.

**Rule of thumb: set structured things as properties, prose as body.** A tag is a property
(a `relations` entry), not a `[[link]]` typed into the text. One tool call completes one
object (all its properties *and* its body); several *distinct, standalone* objects take
several calls.

### Markdown conventions (body)

Any body/notes field supports Capacities' inline conventions:

| Syntax | Effect | Creates an object? |
|--------|--------|--------------------|
| `() text` | Creates a **Task** and links it into the body | **Yes**, a Task |
| `#tag` | Creates or links a **Tag** | **Yes**, a Tag if new |
| `[[Name]]` | Links an **existing** object by title | **No**; plain text if no such object exists |

Use `[[Name]]` to reference something that already exists; use `() ` / `#` when you *intend*
to create the task/tag.

### Weblinks & media objects (current API limitation)

`save_weblink` creates a Weblink from a URL and auto-fetches the page's title and description;
you can override `title` and `description` at save time. **Those are the only properties
settable on a weblink.** The Capacities API currently treats *media* objects (weblinks, PDFs,
images, audio, files) as **create-only**: they cannot be updated after creation, so **tags,
Category, and Topic cannot be set on a weblink through the API.** To tag a weblink today, put a
`#tag` in its `notes` (this associates a Tag via the body).

> **This is an upstream Capacities API limitation, not a limitation of this server.** As soon
> as the Capacities API allows updating media objects, this server will add full weblink
> property support (tags / Category / Topic via `save_weblink`). Until then, `#tag`-in-notes is
> the available path.

## Rate limits

Capacities enforces rate limits on its servers, per token and per endpoint (see its
[rate-limiting docs](https://developers.capacities.io/api/overview/rate-limiting)). In our
measurements against `/object` the window is **rolling**: slots free up one at a time as each request ages out of
the trailing 60 seconds. This server also runs a client-side, per-endpoint limiter, and its
multi-call tools (`create_object`/`update_object` with many relations, and `find_objects`' searches and
object reads) pace themselves against it. A `find_objects` listing does not wait: when the window is full
it stops as a partial, with a `Note:` line saying so. That limiter is best-effort: it cannot see other clients using the same
token or network. **If a tool returns `RATE_LIMIT_EXCEEDED`, wait and retry** rather than trying
to predict the window.

The API sits behind Cloudflare, so a server-side rejection can arrive as a Cloudflare "you are
being rate limited" page. The one we have captured came on a 429; the server also treats the same
page on a 403 as a rate limit, in case a ban arrives that way. Both are reported as
`RATE_LIMIT_EXCEEDED`. Such a ban is per IP address, so it affects every client on the same network
for as long as it lasts. Error messages carry the server's response trimmed to fit: a JSON error is
kept whole so the model can correct its call, and an HTML page is cut to its first line.

## Why this server?

*As of 2026-10-21: [`@capacities/api`](https://www.npmjs.com/package/@capacities/api) 1.1.3,
and the official MCP server as documented at
[docs.capacities.io/developer/model-context-protocol](https://docs.capacities.io/developer/model-context-protocol).
Both are moving, so check them before relying on this table.*

| | This server | Official Capacities MCP server | `@capacities/api` SDK |
|---|---|---|---|
| What it is | Local MCP server (stdio), personal API token | Hosted MCP server at `https://api.capacities.io/mcp`, OAuth 2.1 | TypeScript client library, not an MCP server |
| Setup | `.dxt`, Node, or Docker; token in env | Add the URL to your MCP client and sign in. The space must have AI Assistant enabled | `npm install`, then write your own code |
| Coverage | The 11 tools above | Search, read, create (pages, tasks, any type), update properties, append, **block-level edits**, **file upload**, list by type/tag/collection, object links | **All 22 REST endpoints**, plus OAuth with token refresh |
| Relations and tags on create/update | Set by name, resolved strictly. Unknown or ambiguous names fail before anything is written (auto-create is opt-in) | Properties are set from frontmatter; how relation names are resolved is not documented | You pass ids; name lookup is up to you |
| Property keys | Property name or id | Frontmatter keys | Ids |
| Filter by date, label, relation or value | `find_objects` | List by object type, tag or collection; other filters not documented | Not provided |
| Search output | Title matches first; semantic hits labelled "Related by meaning" | Title and semantic search ranked together | The raw API response |
| Client-side rate pacing | Per endpoint, best-effort | n/a (hosted) | None; the only retry is a 401 under OAuth |

**Pick the official server** if you want block-level editing, file uploads, OAuth instead of a
token, or a connector that works in hosted chat apps with nothing to install. **Pick the SDK** if
you are writing your own code: it is the complete client. Note that 1.1.3 needs **zod 4** at
runtime even though its peer range also allows zod 3 (under zod 3.25 its import fails with
`.meta is not a function`). **Pick this server** if your MCP client does typed, relation-heavy
writes that must be validated before anything is saved, or needs to find objects by property
value.

## Configuration

| Environment Variable | Required | Default |
|---------------------|----------|---------|
| `CAPACITIES_API_TOKEN` | Yes | — |
| `CAPACITIES_API_BASE_URL` | No | `https://api.capacities.io` |
| `LOG_LEVEL` | No | `info` |

## Project structure

```
capacitiesMCP/
├── src/                  # TypeScript source (single source of truth)
├── server/               # Runtime packaging
│   ├── Dockerfile        # Container build
│   ├── package.json      # Runtime dependencies only
│   └── dist/             # Compiled output (built from root src/)
├── tsconfig.json         # Builds src/ → server/dist/
├── manifest.json         # DXT extension manifest
└── *.dxt                 # Pre-built extension packages
```

`npm run build` compiles `src/` directly into `server/dist/`. There is one source, one build step, and one output location used by all three installation methods.

## Development

```bash
npm install
npm run build        # Compile TypeScript
npm run dev          # Watch mode
npm run inspector    # MCP Inspector for debugging
npm test             # Run tests
```

See [CLAUDE.md](./CLAUDE.md) for architecture details.

## Security advisories and reachability

This server speaks MCP over **stdio only**. It imports two modules from
`@modelcontextprotocol/sdk` (`server/mcp.js` and `server/stdio.js`); the SDK's HTTP transports,
OAuth client/server code and Express/Hono middleware are installed as dependencies but never
loaded. Most advisories that Dependabot raises against this repo therefore cannot be reached at
runtime. We still patch them, because the lockfiles ship in the Docker image and the extension.

As of 2.1.2 (SDK 1.32.1), `npm audit` reports 0 in both lockfiles. Reachability of the
advisories cleared in that release, checked against a module-resolution trace of a live stdio
session (initialize, `tools/list`, `tools/call`, `resources/list`):

| Package | Loaded on our path? | Reachable? |
|---|---|---|
| `@modelcontextprotocol/sdk` (5 advisories) | Yes | No. Each advisory is scoped to HTTP servers, the HTTP/OAuth client, bearer auth or `taskStore`, none of which we use. The SDK's own advisory text says stdio-only servers are not affected by the memory-exhaustion one. |
| `fast-uri` | Yes, via `ajv` | No. The SDK builds an `ajv` instance at startup, but only calls it to validate form-elicitation replies (`elicitInput`), which this server never sends. Instrumented, a session that included tool calls with malformed URIs in their arguments made zero `fast-uri` calls; a control that compiled a schema with an `$id` through the same `ajv` instance made 15. |
| `proxy-addr`, `qs` (via Express) | No | No. |
| `hono` | No | No. |
| `ip-address` (via `express-rate-limit`) | No | No. |

Image scanners also used to flag `ip-address` 10.1.0 inside the npm CLI bundled with the
`node:22-slim` base image. That copy is in no lockfile, so Dependabot cannot see it, and the server
never runs npm. Since 2.2.3 the runtime image no longer contains npm at all.

## License

MIT. See [LICENSE](LICENSE).
