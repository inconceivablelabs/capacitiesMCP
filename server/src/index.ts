#!/usr/bin/env node

import 'dotenv/config';
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CapacitiesClient } from "./client/capacities.js";
import { setupSearchTools } from "./tools/search.js";
import { setupCreationTools } from "./tools/create.js";
import { setupAnalysisTools } from "./tools/content-analysis.js";
import { setupSmartSearchTools } from "./tools/smart-search.js";
// import { setupWebLinkTools } from "./tools/weblink.js";
// import { setupDailyNoteTools } from "./tools/daily-note.js";
import { setupSpaceResources } from "./resources/spaces.js";
import { validateEnvironment } from "./utils/validation.js";

async function main() {
  // Validate environment
  const env = validateEnvironment();

  // Initialize Capacities API client
  const capacitiesClient = new CapacitiesClient({
    apiToken: env.apiToken,
    baseUrl: env.baseUrl
  });

  // Create MCP server
  const server = new McpServer({
    name: "capacities-mcp-server",
    version: "1.0.0"
  });

  // Setup tools
  setupSearchTools(server, capacitiesClient);
  setupCreationTools(server, capacitiesClient);
  setupAnalysisTools(server, capacitiesClient);
  setupSmartSearchTools(server, capacitiesClient);
  // setupWebLinkTools(server, capacitiesClient);
  // setupDailyNoteTools(server, capacitiesClient);

  // Setup resources
  setupSpaceResources(server, capacitiesClient);

  // Connect to stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error("Capacities MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
