# Capacities MCP Server: Technical Plan & Architecture

## Overview

This document outlines the plan for creating a Model Context Protocol (MCP) server that integrates Claude with Capacities, enabling seamless knowledge management workflows through natural language interactions.

## Project Goals

### Primary Objectives
- **Content Discovery**: Search and retrieve content from Capacities spaces
- **Content Creation**: Create new objects, save weblinks, and add to daily notes
- **Knowledge Navigation**: Browse structures, collections, and relationships
- **Task Management**: Add tasks and reminders to daily notes
- **Information Retrieval**: Query specific objects and their properties

### Success Criteria
- Claude can search across all Capacities content
- Claude can create new objects in appropriate structures
- Claude can save external links with proper metadata
- Claude can add timestamped entries to daily notes
- All operations respect Capacities' rate limits and data model

## Current Capacities API Capabilities

Based on the OpenAPI specification, the Capacities API (Beta) provides:

### Available Endpoints
1. **GET `/spaces`** - Retrieve user's personal spaces
2. **GET `/space-info`** - Get structures (object types) and collections for a space
3. **POST `/search`** - Search content (full-text or title-based)
4. **POST `/save-weblink`** - Save URLs as weblink objects
5. **POST `/save-to-daily-note`** - Add content to today's daily note

### Authentication & Limits
- **Authentication**: Bearer token (obtained from Capacities desktop app)
- **Rate Limits**: 
  - General endpoints: 5 requests/60s
  - Search: 120 requests/60s  
  - Save weblink: 10 requests/60s
- **Security**: HTTPS only, token-based access

## Technical Architecture

### MCP Server Structure
```
capacities-mcp-server/
├── src/
│   ├── index.ts              # Main server entry point
│   ├── client/
│   │   ├── capacities.ts     # Capacities API client
│   │   └── types.ts          # TypeScript definitions
│   ├── tools/
│   │   ├── search.ts         # Search content tools
│   │   ├── create.ts         # Content creation tools
│   │   ├── weblink.ts        # Weblink management
│   │   └── daily-note.ts     # Daily note operations
│   ├── resources/
│   │   ├── spaces.ts         # Expose spaces as resources
│   │   └── structures.ts     # Expose object types
│   ├── utils/
│   │   ├── rate-limit.ts     # Rate limiting utilities
│   │   ├── validation.ts     # Input validation
│   │   └── formatting.ts     # Response formatting
│   └── config/
│       └── server.ts         # Server configuration
├── package.json
├── tsconfig.json
└── README.md
```

### Core Dependencies
```json
{
  "@modelcontextprotocol/sdk": "^1.17.2",
  "axios": "^1.6.0",
  "zod": "^3.22.0",
  "dotenv": "^16.3.0"
}
```

## MCP Server Implementation Plan

### Phase 1: Core Infrastructure (Week 1)

#### 1.1 Project Setup
- Initialize TypeScript project with MCP SDK
- Configure build pipeline and development environment
- Set up environment variable management
- Implement Capacities API client with proper authentication

#### 1.2 Basic Server Structure
- Create MCP server with stdio transport
- Implement error handling and logging
- Add rate limiting to respect API constraints
- Create configuration management

#### 1.3 Authentication & Connection
- Secure token storage and validation
- Space discovery and caching
- Health check functionality

### Phase 2: Search & Discovery Tools (Week 2)

#### 2.1 Search Tools
```typescript
// Tool: search_content
{
  name: "search_content",
  description: "Search for content across Capacities spaces",
  inputSchema: {
    query: z.string().describe("Search query"),
    spaceId: z.string().uuid().optional().describe("Specific space to search"),
    mode: z.enum(["fullText", "title"]).default("fullText"),
    objectTypes: z.array(z.string()).optional().describe("Filter by object types")
  }
}
```

#### 2.2 Browse Tools
```typescript
// Tool: list_spaces
{
  name: "list_spaces",
  description: "List all available Capacities spaces",
  inputSchema: {}
}

// Tool: get_space_info
{
  name: "get_space_info", 
  description: "Get structures and collections for a space",
  inputSchema: {
    spaceId: z.string().uuid().describe("Space ID")
  }
}
```

### Phase 3: Content Creation Tools (Week 3)

#### 3.1 Daily Note Integration
```typescript
// Tool: add_to_daily_note
{
  name: "add_to_daily_note",
  description: "Add content to today's daily note",
  inputSchema: {
    spaceId: z.string().uuid().describe("Target space"),
    content: z.string().describe("Markdown content to add"),
    noTimestamp: z.boolean().default(false)
  }
}
```

#### 3.2 Weblink Management
```typescript
// Tool: save_weblink
{
  name: "save_weblink",
  description: "Save a URL as a weblink object in Capacities",
  inputSchema: {
    spaceId: z.string().uuid().describe("Target space"),
    url: z.string().url().describe("URL to save"),
    title: z.string().optional().describe("Custom title"),
    description: z.string().optional().describe("Custom description"),
    tags: z.array(z.string()).optional().describe("Tags to apply"),
    notes: z.string().optional().describe("Additional notes")
  }
}
```

