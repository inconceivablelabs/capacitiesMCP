# Object Completion Principle — `save_weblink` property support + markdown-convention docs

**Date:** 2026-07-10
**Branch:** `feat/capacities-v2-migration`
**Epic:** cap-6dy (follow-on to `2026-07-10-capacities-v2-migration-design.md`)
**Status:** Design — awaiting review.

## Purpose

A design principle emerged while finishing the v2 tool surface: **which multi-step API
sequences a tool should absorb, versus leave to LLM composition.** This doc records the
principle, applies it (a single concrete code change), and adds the documentation that
makes the resulting model legible to an LLM consumer (Janet) and a human README reader.

## The principle: "Complete the object; compose across objects"

A write tool should **absorb** a multi-step API sequence when every step is *about the same
object* and all inputs are known at call time. It should **leave the sequence to LLM
composition** when the steps span *distinct standalone objects*.

"Completing an object" has exactly two layers, handled differently:

1. **Body** — freeform content, written as **markdown**, including Capacities' inline
   conventions (below). A single markdown write; Capacities expands it server-side. This is
   LLM *formatting* — the tool just accepts markdown and we document the conventions.
2. **Properties** — the object's **typed fields**: scalars, dates, **labels**
   (e.g. Weblink Category/Topic), and **entity relations** (tags, meeting attendees). These
   are *not* prose — they are structured fields requiring typed-wrapper writes + name→id
   **resolution**, and sometimes a second API call. **A tool must let you set all of an
   object's properties in one call, even when the API splits them across endpoints.** This
   is where internalized multi-step earns its keep.

**Two tests — both must hold to internalize:**
- **One primary object.** The sequence produces/mutates a single object the caller thinks of
  as one thing. Subordinate objects (auto-created relation targets) are permitted *only* in
  service of that object's own properties, behind an explicit opt-in (`create_missing_relations`).
- **No new decision mid-sequence.** All inputs supplied up front; later steps are mechanical.

**Riders:**
- **Fail-before-write.** Do all read-only resolution/validation first, so input problems
  (unknown property, unresolved/ambiguous name, unknown label option) surface before *any*
  write. A genuine API failure mid-write-phase leaves a partial; report it honestly (the
  primary object still exists) — fail-open, the primary value is preserved.
- **YAGNI gate.** "Internalizable" ≠ "must build." Only absorb sequences that are plausibly
  common; don't pre-build speculative combinations. Re-decomposition of the tool boundaries
  themselves (merging/renaming tools) is explicitly deferred until real usage shows the
  current boundaries hurt.

## Audit of the current tool surface

| Tool | Body layer | Properties layer | Gap? |
|---|---|---|---|
| `create_object` | ✓ `body` (→ `/blocks/append`) | ✓ `properties`/`labels`/`relations`, resolved | — |
| `update_object` | ✓ `body` | ✓ (same machinery) + GET-before-PATCH | — |
| `add_to_daily_note` / `append_to_object` | ✓ | n/a — body tools by design | — |
| `get_object` / `delete_object` / `search_content` / `list_spaces` / `get_space_info` | n/a — read/delete | n/a | — |
| **`save_weblink`** | ✓ `notes` (→ markdown) | ✗ **only `title`/`description`** | **← the one gap** |

`create_object`/`update_object` already complete both layers (setting a meeting's attendees
by name is already one `create_object` call). The **only** tool that cannot set its typed
properties in one call is `save_weblink`, because `POST /object/url` structurally accepts only
`title`/`description` overrides (`CreateObjectFromUrlProperties` in the v2 spec).

## Deliverable 1 — `save_weblink` completes its properties

Give `save_weblink` the **same property interface as `create_object`** (mirror, not friendly
per-field params — for uniformity and to reuse the shared machinery):

Add optional inputs, keyed by property-definition id (from `get_space_info` on the Weblink /
`MediaWebResource` structure):
- `properties?: Record<string, string|number|boolean>` — scalar props (e.g. `media_iframeReference`)
- `labels?: Record<string, string|string[]>` — label props by option NAME (Category/Topic)
- `relations?: Record<string, string|string[]>` — entity props by NAME, resolved strictly (tags)
- `create_missing_relations?: boolean`

Keep the existing `title`/`description`/`notes` params (they ride the `/object/url` call as
today — the auto-fetch overrides). `title`/`description` are set **only** via these dedicated
params; they must not also appear in the `properties` map (the maps are for the object's *other*
typed fields — `buildWrappers` already rejects a `title`-typed key, so this is enforced, not just
convention).

**Flow (reusing `buildWrappers` / `finalizeRelationPlans` / `updateObject` from `object.ts`):**
1. Resolve `MediaWebResource` structure via `get_space_info`; run `buildWrappers` over
   `properties`/`labels`/`relations` (read-only). Any problem → **error, no writes.**
2. `POST /object/url { url, markdown?: notes, properties?: {title, description} }` → weblink id.
3. `finalizeRelationPlans` — materialize any missing relation targets (tags).
4. If any wrappers were built → `PATCH /object { id, properties: <wrappers> }`.
5. Return a summary (id, title, the properties set, created relation targets, any partial-write note).

**Failure semantics:** resolution problems fail before step 2 (no weblink created). If step 4
(PATCH) fails after the weblink exists, report `"weblink saved (id …), properties not applied: <reason>"`
— fail-open, consistent with `create_object`'s residual final-write partial.

This makes `save_weblink` = "create a URL object (with page auto-fetch) **and** complete its
properties," one tool call — e.g. save a link tagged `#Research` with Category `Article`.

## Deliverable 2 — Markdown-convention documentation

The body layer does real structural work, so LLM consumers must know the conventions —
**especially which ones create objects as a side effect.** Live-verified 2026-07-10:

