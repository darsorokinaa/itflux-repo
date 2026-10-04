"""A full stderr pipe must not stall a realtime burst.

The parent starts Daphne with stdout and stderr as pipes and does not read
them. The child fills stderr until that write blocks. Every frame must still
come back as ok or RealtimeDbSaturated. A timeout means the reactor wrote to
the pipe itself.
"""

from __future__ import annotations

import array
import base64
import fcntl
import json
import os
import socket
import sys
import termios
import threading
import time

PORT = 8795
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _pipe_pending(stream) -> int:
    buf = array.array("i", [0])
    commands = [getattr(termios, "FIONREAD", 0), 0x541B, 0x4004667F]
    for command in commands:
        if not command:
            continue
        try:
            fcntl.ioctl(stream.fileno(), int(command), buf, True)
            return int(buf[0])
        except OSError:
            continue
    return -1


if __name__ != "__main__":
    import asyncio

    import django
    from channels.generic.websocket import AsyncWebsocketConsumer
    from channels.routing import ProtocolTypeRouter, URLRouter
    from django.conf import settings
    from django.urls import re_path

    if not settings.configured:
        settings.configure(
            SECRET_KEY="stderr-guard",
            CHANNEL_LAYERS={"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}},
            DATABASES={"default": {"ENGINE": "django.db.backends.sqlite3", "NAME": ":memory:"}},
        )
        django.setup()

    sys.path.insert(0, ROOT)
    from Cabinet.realtime_db import BoundedRealtimeDb, RealtimeDbSaturated

    _filled = False

    def _fill_stderr() -> None:
        chunk = b"x" * 8192
        fd = sys.stderr.fileno()
        while True:
            os.write(fd, chunk)

    class Echo(AsyncWebsocketConsumer):
        gate = BoundedRealtimeDb(16, 64, 1.0)

        async def connect(self):
            global _filled
            if not _filled:
                _filled = True
                threading.Thread(target=_fill_stderr, name="stderr-fill", daemon=True).start()
            await self.accept()

        async def receive(self, text_data=None, bytes_data=None):
            try:
                await self.gate.run(lambda: time.sleep(0.05))
                body = "{\"ok\":1}"
            except RealtimeDbSaturated:
                body = "{\"error\":\"RealtimeDbSaturated\"}"
            await self.send(text_data=body)

    async def http_ok(scope, receive, send):
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b"{}"})

    application = ProtocolTypeRouter({
        "http": http_ok,
        "websocket": URLRouter([re_path(r"^ws/probe/$", Echo.as_asgi())]),
    })
    del asyncio


def _open_ws():
    sock = socket.create_connection(("127.0.0.1", PORT), timeout=10)
    key = base64.b64encode(os.urandom(16)).decode()
    sock.sendall(
        (
            "GET /ws/probe/ HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\n"
            "Connection: Upgrade\r\nSec-WebSocket-Key: %s\r\nSec-WebSocket-Version: 13\r\n\r\n"
            % key
        ).encode()
    )
    data = b""
    while b"\r\n\r\n" not in data:
        chunk = sock.recv(4096)
        if not chunk:
            break
        data += chunk
    if b" 101 " not in data.split(b"\r\n", 1)[0]:
        raise RuntimeError(data[:160])
    return sock


def _send(sock, text: str) -> None:
    payload = text.encode()
    mask = os.urandom(4)
    header = bytearray([0x81, 0x80 | len(payload)])
    sock.sendall(bytes(header) + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(payload)))


def _recv(sock, timeout: float) -> bytes:
    def read(n):
        data = b""
        while len(data) < n:
            chunk = sock.recv(n - len(data))
            if not chunk:
                raise RuntimeError("closed")
            data += chunk
        return data

    sock.settimeout(timeout)
    first, second = read(2)
    length = second & 0x7F
    if length == 126:
        length = int.from_bytes(read(2), "big")
    elif length == 127:
        length = int.from_bytes(read(8), "big")
    if first & 0x0F == 0x8:
        raise RuntimeError("close")
    return read(length)


def main() -> None:
    import subprocess

    env = os.environ.copy()
    env["NO_PROXY"] = "*"
    env["PYTHONPATH"] = ROOT
    child = subprocess.Popen(
        [sys.executable, "-m", "daphne", "-b", "127.0.0.1", "-p", str(PORT), "scripts.guard_realtime_stderr_pipe:application"],
        cwd=ROOT,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    try:
        deadline = time.time() + 20
        while time.time() < deadline:
            try:
                probe = _open_ws()
                probe.close()
                break
            except Exception:
                time.sleep(0.1)
        else:
            raise SystemExit("daphne did not accept a probe socket")
        time.sleep(0.4)
        pending = _pipe_pending(child.stderr)
        n = 200
        ready = threading.Barrier(n)
        fire = threading.Barrier(n)
        rows = []
        lock = threading.Lock()

        def one(index):
            row = {"error": "", "body": "", "recv_ms": None}
            try:
                sock = _open_ws()
                ready.wait(30)
                fire.wait(30)
                _send(sock, json.dumps({"id": index}))
                started = time.perf_counter()
                row["body"] = _recv(sock, 4).decode("utf-8", "replace")
                row["recv_ms"] = (time.perf_counter() - started) * 1000
                sock.close()
            except Exception as exc:
                row["error"] = type(exc).__name__
            with lock:
                rows.append(row)

        threads = [threading.Thread(target=one, args=(i,)) for i in range(n)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        ok = [row for row in rows if not row["error"]]
        recv = sorted(row["recv_ms"] for row in ok)

        def pct(p):
            if not recv:
                return None
            return round(recv[min(len(recv) - 1, int(round((len(recv) - 1) * p)))], 1)

        summary = {
            "sockets": n,
            "stderr_pending": pending,
            "response": len(ok),
            "saturated": sum(1 for row in ok if "RealtimeDbSaturated" in row["body"]),
            "timeout": sum(1 for row in rows if row["error"] == "TimeoutError"),
            "other": sorted({row["error"] for row in rows if row["error"]})[:4],
            "recv_p50": pct(0.50),
            "recv_p95": pct(0.95),
            "recv_p99": pct(0.99),
        }
        print(json.dumps(summary), flush=True)
        if summary["timeout"] or summary["response"] != n or pending < 1024:
            raise SystemExit(1)
    finally:
        child.terminate()
        try:
            child.wait(timeout=5)
        except subprocess.TimeoutExpired:
            child.kill()


if __name__ == "__main__":
    main()