### Phase 4: Advanced Features (Week 4)

#### 4.1 Resource Providers
Expose Capacities data as MCP resources that Claude can reference:

```typescript
// Resource: spaces
// URI: capacities://spaces
// Provides list of all spaces with metadata

// Resource: space-structures  
// URI: capacities://spaces/{spaceId}/structures
// Provides object types and properties for a space
```

#### 4.2 Prompt Templates
Create reusable prompts for common Capacities workflows:

```typescript
// Prompt: daily_reflection
// Help user create structured daily reflection entries

// Prompt: meeting_notes
// Template for capturing meeting notes with standard structure

// Prompt: research_capture
// Template for saving research findings with proper tagging
```

## Technical Specifications

### Rate Limiting Strategy
```typescript
class RateLimiter {
  private limits = {
    general: { requests: 5, window: 60000 },
    search: { requests: 120, window: 60000 },
    weblink: { requests: 10, window: 60000 }
  };
  
  async checkLimit(endpoint: string): Promise<boolean> {
    // Implementation with sliding window
  }
}
```

### Error Handling
```typescript
enum CapacitiesError {
  AUTHENTICATION_FAILED = "AUTHENTICATION_FAILED",
  RATE_LIMIT_EXCEEDED = "RATE_LIMIT_EXCEEDED", 
  SPACE_NOT_FOUND = "SPACE_NOT_FOUND",
  INVALID_CONTENT = "INVALID_CONTENT"
}

class CapacitiesAPIError extends Error {
  constructor(
    public code: CapacitiesError,
    message: string,
    public details?: any
  ) {
    super(message);
  }
}
```

### Data Models
```typescript
interface CapacitiesSpace {
  id: string;
  title: string;
  icon: SpaceIcon;
}

interface CapacitiesStructure {
  id: string;
  title: string;
  pluralName: string;
  propertyDefinitions: PropertyDefinition[];
  labelColor: string;
  collections: Collection[];
}

interface SearchResult {
  id: string;
  spaceId: string;
  structureId: string;
  title: string;
  highlights: SearchHighlight[];
}
```

## Security Considerations

### Token Management
- Store API tokens securely using environment variables
- Implement token validation and refresh logic
- Never log or expose tokens in error messages

### Input Validation
- Validate all user inputs using Zod schemas
- Sanitize markdown content before sending to API
- Implement URL validation for weblink operations

### Rate Limiting
- Implement client-side rate limiting to prevent API errors
- Add exponential backoff for failed requests
- Cache responses where appropriate to reduce API calls

## Testing Strategy

### Unit Tests
- Test individual tools with mocked API responses
- Validate input schemas and error handling
- Test rate limiting logic

### Integration Tests
- Test against Capacities API in development environment
- Validate MCP protocol compliance
- Test Claude Desktop integration

### End-to-End Tests
- Complete workflow testing with real scenarios
- Performance testing under load
- Error recovery testing

## Deployment & Distribution

### Development Setup
```bash
# Environment variables
CAPACITIES_API_TOKEN=your_token_here
CAPACITIES_API_BASE_URL=https://api.capacities.io
MCP_SERVER_NAME=capacities-mcp-server
LOG_LEVEL=info
```

### Claude Desktop Configuration
```json
{
  "mcpServers": {
    "capacities": {
      "command": "node",
      "args": ["/path/to/capacities-mcp-server/dist/index.js"],
      "env": {
        "CAPACITIES_API_TOKEN": "your_token_here"
      }
    }
  }
}
```

### Distribution Options
1. **NPM Package**: Publish as installable npm package
2. **Binary Distribution**: Create standalone executables
3. **Docker Container**: Containerized deployment option
4. **GitHub Releases**: Pre-built binaries for major platforms

## Future Enhancements

### Phase 5: Advanced Features
- **Object Creation**: Create custom objects when API supports it
- **Property Updates**: Modify object properties and relationships
- **Collection Management**: Organize objects into collections
- **Tag Management**: Create and manage tag hierarchies

### Phase 6: Intelligence Layer
- **Content Suggestions**: AI-powered content recommendations
- **Auto-tagging**: Intelligent tag suggestions based on content
- **Relationship Discovery**: Find connections between objects
- **Template Generation**: Create custom object type templates

### Phase 7: Ecosystem Integration
- **Calendar Integration**: Connect with calendar APIs for meeting notes
- **Email Integration**: Save emails as objects with proper metadata
- **File Import**: Handle various file types (PDF, images, documents)
- **Export Capabilities**: Generate reports and summaries

## Success Metrics

### Technical Metrics
- API response time < 2 seconds for search operations
- 99.5% uptime for MCP server
- Zero data loss during operations
- Proper handling of all API rate limits

### User Experience Metrics
- Claude can successfully complete 95% of requested operations
- Average task completion time reduced by 60%
- User satisfaction score > 4.5/5
- Adoption rate > 70% among target users

## Dependency Strategy & Future Considerations

