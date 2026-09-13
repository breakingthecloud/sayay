import { SayayGuard, MemoryStorage } from '@carloscortezcloud/sayay-guard';

let now = new Date('2026-09-13T12:00:00Z');

const guard = new SayayGuard({
  storage: new MemoryStorage(),
  budget: { dailyUsd: 50, burnRateUsdPerMin: 2 },
  burnRateWindowMinutes: 3,
  now: () => now,
});

async function spend(label: string, amount: number, minute: string) {
  now = new Date(`2026-09-13T${minute}:00Z`);
  await guard.record('dev', amount);
  const decision = await guard.check('dev');
  const usage = await guard.getUsage('dev');
  console.log(`${minute} ${label}: +$${amount.toFixed(2)} → ${decision.action} (burn $${usage.burnRate?.toFixed(2)}/min)`);
}

await spend('normal turn', 1, '12:00');
await spend('normal turn', 1, '12:01');
await spend('runaway loop', 8, '12:01');
await spend('retry storm', 10, '12:02');
