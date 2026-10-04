"""Periodic process snapshot for the Daphne retention investigation.

Logs RSS before and after a collection, the largest tracemalloc traces, live
sockets, channel queues, cache size, file descriptors and Postgres pressure.
It does not restart the process and it does not drop caches.
"""

from __future__ import annotations

import gc
import logging
import os
import threading
import time
import tracemalloc

logger = logging.getLogger("itflux.process")
if not logger.handlers:
    _handler = logging.StreamHandler()
    _handler.setFormatter(logging.Formatter("%(levelname)s %(name)s %(message)s"))
    logger.addHandler(_handler)
    logger.setLevel(logging.INFO)
    logger.propagate = False

_started = False
_previous = None
_lock = threading.Lock()


def _rss_kb() -> int:
    try:
        with open("/proc/self/status", encoding="utf-8") as handle:
            for line in handle:
                if line.startswith("VmRSS:"):
                    return int(line.split()[1])
    except OSError:
        pass
    return 0


def _pss_kb() -> int:
    total = 0
    try:
        with open("/proc/self/smaps_rollup", encoding="utf-8") as handle:
            for line in handle:
                if line.startswith("Pss:"):
                    return int(line.split()[1])
    except OSError:
        return 0
    return total


def _fd_count() -> int:
    try:
        return len(os.listdir("/proc/self/fd"))
    except OSError:
        return 0


def _cache_entries() -> int:
    try:
        from django.core.cache import cache

        inner = getattr(cache, "_cache", None)
        if isinstance(inner, dict):
            return len(inner)
    except Exception:
        return -1
    return -1


