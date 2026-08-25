# Sayay Changelog

> Historial público de releases de [`@carloscortezcloud/sayay-guard`](https://www.npmjs.com/package/@carloscortezcloud/sayay-guard) (npm) y `sayay` (PyPI) — 1 entrada por versión.
> Repo: https://github.com/breakingthecloud/sayay

Última actualización: **2026-08-25** · `v0.1.0` → `v0.3.0` (+ `v0.1.0-py`) · Verificado `git tag` + `npm view` + `PyPI`.

---

## Overview

| Versión | Git tag | Fecha | Registry | Resumen |
|---------|---------|-------|----------|---------|
| **0.3.0** | `v0.3.0` | 2026-08-14 | 2026-08-15 01:31 UTC (npm) | `SayayQhawayPlugin` → Qhaway metrics |
| **0.2.0** | `v0.2.0` | 2026-08-02 | 2026-08-02 21:30 UTC (npm) | `TokenBudgetExceededException` + Dynamo + CloudWatch |
| **0.1.0** (PyPI) | `v0.1.0-py` | 2026-07-31 | 2026-07-31 (PyPI) | Python SDK `sayay 0.1.0` |
| **0.1.1** | `v0.1.1` | 2026-07-22 | 2026-07-22 23:36 UTC (npm) | Fix ESM `type: module` |
| **0.1.0** | `v0.1.0` | 2026-07-22 | 2026-07-22 23:31 UTC (npm) | Initial: 308 líneas, zero deps |

---

## v0.3.0 — 2026-08-14 — Qhaway Plugin

**Tag:** `v0.3.0` @ `0622e54` · **npm:** `0.3.0` @ 2026-08-15T01:31:49.694Z · 6 files, 39,690

- `src/qhaway.ts: SayayQhawayPlugin` — `onDecision` → `qhaway_sayay_decisions_total` (zero hard deps)
- `examples/sayay-qhaway.ts` · exports `import/require/types`

```ts
const plugin = new SayayQhawayPlugin(tracer);
const guard = new SayayGuard({ storage, budget, onDecision: plugin.onDecision });
```

---

## v0.2.0 — 2026-08-02 — Dynamo + CloudWatch

**Tag:** `v0.2.0` @ `8738a33` · **npm:** `0.2.0` @ 2026-08-02T21:30:45.479Z · 4 files, 32,544

- `TokenBudgetExceededException extends BudgetExceededError` + `checkOrThrow()` para Step Functions `ErrorEquals`
- `DynamoStorage` (lazy `@aws-sdk/client-dynamodb`) + CloudWatch metric emit

```ts
await guard.checkOrThrow('user-123', 0.01);
```

---

## v0.1.0-py — 2026-07-31 — Python SDK

**Tag:** `v0.1.0-py` @ `ef89178` · **PyPI:** `sayay 0.1.0` · `whl` + `tar.gz`

- `python/src/sayay/core.py` + `storage.py` (`Memory/File/Redis`) + `types.py`
- `pip install sayay` (`sayay[redis]` opcional)

```python
from sayay import SayayGuard, MemoryStorage
guard = SayayGuard(storage=MemoryStorage(), budget={"daily_usd": 5.0})
```

---

## v0.1.1 — 2026-07-22 — ESM fix

**Tag:** `v0.1.1` @ `01502ba` · **npm:** `0.1.1` @ 2026-07-22T23:36:19.309Z

- `package.json: "type": "module"`

---

## v0.1.0 — 2026-07-22 — Initial

**Tag:** `v0.1.0` @ `f80f14d` · **npm:** `0.1.0` @ 2026-07-22T23:31:34.147Z · 4 files, 308 líneas, zero deps

```ts
const guard = new SayayGuard({ storage: new MemoryStorage(), budget: { dailyUsd: 5.0 } });
await guard.check('user-123', 0.003);
```

---

## Verificación

```bash
git tag --list | sort -V
npm view @carloscortezcloud/sayay-guard versions --json
curl -s https://pypi.org/pypi/sayay/json | jq .info.version
```
