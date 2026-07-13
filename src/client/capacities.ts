
// File: src/client/capacities.ts - Using native fetch
import { CapacitiesSpace, CapacitiesStructure, SearchResult, SearchOptions, SaveWeblinkOptions, SaveToDailyNoteOptions, CapacitiesObject } from "./types.js";

// Rate-limit window length (ms). Exported so composite-write callers can seed a
// bounded-wait budget of one window (cap-6dy.19).
export const WINDOW_MS = 60000;

// A mutable, operation-level bounded-wait budget. A single instance is shared
// across ALL paced calls in one composite write, so cumulative internal sleep is
// capped at its initial `remainingMs` (cap-6dy.19).
export type WaitBudget = { remainingMs: number };

export class CapacitiesClient {
  private baseUrl: string;
  private apiToken: string;
  private rateLimiter: RateLimiter;
  private logLevel: string;

  constructor(config: {
    apiToken: string;
    baseUrl: string;
    logLevel?: string;
    // Injectable time source for testing bounded-wait pacing without real sleeps.
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
  }) {
    this.baseUrl = config.baseUrl;
    this.apiToken = config.apiToken;
    this.logLevel = config.logLevel ?? "info";
    this.rateLimiter = new RateLimiter({ now: config.now, sleep: config.sleep });
  }

  private debug(...args: unknown[]) {
    if (this.logLevel === "debug") console.error(...args);
  }

