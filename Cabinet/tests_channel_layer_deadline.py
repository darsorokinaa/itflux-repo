"""Channel layer must not abort an idle BZPOPMIN at redis-py's socket deadline."""

import asyncio

from django.conf import settings
from django.test import SimpleTestCase
from redis.exceptions import TimeoutError as RedisTimeout


class RedisChannelLayerDeadlineTests(SimpleTestCase):
    def _redis_host(self):
        layer = settings.CHANNEL_LAYERS["default"]
        if layer["BACKEND"] != "channels_redis.core.RedisChannelLayer":
            self.skipTest("channel layer is not Redis")
        hosts = layer["CONFIG"]["hosts"]
        self.assertEqual(len(hosts), 1)
        host = hosts[0]
        self.assertIsInstance(host, dict)
        return host

    def test_socket_read_deadline_is_not_the_blocking_pop(self):
        host = self._redis_host()
        # redis-py 8 defaults this to 5, which is also brpop_timeout.
        self.assertIsNone(host["socket_timeout"])
        self.assertEqual(host["socket_connect_timeout"], 5)

    def test_idle_receive_stays_open_past_the_old_five_second_abort(self):
        host = self._redis_host()
        try:
            from redis.asyncio import Redis

            async def ping():
                client = Redis(
                    host=host["host"],
                    port=host["port"],
                    socket_connect_timeout=host["socket_connect_timeout"],
                    socket_timeout=1,
                )
                try:
                    return await client.ping()
                finally:
                    await client.aclose()

            ok = asyncio.run(ping())
        except Exception as exc:
            self.skipTest(f"redis unavailable: {exc}")
        self.assertTrue(ok)

        from channels_redis.core import RedisChannelLayer

        async def receive_idle():
            layer = RedisChannelLayer(hosts=[host])
            channel = await layer.new_channel()
            try:
                await asyncio.wait_for(layer.receive(channel), timeout=6.2)
            except asyncio.TimeoutError:
                return "open"
            except RedisTimeout:
                return "aborted"
            finally:
                await layer.flush()
            return "message"

        self.assertEqual(asyncio.run(receive_idle()), "open")
