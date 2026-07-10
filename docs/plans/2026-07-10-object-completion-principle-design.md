# Object Completion Principle + markdown-convention docs

**Date:** 2026-07-10 (rev. 2 — A3 disproved: media objects are create-only)
**Branch:** `feat/capacities-v2-migration`
**Epic:** cap-6dy (follow-on to `2026-07-10-capacities-v2-migration-design.md`)
**Status:** Design — revised after live verification.

## Purpose

A design principle emerged while finishing the v2 tool surface: **which multi-step API
sequences a tool should absorb, versus leave to LLM composition.** This doc records the
principle and — after a live-verification pass invalidated the one code change it implied —
scopes the work to **documentation**: making the object model and the API's hard limits
legible to an LLM consumer (Janet) and a human README reader.

> **rev. 2 note.** rev. 1 proposed giving `save_weblink` full property support via an internal
> save→PATCH. Live verification (assumption A3) disproved its premise: **media objects cannot
> be updated by any API endpoint.** That deliverable is dropped; see "The media-object
> constraint" below. The principle itself is unchanged and correctly describes the non-media
> write tools.

## The principle: "Complete the object; compose across objects"

A write tool should **absorb** a multi-step API sequence when every step is *about the same
object* and all inputs are known at call time. It should **leave the sequence to LLM
composition** when the steps span *distinct standalone objects*.

"Completing an object" has two layers:

1. **Body** — freeform content, written as **markdown**, including Capacities' inline
   conventions (below). A single markdown write; Capacities expands it server-side. LLM
   *formatting* — the tool accepts markdown; we document the conventions.
2. **Properties** — the object's **typed fields**: scalars, dates, **labels**, and **entity
   relations** (tags, attendees). Not prose — structured fields requiring typed-wrapper
   writes + name→id **resolution**. A tool should let you set all of a *writable* object's
   properties in one call, even when the API splits them across endpoints.

**Two tests — both must hold to internalize:** one primary object; no new decision mid-sequence.
**Riders:** fail-before-write (resolve/validate before any write); YAGNI gate (don't pre-build
speculative combos; tool re-decomposition deferred to post-usage).

## The media-object constraint (the finding that reshaped this doc)

**Media structures are create-only via the v2 API.** `PATCH /object` **and** `PATCH
/object/markdown` both reject a `MediaWebResource` (weblink) with
`400 cap_invalid_input: "This object type cannot be updated via this endpoint."` Regular /
custom objects (Task, meeting, person, project, …) update normally — verified live: a `RootTask`
PATCH set both a `date` and a `Status` label and read back correctly. So this is a
media-specific API limitation, not a broken endpoint.

Media structures observed in the space: `MediaWebResource` (Weblink), `MediaPDF`, `MediaImage`,
`MediaAudio`, `MediaFile`.

**Consequences for weblinks:**
- A weblink's **only** settable surface is what `POST /object/url` accepts at creation:
  `title` and `description` (the `CreateObjectFromUrlProperties` shape). That's it.
- **Tags, Category, Topic, Iframe URL cannot be set on a weblink via the API — ever** (not at
  create, not by any update). This is a hard API gap, analogous to the event-linking gap in the
  migration design.
- **A weblink can still be tagged — via the body, not properties.** A `#tag` in the `notes`
  markdown creates+links a Tag (verified). This is the *only* API path to associate a tag with
  a weblink, and it works today with **no code change**. Category/Topic (labels) have no
  equivalent markdown convention and remain unsettable.

## Audit of the current tool surface (revised)

| Tool | Body | Properties | Status |
|---|---|---|---|
| `create_object` | ✓ | ✓ resolved | complete (non-media) |
| `update_object` | ✓ | ✓ (+GET-before) | complete (non-media) |
| `add_to_daily_note` / `append_to_object` | ✓ | n/a (body tools) | complete |
| `save_weblink` | ✓ `notes`→md | **title/description only** | **as complete as the API allows** — the rest is an API limit, not a fixable gap |

No code change closes the `save_weblink` "gap"; there is no API path. The correct response is to
**document** the limit and the `#tag`-in-notes workaround, and to correct the tool's description.

## Verified body-markdown conventions (live 2026-07-10)

| Convention | Effect | Side effect |
|---|---|---|
| `() Some text` | Creates a **Task** (RootTask) and embeds it as a linked block | **Creates a Task object** |
| `#tag` | Creates/links a **Tag** entity (the weblink-tagging path) | **Creates a Tag object if new** |
| `[[Name]]` | Links an **existing** object by title | **None** — plain text if the target doesn't exist; does NOT create |

