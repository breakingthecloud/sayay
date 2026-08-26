# Sayay Changelog

> Historial público de releases de [`@carloscortezcloud/sayay-guard`](https://www.npmjs.com/package/@carloscortezcloud/sayay-guard) (npm) y `sayay` (PyPI) — 1 entrada por versión.
> Repo: https://github.com/breakingthecloud/sayay · Python: `sayay` · Ejemplos: `examples/` + `python/examples/`

Última actualización: **2026-08-25** · `v0.1.0` → `v0.3.0` (+ `v0.1.0-py`) · Verificado `git tag` + `npm view` + `PyPI`.

---

## Overview

| Versión | Git tag | Fecha (git) | Fecha (registry) | Registry | Resumen |
|---------|---------|-------------|------------------|----------|---------|
| **0.3.0** | `v0.3.0` | 2026-08-14 | 2026-08-15 01:31 UTC | npm | `SayayQhawayPlugin` → Qhaway metrics |
| **0.2.0** | `v0.2.0` | 2026-08-02 | 2026-08-02 21:30 UTC | npm | `TokenBudgetExceededException` + Dynamo + CloudWatch |
| **0.1.0** (PyPI) | `v0.1.0-py` | 2026-07-31 | 2026-07-31 ~19:15 UTC | PyPI | Python SDK `sayay 0.1.0` · Memory/File/Redis |
| **0.1.1** | `v0.1.1` | 2026-07-22 | 2026-07-22 23:36 UTC | npm | Fix ESM `type: module` |
| **0.1.0** | `v0.1.0` | 2026-07-22 | 2026-07-22 23:31 UTC | npm | Initial: 308 líneas, zero deps, budgets por user |

> Nota: `v0.2.0` faltaba en `git ls-remote` hasta 2026-08-25 — pusheado con `v0.1.1`.

---

## v0.3.0 — 2026-08-14 — Qhaway Plugin — De guardrail a observabilidad

**Tag:** `v0.3.0` @ `0622e54` · **npm:** `0.3.0` @ 2026-08-15T01:31:49.694Z · **Tarball:** 6 files, 39,690 unpacked

**Qué cambió:**
- `src/qhaway.ts: SayayQhawayPlugin` — `onDecision({ action, userId, cost, budget }) → qhaway_sayay_decisions_total` (zero hard deps, `QhawayStorage`-compatible)
- Helper `sayayDecisionMetric(userId, action)` para `QhawayTracer` + `examples/sayay-qhaway.ts`
- `package.json` exports `import/require/types` + bump `0.2.0 → 0.3.0` · 5 nuevos tests (17/17)

**Por qué importa:**
- Cada decisión `allow/warn/degrade/block` ahora es trazable. Bridge con Tinkuy `0.8.0` `feedback` + Qhaway: `Sayay.check` span correlaciona presupuesto con satisfacción.

```ts
import { SayayGuard } from '@carloscortezcloud/sayay-guard';
import { SayayQhawayPlugin } from '@carloscortezcloud/sayay-guard/qhaway';
import { QhawayTracer } from '@carloscortezcloud/qhaway';

const tracer = new QhawayTracer({ exporter: 'otlp' });
const plugin = new SayayQhawayPlugin(tracer);
const guard = new SayayGuard({
  storage: new MemoryStorage(),
  budget: { dailyUsd: 5.0 },
  onDecision: plugin.onDecision, // → span sayay.check + metric
});

const d = await guard.check('user-123', 0.003);
console.log(d.action, d.reason); // block con razón si excede
```

Ver `examples/sayay-qhaway.ts` · `examples/README.md`.

---

## v0.2.0 — 2026-08-02 — DynamoStorage + CloudWatch + TokenBudgetExceededException

**Tag:** `v0.2.0` @ `8738a33` · **npm:** `0.2.0` @ 2026-08-02T21:30:45.479Z · **Tarball:** 4 files, 32,544 unpacked

**Qué cambió:**
- `TokenBudgetExceededException extends BudgetExceededError` — semántica de *tokens* para agentes que piensan en tokens, backward compatible con `catch (e instanceof BudgetExceededError)`
- `checkOrThrow(userId, cost)` — throw si `block`, ideal para Step Functions `ErrorEquals: TokenBudgetExceededException`
- `DynamoStorage` — `DynamoDB SayayStorage` adapter con lazy `AWS SDK` (`@aws-sdk/client-dynamodb`, `lib-dynamodb`) — no hard dep si usas `MemoryStorage`
- CloudWatch metric emit por decisión (`@aws-sdk/client-cloudwatch` lazy) — `SayayBudgetExceeded`, `SayayDecision`
- 12 tests passing

**Por qué importa:**
- De in-memory a prod: Dynamo persiste budgets multi-instancia sin sticky sessions; CloudWatch te alerta antes de que el usuario se quede sin presupuesto; `checkOrThrow` encaja con `Step Functions ASL`.

```ts
import { DynamoStorage } from '@carloscortezcloud/sayay-guard/storage/dynamo';

const guard = new SayayGuard({
  storage: new DynamoStorage({ tableName: 'sayay-budgets', region: 'us-east-1' }),
  budget: { dailyUsd: 10, monthlyUsd: 100 },
});

try {
  await guard.checkOrThrow('user-42', 0.05);
} catch (e) {
  if (e instanceof TokenBudgetExceededException) {
    // Step Functions: Catch ErrorEquals TokenBudgetExceededException → fallback model
  }
}
```

---

## v0.1.0-py — 2026-07-31 — Python SDK `sayay 0.1.0`

**Tag:** `v0.1.0-py` @ `ef89178` (también `7dfe5b9` en `main`) · **PyPI:** `sayay 0.1.0` · **Files:** `sayay-0.1.0-py3-none-any.whl` + `.tar.gz`

**Qué cambió:**
- `python/src/sayay/core.py` (226 líneas) — `SayayGuard` con `budget: {"daily_usd", "monthly_usd"}`, `on_exceeded: block | degrade | warn`
- `python/src/sayay/storage.py` (114) — `MemoryStorage`, `FileStorage` (JSON), `RedisStorage` (opcional `redis>=4.0`)
- `python/src/sayay/types.py` (86) — `Decision`, `BudgetExceededError`
- `pyproject.toml` — `name = "sayay"`, `version = "0.1.0"`, `requires-python >=3.9`, `optional redis`
- `python/examples/langchain_callback.py`, `strands_agent.py`

**Por qué importa:**
- Paridad TS→Python: mismo contrato `check(user_id, cost) → Decision`, mismos storages, cero deps base. `pip install sayay` para SOFE workers en Python.

```python
import asyncio
from sayay import SayayGuard, MemoryStorage

guard = SayayGuard(storage=MemoryStorage(), budget={"daily_usd": 5.0})

async def main():
    d = await guard.check("user-123", 0.003)
    if d.action == "block":
        raise RuntimeError(d.reason)
    if d.action == "degrade":
        print(f"degrade to {d.suggested_model}")

asyncio.run(main())
```

Ver `python/README.md` + `python/examples/`.

---

## v0.1.1 — 2026-07-22 — ESM fix

**Tag:** `v0.1.1` @ `01502ba` · **npm:** `0.1.1` @ 2026-07-22T23:36:19.309Z · **Tarball:** 4 files, 17,196 unpacked

- `package.json: "type": "module"` — fix ESM para Node 20+ (mismo que Tinkuy 0.1.1 / Styrr 0.1.1)

> Fusionable con 0.1.0 si quieres 4 posts en vez de 5.

---

## v0.1.0 — 2026-07-22 — Initial — 308 líneas, zero deps

**Tag:** `v0.1.0` @ `f80f14d` · **npm:** `0.1.0` @ 2026-07-22T23:31:34.147Z · **Tarball:** 4 files, 17,176 unpacked

- `src/index.ts` 240 líneas — `SayayGuard` con `budget: { dailyUsd, monthlyUsd, perSession }`, `storage: SayayStorage` (Memory pluggable), acciones `allow | warn | degrade | block`, hooks `onExceeded`, `onDegraded`
- `BudgetExceededError`, `Decide()` con `estimatedCost` y `userId` scoped

```ts
import { SayayGuard, MemoryStorage } from '@carloscortezcloud/sayay-guard';

const guard = new SayayGuard({
  storage: new MemoryStorage(),
  budget: { dailyUsd: 5.0, monthlyUsd: 50 },
  degradeToModel: 'meta-llama/llama-3.3-70b:free',
});

const d = await guard.check('user-123', 0.003);
// d.action: allow | warn (80% budget) | degrade (suggest cheaper model) | block
```

---

## Verificación

```bash
git tag --list | sort -V
npm view @carloscortezcloud/sayay-guard versions --json
curl -s https://pypi.org/pypi/sayay/json | jq '{version: .info.version, releases: (.releases | keys)}'
curl -s https://pypi.org/pypi/sayay-guard/json | jq .message  # Not Found (nombre PyPI es sayay)
```
