# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Build and Development
- **Build**: `npm run build` - Compiles TypeScript and makes dist/index.js executable
- **Development**: `npm run dev` - Watch mode compilation with TypeScript
- **Start**: `npm run start` - Run the compiled MCP server
- **Testing**: `npm run test` - Run Node.js built-in test runner
- **Inspector**: `npm run inspector` - Launch MCP Inspector for debugging tools

### Environment Setup
Required environment variables:
- `CAPACITIES_API_TOKEN` - API token from Capacities desktop app (required)
- `CAPACITIES_API_BASE_URL` - API base URL (optional, defaults to https://api.capacities.io)
- `LOG_LEVEL` - Logging level (optional, defaults to "info")

### Dependencies
- **@modelcontextprotocol/sdk**: MCP protocol implementation
- **zod**: Schema validation for tool parameters
- **dotenv**: Environment variable loading from .env files
- **typescript**: TypeScript compilation

## Architecture Overview

This is an MCP (Model Context Protocol) server that integrates Claude with Capacities knowledge management platform. The server provides tools for searching, creating content, and managing weblinks within Capacities spaces.

### Core Components

#### Client Layer (`src/client/`)
- **CapacitiesClient**: Main API client with rate limiting and error handling
- **Types**: TypeScript interfaces for Capacities API data structures
- **Rate Limiting**: Built-in rate limiter respecting API limits:
  - General endpoints: 5 requests/60s
  - Search endpoints: 120 requests/60s  
  - Weblink endpoints: 10 requests/60s

#### Tools Layer (`src/tools/`)
Each file implements specific MCP tools using `server.registerTool()` with Zod schemas:
- **search.ts**: Content search across spaces, space listing, space info retrieval
- **create.ts**: Content creation tools (when API supports it)
- **weblink.ts**: Save URLs as weblink objects with metadata
- **daily-note.ts**: Add timestamped content to daily notes
- **smart-search.ts**: Advanced search capabilities
- **content-analysis.ts**: Content analysis and processing
- **workflow-automation.ts**: Automated workflow tools

Note: Some tools may be in `src/tools/unused/` if not fully implemented.

#### Resources Layer (`src/resources/`)
- **spaces.ts**: Exposes Capacities spaces as MCP resources

#### Utilities (`src/utils/`)
- **validation.ts**: Input validation functions for UUIDs, URLs, markdown content, and environment variables

### Key Features

#### Available MCP Tools
1. **search_content** - Search across Capacities spaces with full-text or title search
2. **list_spaces** - Retrieve all available Capacities spaces
3. **get_space_info** - Get detailed space information including structures and collections
4. **save_weblink** - Save URLs with custom metadata, tags, and notes
5. **add_to_daily_note** - Add markdown content to today's daily note

#### Error Handling
- Custom `CapacitiesAPIError` class with error codes (RATE_LIMIT_EXCEEDED, AUTHENTICATION_FAILED, NOT_FOUND, API_ERROR)
- Comprehensive input validation using custom validator functions
- Graceful degradation with user-friendly error messages

#### Security Considerations
- Bearer token authentication with secure environment variable storage
- Input sanitization for markdown content
- URL validation for weblink operations
- UUID validation for space and structure IDs

## Development Notes

### API Integration
- Built around Capacities Beta API with minimal external dependencies
- Uses Node.js native fetch for HTTP requests
- Implements client-side rate limiting to prevent API errors
- Handles authentication failures and provides clear error messages

### Code Style
- TypeScript with strict type checking
- Modular architecture with clear separation of concerns
- Comprehensive error handling at all levels
- Zod schemas for input validation and type safety
- MCP SDK v1.17+ with `registerTool()` and `registerResource()` methods

### Testing Strategy
The codebase uses Node.js built-in test runner. When adding tests:
- Test individual tools with mocked API responses
- Validate input schemas and error handling
- Test rate limiting logic and API integration scenarios

### MCP Server Integration

#### Option 1: Desktop Extension (Recommended)
Use the bundled Desktop Extension `capacities-desktop-extension.dxt` for one-click installation with all dependencies included.

#### Option 2: Manual Configuration
Configure in Claude Desktop's MCP settings:
```json
{
  "mcpServers": {
    "capacities": {
      "command": "node",
      "args": ["./dist/index.js"],
      "env": {
        "CAPACITIES_API_TOKEN": "your_token_here"
      }
    }
  }
}
```