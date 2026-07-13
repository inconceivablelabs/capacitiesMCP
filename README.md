# Capacities MCP Server

An MCP server for [Capacities](https://capacities.io): search, property-based object lookup, object CRUD, save weblinks, and daily notes from any MCP-compatible client.

> **⚠️ Upgrade to 2.x.** Version **2.x runs on the Capacities v2 REST API**. Version **1.x used the
> Capacities Beta API, which Capacities discontinues on September 1, 2026.** On that date, 1.x builds
> (and any `.dxt` packaged before v2.0.0) **stop working**. Reinstall the current
> `capacities-desktop-extension.dxt` (v2.x) to keep the integration working. See the
> [Capacities API notice](https://docs.capacities.io/developer/api).

## Prerequisites

- A [Capacities](https://capacities.io) account with API access
- An API token (Capacities Desktop App → Settings → API → Generate token)

## Installation

Choose the option that fits your setup:

### Option 1: Claude Desktop Extension (Easiest)

1. Download [`capacities-desktop-extension.dxt`](./capacities-desktop-extension.dxt)
2. In Claude Desktop: Settings → Extensions → Import Extension
3. Select the `.dxt` file and enter your API token when prompted

All dependencies are bundled; no additional setup needed.

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
# Build from the repo root: the Dockerfile copies from both src/ and server/.
docker build -f server/Dockerfile -t capacities-mcp .
docker run -d \
  -e CAPACITIES_API_TOKEN=your_token_here \
  capacities-mcp
```

The Docker image uses `server/`, which contains only the runtime package and compiled output, with no source or dev dependencies.

## Available tools

| Tool | Description |
|------|-------------|
| `search_content` | Search objects by title (optionally scoped by `structureIds`, capped by `limit`) |
| `find_objects` | Locate objects by a property the API can't search on — date, label/status, tag/relation, or scalar. Seeds a title search, then filters and sorts client-side over typed property values; returns ids + titles + the matched values (no bodies — compose with `get_object`). Dates are absolute ISO (equals or `{after,before}` range) |
| `list_spaces` | Show the space your API token is scoped to |
| `get_space_info` | List the space's structures: their properties, label options, and relation targets |
| `create_object` | Create an object of any structure with typed properties, labels, and relations (set by name, resolved strictly), plus a markdown body |
| `update_object` | Update an existing object's properties/relations (replaces each named property's value) and append a body |
| `get_object` | Read an object as Markdown (frontmatter + body) |
| `append_to_object` | Append markdown content to an object's body without touching its properties |
| `delete_object` | Delete an object (moves to trash by default; `hard_delete` for permanent) |
| `save_weblink` | Save a URL as a Weblink, auto-fetching page metadata (override `title`/`description`) |
| `add_to_daily_note` | Append content to today's daily note |

> **Single-space per token.** A v2 API token is scoped to exactly one space; `list_spaces`
> returns that one space. To work with multiple spaces, use multiple tokens.

## The object model: properties vs. body

Objects in Capacities hold two kinds of content, and the tools treat them differently:

- **Properties** — the object's *typed fields*: title, text, dates, numbers, **labels**
  (e.g. a task's Status, a weblink's Category), and **entity relations** (tags, a meeting's
  attendees). Set these with the `properties` / `labels` / `relations` inputs on
  `create_object` / `update_object`, keyed by property name or id (get them, plus label options
  and relation targets, from `get_space_info`). **Relations and labels are set by *name* and
  resolved strictly**: an unknown name is an error, never a guess; pass
  `create_missing_relations: true` to auto-create unmatched relation targets.
- **Body** — freeform Markdown, set via the `body` / `notes` / `content` / `markdown`
  parameter.

**Rule of thumb: set structured things as properties, prose as body.** A tag is a property
(a `relations` entry), not a `[[link]]` typed into the text. One tool call completes one
object (all its properties *and* its body); several *distinct, standalone* objects take
several calls.

### Markdown conventions (body)

Any body/notes field supports Capacities' inline conventions:

| Syntax | Effect | Creates an object? |
|--------|--------|--------------------|
| `() text` | Creates a **Task** and links it into the body | **Yes**, a Task |
| `#tag` | Creates or links a **Tag** | **Yes**, a Tag if new |
| `[[Name]]` | Links an **existing** object by title | **No**; plain text if no such object exists |

Use `[[Name]]` to reference something that already exists; use `() ` / `#` when you *intend*
to create the task/tag.

### Weblinks & media objects (current API limitation)

`save_weblink` creates a Weblink from a URL and auto-fetches the page's title and description;
you can override `title` and `description` at save time. **Those are the only properties
settable on a weblink.** The Capacities API currently treats *media* objects (weblinks, PDFs,
images, audio, files) as **create-only**: they cannot be updated after creation, so **tags,
Category, and Topic cannot be set on a weblink through the API.** To tag a weblink today, put a
`#tag` in its `notes` (this associates a Tag via the body).

> **This is an upstream Capacities API limitation, not a limitation of this server.** As soon
> as the Capacities API allows updating media objects, this server will add full weblink
> property support (tags / Category / Topic via `save_weblink`). Until then, `#tag`-in-notes is
> the available path.

## Configuration

| Environment Variable | Required | Default |
|---------------------|----------|---------|
| `CAPACITIES_API_TOKEN` | Yes | — |
| `CAPACITIES_API_BASE_URL` | No | `https://api.capacities.io` |
| `LOG_LEVEL` | No | `info` |

## Project structure

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

MIT. See [LICENSE](LICENSE).
