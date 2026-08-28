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
_LAST_REDIS_AT: dict[str, float] = {}
_REDIS = None
_REDIS_FAILED_UNTIL = 0.0

VIEWPORT_TTL_SEC = 3600
REDIS_MIN_INTERVAL_SEC = 0.4
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


def set_teacher_viewport(board_id: str, payload: dict[str, Any], force: bool = False) -> None:
    """Persist last teacher viewport for late joiners on any worker.

    L1 always. Redis/cache at most every REDIS_MIN_INTERVAL_SEC unless force
    (end of pan / flush) — viewport arrives ~22 Hz and must not saturate
    the ASGI thread pool during a live lesson.
    """
    if not board_id or not isinstance(payload, dict):
        return
    bid = str(board_id)
    clean = dict(payload)
    clean["type"] = "viewport_state"
    # Client seq resets on remount — not comparable across workers/sessions.
    # stored_at is this process's receive time and is monotonic enough for get().
    clean["stored_at"] = time.time()
    _LOCAL[bid] = clean
    now = time.monotonic()
    last = _LAST_REDIS_AT.get(bid, 0.0)
    if not force and (now - last) < REDIS_MIN_INTERVAL_SEC:
        return
    _LAST_REDIS_AT[bid] = now
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


def _viewport_seq(payload: dict | None) -> int:
    if not isinstance(payload, dict):
        return -1
    try:
        return int(payload.get("seq") or 0)
    except (TypeError, ValueError):
        return 0


def _viewport_stored_at(payload: dict | None) -> float:
    if not isinstance(payload, dict):
        return -1.0
    try:
        return float(payload.get("stored_at") or 0.0)
    except (TypeError, ValueError):
        return 0.0


def _prefer_viewport(a: dict | None, b: dict | None) -> dict | None:
    """Newer write wins by server stored_at. Client seq is only a same-write tie-break."""
    if not isinstance(a, dict):
        return b if isinstance(b, dict) else None
    if not isinstance(b, dict):
        return a
    ta, tb = _viewport_stored_at(a), _viewport_stored_at(b)
    if ta != tb:
        return a if ta > tb else b
    return a if _viewport_seq(a) >= _viewport_seq(b) else b


def get_teacher_viewport(board_id: str) -> dict[str, Any] | None:
    bid = str(board_id or "")
    if not bid:
        return None

    best = _LOCAL.get(bid) if isinstance(_LOCAL.get(bid), dict) else None

    client = _get_redis()
    if client is not None:
        try:
            raw = client.get(_cache_key(bid))
            if raw:
                data = json.loads(raw)
                if isinstance(data, dict):
                    best = _prefer_viewport(best, data)
        except Exception:
            logger.debug("board viewport redis get failed", exc_info=True)

    try:
        from django.core.cache import cache

        data = cache.get(_cache_key(bid))
        if isinstance(data, dict):
            best = _prefer_viewport(best, data)
    except Exception:
        logger.debug("board viewport django cache get failed", exc_info=True)

    if isinstance(best, dict):
        _LOCAL[bid] = best
        return best
    return None


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
    _LAST_REDIS_AT.clear()
    _REDIS = None
    _REDIS_FAILED_UNTIL = 0.0
