// File: src/utils/error-text.ts
//
// Shapes server-controlled error text before it lands in a tool's output (cap-dnf).
// Every tool echoes CapacitiesAPIError.message, and a Cloudflare rejection is a
// multi-KB HTML page. A JSON body is the exception: a 400's JSON is the LLM's only
// path to self-correct, so it is kept (capped) rather than cut to one line.

const JSON_BODY_MAX = 2000;
const LINE_BODY_MAX = 200;

// personal-assistant's pacer takes the FIRST match of
// r"checked\s+(\d+)\s+of\s+(\d+)\s+candidates" (Python, re.IGNORECASE) in
// find_objects output as the stage-2 counts, so server text echoed there could
// forge them. Python's \d and \s are Unicode-wide and its case folding is wider
// than JS's, so match what PYTHON matches (cap-dnf review M1):
//  - \s also covers \x1c-\x1f and \x85; \p{Nd} covers every Unicode digit;
//  - K (U+212A) and ſ (U+017F) fold under /iu, and NFKC maps them too, but
//    ı/İ (U+0131/U+0130) match i only in Python, so they are spelled out.
// Brute-forced over every code point against CPython 2026-10-22; the table and
// the variant fixtures are in test/error-text.test.ts. The unbounded pass catches
// arbitrarily long whitespace or digit runs; the bounded span pass then removes
// any other short "checked … candidates" text outright.
const PY_WS = "[\\s\\x1c-\\x1f\\x85]";
const PA_COUNT_PHRASE = new RegExp(
  `checked${PY_WS}+\\p{Nd}+${PY_WS}+of${PY_WS}+\\p{Nd}+${PY_WS}+cand[i\\u0130\\u0131]dates`, "giu");
const COUNT_SPAN = /checked[\s\S]{0,40}?cand[i\u0130\u0131]dates/giu;
const COUNT_PHRASE_REMOVED = "[count phrase removed]";

export function neutraliseCountPhrase(text: string): string {
  return text.normalize("NFKC")
    .replace(PA_COUNT_PHRASE, COUNT_PHRASE_REMOVED)
    .replace(COUNT_SPAN, COUNT_PHRASE_REMOVED);
}

// Cap by code points, not UTF-16 units, so an emoji at the cut is never split
// into a lone surrogate.
function capCodePoints(text: string, max: number): string {
  const points = Array.from(text);
  return points.length > max ? points.slice(0, max).join("") + "…" : text;
}

// The prefixes CapacitiesClient puts before a shaped body in an error message.
const ERROR_MESSAGE_PREFIX = /^(API error \d+|Rate limit exceeded): /;

// A pretty-printed JSON body after an error prefix would brief to its first line,
// a lone "{" (cap-0ot). Compact it to one line first; anything else is unchanged.
function compactPrefixedJson(text: string): string {
  const prefix = ERROR_MESSAGE_PREFIX.exec(text)?.[0];
  if (prefix === undefined) return text;
  const rest = text.slice(prefix.length);
  return isJsonDocument(rest) ? prefix + JSON.stringify(JSON.parse(rest)) : text;
}

// The first non-blank line, trimmed, neutralised and capped; "" when there is none.
// Splits on every line-ending style — a CR-only body is otherwise one long line.
export function firstLineBrief(text: string | undefined, max: number): string {
  const line = compactPrefixedJson(text ?? "").split(/\r\n|\r|\n/).map(l => l.trim()).find(l => l !== "") ?? "";
  return capCodePoints(neutraliseCountPhrase(line), max);
}

export function isJsonDocument(text: string): boolean {
  try {
    const parsed = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null;
  } catch {
    return false;
  }
}

// The body text for an error MESSAGE: whole (capped) JSON, otherwise one line.
// "" means there is nothing worth appending.
export function errorBodyText(body: string): string {
  if (isJsonDocument(body)) return capCodePoints(neutraliseCountPhrase(body), JSON_BODY_MAX);
  return firstLineBrief(body, LINE_BODY_MAX);
}
