# Sayay for Local Coding Agents

Budget guards for local AI coding agents — **Claude Code**, **opencode**, and any
MCP-capable tool (Cursor, Zed, custom agents). In-process enforcement, zero
infrastructure, no proxy. Files live under `adapters/` and ship as subpath
exports of `@carloscortezcloud/sayay-guard`.

## Core guardrails added in sayay-009

| Capability | Config | What it does |
|---|---|---|
| **Burn-rate / velocity guard** | `budget.burnRateUsdPerMin` | Blocks a loop burning > X USD/min (rolling window, default 5 min) |
| **Per-step cap** | `budget.perStepCapUsd` | Caps one step (batch of tool calls between user prompts) |
| **Loop detection** | `budget.maxLoopRepeats` | Blocks after the same error fingerprint repeats N times |
| **Subagent fan-out cap** | `maxSubagentsPerStep` (Claude Code) | Denies `Agent`/`Task` spawns past a per-step count |
| **Per-call max** | `budget.perCallMaxUsd` | Blocks a single expensive call |

New methods on `SayayGuard`: `beginStep(userId)`, `endStep(userId, stepId)`,
`trackLoop(userId, fingerprint)`, and `getUsage(userId, { stepId })`.

## Claude Code

`sayay-claude-code` runs as a hook command. It reads the hook payload from stdin,
computes the session cost from the JSONL transcript, records the delta, and
returns **exit 2** to halt the agentic loop before the next model call compounds
the spend.

```bash
npm i @carloscortezcloud/sayay-guard
npx sayay-claude-code   # used by the hooks below
```

`.claude/settings.json`:

```json
{
  "hooks": {
    "SessionStart": "sayay-claude-code",
    "UserPromptSubmit": "sayay-claude-code",
    "PostToolBatch": "sayay-claude-code",
    "PreCompact": "sayay-claude-code",
    "PreToolUse": "sayay-claude-code"
  }
}
```

Environment (see `configFromEnv` in `adapters/claude-code.ts`):

| Env var | Default | Purpose |
|---|---|---|
| `SAYAY_BUDGET_DAILY` / `_MONTHLY` / `_SESSION` / `_PER_CALL` | — | USD caps |
| `SAYAY_BUDGET_BURN_RATE` | — | USD/min velocity cap |
| `SAYAY_BUDGET_PER_STEP` | — | Per-step cap |
| `SAYAY_MAX_LOOP_REPEATS` | — | Loop guard |
| `SAYAY_MAX_SUBAGENTS_PER_STEP` | — | Fan-out cap for `Agent`/`Task` |
| `SAYAY_USER` | `claude-user` | Budget owner |
| `SAYAY_STORAGE_FILE` | `.sayay/ledger.json` | Ledger file |

`PostToolBatch` is the primary stop — it fires between tool batches, before the
next model call. `PreToolUse` (matching `Agent`/`Task`) enforces the subagent
fan-out cap. `PreCompact` blocks compaction when the budget is already blown.

## opencode

`sayay-opencode` is a plugin. It records cost after every assistant message and
throws before a tool executes when the budget is exhausted.

```ts
import { createSayayOpenCodePlugin } from '@carloscortezcloud/sayay-guard/opencode';

export const plugin = createSayayOpenCodePlugin({
  budget: { dailyUsd: 5, burnRateUsdPerMin: 1 },
  storageFile: '.sayay/opencode.json',
  userId: 'dev',
});
```

The opencode adapter reads assistant message `cost` (or token `usage`) from the
`chat.message` hook and calls `guard.check` in `tool.execute.before` to stop the
loop.

## MCP (any agent)

`sayay-mcp` is a stdio MCP server exposing three tools: `budget_check`,
`budget_record`, `budget_summary`. Point any MCP client at it:

```bash
npm i @carloscortezcloud/sayay-guard
SAYAY_BUDGET_DAILY=5 npx sayay-mcp
```

MCP config example (Cursor / Claude Desktop / Zed):

```json
{
  "mcpServers": {
    "sayay": {
      "command": "npx",
      "args": ["sayay-mcp"],
      "env": {
        "SAYAY_BUDGET_DAILY": "5",
        "SAYAY_BUDGET_BURN_RATE": "1",
        "SAYAY_STORAGE_FILE": ".sayay/ledger.json"
      }
    }
  }
}
```

Protocol is plain newline-delimited JSON-RPC over stdio (zero dependencies).
`FileStorage` keeps the ledger in a JSON file that survives restarts.