# Capacities MCP — v1 (Beta) → v2 REST API Migration & Redesign

**Date:** 2026-07-10
**Branch:** `feat/capacities-v2-migration`
**Epic:** cap-6dy
**Status:** Design (client layer cap-6dy.2 already implemented & committed at 805d967)

## Purpose

The Capacities Beta API this MCP calls is **discontinued 2026-09-01**. This migrates the
server to the v2 REST API (`https://api.capacities.io`, `X-Capacities-Api-Version: 0.1.0`)
and, rather than porting five narrow v1 tools verbatim, restructures the tool surface around
one generic write primitive so the server serves both Tom's needs and the public repo's
diverse users without bespoke per-use-case code.

## Decisions already settled (prior context)

- **Rebuild on v2 REST with a shared bearer token**, not adopt the official hosted MCP
  (which requires OAuth 2.1 per client). Preserves the single-credential-in-mcp-gateway model.
- **Single-space per token** (verified live): `GET /space` is singular; search takes no
  `spaceId`. Multi-space = multiple tokens.

## Core design principle: the LLM is the composition layer

The MCP is consumed by an LLM that can orchestrate multiple calls. We do **not** build a
bespoke tool per workflow. Instead: a small generic core + `get_space_info` schema
introspection + search-based resolution. "Log a meeting with attendees + notes + a task"
becomes an emergent sequence (introspect → create meeting with `[[names]]` → create task),
not hardcoded logic. Optional thin "sugar" wrappers are added later only if a composition
proves high-frequency.

## Key finding: markdown is the universal write path

