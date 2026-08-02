/**
 * Sayay — AI Agent Cost Guardrails
 *
 * Budget enforcement middleware for LLM calls.
 * Check BEFORE each call, record AFTER each call.
 * Supports: USD budgets, credit systems, per-user/session/daily/monthly.
 *
 * Zero dependencies. Works in CF Workers, Lambda, Node.js.
 * Extracted from SOFE (sofe-api rate limits + sofe-ai credit deduction).
 *
 * Name: "Sayay" (Quechua) = "to stop/detain" — stops runaway AI costs.
 */

// ─── Types ──────────────────────────────────────────────────────────────

export type SayayAction = 'allow' | 'warn' | 'degrade' | 'block';

export interface SayayBudget {
  /** Max spend per day in USD (resets at midnight UTC) */
  dailyUsd?: number;
  /** Max spend per month in USD (resets 1st of month) */
  monthlyUsd?: number;
  /** Max spend per session (never resets until explicit clear) */
  sessionUsd?: number;
  /** Max cost for a single call (blocks expensive calls) */
  perCallMaxUsd?: number;
  /** Credit-based: total credits allocated */
  credits?: number;
  /** Credit cost per call (default: 1) */
  creditsPerCall?: number;
}

export interface SayayConfig {
  /** Storage backend for tracking usage */
  storage: SayayStorage;
  /** Budget limits */
  budget: SayayBudget;
  /** What to do when budget exceeded (default: 'block') */
  onExceeded?: SayayAction;
  /** Threshold % to start warning (default: 80) */
  warnThreshold?: number;
  /** Threshold % to start degrading (default: 95) */
  degradeThreshold?: number;
  /** Cheaper model to suggest when degrading */
  degradeToModel?: string;
  /** Called on every decision (for observability) */
  onDecision?: (userId: string, decision: SayayDecision) => void;
  /**
   * Optional: emit a CloudWatch metric per decision.
   * Requires `@aws-sdk/client-cloudwatch` installed by the consumer.
   * Config: `{ metricNamespace?: string; region?: string }`
   */
  cloudWatch?: { metricNamespace?: string; region?: string };
}

export interface SayayDecision {
  /** What the guard decided */
  action: SayayAction;
  /** Human-readable reason */
  reason?: string;
  /** Remaining budget (USD or credits) */
  remaining: number;
  /** Total budget (USD or credits) */
  total: number;
  /** Usage percentage (0-100) */
  usagePercent: number;
  /** Suggested model if degraded */
  suggestedModel?: string;
}

export interface SayayUsage {
  daily: number;
  monthly: number;
  session: number;
  credits?: number;
}

// ─── Storage Interface ──────────────────────────────────────────────────

/**
 * Storage backend for Sayay. Implement this for your infra:
 * - MemoryStorage (built-in, for testing)
 * - DynamoStorage (built-in, optional AWS dep)
 * - KVStorage (Cloudflare KV)
 * - RedisStorage (Redis/Upstash)
 * - FirestoreStorage (Firebase)
 */
export interface SayayStorage {
  /** Get current value for a key */
  get(key: string): Promise<number>;
  /** Increment a key by amount, return new value. Set TTL if provided (seconds). */
  increment(key: string, amount: number, ttlSeconds?: number): Promise<number>;
  /** Reset a key to 0 */
  reset(key: string): Promise<void>;
}

// ─── Errors ─────────────────────────────────────────────────────────────

/**
 * Base error raised when a budget limit is hit.
 * Consumers can extend this to match `ErrorEquals` in AWS Step Functions.
 */
export class BudgetExceededError extends Error {
  constructor(
    message: string,
    /** The userId that exceeded the budget */
    public readonly userId: string,
    /** Remaining budget at time of throw (USD or credits) */
    public readonly remaining: number,
    /** Total budget (USD or credits) */
    public readonly total: number,
    /** Budget scope that was exceeded */
    public readonly scope: 'daily' | 'monthly' | 'session' | 'credits' | 'perCall' | 'budget',
  ) {
    super(message);
    this.name = 'BudgetExceededError';
  }
}

