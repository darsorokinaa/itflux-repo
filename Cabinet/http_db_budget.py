"""Cap concurrent HTTP work so it cannot take the whole Postgres budget.

Realtime keeps its own 16 workers. This gate is the HTTP share: 36 requests
at a time. Request 37 waits one second, then receives 503. It does not open
another database connection.
"""

from __future__ import annotations

import asyncio

HTTP_DB_LIMIT = 36
HTTP_DB_WAIT_SEC = 1.0

_slots: asyncio.Semaphore | None = None


def http_db_semaphore() -> asyncio.Semaphore:
    global _slots
    if _slots is None:
        _slots = asyncio.Semaphore(HTTP_DB_LIMIT)
    return _slots


class HttpDbBudget:
    def __init__(self, app, limit: int = HTTP_DB_LIMIT, wait_timeout: float = HTTP_DB_WAIT_SEC):
        self.app = app
        self.limit = limit
        self.wait_timeout = wait_timeout
        self._slots = asyncio.Semaphore(limit)

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return
        try:
            await asyncio.wait_for(self._slots.acquire(), timeout=self.wait_timeout)
        except TimeoutError:
            await send(
                {
                    "type": "http.response.start",
                    "status": 503,
                    "headers": [(b"content-type", b"text/plain; charset=utf-8")],
                }
            )
            await send({"type": "http.response.body", "body": b"server busy"})
            return
        try:
            await self.app(scope, receive, send)
        finally:
            self._slots.release()
