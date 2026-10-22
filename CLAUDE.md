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
  `getObjectMarkdown`, `appendBlocks`, `deleteObject`, `saveWeblink`, `saveToDailyNote`,
  `enumerateObjects` (one page of `GET /objects/structure|tag`).
- **`types.ts`**: interfaces for spaces, structures, property definitions (incl. `labelSet`,
  `multiple`, `allowedStructures`), objects, and options.
- **Rate limiting** (per 60s window, client-side): `space` 10 · `search` 30 · `object` 30 ·
  `blocks` 30 · `object/url` (weblink) 10 · `enumerate` (`/objects/structure|tag`) 30. When a window is exhausted the limiter **throws**
  `CapacitiesAPIError("RATE_LIMIT_EXCEEDED", …, {retryAfterMs})` rather than silently sleeping.

#### Tools Layer (`src/tools/`)
- **`search.ts`**: `search_content` (title match, optional `structureIds`/`limit`; semantic
  "related by meaning" hits are kept but listed after the title matches and labelled — cap-1kc),
  `list_spaces` (the one scoped space), `get_space_info` (structures + property ids, types,
  `writable`, label options, relation targets).
- **`find.ts`**: `find_objects` — live LOCATE primitive (cap-0yu, cap-i93). Stage 1 seeds one of
  four ways: **title** (`/objects/search`, kept to titles containing `title_hint` via
  `matchesTitle` in `utils/normalize.ts`, which drops semantic hits — cap-1kc), **tag**, **tag +
  title**, or **structure only** (list the whole type). A title search whose RAW result count hits
  50 escalates to listing the structure. Listings read up to `page_budget` pages (default 12, max
  25) and are ordered by title date (newest first; oldest first for an ascending date sort;
  undated after dated either way) before the `fetch_cap` cut (default 30, max 50). Stage 2 is per-candidate `GET /object` (JSON, paced), then client-side
  filter/sort. **Short-circuit:** no filters and no sort returns ids+titles with zero GETs. **Per
  call:** a call that LISTS stays within 45 requests in total (a plain title search is exempt and
  keeps `fetch_cap` up to 50); at most 5 relation filters (labels/dates do not count). A failure on a
  listing PAGE ends the listing as a PARTIAL with the rows read so far (only a 401 there fails the
  call); the structure read, the seed search and name resolution still fail it as before. Every
  non-error result carries a SECOND text block, `content[1]`, of a newline then compact JSON (`seed_method`,
  `seed_complete`, `candidates_complete`, `seed_size`, `considered`, `errored`, `matched`,
  `returned`) — not `structuredContent`, because Claude Code shows the model the structuredContent
  INSTEAD of the text (cap-ul0); `content[0]` stays the human text. The full answer needs both flags true
  AND `matched === returned`. **Output contract:** a `Note:` line means incomplete, and the phrase
  `checked N of M candidates` is reserved for the stage-2 rate-budget Note (PA parses both).
  Returns NO bodies (compose with `get_object`); no persistent state.