| Convention | Effect | Side effect |
|---|---|---|
| `() Some text` | Creates a **Task** (RootTask) and embeds it as a linked block | **Creates a Task object** |
| `#tag` | Creates/links a **Tag** entity | **Creates a Tag object if new** |
| `[[Name]]` | Links an **existing** object by title | **None** — renders as plain text if the target doesn't exist (does NOT create) |

**Where it gets documented:**
- **Tool descriptions** — a shared, concise "body markdown" note on the tools that accept a
  markdown body (`create_object`, `update_object`, `append_to_object`, `add_to_daily_note`,
  and `save_weblink`'s `notes`). Names the three conventions and flags the create-side-effects.
  This is what the LLM actually reads at call time.
- **README** — a dedicated section (see below) for a human integrator, plus the property-vs-body
  mental model and the composition boundary.

### README framing (for a user)

The README section explains the model an integrator/LLM should hold:
- **Two ways to put content on an object:** *properties* (typed fields — set by name, resolved
  strictly: relations/tags/labels/scalars/dates) and *body* (markdown prose + the inline
  conventions above).
- **Set typed things as properties, not prose.** Tags and relations are properties, not
  `[[links]]` in text — use the `relations`/`labels` inputs so they become real structured
  fields (this is exactly why `save_weblink` now takes them).
- **The body can create objects** via `() ` and `#` — powerful, and side-effecting; call it out.
- **Composition boundary:** one tool call completes one object (all its properties + body).
  Several *distinct standalone* objects = several calls (e.g. "import 5 contacts").

## Actor Capabilities

**LLM consumer (Janet / any client) can:**
- Create or update any object with **all** its typed properties in one call — scalars, dates,
  labels by option name, and entity relations/tags by name (strictly resolved, optional create).
- Save a weblink **and** set its tags / Category / Topic in a single `save_weblink` call.
- Express body structure via markdown, knowing `() ` creates a linked Task, `#` creates/links a
  Tag, and `[[Name]]` links an existing object only.
- Compose several standalone objects via sequential calls when they are genuinely distinct.

**Human README reader can:** understand the property-vs-body model, the markdown conventions and
their side effects, and when multiple calls are needed.

**`save_weblink` (tool) can:** create a URL object with auto-fetched metadata, override
title/description, resolve names→ids, and set arbitrary typed properties via a follow-up PATCH —
all in one invocation, failing before any write on resolution problems.

## Components & data flow

- **`src/tools/weblink.ts`** — extend the tool schema + handler; call `getSpaceInfo`, `buildWrappers`,
  `finalizeRelationPlans` (imported from `object.ts` — already exported), then `saveWeblink`
  (client) and, when wrappers exist, `updateObject` (client). No new client methods
  (`updateObject`/`getSpaceInfo` exist).
- **`src/tools/object.ts`** — the shared `MARKDOWN body` description note becomes an exported
  string constant reused across tool descriptions (single source of truth).
- **`README.md`** — new "Object model: properties vs. body" + "Markdown conventions" sections.
- No changes to the client transport, rate limiter, or resolution helper.

## Error handling

- Resolution problems (unknown/read-only property, unresolved/ambiguous relation, unknown label
  option) → single `isError` with the accumulated list, **before any write.**
- `POST /object/url` failure → `isError`, surfaced body; no PATCH attempted.
- `PATCH` failure after the weblink is created → `isError` **including the created weblink id**
  and the reason (partial-write, fail-open).
- All `CapacitiesAPIError` bodies surfaced (LLM self-correction).

## Testing strategy

Mocked-`fetch` unit tests in `test/` (extend `test/capacities.test.ts` / a weblink test file):
- `save_weblink` url-only → single `POST /object/url {url}`, no PATCH.
- +title/description → `/object/url` carries `properties.{title,description}`, no PATCH.
- +tags/labels → resolution search(es) → `/object/url` → `PATCH /object` with the resolved
  entity/label wrappers; assert exact wrapper shapes.
- unresolved tag, `create_missing_relations:false` → `isError`, **no `/object/url` and no PATCH.**
- `create_missing_relations:true` → missing tag created (`POST /object` for the Tag) then linked.
- PATCH fails after `/object/url` succeeds → `isError` names the created weblink id (partial).

Docs (tool descriptions, README) reviewed manually. Gates: `tsc` + `npm test`, no new deps.

## Assumptions

| # | Assumption | Risk if wrong | Validation |
|---|---|---|---|
| A1 (VERIFIED) | `() ` creates+links a Task; `#tag` creates+links a Tag; `[[Name]]` links existing only (no create) | docs mislead the LLM | Live-verified 2026-07-10 (probe_md create/append/read/cleanup) |
| A2 (VERIFIED) | `/object/url` accepts only `title`/`description` overrides (no tags/labels) | wrong flow | v2 spec `CreateObjectFromUrlProperties` |
| A3 | `PATCH /object` sets tags/labels on a `MediaWebResource` created via `/object/url`, like any object | save_weblink property-completion fails | Throwaway: `/object/url` → PATCH tags+Category → readback (do FIRST in implementation) |
| A4 (VERIFIED) | Weblink label options (Category/Topic) come from the prop def's `labelSet` | can't set labels by name | Verified live 2026-07-10 (labelSet populated) |
| A5 | The residual "PATCH fails after create" partial is acceptable (fail-open, reported) | rare stranded weblink w/o props | Design decision — matches `create_object`'s final-write partial |

## Non-goals

- Merging/renaming tools (Option 3 — deferred to post-usage).
- Friendly per-field weblink params (`tags`/`category`) — mirroring `create_object`'s maps instead.
- Setting properties via body prose (properties are structured; body is prose — the whole point).
- Reconsidering `create_structured_note` (`create.ts`) — tracked separately.