/**
 * Native exception raised when a thread/agent has consumed a critical
 * threshold of USD or accumulated tokens. In AWS Step Functions, matching
 * `ErrorEquals: ["TokenBudgetExceededException"]` in a Catch block instantly
 * jumps to the error handler, stopping the workflow before retries rack up
 * more cost.
 *
 * Backward-compatible: extends `BudgetExceededError`, so existing
 * `instanceof BudgetExceededError` checks keep working.
 */
export class TokenBudgetExceededException extends BudgetExceededError {
  constructor(
    userId: string,
    remaining: number,
    total: number,
    scope: 'daily' | 'monthly' | 'session' | 'credits' | 'perCall' | 'budget',
    /** USD or accumulated tokens that triggered the threshold */
    reason: string,
  ) {
    super(reason, userId, remaining, total, scope);
    this.name = 'TokenBudgetExceededException';
  }
}

// ─── Built-in Memory Storage ────────────────────────────────────────────

export class MemoryStorage implements SayayStorage {
  private store = new Map<string, { value: number; expires?: number }>();

  async get(key: string): Promise<number> {
    const entry = this.store.get(key);
    if (!entry) return 0;
    if (entry.expires && Date.now() > entry.expires) {
      this.store.delete(key);
      return 0;
    }
    return entry.value;
  }

  async increment(key: string, amount: number, ttlSeconds?: number): Promise<number> {
    const current = await this.get(key);
    const newValue = current + amount;
    this.store.set(key, {
      value: newValue,
      expires: ttlSeconds ? Date.now() + ttlSeconds * 1000 : undefined,
    });
    return newValue;
  }

  async reset(key: string): Promise<void> {
    this.store.delete(key);
  }
}

// ─── DynamoDB Storage ───────────────────────────────────────────────────

export interface DynamoStorageOptions {
  /** DynamoDB table name */
  tableName: string;
  /** AWS region (default: us-east-1) */
  region?: string;
  /** Table's partition key name (default: 'pk') */
  partitionKey?: string;
  /** Attribute holding the numeric value (default: 'value') */
  valueKey?: string;
  /** Attribute for TTL in seconds-since-epoch (default: 'ttl') */
  ttlKey?: string;
  /** Optional pre-built DynamoDBDocumentClient (from @aws-sdk/lib-dynamodb) */
  client?: any;
}

/**
 * DynamoDB-backed `SayayStorage`. Enables the "Sayay = Cost Guardrail in
 * Lambda + DynamoDB" story: a real-time token/cost ledger per customer/session
 * that survives across Lambda warm starts.
 *
 * Optional dependency: requires `@aws-sdk/lib-dynamodb` + `@aws-sdk/client-dynamodb`.
 * Lazy-imported, so the package keeps zero hard dependencies.
 *
 * Recommended table schema:
 *   - Partition key `pk` (S) — e.g. `sayay:user123:daily:2026-08-02`
 *   - `value` (N) — running total
 *   - `ttl` (N) — epoch seconds; enable DynamoDB TTL on this attribute for auto-expiry
 */
export class DynamoStorage implements SayayStorage {
  private client: any;
  private readonly tableName: string;
  private readonly partitionKey: string;
  private readonly valueKey: string;
  private readonly ttlKey: string;
  private readonly region?: string;

  constructor(options: DynamoStorageOptions) {
    this.tableName = options.tableName;
    this.partitionKey = options.partitionKey || 'pk';
    this.valueKey = options.valueKey || 'value';
    this.ttlKey = options.ttlKey || 'ttl';
    this.region = options.region || 'us-east-1';
    this.client = options.client;
  }