- **`enumerate.ts`**: `enumerateAll` — walks `/objects/structure|tag` pages by cursor up to a page
  budget, dedupes by id, and reports `complete` (last page said `hasMore:false`), `stopReason`,
  `pagesRead` and `requestsIssued`. Rate-limit, API and network errors end it as a partial; only
  `AUTHENTICATION_FAILED` throws.
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
- **title-date.ts**: `parseTitleDate` (leftmost `YYYY-MM-DD`, `May 19, 2026` or `3/18/26` date in a
  title) and `orderEnumerated` (dated first by date, then undated, stable) — orders listed
  candidates before `find_objects` cuts them.

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
- **The client-side limiter is NOT the real constraint — `api.capacities.io` enforces its own
  budget server-side, and that window is ROLLING, not fixed.** Measured against `/object`
  2026-08-06: a caller that spends ~28 calls reading and then writes immediately gets rejected,
  and slots free **individually** as each ages out of the trailing 60s. Diagnostic tell for
  rolling-vs-fixed: the FIRST n operations fail and later ones succeed (budget exhaustion would
  fail the LAST n). Two consequences. (a) The in-process limiter cannot protect a consumer that
  builds a fresh client per call — personal-assistant does exactly that, so the limiter never
  engages for it (pa-ikuq); treat it as best-effort, not a guarantee. (b) **Server rejections
  arrive as a Cloudflare 1015 "Access denied … banned you temporarily" HTML BODY carried on an
  HTTP 429** (`api.capacities.io` is behind Cloudflare — `server: cloudflare`, `cf-ray`). So
  classification keyed on **status 429 works**; classification keyed on a **parseable JSON body
  does not**. Verified 2026-08-20 by tracing the one captured rejection
  (`backfill_meeting_titles.py:277`, live 2026-08-05) back through `object.ts:852` →
  `capacities.ts:79`, which fires only inside the `status === 429` branch. An earlier version of
  this line said a 429-keyed check "will miss them"; that was wrong and it caused a P1 bug to be
  filed against a non-existent amplifier (cap-fvb, retracted). One incident, two requests — it
  does not prove every Cloudflare rejection is a 429 (a hard ban can be 403), which is why
  retry-on-rejection beats classifying. The ban is IP-level, so one greedy consumer takes every
  other client sharing that egress down with it for hours. Advise consumers to retry on rate-limit rather than model
  the window; two client-side pacing models (fixed then sliding) both failed in production while
  retry needed no model at all. (pa-z4m5, 2026-08-06.)
- **This repo is PUBLIC — never vendor real space data as a test fixture.** `gh repo view` →
  `"visibility":"PUBLIC"`. Meeting/person/org titles from Tom's Capacities space carry colleague names, client
  and partner organisations, and board-meeting cadence; committing them is permanent (history, forks, clones).
  Build fixtures **synthetically** to reproduce the *shapes* under test (separators, double spaces, mid-word
  matches, date-digit runs, empty titles) and keep any real corpus in the private `project-internals` repo,
  citing its result rather than shipping it. Caught 2026-08-21 (cap-i93): a design doc instructed "a fixture of
  the 469 real titles" and survived four review passes — every reviewer was scoped to *is the design correct*,
  nobody to *what does this publish*. Ask that second question separately.
- **Tool TEXT output is a contract: other code parses it.** PA's `scripts/backfill_meeting_titles.py`
  reads ANY line starting `Note:` in `find_objects` output as "sweep incomplete" and fails the run,
  and `gateway_client.py` regex-parses `search_content`'s `**Title**\nID:` blocks. So a `Note:` line
  must mean incomplete, and informational lines must not start with it. Before changing the output
  format, grep personal-assistant for the tool name and run the real parser on the new output.
  (cap-1kc `e1cba05`, 2026-10-21.)
- **Never return `structuredContent` from a tool whose text matters to an LLM:** Claude Code 2.1.x
  shows the model only the structuredContent JSON and drops `content[0].text` (cap-ul0, 2026-10-22).
  Put machine-readable fields in a second text block.
- **`/objects/search` returns semantic hits too**, interleaved with title matches and unmarked. Only
  `matchesTitle` (`src/utils/normalize.ts`) says which hits are title matches. Below the 50 cap,
  every title match is still returned. (cap-1kc, live probe 2026-10-21.)
