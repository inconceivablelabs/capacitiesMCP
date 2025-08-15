# Capacities MCP Server

A Model Context Protocol (MCP) server that integrates with [Capacities](https://capacities.io), enabling seamless knowledge management workflows through natural language interactions with any MCP-compatible client.

## Features

- **🔍 Search Content**: Search across all your Capacities spaces with full-text or title-based queries
- **📚 Browse Spaces**: List and explore your Capacities spaces, structures, and collections
- **📋 Structured Content**: Create structured note templates (meeting, daily-reflection, task-list, research)
- **🧠 Smart Analysis**: Analyze content patterns and identify knowledge gaps
- **⚡ Rate Limited**: Respects Capacities API rate limits with built-in client-side limiting
- **🛡️ Secure**: Token-based authentication with comprehensive input validation

## Prerequisites

1. **Capacities Account**: You need an active Capacities account with API access
2. **Capacities Desktop App**: Required to generate API tokens
3. **MCP-compatible client**: Such as Claude Desktop, Roo Code, or other MCP clients
4. **Node.js**: Version 18 or higher
5. **Dependencies**: The project uses Zod for schema validation and the official MCP SDK

## Installation

### Option 1: Desktop Extension (Easiest - Recommended)

1. **Download the Desktop Extension**: [`capacities-desktop-extension.dxt`](./capacities-desktop-extension.dxt)

2. **Get your Capacities API token**:
   - Open Capacities Desktop App
   - Go to Settings → API
   - Generate a new API token

3. **Import into Claude Desktop**:
   - Open Claude Desktop → Settings → Extensions → Import Extension
   - Select the `capacities-desktop-extension.dxt` file
   - Enter your API token when prompted
   - **No additional setup required** - all dependencies are bundled!

### Option 2: Configuration Files (For Advanced Users)

1. **Download the appropriate DXT configuration file**:
   - **For global NPM install**: [`capacities-mcp-global.dxt`](./capacities-mcp-global.dxt)
   - **For local development**: [`capacities-mcp-local.dxt`](./capacities-mcp-local.dxt)
   - **For manual setup**: [`capacities-mcp.dxt`](./capacities-mcp.dxt)

2. **Get your Capacities API token**:
   - Open Capacities Desktop App
   - Go to Settings → API
   - Generate a new API token

3. **Import into your MCP client**:
   - **For Claude Desktop**: Open Claude Desktop → Settings → Extensions → Import MCP Server
   - **For other MCP clients**: Follow your client's MCP server import process
   - Select the downloaded DXT file and enter your API token when prompted

### Option 3: NPM Installation

```bash
npm install -g capacities-mcp-server
```

### Option 4: Build from Source

```bash
git clone https://github.com/inconceivablelabs/capacitiesMCP.git
cd capacitiesMCP
npm install
npm run build
```

## Setup

### 1. Get Your Capacities API Token

1. Open the Capacities desktop application
2. Go to Settings → API
3. Generate a new API token
4. Copy the token for configuration

### 2. Configure Your MCP Client

#### Claude Desktop
Add the MCP server to your Claude Desktop configuration file:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "capacities": {
      "command": "capacities-mcp-server",
      "env": {
        "CAPACITIES_API_TOKEN": "your_api_token_here"
      }
    }
  }
}
```

If you built from source, use the full path to the compiled server:

```json
{
  "mcpServers": {
    "capacities": {
      "command": "node",
      "args": ["/path/to/capacitiesMCP/dist/index.js"],
      "env": {
        "CAPACITIES_API_TOKEN": "your_api_token_here"
      }
    }
  }
}
```

#### Other MCP Clients
For other MCP-compatible clients (like Roo Code), refer to their specific configuration documentation for adding MCP servers.

### 3. Restart Your Client

Restart your MCP client to load the server.

## Usage

Once configured, you can interact with your Capacities knowledge base through your MCP client using natural language:

### Search Your Content
```
"Search for notes about machine learning in my research space"
"Find all content tagged with 'project-ideas'"
"Show me recent entries about productivity"
```

### Browse Your Spaces
```
"List all my Capacities spaces"
"What structures are available in my Work space?"
"Show me the collections in my Research space"
```

### Create Structured Content
```
"Create a meeting note template for my project review"
"Generate a daily reflection template with today's accomplishments"
"Create a research note template for my AI studies"
```

### Analyze Your Knowledge
```
"Analyze patterns in my content from the last month"
"What knowledge gaps exist in my research space?"
"Show me content creation trends over the past week"
```

## Available Tools

The MCP server provides the following tools to any MCP-compatible client:

| Tool | Description |
|------|-------------|
| `search_content` | Search for content across Capacities spaces using keywords |
| `list_spaces` | Get a list of all your Capacities spaces |
| `get_space_info` | Get detailed information about a specific space |
| `create_structured_note` | Create structured note templates (meeting, daily-reflection, task-list, research) |
| `smart_search` | Intelligent search with context awareness and related content |
| `analyze_content_patterns` | Analyze patterns in your Capacities content |
| `identify_knowledge_gaps` | Find topics that might be missing or underdeveloped |
| `advanced_search` | Search with date ranges, object types, and other filters *(Coming Soon)* |
| `save_weblink` | Save a URL as a weblink object with metadata *(Coming Soon)* |
| `add_to_daily_note` | Add content to today's daily note *(Coming Soon)* |

## Configuration

### Environment Variables

- `CAPACITIES_API_TOKEN` (required): Your Capacities API token
- `CAPACITIES_API_BASE_URL` (optional): API base URL (defaults to `https://api.capacities.io`)
- `LOG_LEVEL` (optional): Logging level (defaults to `info`)

