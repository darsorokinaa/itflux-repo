"""Bounded database work for realtime sockets.

A live socket does not get its own thread. Short ORM calls share a fixed
pool. The waiting line has a fixed length. When it is full, the call fails
with RealtimeDbSaturated instead of starting another thread or another
Postgres backend.

Defaults (16 workers, queue 64, wait 1.0s) come from an isolated Postgres
matrix, not from a guess. Pool 8 makes a 500-socket burst wait about 1.3s
at p99. Pool 32 cuts the 100-socket queue p99 from 208ms to 111ms and
reserves twice as many backends under max_connections=100. 16 is the
latency/safety point. A full queue rejects; it does not grow the pool.
"""

from __future__ import annotations

import asyncio
import contextvars
import logging
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor

from asgiref.sync import SyncToAsync
from django.db import close_old_connections

from Cabinet.loop_log import protect_logger

logger = logging.getLogger("itflux.realtime_db")
logger.setLevel(logging.INFO)
if not logger.handlers:
    _handler = logging.StreamHandler()
    _handler.setFormatter(logging.Formatter("%(levelname)s %(name)s %(message)s"))
    logger.addHandler(_handler)
    logger.propagate = False
protect_logger("itflux.realtime_db")

# One summary line per window. A warning per saturated frame filled stderr
# and blocked the reactor. The counter realtime_db_saturated_total still
# increments on every rejection.
_SAT_INTERVAL_S = 5.0
_sat_lock = threading.Lock()
_sat_window = 0
_sat_total = 0
_sat_timeout_total = 0
_sat_started = False


def _sat_loop() -> None:
    global _sat_window
    while True:
        time.sleep(_SAT_INTERVAL_S)
        with _sat_lock:
            count = _sat_window
            total = _sat_total
            timeouts = _sat_timeout_total
            _sat_window = 0
        if count:
            logger.warning(
                "%s realtime DB saturations in last 5s realtime_db_saturated_total=%s realtime_db_timeout_total=%s",
                count,
                total,
                timeouts,
            )


def _note_saturation(total: int, timeouts: int) -> None:
    global _sat_window, _sat_total, _sat_timeout_total, _sat_started
    with _sat_lock:
        _sat_window += 1
        _sat_total = total
        _sat_timeout_total = timeouts
        if not _sat_started:
            _sat_started = True
            threading.Thread(target=_sat_loop, name="realtime-db-sat-log", daemon=True).start()

realtime_scope: contextvars.ContextVar[bool] = contextvars.ContextVar(
    "realtime_db_scope",
    default=False,
)
realtime_db_critical: contextvars.ContextVar[bool] = contextvars.ContextVar(
    "realtime_db_critical",
    default=False,
)

_gate: "BoundedRealtimeDb | None" = None
_original_sync_call = None


class RealtimeDbSaturated(Exception):
    """The realtime DB queue is full or the wait exceeded the timeout."""

    def __init__(self, message: str = "realtime database saturated", *, critical: bool = False):
        super().__init__(message)
        self.critical = critical


def critical_connect(method):
    """Auth ORM may fail the handshake. Later messages must not drop the socket."""

    async def wrapper(self, *args, **kwargs):
        token = realtime_db_critical.set(True)
        try:
            return await method(self, *args, **kwargs)
        finally:
            realtime_db_critical.reset(token)

    return wrapper


def _env_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None or raw == "":
        return default
    return int(raw)


def _env_float(name: str, default: float) -> float:
    raw = os.environ.get(name)
    if raw is None or raw == "":
        return default
    return float(raw)


