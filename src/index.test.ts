import { describe, it, expect, vi, beforeEach } from 'vitest';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import {
  BudgetExceededError,
  TokenBudgetExceededException,
  SayayGuard,
  MemoryStorage,
  FileStorage,
  DynamoStorage,
} from './index.js';

const budget = { dailyUsd: 10 };

describe('TokenBudgetExceededException', () => {
  it('extends BudgetExceededError (backward compatible)', () => {
    const err = new TokenBudgetExceededException('u1', 0, 10, 'daily', 'Daily budget exhausted');
    expect(err).toBeInstanceOf(BudgetExceededError);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('TokenBudgetExceededException');
    expect(err.userId).toBe('u1');
    expect(err.remaining).toBe(0);
    expect(err.total).toBe(10);
    expect(err.scope).toBe('daily');
    expect(err.message).toBe('Daily budget exhausted');
  });

  it('matches ErrorEquals name for Step Functions', () => {
    const err = new TokenBudgetExceededException('u1', 0, 10, 'budget', 'Budget exceeded');
    expect(err.name).toBe('TokenBudgetExceededException');
  });

  it('BudgetExceededError base keeps its own name', () => {
    const err = new BudgetExceededError('oops', 'u1', 0, 10, 'daily');
    expect(err.name).toBe('BudgetExceededError');
  });
});

describe('SayayGuard.checkOrThrow', () => {
  it('throws TokenBudgetExceededException when action is block', async () => {
    const storage = new MemoryStorage();
    const guard = new SayayGuard({ storage, budget });
    await guard.record('u1', 10);

    await expect(guard.checkOrThrow('u1')).rejects.toThrow(TokenBudgetExceededException);
    await expect(guard.checkOrThrow('u1')).rejects.toThrow('Daily budget exhausted');
  });

  it('throws with ErrorEquals-compatible name', async () => {
    const storage = new MemoryStorage();
    const guard = new SayayGuard({ storage, budget });
    await guard.record('u1', 10);

    try {
      await guard.checkOrThrow('u1');
    } catch (e) {
      expect((e as Error).name).toBe('TokenBudgetExceededException');
    }
  });

  it('returns decision (no throw) for allow/warn/degrade', async () => {
    const storage = new MemoryStorage();
    const guard = new SayayGuard({ storage, budget });

    const allow = await guard.checkOrThrow('u1');
    expect(allow.action).toBe('allow');

    await guard.record('u1', 8);
    const warn = await guard.checkOrThrow('u1');
    expect(warn.action).toBe('warn');

    await guard.record('u1', 2);
    await expect(guard.checkOrThrow('u1')).rejects.toThrow(TokenBudgetExceededException);
  });

  it('check() still returns block decision without throwing (unchanged behavior)', async () => {
    const storage = new MemoryStorage();
    const guard = new SayayGuard({ storage, budget });
    await guard.record('u1', 10);

    const decision = await guard.check('u1');
    expect(decision.action).toBe('block');
  });
});

