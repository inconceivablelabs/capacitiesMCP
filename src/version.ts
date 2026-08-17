/**
 * Single source of truth for the version the server reports over MCP.
 *
 * Keep in lockstep with `package.json`, `server/package.json`, and
 * `manifest.json` — `test/version.test.ts` enforces that they all agree.
 */
export const SERVER_VERSION = "2.1.0";
