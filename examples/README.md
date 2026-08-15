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

| File | Feature | What you learn |
|------|---------|----------------|
| [sayay-qhaway.ts](sayay-qhaway.ts) | `SayayQhawayPlugin` (Sayay-007) | Pipe allow/warn/degrade/block decisions → Qhaway `sayay.check` spans → `qhaway_sayay_decisions_total` metric → Grafana "Budget Guardrails" panel. Wire the same guard into a Tinkuy agent (`guard` option). |

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
