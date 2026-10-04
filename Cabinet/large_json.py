"""Log json.loads of large documents without the document itself.

The previous Daphne process traced +429 MB and about 11 million allocations
to json/decoder.py:353 (scan_once). The caller was not on a stuck stack.
This records the call site, byte size, path and request id the next time a
payload of at least 1 MB is parsed.
"""

from __future__ import annotations

import contextvars
import json
import logging
import traceback

logger = logging.getLogger("itflux.json")

_meta: contextvars.ContextVar[dict | None] = contextvars.ContextVar("itflux_json_meta", default=None)
_installed = False
_THRESHOLD = 1_000_000


def set_json_request_meta(*, path: str, request_id: str) -> contextvars.Token:
    return _meta.set({
        "path": (path or "")[:160],
        "request_id": (request_id or "")[:64],
    })


def reset_json_request_meta(token: contextvars.Token) -> None:
    _meta.reset(token)


def install_large_json_log() -> None:
    global _installed
    if _installed:
        return
    original = json.loads

    def loads(s, *args, **kwargs):
        size = len(s) if isinstance(s, (str, bytes, bytearray)) else -1
        if size >= _THRESHOLD:
            frame = traceback.extract_stack(limit=3)[-2]
            meta = _meta.get() or {}
            logger.warning(
                "large_json bytes=%s site=%s:%s path=%s request_id=%s",
                size,
                frame.filename,
                frame.lineno,
                meta.get("path") or "",
                meta.get("request_id") or "",
            )
        return original(s, *args, **kwargs)

    json.loads = loads
    _installed = True
