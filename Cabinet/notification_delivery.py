"""Deliver Telegram and Web Push off the request thread.

The HTTP response does not need the push provider. A single daemon thread,
started from ASGI, drains a bounded queue. Tests leave the mode inline, so
NotificationDispatcher.notify still finishes the send before it returns.
Per-request threading.Thread(...).start() is not used.
"""

from __future__ import annotations

import logging
import queue
import threading

logger = logging.getLogger("cabinet.notifications")

_jobs: queue.Queue = queue.Queue(maxsize=200)
_started = False
_async = False


def notification_delivery_is_async() -> bool:
    return _async


def reset_notification_delivery_for_tests() -> None:
    """Tests keep the historical inline send. Does not stop the thread."""
    global _async
    _async = False


def start_background_delivery() -> None:
    global _started, _async
    if _started:
        return
    _async = True
    _started = True
    threading.Thread(target=_loop, name="notification-delivery", daemon=True).start()


def schedule_notification(job) -> None:
    if not _async:
        job()
        return
    try:
        _jobs.put_nowait(job)
    except queue.Full:
        logger.warning("notification_delivery_dropped")


def _loop() -> None:
    from django.db import close_old_connections

    while True:
        job = _jobs.get()
        close_old_connections()
        try:
            job()
        except Exception:
            logger.exception("notification_delivery_failed")
        finally:
            close_old_connections()
