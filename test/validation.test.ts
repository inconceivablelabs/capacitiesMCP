import { test } from "node:test";
import assert from "node:assert/strict";
import { isSpecUuid } from "../src/utils/validation.js";

// /objects/tag ids and every cursor must match the spec's UUID pattern
// (developers.capacities.io/openapi.json). A non-UUID gets a 400; a well-formed
// bogus id gets 200 {"results":[]} — so the tag id is checked before any call.
// Synthetic values only (this repo is public).
test("isSpecUuid accepts the spec pattern (versions 1-8, nil, max) and rejects everything else", () => {
  for (const ok of [
    "00000000-0000-4000-8000-000000000001",
    "0190f2a4-7b1c-7def-8abc-0123456789ab",   // version 7 — validateUUID would reject it
    "00000000-0000-0000-0000-000000000000",
    "ffffffff-ffff-ffff-ffff-ffffffffffff",
    "ABCDEF01-2345-4678-9ABC-DEF012345678"
  ]) assert.equal(isSpecUuid(ok), true, ok);
  for (const bad of [
    "tag-product", "RootTag", "",
    "00000000-0000-9000-8000-000000000001",   // version 9
    "00000000-0000-4000-c000-000000000001",   // variant c
    " 00000000-0000-4000-8000-000000000001",
    "{00000000-0000-4000-8000-000000000001}"
  ]) assert.equal(isSpecUuid(bad), false, JSON.stringify(bad));
});
