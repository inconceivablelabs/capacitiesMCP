export class CapacitiesClient {
    baseUrl;
    apiToken;
    rateLimiter;
    constructor(config) {
        this.baseUrl = config.baseUrl;
        this.apiToken = config.apiToken;
        this.rateLimiter = new RateLimiter();
    }
    async makeRequest(endpoint, options = {}) {
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
            return { success: true };
        }
        try {
            const result = await response.json();
            console.error("DEBUG: Parsed JSON response:", result);
            return result;
        }
        catch (jsonError) {
            console.error("DEBUG: JSON parsing failed:", jsonError);
            // If JSON parsing fails but response was OK, assume success
            return { success: true };
        }
    }
    getEndpointType(endpoint) {
        if (endpoint.includes("/search"))
            return "search";
        if (endpoint.includes("/save-weblink"))
            return "weblink";
        return "general";
    }
    async getSpaces() {
        const response = await this.makeRequest("/spaces");
        return response.spaces;
    }
    async getSpaceInfo(spaceId) {
        return this.makeRequest(`/space-info?spaceid=${spaceId}`);
    }
    async searchContent(options) {
        const response = await this.makeRequest("/search", {
            method: "POST",
            body: JSON.stringify({
                searchTerm: options.query,
                spaceIds: options.spaceIds,
                mode: options.mode || "fullText",
                filterStructureIds: options.structureIds
            })
        });
        return response.results;
    }
    async saveWeblink(options) {
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
    async saveToDailyNote(options) {
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
    windows = new Map();
    limits = {
        general: { maxRequests: 5, windowMs: 60000 },
        search: { maxRequests: 120, windowMs: 60000 },
        weblink: { maxRequests: 10, windowMs: 60000 }
    };
    async waitForSlot(endpoint) {
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
    code;
    details;
    constructor(code, message, details) {
        super(message);
        this.code = code;
        this.details = details;
        this.name = "CapacitiesAPIError";
    }
}
//# sourceMappingURL=capacities.js.map