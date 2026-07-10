import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CapacitiesClient } from "../client/capacities.js";
import { CapacitiesObject } from "../client/types.js";
import { validateUrl } from "../utils/validation.js";
import { MARKDOWN_BODY_NOTE } from "./descriptions.js";

export function setupWebLinkTools(server: McpServer, client: CapacitiesClient) {
  server.registerTool(
    "save_weblink",
    {
      title: "Save Weblink to Capacities",
      description: "Save a URL as a weblink object. Optional title/description override the auto-fetched page metadata (these are the ONLY fields settable on a weblink, and only at save time — weblinks are create-only in the API). To tag or annotate a weblink, put #tag, () tasks, or [[links]] in notes; Category/Topic and other properties cannot be set via the API yet.",
      inputSchema: {
        url: z.string().describe("The URL to save"),
        title: z.string().optional().describe("Custom title overriding the auto-fetched page title (max 500 chars)"),
        description: z.string().optional().describe("Custom description overriding the auto-fetched page description (max 1000 chars)"),
        notes: z.string().optional().describe("Additional notes in markdown format. Use actual newlines for line breaks, NOT escaped \\n characters." + MARKDOWN_BODY_NOTE)
      }
    },
    async ({ url, title, description, notes }) => {
      if (!validateUrl(url)) {
        throw new Error("Invalid URL format");
      }

      try {
        const result = await client.saveWeblink({
          url,
          title,
          description,
          notes
        }) as CapacitiesObject;

        // The API response nests title/description under `properties` (or
        // omits them); report the user-supplied override args instead of
        // reading them off the response, which are the only values we know
        // were actually set vs. auto-fetched (code review fix #5).
        return {
          content: [{
            type: "text",
            text: `Saved weblink!\n\n**Title:** ${title || "(auto-generated)"}\n**URL:** ${url}\n**ID:** ${result.id}\n**Description:** ${description || "(auto-generated)"}`
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
