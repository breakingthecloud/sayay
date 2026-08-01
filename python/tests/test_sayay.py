"""Tests for Sayay — mirror the TS behavior from @carloscortezcloud/sayay-guard."""

import pytest

from sayay import FileStorage, MemoryStorage, SayayBudget, SayayConfig, SayayGuard


@pytest.fixture
def memory_guard():
    return SayayGuard(
        config=SayayConfig(
            storage=MemoryStorage(),
            budget=SayayBudget(daily_usd=10.0, monthly_usd=100.0),
        )
    )


@pytest.mark.asyncio
async def test_allow_under_budget(memory_guard):
    decision = await memory_guard.check("user-123", estimated_cost=0.005)
    assert decision.action == "allow"
    assert decision.remaining == 10.0


@pytest.mark.asyncio
async def test_block_when_daily_exhausted(memory_guard):
    guard = SayayGuard(storage=MemoryStorage(), budget={"daily_usd": 1.0})
    await guard.record("user-123", 1.0)
    decision = await guard.check("user-123", estimated_cost=0.5)
    assert decision.action == "block"
    assert decision.reason == "Daily budget exhausted"


@pytest.mark.asyncio
async def test_warn_when_call_exceeds_remaining(memory_guard):
    guard = SayayGuard(storage=MemoryStorage(), budget={"daily_usd": 1.0})
    await guard.record("user-123", 0.9)
    decision = await guard.check("user-123", estimated_cost=0.2)
    assert decision.action == "warn"


@pytest.mark.asyncio
async def test_degrade_at_high_usage(memory_guard):
    guard = SayayGuard(
        storage=MemoryStorage(),
        budget={"daily_usd": 100.0},
        degrade_to_model="meta-llama/llama-3.3-70b-instruct:free",
    )
    await guard.record("user-123", 96.0)
    decision = await guard.check("user-123", estimated_cost=0.5)
    assert decision.action == "degrade"
    assert decision.suggested_model == "meta-llama/llama-3.3-70b-instruct:free"


@pytest.mark.asyncio
async def test_per_call_max_blocks_expensive_call():
    guard = SayayGuard(storage=MemoryStorage(), budget={"per_call_max_usd": 0.10})
    decision = await guard.check("user-123", estimated_cost=0.50)
    assert decision.action == "block"


@pytest.mark.asyncio
async def test_credits_system():
    guard = SayayGuard(storage=MemoryStorage(), budget={"credits": 3, "credits_per_call": 1})
    for _ in range(3):
        assert (await guard.check("user-123")).action == "allow"
        await guard.record("user-123")
    decision = await guard.check("user-123")
    assert decision.action == "block"
    assert decision.reason == "Credits exhausted"


@pytest.mark.asyncio
async def test_record_tracks_usage(memory_guard):
    await memory_guard.record("user-123", 2.5)
    usage = await memory_guard.get_usage("user-123")
    assert usage.daily == 2.5
    assert usage.monthly == 2.5


@pytest.mark.asyncio
async def test_reset_scope():
    guard = SayayGuard(storage=MemoryStorage(), budget={"daily_usd": 10.0})
    await guard.record("user-123", 2.0)
    await guard.reset("user-123", "daily")
    usage = await guard.get_usage("user-123")
    assert usage.daily == 0.0


@pytest.mark.asyncio
async def test_on_exceeded_override():
    guard = SayayGuard(storage=MemoryStorage(), budget={"daily_usd": 1.0}, on_exceeded="degrade")
    await guard.record("user-123", 1.0)
    decision = await guard.check("user-123")
    assert decision.action == "degrade"


@pytest.mark.asyncio
async def test_file_storage(tmp_path):
    path = str(tmp_path / "sayay.json")
    guard = SayayGuard(storage=FileStorage(path), budget={"daily_usd": 10.0})
    await guard.record("user-123", 3.0)
    # New guard instance over same file → persists
    guard2 = SayayGuard(storage=FileStorage(path), budget={"daily_usd": 10.0})
    usage = await guard2.get_usage("user-123")
    assert usage.daily == pytest.approx(3.0)


@pytest.mark.asyncio
async def test_on_decision_hook_called():
    seen = []

    async def hook(user_id, decision):
        seen.append((user_id, decision.action))

    guard = SayayGuard(
        storage=MemoryStorage(),
        budget={"daily_usd": 10.0},
        on_decision=hook,
    )
    await guard.check("user-123")
    assert seen == [("user-123", "allow")]
