"""HTTP middleware for SPA/API cache safety and optional client version gate."""

from __future__ import annotations

import os
from typing import Callable

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
