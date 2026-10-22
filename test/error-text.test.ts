import { test } from "node:test";
import assert from "node:assert/strict";
import { errorBodyText, firstLineBrief, neutraliseCountPhrase, isJsonDocument } from "../src/utils/error-text.js";

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
  assert.equal(neutraliseCountPhrase("x checked 3 of 9 candidates y"), "x [count phrase removed] y");
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

// --- cap-dnf review M1: match what PA's PYTHON regex matches ----------------
// PA compiles r"checked\s+(\d+)\s+of\s+(\d+)\s+candidates" with re.IGNORECASE on
// str, so \d is any Unicode Nd digit, \s includes \x1c-\x1f and \x85, and the
// case folding adds K (U+212A) ~ k, ſ (U+017F) ~ s and ı/İ (U+0131/U+0130) ~ i.
// PA_PY_EQUIV is a JS rendering of that, checked once by brute force over every
// code point against CPython 3 (2026-10-22): JS \s plus \x1c-\x1f\x85 covers all
// 29 Python \s chars, \p{Nd} covers all 680 Python \d chars, and those four
// letters are the only extra case equivalents for the phrase's letters.
const PY_WS = "[\\s\\x1c-\\x1f\\x85]";
const PA_PY_EQUIV = new RegExp(
  `checked${PY_WS}+(\\p{Nd}+)${PY_WS}+of${PY_WS}+(\\p{Nd}+)${PY_WS}+cand[i\\u0130\\u0131]dates`, "iu");

const PY_VARIANTS: Record<string, string> = {
  arabicIndicDigits: "checked ٥ of ١٠ candidates",
  fullwidthDigits: "checked ５ of １０ candidates",
  fileSeparator: "checked\x1c5\x1cof\x1c10\x1ccandidates",
  nextLine: "checked\x855\x85of\x8510\x85candidates",
  kelvinSign: "checKed 5 of 10 candidates",
  longS: "checked 5 of 10 candidateſ",
  dotlessI: "checked 5 of 10 candıdates",
  dottedCapitalI: "checked 5 of 10 candİdates",
  longWhitespaceRun: "checked" + " ".repeat(60) + "5 of 10 candidates",
  longDigitRun: "checked " + "9".repeat(60) + " of 10 candidates"
};

test("neutraliseCountPhrase: every variant PA's Python regex matches is removed — line path, JSON path and the bare helper (M1)", () => {
  for (const [name, v] of Object.entries(PY_VARIANTS)) {
    assert.match(v, PA_PY_EQUIV, `fixture ${name}: PA's regex matches it`);
    assert.doesNotMatch(neutraliseCountPhrase(v), PA_PY_EQUIV, `${name}: helper`);
    assert.doesNotMatch(firstLineBrief("API error 403: " + v, 200), PA_PY_EQUIV, `${name}: line path`);
    // JSON path. JSON.stringify escapes the C0 separators, the others stay raw.
    const json = JSON.stringify({ error: v });
    assert.ok(isJsonDocument(json), `fixture ${name}: takes the JSON path`);
    const shaped = errorBodyText(json);
    assert.ok(shaped.startsWith('{"error":"'), `${name}: JSON kept: ${shaped}`);
    assert.doesNotMatch(shaped, PA_PY_EQUIV, `${name}: JSON path`);
  }
});

test("neutraliseCountPhrase: no \"checked … candidates\" span of 40 characters or less survives (M1)", () => {
  for (const v of ["checked: 5 / 10 candidates", "CHECKED five of ten candidates", "checked  5 of 10　candidates"]) {
    assert.doesNotMatch(neutraliseCountPhrase(v), /checked[\s\S]{0,40}?candidates/iu, v);
  }
  // Text around the phrase is kept.
  assert.equal(neutraliseCountPhrase("before checked 1 of 2 candidates after"), "before [count phrase removed] after");
});