### Current Minimal Approach
The initial implementation uses only the MCP SDK dependency to minimize complexity and bundle size. This leverages:

- **Native Node.js fetch**: Built-in HTTP client (Node 18+)
- **TypeScript interfaces**: Compile-time type safety without runtime overhead
- **Simple validation functions**: Custom validation without schema libraries

### When to Reintroduce Dependencies

#### **Axios - HTTP Client Library**
**Reintroduce when you need:**

**Mid-term triggers (3-6 months):**
- **Large content uploads**: When Capacities adds file upload endpoints requiring progress tracking
- **Complex retry logic**: Exponential backoff, jitter, circuit breakers for reliability
- **Request/response transformation**: Custom data processing pipelines
- **Advanced timeout handling**: Per-request timeout configuration with abort controllers

**Long-term triggers (6+ months):**
- **Upload progress tracking**: Real-time progress for large file operations
- **Request interceptors**: Complex authentication flows or request modification
- **Response caching**: Sophisticated caching strategies with invalidation
- **Connection pooling**: High-throughput scenarios requiring connection management

**Benefits for large content scenarios:**
```typescript
// Future axios implementation for large uploads
const response = await this.client.post('/upload-document', formData, {
  timeout: 300000,  // 5 minute timeout for large files
  onUploadProgress: (progressEvent) => {
    const progress = (progressEvent.loaded / progressEvent.total) * 100;
    console.log(`Upload progress: ${progress.toFixed(2)}%`);
  },
  retry: {
    retries: 3,
    retryDelay: (retryCount) => Math.pow(2, retryCount) * 1000,
    retryCondition: (error) => error.response?.status >= 500
  }
});
```

#### **Zod - Schema Validation Library**
**Reintroduce when you need:**

**Triggers:**
- **Complex API responses**: When Capacities API becomes more sophisticated with nested data
- **Runtime data validation**: Protecting against malformed external data
- **API documentation generation**: Auto-generating docs from schemas
- **Schema evolution**: Managing API version compatibility with automatic migrations

**Example future use case:**
```typescript
// Complex object creation schema
const CreateObjectSchema = z.object({
  structureId: z.string().uuid(),
  properties: z.record(z.union([
    z.string(),
    z.number(),
    z.array(z.string()),
    z.object({
      type: z.enum(['reference', 'date', 'file']),
      value: z.any()
    })
  ])),
  relationships: z.array(z.object({
    targetId: z.string().uuid(),
    relationshipType: z.enum(['contains', 'references', 'depends_on'])
  })).optional()
});
```

#### **Additional Dependencies to Consider**

**Performance & Monitoring:**
- **pino**: Structured logging when debugging becomes complex
- **@opentelemetry/api**: Observability and performance monitoring
- **lru-cache**: Intelligent caching for frequently accessed data

**Content Processing:**
- **unified/remark**: Advanced markdown processing and transformation
- **sharp**: Image processing for media content handling
- **pdf-parse**: PDF content extraction for document analysis

**Development Quality:**
- **jest**: Comprehensive testing framework
- **eslint + prettier**: Code quality and formatting
- **husky**: Git hooks for quality gates

### Migration Strategy

When adding dependencies back:

1. **Gradual introduction**: Add one dependency at a time
2. **Feature flags**: Allow toggling between implementations
3. **Backward compatibility**: Maintain existing API interfaces
4. **Performance testing**: Benchmark before/after dependency addition
5. **Bundle analysis**: Monitor impact on final bundle size

```typescript
// Example feature flag approach
const useAdvancedHttpClient = process.env.USE_AXIOS === 'true';
const httpClient = useAdvancedHttpClient 
  ? new AxiosCapacitiesClient(config)
  : new FetchCapacitiesClient(config);
```

## Risk Assessment & Mitigation

### Technical Risks
- **API Changes**: Capacities API is in beta and subject to change
  - *Mitigation*: Implement version detection and graceful degradation
- **Rate Limiting**: API limits may impact user experience
  - *Mitigation*: Implement intelligent caching and batching
- **Authentication**: Token expiration or revocation
  - *Mitigation*: Implement token refresh and user notification
- **Dependency Creep**: Adding dependencies without clear justification
  - *Mitigation*: Document clear triggers for dependency reintroduction

### Product Risks  
- **Limited API Coverage**: Not all Capacities features available via API
  - *Mitigation*: Focus on highest-value use cases first
- **User Adoption**: Users may not understand MCP benefits
  - *Mitigation*: Create comprehensive documentation and examples
- **Performance Degradation**: Adding dependencies may slow down operations
  - *Mitigation*: Benchmark performance and optimize hot paths

## Conclusion

This MCP server will bridge the gap between Claude's conversational AI capabilities and Capacities' powerful knowledge management features. By following this phased approach, we can deliver value quickly while building a robust, scalable integration that respects both platforms' design principles and limitations.

The modular architecture ensures maintainability, while the comprehensive testing strategy ensures reliability. The focus on security and rate limiting protects both user data and API access, making this a production-ready solution for enhanced knowledge workflows.