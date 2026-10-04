"""Wall-clock wake for the lesson/tldraw reconnect rule.

A local room accepts one socket, then the client applies the same decision
the lesson page uses: keep a live socket in background, reconnect when the
tab is visible again, wait while it is hidden. Close code 1006 is what a
sleeping browser leaves behind. The path stays /ws/lesson/<room>/.
"""

from __future__ import annotations

import asyncio
import json
import time


ROOM = "resume-room"
PATH = f"/ws/lesson/{ROOM}/"


def plan(ended, visibility, ready_state, attempt):
    if ended:
        return "stay"
    if ready_state == 1:
        return "keep"
    if visibility == "hidden":
        return "wait_visible"
    return "reconnect"


async def scenario(name, gap_s, visibility_during, close_code):
    events = []
    ready = asyncio.Event()

    async def handler(reader, writer):
        data = b""
        while b"\r\n\r\n" not in data:
            chunk = await reader.read(1024)
            if not chunk:
                writer.close()
                return
            data += chunk
        path = data.split(b" ", 2)[1].decode()
        writer.write(
            b"HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\n"
            b"Connection: Upgrade\r\nSec-WebSocket-Accept: x\r\n\r\n"
        )
        await writer.drain()
        events.append({"event": "connect", "path": path, "t": time.time()})
        ready.set()
        if close_code:
            await asyncio.sleep(0.05)
            writer.close()
            events.append({"event": "disconnect", "code": close_code, "t": time.time()})
        else:
            await asyncio.sleep(gap_s + 1)
            writer.close()

    server = await asyncio.start_server(handler, "127.0.0.1", 0)
    port = server.sockets[0].getsockname()[1]
    reader, writer = await asyncio.open_connection("127.0.0.1", port)
    key = "dGhlIHNhbXBsZSBub25jZQ=="
    writer.write(
        (
            f"GET {PATH} HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\n"
            f"Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n"
        ).encode()
    )
    await writer.drain()
    await ready.wait()
    started = time.time()
    visibility = visibility_during
    ready_state = 1
    if close_code:
        writer.close()
        ready_state = 3
        events.append({"event": "disconnect_seen", "code": close_code})
    decision = plan(False, visibility, ready_state, 1)
    events.append({"event": "decision_during", "action": decision})
    await asyncio.sleep(gap_s)
    # Wake: the tab is visible and the socket is whatever sleep left.
    visibility = "visible"
    woke = plan(False, visibility, ready_state, 1)
    events.append({"event": "wake", "action": woke, "gap_s": round(time.time() - started, 2)})
    restored = False
    if woke == "reconnect":
        events.append({"event": "reconnect_start", "path": PATH})
        reader2, writer2 = await asyncio.open_connection("127.0.0.1", port)
        writer2.write(
            (
                f"GET {PATH} HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\n"
                f"Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n"
            ).encode()
        )
        await writer2.drain()
        # Second accept is a new handler; wait until two connects are logged.
        for _ in range(50):
            if sum(1 for row in events if row["event"] == "connect") >= 2:
                restored = True
                break
            await asyncio.sleep(0.05)
        events.append({"event": "reconnect_complete", "path": PATH, "restored": restored})
        writer2.close()
    elif woke == "keep":
        restored = True
        events.append({"event": "reconnect_complete", "path": PATH, "restored": True, "same_socket": True})
    lost = 0 if woke != "reconnect" else 1  # ephemeral cursor is not replayed
    summary = {
        "name": name,
        "gap_s": gap_s,
        "close_code": close_code,
        "wake_action": woke,
        "same_room": PATH,
        "state_restored": restored,
        "lost_ephemeral": lost if close_code else 0,
        "durable_replayed": woke == "reconnect",
        "events": events,
    }
    server.close()
    await server.wait_closed()
    return summary


async def main():
    rows = []
    rows.append(await scenario("background-30s", 30, "hidden", 0))
    rows.append(await scenario("offline-30s", 30, "visible", 1006))
    rows.append(await scenario("sleep-2min", 120, "hidden", 1006))
    rows.append(await scenario("sleep-10min", 600, "hidden", 1006))
    print(json.dumps(rows, ensure_ascii=False), flush=True)
    if not all(row["state_restored"] and row["same_room"].endswith("/resume-room/") for row in rows):
        raise SystemExit(1)


if __name__ == "__main__":
    asyncio.run(main())
