// File: src/tools/resolution.ts
//
// Entity resolution helper. Underpins multi-value relations in create_object /
// update_object (cap-6dy.11 / .12). It maps human-readable entity NAMES to
// Capacities object IDs by title-searching, and classifies each name as
// linked / unmatched / ambiguous. It NEVER guesses among multiple exact matches.
//
// This module is WRITE-FREE: its only outward calls are `client.searchContent`
// (a read) and the injected `createEntity` callback, whose concrete write
// implementation lives elsewhere (cap-6dy.11).
import { CapacitiesClient } from "../client/capacities.js";

export interface EntityCandidate {
  id: string;
  title: string;
  structureId: string;
}

export interface ResolutionResult {
  // Exactly one exact-title match (or created via the create path).
  linked: { name: string; id: string }[];
  // Zero matches (and not created).
  unmatched: string[];
  // >1 exact-title match — never guessed; caller must disambiguate.
  ambiguous: { name: string; candidates: EntityCandidate[] }[];
}

export interface ResolveEntitiesOptions {
  create?: boolean;
  // Seam for the create=true path. cap-6dy.11 (create_object) owns the concrete
  // create call once cap-6dy.10 verifies the create body shape; this helper stays
  // write-free and just delegates. Given a name + the single target entity
  // structure, it returns the new object's id.
  createEntity?: (name: string, structureId: string) => Promise<string>;
}

// #PATH_DECISION: exact-title match uses case-insensitive, trimmed equality.
// Capacities titles are user-facing and case is very likely insignificant, but
// this is a judgement call — flagging so review (and cap-6dy.11) can confirm
// we want "alice" to match "Alice".
function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

export async function resolveEntities(
  client: CapacitiesClient,
  names: string[],
  structureIds: string[] | undefined,
  opts?: ResolveEntitiesOptions
): Promise<ResolutionResult> {
  const result: ResolutionResult = { linked: [], unmatched: [], ambiguous: [] };

  // Dedupe by normalized name, preserving first-seen order, so a repeated name
  // yields one search and one output entry.
  const seen = new Set<string>();
  const uniqueNames: string[] = [];
  for (const name of names) {
    const key = normalizeName(name);
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueNames.push(name);
  }

  // #PATH_DECISION: create can only auto-create when exactly ONE target structure
  // is known. When `structureIds` is undefined or has ≠1 entry, an unmatched name
  // falls through to `unmatched` (you can't create an entity without knowing its
  // structure). This mirrors the design's "Entity resolution" section and is the
  // documented seam contract with cap-6dy.11.
  const canCreate =
    opts?.create === true &&
    typeof opts.createEntity === "function" &&
    structureIds?.length === 1;

  for (const name of uniqueNames) {
    const target = normalizeName(name);
    const results = await client.searchContent({
      query: name,
      structureIds,
      limit: 50,
    });

    const exact = results.filter((r) => normalizeName(r.title) === target);

    if (exact.length === 1) {
      result.linked.push({ name, id: exact[0].id });
    } else if (exact.length > 1) {
      result.ambiguous.push({
        name,
        candidates: exact.map((r) => ({
          id: r.id,
          title: r.title,
          structureId: r.structureId,
        })),
      });
    } else {
      // Zero exact matches.
      if (canCreate) {
        const id = await opts!.createEntity!(name, structureIds![0]);
        result.linked.push({ name, id });
      } else {
        result.unmatched.push(name);
      }
    }
  }

  return result;
}
