import { test } from "node:test";
import assert from "node:assert/strict";
import { findEntityBlocks } from "../src/utils/entity-blocks.js";

// Synthetic ids only (public repo).
const TASK = "task-aaaa";

test("findEntityBlocks: top-level EntityBlock in one field", () => {
  const obj = {
    blocks: {
      fieldA: [
        { id: "b1", type: "TextBlock", tokens: [] },
        { id: "b2", type: "EntityBlock", entityId: TASK },
        { id: "b3", type: "EntityBlock", entityId: "other" }
      ]
    }
  };
  assert.deepEqual(findEntityBlocks(obj, TASK), [{ blockId: "b2", fieldId: "fieldA" }]);
});

test("findEntityBlocks: nested at depth 2 inside a TextBlock's blocks", () => {
  const obj = {
    blocks: {
      fieldA: [
        {
          id: "t1",
          type: "TextBlock",
          blocks: [{ id: "t2", type: "TextBlock", blocks: [{ id: "deep", type: "EntityBlock", entityId: TASK }] }]
        }
      ]
    }
  };
  assert.deepEqual(findEntityBlocks(obj, TASK), [{ blockId: "deep", fieldId: "fieldA" }]);
});

test("findEntityBlocks: embed in a SECOND block field is found", () => {
  const obj = {
    blocks: {
      first: [{ id: "x", type: "EntityBlock", entityId: "other" }],
      second: [{ id: "y", type: "EntityBlock", entityId: TASK }]
    }
  };
  assert.deepEqual(findEntityBlocks(obj, TASK), [{ blockId: "y", fieldId: "second" }]);
});

test("findEntityBlocks: duplicates all returned, in document order", () => {
  const obj = {
    blocks: {
      f: [
        { id: "d1", type: "EntityBlock", entityId: TASK },
        { id: "g", type: "GroupBlock", blocks: [{ id: "d2", type: "EntityBlock", entityId: TASK }] }
      ]
    }
  };
  assert.deepEqual(findEntityBlocks(obj, TASK), [
    { blockId: "d1", fieldId: "f" },
    { blockId: "d2", fieldId: "f" }
  ]);
});

test("findEntityBlocks: tolerates missing / malformed blocks and null entityId", () => {
  assert.deepEqual(findEntityBlocks(undefined, TASK), []);
  assert.deepEqual(findEntityBlocks({ success: true }, TASK), []);
  assert.deepEqual(findEntityBlocks({ blocks: null }, TASK), []);
  assert.deepEqual(findEntityBlocks({ blocks: [] }, TASK), []);
  assert.deepEqual(findEntityBlocks({ blocks: { f: "nope", g: [null, 3, { blocks: "x" }] } }, TASK), []);
  assert.deepEqual(
    findEntityBlocks({ blocks: { f: [{ id: "n", type: "EntityBlock", entityId: null }] } }, TASK),
    []
  );
  // An EntityBlock without a string id cannot be deleted, so it is not reported.
  assert.deepEqual(findEntityBlocks({ blocks: { f: [{ type: "EntityBlock", entityId: TASK }] } }, TASK), []);
});

test("findEntityBlocks: a non-EntityBlock carrying entityId is not a match", () => {
  const obj = { blocks: { f: [{ id: "z", type: "TextBlock", entityId: TASK }] } };
  assert.deepEqual(findEntityBlocks(obj, TASK), []);
});
