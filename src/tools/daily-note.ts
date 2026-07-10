import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CapacitiesClient } from "../client/capacities.js";
import { MARKDOWN_BODY_NOTE } from "./descriptions.js";

export function setupDailyNoteTools(server: McpServer, client: CapacitiesClient) {
  server.registerTool(
    "add_to_daily_note",
    {
      title: "Add to Daily Note",
      description: "Add content to today's daily note in Capacities. Supports markdown. Each call appends to the existing daily note.",
      inputSchema: {
        content: z.string().describe("Content to add (supports markdown)." + MARKDOWN_BODY_NOTE),
        no_timestamp: z.boolean().default(false).describe("Skip adding timestamp to the entry")
      }
    },
    async ({ content, no_timestamp }) => {
      if (!content.trim()) {
        throw new Error("Content must not be empty");
      }

      try {
        await client.saveToDailyNote({
          content,
          noTimestamp: no_timestamp
        });

        return {
          content: [{
            type: "text",
            text: `Added to today's daily note${no_timestamp ? "" : " with timestamp"}.\n\nContent:\n${content}`
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Failed to add to daily note: ${error instanceof Error ? error.message : String(error)}`
          }],
          isError: true
        };
      }
    }
  );
}