  private async makeRequest<T>(
    endpoint: string,
    options: RequestInit = {},
    // When a budget is supplied (composite writes only), the limiter may sleep
    // across one window reset within that budget instead of throwing. Default
    // (no budget) behavior is byte-for-byte the pre-existing throw path.
    pace?: WaitBudget
  ): Promise<T> {
    // Rate limiting
    const endpointType = this.getEndpointType(endpoint);
    if (pace) {
      await this.rateLimiter.acquireWithWait(endpointType, pace);
    } else {
      await this.rateLimiter.waitForSlot(endpointType);
    }

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

  async searchContent(options: SearchOptions, pace?: WaitBudget): Promise<SearchResult[]> {
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
      },
      pace
    );
    // Guard the empty-body/non-JSON 200 shape (makeRequest returns {success:true}):
    // `results` would be undefined and blow up downstream `.filter`/`.length`
    // (cap-6dy.20). Real zero-result search returns `{results:[]}`, so this is
    // defensive — but it makes the return type honest.
    return response.results ?? [];
  }

  // Returns the created CapacitiesObject. Typed as unknown so existing tool
  // call-sites can assert their own response shape (see src/tools/weblink.ts).
  async saveWeblink(options: SaveWeblinkOptions): Promise<unknown> {
    // v2 /object/url properties is the constrained CreateObjectFromUrlProperties
    // shape: only title/description are settable (tags are NOT — tag afterward
    // via update_object). Wrapper shapes are live-verified elsewhere.
    const properties: Record<string, unknown> = {};
    if (options.title !== undefined) {
      properties.title = { type: "title", title: { value: options.title } };
    }
    if (options.description !== undefined) {
      properties.description = { type: "text", text: { value: options.description } };
    }
    const body: { url: string; markdown?: string; properties?: Record<string, unknown> } = {
      url: options.url
    };
    if (options.notes !== undefined) body.markdown = options.notes;
    if (Object.keys(properties).length > 0) body.properties = properties;
    return this.makeRequest<CapacitiesObject>("/object/url", {
      method: "POST",
      body: JSON.stringify(body)
    });
  }

  // Generic create: POST /object with typed-wrapper properties (see cap-6dy.10
  // verified write reference). Returns the full structured object.
  async createObject(body: {
    structureId: string;
    properties?: Record<string, unknown>;
    collections?: string[];
  }, pace?: WaitBudget): Promise<CapacitiesObject> {
    const obj = await this.makeRequest<CapacitiesObject>("/object", {
      method: "POST",
      body: JSON.stringify(body)
    }, pace);
    // Guard the empty-body/non-JSON 200 shape: without an id we'd report
    // "ID: undefined" and a follow-up appendBlocks({id: undefined}) (cap-6dy.20).
    if (!obj || typeof obj.id !== "string" || obj.id.length === 0) {
      throw new CapacitiesAPIError("API_ERROR", "create returned no object id", { body: obj });
    }
    return obj;
  }

  // Reads the STRUCTURED object (typed-wrapper properties + blocks). update_object
  // uses this to see current multi-value lists before a replace (cap-6dy.10);
  // find_objects (cap-0yu) passes a WaitBudget to pace its per-candidate fetch
  // loop across one object-window boundary.
  async getObject(id: string, pace?: WaitBudget): Promise<CapacitiesObject> {
    return this.makeRequest<CapacitiesObject>(`/object?id=${encodeURIComponent(id)}`, {}, pace);
  }

  // Generic update: PATCH /object. Merges by key but REPLACES the value of any
  // property it names (naming a multi-value prop drops its prior list). Returns
  // the full structured object.
  async updateObject(body: {
    id: string;
    properties?: Record<string, unknown>;
    collections?: string[];
  }, pace?: WaitBudget): Promise<CapacitiesObject> {
    const obj = await this.makeRequest<CapacitiesObject>("/object", {
      method: "PATCH",
      body: JSON.stringify(body)
    }, pace);
    // Guard the empty-body/non-JSON 200 shape (see createObject) — cap-6dy.20.
    if (!obj || typeof obj.id !== "string" || obj.id.length === 0) {
      throw new CapacitiesAPIError("API_ERROR", "update returned no object id", { body: obj });
    }
    return obj;
  }

  // Appends markdown-converted blocks to an existing object (verified mechanism).
  async appendBlocks(body: { id: string; markdown: string }): Promise<unknown> {
    return this.makeRequest("/blocks/append", {
      method: "POST",
      body: JSON.stringify(body)
    });
  }

  // Reads an object rendered as Markdown (YAML frontmatter of properties + body).
  // Distinct from getObject, which returns the STRUCTURED typed-wrapper form.
  async getObjectMarkdown(id: string): Promise<{ id: string; structureId: string; markdown: string }> {
    return this.makeRequest(`/object/markdown?id=${encodeURIComponent(id)}`); // GET
  }

  // Deletes an object. hardDelete is a REQUIRED query param: false moves the
  // object to trash (recoverable in Capacities); true permanently deletes it.
  async deleteObject(id: string, hardDelete: boolean): Promise<unknown> {
    return this.makeRequest(
      `/object?id=${encodeURIComponent(id)}&hardDelete=${hardDelete}`,
      { method: "DELETE" }
    );
  }

  async saveToDailyNote(options: SaveToDailyNoteOptions) {
    // v2 daily-note append returns HTTP 200 with an empty body (handled by makeRequest).
    // cap-6dy.23: v1 sent origin:"mcp" here (set the note's origin icon). v2 dropped
    // `origin` entirely — it is not accepted on /blocks/daily-note/append nor ANY v2
    // write endpoint (verified against the live OpenAPI spec 2026-07-12). So the MCP
    // origin marker is no longer settable via the API; nothing to re-add. (v2 also
    // supports a `date` field here to target a specific day — not yet exposed.)
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

  // Injectable clock/sleep so bounded-wait pacing is testable without real time.
  private now: () => number;
  private sleep: (ms: number) => Promise<void>;

  constructor(deps?: { now?: () => number; sleep?: (ms: number) => Promise<void> }) {
    this.now = deps?.now ?? (() => Date.now());
    this.sleep = deps?.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  windowMsFor(endpoint: EndpointType): number {
    return this.limits[endpoint].windowMs;
  }

  // Take a slot in the current window if one is free (opening a fresh window when
  // the prior one has elapsed). Returns false without mutating when the window is
  // full. Shared by both the throw path and the bounded-wait path.
  private tryTake(endpoint: EndpointType): boolean {
    const limit = this.limits[endpoint];
    const now = this.now();
    const window = this.windows.get(endpoint);

    if (!window || now >= window.resetTime) {
      this.windows.set(endpoint, { requests: 1, resetTime: now + limit.windowMs });
      return true;
    }
    if (window.requests >= limit.maxRequests) return false;
    window.requests++;
    return true;
  }

  private throwRateLimited(endpoint: EndpointType): never {
    const window = this.windows.get(endpoint);
    const retryAfterMs = window ? window.resetTime - this.now() : this.limits[endpoint].windowMs;
    throw new CapacitiesAPIError(
      "RATE_LIMIT_EXCEEDED",
      `Rate limited on ${endpoint} requests; retry in ${Math.ceil(retryAfterMs / 1000)}s`,
      { retryAfterMs, category: endpoint }
    );
  }

  async waitForSlot(endpoint: EndpointType): Promise<void> {
    // Throw-immediately behavior (cap-6dy.8) — unchanged; used by every
    // single-call site. Surfaces a structured "retry in Ns" error rather than
    // silently sleeping up to 60s.
    if (this.tryTake(endpoint)) return;
    this.throwRateLimited(endpoint);
  }

  // Bounded-wait acquire for composite writes only (cap-6dy.19). If a slot is
  // free, take it. If the window is full and the wait-to-reset fits in the
  // operation's remaining budget, sleep across exactly one window reset, decrement
  // the shared budget, then take a slot in the fresh window. Otherwise throw the
  // same RATE_LIMIT_EXCEEDED as the throw path.
  async acquireWithWait(endpoint: EndpointType, budget: WaitBudget): Promise<void> {
    if (this.tryTake(endpoint)) return;

    const window = this.windows.get(endpoint)!;
    const resetIn = window.resetTime - this.now();
    if (resetIn <= budget.remainingMs) {
      await this.sleep(resetIn);
      budget.remainingMs -= resetIn;
      if (this.tryTake(endpoint)) return;
    }
    this.throwRateLimited(endpoint);
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