  private async getClient(): Promise<any> {
    if (this.client) return this.client;
    try {
      const [{ DynamoDBDocumentClient }, { DynamoDBClient }] = await Promise.all([
        import('@aws-sdk/lib-dynamodb'),
        import('@aws-sdk/client-dynamodb'),
      ]);
      this.client = DynamoDBDocumentClient.from(new DynamoDBClient({ region: this.region }));
      return this.client;
    } catch {
      throw new Error(
        'DynamoStorage requires @aws-sdk/lib-dynamodb + @aws-sdk/client-dynamodb. Install with: npm install @aws-sdk/lib-dynamodb @aws-sdk/client-dynamodb'
      );
    }
  }

  async get(key: string): Promise<number> {
    const client = await this.getClient();
    const { GetCommand } = await import('@aws-sdk/lib-dynamodb');
    const res = await client.send(
      new GetCommand({ TableName: this.tableName, Key: { [this.partitionKey]: key } }),
    );
    const value = res.Item?.[this.valueKey];
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  }

  async increment(key: string, amount: number, ttlSeconds?: number): Promise<number> {
    const client = await this.getClient();
    const { UpdateCommand } = await import('@aws-sdk/lib-dynamodb');

    const UpdateExpression = `ADD #v :amt ${ttlSeconds ? ', #ttl :ttl' : ''}`;
    const ExpressionAttributeNames: Record<string, string> = { '#v': this.valueKey };
    const ExpressionAttributeValues: Record<string, unknown> = { ':amt': amount };
    if (ttlSeconds) {
      ExpressionAttributeNames['#ttl'] = this.ttlKey;
      ExpressionAttributeValues[':ttl'] = Math.floor(Date.now() / 1000) + ttlSeconds;
    }

    const res = await client.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { [this.partitionKey]: key },
        UpdateExpression,
        ExpressionAttributeNames,
        ExpressionAttributeValues,
        ReturnValues: 'UPDATED_NEW',
      }),
    );
    return Number(res.Attributes?.[this.valueKey] ?? 0);
  }

  async reset(key: string): Promise<void> {
    const client = await this.getClient();
    const { DeleteCommand } = await import('@aws-sdk/lib-dynamodb');
    await client.send(
      new DeleteCommand({ TableName: this.tableName, Key: { [this.partitionKey]: key } }),
    );
  }
}

// ─── Guard ──────────────────────────────────────────────────────────────

export class SayayGuard {
  private config: SayayConfig & { onExceeded: SayayAction; warnThreshold: number; degradeThreshold: number };

  constructor(config: SayayConfig) {
    this.config = {
      onExceeded: 'block',
      warnThreshold: 80,
      degradeThreshold: 95,
      ...config,
    };
  }

