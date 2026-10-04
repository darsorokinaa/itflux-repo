"""Isolated Postgres measurement for the bounded realtime DB pool.

Starts nothing on production. Postgres is expected at 127.0.0.1:5433.
"""

from __future__ import annotations

import json
import os
import resource
import threading
import time

import django
from django.conf import settings

if not settings.configured:
    settings.configure(
        SECRET_KEY="realtime-pool-probe",
        DATABASES={
            "default": {
                "ENGINE": "django.db.backends.postgresql",
                "NAME": "postgres",
                "USER": "itflux",
                "HOST": "127.0.0.1",
                "PORT": "5433",
                "CONN_MAX_AGE": 0,
            }
        },
        CHANNEL_LAYERS={"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}},
    )
    django.setup()

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import psycopg2
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.routing import ProtocolTypeRouter, URLRouter
from django.db import connection
from django.urls import re_path

from Cabinet.realtime_db import BoundedRealtimeDb

HOLD_SQL = "SELECT pg_sleep(0.01)"
CURRENT = {"gate": None}
_peak_backends = 0
_stop_poll = False


def short_orm():
    started = time.perf_counter()
    with connection.cursor() as cursor:
        cursor.execute(HOLD_SQL)
        cursor.fetchone()
    usage = resource.getrusage(resource.RUSAGE_SELF)
    return {
        "thread": threading.get_ident(),
        "orm_ms": round((time.perf_counter() - started) * 1000, 2),
        "py_threads": threading.active_count(),
        "rss": usage.ru_maxrss,
        "cpu_s": round(usage.ru_utime + usage.ru_stime, 3),
        "nvcsw": usage.ru_nvcsw,
        "nivcsw": usage.ru_nivcsw,
    }


def ensure_gate():
    if CURRENT["gate"] is None:
        workers = int(os.environ.get("POOL_WORKERS", "8"))
        queue_limit = int(os.environ.get("POOL_QUEUE", "1000"))
        wait_timeout = float(os.environ.get("POOL_TIMEOUT", "30"))
        CURRENT["gate"] = BoundedRealtimeDb(workers, queue_limit, wait_timeout)
    return CURRENT["gate"]


class Probe(AsyncWebsocketConsumer):
    async def receive(self, text_data=None, bytes_data=None):
        try:
            started = time.perf_counter()
            data = await ensure_gate().run(short_orm)
            data["server_ms"] = round((time.perf_counter() - started) * 1000, 2)
            data["error"] = ""
        except Exception as exc:
            data = {"error": type(exc).__name__, "thread": 0, "orm_ms": 0, "py_threads": threading.active_count(), "rss": 0, "cpu_s": 0, "nvcsw": 0, "nivcsw": 0}
        await self.send(text_data=json.dumps(data))


application = ProtocolTypeRouter({
    "websocket": URLRouter([re_path(r"^ws/probe/$", Probe.as_asgi())]),
})


def _poll_backends():
    global _peak_backends
    conn = psycopg2.connect(dbname="postgres", user="itflux", host="127.0.0.1", port=5433)
    try:
        while not _stop_poll:
            with conn.cursor() as cursor:
                cursor.execute(
                    "SELECT count(*) FROM pg_stat_activity "
                    "WHERE datname = 'postgres' AND backend_type = 'client backend' "
                    "AND pid <> pg_backend_pid()"
                )
                count = cursor.fetchone()[0]
            if count > _peak_backends:
                _peak_backends = count
            time.sleep(0.02)
    finally:
        conn.close()


def main():
    import base64
    import socket
    import subprocess
    import sys

    global _peak_backends, _stop_poll
    port = 8791
    env = os.environ.copy()
    env["NO_PROXY"] = "*"
    env["no_proxy"] = "*"
    env["PYTHONPATH"] = str(__import__("pathlib").Path(__file__).resolve().parents[1])
    proc = None

    def open_ws():
        sock = socket.create_connection(("127.0.0.1", port), timeout=10)
        key = base64.b64encode(os.urandom(16)).decode()
        sock.sendall(
            (
                "GET /ws/probe/ HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\n"
                "Connection: Upgrade\r\nSec-WebSocket-Key: %s\r\nSec-WebSocket-Version: 13\r\n\r\n" % key
            ).encode()
        )
        data = b""
        while b"\r\n\r\n" not in data:
            chunk = sock.recv(4096)
            if not chunk:
                break
            data += chunk
        if b" 101 " not in data.split(b"\r\n", 1)[0]:
            raise RuntimeError(data[:120])
        return sock

    def send_text(sock, text="x"):
        payload = text.encode()
        mask = os.urandom(4)
        header = bytearray([0x81])
        n = len(payload)
        if n < 126:
            header.append(0x80 | n)
        else:
            header.append(0x80 | 126)
            header.extend(n.to_bytes(2, "big"))
        sock.sendall(bytes(header) + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(payload)))

    def recv_text(sock):
        def read(n):
            data = b""
            while len(data) < n:
                chunk = sock.recv(n - len(data))
                if not chunk:
                    raise RuntimeError("closed")
                data += chunk
            return data

        sock.settimeout(60)
        first, second = read(2)
        length = second & 0x7F
        if length == 126:
            length = int.from_bytes(read(2), "big")
        return read(length).decode()

    poller = threading.Thread(target=_poll_backends, daemon=True)
    poller.start()

    def pct(values, p):
        if not values:
            return None
        ordered = sorted(values)
        return round(ordered[min(len(ordered) - 1, int(round((len(ordered) - 1) * p)))], 2)

    def burst(workers, n, queue_limit, wait_timeout):
        global _peak_backends
        _peak_backends = 0
        child_env = env.copy()
        child_env["POOL_WORKERS"] = str(workers)
        child_env["POOL_QUEUE"] = str(queue_limit)
        child_env["POOL_TIMEOUT"] = str(wait_timeout)
        child = subprocess.Popen(
            [sys.executable, "-m", "daphne", "-b", "127.0.0.1", "-p", str(port), "scripts.measure_realtime_db_pool:application"],
            env=child_env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        stderr_tail = bytearray()

        def _drain(stream, keep_tail):
            while True:
                chunk = stream.read(65536)
                if not chunk:
                    return
                if keep_tail:
                    stderr_tail.extend(chunk)
                    if len(stderr_tail) > 4000:
                        del stderr_tail[:-2000]

        threading.Thread(target=_drain, args=(child.stdout, False), daemon=True).start()
        threading.Thread(target=_drain, args=(child.stderr, True), daemon=True).start()
        ready = time.time() + 15
        while time.time() < ready:
            try:
                probe = open_ws()
                probe.close()
                break
            except Exception:
                time.sleep(0.15)
        else:
            raise SystemExit(bytes(stderr_tail).decode()[:500])
        socks = []
        connect_ms = []
        errors = []
        for _ in range(n):
            started = time.perf_counter()
            try:
                socks.append(open_ws())
                connect_ms.append((time.perf_counter() - started) * 1000)
            except Exception as exc:
                errors.append(type(exc).__name__)
                break
        for sock in socks:
            send_text(sock)
        replies = []
        recv_ms = []
        for sock in socks:
            started = time.perf_counter()
            try:
                replies.append(json.loads(recv_text(sock)))
                recv_ms.append((time.perf_counter() - started) * 1000)
            except Exception as exc:
                errors.append("recv:" + type(exc).__name__)
        for sock in socks:
            sock.close()
        time.sleep(0.3)
        sample = next((row for row in reversed(replies) if not row.get("error")), {})
        rejected = sum(1 for row in replies if row.get("error"))
        ok = [row for row in replies if not row.get("error")]
        orm = [row["orm_ms"] for row in ok]
        waits = [max(0, row["server_ms"] - row["orm_ms"]) for row in ok]
        summary = {
            "workers": workers,
            "sockets": n,
            "opened": len(socks),
            "queue_limit": queue_limit,
            "py_threads": sample.get("py_threads"),
            "unique_orm_threads": len({row["thread"] for row in replies if row.get("thread")}),
            "pg_backends_peak": _peak_backends,
            "rss": sample.get("rss"),
            "cpu_s": sample.get("cpu_s"),
            "nivcsw": sample.get("nivcsw"),
            "connect_p50": pct(connect_ms, 0.5),
            "connect_p99": pct(connect_ms, 0.99),
            "queue_p50": pct(waits, 0.5),
            "queue_p95": pct(waits, 0.95),
            "queue_p99": pct(waits, 0.99),
            "orm_p50": pct(orm, 0.5),
            "orm_p95": pct(orm, 0.95),
            "orm_p99": pct(orm, 0.99),
            "recv_p50": pct(recv_ms, 0.5),
            "recv_p95": pct(recv_ms, 0.95),
            "recv_p99": pct(recv_ms, 0.99),
            "rejected": rejected,
            "error_names": sorted({row.get("error") for row in replies if row.get("error")})[:4],
            "errors": errors[:4],
        }
        child.terminate()
        child.wait(timeout=5)
        print(json.dumps(summary), flush=True)

    try:
        for workers in (8, 16, 32):
            for sockets in (100, 500, 1000):
                burst(workers, sockets, queue_limit=sockets + workers, wait_timeout=30)
        burst(16, 200, queue_limit=64, wait_timeout=0.05)
    finally:
        _stop_poll = True


if __name__ == "__main__":
    main()