## Deliverables (documentation only)

### D1 — Correct `save_weblink`'s tool description
The shipped description (from cap-6dy.14) says "to tag a weblink, use `update_object` afterward"
— **which does not work** (media objects aren't updatable). Fix it to state: `title`/`description`
override the auto-fetched page metadata; to tag/annotate, put `#tag` (and `() ` tasks, `[[links]]`)
in `notes`; Category/Topic and other typed properties are not settable via the API yet.

### D2 — Markdown-convention note across body-accepting tools
A shared, concise "body markdown" note (an exported string constant, single source of truth)
appended to the descriptions of the tools that take a markdown body — `create_object`,
`update_object`, `append_to_object`, `add_to_daily_note`, and `save_weblink` (`notes`). Names the
three conventions and flags the create-side-effects of `() ` and `#`.

### D3 — README: object model + conventions + the media limit
A README section covering:
- **Properties vs. body** — set typed things (relations/tags/labels/scalars/dates) as
  *properties* by name (resolved strictly); use *body* markdown for prose + inline conventions.
- **Markdown conventions** — the table above, with the side-effect callout.
- **The media-object limitation, explicitly** — weblinks/PDFs/images are **create-only**; a
  weblink accepts only `title`/`description` at save time and cannot be updated afterward; tag via
  `#tag` in notes. **State plainly that this is an upstream Capacities API limitation and that the
  MCP will gain full weblink property support as soon as the API allows media objects to be
  updated** (track upstream; revisit `save_weblink` property completion then — rev. 1 of this doc
  is the design to resume).

## Actor Capabilities

**LLM consumer (Janet / any client) can:**
- Create or update any **non-media** object with all its typed properties in one call — scalars,
  dates, labels by name, relations/tags by name (strictly resolved, optional create).
- **Tag a weblink via `#tag` in `notes`**; add tasks/links in a weblink's notes via `() ` / `[[ ]]`.
- Compose several standalone objects via sequential calls when genuinely distinct.

**LLM consumer CANNOT (documented API gap):** set a weblink's (or any media object's) `tags`,
`Category`, `Topic`, or other structured properties after creation, or override anything beyond
`title`/`description` at creation.

**Human README reader can:** understand the property-vs-body model, the markdown conventions and
side effects, and the media create-only limitation — including that it will be revisited when the
API supports updating media objects.

## Components

- **`src/tools/weblink.ts`** — description text fix (D1). No schema/handler logic change.
- **`src/tools/object.ts`** (or a small `src/tools/descriptions.ts`) — the shared markdown-
  conventions note as an exported constant, reused in the body-accepting tools' descriptions (D2).
- **`README.md`** — the new sections (D3).
- No changes to the client, rate limiter, resolution helper, or any tool's behavior.

## Error handling & testing

No behavior changes — this is documentation + a description string. Gate: `tsc` + `npm test`
stay green (54/54; description strings aren't asserted). Tool descriptions and README reviewed
manually for accuracy against the verified findings.

## Assumptions

| # | Assumption | Status | Evidence |
|---|---|---|---|
| A1 | `() ` creates+links a Task; `#tag` creates+links a Tag; `[[Name]]` links existing only | **VERIFIED** | Live probe 2026-07-10 (create/append/read/cleanup) |
| A2 | `/object/url` accepts only `title`/`description` overrides | **VERIFIED** | v2 spec `CreateObjectFromUrlProperties` |
| A3 | ~~`PATCH /object` sets tags/labels on a weblink~~ | **DISPROVED** | Live 2026-07-10: `PATCH /object` **and** `/object/markdown` → 400 "cannot be updated via this endpoint" for `MediaWebResource` |
| A4 | Label options come from the prop def's `labelSet` | **VERIFIED** | Live 2026-07-10 (populated) |
| A5 | `PATCH /object` updates **regular** objects | **VERIFIED** | Live 2026-07-10: `RootTask` date + Status label set + read back |
| A6 | `#tag` in a weblink's `notes` makes the weblink discoverable under that tag | **PARTIAL** | `#tag` verified to create+link a Tag in body content; exact "weblink surfaces under tag" not separately confirmed — validate while writing the README example, or state as content-level tagging |

## Non-goals

- `save_weblink` property completion (API-blocked; resume rev. 1's design when the API supports
  media updates).
- Merging/renaming tools (Option 3 — deferred to post-usage).
- Any attempt to work around the media limit (no API path exists).
