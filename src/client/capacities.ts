
// File: src/client/capacities.ts - Using native fetch
import { CapacitiesSpace, CapacitiesStructure, SearchResult, SearchOptions, SaveWeblinkOptions, SaveToDailyNoteOptions } from "./types.js";

export class CapacitiesClient {
  private baseUrl: string;
  private apiToken: string;
  private rateLimiter: RateLimiter;

  constructor(config: { apiToken: string; baseUrl: string }) {
    this.baseUrl = config.baseUrl;
    this.apiToken = config.apiToken;
    this.rateLimiter = new RateLimiter();
  }

  private async makeRequest<T>(
    endpoint: string, 
    options: RequestInit = {}
  ): Promise<T> {
    // Rate limiting
    const endpointType = this.getEndpointType(endpoint);
    await this.rateLimiter.waitForSlot(endpointType);

    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.apiToken}`,
        'Content-Type': 'application/json',
        ...options.headers
      }
    });

    if (!response.ok) {
      if (response.status === 429) {
        throw new CapacitiesAPIError("RATE_LIMIT_EXCEEDED", "Rate limit exceeded");
      }
      if (response.status === 401) {
        throw new CapacitiesAPIError("AUTHENTICATION_FAILED", "Invalid API token");
      }
      throw new CapacitiesAPIError("API_ERROR", `API error: ${response.status}`);
    }

    // Handle empty responses gracefully
    const contentType = response.headers.get('content-type');
    const contentLength = response.headers.get('content-length');
    
    console.error("DEBUG: Response info:", {
      status: response.status,
      contentType,
      contentLength,
      endpoint
    });

    if (contentLength === '0' || !contentType?.includes('application/json')) {
      console.error("DEBUG: Empty or non-JSON response, returning success indicator");
      return { success: true } as T;
    }

    try {
      const result = await response.json() as T;
      console.error("DEBUG: Parsed JSON response:", result);
      return result;
    } catch (jsonError) {
      console.error("DEBUG: JSON parsing failed:", jsonError);
      // If JSON parsing fails but response was OK, assume success
      return { success: true } as T;
    }
  }

  private getEndpointType(endpoint: string): "general" | "search" | "weblink" {
    if (endpoint.includes("/search")) return "search";
    if (endpoint.includes("/save-weblink")) return "weblink";
    return "general";
  }

  async getSpaces(): Promise<CapacitiesSpace[]> {
    const response = await this.makeRequest<{ spaces: CapacitiesSpace[] }>("/spaces");
    return response.spaces;
  }

  async getSpaceInfo(spaceId: string): Promise<{ structures: CapacitiesStructure[] }> {
    return this.makeRequest(`/space-info?spaceid=${spaceId}`);
  }

  async searchContent(options: SearchOptions): Promise<SearchResult[]> {
    const response = await this.makeRequest<{ results: SearchResult[] }>(
      "/search", 
      {
        method: "POST",
        body: JSON.stringify({
          searchTerm: options.query,
          spaceIds: options.spaceIds,
          mode: options.mode || "fullText",
          filterStructureIds: options.structureIds
        })
      }
    );
    return response.results;
  }

  async saveWeblink(options: SaveWeblinkOptions) {
    return this.makeRequest("/save-weblink", {
      method: "POST",
      body: JSON.stringify({
        spaceId: options.spaceId,
        url: options.url,
        titleOverwrite: options.title,
        descriptionOverwrite: options.description,
        tags: options.tags || [],
        mdText: options.notes
      })
    });
  }

  async saveToDailyNote(options: SaveToDailyNoteOptions) {
    return this.makeRequest("/save-to-daily-note", {
      method: "POST",
      body: JSON.stringify({
        spaceId: options.spaceId,
        mdText: options.content,
        noTimeStamp: options.noTimestamp || false
      })
    });
  }
}

// Rate limiter implementation
class RateLimiter {
  private windows = new Map<string, { requests: number; resetTime: number }>();
  private limits = {
    general: { maxRequests: 5, windowMs: 60000 },
    search: { maxRequests: 120, windowMs: 60000 },
    weblink: { maxRequests: 10, windowMs: 60000 }
  };

  async waitForSlot(endpoint: "general" | "search" | "weblink"): Promise<void> {
    const limit = this.limits[endpoint];
    const now = Date.now();
    const window = this.windows.get(endpoint);

    if (!window || now >= window.resetTime) {
      this.windows.set(endpoint, {
        requests: 1,
        resetTime: now + limit.windowMs
      });
      return;
    }

    if (window.requests >= limit.maxRequests) {
      const waitTime = window.resetTime - now;
      await new Promise(resolve => setTimeout(resolve, waitTime));
      return this.waitForSlot(endpoint);
    }

    window.requests++;
  }
}

export class CapacitiesAPIError extends Error {
  constructor(
    public code: string,
    message: string,
    public details?: any
  ) {
    super(message);
    this.name = "CapacitiesAPIError";
  }
}