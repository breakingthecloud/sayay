# Sayay Runtime Guides (cloud)

Enforcement runs **in-process** (check before, record after) — no proxy, no base
URL rewrite, works in any stack that lets you wrap the model call. Storage is any
`SayayStorage` already in your infra.

```
ANTES de cada LLM call → guard.check(userId, estCost) → allow | warn | degrade | block
DESPUÉS del call       → guard.record(userId, realCost)  (tokens reales del response)
Storage                → KV / D1 / Redis / DynamoDB (lo que ya exista)
```

## Cloudflare Agents SDK (`@cloudflare/agents`)

Override `onModelCall` (the documented interception point) with
`withSayayBudget`:

```ts
import { Agent } from '@cloudflare/agents';
import { SayayAgentsPlugin, withSayayBudget } from '@carloscortezcloud/sayay-guard/agents-cf';
import { KVStorage } from '@carloscortezcloud/sayay-guard/storage';

const plugin = new SayayAgentsPlugin({
  budget: { dailyUsd: 5 },
  storage: new KVStorage(env.MY_KV),
  userId: 'tenant-1',
});

class MyAgent extends withSayayBudget(Agent, plugin) {}
```

## Bedrock AgentCore (AWS)

`createGuardedBedrock` wraps `invokeModel` in the agent harness (AgentCore is
managed — the harness is yours):

```ts
import { createGuardedBedrock } from '@carloscortezcloud/sayay-guard/bedrock';
import { DynamoStorage } from '@carloscortezcloud/sayay-guard';

const { guardedInvoke } = createGuardedBedrock({
  client: bedrockClient,
  budget: { dailyUsd: 50 },
  storage: new DynamoStorage({ tableName: 'sayay-ledger', region: 'us-east-1' }),
  userId: tenantId,
});

const res = await guardedInvoke({ modelId: 'anthropic.claude-sonnet-4', messages });
```

Bedrock returns exact usage → pass `costFromUsage` to price it. Multi-tenant
native: `guard.check(tenantId, ...)`.

## LangChain

Pass the duck-typed handler as a `BaseCallbackHandler` (no `langchain` dependency
in Sayay):

```ts
import { createSayayCallbackHandler } from '@carloscortezcloud/sayay-guard/langchain';
import { MemoryStorage } from '@carloscortezcloud/sayay-guard';

const chain = llmChain({ callbacks: [createSayayCallbackHandler({
  budget: { dailyUsd: 5 },
  storage: new MemoryStorage(),
  userId: 'u1',
})] });
```

`on_llm_start` checks with an estimated cost; `on_llm_end` records from
`llmOutput.usage`. Works with any provider LangChain wraps.

## AWS Lambda

Single-invocation — no persistent session. `guard.check` before the model call,
`guard.record` after; storage **must** be shared (DynamoDB/Redis, not in-memory).

## Kubernetes

SDK in-process in the service that calls the model (RedisStorage in the
cluster). No sidecar proxy — sidecars only add a hop without graduated guardrails.

## Redis / D1 / KV

```ts
import { KVStorage } from '@carloscortezcloud/sayay-guard/storage';
import { D1Storage } from '@carloscortezcloud/sayay-guard/storage';
import { RedisStorage } from '@carloscortezcloud/sayay-guard/storage';
```

- `KVStorage(kv)` — Cloudflare KV; TTL keys = free daily/monthly resets.
- `D1Storage({ db, tableName? })` — SQLite in Workers; `await storage.init()` once.
- `RedisStorage(redis)` — requires a client with `incrbyfloat()`/`incrby()`
  (ioredis, node-redis, Upstash); `expire` sets the window TTL.

## Not doing

- **LiteLLM** — delegate budgets to it (no adapter; sayay-008 §3.5).
- **Hosted API / control plane** — deprecated (sayay-004/008): in-process only.