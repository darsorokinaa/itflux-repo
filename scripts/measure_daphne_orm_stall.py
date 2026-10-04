"""Reproduce a slow ORM call beside other work in one Daphne process.

Run: python scripts/measure_daphne_orm_stall.py
It listens on 127.0.0.1:8771, issues A/B/C/D, then exits.
"""

from __future__ import annotations

import json
import threading
import time

import django
from django.conf import settings

if not settings.configured:
    settings.configure(
        CHANNEL_LAYERS={"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}},
        SECRET_KEY="daphne-stall-probe",
    )
    django.setup()

from channels.db import database_sync_to_async
from channels.generic.http import AsyncHttpConsumer
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.routing import ProtocolTypeRouter, URLRouter
from django.urls import re_path

HOLD = 8.0
_ticker_started = False


def stamp(label):
    print(f"STAMP {label} {time.perf_counter():.3f} thread={threading.get_ident()}", flush=True)


async def ticker():
    while True:
        stamp("tick")
        await asyncio_sleep()


async def asyncio_sleep():
    import asyncio
    await asyncio.sleep(0.5)


def slow_orm():
    ident = threading.get_ident()
    t0 = time.perf_counter()
    time.sleep(HOLD)
    return {"thread": ident, "slept": round(time.perf_counter() - t0, 3)}


def fast_orm():
    ident = threading.get_ident()
    t0 = time.perf_counter()
    time.sleep(0.05)
    return {"thread": ident, "slept": round(time.perf_counter() - t0, 3)}


class Slow(AsyncHttpConsumer):
    async def handle(self, body):
        global _ticker_started
        import asyncio
        if not _ticker_started:
            _ticker_started = True
            asyncio.get_running_loop().create_task(ticker())
        wall0 = time.perf_counter()
        stamp("slow-start")
        data = await database_sync_to_async(slow_orm)()
        data["wall"] = round(time.perf_counter() - wall0, 3)
        stamp("slow-end")
        raw = json.dumps(data).encode()
        await self.send_response(200, raw, headers=[(b"content-type", b"application/json")])


class Fast(AsyncHttpConsumer):
    async def handle(self, body):
        wall0 = time.perf_counter()
        stamp("fast-start")
        data = await database_sync_to_async(fast_orm)()
        data["wall"] = round(time.perf_counter() - wall0, 3)
        stamp("fast-end")
        raw = json.dumps(data).encode()
        await self.send_response(200, raw, headers=[(b"content-type", b"application/json")])


class Probe(AsyncWebsocketConsumer):
    async def connect(self):
        kind = self.scope["url_route"]["kwargs"]["kind"]
        self.kind = kind
        stamp(f"ws-connect-{kind}")
        if kind == "db":
            wall0 = time.perf_counter()
            data = await database_sync_to_async(fast_orm)()
            self._db_wall = round(time.perf_counter() - wall0, 3)
            self._thread = data["thread"]
        await self.accept()
        if kind == "db":
            await self.send(text_data=json.dumps({"event": "accepted", "wall": self._db_wall, "thread": self._thread}))

    async def receive(self, text_data=None, bytes_data=None):
        stamp("receive-enter")
        wall0 = time.perf_counter()
        if text_data == "db":
            data = await database_sync_to_async(fast_orm)()
            await self.send(text_data=json.dumps({
                "event": "message",
                "wall": round(time.perf_counter() - wall0, 3),
                "thread": data["thread"],
            }))
        else:
            await self.send(text_data=json.dumps({
                "event": "message",
                "wall": round(time.perf_counter() - wall0, 3),
                "thread": None,
            }))


import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from Generator.asgi_thread_context import PerConnectionThreadContext

application = PerConnectionThreadContext(ProtocolTypeRouter({
    "http": URLRouter([
        re_path(r"^slow/$", Slow.as_asgi()),
        re_path(r"^fast/$", Fast.as_asgi()),
    ]),
    "websocket": URLRouter([
        re_path(r"^ws/(?P<kind>plain|db)/$", Probe.as_asgi()),
    ]),
}))


def _client(port: int) -> None:
    import base64
    import os
    import socket
    import urllib.request

    def get(path):
        started = time.perf_counter()
        with urllib.request.urlopen(f"http://127.0.0.1:{port}{path}", timeout=20) as res:
            body = json.loads(res.read().decode())
        body["client_ms"] = round((time.perf_counter() - started) * 1000)
        return body

    def open_ws(path):
        sock = socket.create_connection(("127.0.0.1", port), timeout=15)
        key = base64.b64encode(os.urandom(16)).decode()
        request = (
            f"GET {path} HTTP/1.1\r\n"
            "Host: 127.0.0.1\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\n"
            "Sec-WebSocket-Version: 13\r\n\r\n"
        )
        sock.sendall(request.encode())
        data = b""
        while b"\r\n\r\n" not in data:
            chunk = sock.recv(1024)
            if not chunk:
                break
            data += chunk
        if b" 101 " not in data.split(b"\r\n", 1)[0]:
            raise RuntimeError(data.split(b"\r\n", 1)[0].decode(errors="replace"))
        return sock

    def send_text(sock, text):
        payload = text.encode()
        mask = os.urandom(4)
        header = bytearray([0x81, 0x80 | len(payload)])
        frame = bytes(header) + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
        sock.sendall(frame)

    def recv_text(sock):
        sock.settimeout(20)
        header = sock.recv(2)
        length = header[1] & 0x7F
        if length == 126:
            length = int.from_bytes(sock.recv(2), "big")
        elif length == 127:
            length = int.from_bytes(sock.recv(8), "big")
        data = b""
        while len(data) < length:
            data += sock.recv(length - len(data))
        return data.decode()

    plain = open_ws("/ws/plain/")
    results = {}
    barrier = threading.Barrier(4)

    def run_slow():
        barrier.wait()
        results["A"] = get("/slow/")

    def run_fast():
        barrier.wait()
        started = time.perf_counter()
        try:
            results["B"] = get("/fast/")
        except Exception as exc:
            results["B"] = {"error": type(exc).__name__, "client_ms": round((time.perf_counter() - started) * 1000)}

    def run_message():
        barrier.wait()
        time.sleep(0.4)
        started = time.perf_counter()
        send_text(plain, "hi")
        results["D"] = json.loads(recv_text(plain))
        results["D"]["client_ms"] = round((time.perf_counter() - started) * 1000)

    def run_handshake():
        barrier.wait()
        time.sleep(0.4)
        started = time.perf_counter()
        try:
            fresh = open_ws("/ws/db/")
            results["C"] = {"client_ms": round((time.perf_counter() - started) * 1000), "open": True}
            fresh.close()
        except Exception as exc:
            results["C"] = {"error": type(exc).__name__, "client_ms": round((time.perf_counter() - started) * 1000)}

    threads = [threading.Thread(target=fn) for fn in (run_slow, run_fast, run_message, run_handshake)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=25)
    plain.close()
    print("RESULT " + json.dumps(results), flush=True)


if __name__ == "__main__":
    import os
    import subprocess
    import sys

    port = 8773
    env = os.environ.copy()
    env["NO_PROXY"] = "*"
    env["no_proxy"] = "*"
    proc = subprocess.Popen(
        [sys.executable, "-m", "daphne", "-b", "127.0.0.1", "-p", str(port), "scripts.measure_daphne_orm_stall:application"],
        env=env,
    )
    try:
        deadline = time.time() + 10
        while time.time() < deadline:
            try:
                urllib_ok = __import__("urllib.request").request.urlopen(f"http://127.0.0.1:{port}/fast/", timeout=1)
                urllib_ok.read()
                break
            except Exception:
                time.sleep(0.2)
        _client(port)
    finally:
        proc.terminate()
        proc.wait(timeout=5)
