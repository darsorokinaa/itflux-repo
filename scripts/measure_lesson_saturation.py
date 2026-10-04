"""Burst student_answer on one lesson room and record the ack order.

The token is read from the environment and is not printed. Rows for this
room are deleted before exit.
"""

from __future__ import annotations

import asyncio
import json
import os
import time

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "Generator.settings")

import django

django.setup()

from django.apps import apps

ROOM = "audit-durable-ack"
N = 80


def _mint() -> str:
    import jwt
    from django.conf import settings

    secret = (getattr(settings, "LESSON_SECRET", None) or os.environ.get("LESSON_SECRET") or "").strip()
    if not secret:
        raise SystemExit("LESSON_SECRET missing")
    now = int(time.time())
    return jwt.encode(
        {
            "iss": "lesson",
            "room_id": ROOM,
            "lesson_type": "student",
            "participant_name": "Audit",
            "target_name": "Audit",
            "iat": now,
            "exp": now + 300,
        },
        secret,
        algorithm="HS256",
    )


def _mask_text(text: str) -> bytes:
    data = text.encode()
    mask = os.urandom(4)
    header = bytearray([0x81])
    length = len(data)
    if length < 126:
        header.append(0x80 | length)
    else:
        header.append(0x80 | 126)
        header.extend(length.to_bytes(2, "big"))
    masked = bytes(byte ^ mask[i % 4] for i, byte in enumerate(data))
    return bytes(header) + mask + masked


async def _read_frame(reader: asyncio.StreamReader) -> str:
    head = await asyncio.wait_for(reader.readexactly(2), timeout=8)
    length = head[1] & 0x7F
    if length == 126:
        length = int.from_bytes(await reader.readexactly(2), "big")
    elif length == 127:
        length = int.from_bytes(await reader.readexactly(8), "big")
    payload = await reader.readexactly(length)
    return payload.decode()


async def _one(token: str, index: int, results: list) -> None:
    msg_id = f"op-{index}"
    payload = {
        "type": "student_answer",
        "task_number": str(index + 1),
        "answer": "1",
        "name": "Audit",
        "client_msg_id": msg_id,
    }
    reader = writer = None
    try:
        reader, writer = await asyncio.wait_for(asyncio.open_connection("127.0.0.1", 8002), timeout=5)
        key = "AQIDBAUGBwgJCgsMDQ4PEC=="
        request = (
            f"GET /ws/lesson/{ROOM}/?token={token} HTTP/1.1\r\n"
            "Host: 127.0.0.1:8002\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\n"
            "Sec-WebSocket-Version: 13\r\n\r\n"
        )
        writer.write(request.encode())
        await writer.drain()
        header = b""
        while b"\r\n\r\n" not in header:
            chunk = await asyncio.wait_for(reader.read(256), timeout=5)
            if not chunk:
                raise ConnectionError("handshake closed")
            header += chunk
        if b" 101 " not in header.split(b"\r\n", 1)[0]:
            raise ConnectionError("handshake rejected")
        async def read_own():
            for _ in range(120):
                msg = json.loads(await _read_frame(reader))
                if msg.get("client_msg_id") == msg_id or msg.get("type") in ("temporary_unavailable", "save_failed"):
                    return msg
            raise TimeoutError("own frame missing")

        writer.write(_mask_text(json.dumps(payload)))
        await writer.drain()
        first = await read_own()
        results.append({"id": msg_id, "first": first.get("type"), "client_msg_id": first.get("client_msg_id")})
        if first.get("type") == "temporary_unavailable":
            await asyncio.sleep(int(first.get("retry_after_ms") or 200) / 1000)
            writer.write(_mask_text(json.dumps(payload)))
            await writer.drain()
            second = await read_own()
            results.append({
                "id": msg_id,
                "retry": second.get("type"),
                "client_msg_id": second.get("client_msg_id"),
            })
    except Exception as exc:
        results.append({"id": msg_id, "error": type(exc).__name__})
    finally:
        if writer is not None:
            writer.close()


async def _main() -> None:
    token = _mint()
    results: list = []
    await asyncio.gather(*[_one(token, i, results) for i in range(N)])
    kinds = {}
    for item in results:
        key = item.get("first") or item.get("retry") or item.get("error")
        kinds[key] = kinds.get(key, 0) + 1
    false_success = [
        item for item in results
        if item.get("first") == "student_answer" and item.get("client_msg_id") != item.get("id")
    ]
    print(json.dumps({
        "events": len(results),
        "kinds": kinds,
        "false_success": len(false_success),
        "sample": results[:8],
    }))
    def cleanup():
        LessonStudentsAnswer = apps.get_model("Generator", "LessonStudentsAnswer")
        Result = apps.get_model("Generator", "LessonStudentResult")
        rows = LessonStudentsAnswer.objects.filter(room_id=ROOM, student="Audit").count()
        LessonStudentsAnswer.objects.filter(room_id=ROOM, student="Audit").delete()
        Result.objects.filter(room_id=ROOM, student="Audit").delete()
        return rows
    rows = await asyncio.to_thread(cleanup)
    print(json.dumps({"rows_committed": rows}))
if __name__ == "__main__":
    asyncio.run(_main())
