import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CapacitiesClient } from "../client/capacities.js";

export function setupSearchTools(server: McpServer, client: CapacitiesClient) {
  // Search content tool
  server.registerTool(
    "search_content",
    {
      title: "Search Capacities Content",
      description: "Search Capacities objects by title match in your space. Optionally scope by structureIds (from get_space_info) and cap results with limit.",
      inputSchema: {
        query: z.string().describe("Search query or keywords"),
        structureIds: z.array(z.string()).optional().describe("Optional structure IDs to scope the search to (from get_space_info)"),
        limit: z.number().int().positive().optional().describe("Max number of results")
      }
    },
    async ({ query, structureIds, limit }) => {
      // Validation
      if (!query || typeof query !== "string") {
        throw new Error("Query is required and must be a string");
      }

      try {
        const results = await client.searchContent({ query, structureIds, limit });

        if (results.length === 0) {
          return {
            content: [{
              type: "text",
              text: `No results found for "${query}"`
            }]
          };
        }

        const formattedResults = results.map(result => {
          return `**${result.title}**\nID: ${result.id}\nType: ${result.structureId}\n`;
        }).join("\n---\n");

        return {
          content: [{
            type: "text",
            text: `Found ${results.length} results for "${query}":\n\n${formattedResults}`
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Search failed: ${error instanceof Error ? error.message : String(error)}`
          }],
          isError: true
        };
      }
    }
  );

  // List spaces tool
  server.registerTool(
    "list_spaces",
    {
      title: "List Capacities Spaces",
      description: "Get a list of all your Capacities spaces",
      inputSchema: {}
    },
    async () => {
      try {
        const spaces = await client.getSpaces();

        const spaceList = spaces.map(space =>
          `**${space.title}**\nID: ${space.id}\nIcon: ${space.icon.val}`
        ).join("\n\n");

        return {
          content: [{
            type: "text",
            text: `Your Capacities Spaces:\n\n${spaceList}`
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Failed to retrieve spaces: ${error instanceof Error ? error.message : String(error)}`
          }],
          isError: true
        };
      }
    }
  );

  // Get space information tool
  server.registerTool(
    "get_space_info",
    {
      title: "Get Space Structures",
      description: "Get the structures (object types), their writable properties, and collections for your Capacities space.",
      inputSchema: {}
    },
    async () => {
      try {
        const spaceInfo = await client.getSpaceInfo();

        const structureList = spaceInfo.structures.map(structure => {
          const properties = structure.propertyDefinitions
            .map(prop => {
              // Base line carries the prop-def id — the tool's properties/labels/
              // relations maps are keyed by it, so the LLM needs it to compose calls.
              let line = `- ${prop.name} (${prop.type}, id=${prop.id})`;

              // label props: surface selectable option NAMES + multi-select flag.
              if (prop.type === "label" && prop.labelSet && prop.labelSet.length > 0) {
                const optionNames = prop.labelSet.map(o => o.name).join(", ");
                line += ` options: ${optionNames}`;
                if (prop.multiple) line += " (multi-select)";
              }

              // entity props: surface the structure ids that may be linked.
              if (prop.type === "entity" && prop.allowedStructures && prop.allowedStructures.length > 0) {
                line += ` links: ${prop.allowedStructures.join(", ")}`;
              }

              if (!prop.writable) line += " [read-only]";
              return line;
            })
            .join("\n");

          const collections = structure.collections
            .map(col => `- ${col.title}`)
            .join("\n");

          return `**${structure.title}** (${structure.pluralName})\nID: ${structure.id}\n\nProperties:\n${properties}\n\nCollections:\n${collections}`;
        }).join("\n\n---\n\n");

        return {
          content: [{
            type: "text",
            text: `Space Information:\n\n${structureList}`
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Failed to get space info: ${error instanceof Error ? error.message : String(error)}`
          }],
          isError: true
        };
      }
    }
  );
}
