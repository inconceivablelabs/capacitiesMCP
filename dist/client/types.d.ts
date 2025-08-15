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
    spaceId: string;
    structureId: string;
    title: string;
    highlights: SearchHighlight[];
}
export interface SearchHighlight {
    context: {
        field: "title" | "description" | "properties" | "blocksContent" | "mediaContent" | "tags" | "inTextTags";
        propertyId?: string;
        blockId?: string;
        location?: {
            mediaContentType: "tweet" | "chatMessage";
            id: string;
        };
    };
    snippets: string[];
    score?: number;
}
export interface SearchOptions {
    query: string;
    spaceIds: string[];
    mode?: "fullText" | "title";
    structureIds?: string[];
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
//# sourceMappingURL=types.d.ts.map