- **`/objects/structure|tag` answer a bogus id with `200 {results:[]}`** — resolve ids strictly
  (`find_objects` resolves the structure and the tag name before listing), and `enumerateObjects`
  throws on a non-JSON page rather than returning empty, so "nothing exists" is never a parse
  failure in disguise. (cap-i93.)
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
Notes: **`manifest.json`'s `tools:` array is hand-maintained metadata** — adding/removing a tool
in code does NOT update it, and the packed .dxt ships the stale list silently (bit us on
find_objects: repack showed 10 tools until the entry was added by hand; same class as the
gateway catalog's metadata-only `tools:` field). Adding a tool = code + CLAUDE.md + README
table + manifest.json `tools:` + version bump. `@anthropic-ai/dxt` was renamed to `@anthropic-ai/mcpb`; the pack tool now reads
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
docker tag ghcr.io/inconceivablelabs/capacitiesmcp:latest capacitiesmcp:rollback-pre-<sha>  # FIRST
npm run build
docker build -f server/Dockerfile -t ghcr.io/inconceivablelabs/capacitiesmcp:latest .
cd ../mcp-gateway && docker compose restart mcp-gateway   # re-reads catalog/config, respawns child
```
From this devcontainer, `docker build` fails with `error getting credentials … exit status 255`
whenever it must pull a base image. Build with an empty config instead:
`DOCKER_CONFIG=<dir holding {}> docker build …` (shared memory `docker-pull-needs-empty-docker-config`).
**Tag the rollback BEFORE rebuilding.** Rebuilding onto `:latest` can leave the prior image
unrecoverable — it is not reliably retained as a dangling `<none>` (verified cap-d8f 2026-08-17:
`docker image inspect <old-id>` → `No such image`). If the tag is already gone, rebuild the
previous commit in a throwaway worktree, and smoke it to confirm it reproduces the OLD behaviour
before trusting it as a rollback.
The token + tool list live in the mcp-gateway repo's `docker/config.yaml` and
`docker/catalogs/custom-local-catalog.yaml` (real files gitignored; `.example` tracked) — **not**
`server.yaml`. GHCR `:latest` is only refreshed when the branch merges to **main** (CI gates
`:latest` on the default branch); because of `--pull never`, adopting a fresh GHCR image still
needs a manual host `docker pull … :latest` + gateway restart. After redeploying, existing MCP
clients must reconnect (`/mcp`) to see the new tool surface.

**Verifying a built image (stdio smoke).** Hold stdin open past the last request or the server hits
EOF and exits before flushing — piping the file straight in is silent ~2/3 of runs, and a silent *control*
reads as "the deployed image is broken" rather than "the probe raced":
```bash
(cat req.jsonl; sleep 3) | docker run --rm -i -e CAPACITIES_API_TOKEN=<any> <image>
```
Run it 2-3x against the PREVIOUS image as a control and compare tool count + `serverInfo.version`. (cap-d8f, cap-0yr)

### Project Structure
- `src/` — Single source of truth (TypeScript)
- `server/` — Runtime packaging only (Dockerfile, package.json, dist/)
- `tsconfig.json` — Builds `src/` directly into `server/dist/`; `tsconfig.test.json` builds tests.
- **Two lockfiles, both load-bearing.** The Dockerfile's builder stage installs from the ROOT
  `package.json`/`package-lock.json` (needs the devDeps to run `tsc`); the runtime stage installs from
  `server/` with `--omit=dev`. They are a **duplicated tree, not two packages** — after a dependency fix
  they resolve identically except root's build-only entries (`typescript`, `@types/node`, `undici-types`).
  Any `npm audit fix` must be run in BOTH, or the image ships the unfixed half. (cap-d8f)

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

## Recent Activity

*Last 3 sessions. Deeper history: git log, beads, journal.
Cross-project orientation: `knowledge/self/work-context.md`.*

- **2026-10-21 —** **Two releases and a README refresh, all deployed.** Capacities search now also returns hits that match by meaning. 2.1.1 (cap-1kc, `a7f54e4`+`e1cba05`): `find_objects` keeps title matches only, and `search_content` labels the rest "Related by meaning". 2.1.2 (cap-21w, `562fee0`): SDK 1.32.1, 46 → 0 Dependabot alerts, none reachable on stdio. README (cap-nc0, `1c3f7d9`) adds a dated "Why this server?" comparison vs the official MCP and the `@capacities/api` SDK; the `.dxt` was repacked at 2.1.2 (it had been stale at 2.1.0). Closed cap-1r7; the SDK was rejected (cap-5l8: needs zod 4, hardcodes API 1.0.0). Janet's instruction line is committed in PA (`b315b59`) and goes live on PA's next rebuild. Open: **cap-42j** (small `limit` lets semantic hits crowd out title matches), **cap-yp9** (RateLimit header is `"30-in-1min"; r=..; t=..`, not the documented format), cap-i93 (its matcher now lives in `utils/normalize.ts`), cap-9js (zod 4: unblocked, 7 `z.record` sites), cap-8h5, plus the API-gap beads (cap-6au/zwo/bmr/dpg/eim). Theme: **a text-output tool has parsing consumers.** PA's backfill treats any `Note:` line as "incomplete", and a benign note would have failed every run. Grep consumers before changing tool output. *Journal: 2026-10-21.*
- **2026-08-18 —** **Two security beads closed and deployed** — cap-d8f took all 64 Dependabot alerts to 0 (every one transitive under `@modelcontextprotocol/sdk`; the HTTP-transport half was never reachable on our stdio path) and cap-0yr moved the base image off EOL `node:18-slim` (unpatched since 2025-04-30) to `node:22-slim`, chosen for test parity with the devcontainer. Merged `9b5cbad` + `f0158a1`; gateway now runs the pulled CI artifact with digest parity verified, Janet untouched across both restarts. Also fixed a pre-existing stale `serverInfo` 2.0.0 and pinned all four version sites with a test. Open: **dc-6hp** (dependabot docker rollout — 7 repos, incl. google-mcp's placeholder config that runs nothing; Dependabot's major-bump behaviour still unverified, and microsoft-mcp's docker entry is a free natural experiment whose first Monday run is 08-24), **cap-1r7** (Janet carry-forward live proof), **cap-xom**, cap-9ti/t7n/7xe. Theme: **probes that lie** — three of four real findings came from checks that failed in reassuring ways (a version test reddening on its own `ERR_INVALID_URL`, a stdio smoke silent 2/3 of runs on a stdin-EOF race, a stderr read that zsh MULTIOS turned into a stdout read); and the deploy runbook's "prior image survives as dangling `<none>`" assumption is FALSE — corrected in global + project CLAUDE.md, rollback must be tagged before rebuilding. *Journal: 2026-08-18.*
- **2026-07-13 —** **find_objects SHIPPED + DEPLOYED (v2.1.0)** — full arc in one session: design review-corrected (two-agent pass killed the original props+body×50 pacing sketch → JSON-only locate primitive, fetch_cap 30/50, fail-open partials), plan drafted by dispatched agent + dual plan-review, 9 tasks via subagent-driven development (PR #30 → main `1bb0806`, 113/113), stdio smoke + live-space smoke both green, gateway restarted (11 tools), consumer-verified from Tom's reconnected session on the real 14-identical-titles case; release `a3b9ba4` (.dxt repacked — manifest `tools:` array is hand-maintained, was silently stale at 10). Product framing settled: **Janet-first, then generalize**; 3-layer model (parity floor ceded to official MCP / gap-fillers with designed half-life / durable workflow layer). QA doctrine shipped to skills (`01a8c78`): writing-plans System Verification section + QA-coverage reviewer ("B's brain in C's body"), SDD implementer mechanical-QA block (duration-regression gate), assemble-and-run demoted to conditional. Open: **cap-1r7** (Janet instruction updates + carry-forward live proof — Tom running separately; + A13 fetch_cap=50 timing), cap-9ti (Date.parse polish), cap-t7n (new block-edit endpoints), cap-7xe (daily-note date). Theme: the Janet carry-forward run is the first layer-3 "was it compelling" signal; block-edit endpoints (t7n) are the API riding up under us within 24h of the design. *Journal: 2026-07-13.*
