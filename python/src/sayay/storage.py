"""Storage backends for Sayay."""

from __future__ import annotations

import json
import os
import threading
import time
from typing import Optional

from .types import SayayStorage


class MemoryStorage(SayayStorage):
    """In-memory storage. TTL respected. Loses data on restart — good for tests/scripts."""

    def __init__(self) -> None:
        self._store: dict = {}
        self._lock = threading.Lock()

    async def get(self, key: str) -> float:
        with self._lock:
            entry = self._store.get(key)
            if entry is None:
                return 0.0
            value, expires = entry
            if expires is not None and time.time() > expires:
                self._store.pop(key, None)
                return 0.0
            return value

    async def increment(self, key: str, amount: float, ttl_seconds: Optional[int] = None) -> float:
        with self._lock:
            entry = self._store.get(key)
            if entry is None:
                current = 0.0
            else:
                value, expires = entry
                if expires is not None and time.time() > expires:
                    current = 0.0
                    self._store.pop(key, None)
                else:
                    current = value
            new_value = current + amount
            self._store[key] = (new_value, time.time() + ttl_seconds if ttl_seconds else None)
            return new_value

    async def reset(self, key: str) -> None:
        with self._lock:
            self._store.pop(key, None)


class FileStorage(SayayStorage):
    """JSON-file backed storage. Survives restarts — good for local CLI agents."""

    def __init__(self, path: str = "sayay-storage.json") -> None:
        self.path = path
        self._lock = threading.Lock()

    def _load(self) -> dict:
        if not os.path.exists(self.path):
            return {}
        try:
            with open(self.path, "r") as f:
                return json.load(f)
        except (json.JSONDecodeError, OSError):
            return {}

    def _save(self, data: dict) -> None:
        with open(self.path, "w") as f:
            json.dump(data, f, indent=2)

    async def get(self, key: str) -> float:
        with self._lock:
            return float(self._load().get(key, 0))

    async def increment(self, key: str, amount: float, ttl_seconds: Optional[int] = None) -> float:
        with self._lock:
            data = self._load()
            data[key] = float(data.get(key, 0)) + amount
            self._save(data)
            return data[key]

    async def reset(self, key: str) -> None:
        with self._lock:
            data = self._load()
            data.pop(key, None)
            self._save(data)


class RedisStorage(SayayStorage):
    """Redis-backed storage. Shared across workers/pods — good for production."""

    def __init__(self, url: str = "redis://localhost:6379", **redis_kwargs) -> None:
        try:
            import redis.asyncio as aioredis
        except ImportError as e:  # pragma: no cover
            raise ImportError(
                "RedisStorage requires the 'redis' package: pip install 'sayay[redis]'"
            ) from e
        self._client = aioredis.from_url(url, **redis_kwargs)

    async def get(self, key: str) -> float:
        value = await self._client.get(key)
        return float(value) if value is not None else 0.0

    async def increment(self, key: str, amount: float, ttl_seconds: Optional[int] = None) -> float:
        new_value = await self._client.incrbyfloat(key, amount)
        if ttl_seconds is not None:
            await self._client.expire(key, ttl_seconds)
        return float(new_value)

    async def reset(self, key: str) -> None:
        await self._client.delete(key)
