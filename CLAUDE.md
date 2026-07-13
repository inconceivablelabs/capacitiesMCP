# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Build and Development
- **Build**: `npm run build` - Compiles src/ to server/dist/ and makes index.js executable
- **Development**: `npm run dev` - Watch mode compilation with TypeScript
- **Start**: `npm run start` - Run the compiled MCP server
- **Inspector**: `npm run inspector` - Launch MCP Inspector for debugging tools
- **Test**: `npm test` - Compiles `tsconfig.test.json` then runs the Node.js built-in test runner (`node --test`) over `test-dist/test/**/*.test.js`

The gates are `npm run build` (tsc) + `npm test`. Tests use mocked `fetch` (no live token, no network) — see `test/`.

### Environment Setup
Required environment variables:
- `CAPACITIES_API_TOKEN` - v2 API token (`cap-api-…`) from the Capacities desktop app (required)
- `CAPACITIES_API_BASE_URL` - API base URL (optional, defaults to https://api.capacities.io)
- `LOG_LEVEL` - Logging level (optional, defaults to "info"; set `debug` to emit response-body DEBUG logs)

### Dependencies
- **@modelcontextprotocol/sdk**: MCP protocol implementation
- **zod**: Schema validation for tool parameters
- **dotenv**: Environment variable loading from .env files
- **typescript**: TypeScript compilation

## Architecture Overview

This is an MCP (Model Context Protocol) server integrating Claude with the Capacities knowledge
management platform. It runs on the **Capacities v2 REST API** (`developers.capacities.io`),
migrated from the v1 Beta API (which sunsets **2026-09-01**). It exposes a small generic core —
search, structure introspection, and object CRUD — and lets the LLM compose those into workflows.

**v2 API essentials:**
- Bearer `cap-api-…` token; every request sends the header `X-Capacities-Api-Version: 0.1.0`.
- **A token is scoped to a single space.** `GET /space` is singular; search takes no `spaceId`.
  Multi-space = multiple tokens. There is no `space_id` parameter on any tool.

### Core Components

#### Client Layer (`src/client/`)
- **`capacities.ts` — CapacitiesClient**: thin transport over `fetch`. Methods: `getSpaces`,
  `getSpaceInfo`, `searchContent`, `createObject`, `updateObject`, `getObject`,
  `getObjectMarkdown`, `appendBlocks`, `deleteObject`, `saveWeblink`, `saveToDailyNote`.
- **`types.ts`**: interfaces for spaces, structures, property definitions (incl. `labelSet`,
  `multiple`, `allowedStructures`), objects, and options.
- **Rate limiting** (per 60s window, client-side): `space` 10 · `search` 30 · `object` 30 ·
  `blocks` 30 · `object/url` (weblink) 10. When a window is exhausted the limiter **throws**
  `CapacitiesAPIError("RATE_LIMIT_EXCEEDED", …, {retryAfterMs})` rather than silently sleeping.

#### Tools Layer (`src/tools/`)
- **`search.ts`**: `search_content` (title match, optional `structureIds`/`limit`),
  `list_spaces` (the one scoped space), `get_space_info` (structures + property ids, types,
  `writable`, label options, relation targets).
- **`find.ts`**: `find_objects` — live LOCATE primitive: title-seed search →
  per-candidate `GET /object` (JSON, paced) → client-side filter/sort over typed
  property values. Returns ids+titles+surfaced values, NO bodies (compose with
  `get_object`). No persistent state (cap-0yu).
- **`object.ts`**: `create_object`, `update_object`, `get_object`, `append_to_object`,
  `delete_object`. Also the shared, write-free helpers `buildWrappers` + `finalizeRelationPlans`
  used by both create and update.
- **`resolution.ts`**: `resolveEntities` — resolves relation NAMES → object ids by title search;
  classifies linked / unmatched / ambiguous; never guesses.
- **`weblink.ts`**: `save_weblink` (`POST /object/url`, auto-fetch + title/description override).
- **`daily-note.ts`**: `add_to_daily_note`.
- **`descriptions.ts`**: `MARKDOWN_BODY_NOTE` — single-sourced body-conventions blurb reused in
  the body-accepting tool descriptions.

#### Resources Layer (`src/resources/`)
- **spaces.ts**: exposes the scoped Capacities space as an MCP resource.

#### Utilities (`src/utils/`)
- **validation.ts**: input validation (URLs, env). Note: tools no longer validate a `space_id`
  UUID — v2 tokens are single-space.

### The object model (properties vs. body)

Objects have two content layers, handled differently — this is the central mental model:
- **Properties** — typed fields: scalars, dates, **labels** (e.g. Status/Category), and **entity
  relations** (tags, meeting attendees). Set via `properties`/`labels`/`relations` maps on
  `create_object`/`update_object`. Map keys accept a **property name OR a property-definition
  id** (from `get_space_info`) — resolved by a shared helper (id exact-match first, then
  case-insensitive name; ambiguous/unknown = fail-before-write); output is keyed by the resolved
  id. Relations and labels are set by **name**, resolved **strictly** (unknown name = error; pass
  `create_missing_relations: true` to auto-create). Verified typed-wrapper shapes live in the
  migration design doc's "Verified write reference."
- **Body** — markdown, via `body`/`notes`/`content`/`markdown` params. Supports Capacities'
  inline conventions: `() text` creates+links a **Task**; `#tag` creates/links a **Tag**;
  `[[Name]]` links an **existing** object only (plain text if it doesn't exist).
- **Two write endpoints, two verbs:** `update_object` = properties (`PATCH /object`, **replace**
  each named prop; GET-first, fails on media). `append_to_object` = body (`POST /blocks/append`,
  **additive**, zero-read). `update_object`'s `body` param is a convenience that also appends
  after the PATCH. The object-target param on get/append/delete/update is **`objectId`**. See
  `project-internals/capacitiesMCP/plans/2026-07-11-append-vs-update-differentiation-design.md`.

### Available MCP Tools
`search_content`, `find_objects`, `list_spaces`, `get_space_info`, `create_object`,
`update_object`, `get_object`, `append_to_object`, `delete_object`, `save_weblink`,
`add_to_daily_note`.

### Error Handling
- `CapacitiesAPIError(code, message, details)` — codes `RATE_LIMIT_EXCEEDED`,
  `AUTHENTICATION_FAILED`, `API_ERROR`. On any non-ok response the **HTTP body is read and
  surfaced** in the message + `details.body`, so the LLM can self-correct on 400s.
- `create_object`/`update_object` **validate fully before writing** (fail-before-create): all
  input problems are returned as one error with nothing written, and relation auto-creation is
  deferred past the problem gate so a late failure never orphans an auto-created entity.

## ⚠️ Key gotchas

- **Media objects are CREATE-ONLY.** `MediaWebResource` (Weblink), `MediaPDF`, `MediaImage`,
  `MediaAudio`, `MediaFile` cannot be updated via **any** endpoint — `PATCH /object` and
  `PATCH /object/markdown` both return `400 "This object type cannot be updated via this
  endpoint."` A weblink's only settable surface is `title`/`description` at creation
  (`/object/url`). Tags/Category/Topic are **not settable via the API**; tag a weblink via a
  `#tag` in its `notes`. Regular/custom objects PATCH fine. (Upstream API limit — revisit
  `save_weblink` property support when the API allows media updates; see the object-completion
  design doc.)
- **Label options** come from each label property's `labelSet` (`{id,name,color}`) in
  `get_space_info`; write a label by mapping its name → option id. `multiple` flags multi-select.
- **`date` writes**: use `{type:"date",date:{start:<ISO>,dateResolution:"time"}}` — a full ISO
  timestamp is reliable; `dateResolution:"day"` requires UTC-midnight aligned to the space's TZ.
- **`update_object` REPLACES** a named property's value (it does not append); it GETs the object
  first (media objects will fail there). Use `append_to_object` for body.
- TypeScript pinned to **5.3.3** — 5.9.x OOMs in memory-constrained environments.

### Design docs
Internal design/plan docs are **not** in this public repo — they live in the private
`project-internals` repo at `project-internals/capacitiesMCP/plans/` (this repo gitignores
`/docs/plans/`; only `docs/` user guides ship publicly):
- `2026-07-10-capacities-v2-migration-design.md` — v2 migration + verified write reference.
- `2026-07-10-object-completion-principle-design.md` — "complete the object; compose across objects" principle + the media-object constraint + docs deliverables.
- `capacities_mcp_plan.md` — original technical plan & architecture.

### Building the DXT Extension
```bash
npm run build                          # Compile src/ → server/dist/
npx @anthropic-ai/mcpb pack            # Package (reads manifest.json + .mcpbignore) → capacitiesMCP.mcpb
mv capacitiesMCP.mcpb capacities-desktop-extension.dxt   # ship under the .dxt name (README links it)
```
Notes: `@anthropic-ai/dxt` was renamed to `@anthropic-ai/mcpb`; the pack tool now reads
**`.mcpbignore`** (NOT `.dxtignore`) and outputs **`.mcpb`**. `.mcpb`/`.dxt` are the same zip
format — Claude Desktop accepts both. The `.mcpbignore` must exclude root `node_modules/` (runtime
deps live in `server/node_modules`), `test-dist/`, and repo/agent state (`.beads/`,
`.private-journal/`, `.git/`) — otherwise they leak into the public artifact. Verify after packing:
`unzip -p capacities-desktop-extension.dxt manifest.json` shows `version` + 11 tools, and the
archive contains no `.private-journal/`/`.beads/`.

### Deployment (mcp-gateway)
The gateway spawns the child image `ghcr.io/inconceivablelabs/capacitiesmcp:latest` (note: **no
hyphen**) with **`--pull never`** — so it uses whatever image is **local** on the host Docker
daemon and does **not** pull from GHCR. To deploy new code:
```bash
npm run build
docker build -f server/Dockerfile -t ghcr.io/inconceivablelabs/capacitiesmcp:latest .
cd ../mcp-gateway && docker compose restart mcp-gateway   # re-reads catalog/config, respawns child
```
The token + tool list live in the mcp-gateway repo's `docker/config.yaml` and
`docker/catalogs/custom-local-catalog.yaml` (real files gitignored; `.example` tracked) — **not**
`server.yaml`. GHCR `:latest` is only refreshed when the branch merges to **main** (CI gates
`:latest` on the default branch); because of `--pull never`, adopting a fresh GHCR image still
needs a manual host `docker pull … :latest` + gateway restart. After redeploying, existing MCP
clients must reconnect (`/mcp`) to see the new tool surface.

### Project Structure
- `src/` — Single source of truth (TypeScript)
- `server/` — Runtime packaging only (Dockerfile, package.json, dist/)
- `tsconfig.json` — Builds `src/` directly into `server/dist/`; `tsconfig.test.json` builds tests.

### MCP Server Integration

#### Option 1: Desktop Extension (Recommended)
Use the bundled `capacities-desktop-extension.dxt` for one-click installation.

#### Option 2: Manual Configuration
```json
{
  "mcpServers": {
    "capacities": {
      "command": "node",
      "args": ["./server/dist/index.js"],
      "env": {
        "CAPACITIES_API_TOKEN": "your_cap-api-_token_here"
      }
    }
  }
}
```
