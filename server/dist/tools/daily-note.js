import { z } from "zod";
import { validateUUID } from "../utils/validation.js";
export function setupDailyNoteTools(server, client) {
    server.registerTool("add_to_daily_note", {
        title: "Add to Daily Note",
        description: "Add content to today's daily note in Capacities. Supports markdown. Each call appends to the existing daily note.",
        inputSchema: {
            space_id: z.string().describe("The space containing the daily note"),
            content: z.string().describe("Content to add (supports markdown)"),
            no_timestamp: z.boolean().default(false).describe("Skip adding timestamp to the entry")
        }
    }, async ({ space_id, content, no_timestamp }) => {
        if (!validateUUID(space_id)) {
            throw new Error("Invalid space ID format");
        }
        if (!content.trim()) {
            throw new Error("Content must not be empty");
        }
        try {
            await client.saveToDailyNote({
                spaceId: space_id,
                content,
                noTimestamp: no_timestamp
            });
            return {
                content: [{
                        type: "text",
                        text: `Added to today's daily note${no_timestamp ? "" : " with timestamp"}.\n\nContent:\n${content}`
                    }]
            };
        }
        catch (error) {
            return {
                content: [{
                        type: "text",
                        text: `Failed to add to daily note: ${error instanceof Error ? error.message : String(error)}`
                    }],
                isError: true
            };
        }
    });
}
//# sourceMappingURL=daily-note.js.map