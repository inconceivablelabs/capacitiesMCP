# Capacities MCP Server Setup & Configuration Guide

## Quick Start

### 1. Prerequisites

- **Node.js 18+** installed
- **Capacities account** with Pro subscription (required for API access)
- **Claude Desktop** installed and updated to latest version
- **Capacities Desktop app** for generating API token

### 2. Initial Setup

```bash
# Clone or create project directory
mkdir capacities-mcp-server
cd capacities-mcp-server

# Initialize project
npm init -y

# Install dependencies (minimal approach)
npm install @modelcontextprotocol/sdk
npm install -D @types/node typescript

# Create TypeScript config
cat > tsconfig.json << 'EOF'
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16", 
    "moduleResolution": "Node16",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
EOF
```

### 3. Environment Configuration

Create `.env` file in project root:

```bash
# Capacities API Configuration
CAPACITIES_API_TOKEN=your_api_token_here
CAPACITIES_API_BASE_URL=https://api.capacities.io

# Server Configuration  
LOG_LEVEL=info
MCP_SERVER_NAME=capacities-mcp-server

# Optional: Development settings
NODE_ENV=development
```

### 4. Get Capacities API Token

1. Open **Capacities Desktop app**
2. Go to **Settings** → **Capacities API**
3. Click **Generate Token**
4. Copy the token and add it to your `.env` file

⚠️ **Important**: Keep your API token secure and never commit it to version control!

### 5. Build and Test

```bash
# Build the project
npm run build

# Test with MCP Inspector
npm run inspector

# Test the built server directly
node dist/index.js
```

## Claude Desktop Integration

### Configuration File Location

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%/Claude/claude_desktop_config.json`

### Basic Configuration

```json
{
  "mcpServers": {
    "capacities": {
      "command": "node",
      "args": ["/absolute/path/to/capacities-mcp-server/dist/index.js"],
      "env": {
        "CAPACITIES_API_TOKEN": "your_api_token_here"
      }
    }
  }
}
```

### Alternative: NPM Package Configuration

After publishing to npm:

```json
{
  "mcpServers": {
    "capacities": {
      "command": "npx",
      "args": ["capacities-mcp-server"],
      "env": {
        "CAPACITIES_API_TOKEN": "your_api_token_here"
      }
    }
  }
}
```

### Verification Steps

1. **Restart Claude Desktop** completely after configuration changes
2. **Check Tools Menu**: Look for Capacities tools in Claude's interface
3. **Test Basic Function**: Try asking Claude to "list my Capacities spaces"

## Usage Examples

### Basic Search Operations

```
"Search for content about machine learning in my Capacities"
"Find all meeting notes from last week"
"Show me all tagged content related to #projects"
```

### Content Management

```
"Save this article to my Research space: https://example.com/article"
"Add a task to today's daily note: Review quarterly goals"
"Create a meeting note for my 2pm standup"
```

### Information Retrieval

```
"What spaces do I have in Capacities?"
"Show me the structure of my Work space"
"Find content related to this project we're discussing"
```

## Advanced Configuration

### Custom Rate Limiting

```typescript
// In src/client/capacities.ts
const customLimits = {
  general: { maxRequests: 3, windowMs: 60000 },    // More conservative
  search: { maxRequests: 100, windowMs: 60000 },   // Slightly reduced
  weblink: { maxRequests: 8, windowMs: 60000 }     // Reduced for safety
};
```

### Enhanced Error Handling

```typescript
// Add to environment configuration
export const config = {
  retryAttempts: 3,
  retryDelay: 1000,
  timeoutMs: 30000,
  enableDebugLogging: process.env.NODE_ENV === 'development'
};
```

### Logging Configuration

```typescript
// src/utils/logger.ts
import { createLogger, format, transports } from 'winston';

