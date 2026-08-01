"""
Sayay — AI Agent Cost Guardrails

Budget enforcement middleware for LLM calls.
Check BEFORE each call, record AFTER each call.
Supports: USD budgets, credit systems, per-user/session/daily/monthly.

Zero dependencies. Mirrors the TypeScript package @carloscortezcloud/sayay-guard.

Name: "Sayay" (Quechua) = "to stop/detain" — stops runaway AI costs.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from typing import Awaitable, Callable, Dict, Optional, Union

SayayAction = str  # 'allow' | 'warn' | 'degrade' | 'block'


@dataclass
class SayayBudget:
    """Budget limits. All fields optional — only configured ones are enforced."""

    daily_usd: Optional[float] = None
    monthly_usd: Optional[float] = None
    session_usd: Optional[float] = None
    per_call_max_usd: Optional[float] = None
    credits: Optional[float] = None
    credits_per_call: Optional[float] = None


@dataclass
class SayayConfig:
    """Configuration for the guard."""

    storage: "SayayStorage"
    budget: Union[SayayBudget, Dict]
    on_exceeded: SayayAction = "block"
    warn_threshold: float = 80.0
    degrade_threshold: float = 95.0
    degrade_to_model: Optional[str] = None
    on_decision: Optional[Callable[[str, "SayayDecision"], Awaitable[None] | None]] = None


@dataclass
class SayayDecision:
    """What the guard decided for a call."""

    action: SayayAction
    reason: Optional[str] = None
    remaining: float = 0.0
    total: float = 0.0
    usage_percent: float = 0.0
    suggested_model: Optional[str] = None


@dataclass
class SayayUsage:
    """Current usage for a user."""

    daily: float = 0.0
    monthly: float = 0.0
    session: float = 0.0
    credits: Optional[float] = None


class SayayError(Exception):
    """Raised when a call is blocked."""


# ─── Storage Interface ──────────────────────────────────────────────


class SayayStorage:
    """Storage backend for Sayay. Subclass for your infra."""

    async def get(self, key: str) -> float:
        raise NotImplementedError

    async def increment(self, key: str, amount: float, ttl_seconds: Optional[int] = None) -> float:
        raise NotImplementedError

    async def reset(self, key: str) -> None:
        raise NotImplementedError
