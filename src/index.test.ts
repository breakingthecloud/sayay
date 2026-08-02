import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  BudgetExceededError,
  TokenBudgetExceededException,
  SayayGuard,
  MemoryStorage,
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
