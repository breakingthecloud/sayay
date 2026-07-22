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

    return decision;
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
