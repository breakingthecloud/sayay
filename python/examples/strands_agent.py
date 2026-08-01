"""Strands Agents integration example.

Run:
    uv run python examples/strands_agent.py
"""

import asyncio

from sayay import MemoryStorage, SayayGuard


class BudgetedAgent:
    """Minimal stand-in for a Strands Agent that enforces budget per step."""

    def __init__(self, session_id: str, guard: SayayGuard):
        self.session_id = session_id
        self.guard = guard

    async def before_model_call(self, estimated_cost: float) -> None:
        decision = await self.guard.check(self.session_id, estimated_cost)
        if decision.action == "block":
            raise RuntimeError(f"Budget exceeded: {decision.reason}")
        return None  # proceed

    async def after_model_call(self, actual_cost: float) -> None:
        await self.guard.record(self.session_id, actual_cost)


async def main() -> None:
    guard = SayayGuard(storage=MemoryStorage(), budget={"credits": 50})
    agent = BudgetedAgent("session-001", guard)

    for step in range(3):
        await agent.before_model_call(0.01)
        # ... model call happens here ...
        await agent.after_model_call(0.008)
        usage = await guard.get_usage("session-001")
        print(f"step {step + 1}: credits used = {usage.credits}")


if __name__ == "__main__":
    asyncio.run(main())
