# Capacities MCP Server

An MCP server for [Capacities](https://capacities.io) — search, create content, save weblinks, and analyze your knowledge base from any MCP-compatible client.

## Prerequisites

- A [Capacities](https://capacities.io) account with API access
- An API token (Capacities Desktop App → Settings → API → Generate token)

## Installation

Choose the option that fits your setup:

### Option 1: Claude Desktop Extension (Easiest)

1. Download [`capacities-desktop-extension.dxt`](./capacities-desktop-extension.dxt)
2. In Claude Desktop: Settings → Extensions → Import Extension
3. Select the `.dxt` file and enter your API token when prompted

All dependencies are bundled — no additional setup needed.

### Option 2: Run from Source

```bash
git clone https://github.com/inconceivablelabs/capacitiesMCP.git
cd capacitiesMCP
npm install
npm run build
```

Then add to your MCP client config (e.g. Claude Desktop's `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "capacities": {
      "command": "node",
      "args": ["/path/to/capacitiesMCP/server/dist/index.js"],
      "env": {
        "CAPACITIES_API_TOKEN": "your_token_here"
      }
    }
  }
}
```

### Option 3: Docker Container

For running as a persistent service (e.g. behind an MCP gateway):

```bash
cd server
docker build -t capacities-mcp .
docker run -d \
  -e CAPACITIES_API_TOKEN=your_token_here \
  capacities-mcp
```

The Docker image uses `server/` which contains only the runtime package and compiled output — no source or dev dependencies.

## Available Tools

| Tool | Description |
|------|-------------|
| `search_content` | Search across Capacities spaces using keywords |
| `list_spaces` | List all your Capacities spaces |
| `get_space_info` | Detailed info about a specific space |
| `smart_search` | Context-aware search with related content |
| `advanced_search` | Search with date ranges, object types, and filters |
| `create_structured_note` | Create structured templates (meeting, daily-reflection, task-list, research) |
| `save_weblink` | Save a URL as a weblink with metadata and tags |
| `add_to_daily_note` | Add content to today's daily note |
| `analyze_content_patterns` | Analyze patterns in your content |
| `identify_knowledge_gaps` | Find underdeveloped topics |

## Configuration

| Environment Variable | Required | Default |
|---------------------|----------|---------|
| `CAPACITIES_API_TOKEN` | Yes | — |
| `CAPACITIES_API_BASE_URL` | No | `https://api.capacities.io` |
| `LOG_LEVEL` | No | `info` |

## Project Structure

```
capacitiesMCP/
├── src/                  # TypeScript source (single source of truth)
├── server/               # Runtime packaging
│   ├── Dockerfile        # Container build
│   ├── package.json      # Runtime dependencies only
│   └── dist/             # Compiled output (built from root src/)
├── tsconfig.json         # Builds src/ → server/dist/
├── manifest.json         # DXT extension manifest
└── *.dxt                 # Pre-built extension packages
```

`npm run build` compiles `src/` directly into `server/dist/`. There is one source, one build step, and one output location used by all three installation methods.

## Development

```bash
npm install
npm run build        # Compile TypeScript
npm run dev          # Watch mode
npm run inspector    # MCP Inspector for debugging
npm test             # Run tests
```

See [CLAUDE.md](./CLAUDE.md) for architecture details.

## License

MIT — see [LICENSE](LICENSE).
