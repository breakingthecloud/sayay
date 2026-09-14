import { SayayGuard } from '../index.js';
import type { SayayBudget, SayayDecision, SayayStorage } from '../index.js';
import { estimateCostFromUsage } from './claude-code.js';
import type { TokenUsage } from './claude-code.js';

export interface LangChainCall {
  id?: string;
  name?: string;
  type?: string;
  kwargs?: Record<string, unknown>;
}

export interface LangChainResponse {
  llmOutput?: {
    usage?: TokenUsage;
    tokenUsage?: TokenUsage;
    [key: string]: unknown;
  };
  generations?: unknown[];
}

export interface SayayLangChainOptions {
  budget: SayayBudget;
  storage: SayayStorage;
  userId: string;
  onExceeded?: 'allow' | 'warn' | 'degrade' | 'block';
  estimateTokens?: (prompts: string[]) => number;
}

export interface SayayCallbackHandlerLike {
  name: string;
  on_llm_start(serialized: Record<string, unknown>, prompts: string[], runId?: string): Promise<void>;
  on_llm_end(response: LangChainResponse, runId?: string): Promise<void>;
}

export function createSayayCallbackHandler(options: SayayLangChainOptions): SayayCallbackHandlerLike {
  const guard = new SayayGuard({
    storage: options.storage,
    budget: options.budget,
    onExceeded: options.onExceeded || 'block',
  });
  const userId = options.userId;
  const estimateTokens = options.estimateTokens || ((prompts: string[]) => prompts.join('').length / 4);
  const inputPrice = options.budget.credits === undefined ? 0.000003 : 0;

  return {
    name: 'sayay_budget',

    async on_llm_start(_serialized, prompts) {
      const tokens = estimateTokens(prompts);
      const estimatedCost = tokens * inputPrice;
      const decision: SayayDecision = await guard.check(userId, estimatedCost);
      if (decision.action === 'block') {
        throw new Error(`[sayay] Budget exceeded: ${decision.reason}`);
      }
    },

    async on_llm_end(response) {
      const usage = response.llmOutput?.usage ?? response.llmOutput?.tokenUsage;
      if (usage) {
        const cost = estimateCostFromUsage(usage);
        if (cost > 0) {
          await guard.record(userId, cost);
        }
      }
    },
  };
}