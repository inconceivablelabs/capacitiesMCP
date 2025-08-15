// File: src/tools/smart-search.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CapacitiesClient } from "../client/capacities.js";

export function setupSmartSearchTools(server: McpServer, client: CapacitiesClient) {
  // Semantic search with context awareness
  server.registerTool(
    "smart_search",
    {
      title: "Smart Search with Context",
      description: "Intelligent search that understands context and relationships",
      inputSchema: {
        query: z.string().describe("Natural language search query"),
        context: z.string().optional().describe("Additional context for the search"),
        includeRelated: z.boolean().default(true).describe("Include related content"),
        maxResults: z.number().int().min(1).max(50).default(10)
      }
    },
    async ({ query, context, includeRelated, maxResults }) => {
      try {
        // Enhanced search with query expansion
        const expandedQueries = await expandSearchQuery(query, context);
        const spaces = await client.getSpaces();
        
        const searchPromises = expandedQueries.map(expandedQuery =>
          client.searchContent({
            query: expandedQuery,
            spaceIds: spaces.map(s => s.id),
            mode: "fullText"
          })
        );
        
        const results = await Promise.all(searchPromises);
        const flatResults = results.flat();
        
        // Remove duplicates and rank by relevance
        const uniqueResults = deduplicateResults(flatResults);
        const rankedResults = rankByRelevance(uniqueResults, query);
        
        if (includeRelated) {
          // Find related content based on tags and structure
          const relatedContent = await findRelatedContent(rankedResults.slice(0, 3), client);
          rankedResults.push(...relatedContent);
        }
        
        const topResults = rankedResults.slice(0, maxResults);
        
        return {
          content: [{
            type: "text",
            text: formatSmartSearchResults(topResults, query)
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Smart search failed: ${error instanceof Error ? error.message : String(error)}`
          }],
          isError: true
        };
      }
    }
  );

  // Search with filters and advanced options
  server.registerTool(
    "advanced_search",
    {
      title: "Advanced Search with Filters",
      description: "Search with date ranges, object types, and other filters",
      inputSchema: {
        query: z.string().describe("Search query"),
        space_id: z.string().uuid().optional(),
        objectTypes: z.array(z.string()).optional(),
        tags: z.array(z.string()).optional(),
        dateRange: z.object({
          start: z.string().optional().describe("Start date (YYYY-MM-DD)"),
          end: z.string().optional().describe("End date (YYYY-MM-DD)")
        }).optional(),
        sortBy: z.enum(["relevance", "date", "title"]).default("relevance")
      }
    },
    async ({ query, space_id, objectTypes, tags, dateRange, sortBy }) => {
      try {
        const spaces = await client.getSpaces();
        const searchSpaces = space_id ? [space_id] : spaces.map(s => s.id);
        
        let results = await client.searchContent({
          query,
          spaceIds: searchSpaces,
          mode: "fullText",
          structureIds: objectTypes
        });
        
        // Apply additional filters (when API supports them)
        results = await applyAdvancedFilters(results, { tags, dateRange }, client);
        
        // Sort results
        results = sortResults(results, sortBy);
        
        return {
          content: [{
            type: "text",
            text: formatAdvancedSearchResults(results, { query, objectTypes, tags, dateRange })
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Advanced search failed: ${error instanceof Error ? error.message : String(error)}`
          }],
          isError: true
        };
      }
    }
  );
}

// Helper functions for smart search
async function expandSearchQuery(query: string, context?: string): Promise<string[]> {
  // Simple query expansion - in production, this could use AI/NLP
  const baseQueries = [query];
  
  if (context) {
    baseQueries.push(`${query} ${context}`);
  }
  
  // Add synonyms and related terms
  const synonyms = findSynonyms(query);
  baseQueries.push(...synonyms);
  
  return baseQueries;
}

function findSynonyms(query: string): string[] {
  // Simple synonym mapping - extend with proper NLP library
  const synonymMap: Record<string, string[]> = {
    "meeting": ["discussion", "call", "session", "standup"],
    "project": ["initiative", "work", "task", "effort"],
    "note": ["notes", "memo", "documentation", "record"],
    "idea": ["concept", "thought", "brainstorm", "insight"]
  };
  
  const words = query.toLowerCase().split(/\s+/);
  const expandedQueries: string[] = [];
  
  for (const word of words) {
    if (synonymMap[word]) {
      for (const synonym of synonymMap[word]) {
        expandedQueries.push(query.replace(new RegExp(word, 'gi'), synonym));
      }
    }
  }
  
  return expandedQueries;
}

function deduplicateResults(results: any[]): any[] {
  const seen = new Set<string>();
  return results.filter(result => {
    if (seen.has(result.id)) {
      return false;
    }
    seen.add(result.id);
    return true;
  });
}

function rankByRelevance(results: any[], query: string): any[] {
  return results.sort((a, b) => {
    const scoreA = calculateRelevanceScore(a, query);
    const scoreB = calculateRelevanceScore(b, query);
    return scoreB - scoreA;
  });
}

