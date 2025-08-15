import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CapacitiesClient } from "../client/capacities.js";

export function setupSpaceResources(server: McpServer, client: CapacitiesClient) {
  // Spaces resource
  server.registerResource(
    "spaces",
    "capacities://spaces",
    {
      name: "Capacities Spaces",
      description: "List of all your Capacities spaces",
      mimeType: "application/json"
    },
    async () => {
      try {
        const spaces = await client.getSpaces();
        return {
          contents: [{
            uri: "capacities://spaces",
            text: JSON.stringify(spaces, null, 2)
          }]
        };
      } catch (error) {
        throw new Error(`Failed to fetch spaces: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  );
}