// File: src/tools/context.ts
//
// link_to_context / unlink_from_context (cap-9cg). A Capacities task's Context
// is NOT a task property: it is DERIVED from the objects that embed the task as
// an EntityBlock. So linking a task to a person/project/meeting means appending
// an EntityBlock for the task to that object's body, and unlinking means
// deleting every such embed. Both tools read before they write, so link is
// idempotent and unlink only ever deletes blocks it has just seen.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CapacitiesClient, CapacitiesAPIError } from "../client/capacities.js";
import { findEntityBlocks } from "../utils/entity-blocks.js";

// Built-in Task structure id (live, 2026-11-02).
const TASK_STRUCTURE = "RootTask";

function errorMessage(error: unknown): string {
  return error instanceof CapacitiesAPIError
    ? error.message
    : error instanceof Error
      ? error.message
      : String(error);
}

function fail(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true };
}

function ok(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

// properties.title.title.value, falling back to the id.
function titleOf(obj: unknown, fallback: string): string {
  const props = (obj as { properties?: Record<string, unknown> } | null)?.properties;
  const title = (props?.title as { title?: { value?: unknown } } | undefined)?.title?.value;
  return typeof title === "string" && title.trim() !== "" ? title : fallback;
}

const CONTEXT_NOTE =
  "A task's Context in Capacities is derived, not a property: it is the set of objects " +
  "(people, projects, meetings, ...) whose body embeds the task as an EntityBlock.";

export function setupContextTools(server: McpServer, client: CapacitiesClient) {
  server.registerTool(
    "link_to_context",
    {
      title: "Link Task to Context",
      description:
        `Add a task to another object's Context. ${CONTEXT_NOTE} This appends an EntityBlock ` +
        "embedding the task to the END of the target object's body (POST /blocks/append). " +
        "Idempotent: if the target already embeds the task anywhere in its body, nothing is " +
        "written and the existing block id(s) are reported. task_id must be a Task (RootTask).",
      inputSchema: {
        task_id: z.string().describe("objectId of the task to add to the Context"),
        object_id: z
          .string()
          .describe("objectId of the person/project/meeting/... whose body will embed the task")
      }
    },
    async ({ task_id, object_id }) => {
      if (task_id === object_id) {
        return fail("task_id and object_id are the same object; a task cannot be its own Context. Nothing written.");
      }
      try {
        const [task, target] = await Promise.all([client.getObject(task_id), client.getObject(object_id)]);
        if (task?.structureId !== TASK_STRUCTURE) {
          return fail(
            `Object ${task_id} is a ${task?.structureId ?? "(unknown structure)"}, not a task ` +
              `(${TASK_STRUCTURE}). Nothing written.`
          );
        }
        const taskTitle = titleOf(task, task_id);
        const targetTitle = titleOf(target, object_id);

        const existing = findEntityBlocks(target, task_id);
        if (existing.length > 0) {
          const ids = existing.map((r) => r.blockId).join(", ");
          return ok(
            `Task "${taskTitle}" is already in the Context of "${targetTitle}" (block ${ids}). Nothing written.`
          );
        }

        const response = await client.appendEntityBlock(object_id, task_id);
        // Confirm from the append RESPONSE (the full object); an empty-body 200
        // ({success:true}) carries no blocks, so the embed is unconfirmed, not failed.
        const added = findEntityBlocks(response, task_id);
        if (added.length === 0) {
          return ok(
            `Appended an embed of task "${taskTitle}" to "${targetTitle}", but it is not confirmed: ` +
              "the response did not include the new block. Re-run link_to_context to check (it will not duplicate)."
          );
        }
        const ids = added.map((r) => r.blockId).join(", ");
        return ok(`Linked task "${taskTitle}" to the Context of "${targetTitle}" (new block ${ids}).`);
      } catch (error) {
        return fail(`Failed to link task to Context: ${errorMessage(error)}`);
      }
    }
  );

  server.registerTool(
    "unlink_from_context",
    {
      title: "Unlink Task from Context",
      description:
        `Remove a task from another object's Context. ${CONTEXT_NOTE} This deletes EVERY ` +
        "EntityBlock on the target object that embeds the task (at any depth, in any block " +
        "field), one DELETE /block each; nested content inside a removed block goes with it. " +
        "If the target does not embed the task, nothing is removed.",
      inputSchema: {
        task_id: z.string().describe("objectId of the task to remove from the Context"),
        object_id: z.string().describe("objectId of the object whose body embeds the task")
      }
    },
    async ({ task_id, object_id }) => {
      let found;
      let targetTitle = object_id;
      try {
        const target = await client.getObject(object_id);
        targetTitle = titleOf(target, object_id);
        found = findEntityBlocks(target, task_id);
      } catch (error) {
        return fail(`Failed to unlink task from Context: ${errorMessage(error)}`);
      }

      if (found.length === 0) {
        return ok(`Task ${task_id} is not embedded in "${targetTitle}", so it is not in that Context; nothing removed.`);
      }

      // Sequential, stop at the first failure so the count removed is exact.
      let removed = 0;
      for (const ref of found) {
        try {
          await client.deleteBlock(object_id, ref.blockId);
          removed++;
        } catch (error) {
          return fail(
            `Removed ${removed} of ${found.length} embed(s) of task ${task_id} from "${targetTitle}" ` +
              `before a failure on block ${ref.blockId}: ${errorMessage(error)}`
          );
        }
      }
      const ids = found.map((r) => r.blockId).join(", ");
      return ok(`Removed ${removed} embed(s) of task ${task_id} from the Context of "${targetTitle}" (block ${ids}).`);
    }
  );
}