function calculateRelevanceScore(result: any, query: string): number {
  let score = 0;
  const queryLower = query.toLowerCase();
  const titleLower = result.title.toLowerCase();
  
  // Title match bonus
  if (titleLower.includes(queryLower)) {
    score += 10;
  }
  
  // Exact title match super bonus
  if (titleLower === queryLower) {
    score += 20;
  }
  
  // Highlight count
  score += result.highlights.length * 2;
  
  // Snippet relevance
  for (const highlight of result.highlights) {
    score += highlight.snippets.filter((snippet: string) => 
      snippet.toLowerCase().includes(queryLower)
    ).length;
  }
  
  return score;
}

async function findRelatedContent(topResults: any[], client: CapacitiesClient): Promise<any[]> {
  // Find content related to top results by searching for similar terms
  const relatedContent: any[] = [];
  
  for (const result of topResults.slice(0, 3)) {
    try {
      // Extract key terms from title for related search
      const keyTerms = extractKeyTerms(result.title);
      if (keyTerms.length > 0) {
        const relatedResults = await client.searchContent({
          query: keyTerms.join(" "),
          spaceIds: [result.spaceId],
          mode: "fullText"
        });
        
        // Filter out the original result and add new ones
        const newResults = relatedResults.filter(r => r.id !== result.id);
        relatedContent.push(...newResults.slice(0, 2));
      }
    } catch (error) {
      // Ignore errors for individual related searches
      continue;
    }
  }
  
  return deduplicateResults(relatedContent);
}

function extractKeyTerms(title: string): string[] {
  // Simple key term extraction - enhance with proper NLP
  const words = title.toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(word => word.length > 3)
    .filter(word => !isStopWord(word));
  
  return words.slice(0, 3); // Take top 3 terms
}

function isStopWord(word: string): boolean {
  const stopWords = new Set([
    'the', 'and', 'but', 'for', 'are', 'with', 'this', 'that', 'from', 'they', 'have', 'been'
  ]);
  return stopWords.has(word);
}

async function applyAdvancedFilters(
  results: any[], 
  filters: { tags?: string[], dateRange?: { start?: string, end?: string } },
  client: CapacitiesClient
): Promise<any[]> {
  // Note: This is a placeholder since the current API doesn't support advanced filtering
  // In the future, this could filter results based on metadata
  
  let filteredResults = results;
  
  // TODO: Implement tag filtering when API supports it
  if (filters.tags && filters.tags.length > 0) {
    // filteredResults = results.filter(result => 
    //   filters.tags!.some(tag => result.tags?.includes(tag))
    // );
  }
  
  // TODO: Implement date filtering when API supports it
  if (filters.dateRange) {
    // filteredResults = filteredResults.filter(result => {
    //   const resultDate = new Date(result.createdAt);
    //   // Apply date range logic
    // });
  }
  
  return filteredResults;
}

function sortResults(results: any[], sortBy: "relevance" | "date" | "title"): any[] {
  return results.sort((a, b) => {
    switch (sortBy) {
      case "title":
        return a.title.localeCompare(b.title);
      case "date":
        // Placeholder - would need date field from API
        return 0;
      case "relevance":
      default:
        return b.highlights.length - a.highlights.length;
    }
  });
}

function formatSmartSearchResults(results: any[], query: string): string {
  if (results.length === 0) {
    return `No results found for "${query}"`;
  }
  
  let output = `🔍 Smart Search Results for "${query}" (${results.length} found)\n\n`;
  
  results.forEach((result, index) => {
    const snippets = result.highlights
      .map((h: any) => h.snippets.join(" "))
      .join("\n")
      .substring(0, 200) + "...";
    
    output += `${index + 1}. **${result.title}**\n`;
    output += `   Type: ${result.structureId}\n`;
    output += `   Preview: ${snippets}\n`;
    output += `   ID: ${result.id}\n\n`;
  });
  
  return output;
}

function formatAdvancedSearchResults(
  results: any[], 
  filters: { query: string, objectTypes?: string[], tags?: string[], dateRange?: any }
): string {
  let output = `🔎 Advanced Search Results\n`;
  output += `Query: "${filters.query}"\n`;
  
  if (filters.objectTypes?.length) {
    output += `Object Types: ${filters.objectTypes.join(", ")}\n`;
  }
  if (filters.tags?.length) {
    output += `Tags: ${filters.tags.join(", ")}\n`;
  }
  if (filters.dateRange?.start || filters.dateRange?.end) {
    output += `Date Range: ${filters.dateRange.start || "∞"} to ${filters.dateRange.end || "∞"}\n`;
  }
  
  output += `\nResults (${results.length}):\n\n`;
  
  results.forEach((result, index) => {
    output += `${index + 1}. **${result.title}** (${result.structureId})\n`;
    output += `   ID: ${result.id}\n\n`;
  });
  
  return output;
}
