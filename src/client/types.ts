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
  type: string;
  dataType: string;
  name: string;
}

export interface Collection {
  id: string;
  title: string;
}

export interface SearchResult {
  id: string;
  structureId: string;
  title: string;
  spaceId?: string; // Added client-side when searching across multiple spaces
}

export interface SearchOptions {
  query: string;
  spaceIds: string[];
}

export interface SaveWeblinkOptions {
  spaceId: string;
  url: string;
  title?: string;
  description?: string;
  tags?: string[];
  notes?: string;
}

export interface SaveToDailyNoteOptions {
  spaceId: string;
  content: string;
  noTimestamp?: boolean;
}
