import { SayayGuard } from '../index.js';
import type { SayayAction, SayayBudget, SayayDecision, SayayStorage } from '../index.js';

export interface BedrockInvokeParams {
  modelId: string;
  messages: unknown[];
  [key: string]: unknown;
}

export interface BedrockInvokeResponse {
  output?: { message?: { usage?: unknown } };
  usage?: unknown;
  [key: string]: unknown;
}

export interface BedrockClientLike {
  invokeModel(params: BedrockInvokeParams): Promise<BedrockInvokeResponse>;
}

export interface SayayBedrockOptions {
  client: BedrockClientLike;
  budget: SayayBudget;
  storage: SayayStorage;
  userId: string;
  onExceeded?: SayayAction;
  estimateCost?: (params: BedrockInvokeParams) => number;
  costFromUsage?: (usage: unknown) => number;
}

export function createGuardedBedrock(options: SayayBedrockOptions) {
  const guard = new SayayGuard({
    storage: options.storage,
    budget: options.budget,
    onExceeded: options.onExceeded || 'block',
  });
  const userId = options.userId;
  const estimateCost = options.estimateCost || (() => 0);
  const costFromUsage = options.costFromUsage || (() => 0);

  async function guardedInvoke(params: BedrockInvokeParams): Promise<BedrockInvokeResponse> {
    const decision: SayayDecision = await guard.check(userId, estimateCost(params));
    if (decision.action === 'block') {
      throw new Error(`[sayay] Budget exceeded: ${decision.reason}`);
    }
    const response = await options.client.invokeModel(params);
    const usage = response.output?.message?.usage ?? response.usage;
    const cost = costFromUsage(usage);
    if (cost > 0) {
      await guard.record(userId, cost);
    }
    return response;
  }

  return { guardedInvoke, guard };
}