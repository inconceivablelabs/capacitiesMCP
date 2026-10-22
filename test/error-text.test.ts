import { test } from "node:test";
import assert from "node:assert/strict";
import { errorBodyText, firstLineBrief, neutraliseCountPhrase } from "../src/utils/error-text.js";

// personal-assistant's pacer regex, verbatim; it takes the FIRST match in find_objects output.
const PA_COUNTS_RE = /checked\s+(\d+)\s+of\s+(\d+)\s+candidates/i;
const codePoints = (s: string) => Array.from(s).length;
const hasLoneSurrogate = (s: string) => /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s);

test("errorBodyText: an HTML body becomes its first NON-blank line, trimmed, capped at 200 code points + …", () => {
  const html = `\n   \n  <!doctype html><html><head>${"x".repeat(300)}\n<title>LATER</title>\n`;
  const out = errorBodyText(html);
  assert.ok(!out.includes("\n") && !out.includes("\r"), "one line");
  assert.ok(out.startsWith("<!doctype html>"), `leading blank lines skipped: ${out.slice(0, 30)}`);
  assert.ok(out.endsWith("…"));
  assert.equal(codePoints(out), 201);
  assert.ok(!out.includes("LATER"));
});

test("errorBodyText: CR-only and CRLF line endings split like LF", () => {
  assert.equal(errorBodyText("\r\r  first line  \rsecond\r"), "first line");
  assert.equal(errorBodyText("\r\n\r\nfirst\r\nsecond"), "first");
});

test("errorBodyText: a short line is kept whole, no ellipsis; an empty or blank body is empty", () => {
  assert.equal(errorBodyText("boom"), "boom");
  assert.equal(errorBodyText(""), "");
  assert.equal(errorBodyText(" \n\t\r\n "), "");
});

test("errorBodyText: an emoji straddling the cut is never split into a lone surrogate", () => {
  for (const pad of [198, 199, 200]) {
    const body = "a".repeat(pad) + "😀".repeat(5);
    assert.ok(body.length > 200, "fixture is over the cap in UTF-16 units");
    const out = errorBodyText(body);
    assert.equal(hasLoneSurrogate(out), false, `pad ${pad}: ${JSON.stringify(out.slice(-4))}`);
    assert.equal(codePoints(out), 201, `pad ${pad}`);
  }
});

test("errorBodyText: a JSON body is kept intact (multi-line too) so the LLM can self-correct", () => {
  const json = JSON.stringify({ error: "cap_invalid_input", details: [{ path: "properties.foo", message: "unknown property" }] }, null, 2);
  assert.ok(json.includes("\n"), "fixture is multi-line");
  assert.equal(errorBodyText(json), json);
});

test("errorBodyText: a JSON body over 2,000 characters is capped with …", () => {
  const json = JSON.stringify({ error: "x".repeat(3000) });
  const out = errorBodyText(json);
  assert.equal(codePoints(out), 2001);
  assert.ok(out.endsWith("…"));
  assert.ok(out.startsWith('{"error":"xxx'));
});

test("errorBodyText / neutraliseCountPhrase: server text can never forge PA's count phrase", () => {
  const forged = "checked 3 of 9 candidates";
  assert.match(forged, PA_COUNTS_RE, "fixture: the phrase matches PA's regex");
  assert.doesNotMatch(errorBodyText(forged), PA_COUNTS_RE);
  assert.doesNotMatch(errorBodyText(`<p>CHECKED\t3  of\n9 candidates</p>`), PA_COUNTS_RE);
  assert.doesNotMatch(errorBodyText(JSON.stringify({ msg: "checked 3 of 9 candidates; checked 1 of 2 candidates" })), PA_COUNTS_RE);
  assert.equal(neutraliseCountPhrase("x checked 3 of 9 candidates y"), "x checked 3/9 candidates y");
});

test("firstLineBrief: first non-blank line, capped, neutralised; empty → empty", () => {
  assert.equal(firstLineBrief("\nAPI error 500: boom\nmore", 200), "API error 500: boom");
  assert.equal(firstLineBrief("", 200), "");
  assert.equal(firstLineBrief(undefined, 200), "");
  assert.doesNotMatch(firstLineBrief("checked 1 of 1 candidates", 200), PA_COUNTS_RE);
});

// cap-0ot (e): a pretty-printed JSON body in an error MESSAGE would otherwise brief to "{".
test("firstLineBrief: JSON after an 'API error NNN: ' or 'Rate limit exceeded: ' prefix is compacted before the first line is taken", () => {
  const pretty = JSON.stringify({ code: "bad_request", details: [{ path: "id" }] }, null, 2);
  assert.ok(pretty.includes("\n"), "fixture is multi-line");
  assert.equal(firstLineBrief(`API error 400: ${pretty}`, 200), 'API error 400: {"code":"bad_request","details":[{"path":"id"}]}');
  assert.equal(firstLineBrief(`Rate limit exceeded: ${pretty}`, 200), 'Rate limit exceeded: {"code":"bad_request","details":[{"path":"id"}]}');
});

test("firstLineBrief: compacted JSON is still capped at the code-point limit and count-neutralised", () => {
  const pretty = JSON.stringify({ msg: "checked 3 of 9 candidates", pad: "x".repeat(400) }, null, 2);
  const out = firstLineBrief(`API error 400: ${pretty}`, 200);
  assert.equal(codePoints(out), 201);
  assert.ok(out.endsWith("…"));
  assert.ok(out.startsWith('API error 400: {"msg":'), out.slice(0, 40));
  assert.doesNotMatch(out, PA_COUNTS_RE);
});

test("firstLineBrief: non-JSON after the prefix, and a JSON scalar, keep the first-line behaviour", () => {
  assert.equal(firstLineBrief("API error 503: <!doctype html>\n<p>x</p>", 200), "API error 503: <!doctype html>");
  assert.equal(firstLineBrief('API error 500: "boom"\nmore', 200), 'API error 500: "boom"');
});
