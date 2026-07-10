// File: src/client/types.ts - Simple TypeScript interfaces
export interface CapacitiesSpace {
  id: string;
  title: string;
  icon: {
    type: "emoji" | "iconify";
    val: string;
    color?: string;
    colorHex?: string;
  };
}

export interface CapacitiesStructure {
  id: string;
  title: string;
  pluralName: string;
  propertyDefinitions: PropertyDefinition[];
  labelColor: string;
  collections: Collection[];
}

export interface PropertyDefinition {
  id: string;
  name: string;
  type: string;
  writable: boolean;
  // Present only for certain property types:
  multiple?: boolean;            // label: true = multi-select
  labelSet?: LabelOption[];      // label: the fixed selectable options
  allowedStructures?: string[];  // entity: structure ids that may be linked
}

export interface LabelOption {
  id: string;
  name: string;
  color?: string;
}

export interface Collection {
  id: string;
  title: string;
}

export interface SearchResult {
  id: string;
  structureId: string;
  title: string;
  // v2 /objects/search no longer scopes by space; spaceId is no longer set.
  spaceId?: string;
}

export interface SearchOptions {
  query: string;
  // v2 search is single-space (token-scoped); spaceIds is ignored but kept
  // for call-site compatibility.
  spaceIds?: string[];
  structureIds?: string[];
  limit?: number;
}

export interface SaveWeblinkOptions {
  // spaceId is ignored in v2 (token is single-space) but kept for call-site compat.
  spaceId?: string;
  url: string;
  title?: string;
  description?: string;
  notes?: string;
}

export interface SaveToDailyNoteOptions {
  // spaceId is ignored in v2 but kept for call-site compat.
  spaceId?: string;
  content: string;
  noTimestamp?: boolean;
}

// Minimal shape of an object returned by v2 create endpoints (e.g. POST /object/url).
export interface CapacitiesObject {
  id: string;
  structureId: string;
  collections: unknown;
  properties: Record<string, unknown>;
  blocks: Record<string, unknown>;
}
