// File: src/utils/entity-blocks.ts
//
// Locates the EntityBlocks that embed a given object (cap-9cg). A task's Context
// in Capacities is DERIVED: it is the set of objects that embed the task as an
// EntityBlock, so linking/unlinking Context means adding/removing that embed.
//
// GET /object returns `blocks` as an OBJECT keyed by block-field property id,
// each value an array of ApiBlock; TextBlock/GroupBlock/GridBlock carry nested
// `blocks` arrays, so an EntityBlock may sit at any depth
// (https://developers.capacities.io/openapi.json, ApiBlock / ApiEntityBlock).

export interface EntityBlockRef {
  blockId: string;
  fieldId: string;
}

// Every EntityBlock whose entityId === `entityId`, across EVERY block field and
// at any nesting depth, in document order. Tolerates a missing or malformed
// `blocks` (e.g. the {success:true} empty-body shape) by returning []. A match
// without a string id is skipped: it could not be deleted by id anyway.
export function findEntityBlocks(obj: unknown, entityId: string): EntityBlockRef[] {
  if (obj === null || typeof obj !== "object") return [];
  const fields = (obj as { blocks?: unknown }).blocks;
  if (fields === null || typeof fields !== "object" || Array.isArray(fields)) return [];

  const found: EntityBlockRef[] = [];
  for (const [fieldId, blocks] of Object.entries(fields as Record<string, unknown>)) {
    walk(blocks, fieldId, entityId, found);
  }
  return found;
}

function walk(blocks: unknown, fieldId: string, entityId: string, found: EntityBlockRef[]): void {
  if (!Array.isArray(blocks)) return;
  for (const block of blocks) {
    if (block === null || typeof block !== "object") continue;
    const b = block as { id?: unknown; type?: unknown; entityId?: unknown; blocks?: unknown };
    if (b.type === "EntityBlock" && b.entityId === entityId && typeof b.id === "string") {
      found.push({ blockId: b.id, fieldId });
    }
    walk(b.blocks, fieldId, entityId, found);
  }
}
