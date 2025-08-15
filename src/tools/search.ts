import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CapacitiesClient } from "../client/capacities.js";
import { validateUUID } from "../utils/validation.js";

export function setupSearchTools(server: McpServer, client: CapacitiesClient) {
  // Search content tool
  server.registerTool(
    "search_content",
    {
      title: "Search Capacities Content",
      description: "Search for content across your Capacities spaces using keywords",
      inputSchema: {
        query: z.string().describe("Search query or keywords"),
        space_id: z.string().optional().describe("Specific space to search in (optional)"),
        mode: z.enum(["fullText", "title"]).default("fullText").describe("Search mode"),
        objectTypes: z.array(z.string()).optional().describe("Filter by specific object types")
      }
    },
    async ({ query, space_id, mode, objectTypes }) => {
      console.error("DEBUG: search_content called with:", { query, space_id, mode, objectTypes });
      
      // Validation
      if (!query || typeof query !== "string") {
        throw new Error("Query is required and must be a string");
      }

      if (space_id && !validateUUID(space_id)) {
        throw new Error("Invalid space ID format");
      }

      try {
        const spaces = await client.getSpaces();
        const searchSpaces = space_id ? [space_id] : spaces.map(s => s.id);
        
        const results = await client.searchContent({
          query,
          spaceIds: searchSpaces,
          mode: mode || "fullText",
          structureIds: objectTypes
        });

        if (results.length === 0) {
          return {
            content: [{
              type: "text",
              text: `No results found for "${query}"`
            }]
          };
        }

        const formattedResults = results.map(result => {
          const highlights = result.highlights
            .map(h => h.snippets.join(" "))
            .join("\n");
          
          return `**${result.title}**\nID: ${result.id}\nType: ${result.structureId}\n\nHighlights:\n${highlights}\n`;
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
      console.error("DEBUG: list_spaces called");
      
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
      title: "Get Space Information",
      description: "Get detailed information about a specific Capacities space",
      inputSchema: {
        space_id: z.string().describe("The ID of the space")
      }
    },
    async ({ space_id }) => {
      console.error("DEBUG: get_space_info called with space_id:", space_id);
      
      if (!space_id || !validateUUID(space_id)) {
        throw new Error(`Invalid space ID: ${space_id}`);
      }

      try {
        const spaceInfo = await client.getSpaceInfo(space_id);
        
        const structureList = spaceInfo.structures.map(structure => {
          const properties = structure.propertyDefinitions
            .map(prop => `- ${prop.name} (${prop.dataType})`)
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