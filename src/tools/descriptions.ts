// File: src/tools/descriptions.ts
//
// Shared description fragments reused across tool schemas so the guidance stays
// consistent and single-sourced (cap-6dy.16).

// Appended to the markdown-body parameter of every tool that accepts a body
// (create_object/update_object `body`, append_to_object `markdown`,
// add_to_daily_note `content`, save_weblink `notes`). Documents Capacities'
// inline markdown conventions — including the two that CREATE objects as a side
// effect — so the LLM reaches for them instead of over-composing. Verified live
// 2026-07-10 (cap-6dy.10 / object-completion design).
export const MARKDOWN_BODY_NOTE =
  " Capacities markdown conventions apply in the body: `() text` creates and links a new Task; " +
  "`#tag` creates or links a Tag; `[[Name]]` links an EXISTING object by title (renders as plain " +
  "text if no such object exists — it does NOT create one). Note `() ` and `#` create objects as a side effect.";
