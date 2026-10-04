"""Logging sinks that must not run on the Twisted or asyncio thread.

A StreamHandler, file, journal, or socket write on the reactor blocks every
socket once the sink stops reading. protect_logger() leaves a QueueHandler
on the calling thread. A daemon QueueListener performs the real write.
A full queue drops the record. The default QueueHandler error path writes
to stderr from the caller, which is the same stall, so that path is empty.
"""

from __future__ import annotations

import logging
import logging.handlers
import queue

_LISTENERS: list[logging.handlers.QueueListener] = []


class _DroppingQueueHandler(logging.handlers.QueueHandler):
    dropped = 0

    def handleError(self, record) -> None:
        type(self).dropped += 1


def protect_logger(name: str) -> None:
    log = logging.getLogger(name)
    if getattr(log, "_itflux_loop_safe", False):
        return
    sinks = [
        handler
        for handler in list(log.handlers)
        if not isinstance(handler, logging.handlers.QueueHandler)
    ]
    if not sinks:
        sink = logging.StreamHandler()
        sink.setFormatter(logging.Formatter("%(levelname)s %(name)s %(message)s"))
        sinks = [sink]
    records: queue.Queue = queue.Queue(maxsize=1024)
    log.handlers = [_DroppingQueueHandler(records)]
    log.propagate = False
    log._itflux_loop_safe = True
    listener = logging.handlers.QueueListener(
        records,
        *sinks,
        respect_handler_level=True,
    )
    listener.start()
    _LISTENERS.append(listener)
