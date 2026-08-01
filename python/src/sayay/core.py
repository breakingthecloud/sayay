"""SayayGuard — core budget enforcement, ported from the TypeScript package."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Awaitable, Callable, Optional, Union

from .types import SayayAction, SayayBudget, SayayConfig, SayayDecision, SayayError, SayayUsage


def _utc_today() -> str:
    return datetime.now(timezone.utc).date().isoformat()


def _utc_month() -> str:
    now = datetime.now(timezone.utc)
    return f"{now.year}-{now.month:02d}"


class SayayGuard:
    """Budget enforcement for LLM calls. Check before, record after.

    Example:
        guard = SayayGuard(storage=MemoryStorage(), budget={"daily_usd": 5.0})
        decision = await guard.check("user-123", estimated_cost=0.003)
        if decision.action == "block":
            raise SayayError(decision.reason)
        # ... make LLM call ...
        await guard.record("user-123", actual_cost=0.004)
    """

    def __init__(
        self,
        storage: Optional[SayayStorage] = None,
        budget: Optional[Union[SayayBudget, dict]] = None,
        on_exceeded: SayayAction = "block",
        warn_threshold: float = 80.0,
        degrade_threshold: float = 95.0,
        degrade_to_model: Optional[str] = None,
        on_decision: Optional[Callable[[str, SayayDecision], Awaitable[None] | None]] = None,
        config: Optional[Union[SayayConfig, dict]] = None,
    ) -> None:
        """Create a guard.

        Either pass a full `config` (SayayConfig/dict) OR use the keyword
        arguments directly:

            SayayGuard(storage=MemoryStorage(), budget={"daily_usd": 5.0})
        """
        if config is not None:
            if isinstance(config, dict):
                config = SayayConfig(**config)
            self.config = config
        else:
            self.config = SayayConfig(
                storage=storage or MemoryStorage(),
                budget=budget if budget is not None else {},
                on_exceeded=on_exceeded,
                warn_threshold=warn_threshold,
                degrade_threshold=degrade_threshold,
                degrade_to_model=degrade_to_model,
                on_decision=on_decision,
            )
        if isinstance(self.config.budget, dict):
            self.config.budget = SayayBudget(**self.config.budget)
        self.budget = self.config.budget

    # ─── Public API ────────────────────────────────────────────────

    async def check(self, user_id: str, estimated_cost: float = 0.0) -> SayayDecision:
        """Check if a user can make an LLM call. Call BEFORE each inference."""
        cost = estimated_cost or 0.0
        storage = self.config.storage

        # ── Credit-based check ──
        if self.budget.credits is not None:
            used = await storage.get(self._key(user_id, "credits"))
            remaining = self.budget.credits - used
            cost_in_credits = self.budget.credits_per_call or 1.0

            if remaining < cost_in_credits:
                return await self._decide(user_id, "block", remaining, self.budget.credits, "Credits exhausted")

            usage_percent = (used / self.budget.credits) * 100
            if usage_percent >= self.config.degrade_threshold:
                return await self._decide(user_id, "degrade", remaining, self.budget.credits, f"{round(usage_percent)}% credits used")
            if usage_percent >= self.config.warn_threshold:
                return await self._decide(user_id, "warn", remaining, self.budget.credits, f"{round(usage_percent)}% credits used")
            return await self._decide(user_id, "allow", remaining, self.budget.credits)

        # ── USD-based checks ──

        # Per-call max
        if self.budget.per_call_max_usd and cost > self.budget.per_call_max_usd:
            return await self._decide(
                user_id,
                "block",
                0,
                self.budget.per_call_max_usd,
                f"Single call ${cost:.4f} exceeds per-call max ${self.budget.per_call_max_usd}",
            )

        # Daily budget
        if self.budget.daily_usd:
            daily_used = await storage.get(self._key(user_id, "daily"))
            remaining = self.budget.daily_usd - daily_used

            if remaining <= 0:
                return await self._decide(user_id, self.config.on_exceeded, remaining, self.budget.daily_usd, "Daily budget exhausted")
            if cost > remaining:
                return await self._decide(
                    user_id,
                    "warn",
                    remaining,
                    self.budget.daily_usd,
                    f"Call (${cost:.4f}) would exceed remaining daily budget (${remaining:.4f})",
                )

            usage_percent = (daily_used / self.budget.daily_usd) * 100
            if usage_percent >= self.config.degrade_threshold:
                return await self._decide(user_id, "degrade", remaining, self.budget.daily_usd, f"{round(usage_percent)}% daily budget used")
            if usage_percent >= self.config.warn_threshold:
                return await self._decide(user_id, "warn", remaining, self.budget.daily_usd, f"{round(usage_percent)}% daily budget used")

        # Monthly budget
        if self.budget.monthly_usd:
            monthly_used = await storage.get(self._key(user_id, "monthly"))
            remaining = self.budget.monthly_usd - monthly_used

            if remaining <= 0:
                return await self._decide(user_id, self.config.on_exceeded, remaining, self.budget.monthly_usd, "Monthly budget exhausted")

            usage_percent = (monthly_used / self.budget.monthly_usd) * 100
            if usage_percent >= self.config.degrade_threshold:
                return await self._decide(user_id, "degrade", remaining, self.budget.monthly_usd, f"{round(usage_percent)}% monthly budget used")
            if usage_percent >= self.config.warn_threshold:
                return await self._decide(user_id, "warn", remaining, self.budget.monthly_usd, f"{round(usage_percent)}% monthly budget used")

        # All checks passed
        total = self.budget.daily_usd or self.budget.monthly_usd or 0.0
        return await self._decide(user_id, "allow", total, total)

    async def record(self, user_id: str, cost_usd: float = 0.0, credits_used: Optional[float] = None) -> None:
        """Record actual cost after an LLM call completes. Call AFTER each inference."""
        storage = self.config.storage

        if self.budget.credits is not None:
            credits = credits_used or self.budget.credits_per_call or 1.0
            await storage.increment(self._key(user_id, "credits"), credits)
            return

        if self.budget.daily_usd:
            await storage.increment(self._key(user_id, "daily"), cost_usd, self._seconds_until_midnight_utc())
        if self.budget.monthly_usd:
            await storage.increment(self._key(user_id, "monthly"), cost_usd, self._seconds_until_end_of_month())
        if self.budget.session_usd:
            await storage.increment(self._key(user_id, "session"), cost_usd)

    async def get_usage(self, user_id: str) -> SayayUsage:
        """Get current usage for a user."""
        storage = self.config.storage
        return SayayUsage(
            daily=await storage.get(self._key(user_id, "daily")),
            monthly=await storage.get(self._key(user_id, "monthly")),
            session=await storage.get(self._key(user_id, "session")),
            credits=await storage.get(self._key(user_id, "credits")) if self.budget.credits is not None else None,
        )

    async def reset(self, user_id: str, scope: str = "all") -> None:
        """Reset usage for a user. scope: 'daily' | 'monthly' | 'session' | 'credits' | 'all'."""
        storage = self.config.storage
        if scope == "all":
            for s in ("daily", "monthly", "session", "credits"):
                await storage.reset(self._key(user_id, s))
        else:
            await storage.reset(self._key(user_id, scope))

    # ─── Private ───────────────────────────────────────────────────

    def _key(self, user_id: str, scope: str) -> str:
        if scope == "daily":
            return f"sayay:{user_id}:daily:{_utc_today()}"
        if scope == "monthly":
            return f"sayay:{user_id}:monthly:{_utc_month()}"
        return f"sayay:{user_id}:{scope}"

    async def _decide(
        self,
        user_id: str,
        action: SayayAction,
        remaining: float,
        total: float,
        reason: Optional[str] = None,
    ) -> SayayDecision:
        usage_percent = round(((total - remaining) / total) * 100) if total > 0 else 0
        decision = SayayDecision(
            action=action,
            remaining=max(0, remaining),
            total=total,
            usage_percent=usage_percent,
            reason=reason,
            suggested_model=self.config.degrade_to_model if action == "degrade" else None,
        )

        if self.config.on_decision:
            result = self.config.on_decision(user_id, decision)
            if result is not None:
                await result

        return decision

    @staticmethod
    def _seconds_until_midnight_utc() -> int:
        now = datetime.now(timezone.utc)
        midnight = datetime.combine(now.date() + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc)
        return int((midnight - now).total_seconds())

    @staticmethod
    def _seconds_until_end_of_month() -> int:
        now = datetime.now(timezone.utc)
        next_month = date(now.year + (now.month == 12), now.month % 12 + 1, 1)
        end = datetime.combine(next_month, datetime.min.time(), tzinfo=timezone.utc)
        return int((end - now).total_seconds())


__all__ = ["SayayGuard", "SayayDecision", "SayayUsage", "SayayError"]
