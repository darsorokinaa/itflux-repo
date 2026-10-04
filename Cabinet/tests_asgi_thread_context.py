import asyncio
import subprocess
import sys
import threading
import time

from asgiref.sync import ThreadSensitiveContext, async_to_sync, sync_to_async
from django.test import SimpleTestCase

from Cabinet.process_snapshot import tracemalloc_enabled
from Cabinet.thread_sensitive_shutdown import install_nonblocking_executor_shutdown


def _sleep(seconds):
    threading.current_thread().ident_holder = threading.get_ident()
    time.sleep(seconds)
    return threading.get_ident()


class PerConnectionThreadContextTests(SimpleTestCase):
    def test_two_contexts_do_not_wait_on_one_thread(self):
        async def scenario():
            async def slow():
                async with ThreadSensitiveContext():
                    return await sync_to_async(_sleep)(0.4)

            async def fast():
                await asyncio.sleep(0.05)
                async with ThreadSensitiveContext():
                    started = time.perf_counter()
                    ident = await sync_to_async(_sleep)(0.05)
                    return ident, time.perf_counter() - started

            slow_ident, (fast_ident, fast_wait) = await asyncio.gather(slow(), fast())
            return slow_ident, fast_ident, fast_wait

        slow_ident, fast_ident, fast_wait = asyncio.run(scenario())
        self.assertNotEqual(slow_ident, fast_ident)
        self.assertLess(fast_wait, 0.25)

    def test_context_exit_does_not_block_the_loop(self):
        install_nonblocking_executor_shutdown()

        async def scenario():
            entered = threading.Event()
            release = asyncio.Event()

            async def needs_loop():
                await release.wait()

            async with ThreadSensitiveContext():
                def sync_part():
                    entered.set()
                    async_to_sync(needs_loop)()

                task = asyncio.create_task(sync_to_async(sync_part)())
                await asyncio.to_thread(entered.wait, 2)
                await asyncio.sleep(0.05)
                # Queued before __aexit__. A blocking shutdown() never runs it,
                # so the worker stays inside async_to_sync forever.
                asyncio.get_running_loop().call_soon(release.set)

            await asyncio.wait_for(task, 2)

        asyncio.run(asyncio.wait_for(scenario(), 3))

    def test_stock_shutdown_blocks_the_loop(self):
        script = r"""
import asyncio, threading
from asgiref.sync import ThreadSensitiveContext, async_to_sync, sync_to_async

async def scenario():
    entered = threading.Event()
    release = asyncio.Event()
    async def needs_loop():
        await release.wait()
    async with ThreadSensitiveContext():
        def sync_part():
            entered.set()
            async_to_sync(needs_loop)()
        asyncio.create_task(sync_to_async(sync_part)())
        await asyncio.to_thread(entered.wait, 2)
        await asyncio.sleep(0.05)
        asyncio.get_running_loop().call_soon(release.set)

asyncio.run(asyncio.wait_for(scenario(), 2))
print("finished")
"""
        try:
            completed = subprocess.run(
                [sys.executable, "-c", script],
                capture_output=True,
                text=True,
                timeout=3,
            )
        except subprocess.TimeoutExpired:
            return
        self.fail(
            "stock ThreadSensitiveContext.__aexit__ returned; "
            f"rc={completed.returncode} out={completed.stdout!r} err={completed.stderr[-400:]!r}"
        )

    def test_tracemalloc_off_unless_requested(self):
        self.assertFalse(tracemalloc_enabled())
