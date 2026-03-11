# @squidlerio/mcp

MCP proxy that sits between an AI client (Claude, Cursor, etc.) and the remote Squidler MCP server. It forwards all tools, resources, and prompts transparently, while adding local Chrome session management for testing localhost URLs.

## How it works

```
AI Client (stdio) ←→ MCP Proxy ←→ Remote Squidler MCP (HTTP)
                        ↕
                   Local Chrome ←→ CDP Proxy (WebSocket)
```

The proxy intercepts `test_case_run` calls — when local Chrome mode is enabled, it automatically creates a CDP session and routes the test through your local browser instead of the cloud worker's Chrome.

## Install

```bash
npm install -g @squidlerio/mcp
```

## Configuration

| Variable | Required | Default | Description |
|---|---|---|---|
| `SQUIDLER_API_KEY` | Yes | — | API key for the remote Squidler MCP server |
| `SQUIDLER_API_URL` | No | `https://mcp.squidler.io` | Remote MCP server URL |

The CDP proxy URL is derived automatically from the API URL.

## Usage

### As an MCP server (stdio)

Add to your MCP client configuration:

```json
{
  "mcpServers": {
    "squidler": {
      "command": "npx",
      "args": ["-y", "@squidlerio/mcp"],
      "env": {
        "SQUIDLER_API_KEY": "your-api-key"
      }
    }
  }
}
```

### CLI

```bash
# Download Chrome headless shell for local testing
squidler-mcp download-chrome

# Start MCP proxy via CLI
squidler-mcp mcp-proxy
```

## Local session tools

These tools are added by the proxy (not available on the remote server):

- **`local_session_start`** — Enable local Chrome mode. Accepts `headless` (boolean, default: true). Chrome is launched on the first `test_case_run`.
- **`local_session_stop`** — Disable local Chrome mode and stop any active session.
- **`local_session_status`** — Check if local Chrome mode is enabled and if a session is active.

When local Chrome mode is enabled, `test_case_run` automatically creates/recycles a CDP session and routes through your local Chrome. Back-to-back tests get a fresh Chrome instance each time.

## Development

```bash
bun install
bun run start          # Run CLI
bun run mcp-proxy      # Run MCP proxy
bun run build          # Build for npm publishing
```
