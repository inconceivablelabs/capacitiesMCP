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
