
// File: src/client/capacities.ts - Using native fetch
import { CapacitiesSpace, CapacitiesStructure, SearchResult, SearchOptions, SaveWeblinkOptions, SaveToDailyNoteOptions, CapacitiesObject } from "./types.js";

export class CapacitiesClient {
  private baseUrl: string;
  private apiToken: string;
  private rateLimiter: RateLimiter;
  private logLevel: string;

  constructor(config: { apiToken: string; baseUrl: string; logLevel?: string }) {
    this.baseUrl = config.baseUrl;
    this.apiToken = config.apiToken;
    this.logLevel = config.logLevel ?? "info";
    this.rateLimiter = new RateLimiter();
  }

  private debug(...args: unknown[]) {
    if (this.logLevel === "debug") console.error(...args);
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
        // v2 REST API requires an explicit API version header on every request.
        'X-Capacities-Api-Version': '0.1.0',
        ...options.headers
      }
    });

    if (!response.ok) {
      // Read the body defensively — for v2 structured/markdown writes a 400's body
      // is the LLM's only path to self-correct, so surface it in the error.
      let body = "";
      try {
        body = await response.text();
      } catch {
        /* ignore */
      }

      if (response.status === 429) {
        const retryAfter = response.headers.get("retry-after");
        throw new CapacitiesAPIError(
          "RATE_LIMIT_EXCEEDED",
          "Rate limit exceeded" + (body ? `: ${body}` : ""),
          { status: 429, body, ...(retryAfter ? { retryAfter } : {}) }
        );
      }
      if (response.status === 401) {
        throw new CapacitiesAPIError(
          "AUTHENTICATION_FAILED",
          "Invalid API token" + (body ? `: ${body}` : ""),
          { status: 401, body }
        );
      }
      throw new CapacitiesAPIError(
        "API_ERROR",
        `API error ${response.status}${body ? ": " + body : ""}`,
        { status: response.status, body }
      );
    }

    // Handle empty responses gracefully
    const contentType = response.headers.get('content-type');
    const contentLength = response.headers.get('content-length');
    
    this.debug("DEBUG: Response info:", {
      status: response.status,
      contentType,
      contentLength,
      endpoint
    });

    if (contentLength === '0' || !contentType?.includes('application/json')) {
      this.debug("DEBUG: Empty or non-JSON response, returning success indicator");
      return { success: true } as T;
    }

    try {
      const result = await response.json() as T;
      this.debug("DEBUG: Parsed JSON response:", result);
      return result;
    } catch (jsonError) {
      this.debug("DEBUG: JSON parsing failed:", jsonError);
      // If JSON parsing fails but response was OK, assume success
      return { success: true } as T;
    }
  }

  private getEndpointType(endpoint: string): EndpointType {
    // Order matters: /object/url must be classified before the generic /object.
    if (endpoint.includes("/objects/search")) return "search";
    if (endpoint.includes("/object/url")) return "weblink";
    if (endpoint.includes("/blocks")) return "blocks";
    if (endpoint.includes("/object")) return "object";
    // /space and /space/structures
    return "space";
  }

  // v2 tokens are scoped to a single space, so GET /space returns one object
  // (not an array). We wrap it so list_spaces and other callers keep working.
  async getSpaces(): Promise<CapacitiesSpace[]> {
    const space = await this.makeRequest<CapacitiesSpace>("/space");
    return [space];
  }

  // spaceId is ignored in v2 (the token already scopes to a single space) but
  // kept in the signature for call-site compatibility.
  async getSpaceInfo(_spaceId?: string): Promise<{ structures: CapacitiesStructure[] }> {
    return this.makeRequest("/space/structures");
  }

  async searchContent(options: SearchOptions): Promise<SearchResult[]> {
    // v2 search is a single request; spaceIds is ignored (token is single-space).
    const body: { query: string; structureIds?: string[]; limit?: number } = {
      query: options.query
    };
    if (options.structureIds) body.structureIds = options.structureIds;
    if (options.limit !== undefined) body.limit = options.limit;

    const response = await this.makeRequest<{ results: SearchResult[] }>(
      "/objects/search",
      {
        method: "POST",
        body: JSON.stringify(body)
      }
    );
    return response.results;
  }

  // Returns the created CapacitiesObject. Typed as unknown so existing tool
  // call-sites can assert their own response shape (see src/tools/weblink.ts).
  async saveWeblink(options: SaveWeblinkOptions): Promise<unknown> {
    // TODO(cap-6dy.3): title/description/tags overrides are deferred; v2 /object/url
    // takes only {url, markdown} for now.
    return this.makeRequest<CapacitiesObject>("/object/url", {
      method: "POST",
      body: JSON.stringify({
        url: options.url,
        markdown: options.notes
      })
    });
  }

  async saveToDailyNote(options: SaveToDailyNoteOptions) {
    // v2 daily-note append returns HTTP 200 with an empty body (handled by makeRequest).
    return this.makeRequest("/blocks/daily-note/append", {
      method: "POST",
      body: JSON.stringify({
        markdown: options.content,
        noTimeStamp: options.noTimestamp ?? false
      })
    });
  }
}

type EndpointType = "space" | "search" | "weblink" | "object" | "blocks";

// Rate limiter implementation
class RateLimiter {
  private windows = new Map<string, { requests: number; resetTime: number }>();
  // v2 per-category limits (requests per 60s window).
  private limits: Record<EndpointType, { maxRequests: number; windowMs: number }> = {
    space: { maxRequests: 10, windowMs: 60000 },   // /space, /space/structures
    search: { maxRequests: 30, windowMs: 60000 },  // /objects/search
    weblink: { maxRequests: 10, windowMs: 60000 }, // /object/url
    object: { maxRequests: 30, windowMs: 60000 },  // /object, /object/markdown
    blocks: { maxRequests: 30, windowMs: 60000 }   // /blocks/*
  };

  async waitForSlot(endpoint: EndpointType): Promise<void> {
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
      // Surface a structured "retry in Ns" error instead of silently sleeping up
      // to 60s. Same RATE_LIMIT_EXCEEDED code as the server-429 path; the
      // details.retryAfterMs distinguishes the client-side preemptive case.
      const retryAfterMs = window.resetTime - now;
      throw new CapacitiesAPIError(
        "RATE_LIMIT_EXCEEDED",
        `Rate limited on ${endpoint} requests; retry in ${Math.ceil(retryAfterMs / 1000)}s`,
        { retryAfterMs, category: endpoint }
      );
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