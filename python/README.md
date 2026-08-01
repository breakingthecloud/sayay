# ⚓ Sayay — AI Agent Cost Guardrails (Python)

Budget enforcement middleware for LLM calls. Prevent runaway AI costs with per-user
daily/monthly/session budgets or credit systems. **Zero dependencies.**

Python port of [`@carloscortezcloud/sayay-guard`](https://github.com/breakingthecloud/sayay).

## Install

```bash
pip install sayay
# Redis storage (optional):
pip install 'sayay[redis]'
```

## Quick Start

```python
import asyncio
from sayay import SayayGuard, MemoryStorage

guard = SayayGuard(
    storage=MemoryStorage(),
    budget={"daily_usd": 5.0, "monthly_usd": 50.0},
    on_exceeded="block",
    degrade_to_model="meta-llama/llama-3.3-70b-instruct:free",
)

async def main():
    # Before LLM call:
    decision = await guard.check("user-123", estimated_cost=0.003)
    if decision.action == "block":
        raise RuntimeError(f"Budget exceeded: {decision.reason}")
    if decision.action == "degrade":
        # use decision.suggested_model instead of the expensive model
        pass

    # ... make the LLM call ...

    # After LLM call:
    await guard.record("user-123", actual_cost=0.004)

    usage = await guard.get_usage("user-123")
    print(usage.daily, usage.monthly)

asyncio.run(main())
```

## Storage Backends

| Backend | When to use |
|---------|-------------|
| `MemoryStorage` | Tests, scripts, single-process agents |
| `FileStorage` | Local CLI agents that must survive restarts |
| `RedisStorage` | Production, shared across workers/pods |

Implement `SayayStorage` (`get`/`increment`/`reset`) for your infra (KV, D1, DynamoDB, Firestore).

## Budget options

- `daily_usd` / `monthly_usd` / `session_usd` — USD limits (resets UTC midnight / month start)
- `per_call_max_usd` — blocks a single expensive call
- `credits` + `credits_per_call` — credit-based system

## Actions

`allow` → proceed · `warn` (≥80%) → proceed + warn · `degrade` (≥95%) → use `suggested_model` · `block` → stop.

## Examples

- `examples/strands_agent.py` — Strands-style agent hooking check/record per step
- `examples/langchain_callback.py` — LangChain `BaseCallbackHandler` wiring

## Tests

```bash
uv venv --python 3.12 .venv && uv pip install -e '.[redis]' pytest pytest-asyncio
uv run pytest
```

## License

Apache 2.0
