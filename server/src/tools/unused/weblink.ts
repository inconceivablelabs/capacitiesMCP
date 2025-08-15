// File: src/tools/weblink.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CapacitiesClient } from "../client/capacities.js";
import { validateUUID, validateUrl } from "../utils/validation.js";

export function setupWebLinkTools(server: McpServer, client: CapacitiesClient) {
  server.tool(
    "save_weblink",
    {
      title: "Save Weblink to Capacities",
      description: "Save a URL as a weblink object in your Capacities space",
      inputSchema: {
        type: "object",
        properties: {
          spaceId: { type: "string", description: "The space to save the weblink in" },
          url: { type: "string", description: "The URL to save" },
          title: { type: "string", description: "Custom title for the weblink" },
          description: { type: "string", description: "Custom description" },
          tags: { 
            type: "array", 
            items: { type: "string" },
            description: "Tags to apply to the weblink"
          },
          notes: { type: "string", description: "Additional notes in markdown format" }
        },
        required: ["spaceId", "url"]
      }
    },
    async ({ spaceId, url, title, description, tags, notes }) => {
      // Validation
      if (!validateUUID(spaceId)) {
        throw new Error("Invalid space ID format");
      }

      if (!validateUrl(url)) {
        throw new Error("Invalid URL format");
      }

      try {
        const result = await client.saveWeblink({
          spaceId,
          url,
          title,
          description,
          tags,
          notes
        });

        return {
          content: [{
            type: "text",
            text: `Successfully saved weblink!\n\n**Title:** ${result.title}\n**URL:** ${url}\n**ID:** ${result.id}\n**Tags:** ${result.tags.join(", ") || "None"}\n**Description:** ${result.description || "Auto-generated"}`
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Failed to save weblink: ${error instanceof Error ? error.message : String(error)}`
          }],
          isError: true
        };
      }
    }
  );
}

