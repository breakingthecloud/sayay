# Sayay Examples

Run any example from the repo root:

```bash
pnpm build   # once — examples self-reference the package (import via dist/)
pnpm tsx examples/<file>.ts
```

> Examples import the published package name `@carloscortezcloud/sayay-guard`.
> Because the package declares `exports`, Node/tsx resolves the import against
> this repo's own `dist/` (self-reference) — so the exact same code runs from a
> consumer project.

## Index

| Path | Feature | What you learn |
|------|---------|----------------|
| [sayay-qhaway.ts](sayay-qhaway.ts) | `SayayQhawayPlugin` (Sayay-007) | Pipe allow/warn/degrade/block decisions → Qhaway `sayay.check` spans → `qhaway_sayay_decisions_total` metric → Grafana "Budget Guardrails" panel. Wire the same guard into a Tinkuy agent (`guard` option). |
| [burn-rate/](burn-rate/) | `burnRateUsdPerMin` (sayay-009, v0.4.0) | Velocity guard: spend normally (allow), then spike a runaway loop (block) with a rolling 3-min window. Uses injectable `now` to simulate minutes without waiting. |
| [step-cap/](step-cap/) | `perStepCapUsd` (sayay-009, v0.4.0) | `beginStep` → charge calls with `{ stepId }` → fourth call blocks → `endStep` resets the step bucket. |
| [loop-detection/](loop-detection/) | `maxLoopRepeats` (sayay-009, v0.4.0) | `trackLoop` with an error fingerprint (sha256 of the stack): same error twice (allow), third time (block); a different error starts a fresh counter. |
| [file-storage/](file-storage/) | `FileStorage` (sayay-009, v0.4.0) | Two guard instances share one JSON ledger file: process 2 sees process 1's spend — the pattern local CLI agents and `sayay-mcp` use. |
| [mcp/](mcp/) | `sayay-mcp` (sayay-009, v0.4.0) | Spawn the stdio MCP server and walk `initialize` → `budget_record` → `budget_check` → `budget_summary` (`mcp-client-demo.mjs`). Client config for Cursor/Zed included in `README.md`. |
| [claude-code/](claude-code/) | `sayay-claude-code` (sayay-009, v0.4.0) | `.claude/settings.json` hook wiring (`SessionStart`, `UserPromptSubmit`, `PostToolBatch`, `PreCompact`, `PreToolUse`) + env budget reference. |
| [opencode/](opencode/) | `sayay-opencode` (sayay-009, v0.4.0) | `createSayayOpenCodePlugin` (`plugin.ts`): record cost on `chat.message`, halt the loop in `tool.execute.before`. |

## Guidance

- **sayay-qhaway.ts** is the observability loop for budget enforcement. No API
  keys needed — it drives the guard directly (`check` / `record`) to produce
  `allow` → `warn` → `block` spans, then prints the Prometheus metric lines.
  Set `OPENROUTER_API_KEY` to additionally run a real Tinkuy agent against the
  same guard.
- The generated spans are **not** LLM calls: `model="budget-guard"`,
  `provider="sayay"`, `cost_usd=0`, `tool_name="sayay.check"`, with decision
  context in `metadata` (`action`, `budgetKey`, `spent`, `limit`,
  `usagePercent`, `suggestedModel`).

## Cross-references

- SoW: [`sayay-007-qhaway-integration`](../cc-roadmap/oss-ecosystem/sayay/sayay-007-qhaway-integration.md)
- Qhaway metric source: `qhaway/src/cost/metrics.ts` → `qhaway_sayay_decisions_total`
- Qhaway Grafana dashboard: `qhaway/src/dashboard/qhaway-dashboard.json` → "Budget Guardrails (Sayay)"
- Tinkuy agent `guard` option: `@carloscortezcloud/tinkuy-agent` (`Guard` interface)