Live experiments (2026-07-10, throwaway create+delete against Tom's space) established that
**`POST /object/markdown` with YAML frontmatter is the right write path for ALL property
types — scalar and relational alike** — because Capacities resolves `[[Name]]` wiki-links to
entity ids itself. This sidesteps the id-resolution problem that reportedly broke the
official MCP on relationship properties like meeting `Attendees`.

Verified:
- Sending frontmatter `Attendees: "[[Tom Booth]]"` on a `meeting` create returned
  `Attendees: {type:"entity", entity:[{id:"…"}]}` — Capacities resolved the person by title.
- `PATCH /object/markdown` **merges**: patching only `description:` left `title` and
  `Attendees` intact.
- Frontmatter keys are property **display names** (`title`, `description`, `Date`,
  `Attendees`, `Type`); round-trips serialize back (`attendees: [Tom Booth]`).

This means Layer 0 needs **no per-type typed-wrapper encoders and no id-resolution engine** —
it emits markdown, Capacities does the rest. The earlier "weblink tags: drop vs build"
question dissolves: tags are an `entity` property, so `tags: "[[AI]]"` works by the same
mechanism.

## Actor Capabilities

**Tom (via Claude) can:**
- Search his space's objects by title (`search_content`).
- Introspect any structure's writable properties + types (`get_space_info`).
- Create any object type from markdown, setting scalars via frontmatter and relations via
  `[[Name]]` links (`create_object`).
- Partially update any object without wiping other properties (`update_object`).
- Append notes/blocks to an existing object (`append_to_object`).
- Append markdown to today's daily note (`add_to_daily_note`).
- Save a URL as a Weblink with title/description/notes (`save_weblink`).
- Read an object's content as markdown (`get_object`).

**Claude (orchestrator) can:**
- Read a structure's schema to know which frontmatter fields need `[[]]` links before writing.
- Compose multi-step workflows (search → create → link → append) with no bespoke server code.

**Capacities (system) does:**
- Resolve `[[Name]]` / `[[collection/Name]]` to entity ids by title.
- **Auto-create a new entity when a `[[Name]]` link does not resolve** (pollution risk — see
  Assumptions/Constraints).
- Merge `PATCH /object/markdown` updates (only supplied frontmatter keys change).

**Explicitly NOT supported (v2 API limitations):**
- Creating or linking Outlook-synced **event** objects, or "create meeting from event": no
  event/calendar structure is exposed and `meeting` has no `event` property. UI-only.
- Bulk cross-object analytics beyond rate limits (tracked separately as cap-6dy.4).

## Tool surface (v2)

**Migrated core (client verified live, cap-6dy.2 done):**
| Tool | Endpoint | Notes |
|---|---|---|
| `search_content` | `POST /objects/search` | single space; title match; `structureIds`/`limit` optional |
| `list_spaces` | `GET /space` | returns the one token-scoped space |
| `get_space_info` | `GET /space/structures` | schema introspection; now central to the generic-create UX |
| `add_to_daily_note` | `POST /blocks/daily-note/append` | `{markdown, noTimeStamp}`; no `origin` |
| `save_weblink` | `POST /object/url` | `{url, markdown:notes}` + `properties.title/description` (typed wrappers, verified) |

**New generic Layer 0:**
| Tool | Endpoint | Notes |
|---|---|---|
| `create_object` | `POST /object/markdown` | `{structureId, markdown}`; frontmatter scalars + `[[links]]` |
| `update_object` | `PATCH /object/markdown` | `{id, markdown}`; **merges** — partial updates safe |
| `append_to_object` | `POST /blocks/append` | append blocks/markdown to an existing object |
| `get_object` | `GET /object/markdown` | read an object as markdown (round-trip / inspection) |

**Deferred sugar (not in this migration):** `log_meeting`, `create_task` — add later only if
composition proves repetitive. Weblink `tags` (entity) — subsumed by the `[[]]` mechanism;
can be exposed on `save_weblink` later if desired.

## Write model (create_object / update_object)

`markdown` = optional YAML frontmatter + body.
- **Scalars** → `title:`, `description:`, `Date:`, `Type:`, `label`-type, etc. keyed by
  property display name.
- **Relations** (`entity` type) → `[[Name]]` or `[[collection/Name]]`; multi-value as a YAML
  list (exact form to be validated — see Assumptions).
- **Body** → markdown content lands as blocks.
- `update_object` (PATCH) merges: send only the frontmatter keys you want to change.

`get_space_info` tells Claude each structure's property names + `type` + `writable`, so it
knows which fields exist, which take `[[]]`, and which are read-only.

## Constraints & risks

1. **Auto-create on unresolved link** — a typo'd `[[Name]]` silently creates a junk entity.
   Mitigation: document prominently; `create_object`/`update_object` tool descriptions must
   warn the model to use names it has confirmed exist (via `search_content`) for relations,
   or accept auto-creation intentionally. Consider a future "strict relations" option that
   pre-resolves via search and errors on miss.
2. **Event linking unsupported** — documented limitation; Tom's UI-first workflow for
   event-linked meetings persists.
3. **Read-only property types** — `number`, `boolean`, `lastUpdatedAt` (and some per-structure
   props) are not writable; `get_space_info` exposes `writable` so the model can avoid them.
4. **Rate limits (v2, per 60s):** `/objects/search` 30, `/object*` 30, `/blocks/*` 30,
   `/object/url` 10, `/space*` 10. Composition-heavy flows must stay within these.

## Assumptions (validate before/within implementation)

| # | Assumption | Risk if wrong | Validation |
|---|---|---|---|
| A1 | Multi-value entity frontmatter (several attendees) links all of them | Only first links / silent partial | Throwaway create with **two known-existing** people; assert entity count == 2 |
| A2 | Frontmatter key = property display name for ALL types (verified: title, description, Date, Attendees, Type) | Some built-in props use i18n names (`entity_title_name`) → key mismatch | Round-trip `GET /object/markdown` per target structure; compare keys |
| A3 | Scalar write via frontmatter works for `date`/`label`/`number`(ro)/`url`/`richText` (verified: title, text) | Format rejected (400) | Throwaway create per type on a structure that has it |
| A4 | `[[collection/Name]]` disambiguates when titles collide across types | Wrong entity linked | Create with a colliding name both ways; inspect resolved id |
| A5 (verified) | PATCH merges; single `[[Name]]` resolves; single-space token | — | Done 2026-07-10 |

## Testing strategy

- Extend the `node:test` harness (added in cap-6dy.2) with mocked-`fetch` unit tests for
  `create_object`/`update_object`/`append_to_object`/`get_object`: assert request path, method,
  version header, and body shape.
- Live shape-verification for A1–A4 done by the orchestrator (subagents have no token), then
  encoded as fixtures.
- Build (`tsc`) + `npm test` remain the quality gates; no new dependencies.

## Non-goals

- Event/calendar creation or linking (API gap).
- Bulk analytics / cross-object aggregation (cap-6dy.4, separate decision).
- Adopting the official hosted MCP / OAuth.
