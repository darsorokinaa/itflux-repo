import asyncio
import threading
import time

from asgiref.sync import ThreadSensitiveContext, sync_to_async
from django.test import SimpleTestCase


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
