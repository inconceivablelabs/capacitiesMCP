// File: src/tools/content-analysis.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CapacitiesClient } from "../client/capacities.js";

export function setupAnalysisTools(server: McpServer, client: CapacitiesClient) {
  // Content statistics and insights
  server.registerTool(
    "analyze_content_patterns",
    {
      title: "Analyze Content Patterns",
      description: "Analyze patterns in your Capacities content",
      inputSchema: {
        space_id: z.string().optional().describe("Specific space to analyze (leave empty for all spaces)"),
        analysisType: z.enum(["overview", "tags", "types", "activity"]).default("overview").describe("Type of analysis: overview (general stats), tags (tag usage), types (object types), activity (recent activity)"),
        timeRange: z.enum(["week", "month", "quarter", "year"]).default("month").describe("Time period to analyze: week (7 days), month (30 days), quarter (90 days), year (365 days)")
      }
    },
    async ({ space_id, analysisType, timeRange }) => {
      try {
        const spaces = await client.getSpaces();
        const targetSpaces = space_id ? [space_id] : spaces.map(s => s.id);
        
        const analysis = await performContentAnalysis(targetSpaces, analysisType, client, timeRange);
        
        return {
          content: [{
            type: "text",
            text: formatAnalysisResults(analysis, analysisType)
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Analysis failed: ${error instanceof Error ? error.message : String(error)}`
          }],
          isError: true
        };
      }
    }
  );

  // Find gaps in knowledge
  server.tool(
    "identify_knowledge_gaps",
    {
      title: "Identify Knowledge Gaps",
      description: "Find topics that might be missing or underdeveloped",
      inputSchema: {
        space_id: z.string().uuid(),
        domain: z.string().describe("Domain or subject area to analyze")
      }
    },
    async ({ space_id, domain }) => {
      try {
        // Search for content related to the domain
        const domainContent = await client.searchContent({
          query: domain,
          spaceIds: [space_id],
          mode: "fullText"
        });
        
        const gaps = analyzeKnowledgeGaps(domainContent, domain);
        
        return {
          content: [{
            type: "text",
            text: formatKnowledgeGaps(gaps, domain)
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Gap analysis failed: ${error instanceof Error ? error.message : String(error)}`
          }],
          isError: true
        };
      }
    }
  );
}

async function performContentAnalysis(
  spaceIds: string[], 
  analysisType: "overview" | "tags" | "types" | "activity",
  client: CapacitiesClient,
  timeRange?: string
): Promise<any> {
  const analysis: any = {};
  
  // Get space information for all target spaces
  const spaceInfoPromises = spaceIds.map(id => client.getSpaceInfo(id));
  const spaceInfos = await Promise.all(spaceInfoPromises);
  
  switch (analysisType) {
    case "overview":
      analysis.totalSpaces = spaceIds.length;
      analysis.totalStructures = spaceInfos.reduce((sum, info) => sum + info.structures.length, 0);
      analysis.structureBreakdown = aggregateStructures(spaceInfos);
      break;
      
    case "types":
      analysis.objectTypes = aggregateObjectTypes(spaceInfos);
      break;
      
    case "tags":
      // This would require additional API calls to get actual content
      analysis.message = "Tag analysis requires additional API endpoints not yet available";
      break;
      
    case "activity":
      analysis.message = "Activity analysis requires temporal data not yet available in API";
      break;
  }
  
  return analysis;
}

function aggregateStructures(spaceInfos: any[]): Record<string, number> {
  const breakdown: Record<string, number> = {};
  
  for (const info of spaceInfos) {
    for (const structure of info.structures) {
      breakdown[structure.title] = (breakdown[structure.title] || 0) + 1;
    }
  }
  
  return breakdown;
}

function aggregateObjectTypes(spaceInfos: any[]): any {
  const types: Record<string, any> = {};
  
  for (const info of spaceInfos) {
    for (const structure of info.structures) {
      if (!types[structure.title]) {
        types[structure.title] = {
          count: 0,
          properties: new Set(),
          collections: 0
        };
      }
      
      types[structure.title].count += 1;
      types[structure.title].collections += structure.collections.length;
      
      for (const prop of structure.propertyDefinitions) {
        types[structure.title].properties.add(prop.name);
      }
    }
  }
  
  // Convert Sets to arrays for serialization
  for (const type of Object.values(types) as any[]) {
    type.properties = Array.from(type.properties);
  }
  
  return types;
}

function analyzeKnowledgeGaps(content: any[], domain: string): string[] {
  // Simple gap analysis based on common knowledge areas
  const commonAreas = getCommonKnowledgeAreas(domain);
  const coveredAreas = extractCoveredAreas(content);
  
  return commonAreas.filter(area => !coveredAreas.includes(area.toLowerCase()));
}

function getCommonKnowledgeAreas(domain: string): string[] {
  const domainAreas: Record<string, string[]> = {
    "programming": ["algorithms", "data structures", "design patterns", "testing", "deployment", "security"],
    "business": ["strategy", "marketing", "finance", "operations", "hr", "legal"],
    "research": ["methodology", "literature review", "data collection", "analysis", "presentation", "ethics"],
    "project": ["planning", "execution", "monitoring", "risk management", "stakeholders", "communication"]
  };
  
  return domainAreas[domain.toLowerCase()] || [];
}

function extractCoveredAreas(content: any[]): string[] {
  const areas: string[] = [];
  
  for (const item of content) {
    const text = `${item.title} ${item.highlights.map((h: any) => h.snippets.join(' ')).join(' ')}`.toLowerCase();
    
    // Extract potential topic areas from content
    const words = text.match(/\b\w{4,}\b/g) || [];
    areas.push(...words);
  }
  
  return [...new Set(areas)];
}

function formatAnalysisResults(analysis: any, type: string): string {
  let result = `📊 Content Analysis Report - ${type.toUpperCase()}\n\n`;
  
  switch (type) {
    case "overview":
      result += `**Total Spaces:** ${analysis.totalSpaces}\n`;
      result += `**Total Object Types:** ${analysis.totalStructures}\n\n`;
      result += `**Structure Distribution:**\n`;
      for (const [name, count] of Object.entries(analysis.structureBreakdown)) {
        result += `- ${name}: ${count}\n`;
      }
      break;
      
    case "types":
      result += `**Object Type Details:**\n\n`;
      for (const [typeName, typeInfo] of Object.entries(analysis.objectTypes)) {
        const info = typeInfo as any;
        result += `**${typeName}**\n`;
        result += `- Instances: ${info.count}\n`;
        result += `- Collections: ${info.collections}\n`;
        result += `- Properties: ${info.properties.join(', ')}\n\n`;
      }
      break;
      
    default:
      result += analysis.message || "Analysis completed";
      break;
  }
  
  return result;
}

function formatKnowledgeGaps(gaps: string[], domain: string): string {
  if (gaps.length === 0) {
    return `✅ Your knowledge coverage for "${domain}" appears comprehensive! No obvious gaps detected.`;
  }
  
  let result = `🔍 Knowledge Gap Analysis for "${domain}"\n\n`;
  result += `**Potential areas to explore:**\n`;
  
  for (const gap of gaps) {
    result += `- ${gap.charAt(0).toUpperCase() + gap.slice(1)}\n`;
  }
  
  result += `\n💡 Consider creating content or research in these areas to strengthen your knowledge base.`;
  
  return result;
}