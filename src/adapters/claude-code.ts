import { readFileSync } from 'node:fs';
import { SayayGuard, FileStorage } from '../index.js';
import type { SayayAction, SayayBudget, SayayDecision } from '../index.js';

export interface TokenUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  costUSD?: number;
}

export interface ModelPrices {
  input: number;
  output: number;
  cacheReadFactor: number;
  cacheWriteFactor: number;
}

export const CLAUDE_MODEL_PRICES: Record<string, ModelPrices> = {
  'claude-opus': { input: 15, output: 75, cacheReadFactor: 0.1, cacheWriteFactor: 1.25 },
  'claude-sonnet': { input: 3, output: 15, cacheReadFactor: 0.1, cacheWriteFactor: 1.25 },
  'claude-haiku': { input: 1, output: 5, cacheReadFactor: 0.1, cacheWriteFactor: 1.25 },
  'claude': { input: 3, output: 15, cacheReadFactor: 0.1, cacheWriteFactor: 1.25 },
};

export const DEFAULT_PRICES = CLAUDE_MODEL_PRICES['claude'];

export function pricesForModel(model: string): ModelPrices {
  const lower = model.toLowerCase();
  for (const key of Object.keys(CLAUDE_MODEL_PRICES)) {
    if (lower.includes(key)) return CLAUDE_MODEL_PRICES[key];
  }
  return DEFAULT_PRICES;
}

export function estimateCostFromUsage(usage: TokenUsage, prices: ModelPrices = DEFAULT_PRICES): number {
  const input = usage.input_tokens || 0;
  const output = usage.output_tokens || 0;
  const cacheRead = usage.cache_read_input_tokens || 0;
  const cacheWrite = usage.cache_creation_input_tokens || 0;
  return (
    (input * prices.input +
      cacheRead * prices.input * prices.cacheReadFactor +
      cacheWrite * prices.input * prices.cacheWriteFactor +
      output * prices.output) /
    1_000_000
  );
}

export function sessionCostFromTranscript(transcriptPath: string): number {
  const raw = readFileSync(transcriptPath, 'utf8');
  let total = 0;
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    const message = entry.message as Record<string, unknown> | undefined;
    const usage = (message?.usage ?? entry.usage) as TokenUsage | undefined;
    if (!usage || typeof usage !== 'object') continue;
    if (typeof usage.costUSD === 'number') {
      total += usage.costUSD;
      continue;
    }
    const model = typeof entry.model === 'string' ? entry.model : '';
    total += estimateCostFromUsage(usage, pricesForModel(model));
  }
  return total;
}

export interface ClaudeHookInput {
  hook_event_name?: string;
  transcript_path?: string;
  cwd?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  session_id?: string;
}

export interface ClaudeCodeGuardOptions {
  budget: SayayBudget;
  storageFile: string;
  userId: string;
  maxSubagentsPerStep?: number;
}

export interface HaltResult {
  action: SayayAction;
  reason?: string;
  decision: SayayDecision;
  sessionCost: number;
  subagentsSpent: number;
}

export class ClaudeCodeGuard {
  private readonly guard: SayayGuard;
  private readonly ledger: FileStorage;
  private readonly userId: string;
  private readonly lastCostKey: string;
  private readonly maxSubagentsPerStep?: number;

  constructor(options: ClaudeCodeGuardOptions) {
    this.userId = options.userId;
    this.ledger = new FileStorage(options.storageFile);
    this.maxSubagentsPerStep = options.maxSubagentsPerStep;
    this.guard = new SayayGuard({
      storage: this.ledger,
      budget: options.budget,
      onExceeded: 'block',
    });
    this.lastCostKey = `sayay:${this.userId}:claude:lastcost`;
  }

  async resetSessionLedger(): Promise<void> {
    await this.ledger.reset(this.lastCostKey);
  }

  async haltCheck(sessionCost: number, estimatedNextCall?: number): Promise<HaltResult> {
    const last = await this.ledger.get(this.lastCostKey);
    const delta = Math.max(0, sessionCost - last);
    if (delta > 0) {
      await this.guard.record(this.userId, delta);
      await this.ledger.increment(this.lastCostKey, delta);
    }
    const decision = await this.guard.check(this.userId, estimatedNextCall || 0);
    return {
      action: decision.action,
      reason: decision.reason,
      decision,
      sessionCost,
      subagentsSpent: 0,
    };
  }

  async subagentSpawnCheck(stepId: string): Promise<HaltResult> {
    const key = `sayay:${this.userId}:subagents:${stepId}`;
    const spent = await this.ledger.increment(key, 1);
    let decision: SayayDecision;
    if (this.maxSubagentsPerStep !== undefined && spent > this.maxSubagentsPerStep) {
      decision = {
        action: 'block',
        reason: `Subagent fan-out cap reached (${spent - 1} spawned this step)`,
        remaining: 0,
        total: this.maxSubagentsPerStep,
        usagePercent: 100,
      };
    } else {
      decision = {
        action: 'allow',
        reason: undefined,
        remaining: this.maxSubagentsPerStep !== undefined ? this.maxSubagentsPerStep - spent : 0,
        total: this.maxSubagentsPerStep ?? 0,
        usagePercent: this.maxSubagentsPerStep ? Math.round((spent / this.maxSubagentsPerStep) * 100) : 0,
      };
    }
    return {
      action: decision.action,
      reason: decision.reason,
      decision,
      sessionCost: 0,
      subagentsSpent: spent,
    };
  }
}

export function configFromEnv(env: Record<string, string | undefined> = process.env): {
  budget: SayayBudget;
  storageFile: string;
  userId: string;
  maxSubagentsPerStep?: number;
} {
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
    userId: env.SAYAY_USER || 'claude-user',
    maxSubagentsPerStep: num(env.SAYAY_MAX_SUBAGENTS_PER_STEP),
  };
}

export function readHookInput(input: string): ClaudeHookInput {
  try {
    return JSON.parse(input) as ClaudeHookInput;
  } catch {
    return {};
  }
}