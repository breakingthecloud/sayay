# Sayay × opencode

Budget guardrails for opencode via `createSayayOpenCodePlugin`.

## Plugin

`plugin.ts` records cost after every assistant message (`chat.message` hook) and
throws before a tool executes when the budget is exhausted
(`tool.execute.before` hook), stopping the loop.

## Use

Reference it from your opencode config, with budgets via env:

```bash
export SAYAY_BUDGET_DAILY=5
export SAYAY_BUDGET_BURN_RATE=1
export SAYAY_BUDGET_PER_CALL=1
export SAYAY_USER="$(whoami)"
export SAYAY_STORAGE_FILE=".sayay/opencode.json"
```

See `../../docs/local-agents.md` for the opencode section and full env reference.