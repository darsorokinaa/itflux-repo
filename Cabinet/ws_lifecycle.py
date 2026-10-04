"""Lifecycle lines for application WebSockets.

The line contains ids and timestamps only. Tokens, cookies and query strings
are never accepted as fields.
"""

from __future__ import annotations

import json
import logging
import re
import time
import uuid
import weakref

from Cabinet.loop_log import protect_logger

logger = logging.getLogger("itflux.ws")
logger.setLevel(logging.INFO)
if not logger.handlers:
    _handler = logging.StreamHandler()
    _handler.setFormatter(logging.Formatter("%(levelname)s %(name)s %(message)s"))
    logger.addHandler(_handler)
    logger.propagate = False
protect_logger("itflux.ws")

_LIVE: weakref.WeakSet = weakref.WeakSet()
_REQUEST_ID = re.compile(r"^[A-Za-z0-9_-]{8,64}$")
_FIELDS = (
    "event",
    "request_id",
    "user_id",
    "lesson_id",
    "board_id",
    "connected_at",
    "authenticated_at",
    "first_activity_ts",
    "last_activity_ts",
    "disconnected_at",
    "duration_s",
    "close_code",
    "exception_class",
    "ts",
)


def request_id_from_scope(scope) -> str:
    for key, value in scope.get("headers") or []:
        if not isinstance(key, (bytes, bytearray)):
            continue
        if key.lower() != b"x-request-id":
            continue
        raw = value.decode("latin1", errors="ignore").strip() if isinstance(value, (bytes, bytearray)) else ""
        if _REQUEST_ID.fullmatch(raw):
            return raw
        break
    return uuid.uuid4().hex[:16]


def live_socket_count() -> int:
    return len(_LIVE)


def mark_ws_connected(consumer) -> None:
    now = time.time()
    consumer._ws_connected_at = now
    consumer._ws_last_activity = now
    _LIVE.add(consumer)


def mark_ws_activity(consumer) -> None:
    now = time.time()
    first = not getattr(consumer, "_ws_first_activity_at", None)
    consumer._ws_last_activity = now
    if first:
        consumer._ws_first_activity_at = now
        request_id = getattr(consumer, "_ws_request_id", "")
        if request_id:
            log_ws_lifecycle(
                consumer,
                event="activity",
                request_id=request_id,
                user_id=getattr(getattr(consumer, "user", None), "pk", None),
                lesson_id=getattr(consumer, "room_id", "") or getattr(consumer, "meeting_uuid", ""),
                board_id=getattr(consumer, "board_id", ""),
                first_activity_ts=f"{now:.3f}",
            )


def ws_connection_timing(consumer) -> dict:
    now = time.time()
    started = getattr(consumer, "_ws_connected_at", None)
    last = getattr(consumer, "_ws_last_activity", None)
    return {
        "duration_s": f"{now - started:.3f}" if started else "",
        "last_activity_ts": f"{last:.3f}" if last else "",
    }


def format_ws_lifecycle(**fields) -> str:
    parts = []
    for key in _FIELDS:
        if key not in fields or fields[key] is None or fields[key] == "":
            continue
        value = fields[key]
        text = str(value)
        if any(marker in text.lower() for marker in ("bearer ", "token=", "access_token", "eyj")):
            continue
        parts.append(f"{key}={text}")
    return " ".join(parts)


def _fmt_ts(value) -> str:
    if value is None or value == "":
        return ""
    return f"{float(value):.3f}"


def note_ws_inbound(consumer, data) -> None:
    """Remember which frame is in flight so a busy response can name it."""
    if not isinstance(data, dict):
        return
    consumer._ws_last_inbound = {
        "failed_type": str(data.get("type") or "")[:80],
        "client_msg_id": str(data.get("client_msg_id") or "")[:80],
        "operation_id": str(data.get("operation_id") or data.get("operationId") or "")[:80],
        "action": str(data.get("action") or "")[:80],
    }


def temporary_unavailable_body(consumer, retry_after_ms: int = 200) -> dict:
    body = {"type": "temporary_unavailable", "retry_after_ms": int(retry_after_ms)}
    inbound = getattr(consumer, "_ws_last_inbound", None) or {}
    for key in ("failed_type", "client_msg_id", "operation_id", "action"):
        value = str(inbound.get(key) or "")
        if value:
            body[key] = value
    return body


def reraise_if_saturated(exc: BaseException) -> None:
    from Cabinet.realtime_db import RealtimeDbSaturated

    if isinstance(exc, RealtimeDbSaturated):
        raise exc


def log_ws_lifecycle(consumer=None, **fields) -> None:
    if consumer is not None:
        event = str(fields.get("event") or "")
        now = time.time()
        if event == "authenticated":
            consumer._ws_authenticated_at = now
        if event == "disconnect":
            consumer._ws_disconnected_at = now
        fields.setdefault("connected_at", _fmt_ts(getattr(consumer, "_ws_connected_at", None)))
        fields.setdefault("authenticated_at", _fmt_ts(getattr(consumer, "_ws_authenticated_at", None)))
        fields.setdefault("first_activity_ts", _fmt_ts(getattr(consumer, "_ws_first_activity_at", None)))
        fields.setdefault("last_activity_ts", _fmt_ts(getattr(consumer, "_ws_last_activity", None)))
        if event == "disconnect":
            fields.setdefault("disconnected_at", _fmt_ts(getattr(consumer, "_ws_disconnected_at", None)))
            fields.setdefault("exception_class", getattr(consumer, "_ws_exception_class", "") or "")
            fields.update({key: value for key, value in ws_connection_timing(consumer).items() if value})
    fields.setdefault("ts", f"{time.time():.3f}")
    line = format_ws_lifecycle(**fields)
    if line:
        logger.info("%s", line)


class WsLifecycleMixin:
    """Record the exception class without the message. Messages can carry tokens."""

    async def dispatch(self, message):
        try:
            await super().dispatch(message)
        except Exception as exc:
            from Cabinet.realtime_db import RealtimeDbSaturated

            if isinstance(exc, RealtimeDbSaturated):
                if exc.critical:
                    try:
                        await self.close(code=1013)
                    except Exception:
                        logger.debug("realtime db close failed", exc_info=True)
                else:
                    # A full queue must not look like a dead socket. The client
                    # gets an explicit temporary error and can retry the frame
                    # that was in flight. Ephemeral frames carry no id.
                    try:
                        await self.send(text_data=json.dumps(
                            temporary_unavailable_body(self),
                            ensure_ascii=False,
                        ))
                    except Exception:
                        logger.debug("realtime db busy frame failed", exc_info=True)
                return
            # Channels ends every consumer by raising StopConsumer. That is
            # the normal close path, not an application failure.
            if type(exc).__name__ == "StopConsumer":
                raise
            self._ws_exception_class = type(exc).__name__
            request_id = getattr(self, "_ws_request_id", "")
            if request_id:
                log_ws_lifecycle(
                    self,
                    event="exception",
                    request_id=request_id,
                    user_id=getattr(getattr(self, "user", None), "pk", None),
                    lesson_id=getattr(self, "room_id", "") or getattr(self, "meeting_uuid", ""),
                    board_id=getattr(self, "board_id", ""),
                    exception_class=type(exc).__name__,
                )
            raise
