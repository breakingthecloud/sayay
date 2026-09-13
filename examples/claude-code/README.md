# Sayay × Claude Code

Budget guardrails for Claude Code via the `sayay-claude-code` hook command.

## Install

```bash
npm i @carloscortezcloud/sayay-guard
```

The `sayay-claude-code` binary is a hook command: it reads the hook payload from
stdin, computes the session cost from the JSONL transcript, and exits **2** to
halt the agentic loop when a cap is crossed (Claude Code stops the run).

## Settings

Copy `settings.json` into `.claude/settings.json`:

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

## Budget

```bash
export SAYAY_BUDGET_DAILY=5
export SAYAY_BUDGET_BURN_RATE=2        # $/min velocity guard
export SAYAY_BUDGET_PER_STEP=1
export SAYAY_MAX_SUBAGENTS_PER_STEP=2  # fan-out cap for Agent/Task
export SAYAY_USER="$(whoami)"
export SAYAY_STORAGE_FILE=".sayay/claude.json"
```

See `../../docs/local-agents.md` for the full env reference.