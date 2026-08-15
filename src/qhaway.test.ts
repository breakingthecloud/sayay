import { describe, it, expect, vi } from 'vitest';
import { SayayGuard, MemoryStorage, SayayQhawayPlugin, sayayDecisionMetric } from './index.js';
import type { SayayQhawaySpan, SayayQhawayStorage } from './index.js';

class RecordingStorage implements SayayQhawayStorage {
  spans: SayayQhawaySpan[] = [];
  async write(span: SayayQhawaySpan): Promise<void> {
    this.spans.push(span);
  }
}

describe('SayayQhawayPlugin', () => {
  it('writes a QhawaySpan per decision with sayay.check schema', async () => {
    const storage = new RecordingStorage();
    const plugin = new SayayQhawayPlugin({ storage, agentId: 'a1', sessionId: 's1', budgetKey: 'team-budget' });
    const guard = new SayayGuard({
      storage: new MemoryStorage(),
      budget: { dailyUsd: 10 },
      onDecision: plugin.onDecision,
    });

    await guard.check('u1');

    expect(storage.spans).toHaveLength(1);
    const span = storage.spans[0];
    expect(span.tool_name).toBe('sayay.check');
    expect(span.model).toBe('budget-guard');
    expect(span.provider).toBe('sayay');
    expect(span.cost_usd).toBe(0);
    expect(span.user_id).toBe('u1');
    expect(span.agent_id).toBe('a1');
    expect(span.session_id).toBe('s1');
    expect(span.success).toBe(true);
    expect(span.metadata?.action).toBe('allow');
    expect(span.metadata?.budgetKey).toBe('team-budget');
    expect(span.metadata?.spent).toBe(0);
    expect(span.metadata?.limit).toBe(10);
  });

  it('records block/degrade actions and suggestedModel', async () => {
    const storage = new RecordingStorage();
    const plugin = new SayayQhawayPlugin({ storage });
    const guard = new SayayGuard({
      storage: new MemoryStorage(),
      budget: { dailyUsd: 1 },
      onExceeded: 'block',
      onDecision: plugin.onDecision,
    });

    await guard.record('u2', 1);
    await guard.check('u2');

    const block = storage.spans[storage.spans.length - 1];
    expect(block.metadata?.action).toBe('block');
    expect(block.metadata?.spent).toBe(1);
    expect(block.metadata?.limit).toBe(1);
  });

  it('emits degrade with suggestedModel in metadata', async () => {
    const storage = new RecordingStorage();
    const plugin = new SayayQhawayPlugin({ storage });
    const guard = new SayayGuard({
      storage: new MemoryStorage(),
      budget: { credits: 10, creditsPerCall: 1 },
      degradeThreshold: 80,
      degradeToModel: 'meta-llama/llama-3.3-70b-instruct:free',
      onDecision: plugin.onDecision,
    });

    for (let i = 0; i < 9; i++) await guard.record('u3', 0, 1);
    await guard.check('u3');

    const degrade = storage.spans[storage.spans.length - 1];
    expect(degrade.metadata?.action).toBe('degrade');
    expect(degrade.metadata?.suggestedModel).toBe('meta-llama/llama-3.3-70b-instruct:free');
  });

  it('keeps the guard path alive when storage.write rejects (default)', async () => {
    const failing: SayayQhawayStorage = {
      async write() {
        throw new Error('storage down');
      },
    };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const plugin = new SayayQhawayPlugin({ storage: failing });
    const guard = new SayayGuard({
      storage: new MemoryStorage(),
      budget: { dailyUsd: 10 },
      onDecision: plugin.onDecision,
    });

    await expect(guard.check('u1')).resolves.toMatchObject({ action: 'allow' });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('sayayDecisionMetric', () => {
  it('formats a Prometheus line with action and user labels', () => {
    expect(sayayDecisionMetric('block', 'u1', 3)).toBe('qhaway_sayay_decisions_total{action="block",user="u1"} 3');
  });
});
