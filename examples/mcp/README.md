# Sayay × MCP

Budget guardrails for any MCP-capable agent (Cursor, Zed, custom) via the
`sayay-mcp` stdio server: `budget_check` / `budget_record` / `budget_summary`.

## Server

```bash
SAYAY_BUDGET_DAILY=5 npx sayay-mcp
```

## Client demo

`mcp-client-demo.mjs` spawns the server and walks initialize → record → check → summary:

```bash
node examples/mcp/mcp-client-demo.mjs
```

MCP client config (Cursor / Claude Desktop / Zed):

```json
{
  "mcpServers": {
    "sayay": {
      "command": "npx",
      "args": ["sayay-mcp"],
      "env": { "SAYAY_BUDGET_DAILY": "5" }
    }
  }
}
```

See `../../docs/local-agents.md` for the MCP section.