export const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: format.combine(
    format.timestamp(),
    format.errors({ stack: true }),
    format.json()
  ),
  transports: [
    new transports.File({ filename: 'error.log', level: 'error' }),
    new transports.File({ filename: 'combined.log' }),
    new transports.Console({
      format: format.simple(),
      silent: process.env.NODE_ENV === 'production'
    })
  ]
});
```

## Development Workflow

### Project Structure

```
capacities-mcp-server/
├── src/
│   ├── index.ts                 # Main entry point
│   ├── client/
│   │   ├── capacities.ts        # API client
│   │   └── types.ts             # Type definitions
│   ├── tools/
│   │   ├── search.ts            # Search tools
│   │   ├── weblink.ts           # Weblink tools
│   │   ├── daily-note.ts        # Daily note tools
│   │   └── create.ts            # Content creation (future)
│   ├── resources/
│   │   └── spaces.ts            # Resource providers
│   └── utils/
│       ├── logger.ts            # Logging utilities
│       └── validation.ts        # Input validation
├── tests/
│   ├── client.test.ts           # API client tests
│   ├── tools.test.ts            # Tool tests
│   └── integration.test.ts      # End-to-end tests
├── dist/                        # Compiled output
├── .env                         # Environment variables
├── package.json
├── tsconfig.json
└── README.md
```

### Development Commands

```bash
# Watch mode during development
npm run dev

# Build for production
npm run build

# Run tests (Node.js built-in test runner)
npm test

# Run with inspector for debugging
npm run inspector

# Check types only
npx tsc --noEmit

# Health check
npm run health-check
```

### Testing Strategy

```typescript
// Simple test without additional frameworks (using Node.js built-in test runner)
// test/client.test.js
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { CapacitiesClient } from '../dist/client/capacities.js';

describe('CapacitiesClient', () => {
  test('should validate environment correctly', () => {
    // Test implementation
    assert.ok(true);
  });

  test('should handle API errors gracefully', async () => {
    // Mock implementation
    assert.ok(true);
  });
});
```

Run tests with: `npm test` (uses Node.js built-in test runner)

## Troubleshooting

### Common Issues

#### 1. "Authentication Failed" Error
- **Cause**: Invalid or expired API token
- **Solution**: Regenerate token in Capacities desktop app
- **Check**: Token is correctly set in environment variables

#### 2. "Rate Limit Exceeded" Error  
- **Cause**: Too many requests to Capacities API
- **Solution**: Implement client-side rate limiting
- **Check**: Rate limiter configuration is appropriate

#### 3. "Tools Not Showing in Claude"
- **Cause**: Configuration issues or server not running
- **Solution**: 
  1. Verify Claude Desktop config file path and syntax
  2. Restart Claude Desktop completely
  3. Check server builds and runs without errors
  4. Verify absolute paths in configuration

#### 4. "Space Not Found" Error
- **Cause**: Invalid space ID or permissions
- **Solution**: List spaces first to get valid IDs
- **Check**: User has access to the specified space

### Debug Mode

Enable detailed logging:

```bash
# Set environment variable
export LOG_LEVEL=debug
export NODE_ENV=development

# Run with debug output
npm run start
```

### Validate Configuration

```bash
# Test API connectivity
curl -H "Authorization: Bearer YOUR_TOKEN" \
     -H "Content-Type: application/json" \
     https://api.capacities.io/spaces

# Test MCP server
echo '{"jsonrpc":"2.0","method":"tools/list","id":1}' | node dist/index.js
```

### Health Check Tool

```typescript
// scripts/health-check.ts
import { CapacitiesClient } from '../src/client/capacities.js';

async function healthCheck() {
  try {
    const client = new CapacitiesClient({
      apiToken: process.env.CAPACITIES_API_TOKEN!,
      baseUrl: process.env.CAPACITIES_API_BASE_URL!
    });
    
    const spaces = await client.getSpaces();
    console.log(`✅ Connected successfully. Found ${spaces.length} spaces.`);
    
    for (const space of spaces) {
      console.log(`  - ${space.title} (${space.id})`);
    }
  } catch (error) {
    console.error('❌ Health check failed:', error);
    process.exit(1);
  }
}

