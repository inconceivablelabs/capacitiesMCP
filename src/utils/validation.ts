// File: src/utils/validation.ts - Simple validation without Zod
export function validateEnvironment(): {
  apiToken: string;
  baseUrl: string;
  logLevel: string;
} {
  const apiToken = process.env.CAPACITIES_API_TOKEN;
  if (!apiToken) {
    throw new Error("CAPACITIES_API_TOKEN environment variable is required");
  }

  const baseUrl = process.env.CAPACITIES_API_BASE_URL || "https://api.capacities.io";
  const logLevel = process.env.LOG_LEVEL || "info";

  return { apiToken, baseUrl, logLevel };
}

export function validateUUID(value: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(value);
}

export function validateUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

// The spec's UUID pattern (developers.capacities.io/openapi.json): versions 1-8,
// variant 8-b, plus nil and max. Wider than validateUUID, which rejects v6-v8.
// No trim: callers pass ids/cursors exactly as the API returned them.
const SPEC_UUID_REGEX =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|0{8}-0{4}-0{4}-0{4}-0{12}|f{8}-f{4}-f{4}-f{4}-f{12})$/i;

export function isSpecUuid(value: string): boolean {
  return SPEC_UUID_REGEX.test(value);
}
