"""HTTP middleware for SPA/API cache safety and optional client version gate."""

from __future__ import annotations

import logging
import os
import sys
import time
import uuid
from typing import Callable

from django.conf import settings
from django.db import connection
from django.http import HttpRequest, HttpResponse, JsonResponse


def client_version_is_outdated(client_version: str, minimum_version: str) -> bool:
    if not client_version or not minimum_version:
        return False
    if client_version == minimum_version:
        return False
    # Timestamp-hash builds: lexical compare works for YYYYMMDDHHMMSS-hash
    return client_version < minimum_version


class NoStoreApiMiddleware:
    """Prevent browser/proxy caching of dynamic authenticated API JSON."""

    def __init__(self, get_response: Callable[[HttpRequest], HttpResponse]):
        self.get_response = get_response

    def __call__(self, request: HttpRequest) -> HttpResponse:
        response = self.get_response(request)
        path = request.path or ""
        if path.startswith("/api/"):
            # Avatar and similar may set their own private max-age — keep those.
            if "Cache-Control" not in response:
                response["Cache-Control"] = "no-store, private"
            elif "no-store" not in response["Cache-Control"] and "private" not in response["Cache-Control"]:
                response["Cache-Control"] = "no-store, private"
        return response


class MinimumClientVersionMiddleware:
    """
    Optional hard gate: set ITFLUX_MINIMUM_CLIENT_VERSION=20260803120000-abc1234
    Clients send X-Client-Version; outdated GETs under /api/cabinet/ get 426-like JSON.
    """

    def __init__(self, get_response: Callable[[HttpRequest], HttpResponse]):
        self.get_response = get_response
        self.minimum = os.environ.get("ITFLUX_MINIMUM_CLIENT_VERSION", "").strip()

    def __call__(self, request: HttpRequest) -> HttpResponse:
        if self.minimum and (request.path or "").startswith("/api/"):
            client = (request.headers.get("X-Client-Version") or "").strip()
            # Only enforce when client reports a version (old builds won't send header).
            if client and client_version_is_outdated(client, self.minimum):
                return JsonResponse(
                    {
                        "code": "client_update_required",
                        "minimum_version": self.minimum,
                        "message": "Доступна новая версия платформы. Обновите страницу.",
                    },
                    status=409,
                )
        return self.get_response(request)


def _perf_logging_enabled() -> bool:
    raw = (os.environ.get("ITFLUX_PERF_LOG") or "").strip().lower()
    if raw in ("1", "true", "yes", "on"):
        return True
    if raw in ("0", "false", "no", "off"):
        return False
    running_tests = any(arg in sys.argv for arg in ("test", "pytest"))
    return bool(getattr(settings, "DEBUG", False)) and not running_tests


class PerformanceTimingMiddleware:
    """DEV/STAGING timings: request id, DB ms, query count. No personal data."""

    def __init__(self, get_response: Callable[[HttpRequest], HttpResponse]):
        self.get_response = get_response
        self.logger = logging.getLogger("cabinet.perf")

    def __call__(self, request: HttpRequest) -> HttpResponse:
        path = request.path or ""
        if not _perf_logging_enabled() or not path.startswith("/api/"):
            return self.get_response(request)

        request_id = (request.headers.get("X-Request-ID") or "").strip() or uuid.uuid4().hex[:16]
        request.perf_request_id = request_id
        q0 = len(connection.queries)
        previous_force = connection.force_debug_cursor
        if not getattr(settings, "DEBUG", False):
            connection.force_debug_cursor = True
        started = time.perf_counter()
        try:
            response = self.get_response(request)
        finally:
            connection.force_debug_cursor = previous_force
        total_ms = (time.perf_counter() - started) * 1000
        captured = connection.queries[q0:]
        db_ms = sum(float(row.get("time") or 0) * 1000 for row in captured)
        query_count = len(captured)
        user = getattr(request, "user", None)
        user_id = getattr(user, "pk", None) if user is not None and getattr(user, "is_authenticated", False) else None
        self.logger.info(
            "request_id=%s method=%s path=%s user_id=%s total_ms=%.1f db_ms=%.1f db_query_count=%s",
            request_id,
            request.method,
            path,
            user_id,
            total_ms,
            db_ms,
            query_count,
        )
        response["X-Request-ID"] = request_id
        response["Server-Timing"] = f"total;dur={total_ms:.1f}, db;dur={db_ms:.1f}"
        return response