class BoundedRealtimeDb:
    def __init__(self, workers: int, queue_limit: int, wait_timeout: float):
        if workers < 1:
            raise ValueError("workers must be positive")
        if queue_limit < workers:
            raise ValueError("queue_limit counts running work and must be >= workers")
        self.workers = workers
        self.queue_limit = queue_limit
        self.wait_timeout = wait_timeout
        self.executor = ThreadPoolExecutor(
            max_workers=workers,
            thread_name_prefix="realtime-db",
        )
        self._slots = None
        self._slot_limit = queue_limit
        self._lock = threading.Lock()
        self._active = 0
        self._inflight = 0
        self.rejected_or_timed_out = 0
        self.saturated_total = 0
        self.timeout_total = 0
        self._last_wait_ms = 0.0
        self._closed = False
        self._waits: list[float] = []
        self.collect_traces = False
        self.traces: list[dict] = []

    def snapshot(self) -> dict:
        with self._lock:
            active = self._active
            inflight = self._inflight
            rejected = self.rejected_or_timed_out
            saturated = self.saturated_total
            timed_out = self.timeout_total
            last_wait = self._last_wait_ms
            waits = list(self._waits)
        waits.sort()

        def pct(p):
            if not waits:
                return 0.0
            index = min(len(waits) - 1, int(round((len(waits) - 1) * p)))
            return round(waits[index] * 1000, 2)

        return {
            "realtime_db_queue_depth": max(0, inflight - active),
            "realtime_db_queue_wait_ms": round(last_wait, 2),
            "realtime_db_queue_wait_p50_ms": pct(0.50),
            "realtime_db_queue_wait_p95_ms": pct(0.95),
            "realtime_db_queue_wait_p99_ms": pct(0.99),
            "realtime_db_active_workers": active,
            "realtime_db_rejected_or_timed_out": rejected,
            "realtime_db_saturated_total": saturated,
            "realtime_db_timeout_total": timed_out,
            "workers": self.workers,
            "queue_limit": self.queue_limit,
        }

    def _note_wait(self, seconds: float) -> None:
        with self._lock:
            self._last_wait_ms = seconds * 1000
            self._waits.append(seconds)
            if len(self._waits) > 4000:
                del self._waits[:2000]

    def _fail(self, kind: str) -> None:
        critical = realtime_db_critical.get()
        with self._lock:
            self.rejected_or_timed_out += 1
            if kind == "saturated":
                self.saturated_total += 1
            else:
                self.timeout_total += 1
            snapshot = {
                "realtime_db_saturated_total": self.saturated_total,
                "realtime_db_timeout_total": self.timeout_total,
                "realtime_db_active_workers": self._active,
                "realtime_db_queue_depth": max(0, self._inflight - self._active),
            }
        _note_saturation(
            snapshot["realtime_db_saturated_total"],
            snapshot["realtime_db_timeout_total"],
        )
        if kind == "saturated":
            raise RealtimeDbSaturated("realtime database queue is full", critical=critical)
        raise RealtimeDbSaturated("realtime database queue timed out", critical=critical)

    def _run_sync(self, func, args, kwargs):
        close_old_connections()
        try:
            return func(*args, **kwargs)
        finally:
            close_old_connections()

    def shutdown(self) -> None:
        self._closed = True
        self.executor.shutdown(wait=True, cancel_futures=True)

    def _trace(self, row: dict) -> None:
        if not self.collect_traces:
            return
        with self._lock:
            if len(self.traces) < 8000:
                self.traces.append(row)

    async def run(self, func, *args, **kwargs):
        if self._closed:
            raise RealtimeDbSaturated("realtime database pool is shut down", critical=True)
        loop = asyncio.get_running_loop()
        if self._slots is None:
            self._slots = asyncio.Semaphore(self._slot_limit)
        marks = {"db_queue_enter": time.perf_counter()}
        if self._slots.locked():
            marks["saturated"] = True
            self._trace(marks)
            self._fail("saturated")
        started = time.perf_counter()
        try:
            await asyncio.wait_for(self._slots.acquire(), timeout=self.wait_timeout)
        except TimeoutError:
            marks["timed_out"] = True
            self._trace(marks)
            self._fail("timeout")
        self._note_wait(time.perf_counter() - started)
        with self._lock:
            self._inflight += 1
        future = loop.create_future()

        def _settle(exc, result=None):
            if future.done():
                return
            if exc is None:
                future.set_result(result)
            else:
                future.set_exception(exc)

        def _release():
            with self._lock:
                self._inflight -= 1
            self._slots.release()

        def _in_worker():
            marks["db_worker_start"] = time.perf_counter()
            with self._lock:
                self._active += 1
            try:
                result = self._run_sync(func, args, kwargs)
            except BaseException as exc:
                marks["db_worker_end"] = time.perf_counter()
                loop.call_soon_threadsafe(_settle, exc)
            else:
                marks["db_worker_end"] = time.perf_counter()
                loop.call_soon_threadsafe(_settle, None, result)
            finally:
                with self._lock:
                    self._active -= 1
                loop.call_soon_threadsafe(_release)

        try:
            self.executor.submit(_in_worker)
        except RuntimeError:
            _release()
            raise RealtimeDbSaturated("realtime database pool is shut down", critical=True)
        result = await future
        marks["consumer_resume"] = time.perf_counter()
        self._trace(marks)
        return result


def get_gate() -> BoundedRealtimeDb:
    if _gate is None:
        raise RuntimeError("realtime DB pool is not installed")
    return _gate


def install_realtime_db_pool(
    workers: int | None = None,
    queue_limit: int | None = None,
    wait_timeout: float | None = None,
) -> BoundedRealtimeDb:
    global _gate, _original_sync_call
    if workers is None:
        workers = _env_int("REALTIME_DB_WORKERS", 16)
    if queue_limit is None:
        queue_limit = _env_int("REALTIME_DB_QUEUE_LIMIT", workers * 4)
    if wait_timeout is None:
        wait_timeout = _env_float("REALTIME_DB_WAIT_TIMEOUT", 1.0)
    _gate = BoundedRealtimeDb(workers, queue_limit, wait_timeout)
    if _original_sync_call is None:
        _original_sync_call = SyncToAsync.__call__

        async def _call(self, *args, **kwargs):
            if realtime_scope.get():
                return await _gate.run(self.func, *args, **kwargs)
            return await _original_sync_call(self, *args, **kwargs)

        SyncToAsync.__call__ = _call
    logger.info(
        "realtime_db_pool workers=%s queue_limit=%s wait_timeout=%s",
        _gate.workers,
        _gate.queue_limit,
        _gate.wait_timeout,
    )
    return _gate


class RealtimeDbScope:
    """Mark one websocket connection as a client of the shared DB pool."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "websocket":
            await self.app(scope, receive, send)
            return
        token = realtime_scope.set(True)
        try:
            await self.app(scope, receive, send)
        finally:
            realtime_scope.reset(token)
