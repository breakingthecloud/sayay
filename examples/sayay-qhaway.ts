/**
 * Sayay → Qhaway integration example.
 *
 * Pipes every Sayay budget decision (allow/warn/degrade/block) into Qhaway as
 * a `sayay.check` span, then exposes them as Prometheus metrics
 * (`qhaway_sayay_decisions_total`) — which the Grafana "Budget Guardrails"
 * panel visualizes.
 *
 * Imports the published package name (self-reference), so the exact same code
 * runs from a consumer project. Requires `pnpm build` once (dist/ present).
 *
 * Run (no keys needed — drives the guard directly):
 *   pnpm tsx examples/sayay-qhaway.ts
 *
 * With a router key it also runs a real Tinkuy agent wired to the same guard:
 *   OPENROUTER_API_KEY=sk-... pnpm tsx examples/sayay-qhaway.ts
 */
import { Agent, simpleTask } from '@carloscortezcloud/tinkuy-agent';
import { StyrRouter } from '@carloscortezcloud/styrr-llm';
import { MemoryStorage as QhawayMemoryStorage, generatePrometheusMetrics } from '@carloscortezcloud/qhaway';
import { SayayGuard, MemoryStorage, SayayQhawayPlugin } from '@carloscortezcloud/sayay-guard';

// 1) Qhaway storage that receives one span per Sayay decision.
const qhawayStorage = new QhawayMemoryStorage();

// 2) Plugin pipes guard decisions into Qhaway spans.
const qhawayPlugin = new SayayQhawayPlugin({
  storage: qhawayStorage,
  agentId: 'finops-agent',
  sessionId: 'session-demo-001',
  budgetKey: 'team-budget',
});

// 3) Sayay guard with the plugin as onDecision hook.
const sayay = new SayayGuard({
  storage: new MemoryStorage(),
  budget: { dailyUsd: 10 },
  onExceeded: 'block',
  warnThreshold: 80,
  degradeThreshold: 95,
  degradeToModel: 'meta-llama/llama-3.3-70b-instruct:free',
  onDecision: qhawayPlugin.onDecision,
});

// 4) Tinkuy agent uses the guard natively (check before call, record after).
const router = process.env.OPENROUTER_API_KEY
  ? new StyrRouter({
      models: [{ id: 'openai/gpt-4o-mini', provider: 'openrouter' }],
      apiKey: process.env.OPENROUTER_API_KEY,
    })
  : undefined;

const agent = router
  ? new Agent({
      router,
      guard: sayay,
      tools: [simpleTask('get_time', 'Get the current time', async () => new Date().toISOString())],
      systemPrompt: 'You are a helpful assistant. Use tools when needed.',
    })
  : undefined;

async function main(): Promise<void> {
  // Drive the guard directly (always runs, no keys needed):
  await sayay.check('user-42', 0.005);          // allow
  await sayay.record('user-42', 8.5);
  await sayay.check('user-42', 0.005);          // warn (85% of $10)
  await sayay.record('user-42', 1.5);
  await sayay.check('user-42', 0.005);          // block (budget exhausted)

  if (agent) {
    const result = await agent.run('What time is it?');
    console.log('\nAgent:', result.text);
  }

  const sayaySpans = await qhawayStorage.query({ tool_name: 'sayay.check' });
  console.log(`\nSayay decisions recorded: ${sayaySpans.length}`);
  for (const s of sayaySpans) {
    const m = s.metadata ?? {};
    console.log(`  ${s.timestamp} user=${s.user_id} action=${m.action} spent=${m.spent} limit=${m.limit}${m.suggestedModel ? ` → ${m.suggestedModel}` : ''}`);
  }

  console.log('\nPrometheus (qhaway_sayay_decisions_total highlighted):');
  console.log(
    generatePrometheusMetrics(sayaySpans)
      .split('\n')
      .filter(l => l.includes('qhaway_sayay_decisions_total'))
      .join('\n'),
  );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
