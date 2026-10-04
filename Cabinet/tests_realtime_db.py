import asyncio
import logging
import threading
import time

from django.test import SimpleTestCase

from Cabinet.realtime_db import (
    BoundedRealtimeDb,
    RealtimeDbSaturated,
    realtime_db_critical,
)


class BoundedRealtimeDbTests(SimpleTestCase):
    def test_full_queue_rejects_without_adding_threads(self):
        gate = BoundedRealtimeDb(workers=1, queue_limit=2, wait_timeout=0.05)

        async def one():
            try:
                await gate.run(time.sleep, 0.3)
                return "ok"
            except RealtimeDbSaturated:
                return "rejected"

        async def main():
            return await asyncio.gather(*[one() for _ in range(6)])

        before = threading.active_count()
        results = asyncio.run(main())
        gate.executor.shutdown(wait=True, cancel_futures=True)
        self.assertGreaterEqual(results.count("rejected"), 4)
        self.assertLessEqual(threading.active_count(), before + 2)
        self.assertGreaterEqual(gate.rejected_or_timed_out, 4)
        self.assertLessEqual(gate.snapshot()["realtime_db_active_workers"], 1)
        self.assertGreaterEqual(
            gate.snapshot()["realtime_db_saturated_total"] + gate.snapshot()["realtime_db_timeout_total"],
            4,
        )

    def test_worker_exception_propagates_and_slot_returns(self):
        gate = BoundedRealtimeDb(workers=1, queue_limit=2, wait_timeout=1)

        def boom():
            raise RuntimeError("db down")

        with self.assertRaises(RuntimeError):
            asyncio.run(gate.run(boom))
        self.assertEqual(gate.snapshot()["realtime_db_active_workers"], 0)
        self.assertEqual(gate.snapshot()["realtime_db_queue_depth"], 0)
        gate.shutdown()

    def test_cancel_does_not_leave_the_slot_held(self):
        gate = BoundedRealtimeDb(workers=1, queue_limit=2, wait_timeout=1)

        async def main():
            task = asyncio.create_task(gate.run(time.sleep, 0.3))
            await asyncio.sleep(0.05)
            task.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await task
            await asyncio.sleep(0.4)
            self.assertEqual(gate.snapshot()["realtime_db_queue_depth"], 0)
            return await gate.run(lambda: "next")

        self.assertEqual(asyncio.run(main()), "next")
        gate.shutdown()

    def test_full_queue_is_critical_only_when_marked(self):
        gate = BoundedRealtimeDb(workers=1, queue_limit=1, wait_timeout=0.05)

        async def hold():
            await gate.run(time.sleep, 0.3)

        async def main():
            holder = asyncio.create_task(hold())
            await asyncio.sleep(0.05)
            token = realtime_db_critical.set(True)
            try:
                await gate.run(lambda: None)
            except RealtimeDbSaturated as exc:
                critical = exc.critical
            else:
                critical = None
            finally:
                realtime_db_critical.reset(token)
            await holder
            return critical

        self.assertIs(asyncio.run(main()), True)
        gate.shutdown()

    def test_saturation_does_not_log_per_frame(self):
        gate = BoundedRealtimeDb(workers=1, queue_limit=1, wait_timeout=0.01)
        seen = []

        class _Catch(logging.Handler):
            def emit(self, record):
                seen.append(record.getMessage())

        handler = _Catch()
        logging.getLogger("itflux.realtime_db").addHandler(handler)
        try:
            for _ in range(40):
                try:
                    gate._fail("saturated")
                except RealtimeDbSaturated:
                    pass
        finally:
            logging.getLogger("itflux.realtime_db").removeHandler(handler)
        self.assertEqual(seen, [])
        self.assertEqual(gate.snapshot()["realtime_db_saturated_total"], 40)
        gate.shutdown()
