"""LangChain callback integration example.

Illustrates how to wire Sayay into LangChain via a BaseCallbackHandler.
Requires: pip install langchain-core (or just run the Guard part without it).

Run:
    uv run python examples/langchain_callback.py
"""

import asyncio

from sayay import MemoryStorage, SayayGuard

# LangChain is optional for Sayay itself; this example only needs it at runtime
try:
    from langchain_core.callbacks import BaseCallbackHandler
except ImportError:  # pragma: no cover
    BaseCallbackHandler = object  # type: ignore[assignment,misc]


class SayayCallback(BaseCallbackHandler):  # type: ignore[misc]
    def __init__(self, guard: SayayGuard, user_id: str):
        self.guard = guard
        self.user_id = user_id

    def on_llm_start(self, serialized, prompts, **kwargs):
        decision = asyncio.run(self.guard.check(self.user_id, 0.005))
        if decision.action == "block":
            raise ValueError(f"Sayay: {decision.reason}")

    def on_llm_end(self, response, **kwargs):
        tokens = 0
        llm_output = getattr(response, "llm_output", None) or {}
        token_usage = llm_output.get("token_usage") or {}
        tokens = token_usage.get("total_tokens", 0)
        cost = tokens * 0.000002  # approximate
        asyncio.run(self.guard.record(self.user_id, cost))


async def main() -> None:
    guard = SayayGuard(storage=MemoryStorage(), budget={"daily_usd": 1.0})
    callback = SayayCallback(guard, "user-123")

    # Wire callback into your LLM call:
    #   llm = ChatOpenAI(..., callbacks=[callback])
    # or with `config={"callbacks": [callback]}` when calling.

    usage = await guard.get_usage("user-123")
    print(f"usage after wiring: {usage}")


if __name__ == "__main__":
    asyncio.run(main())
