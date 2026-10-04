"""Daphne --access-log - against a stderr pipe that is already full.

The child fills fd 2 with os.write after the first socket so the
TextIOWrapper lock is not held. Later handshakes still emit an access
line on the Twisted reactor. A timeout means that line blocked the reactor.
"""

from __future__ import annotations

import array
import base64
import fcntl
import json
import os
import socket
import subprocess
import sys
import termios
import threading
import time

PORT = 8796
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _handshake(port: int, timeout: float) -> float:
    started = time.perf_counter()
    sock = socket.create_connection(("127.0.0.1", port), timeout=timeout)
    key = base64.b64encode(os.urandom(16)).decode()
    sock.sendall(
        (
            "GET /ws/probe/ HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\n"
            "Connection: Upgrade\r\nSec-WebSocket-Key: %s\r\nSec-WebSocket-Version: 13\r\n\r\n"
            % key
        ).encode()
    )
    data = b""
    sock.settimeout(timeout)
    while b"\r\n\r\n" not in data:
        chunk = sock.recv(4096)
        if not chunk:
            break
        data += chunk
    sock.close()
    if b" 101 " not in data.split(b"\r\n", 1)[0]:
        raise RuntimeError("no 101")
    return (time.perf_counter() - started) * 1000


def _burst(port: int, n: int, timeout: float) -> dict:
    rows = []
    lock = threading.Lock()
    barrier = threading.Barrier(n)

    def one():
        row = {"ms": None, "error": ""}
        try:
            barrier.wait(10)
            row["ms"] = _handshake(port, timeout)
        except Exception as exc:
            row["error"] = type(exc).__name__
        with lock:
            rows.append(row)

    threads = [threading.Thread(target=one) for _ in range(n)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    ok = sorted(row["ms"] for row in rows if row["ms"] is not None)

    def pct(p):
        if not ok:
            return None
        return round(ok[min(len(ok) - 1, int(round((len(ok) - 1) * p)))], 1)

    return {
        "n": n,
        "ok": len(ok),
        "timeout": sum(1 for row in rows if row["error"] == "TimeoutError"),
        "other": sorted({row["error"] for row in rows if row["error"]})[:4],
        "p50": pct(0.50),
        "p95": pct(0.95),
        "p99": pct(0.99),
    }


def main() -> None:
    env = os.environ.copy()
    env.update({
        "NO_PROXY": "*",
        "PYTHONPATH": "/tmp:" + ROOT,
        "ITFLUX_ROOT": ROOT,
        "INGRESS_MODE": "pool",
        "INGRESS_FILL_STDERR": "1",
        "PYTHONUNBUFFERED": "1",
    })
    child = subprocess.Popen(
        [
            sys.executable, "-m", "daphne",
            "-b", "127.0.0.1", "-p", str(PORT),
            "--access-log", "-",
            "itflux_ingress:application",
        ],
        cwd="/tmp",
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    try:
        deadline = time.time() + 20
        while time.time() < deadline:
            try:
                _handshake(PORT, 5)
                break
            except Exception:
                time.sleep(0.1)
        else:
            raise SystemExit("daphne did not accept a handshake")
        time.sleep(0.5)
        pending_buf = array.array("i", [0])
        pending = -1
        for command in (getattr(termios, "FIONREAD", 0), 0x541B, 0x4004667F):
            if not command:
                continue
            try:
                fcntl.ioctl(child.stdout.fileno(), int(command), pending_buf, True)
                pending = int(pending_buf[0])
                break
            except OSError:
                continue
        result = {
            "access_log": True,
            "sink": "stdout+stderr merged, unread",
            "pending_bytes": pending,
            "unbuffered": True,
            "burst": _burst(PORT, 40, 3),
        }
        print(json.dumps(result), flush=True)
        if result["pending_bytes"] < 1024:
            raise SystemExit(1)
    finally:
        child.terminate()
        try:
            child.wait(timeout=5)
        except subprocess.TimeoutExpired:
            child.kill()


if __name__ == "__main__":
    main()