describe('DynamoStorage', () => {
  function mockDynamo() {
    const store = new Map<string, number>();
    const send = vi.fn(async (cmd: any) => {
      const cmdName = cmd.constructor?.name || '';
      const key = cmd?.input?.Key?.pk;
      if (cmdName.includes('Get')) {
        return { Item: key && store.has(key) ? { pk: key, value: store.get(key) } : undefined };
      }
      if (cmdName.includes('Update')) {
        const amt = cmd.input.ExpressionAttributeValues[':amt'];
        const prev = store.get(key) || 0;
        const next = prev + amt;
        store.set(key, next);
        return { Attributes: { pk: key, value: next } };
      }
      if (cmdName.includes('Delete')) {
        store.delete(key);
        return {};
      }
      return {};
    });
    return { client: { send }, store };
  }

  it('get returns 0 for missing key', async () => {
    const { client } = mockDynamo();
    const storage = new DynamoStorage({ tableName: 'sayay', client });
    await expect(storage.get('missing')).resolves.toBe(0);
  });

  it('increment adds amount and returns new value', async () => {
    const { client } = mockDynamo();
    const storage = new DynamoStorage({ tableName: 'sayay', client });
    await expect(storage.increment('u1:daily', 2)).resolves.toBe(2);
    await expect(storage.increment('u1:daily', 3)).resolves.toBe(5);
    await expect(storage.get('u1:daily')).resolves.toBe(5);
  });

  it('increment sets ttl attribute when ttlSeconds provided', async () => {
    const { client, store } = mockDynamo();
    const storage = new DynamoStorage({ tableName: 'sayay', client });
    await storage.increment('u1:daily', 1, 3600);
    expect(store.get('u1:daily')).toBe(1);
    const updateCall = client.send.mock.calls.find(([c]) => c?.constructor?.name?.includes('Update'));
    expect(updateCall[0].input.ExpressionAttributeValues[':ttl']).toBeGreaterThan(Date.now() / 1000);
  });

  it('reset deletes the key', async () => {
    const { client } = mockDynamo();
    const storage = new DynamoStorage({ tableName: 'sayay', client });
    await storage.increment('u1:daily', 5);
    await storage.reset('u1:daily');
    await expect(storage.get('u1:daily')).resolves.toBe(0);
  });

  it('works as SayayStorage for a guard', async () => {
    const { client, store } = mockDynamo();
    const storage = new DynamoStorage({ tableName: 'sayay', client });
    const guard = new SayayGuard({ storage, budget });

    await guard.record('u1', 3);
    const usage = await guard.getUsage('u1');
    expect(usage.daily).toBe(3);

    await expect(guard.checkOrThrow('u1')).resolves.toMatchObject({ action: 'allow' });
  });
});

describe('Burn rate / velocity guard', () => {
  it('blocks when average USD/min exceeds the limit over the window', async () => {
    const now = new Date('2026-09-06T12:00:00Z');
    const guard = new SayayGuard({
      storage: new MemoryStorage(),
      budget: { burnRateUsdPerMin: 1 },
      burnRateWindowMinutes: 3,
      now: () => now,
    });
    await guard.record('u1', 6);
    const decision = await guard.check('u1');
    expect(decision.action).toBe('block');
    expect(decision.reason).toContain('2.0000/min');
  });

  it('allows when under the limit', async () => {
    const now = new Date('2026-09-06T12:00:00Z');
    const guard = new SayayGuard({
      storage: new MemoryStorage(),
      budget: { burnRateUsdPerMin: 10 },
      burnRateWindowMinutes: 3,
      now: () => now,
    });
    await guard.record('u1', 6);
    const decision = await guard.check('u1');
    expect(decision.action).toBe('allow');
    expect(decision.total).toBe(10);
  });

  it('decays as old minutes fall out of the window', async () => {
    let now = new Date('2026-09-06T12:00:00Z');
    const guard = new SayayGuard({
      storage: new MemoryStorage(),
      budget: { burnRateUsdPerMin: 1 },
      burnRateWindowMinutes: 3,
      now: () => now,
    });
    await guard.record('u1', 6);
    expect((await guard.check('u1')).action).toBe('block');

    now = new Date('2026-09-06T12:01:00Z');
    now = new Date('2026-09-06T12:02:00Z');
    now = new Date('2026-09-06T12:03:00Z');
    const decision = await guard.check('u1');
    expect(decision.action).toBe('allow');
  });

  it('reports burnRate in getUsage', async () => {
    const now = new Date('2026-09-06T12:00:00Z');
    const guard = new SayayGuard({
      storage: new MemoryStorage(),
      budget: { burnRateUsdPerMin: 10 },
      burnRateWindowMinutes: 2,
      now: () => now,
    });
    await guard.record('u1', 4);
    const usage = await guard.getUsage('u1');
    expect(usage.burnRate).toBeCloseTo(2, 5);
  });
});

