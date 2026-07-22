# ⚓ Sayay — AI Agent Cost Guardrails

Budget enforcement middleware for LLM calls. Prevent runaway AI costs with per-user daily/monthly/session budgets or credit systems. Zero dependencies.

## Install

```bash
npm install github:breakingthecloud/sayay
```

## Quick Start

```typescript
import { SayayGuard, MemoryStorage } from 'sayay';

const guard = new SayayGuard({
  storage: new MemoryStorage(),
  budget: { dailyUsd: 5.00, monthlyUsd: 50.00 },
  onExceeded: 'block',
  degradeToModel: 'meta-llama/llama-3.3-70b-instruct:free',
});

// Before LLM call:
const decision = await guard.check('user-123', 0.003); // estimated cost
if (decision.action === 'block') {
  throw new Error(`Budget exceeded: ${decision.reason}`);
}
if (decision.action === 'degrade') {
  // Use decision.suggestedModel instead of expensive model
}

// After LLM call:
await guard.record('user-123', 0.0025); // actual cost
```

## Credit-Based System

```typescript
const guard = new SayayGuard({
  storage: new MemoryStorage(),
  budget: { credits: 50, creditsPerCall: 1 },
  onExceeded: 'block',
  warnThreshold: 80,  // warn at 80% used
});

// Deducts 1 credit per call
await guard.record('user-123', 0, 1);

// Check remaining
const usage = await guard.getUsage('user-123');
console.log(`Credits used: ${usage.credits}/50`);
```

## Actions

| Action | What happens |
|--------|-------------|
| `allow` | Call proceeds normally |
| `warn` | Call proceeds, but threshold reached (log it) |
| `degrade` | Call proceeds with cheaper model (`decision.suggestedModel`) |
| `block` | Call rejected, return error to user |

## Thresholds

```
0%────────80%──────95%──────100%
  allow    │  warn  │degrade│ block
```

Configurable via `warnThreshold` and `degradeThreshold`.

## Storage Adapters

Sayay needs a storage backend to track usage. Built-in: `MemoryStorage` (for testing).

For production, implement `SayayStorage`:

```typescript
// Cloudflare KV example:
class KVStorage implements SayayStorage {
  constructor(private kv: KVNamespace) {}
  async get(key: string) { return parseFloat(await this.kv.get(key) || '0'); }
  async increment(key: string, amount: number, ttl?: number) {
    const current = await this.get(key);
    const newVal = current + amount;
    await this.kv.put(key, String(newVal), ttl ? { expirationTtl: ttl } : undefined);
    return newVal;
  }
  async reset(key: string) { await this.kv.delete(key); }
}
```

## Integration with Styrr

```typescript
import { StyrRouter } from 'styrr';
import { SayayGuard, MemoryStorage } from 'sayay';

const guard = new SayayGuard({ storage: new MemoryStorage(), budget: { dailyUsd: 10 } });
const router = new StyrRouter({ apiKey: '...', models: [...] });

async function safeLLMCall(userId: string, prompt: string) {
  const decision = await guard.check(userId, 0.005);
  if (decision.action === 'block') throw new Error(decision.reason);

  const result = await router.prompt(prompt);
  await guard.record(userId, result.usage?.totalTokens ? result.usage.totalTokens * 0.000001 : 0.003);
  return result;
}
```

## Name

**Sayay** (Quechua) = "to stop/detain" — stops your AI costs from running away.

## Part of the FinOptix OSS Ecosystem

- 🧭 **Styrr** — LLM Router
- ⚓ **Sayay** — Agent Cost Guardrails (this package)
- 🌊 **Tinkuy** — Agentic Framework
- 👁️ **Qhaway** — Agent Observability
- 🗺️ **Ñan** — Architecture Graph

## License

Apache 2.0