  /**
   * Check if a user can make an LLM call.
   * Call this BEFORE each inference request.
   */
  async check(userId: string, estimatedCostUsd?: number): Promise<SayayDecision> {
    const { budget, storage } = this.config;
    const cost = estimatedCostUsd || 0;

    // ── Credit-based check ──
    if (budget.credits !== undefined) {
      const used = await storage.get(this.key(userId, 'credits'));
      const remaining = budget.credits - used;
      const costInCredits = budget.creditsPerCall || 1;

      if (remaining < costInCredits) {
        return this.decide(userId, 'block', remaining, budget.credits, 'Credits exhausted');
      }

      const usagePercent = (used / budget.credits) * 100;
      if (usagePercent >= this.config.degradeThreshold) {
        return this.decide(userId, 'degrade', remaining, budget.credits, `${Math.round(usagePercent)}% credits used`);
      }
      if (usagePercent >= this.config.warnThreshold) {
        return this.decide(userId, 'warn', remaining, budget.credits, `${Math.round(usagePercent)}% credits used`);
      }
      return this.decide(userId, 'allow', remaining, budget.credits);
    }

    // ── USD-based checks ──

    // Per-call max
    if (budget.perCallMaxUsd && cost > budget.perCallMaxUsd) {
      return this.decide(userId, 'block', 0, budget.perCallMaxUsd, `Single call $${cost.toFixed(4)} exceeds per-call max $${budget.perCallMaxUsd}`);
    }

    // Daily budget
    if (budget.dailyUsd) {
      const dailyUsed = await storage.get(this.key(userId, 'daily'));
      const remaining = budget.dailyUsd - dailyUsed;

      if (remaining <= 0) {
        return this.decide(userId, this.config.onExceeded, remaining, budget.dailyUsd, 'Daily budget exhausted');
      }
      if (cost > remaining) {
        return this.decide(userId, 'warn', remaining, budget.dailyUsd, `Call ($${cost.toFixed(4)}) would exceed remaining daily budget ($${remaining.toFixed(4)})`);
      }

      const usagePercent = (dailyUsed / budget.dailyUsd) * 100;
      if (usagePercent >= this.config.degradeThreshold) {
        return this.decide(userId, 'degrade', remaining, budget.dailyUsd, `${Math.round(usagePercent)}% daily budget used`);
      }
      if (usagePercent >= this.config.warnThreshold) {
        return this.decide(userId, 'warn', remaining, budget.dailyUsd, `${Math.round(usagePercent)}% daily budget used`);
      }
    }

    // Monthly budget
    if (budget.monthlyUsd) {
      const monthlyUsed = await storage.get(this.key(userId, 'monthly'));
      const remaining = budget.monthlyUsd - monthlyUsed;

      if (remaining <= 0) {
        return this.decide(userId, this.config.onExceeded, remaining, budget.monthlyUsd, 'Monthly budget exhausted');
      }

      const usagePercent = (monthlyUsed / budget.monthlyUsd) * 100;
      if (usagePercent >= this.config.degradeThreshold) {
        return this.decide(userId, 'degrade', remaining, budget.monthlyUsd, `${Math.round(usagePercent)}% monthly budget used`);
      }
      if (usagePercent >= this.config.warnThreshold) {
        return this.decide(userId, 'warn', remaining, budget.monthlyUsd, `${Math.round(usagePercent)}% monthly budget used`);
      }
    }

    // All checks passed
    const total = budget.dailyUsd || budget.monthlyUsd || 0;
    return this.decide(userId, 'allow', total, total);
  }

  /**
   * Check budget and throw `TokenBudgetExceededException` when the decision
   * would be `'block'`. Drop-in for AWS Step Functions: pair with
   * `ErrorEquals: ["TokenBudgetExceededException"]` in a Catch block.
   *
   * Returns the decision for `'allow'`, `'warn'`, and `'degrade'` — same as
   * `check()`. Only the blocking case throws.
   */
  async checkOrThrow(userId: string, estimatedCostUsd?: number): Promise<SayayDecision> {
    const decision = await this.check(userId, estimatedCostUsd);
    if (decision.action === 'block') {
      throw new TokenBudgetExceededException(
        userId,
        decision.remaining,
        decision.total,
        'budget',
        decision.reason || 'Budget exceeded',
      );
    }
    return decision;
  }

  /**
   * Record actual cost after an LLM call completes.
   * Call this AFTER each inference request.
   */
  async record(userId: string, costUsd: number, creditsUsed?: number): Promise<void> {
    const { budget, storage } = this.config;

    if (budget.credits !== undefined) {
      const credits = creditsUsed || budget.creditsPerCall || 1;
      await storage.increment(this.key(userId, 'credits'), credits);
      return;
    }

    // Record to all applicable buckets
    if (budget.dailyUsd) {
      const secondsUntilMidnight = this.secondsUntilMidnightUTC();
      await storage.increment(this.key(userId, 'daily'), costUsd, secondsUntilMidnight);
    }
    if (budget.monthlyUsd) {
      const secondsUntilEndOfMonth = this.secondsUntilEndOfMonth();
      await storage.increment(this.key(userId, 'monthly'), costUsd, secondsUntilEndOfMonth);
    }
    if (budget.sessionUsd) {
      await storage.increment(this.key(userId, 'session'), costUsd);
    }
  }