describe('Per-step cap', () => {
  it('blocks when a call would exceed the step cap', async () => {
    const guard = new SayayGuard({ storage: new MemoryStorage(), budget: { perStepCapUsd: 1 } });
    const stepId = guard.beginStep('u1');
    expect((await guard.check('u1', 0.6, { stepId })).action).toBe('allow');
    await guard.record('u1', 0.6, undefined, { stepId });
    expect((await guard.check('u1', 0.6, { stepId })).action).toBe('block');
  });

  it('endStep resets the step bucket', async () => {
    const guard = new SayayGuard({ storage: new MemoryStorage(), budget: { perStepCapUsd: 1 } });
    const stepId = guard.beginStep('u1');
    await guard.record('u1', 0.8, undefined, { stepId });
    expect((await guard.check('u1', 0.6, { stepId })).action).toBe('block');
    await guard.endStep('u1', stepId);
    expect((await guard.check('u1', 0.6, { stepId })).action).toBe('allow');
  });

  it('step usage is independent per user and step', async () => {
    const guard = new SayayGuard({ storage: new MemoryStorage(), budget: { perStepCapUsd: 2 } });
    const s1 = guard.beginStep('u1');
    const s2 = guard.beginStep('u2');
    await guard.record('u1', 1.5, undefined, { stepId: s1 });
    expect((await guard.check('u1', 1, { stepId: s1 })).action).toBe('block');
    expect((await guard.check('u2', 1, { stepId: s2 })).action).toBe('allow');
    const usage = await guard.getUsage('u1', { stepId: s1 });
    expect(usage.step).toBeCloseTo(1.5, 5);
  });
});

describe('Loop detection', () => {
  it('blocks after maxLoopRepeats of the same fingerprint', async () => {
    const guard = new SayayGuard({ storage: new MemoryStorage(), budget: { maxLoopRepeats: 2 } });
    const fp = 'a1b2c3';
    expect((await guard.trackLoop('u1', fp)).action).toBe('allow');
    expect((await guard.trackLoop('u1', fp)).action).toBe('allow');
    expect((await guard.trackLoop('u1', fp)).action).toBe('block');
  });

  it('is scoped per user', async () => {
    const guard = new SayayGuard({ storage: new MemoryStorage(), budget: { maxLoopRepeats: 2 } });
    const fp = 'a1b2c3';
    await guard.trackLoop('u1', fp);
    await guard.trackLoop('u1', fp);
    expect((await guard.trackLoop('u1', fp)).action).toBe('block');
    expect((await guard.trackLoop('u2', fp)).action).toBe('allow');
  });
});

describe('FileStorage', () => {
  it('persists across instances', async () => {
    const dir = mkdtemp();
    const path = join(dir, 'ledger.json');
    const a = new FileStorage(path);
    await a.increment('k', 3);
    const b = new FileStorage(path);
    await expect(b.get('k')).resolves.toBe(3);
    await b.increment('k', 2);
    await expect(a.get('k')).resolves.toBe(5);
    rmSync(dir, { recursive: true, force: true });
  });

  it('expires ttl entries', async () => {
    const dir = mkdtemp();
    const path = join(dir, 'ledger.json');
    const storage = new FileStorage(path);
    await storage.increment('k', 1, 1);
    await expect(storage.get('k')).resolves.toBe(1);
    await new Promise((r) => setTimeout(r, 1100));
    await expect(storage.get('k')).resolves.toBe(0);
    rmSync(dir, { recursive: true, force: true });
  });

  it('reset removes the key', async () => {
    const dir = mkdtemp();
    const path = join(dir, 'ledger.json');
    const storage = new FileStorage(path);
    await storage.increment('k', 4);
    await storage.reset('k');
    await expect(storage.get('k')).resolves.toBe(0);
    rmSync(dir, { recursive: true, force: true });
  });
});

function mkdtemp(): string {
  return join(tmpdir(), `sayay-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
}
