"""
Просмотры и лайки для публичного каталога (Lesson, InterestingItem).

Просмотр: не чаще 1 раза за VIEW_DEDUP_MINUTES на user_id или visitor_key.
Лайк: toggle, один лайк на пользователя и материал (UniqueConstraint).
"""

from __future__ import annotations

import hashlib
import uuid
from datetime import timedelta
from typing import Any

from django.conf import settings
from django.contrib.contenttypes.models import ContentType
from django.db import transaction
from django.db.models import Count, Exists, F, OuterRef
from django.utils import timezone

from .models import CatalogContentLike, CatalogContentViewDedup

VIEW_DEDUP_MINUTES = 30
VISITOR_COOKIE = "itflux_vid"
VISITOR_COOKIE_MAX_AGE = 60 * 60 * 24 * 365  # 1 year


class EngagementError(Exception):
    def __init__(self, code: str, message: str, status: int = 400):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status


def _content_type_for(obj) -> ContentType:
    return ContentType.objects.get_for_model(obj.__class__, for_concrete_model=True)


def hash_visitor_raw(raw: str) -> str:
    secret = (getattr(settings, "SECRET_KEY", "") or "dev").encode("utf-8")
    return hashlib.sha256(secret + b"|" + (raw or "").encode("utf-8")).hexdigest()


def resolve_visitor_key(request) -> tuple[str, str | None]:
    """
    Возвращает (visitor_key_hash, raw_cookie_to_set_or_None).
    Для авторизованных visitor_key не обязателен (дедуп по user).
    """
    raw = (request.COOKIES.get(VISITOR_COOKIE) or "").strip()
    if raw and len(raw) <= 64:
        return hash_visitor_raw(raw), None
    new_raw = uuid.uuid4().hex
    return hash_visitor_raw(new_raw), new_raw


def annotate_engagement(queryset, request):
    """likes_count + is_liked без N+1."""
    user = getattr(request, "user", None)
    qs = queryset.annotate(likes_count=Count("likes", distinct=True))
    if user is not None and getattr(user, "is_authenticated", False):
        liked = CatalogContentLike.objects.filter(
            user_id=user.pk,
            content_type=ContentType.objects.get_for_model(queryset.model, for_concrete_model=True),
            object_id=OuterRef("pk"),
        )
        qs = qs.annotate(user_has_liked=Exists(liked))
    return qs


def engagement_payload(obj, request) -> dict[str, Any]:
    likes_count = getattr(obj, "likes_count", None)
    if likes_count is None:
        likes_count = CatalogContentLike.objects.filter(
            content_type=_content_type_for(obj),
            object_id=obj.pk,
        ).count()
    user = getattr(request, "user", None)
    if hasattr(obj, "user_has_liked"):
        is_liked = bool(obj.user_has_liked)
    elif user is not None and getattr(user, "is_authenticated", False):
        is_liked = CatalogContentLike.objects.filter(
            user_id=user.pk,
            content_type=_content_type_for(obj),
            object_id=obj.pk,
        ).exists()
    else:
        is_liked = False
    return {
        "views_count": int(getattr(obj, "views_count", 0) or 0),
        "likes_count": int(likes_count or 0),
        "is_liked": bool(is_liked),
    }


def apply_catalog_ordering(queryset, ordering: str, *, default_order: tuple[str, ...]):
    ordering = (ordering or "newest").strip().lower()
    if ordering == "views":
        return queryset.order_by("-views_count", "-updated_at", "id")
    if ordering == "likes":
        return queryset.order_by("-likes_count", "-updated_at", "id")
    return queryset.order_by(*default_order)


@transaction.atomic
def register_view(obj, request) -> dict[str, Any]:
    """
    Засчитывает просмотр не чаще 1 раза за VIEW_DEDUP_MINUTES.
    Возвращает views_count, counted, visitor_cookie (raw или None).
    """
    model = obj.__class__
    ct = _content_type_for(obj)
    now = timezone.now()
    window_start = now - timedelta(minutes=VIEW_DEDUP_MINUTES)

    user = getattr(request, "user", None)
    is_auth = user is not None and getattr(user, "is_authenticated", False)

    visitor_key = ""
    visitor_cookie_raw = None
    if is_auth:
        recent = (
            CatalogContentViewDedup.objects.select_for_update()
            .filter(
                content_type=ct,
                object_id=obj.pk,
                user_id=user.pk,
                viewed_at__gte=window_start,
            )
            .exists()
        )
    else:
        visitor_key, visitor_cookie_raw = resolve_visitor_key(request)
        recent = (
            CatalogContentViewDedup.objects.select_for_update()
            .filter(
                content_type=ct,
                object_id=obj.pk,
                user__isnull=True,
                visitor_key=visitor_key,
                viewed_at__gte=window_start,
            )
            .exists()
        )

    if recent:
        obj.refresh_from_db(fields=["views_count"])
        return {
            "views_count": int(obj.views_count or 0),
            "counted": False,
            "visitor_cookie": visitor_cookie_raw,
        }

    CatalogContentViewDedup.objects.create(
        content_type=ct,
        object_id=obj.pk,
        user=user if is_auth else None,
        visitor_key="" if is_auth else visitor_key,
        viewed_at=now,
    )
    model.objects.filter(pk=obj.pk).update(views_count=F("views_count") + 1)
    obj.refresh_from_db(fields=["views_count"])
    return {
        "views_count": int(obj.views_count or 0),
        "counted": True,
        "visitor_cookie": visitor_cookie_raw,
    }


@transaction.atomic
def toggle_like(obj, user) -> dict[str, Any]:
    if user is None or not getattr(user, "is_authenticated", False):
        raise EngagementError("auth_required", "Войдите, чтобы поставить лайк", status=401)

    ct = _content_type_for(obj)
    existing = (
        CatalogContentLike.objects.select_for_update()
        .filter(user_id=user.pk, content_type=ct, object_id=obj.pk)
        .first()
    )
    if existing:
        existing.delete()
        is_liked = False
    else:
        CatalogContentLike.objects.create(user=user, content_type=ct, object_id=obj.pk)
        is_liked = True

    likes_count = CatalogContentLike.objects.filter(content_type=ct, object_id=obj.pk).count()
    return {"is_liked": is_liked, "likes_count": likes_count}


def set_visitor_cookie(response, raw: str | None):
    if not raw:
        return response
    response.set_cookie(
        VISITOR_COOKIE,
        raw,
        max_age=VISITOR_COOKIE_MAX_AGE,
        httponly=True,
        samesite="Lax",
        secure=not getattr(settings, "DEBUG", False),
    )
    return response
