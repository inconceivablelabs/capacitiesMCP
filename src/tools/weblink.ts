import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CapacitiesClient } from "../client/capacities.js";
import { validateUrl } from "../utils/validation.js";

export function setupWebLinkTools(server: McpServer, client: CapacitiesClient) {
  server.registerTool(
    "save_weblink",
    {
      title: "Save Weblink to Capacities",
      description: "Save a URL as a weblink object in your Capacities space with optional title, description, tags, and notes",
      inputSchema: {
        url: z.string().describe("The URL to save"),
        title: z.string().optional().describe("Custom title for the weblink (max 500 chars)"),
        description: z.string().optional().describe("Custom description (max 1000 chars)"),
        tags: z.array(z.string()).optional().describe("Tags to apply to the weblink (max 30)"),
        notes: z.string().optional().describe("Additional notes in markdown format. Use actual newlines for line breaks, NOT escaped \\n characters.")
      }
    },
    async ({ url, title, description, tags, notes }) => {
      if (!validateUrl(url)) {
        throw new Error("Invalid URL format");
      }

      try {
        const result = await client.saveWeblink({
          url,
          title,
          description,
          tags,
          notes
        }) as { id: string; title: string; description: string; tags: string[] };

        return {
          content: [{
            type: "text",
            text: `Saved weblink!\n\n**Title:** ${result.title || "(auto-generated)"}\n**URL:** ${url}\n**ID:** ${result.id}\n**Tags:** ${result.tags?.join(", ") || "None"}\n**Description:** ${result.description || "(auto-generated)"}`
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