def _postgres_pressure() -> dict:
    try:
        from django.db import connection

        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT
                  count(*) FILTER (WHERE state = 'active'),
                  count(*) FILTER (
                    WHERE state = 'idle in transaction'
                      AND state_change < now() - interval '30 seconds'
                  ),
                  count(*)
                FROM pg_stat_activity
                WHERE datname = current_database()
                  AND backend_type = 'client backend'
                """
            )
            active, idle_old, total = cursor.fetchone()
        return {
            "pg_active": int(active or 0),
            "pg_idle_in_transaction_over_30s": int(idle_old or 0),
            "pg_client_backends": int(total or 0),
        }
    except Exception:
        logger.debug("postgres pressure snapshot failed", exc_info=True)
        return {}


def pressure_alerts(stats: dict) -> list[str]:
    alerts = []
    active = int(stats.get("pg_active") or 0)
    if active > 90:
        alerts.append(f"pg_active_connections={active} threshold=90")
    elif active > 75:
        alerts.append(f"pg_active_connections={active} threshold=75")
    idle = int(stats.get("pg_idle_in_transaction_over_30s") or 0)
    if idle > 0:
        alerts.append(f"pg_idle_in_transaction_over_30s={idle}")
    return alerts


def _top_traces(limit: int = 8) -> list[str]:
    if not tracemalloc.is_tracing():
        return []
    snapshot = tracemalloc.take_snapshot()
    global _previous
    lines = []
    if _previous is not None:
        diffs = snapshot.compare_to(_previous, "lineno")
        for stat in diffs[:limit]:
            if stat.size_diff <= 0:
                continue
            frame = stat.traceback[0] if stat.traceback else None
            where = f"{frame.filename}:{frame.lineno}" if frame else "?"
            lines.append(f"{where} +{stat.size_diff // 1024}KiB n={stat.count_diff}")
    else:
        for stat in snapshot.statistics("lineno")[:limit]:
            frame = stat.traceback[0] if stat.traceback else None
            where = f"{frame.filename}:{frame.lineno}" if frame else "?"
            lines.append(f"{where} {stat.size // 1024}KiB n={stat.count}")
    _previous = snapshot
    return lines


def _heavy_snapshot() -> bool:
    if tracemalloc_enabled():
        return True
    raw = (os.environ.get("ITFLUX_PROCESS_SNAPSHOT_HEAVY") or "").strip().lower()
    return raw in ("1", "true", "yes", "on")


def log_process_snapshot(reason: str) -> None:
    with _lock:
        rss_before = _rss_kb()
        if _heavy_snapshot():
            collected = gc.collect()
            rss_after = _rss_kb()
            gc_objects = len(gc.get_objects())
        else:
            collected = 0
            rss_after = rss_before
            gc_objects = -1
        try:
            from Cabinet.channel_retention import channel_layer_stats, clean_expired_channels

            channels = clean_expired_channels()
        except Exception:
            channels = {}
        try:
            from Cabinet.board_scene_slot import staged_scene_count

            scenes = staged_scene_count()
        except Exception:
            scenes = -1
        try:
            from Cabinet.ws_lifecycle import live_socket_count

            sockets = live_socket_count()
        except Exception:
            sockets = -1
        try:
            tasks = len([task for task in __import__("asyncio").all_tasks() if not task.done()])
        except RuntimeError:
            tasks = -1
        pg = _postgres_pressure()
        heap_kb = 0
        if tracemalloc.is_tracing():
            heap_kb = tracemalloc.get_traced_memory()[0] // 1024
        rooms = -1
        try:
            from channels.layers import get_channel_layer

            groups = getattr(get_channel_layer(), "groups", None) or {}
            rooms = len(groups)
        except Exception:
            rooms = -1
        parts = [
            f"snapshot reason={reason}",
            f"rss_kb={rss_before}",
            f"rss_after_gc_kb={rss_after}",
            f"pss_kb={_pss_kb()}",
            f"python_heap_kb={heap_kb}",
            f"gc_collected={collected}",
            f"gc_objects={gc_objects}",
            f"threads={threading.active_count()}",
            f"fds={_fd_count()}",
            f"tasks={tasks}",
            f"consumers={sockets}",
            f"cache_entries={_cache_entries()}",
            f"staged_scenes={scenes}",
            f"active_rooms={rooms}",
            f"uptime_s={int(time.time() - _started_at)}",
        ]
        for key, value in {**channels, **pg}.items():
            parts.append(f"{key}={value}")
        try:
            from Cabinet.realtime_db import get_gate

            gate = get_gate().snapshot()
            for key in (
                "realtime_db_active_workers",
                "realtime_db_queue_depth",
                "realtime_db_queue_wait_ms",
                "realtime_db_saturated_total",
                "realtime_db_timeout_total",
            ):
                if key in gate:
                    parts.append(f"{key}={gate[key]}")
        except Exception:
            pass
        line = " ".join(parts)
        logger.info(line)
        try:
            with open("/var/log/itflux/process-snapshot.log", "a", encoding="utf-8") as handle:
                handle.write(f"{time.time():.0f} {line}\n")
        except OSError:
            logger.debug("snapshot file write failed", exc_info=True)
        for alert in pressure_alerts(pg):
            logger.warning("pg_budget %s", alert)
        traces = _top_traces()
        if traces:
            logger.info("snapshot_traces reason=%s %s", reason, " | ".join(traces))


_started_at = time.time()


def _dump_proc_files(reason: str) -> str:
    """Copy the kernel memory maps. Used when RSS jumps, not on a timer."""
    stamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
    dest = f"/var/log/itflux/smaps/{stamp}-{reason}"
    try:
        os.makedirs(dest, exist_ok=True)
        for name in ("status", "smaps_rollup", "smaps", "maps"):
            with open(f"/proc/self/{name}", "rb") as src, open(os.path.join(dest, name), "wb") as out:
                while True:
                    chunk = src.read(1024 * 1024)
                    if not chunk:
                        break
                    out.write(chunk)
    except OSError:
        logger.debug("smaps dump failed", exc_info=True)
        return ""
    return dest


def _watch_rss_jumps() -> None:
    """Save smaps when RSS grows by more than 100 MB inside five minutes."""
    samples: list[tuple[float, int]] = []
    while True:
        time.sleep(60)
        rss = _rss_kb()
        now = time.time()
        samples.append((now, rss))
        samples = [(ts, value) for ts, value in samples if now - ts <= 300]
        if not samples:
            continue
        baseline = min(value for _, value in samples)
        if rss - baseline < 100 * 1024:
            continue
        dest = _dump_proc_files("jump")
        logger.info(
            "rss_jump rss_kb=%s baseline_kb=%s dump=%s",
            rss,
            baseline,
            dest or "failed",
        )
        samples[:] = [(now, rss)]


def tracemalloc_enabled() -> bool:
    """Tracing every allocation kept multi-gigabyte RSS while the traced heap stayed ~0.5 GB."""
    raw = (os.environ.get("ITFLUX_TRACEMALLOC") or "").strip().lower()
    return raw in ("1", "true", "yes", "on")


def start_process_snapshots(interval_s: float = 900.0) -> None:
    global _started
    if _started:
        return
    _started = True
    if tracemalloc_enabled() and not tracemalloc.is_tracing():
        tracemalloc.start(5)

    def _loop():
        time.sleep(2)
        first = True
        while True:
            try:
                log_process_snapshot("startup" if first else "interval")
                first = False
            except Exception:
                logger.exception("snapshot failed")
            time.sleep(interval_s)

    print("itflux_snapshot_thread_starting", flush=True)

    threading.Thread(target=_loop, name="process-snapshot", daemon=True).start()
    threading.Thread(target=_watch_rss_jumps, name="rss-jump", daemon=True).start()
