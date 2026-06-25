"""Simple cache-based rate limiting for auth and public endpoints."""

from django.core.cache import cache
from django.http import JsonResponse
from rest_framework.response import Response
from rest_framework import status


def client_ip(request) -> str:
    forwarded = (request.META.get("HTTP_X_FORWARDED_FOR") or "").strip()
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR") or "unknown"


def rate_limit_check(request, scope: str, limit: int, window_sec: int) -> bool:
    """Return True if request is allowed, False if rate limited."""
    ip = client_ip(request)
    cache_key = f"rl:{scope}:{ip}"
    try:
        count = cache.incr(cache_key)
    except ValueError:
        cache.set(cache_key, 1, timeout=window_sec)
        return True
    if count == 1:
        cache.touch(cache_key, timeout=window_sec)
    return count <= limit


def rate_limit_json_response(scope: str = "auth"):
    return JsonResponse(
        {"ok": False, "error": "Слишком много попыток. Попробуйте позже.", "code": "RATE_LIMITED"},
        status=429,
    )


def rate_limit_drf_response():
    return Response(
        {"detail": "Слишком много запросов. Попробуйте позже.", "code": "RATE_LIMITED"},
        status=status.HTTP_429_TOO_MANY_REQUESTS,
    )
