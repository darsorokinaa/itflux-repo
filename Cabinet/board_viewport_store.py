"""Shared teacher viewport store across Daphne/ASGI workers.

L1: in-process dict (fast, same worker).
L2: Redis (same REDIS_HOST/PORT as channel layer) — multi-worker.
Fallback: Django cache when Redis unavailable.
"""

from __future__ import annotations

import json
import logging
import os
import time
from typing import Any

logger = logging.getLogger(__name__)

_LOCAL: dict[str, dict] = {}
_REDIS = None
_REDIS_FAILED_UNTIL = 0.0

VIEWPORT_TTL_SEC = 3600
KEY_PREFIX = "itflux:board_viewport:"


def _cache_key(board_id: str) -> str:
    return f"{KEY_PREFIX}{board_id}"


def _get_redis():
    global _REDIS, _REDIS_FAILED_UNTIL
    now = time.time()
    if now < _REDIS_FAILED_UNTIL:
        return None
    if _REDIS is not None:
        return _REDIS
    backend = (os.environ.get("CHANNEL_LAYER_BACKEND") or "redis").strip().lower()
    if backend in ("inmemory", "memory", "local"):
        _REDIS_FAILED_UNTIL = now + 60
        return None
    try:
        import redis  # type: ignore

        host = os.environ.get("REDIS_HOST", "127.0.0.1")
        port = int(os.environ.get("REDIS_PORT", "6379"))
        client = redis.Redis(host=host, port=port, db=0, socket_connect_timeout=0.4, socket_timeout=0.4)
        client.ping()
        _REDIS = client
        _REDIS_FAILED_UNTIL = 0.0
        return _REDIS
    except Exception:
        logger.debug("board viewport redis unavailable, using local/cache", exc_info=True)
        _REDIS = None
        _REDIS_FAILED_UNTIL = now + 15  # retry after 15s, not forever
        return None


def set_teacher_viewport(board_id: str, payload: dict[str, Any]) -> None:
    """Persist last teacher viewport for late joiners on any worker."""
    if not board_id or not isinstance(payload, dict):
        return
    bid = str(board_id)
    clean = dict(payload)
    clean["type"] = "viewport_state"
    _LOCAL[bid] = clean
    raw = None
    try:
        raw = json.dumps(clean, ensure_ascii=False, separators=(",", ":"))
    except (TypeError, ValueError):
        return

    client = _get_redis()
    if client is not None:
        try:
            client.setex(_cache_key(bid), VIEWPORT_TTL_SEC, raw)
            return
        except Exception:
            logger.debug("board viewport redis set failed", exc_info=True)

    try:
        from django.core.cache import cache

        cache.set(_cache_key(bid), clean, timeout=VIEWPORT_TTL_SEC)
    except Exception:
        logger.debug("board viewport django cache set failed", exc_info=True)


def get_teacher_viewport(board_id: str) -> dict[str, Any] | None:
    bid = str(board_id or "")
    if not bid:
        return None

    client = _get_redis()
    if client is not None:
        try:
            raw = client.get(_cache_key(bid))
            if raw:
                data = json.loads(raw)
                if isinstance(data, dict):
                    _LOCAL[bid] = data
                    return data
        except Exception:
            logger.debug("board viewport redis get failed", exc_info=True)

    try:
        from django.core.cache import cache

        data = cache.get(_cache_key(bid))
        if isinstance(data, dict):
            _LOCAL[bid] = data
            return data
    except Exception:
        logger.debug("board viewport django cache get failed", exc_info=True)

    return _LOCAL.get(bid)


def clear_teacher_viewport(board_id: str) -> None:
    bid = str(board_id or "")
    if not bid:
        return
    _LOCAL.pop(bid, None)
    client = _get_redis()
    if client is not None:
        try:
            client.delete(_cache_key(bid))
        except Exception:
            pass
    try:
        from django.core.cache import cache

        cache.delete(_cache_key(bid))
    except Exception:
        pass


def reset_viewport_store_for_tests() -> None:
    """Test helper: clear L1 and redis-failure latch."""
    global _REDIS, _REDIS_FAILED_UNTIL
    _LOCAL.clear()
    _REDIS = None
    _REDIS_FAILED_UNTIL = 0.0
