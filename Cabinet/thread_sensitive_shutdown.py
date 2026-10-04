"""Keep Daphne's event loop free while a thread-sensitive executor exits.

asgiref 3.11 ThreadSensitiveContext.__aexit__ calls executor.shutdown() on the
event-loop thread. shutdown() joins the worker. That worker is often inside
async_to_sync(), waiting for the same loop to run the scheduled coroutine
(client disconnect, or a sync middleware calling into async code). The loop
never accepts another connection: the listen queue stays full and nginx
returns 504 after proxy_read_timeout.

The worker is joined from the default executor instead, so the loop can finish
the coroutine the worker is waiting on.
"""

from __future__ import annotations

import asyncio
import logging
import time

logger = logging.getLogger("itflux.asgi")

# Written against asgiref 3.11, where ThreadSensitiveContext.__aexit__ calls
# executor.shutdown() on the loop thread. A newer asgiref may move or remove
# context_to_thread_executor; applying this patch blindly would hide that.
_SUPPORTED_ASGIREF = (3, 11)
_installed = False


def install_nonblocking_executor_shutdown() -> None:
    global _installed
    if _installed:
        return

    import asgiref
    from asgiref.sync import SyncToAsync, ThreadSensitiveContext

    if not hasattr(SyncToAsync, "context_to_thread_executor"):
        raise RuntimeError(
            f"asgiref {asgiref.__version__} has no SyncToAsync.context_to_thread_executor. "
            "Refusing to patch ThreadSensitiveContext."
        )
    version = tuple(int(part) for part in asgiref.__version__.split(".")[:2])
    if version != _SUPPORTED_ASGIREF:
        raise RuntimeError(
            f"asgiref {asgiref.__version__} is outside the shutdown patch (3.11). "
            "Read ThreadSensitiveContext.__aexit__ before changing this guard."
        )

    async def __aexit__(self, exc, value, tb):
        if not self.token:
            return
        executor = SyncToAsync.context_to_thread_executor.pop(self, None)
        SyncToAsync.thread_sensitive_context.reset(self.token)
        self.token = None
        if executor is None:
            return
        loop = asyncio.get_running_loop()
        started = time.perf_counter()
        await loop.run_in_executor(None, executor.shutdown)
        waited_ms = int((time.perf_counter() - started) * 1000)
        cancelled = bool(exc is not None and issubclass(exc, asyncio.CancelledError))
        if waited_ms >= 1000:
            logger.warning(
                "thread_sensitive_shutdown_slow waited_ms=%s cancelled=%s",
                waited_ms,
                cancelled,
            )

    ThreadSensitiveContext.__aexit__ = __aexit__
    _installed = True
