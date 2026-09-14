import { describe, it, expect, vi } from 'vitest';
import { SayayGuard, MemoryStorage } from '../index.js';
import { SayayAgentsPlugin, withSayayBudget } from './agents-cf.js';
import { createSayayCallbackHandler } from './langchain.js';
import { createGuardedBedrock } from './bedrock.js';

describe('SayayAgentsPlugin + withSayayBudget', () => {
  it('blocks the model call over budget', async () => {
    const plugin = new SayayAgentsPlugin({
      budget: { dailyUsd: 5 },
      storage: new MemoryStorage(),
      userId: 'u1',
      estimateCost: () => 0.01,
    });
    const Agent = class {
      async onModelCall(input: unknown, _ctx: unknown, callback: () => Promise<unknown>) {
        return callback();
      }
    };
    const Budgeted = withSayayBudget(Agent as any, plugin);

    await plugin.guard.record('u1', 5);
    const agent = new Budgeted();
    await expect(
      agent.onModelCall({}, {}, async () => ({ output: 'ok' })),
    ).rejects.toThrow(/Budget exceeded/);
  });

  it('records cost from response usage after the call', async () => {
    const plugin = new SayayAgentsPlugin({
      budget: { dailyUsd: 5 },
      storage: new MemoryStorage(),
      userId: 'u1',
      estimateCost: () => 0,
      costFromUsage: (usage: unknown) => (usage as { cost?: number }).cost || 0,
    });
    const Agent = class {
      async onModelCall(_input: unknown, _ctx: unknown, callback: () => Promise<unknown>) {
        return callback();
      }
    };
    const Budgeted = withSayayBudget(Agent as any, plugin);
    const agent = new Budgeted();
    await agent.onModelCall({}, {}, async () => ({ usage: { cost: 2 } }));
    const usage = await plugin.guard.getUsage('u1');
    expect(usage.daily).toBe(2);
  });
});

describe('createSayayCallbackHandler', () => {
  it('throws on llm start when over budget', async () => {
    const storage = new MemoryStorage();
    const handler = createSayayCallbackHandler({
      budget: { dailyUsd: 5 },
      storage,
      userId: 'u1',
      estimateTokens: () => 10_000_000,
    });
    const guard = new SayayGuard({ storage, budget: { dailyUsd: 5 } });
    await guard.record('u1', 5);
    await expect(handler.on_llm_start({}, ['big prompt'])).rejects.toThrow(/Budget exceeded/);
  });

  it('records cost on llm end from usage', async () => {
    const storage = new MemoryStorage();
    const handler = createSayayCallbackHandler({
      budget: { dailyUsd: 5 },
      storage,
      userId: 'u1',
    });
    await handler.on_llm_end({
      llmOutput: { usage: { input_tokens: 1_000_000, output_tokens: 0 } },
    });
    const guard = new SayayGuard({ storage, budget: { dailyUsd: 5 } });
    const usage = await guard.getUsage('u1');
    expect(usage.daily).toBeCloseTo(3, 5);
  });
});

describe('createGuardedBedrock', () => {
  it('blocks invoke over budget and records usage', async () => {
    const client = {
      invokeModel: vi.fn(async () => ({ output: { message: { usage: { input_tokens: 10 } } } })),
    };
    const { guardedInvoke, guard } = createGuardedBedrock({
      client,
      budget: { dailyUsd: 5 },
      storage: new MemoryStorage(),
      userId: 'u1',
      estimateCost: () => 0,
      costFromUsage: () => 0.5,
    });
    const res = await guardedInvoke({ modelId: 'm', messages: [] });
    expect(res.output?.message?.usage?.input_tokens).toBe(10);
    const usage = await guard.getUsage('u1');
    expect(usage.daily).toBeCloseTo(0.5, 5);
  });

  it('throws when the call would exceed the budget', async () => {
    const client = { invokeModel: vi.fn(async () => ({})) };
    const { guardedInvoke, guard } = createGuardedBedrock({
      client,
      budget: { dailyUsd: 5 },
      storage: new MemoryStorage(),
      userId: 'u1',
      estimateCost: () => 10,
    });
    await guard.record('u1', 5);
    await expect(guardedInvoke({ modelId: 'm', messages: [] })).rejects.toThrow(/Budget exceeded/);
  });
});