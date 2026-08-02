<p align="center">
  <img alt="Sayay" src="https://img.shields.io/badge/⚓-Sayay-F59E0B?style=for-the-badge" height="50">
</p>

<p align="center">
  <b>AI Agent Cost Guardrails</b><br>
  Budget enforcement middleware for LLM calls. Prevent runaway AI costs.
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a>
  ·
  <a href="#actions">Actions</a>
  ·
  <a href="#storage">Storage</a>
  ·
  <a href="#ecosystem">Ecosystem</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-Apache_2.0-F59E0B?style=flat-square" alt="License">
  <img src="https://img.shields.io/badge/TypeScript-5.5%2B-3178C6?style=flat-square&logo=typescript" alt="TypeScript">
  <img src="https://img.shields.io/badge/dependencies-0-success?style=flat-square" alt="Zero deps">
  <img src="https://img.shields.io/badge/PRs-welcome-brightgreen?style=flat-square" alt="PRs">
</p>

---

## What Is Sayay?

Sayay (Quechua: "to stop/detain") stops your AI costs from running away. Set per-user daily/monthly budgets or credit systems. Before every LLM call, Sayay decides: allow, warn, degrade, or block.

```typescript
import { SayayGuard, MemoryStorage } from 'sayay';

const guard = new SayayGuard({
  storage: new MemoryStorage(),
  budget: { dailyUsd: 5.00, monthlyUsd: 50.00 },
  onExceeded: 'block',
  degradeToModel: 'meta-llama/llama-3.3-70b-instruct:free',
});

// Before LLM call:
const decision = await guard.check('user-123', 0.003);
if (decision.action === 'block') {
  throw new Error(`Budget exceeded: ${decision.reason}`);
}
if (decision.action === 'degrade') {
  // Use decision.suggestedModel instead of expensive model
}

// After LLM call:
await guard.record('user-123', 0.0025);
```

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

const decision = await guard.check('user-123', 0.003);
console.log(decision.action); // 'allow' | 'warn' | 'degrade' | 'block'
```

## Actions

| Action | What happens |
|--------|--------------|
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

## Credit-Based System

```typescript
const guard = new SayayGuard({
  storage: new MemoryStorage(),
  budget: { credits: 50, creditsPerCall: 1 },
  onExceeded: 'block',
  warnThreshold: 80,
});

await guard.record('user-123', 0, 1);

const usage = await guard.getUsage('user-123');
console.log(`Credits used: ${usage.credits}/50`);
```

## Storage Adapters

Sayay needs a storage backend to track usage. Built-in: `MemoryStorage` (testing) and `DynamoStorage` (DynamoDB, optional AWS dependency).

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

### DynamoStorage (optional)

Real-time token/cost ledger per customer/session in DynamoDB — survives Lambda warm
starts and is the "Sayay = Cost Guardrail in Lambda + DynamoDB" pattern. Requires
`@aws-sdk/lib-dynamodb` + `@aws-sdk/client-dynamodb` (lazy-imported, so the package
keeps zero hard dependencies).

```typescript
import { SayayGuard, DynamoStorage } from '@carloscortezcloud/sayay-guard';

// Table: partition key `pk` (S), attribute `value` (N), TTL on `ttl` (N)
const guard = new SayayGuard({
  storage: new DynamoStorage({ tableName: 'sayay-ledger', region: 'us-east-1' }),
  budget: { dailyUsd: 10 },
});
```

## Step Functions: TokenBudgetExceededException

Use `checkOrThrow()` to raise a native exception when the budget is exhausted.
In AWS Step Functions, matching `ErrorEquals: ["TokenBudgetExceededException"]`
in a Catch block instantly jumps to the error handler — stopping the workflow
before retries rack up more cost.

```typescript
import { SayayGuard, MemoryStorage } from '@carloscortezcloud/sayay-guard';

const guard = new SayayGuard({ storage: new MemoryStorage(), budget: { dailyUsd: 10 } });

// Throws TokenBudgetExceededException on block; returns decision otherwise
const decision = await guard.checkOrThrow('user-42', 0.005);
```

```jsonc
// ASL snippet
"Catch": [
  {
    "ErrorEquals": ["TokenBudgetExceededException"],
    "Next": "HandleBudgetExceeded"
  }
]
```

`TokenBudgetExceededException` extends `BudgetExceededError`, so existing
`instanceof BudgetExceededError` checks keep working (backward compatible).

## CloudWatch observability (optional)

Pass `cloudWatch` in config to emit a metric per decision. Requires
`@aws-sdk/client-cloudwatch` (lazy-imported). Emits `Decision`, `RemainingBudget`,
and `UsagePercent` metrics under the `Sayay` namespace (configurable).

```typescript
const guard = new SayayGuard({
  storage,
  budget: { dailyUsd: 10 },
  cloudWatch: { metricNamespace: 'MyApp', region: 'us-east-1' },
});
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
  await guard.record(userId, result.usage?.totalTokens || 0.003);
  return result;
}
```

## Ecosystem

| Package | Role | npm |
|---------|------|-----|
| **Sayay** | Cost guardrails (this) | GitHub |
| **Styrr** | LLM router | `styrr` |
| **Tinkuy** | Agent framework | `@carloscortezcloud/tinkuy-agent` |
| **Qhaway** | Agent observability | `@carloscortezcloud/qhaway` |
| **TideRAG** | Edge RAG pipeline | `@carloscortezcloud/tiderag` |

## License

Apache 2.0 — see [LICENSE](LICENSE).

---

<p align="center">
  Built by engineers who got tired of surprise AWS bills.<br>
  <a href="https://github.com/breakingthecloud/tinkuylabs">Tinkuy Labs</a> · <a href="https://finoptix.dev">finoptix.dev</a>
</p>
<p align="center">
  <sub>Your AI costs should have a stop button. Sayay is that button.</sub>
</p>
