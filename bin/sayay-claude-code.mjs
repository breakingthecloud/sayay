#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import {
  ClaudeCodeGuard,
  configFromEnv,
  readHookInput,
  sessionCostFromTranscript,
} from '../dist/adapters/claude-code.js';

async function main() {
  let raw = '';
  try {
    raw = readFileSync(0, 'utf8');
  } catch {
    raw = '';
  }

  const hook = readHookInput(raw);
  const cfg = configFromEnv();
  const guard = new ClaudeCodeGuard({
    budget: cfg.budget,
    storageFile: cfg.storageFile,
    userId: cfg.userId,
    maxSubagentsPerStep: cfg.maxSubagentsPerStep,
  });

  if (hook.hook_event_name === 'SessionStart') {
    await guard.resetSessionLedger();
    process.exit(0);
  }

  if (hook.hook_event_name === 'PreToolUse' && /^(Agent|Task)$/.test(hook.tool_name || '')) {
    const stepId = process.env.CLAUDE_SESSION_ID || 'current';
    const result = await guard.subagentSpawnCheck(stepId);
    if (result.action === 'block') {
      process.stderr.write(`[sayay] ${result.reason}\n`);
      process.exit(2);
    }
    process.exit(0);
  }

  let sessionCost = 0;
  if (hook.transcript_path) {
    try {
      sessionCost = sessionCostFromTranscript(hook.transcript_path);
    } catch {
      sessionCost = 0;
    }
  }

  const result = await guard.haltCheck(sessionCost);
  if (result.action === 'block') {
    process.stderr.write(
      `[sayay] Budget halt (session $${sessionCost.toFixed(4)}): ${result.reason}\n` +
        `[sayay] Raise limits via SAYAY_BUDGET_DAILY / SAYAY_BUDGET_BURN_RATE or end the session.\n`,
    );
    process.exit(2);
  }
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`[sayay] ${err?.message || err}\n`);
  process.exit(0);
});
