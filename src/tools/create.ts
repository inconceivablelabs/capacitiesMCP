import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CapacitiesClient } from "../client/capacities.js";
import { validateUUID } from "../utils/validation.js";

export function setupCreationTools(server: McpServer, client: CapacitiesClient) {
  // Placeholder for future object creation tools
  // Currently Capacities API only supports weblinks and daily notes
  
  server.registerTool(
    "create_structured_note",
    {
      title: "Create Structured Note Template",
      description: "Create a structured note template in daily notes",
      inputSchema: {
        space_id: z.string().describe("Target space ID"),
        title: z.string().describe("Note title"),
        template: z.enum(["meeting", "daily-reflection", "task-list", "research"]).default("daily-reflection").describe("Template type: meeting, daily-reflection, task-list, research"),
        content: z.string().optional().describe("Additional content")
      }
    },
    async ({ space_id, title, template, content }) => {
      console.error("DEBUG: create_structured_note called with:", { space_id, title, template, content });
      
      if (!validateUUID(space_id)) {
        throw new Error("Invalid space ID format");
      }

      try {
        // Create structured content based on template
        let structuredContent = `# ${title}\n\n`;
        
        switch (template) {
          case "meeting":
            structuredContent += `## Meeting Details
- Date: ${new Date().toISOString().split('T')[0]}
- Participants: 
- Purpose: 

## Agenda
1. 
2. 
3. 

## Action Items
- [ ] 
- [ ] 

## Next Steps
`;
            break;
          case "daily-reflection":
            structuredContent += `### Today's Accomplishments
- 
- 
- 

### Challenges Faced
- 
- 

### Tomorrow's Priorities
- [ ] 
- [ ] 
- [ ] 

### Insights & Learning
`;
            break;
          case "task-list":
            structuredContent += `## High Priority
- [ ] 
- [ ] 

## Medium Priority
- [ ] 
- [ ] 

## Low Priority
- [ ] 
- [ ] 

## Completed Today
- [x] 
`;
            break;
          case "research":
            structuredContent += `## Research Topic
${title}

## Key Questions
- 
- 
- 

## Sources
1. 
2. 
3. 

## Findings
### Key Insights
- 
- 

### Supporting Evidence
- 
- 

## Next Research Steps
- [ ] 
- [ ] 
`;
            break;
        }

        if (content) {
          structuredContent += `\n## Additional Notes\n${content}\n`;
        }

        // Save to daily note
        console.error("DEBUG: Attempting to save to daily note...");
        const result = await client.saveToDailyNote({
          spaceId: space_id,
          content: structuredContent,
          noTimestamp: false
        });

        console.error("DEBUG: Daily note save result:", result);

        return {
          content: [{
            type: "text",
            text: `✅ Created structured ${template} note "${title}" in your daily notes for space ${space_id}\n\nContent preview:\n${structuredContent.slice(0, 200)}...`
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `❌ Failed to create structured note: ${error instanceof Error ? error.message : String(error)}`
          }],
          isError: true
        };
      }
    }
  );
}