  /**
   * Get current usage for a user.
   */
  async getUsage(userId: string): Promise<SayayUsage> {
    const { storage, budget } = this.config;
    return {
      daily: await storage.get(this.key(userId, 'daily')),
      monthly: await storage.get(this.key(userId, 'monthly')),
      session: await storage.get(this.key(userId, 'session')),
      credits: budget.credits !== undefined ? await storage.get(this.key(userId, 'credits')) : undefined,
    };
  }

  /**
   * Reset usage for a user (manual reset or monthly cron).
   */
  async reset(userId: string, scope: 'daily' | 'monthly' | 'session' | 'credits' | 'all'): Promise<void> {
    const { storage } = this.config;
    if (scope === 'all') {
      await storage.reset(this.key(userId, 'daily'));
      await storage.reset(this.key(userId, 'monthly'));
      await storage.reset(this.key(userId, 'session'));
      await storage.reset(this.key(userId, 'credits'));
    } else {
      await storage.reset(this.key(userId, scope));
    }
  }

  // ─── Private ────────────────────────────────────────────────────────

  private key(userId: string, scope: string): string {
    const date = new Date();
    if (scope === 'daily') return `sayay:${userId}:daily:${date.toISOString().split('T')[0]}`;
    if (scope === 'monthly') return `sayay:${userId}:monthly:${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    return `sayay:${userId}:${scope}`;
  }

  private decide(userId: string, action: SayayAction, remaining: number, total: number, reason?: string): SayayDecision {
    const usagePercent = total > 0 ? Math.round(((total - remaining) / total) * 100) : 0;
    const decision: SayayDecision = {
      action,
      remaining: Math.max(0, remaining),
      total,
      usagePercent,
      reason,
      suggestedModel: action === 'degrade' ? this.config.degradeToModel : undefined,
    };

    if (this.config.onDecision) {
      this.config.onDecision(userId, decision);
    }

    if (this.config.cloudWatch) {
      this.emitCloudWatch(userId, decision).catch((err) => {
        // Observability must never break the guard path.
        console.error('[sayay] CloudWatch emit failed:', err?.message || err);
      });
    }

    return decision;
  }

  private async emitCloudWatch(userId: string, decision: SayayDecision): Promise<void> {
    const { metricNamespace = 'Sayay', region = 'us-east-1' } = this.config.cloudWatch || {};
    let CloudWatchClient: any;
    let PutMetricDataCommand: any;
    try {
      const mod = await import('@aws-sdk/client-cloudwatch');
      CloudWatchClient = mod.CloudWatchClient;
      PutMetricDataCommand = mod.PutMetricDataCommand;
    } catch {
      throw new Error(
        'Sayay cloudWatch option requires @aws-sdk/client-cloudwatch. Install it with: npm install @aws-sdk/client-cloudwatch'
      );
    }

    const client = new CloudWatchClient({ region });
    await client.send(
      new PutMetricDataCommand({
        Namespace: metricNamespace,
        MetricData: [
          {
            MetricName: 'Decision',
            Value: 1,
            Unit: 'Count',
            Dimensions: [
              { Name: 'UserId', Value: userId },
              { Name: 'Action', Value: decision.action },
            ],
          },
          {
            MetricName: 'RemainingBudget',
            Value: decision.remaining,
            Unit: 'Count',
            Dimensions: [{ Name: 'UserId', Value: userId }],
          },
          {
            MetricName: 'UsagePercent',
            Value: decision.usagePercent,
            Unit: 'Percent',
            Dimensions: [{ Name: 'UserId', Value: userId }],
          },
        ],
      }),
    );
  }

  private secondsUntilMidnightUTC(): number {
    const now = new Date();
    const midnight = new Date(now);
    midnight.setUTCDate(midnight.getUTCDate() + 1);
    midnight.setUTCHours(0, 0, 0, 0);
    return Math.floor((midnight.getTime() - now.getTime()) / 1000);
  }

  private secondsUntilEndOfMonth(): number {
    const now = new Date();
    const endOfMonth = new Date(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
    return Math.floor((endOfMonth.getTime() - now.getTime()) / 1000);
  }
}
