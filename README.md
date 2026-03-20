# @squidlerio/squidler-mcp

MCP proxy that sits between an AI client (Claude, Cursor, etc.) and the remote Squidler MCP server. It forwards all tools, resources, and prompts transparently, while adding local Chrome session management for testing localhost URLs.

## How it works

```
AI Client (stdio) ←→ MCP Proxy ←→ Remote Squidler MCP (HTTP)
                        ↕
                   Local Chrome ←→ CDP Proxy (WebSocket)
```

The proxy intercepts `test_case_run` calls — when local Chrome mode is enabled, it automatically creates a CDP session and routes the test through your local browser instead of the cloud worker's Chrome.

## Quick Start

Run directly with npx — no install or API key needed:

```bash
npx @squidlerio/squidler-mcp
```

On first use, a browser window opens for you to sign in to Squidler. Your session is saved locally so you only need to do this once.

### Claude Code

```bash
claude mcp add squidler -- npx -y @squidlerio/squidler-mcp
```

### Cursor / Other MCP Clients

Add to your MCP client configuration:

```json
{
  "mcpServers": {
    "squidler": {
      "command": "npx",
      "args": ["-y", "@squidlerio/squidler-mcp"]
    }
  }
}
```

## CLI Commands

```bash
# Sign in to Squidler (happens automatically on first use)
squidler-mcp login

# Sign out and clear saved session
squidler-mcp logout

# Download Chrome headless shell for local testing
squidler-mcp download-chrome
```

## Local Session Tools

These tools are added by the proxy (not available on the remote server):

- **`local_session_start`** — Enable local Chrome mode. Accepts `headless` (boolean, default: true). Chrome is launched on the first `test_case_run`.
- **`local_session_stop`** — Disable local Chrome mode and stop any active session.
- **`local_session_status`** — Check if local Chrome mode is enabled and if a session is active.

When local Chrome mode is enabled, `test_case_run` automatically creates/recycles a CDP session and routes through your local Chrome. Back-to-back tests get a fresh Chrome instance each time.

## Advanced: API Key Override

If you prefer to use an API key instead of OAuth login, set the `SQUIDLER_API_KEY` environment variable:

```json
{
  "mcpServers": {
    "squidler": {
      "command": "npx",
      "args": ["-y", "@squidlerio/squidler-mcp"],
      "env": {
        "SQUIDLER_API_KEY": "your-api-key"
      }
    }
  }
}
```

| Variable | Required | Default | Description |
|---|---|---|---|
| `SQUIDLER_API_KEY` | No | — | API key override (skips OAuth login) |
| `SQUIDLER_API_URL` | No | `https://mcp.squidler.io` | Remote MCP server URL |

## Development

```bash
bun install
bun run start          # Run CLI
bun run mcp-proxy      # Run MCP proxy
bun run build          # Build for npm publishing
```
