import { CapacitiesSpace, CapacitiesStructure, SearchResult, SearchOptions, SaveWeblinkOptions, SaveToDailyNoteOptions } from "./types.js";
export declare class CapacitiesClient {
    private baseUrl;
    private apiToken;
    private rateLimiter;
    constructor(config: {
        apiToken: string;
        baseUrl: string;
    });
    private makeRequest;
    private getEndpointType;
    getSpaces(): Promise<CapacitiesSpace[]>;
    getSpaceInfo(spaceId: string): Promise<{
        structures: CapacitiesStructure[];
    }>;
    searchContent(options: SearchOptions): Promise<SearchResult[]>;
    saveWeblink(options: SaveWeblinkOptions): Promise<unknown>;
    saveToDailyNote(options: SaveToDailyNoteOptions): Promise<unknown>;
}
export declare class CapacitiesAPIError extends Error {
    code: string;
    details?: any | undefined;
    constructor(code: string, message: string, details?: any | undefined);
}
//# sourceMappingURL=capacities.d.ts.map