"""
Sayay — AI Agent Cost Guardrails

Budget enforcement middleware for LLM calls.
Check BEFORE each call, record AFTER each call.
Supports: USD budgets, credit systems, per-user/session/daily/monthly.

Zero dependencies. Mirrors the TypeScript package @carloscortezcloud/sayay-guard.

Name: "Sayay" (Quechua) = "to stop/detain" — stops runaway AI costs.

Usage:
    from sayay import SayayGuard, MemoryStorage

    guard = SayayGuard(storage=MemoryStorage(), budget={"daily_usd": 5.0})
    decision = await guard.check("user-123", estimated_cost=0.003)
    if decision.action == "block":
        raise Exception(decision.reason)
    await guard.record("user-123", actual_cost=0.004)
"""

from .core import SayayGuard
from .storage import FileStorage, MemoryStorage, RedisStorage
from .types import (
    SayayAction,
    SayayBudget,
    SayayConfig,
    SayayDecision,
    SayayError,
    SayayStorage,
    SayayUsage,
)

__version__ = "0.1.0"

__all__ = [
    "SayayGuard",
    "MemoryStorage",
    "FileStorage",
    "RedisStorage",
    "SayayStorage",
    "SayayBudget",
    "SayayConfig",
    "SayayDecision",
    "SayayUsage",
    "SayayAction",
    "SayayError",
    "__version__",
]