healthCheck();
```

## Security Best Practices

### Token Management
- Use environment variables for API tokens
- Never commit tokens to version control
- Rotate tokens periodically
- Use different tokens for development/production

### Input Validation
- Validate all user inputs with Zod schemas
- Sanitize markdown content before API calls
- Implement proper error boundaries

### Network Security
- Always use HTTPS for API calls
- Implement request timeouts
- Add retry logic with exponential backoff

## Performance Optimization

### Caching Strategy
```typescript
// Simple in-memory cache for spaces
class SpaceCache {
  private cache = new Map<string, any>();
  private ttl = 5 * 60 * 1000; // 5 minutes

  async get(key: string, fetcher: () => Promise<any>) {
    const cached = this.cache.get(key);
    if (cached && (Date.now() - cached.timestamp) < this.ttl) {
      return cached.data;
    }
    
    const data = await fetcher();
    this.cache.set(key, { data, timestamp: Date.now() });
    return data;
  }
}
```

### Batch Operations
```typescript
// Batch multiple search requests
async function batchSearch(queries: string[], spaceIds: string[]) {
  const promises = queries.map(query => 
    client.searchContent({ query, spaceIds })
  );
  return Promise.all(promises);
}
```

## Deployment Options

### Option 1: Local Development
- Run directly from source during development
- Use file watching for automatic rebuilds
- Easy debugging and testing

### Option 2: NPM Package
- Publish to npm registry for easy distribution
- Users can install with `npm install -g capacities-mcp-server`
- Automatic updates through npm

### Option 3: Binary Distribution
- Create standalone executables for different platforms
- No Node.js requirement for end users
- Larger file size but simpler deployment

### Option 4: Docker Container
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY dist/ ./dist/
EXPOSE 3000
CMD ["node", "dist/index.js"]
```

## Dependency Evolution Strategy

### Current Minimal Approach
The implementation uses only the MCP SDK to minimize complexity:

```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.17.2"
  }
}
```

### When to Add Dependencies Back

#### Consider **Axios** when you need:
- **Large file uploads** with progress tracking
- **Advanced retry logic** with exponential backoff
- **Request/response interceptors** for complex auth flows
- **Connection pooling** for high-throughput scenarios

#### Consider **Zod** when you need:
- **Complex API response validation** 
- **Runtime schema enforcement** for external data
- **API documentation generation** from schemas
- **Schema migration** for API version compatibility

#### Consider **Additional Libraries** when you need:
- **Pino**: Structured logging for production debugging
- **LRU-Cache**: Intelligent caching for frequently accessed data  
- **Sharp**: Image processing for media content
- **Unified/Remark**: Advanced markdown processing

### Migration Path
1. **Profile performance** before adding dependencies
2. **Use feature flags** to toggle implementations  
3. **Maintain backward compatibility** in public APIs
4. **Monitor bundle size** impact after additions

## Next Steps

1. **Test the basic implementation** with your Capacities account
2. **Extend with additional tools** based on API updates
3. **Add error recovery** and retry mechanisms
4. **Implement caching** for better performance
5. **Create comprehensive tests** for reliability
6. **Document usage patterns** for your team
7. **Submit feedback** to Capacities team for API improvements

## Resources

- [Capacities API Documentation](https://docs.capacities.io/developer/api)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [Claude Desktop MCP Guide](https://docs.anthropic.com/claude/docs/mcp)
- [Capacities Community Forum](https://discord.com/channels/940596022344843336)

## Support

If you encounter issues:

1. Check the troubleshooting section above
2. Review Capacities API documentation
3. Test with MCP Inspector tool
4. Check Claude Desktop configuration
5. Submit issues to the project repository