# Capacities MCP — v1 (Beta) → v2 REST API Migration & Redesign

**Date:** 2026-07-10 (rev. 2 — incorporates two-agent review + live A1 validation)
**Branch:** `feat/capacities-v2-migration`
**Epic:** cap-6dy
**Status:** Design. Client layer (cap-6dy.2) implemented & committed at 805d967.

## Purpose

The Capacities Beta API this MCP calls is **discontinued 2026-09-01**. Migrate the server to
the v2 REST API (`https://api.capacities.io`, required header
`X-Capacities-Api-Version: 0.1.0`, bearer `cap-api-…` token) and restructure the tool surface
around a small generic core so it serves both Tom's workflows and the public repo's users
without bespoke per-use-case code.

## Decisions settled

- **Rebuild on v2 REST with a shared bearer token**, not adopt the official OAuth-2.1 hosted
  MCP (preserves the single-credential-in-mcp-gateway model; no per-client auth).
- **Single-space per token** (verified live + confirmed in v2 spec): `GET /space` is singular,
  search takes no `spaceId`. Multi-space = multiple tokens.
- **Delete the 4 mock-backed tools** (`smart_search`, `advanced_search`,
  `analyze_content_patterns`, `identify_knowledge_gaps`) — they violate no-silent-mocking and
  confuse an LLM consumer. Fold real value (`structureIds`/`limit`) into `search_content`.
  This resolves cap-6dy.4.
- **Add `delete_object`** — symmetric with create; API supports soft + `hardDelete`.
- **Strict entity resolution by default** — an unresolved relationship name is an *error* that
  reports the unmatched names; an explicit `create=true` flag opts into create-then-link.
  (Chosen over silent auto-create because the server ships to public users.)

## Core principle: the LLM is the composition layer

The MCP is consumed by an LLM that can orchestrate. We build a small generic core +
`get_space_info` schema introspection + name→id resolution, not a bespoke tool per workflow.
"Log a meeting with attendees + notes + a task" = introspect → `create_object(meeting, …)` →
`create_object(task, …)`, sequenced by the model. Optional sugar wrappers deferred.

## Write model (KEY — corrected by live testing 2026-07-10)

Two API write paths exist; live testing determined which to use:

- **Markdown route** (`POST`/`PATCH /object/markdown`): frontmatter scalars + body + `[[Name]]`
  wiki-links that Capacities auto-resolves. **But it caps entity properties at ONE link** —
  multi-value relations (several attendees/tags) do **not** work through it (verified: block-
  list, flow-list, and comma syntaxes each linked only 1).
- **Structured route** (`POST`/`PATCH /object`): properties as typed wrappers, e.g.
  `{ "<propId>": {"type":"entity","entity":[{"id":a},{"id":b}]} }`. **Links N entities
  reliably** (verified: 2 attendees linked). Requires resolving names→ids first.

**Decision: `create_object`/`update_object` use the STRUCTURED route uniformly.** Because
strict resolution already requires checking each entity exists (via search), we resolve
names→ids ourselves and pass `entity:[{id}]`. This gives reliable multi-value relations and
makes strict-mode + `create=true` natural. The `[[Name]]` auto-resolve trick is not depended
on for property writes.

Verified property write-shapes (structured route): `title` → `{type:"title",title:{value}}`;
`text` → `{type:"text",text:{value}}`; `entity` → `{type:"entity",entity:[{id},…]}`; `date`
accepted via markdown frontmatter as ISO (stored as a datetime interval). **PATCH replaces the
value of any property it names** (verified: patching `Attendees` dropped the prior list) while
leaving unnamed properties intact — so `update_object` on a multi-value prop REPLACES, it does
not append. Body/notes are added via `append_to_object` (blocks), not by re-PATCHing.

## Entity resolution (the piece that broke the official MCP)

`resolve(name, entityStructureId) → id`: `POST /objects/search {query:name, structureIds:[…]}`,
take the exact-title match.
- 0 matches → strict: include in the error report; `create=true`: create the entity
  (`POST /object/markdown` or structured `/object` with `title=name`) then link its id.
- >1 match → ambiguous: report for disambiguation (do not guess).

## Actor Capabilities

**Tom (via Claude) can:** search objects by title (optionally scoped by `structureIds`);
introspect a structure's writable properties + types (`get_space_info`); create any object
type with scalar + relationship properties (`create_object`, relations resolved strictly);
partially update an object (`update_object`, replace-per-named-prop semantics); append
notes/blocks to an object (`append_to_object`); read an object as markdown (`get_object`);
delete an object (`delete_object`); append to the daily note (`add_to_daily_note`); save a
weblink (`save_weblink`).

**Claude (orchestrator) can:** read a structure's schema before writing; resolve/relate by
composing search → create; self-correct on write failures **because 400 error bodies are
surfaced** (see below).

**Capacities (system) does:** link entities by id (structured route, N reliably); merge PATCH
at the key level while replacing named property values; auto-resolve `[[Name]]` on the markdown
route (single value only) — not relied upon.

**Explicitly NOT supported (v2 API gaps):** create/link Outlook-synced **event** objects or
"create meeting from event" — no event/calendar structure is exposed and `meeting` has no
`event` property (verified). Bulk cross-object analytics beyond rate limits.

## Tool surface (v2)

