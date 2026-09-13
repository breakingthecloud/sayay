import { SayayGuard, FileStorage } from '../index.js';
import type { SayayBudget } from '../index.js';
import { estimateCostFromUsage } from './claude-code.js';
import type { TokenUsage } from './claude-code.js';

export interface OpenCodeMessage {
  role?: string;
  cost?: number;
  usage?: TokenUsage;
  [key: string]: unknown;
}

export interface OpenCodeChatMessageInput {
  messages: OpenCodeMessage[];
  [key: string]: unknown;
}

export interface OpenCodeToolInput {
  tool?: string;
  [key: string]: unknown;
}

export interface OpenCodePluginConfig {
  budget: SayayBudget;
  storageFile: string;
  userId: string;
}

export interface SayayOpenCodePlugin {
  hooks: {
    'chat.message': (input: OpenCodeChatMessageInput) => Promise<void>;
    'tool.execute.before': (input: OpenCodeToolInput) => Promise<undefined>;
  };
}

export function createSayayOpenCodePlugin(config: OpenCodePluginConfig): SayayOpenCodePlugin {
  const ledger = new FileStorage(config.storageFile);
  const guard = new SayayGuard({
    storage: ledger,
    budget: config.budget,
    onExceeded: 'block',
  });
  const userId = config.userId;

  async function recordAssistantCost(messages: OpenCodeMessage[]): Promise<void> {
    const last = messages[messages.length - 1];
    if (!last || last.role !== 'assistant') return;
    let cost: number | undefined;
    if (typeof last.cost === 'number') {
      cost = last.cost;
    } else if (last.usage && typeof last.usage === 'object') {
      cost = estimateCostFromUsage(last.usage as TokenUsage);
    }
    if (cost && cost > 0) {
      await guard.record(userId, cost);
    }
  }

  return {
    hooks: {
      'chat.message': async (input) => {
        await recordAssistantCost(input.messages);
      },
      'tool.execute.before': async () => {
        const decision = await guard.check(userId, 0);
        if (decision.action === 'block') {
          throw new Error(`[sayay] Budget exceeded: ${decision.reason}`);
        }
        return undefined;
      },
    },
  };
}

export function configFromEnv(env: Record<string, string | undefined> = process.env): OpenCodePluginConfig {
  const num = (v: string | undefined): number | undefined => (v !== undefined && v !== '' ? Number(v) : undefined);
  return {
    budget: {
      dailyUsd: num(env.SAYAY_BUDGET_DAILY),
      monthlyUsd: num(env.SAYAY_BUDGET_MONTHLY),
      sessionUsd: num(env.SAYAY_BUDGET_SESSION),
      perCallMaxUsd: num(env.SAYAY_BUDGET_PER_CALL),
      burnRateUsdPerMin: num(env.SAYAY_BUDGET_BURN_RATE),
      perStepCapUsd: num(env.SAYAY_BUDGET_PER_STEP),
      maxLoopRepeats: num(env.SAYAY_MAX_LOOP_REPEATS),
    },
    storageFile: env.SAYAY_STORAGE_FILE || '.sayay/ledger.json',
    userId: env.SAYAY_USER || 'opencode-user',
  };
}