import { rmSync } from 'node:fs';
import { SayayGuard, FileStorage } from '@carloscortezcloud/sayay-guard';

const ledger = '.sayay/file-storage-demo.json';

const run1 = new SayayGuard({ storage: new FileStorage(ledger), budget: { dailyUsd: 5 } });
await run1.record('dev', 2);
console.log('run 1 recorded $2.00');

const run2 = new SayayGuard({ storage: new FileStorage(ledger), budget: { dailyUsd: 5 } });
const usage = await run2.getUsage('dev');
console.log(`run 2 (new process, same file) sees daily: $${usage.daily.toFixed(2)}`);
const decision = await run2.check('dev', 4);
console.log(`check $4.00 → ${decision.action}`);

rmSync(ledger, { force: true });
