import { createHash } from 'node:crypto';
import { SayayGuard, MemoryStorage } from '@carloscortezcloud/sayay-guard';

const guard = new SayayGuard({
  storage: new MemoryStorage(),
  budget: { dailyUsd: 50, maxLoopRepeats: 2 },
});

function fingerprint(text: string): string {
  const clean = text.split('\n').slice(0, 10).map((l) => l.trim()).join('\n');
  return createHash('sha256').update(clean).digest('hex').slice(0, 12);
}

const failures = [
  'TypeError: undefined is not an object\n  at patch (auth.ts:41)',
  'TypeError: undefined is not an object\n  at patch (auth.ts:41)',
  'TypeError: undefined is not an object\n  at patch (auth.ts:41)',
  'ReferenceError: x is not defined\n  at other (db.ts:7)',
];

for (const [i, err] of failures.entries()) {
  const decision = await guard.trackLoop('dev', fingerprint(err));
  console.log(`attempt ${i + 1} [${fingerprint(err)}] → ${decision.action}${decision.reason ? ` (${decision.reason})` : ''}`);
  if (decision.action === 'block') break;
}
