import type { SayayAction, SayayDecision } from './index.js';

/**
 * Sayay → Qhaway integration.
 *
 * Writes one QhawaySpan per Sayay decision (`tool_name: "sayay.check"`) so the
 * Qhaway metrics pipeline (`qhaway_sayay_decisions_total`) and Grafana
 * "Budget Guardrails" panel can show allow/warn/degrade/block activity.
 *
 * Keeps Sayay zero-dependency: the storage is structurally compatible with
 * `QhawayStorage` from `@carloscortezcloud/qhaway`, so pass any Qhaway storage
 * (MemoryStorage, ConsoleStorage, D1Storage, KVStorage, …) without Sayay
 * importing Qhaway at compile time.
 */

export interface SayayQhawaySpan {
  id: string;
  timestamp: string;
  model: string;
  provider: string;
  latency_ms: number;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  user_id?: string;
  session_id?: string;
  agent_id?: string;
  tool_name?: string;
  success: boolean;
  error?: string;
  rating?: 1 | -1 | 0;
  metadata?: Record<string, unknown>;
}

/** Structural subset of `QhawayStorage` — anything with a `write` works. */
export interface SayayQhawayStorage {
  write(span: SayayQhawaySpan): Promise<void>;
}

export interface SayayQhawayPluginOptions {
  /** Qhaway-compatible storage to write spans into. */
  storage: SayayQhawayStorage;
  /** Labels applied to every span (recommended for multi-agent apps). */
  agentId?: string;
  /** Session id stamped on spans (same session id as Qhaway-010/Tinkuy feedback). */
  sessionId?: string;
  /** Budget identifier stamped in `metadata.budgetKey` (default: 'sayay'). */
  budgetKey?: string;
}

/**
 * Wires `SayayGuard.onDecision` into Qhaway. Pass the returned handler as the
 * guard's `onDecision` callback:
 *
 * ```ts
 * const qhaway = new SayayQhawayPlugin({ storage, agentId: 'my-agent' });
 * const guard = new SayayGuard({
 *   storage: new MemoryStorage(),
 *   budget: { dailyUsd: 10 },
 *   onDecision: qhaway.onDecision,
 * });
 * ```
 */
export class SayayQhawayPlugin {
  private readonly storage: SayayQhawayStorage;
  private readonly agentId?: string;
  private readonly sessionId?: string;
  private readonly budgetKey: string;

  constructor(options: SayayQhawayPluginOptions) {
    this.storage = options.storage;
    this.agentId = options.agentId;
    this.sessionId = options.sessionId;
    this.budgetKey = options.budgetKey || 'sayay';
  }

  /** `onDecision` handler for `SayayGuard` config. */
  onDecision = (userId: string, decision: SayayDecision): void => {
    const span: SayayQhawaySpan = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      model: 'budget-guard',
      provider: 'sayay',
      latency_ms: 0,
      tokens_in: 0,
      tokens_out: 0,
      cost_usd: 0,
      user_id: userId,
      agent_id: this.agentId,
      session_id: this.sessionId,
      tool_name: 'sayay.check',
      success: true,
      metadata: this.toMetadata(decision),
    };
    this.storage.write(span).catch((err: unknown) => {
      // Observability must never break the guard path (same policy as CloudWatch emit).
      console.error('[sayay-qhaway] span write failed:', err instanceof Error ? err.message : err);
    });
  };

  private toMetadata(decision: SayayDecision): Record<string, unknown> {
    const spent = Math.max(0, decision.total - decision.remaining);
    return {
      action: decision.action,
      budgetKey: this.budgetKey,
      spent,
      limit: decision.total,
      usagePercent: decision.usagePercent,
      suggestedModel: decision.suggestedModel,
      reason: decision.reason,
    };
  }
}

/**
 * Builds a Prometheus line for the Qhaway metric `qhaway_sayay_decisions_total`.
 * Kept here so the plugin is self-describing; the canonical emission lives in
 * the Qhaway metrics pipeline (`generatePrometheusMetrics`).
 */
export function sayayDecisionMetric(action: SayayAction, userId: string, count: number): string {
  return `qhaway_sayay_decisions_total{action="${action}",user="${userId}"} ${count}`;
}
