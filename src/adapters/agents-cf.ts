import { SayayGuard } from '../index.js';
import type { SayayAction, SayayBudget, SayayDecision, SayayStorage } from '../index.js';

export interface SayayAgentsPluginOptions {
  budget: SayayBudget;
  storage: SayayStorage;
  userId: string;
  onExceeded?: SayayAction;
  estimateCost?: (input: unknown) => number;
  costFromUsage?: (usage: unknown) => number;
}

export interface AgentsOnModelCallContext {
  env: Record<string, unknown>;
  state?: unknown;
}

export class SayayAgentsPlugin {
  readonly guard: SayayGuard;
  private readonly userId: string;
  private readonly estimateCost: (input: unknown) => number;
  private readonly costFromUsage: (usage: unknown) => number;

  constructor(options: SayayAgentsPluginOptions) {
    this.guard = new SayayGuard({
      storage: options.storage,
      budget: options.budget,
      onExceeded: options.onExceeded || 'block',
    });
    this.userId = options.userId;
    this.estimateCost = options.estimateCost || (() => 0);
    this.costFromUsage = options.costFromUsage || (() => 0);
  }

  async check(input: unknown): Promise<SayayDecision> {
    return this.guard.check(this.userId, this.estimateCost(input));
  }

  async record(usage: unknown): Promise<void> {
    const cost = this.costFromUsage(usage);
    if (cost > 0) {
      await this.guard.record(this.userId, cost);
    }
  }
}

export interface AgentClassLike {
  new (...args: unknown[]): {
    onModelCall(input: unknown, context: AgentsOnModelCallContext, callback: (input: unknown, context: AgentsOnModelCallContext) => Promise<unknown>): Promise<unknown>;
  };
}

export function withSayayBudget<Ctor extends AgentClassLike>(Agent: Ctor, plugin: SayayAgentsPlugin): Ctor {
  return class SayayBudgetedAgent extends (Agent as new (...args: unknown[]) => {
    onModelCall(input: unknown, context: AgentsOnModelCallContext, callback: (input: unknown, context: AgentsOnModelCallContext) => Promise<unknown>): Promise<unknown>;
  }) {
    constructor(...args: unknown[]) {
      super(...args);
    }

    async onModelCall(input: unknown, context: AgentsOnModelCallContext, callback: (input: unknown, context: AgentsOnModelCallContext) => Promise<unknown>): Promise<unknown> {
      const decision = await plugin.check(input);
      if (decision.action === 'block') {
        throw new Error(`[sayay] Budget exceeded: ${decision.reason}`);
      }
      const result = await callback(input, context);
      const usage = (result as Record<string, unknown> | null | undefined)?.usage;
      await plugin.record(usage);
      return result;
    }
  } as unknown as Ctor;
}