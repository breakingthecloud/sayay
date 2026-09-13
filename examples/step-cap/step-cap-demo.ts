import { SayayGuard, MemoryStorage } from '@carloscortezcloud/sayay-guard';

const guard = new SayayGuard({
  storage: new MemoryStorage(),
  budget: { dailyUsd: 50, perStepCapUsd: 1 },
});

const stepId = guard.beginStep('dev');
console.log(`step opened: ${stepId}`);

for (const cost of [0.3, 0.4, 0.2, 0.5]) {
  const decision = await guard.check('dev', cost, { stepId });
  console.log(`call $${cost.toFixed(2)} → ${decision.action}${decision.reason ? ` (${decision.reason})` : ''}`);
  if (decision.action === 'block') break;
  await guard.record('dev', cost, undefined, { stepId });
}

const usage = await guard.getUsage('dev', { stepId });
console.log(`step spent: $${usage.step?.toFixed(2)}`);

await guard.endStep('dev', stepId);
const after = await guard.check('dev', 0.5, { stepId });
console.log(`after endStep → ${after.action}`);
