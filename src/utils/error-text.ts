// File: src/utils/error-text.ts
//
// Shapes server-controlled error text before it lands in a tool's output (cap-dnf).
// Every tool echoes CapacitiesAPIError.message, and a Cloudflare rejection is a
// multi-KB HTML page. A JSON body is the exception: a 400's JSON is the LLM's only
// path to self-correct, so it is kept (capped) rather than cut to one line.

const JSON_BODY_MAX = 2000;
const LINE_BODY_MAX = 200;

// personal-assistant's pacer takes the FIRST match of this phrase in find_objects
// output as the stage-2 counts, so server text echoed there could forge them.
const COUNT_PHRASE = /checked\s+(\d+)\s+of\s+(\d+)\s+candidates/gi;

export function neutraliseCountPhrase(text: string): string {
  return text.replace(COUNT_PHRASE, "checked $1/$2 candidates");
}

// Cap by code points, not UTF-16 units, so an emoji at the cut is never split
// into a lone surrogate.
function capCodePoints(text: string, max: number): string {
  const points = Array.from(text);
  return points.length > max ? points.slice(0, max).join("") + "…" : text;
}

// The first non-blank line, trimmed, neutralised and capped; "" when there is none.
// Splits on every line-ending style — a CR-only body is otherwise one long line.
export function firstLineBrief(text: string | undefined, max: number): string {
  const line = (text ?? "").split(/\r\n|\r|\n/).map(l => l.trim()).find(l => l !== "") ?? "";
  return capCodePoints(neutraliseCountPhrase(line), max);
}

function isJsonDocument(text: string): boolean {
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
