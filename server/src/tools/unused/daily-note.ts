// File: src/tools/daily-note.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CapacitiesClient } from "../client/capacities.js";
import { validateUUID } from "../utils/validation.js";

export function setupDailyNoteTools(server: McpServer, client: CapacitiesClient) {
  server.tool(
    "add_to_daily_note",
    {
      title: "Add to Daily Note",
      description: "Add content to today's daily note in Capacities",
      inputSchema: {
        type: "object",
        properties: {
          spaceId: { type: "string", description: "The space containing the daily note" },
          content: { type: "string", description: "Content to add (supports markdown)" },
          noTimestamp: { 
            type: "boolean", 
            default: false, 
            description: "Skip adding timestamp" 
          }
        },
        required: ["spaceId", "content"]
      }
    },
    async ({ spaceId, content, noTimestamp }) => {
      if (!validateUUID(spaceId)) {
        throw new Error("Invalid space ID format");
      }

      if (!content || typeof content !== "string") {
        throw new Error("Content is required and must be a string");
      }

      try {
        await client.saveToDailyNote({
          spaceId,
          content,
          noTimestamp: noTimestamp || false
        });

        const timestamp = noTimestamp ? "" : ` with timestamp`;
        return {
          content: [{
            type: "text",
            text: `Successfully added content to today's daily note${timestamp}!\n\nContent added:\n${content}`
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

  // Helper tool for creating structured entries
  server.tool(
    "add_task_to_daily_note",
    {
      title: "Add Task to Daily Note",
      description: "Add a task/todo item to today's daily note",
      inputSchema: {
        type: "object",
        properties: {
          spaceId: { type: "string", description: "The space containing the daily note" },
          task: { type: "string", description: "The task description" },
          priority: { 
            type: "string", 
            enum: ["low", "medium", "high"],
            description: "Task priority"
          },
          dueDate: { type: "string", description: "Due date (YYYY-MM-DD format)" }
        },
        required: ["spaceId", "task"]
      }
    },
    async ({ spaceId, task, priority, dueDate }) => {
      if (!validateUUID(spaceId)) {
        throw new Error("Invalid space ID format");
      }

      if (!task || typeof task !== "string") {
        throw new Error("Task description is required");
      }

      try {
        let taskContent = `- [ ] ${task}`;
        
        if (priority) {
          const priorityEmojis = { low: "🔵", medium: "🟡", high: "🔴" };
          taskContent += ` ${priorityEmojis[priority]}`;
        }
        
        if (dueDate) {
          taskContent += ` (Due: ${dueDate})`;
        }

        await client.saveToDailyNote({
          spaceId,
          content: taskContent,
          noTimestamp: false
        });

        return {
          content: [{
            type: "text",
            text: `Successfully added task to daily note!\n\nTask: ${task}\nPriority: ${priority || "normal"}\nDue: ${dueDate || "not specified"}`
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Failed to add task: ${error instanceof Error ? error.message : String(error)}`
          }],
          isError: true
        };
      }
    }
  );
}

