// File: src/tools/workflow-automation.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CapacitiesClient } from "../client/capacities.js";

export function setupWorkflowTools(server: McpServer, client: CapacitiesClient) {
  // Weekly review workflow
  server.tool(
    "create_weekly_review",
    {
      title: "Create Weekly Review",
      description: "Generate a weekly review template in daily notes",
      inputSchema: z.object({
        spaceId: z.string().uuid().describe("Space for the review"),
        weekOf: z.string().optional().describe("Week of date (YYYY-MM-DD)"),
        includeAccomplishments: z.boolean().default(true),
        includeGoals: z.boolean().default(true),
        includeLessons: z.boolean().default(true)
      })
    },
    async ({ spaceId, weekOf, includeAccomplishments, includeGoals, includeLessons }) => {
      try {
        const date = weekOf ? new Date(weekOf) : new Date();
        const weekStart = getWeekStart(date);
        const weekEnd = getWeekEnd(date);
        
        let reviewContent = `# Weekly Review - ${formatDate(weekStart)} to ${formatDate(weekEnd)}\n\n`;
        
        if (includeAccomplishments) {
          reviewContent += `## 🎉 Accomplishments\n\n- \n- \n- \n\n`;
        }
        
        if (includeGoals) {
          reviewContent += `## 🎯 Goals for Next Week\n\n- [ ] \n- [ ] \n- [ ] \n\n`;
        }
        
        if (includeLessons) {
          reviewContent += `## 📚 Lessons Learned\n\n- \n- \n\n`;
        }
        
        reviewContent += `## 📊 Metrics\n\n`;
        reviewContent += `- Energy Level: /10\n`;
        reviewContent += `- Productivity: /10\n`;
        reviewContent += `- Focus: /10\n\n`;
        
        reviewContent += `## 🔍 Reflection Questions\n\n`;
        reviewContent += `1. What went well this week?\n\n`;
        reviewContent += `2. What could be improved?\n\n`;
        reviewContent += `3. What am I grateful for?\n\n`;
        
        await client.saveToDailyNote({
          spaceId,
          content: reviewContent,
          noTimestamp: true
        });
        
        return {
          content: [{
            type: "text",
            text: `✅ Weekly review template created for week of ${formatDate(weekStart)}\n\nTemplate includes:\n${includeAccomplishments ? "✓ " : "✗ "}Accomplishments\n${includeGoals ? "✓ " : "✗ "}Goals\n${includeLessons ? "✓ " : "✗ "}Lessons Learned\n✓ Metrics\n✓ Reflection Questions`
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Failed to create weekly review: ${error instanceof Error ? error.message : String(error)}`
          }],
          isError: true
        };
      }
    }
  );

  // Meeting notes workflow
  server.tool(
    "create_meeting_notes",
    {
      title: "Create Meeting Notes Template",
      description: "Create a structured meeting notes template",
      inputSchema: z.object({
        spaceId: z.string().uuid(),
        meetingTitle: z.string().describe("Title of the meeting"),
        attendees: z.array(z.string()).optional().describe("List of attendees"),
        agenda: z.array(z.string()).optional().describe("Agenda items"),
        duration: z.string().optional().describe("Meeting duration"),
        meetingDate: z.string().optional().describe("Meeting date (YYYY-MM-DD)")
      })
    },
    async ({ spaceId, meetingTitle, attendees, agenda, duration, meetingDate }) => {
      try {
        const date = meetingDate || new Date().toISOString().split('T')[0];
        
        let notesContent = `# ${meetingTitle}\n\n`;
        notesContent += `**Date:** ${date}\n`;
        notesContent += `**Duration:** ${duration || "TBD"}\n`;
        
        if (attendees && attendees.length > 0) {
          notesContent += `**Attendees:**\n${attendees.map(a => `- ${a}`).join('\n')}\n\n`;
        }
        
        if (agenda && agenda.length > 0) {
          notesContent += `## 📋 Agenda\n\n${agenda.map((item, i) => `${i + 1}. ${item}`).join('\n')}\n\n`;
        }
        
        notesContent += `## 💬 Discussion\n\n`;
        notesContent += `### Key Points\n- \n\n`;
        notesContent += `### Decisions Made\n- \n\n`;
        notesContent += `### Questions Raised\n- \n\n`;
        
        notesContent += `## ✅ Action Items\n\n`;
        notesContent += `- [ ] [Person] - Action item description\n`;
        notesContent += `- [ ] [Person] - Action item description\n\n`;
        
        notesContent += `## 🔄 Follow-up\n\n`;
        notesContent += `- Next meeting: \n`;
        notesContent += `- Next steps: \n\n`;
        
        notesContent += `## 📎 Resources\n\n`;
        notesContent += `- \n`;
        
        await client.saveToDailyNote({
          spaceId,
          content: notesContent,
          noTimestamp: false
        });
        
        return {
          content: [{
            type: "text",
            text: `✅ Meeting notes template created for "${meetingTitle}"\n\nDate: ${date}\nAttendees: ${attendees?.length || 0}\nAgenda items: ${agenda?.length || 0}\n\nTemplate includes structured sections for discussion, decisions, action items, and follow-up.`
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Failed to create meeting notes: ${error instanceof Error ? error.message : String(error)}`
          }],
          isError: true
        };
      }
    }
  );

  // Research capture workflow
  server.tool(
    "capture_research",
    {
      title: "Capture Research Finding",
      description: "Save research findings with proper structure and metadata",
      inputSchema: z.object({
        spaceId: z.string().uuid(),
        source: z.string().describe("Source URL or reference"),
        title: z.string().describe("Title of the research"),
        keyFindings: z.array(z.string()).describe("Key findings or insights"),
        tags: z.array(z.string()).optional().describe("Research tags"),
        category: z.string().optional().describe("Research category"),
        summary: z.string().optional().describe("Research summary"),
        questions: z.array(z.string()).optional().describe("Follow-up questions")
      })
    },
    async ({ spaceId, source, title, keyFindings, tags, category, summary, questions }) => {
      try {
        // Save as weblink if it's a URL
        if (source.startsWith('http')) {
          const result = await client.saveWeblink({
            spaceId,
            url: source,
            title,
            description: summary,
            tags: tags ? [...tags, 'research', category].filter(Boolean) : ['research'],
            notes: createResearchNotes(keyFindings, questions)
          });
          
          return {
            content: [{
              type: "text",
              text: `✅ Research captured as weblink!\n\n**Title:** ${title}\n**Source:** ${source}\n**Key Findings:** ${keyFindings.length}\n**Tags:** ${result.tags.join(', ')}\n**ID:** ${result.id}`
            }]
          };
        } else {
          // Save as daily note entry
          const researchContent = createResearchDailyNote(title, source, keyFindings, summary, questions, tags, category);
          
          await client.saveToDailyNote({
            spaceId,
            content: researchContent,
            noTimestamp: false
          });
          
          return {
            content: [{
              type: "text",
              text: `✅ Research captured in daily note!\n\n**Title:** ${title}\n**Source:** ${source}\n**Key Findings:** ${keyFindings.length}\n**Category:** ${category || 'General'}`
            }]
          };
        }
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Failed to capture research: ${error instanceof Error ? error.message : String(error)}`
          }],
          isError: true
        };
      }
    }
  );
}

// Helper functions
function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Adjust when day is Sunday
  return new Date(d.setDate(diff));
}

function getWeekEnd(date: Date): Date {
  const start = getWeekStart(date);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return end;
}

function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

function createResearchNotes(keyFindings: string[], questions?: string[]): string {
  let notes = `## 🔍 Key Findings\n\n${keyFindings.map(f => `- ${f}`).join('\n')}\n\n`;
  
  if (questions && questions.length > 0) {
    notes += `## ❓ Follow-up Questions\n\n${questions.map(q => `- ${q}`).join('\n')}\n\n`;
  }
  
  notes += `## 📝 Research Notes\n\n_Add additional notes here..._`;
  
  return notes;
}

function createResearchDailyNote(
  title: string,
  source: string,
  keyFindings: string[],
  summary?: string,
  questions?: string[],
  tags?: string[],
  category?: string
): string {
  let content = `## 📚 Research: ${title}\n\n`;
  content += `**Source:** ${source}\n`;
  content += `**Category:** ${category || 'General'}\n`;
  
  if (tags && tags.length > 0) {
    content += `**Tags:** ${tags.map(t => `#${t}`).join(' ')}\n`;
  }
  
  content += `\n`;
  
  if (summary) {
    content += `**Summary:** ${summary}\n\n`;
  }
  
  content += `### Key Findings\n${keyFindings.map(f => `- ${f}`).join('\n')}\n\n`;
  
  if (questions && questions.length > 0) {
    content += `### Follow-up Questions\n${questions.map(q => `- ${q}`).join('\n')}\n\n`;
  }
  
  return content;
}