### API Rate Limits

The server respects Capacities API rate limits:
- General endpoints: 5 requests per minute
- Search endpoints: 120 requests per minute
- Weblink endpoints: 10 requests per minute

## Troubleshooting

### Common Issues

1. **"Authentication Failed" Error**
   - Verify your API token is correct
   - Ensure the token hasn't expired
   - Check that API access is enabled in Capacities

2. **"Server Not Found" in your MCP client**
   - Verify the configuration file path is correct
   - Check that the server command/path is accurate
   - Restart your MCP client after configuration changes

3. **Rate Limit Errors**
   - The server has built-in rate limiting, but if you encounter errors, wait a minute and try again
   - Consider breaking large operations into smaller chunks

### Debug Mode

For development or debugging, you can use the MCP Inspector:

```bash
npm run inspector
```

This will start the server with debugging capabilities.

## Development

See [CLAUDE.md](./CLAUDE.md) for detailed development information.

### Quick Start

```bash
git clone https://github.com/inconceivablelabs/capacitiesMCP.git
cd capacitiesMCP
npm install  # Installs MCP SDK, Zod, dotenv, and other dependencies
npm run build
npm run dev  # Watch mode for development
```

### Key Dependencies

- **@modelcontextprotocol/sdk**: Official MCP protocol implementation
- **zod**: Schema validation for type-safe tool parameters
- **dotenv**: Environment variable management
- **typescript**: TypeScript compilation and type checking

### Testing

```bash
npm test
```

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Support

- 🐛 [Report Issues](https://github.com/inconceivablelabs/capacitiesMCP/issues)
- 💬 [Discussions](https://github.com/inconceivablelabs/capacitiesMCP/discussions)
- 📖 [Capacities API Documentation](https://capacities.io/api-docs)
- 🤖 [MCP Protocol Documentation](https://modelcontextprotocol.io)

## Acknowledgments

- [Capacities](https://capacities.io) for their excellent knowledge management platform and API
- [Anthropic](https://anthropic.com) for the Model Context Protocol
- The MCP community for tools and inspiration