**Migrated core (client done, cap-6dy.2):** `search_content` (`POST /objects/search`; **add
`structureIds`/`limit`, drop `space_id`**), `list_spaces` (`GET /space`, the one scoped space),
`get_space_info` (`GET /space/structures`; **drop `space_id`**), `add_to_daily_note`
(`POST /blocks/daily-note/append`; **drop `space_id`**), `save_weblink` (`POST /object/url`;
title/description via `properties`, deferred from .2 — **currently sends only `{url,markdown}`**).

**New generic core:**
| Tool | Endpoint(s) | Notes |
|---|---|---|
| `create_object` | `POST /object` (+ resolve via `/objects/search`; body via `/blocks/append`) | structured props; strict resolution + `create` flag |
| `update_object` | `PATCH /object` | merges by key, **replaces named prop values**; description must warn |
| `append_to_object` | `POST /blocks/append` | add body/blocks without touching properties |
| `get_object` | `GET /object/markdown` | returns JSON `{id,structureId,markdown}` |
| `delete_object` | `DELETE /object?id=&hardDelete=` | soft default; `hardDelete` opt-in |

**Deleted:** `smart_search`, `advanced_search`, `analyze_content_patterns`,
`identify_knowledge_gaps` (mocks). **`create_structured_note`** (`create.ts`): builds a
markdown template into the daily note; keep working (daily-note is migrated) but flag as a
candidate to fold into `create_object`/`add_to_daily_note` later — decide in the plan.

**Deferred sugar:** `log_meeting`, `create_task` — add later only if composition proves
repetitive.

## Cross-cutting client changes (from code review)

1. **Surface HTTP error bodies.** `makeRequest` currently throws `API error: ${status}` and
   discards the body (`capacities.ts:42`). For structured/markdown writes, a 400 with the
   validation reason is the LLM's only path to self-correct — read `response.text()` on non-ok
   and include it in `CapacitiesAPIError`. **Highest-leverage change for Layer-0 usability.**
2. **Drop `space_id` from all migrated tool schemas** (`search.ts:26,119`, `weblink.ts:22`,
   `daily-note.ts:19`) — the client already ignores it; keeping it forces a pointless
   `list_spaces→UUID` dance and a `validateUUID` throw. Remove the internal `getSpaces()`
   round-trip in `search_content` too.
3. **Rate-limit × composition:** `/space/structures` is the tightest bucket (10/60s) and the
   call the model makes first/repeatedly. `get_space_info` description must say "introspect
   once and reuse"; the limiter should return a structured "rate-limited, retry in Ns" rather
   than silently sleeping up to 60s inside a tool call (`capacities.ts:166-169`).
4. **Gate/remove DEBUG logging** (cap-6dy.7) — leaks response bodies to stderr every call.
5. **Tool descriptions encode the composition contract:** `create_object` → "call
   `get_space_info` first; set relations by name (resolved strictly; pass `create=true` to
   create missing)"; `update_object` vs `append_to_object` boundary (properties vs body);
   `update_object` "replaces, does not append, a named multi-value property."

## Constraints & risks

- **`update_object` replace semantics = data-loss risk.** Naming a multi-value prop replaces
  its whole list (verified). Mitigate via explicit tool-description warning + `append`-style
  guidance for adding to relations.
- **Read-only property types** (`number`, `boolean`, `lastUpdatedAt`, some per-structure) — the
  live `/space/structures` response DOES include a `writable` flag (verified), so
  `get_space_info` can surface it and the model can avoid them; behavior on writing a read-only
  prop (400 vs silent ignore) is unverified (MA5).
- **Event linking unsupported** (verified gap) — Tom's UI-first flow for event-linked meetings
  persists.
- **Rate limits (per 60s):** search 30, object* 30, blocks/* 30, object/url 10, space* 10.

## Assumptions (validate before/within implementation)

| # | Assumption | Risk | Validation |
|---|---|---|---|
| A1 (RESOLVED) | Multi-value relations: markdown caps at 1; **structured `/object` links N** | — | Verified live 2026-07-10 |
| A2 | Structured typed-wrapper write shape for `date`/`label`/`url`/`richText`/`number` (verified: title, text, entity; date via md) | 400 on write | Throwaway create per type on a structure that has it |
| A3 | `create_object` body mechanism: blocks in `POST /object` vs a follow-up `POST /blocks/append` | body dropped / two-call needed | Probe `POST /object` with blocks; else append after create |
| A4 | Writing a read-only prop → 400 (not silent) | opaque partial writes | Throwaway create setting a `number`/`lastUpdatedAt` |
| A5 (VERIFIED) | PATCH replaces named prop / merges others; single-space; `writable` flag exists; `GET /object/markdown` returns JSON; `DELETE /object` works | — | Verified live 2026-07-10 |

## Testing strategy

Extend the `node:test` harness (cap-6dy.2) with mocked-`fetch` unit tests for
`create_object`/`update_object`/`append_to_object`/`get_object`/`delete_object` and the
resolution helper: assert request path/method/version-header/body shape, strict-vs-`create`
branching, and error-body propagation. Live shape-verification (A2–A4) by the orchestrator
(subagents have no token), encoded as fixtures. Gates: `tsc` + `npm test`, no new deps.

## Non-goals

Event/calendar linking (API gap); bulk analytics; adopting the official hosted MCP; the
deferred sugar tools.
