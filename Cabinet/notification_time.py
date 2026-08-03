"""Часовой пояс пользователя для DND, сводок и напоминаний."""

from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.conf import settings
from django.contrib.auth.models import User
from django.utils import timezone


DEFAULT_USER_TIMEZONE = "Europe/Moscow"


def user_timezone_name(user: User | None) -> str:
    if user is None:
        return getattr(settings, "TIME_ZONE", None) or DEFAULT_USER_TIMEZONE
    profile = getattr(user, "profile", None)
    name = (getattr(profile, "timezone", None) or "").strip()
    if name:
        return name
    return getattr(settings, "TIME_ZONE", None) or DEFAULT_USER_TIMEZONE


def user_zoneinfo(user: User | None) -> ZoneInfo:
    name = user_timezone_name(user)
    try:
        return ZoneInfo(name)
    except ZoneInfoNotFoundError:
        try:
            return ZoneInfo(DEFAULT_USER_TIMEZONE)
        except ZoneInfoNotFoundError:
            return ZoneInfo("UTC")


def user_local_now(user: User | None = None) -> datetime:
    return timezone.now().astimezone(user_zoneinfo(user))


def user_local_time(user: User | None = None):
    return user_local_now(user).time()


def is_in_quiet_hours(
    *,
    enabled: bool,
    start,
    end,
    now_local: datetime | None = None,
    user: User | None = None,
) -> bool:
    """True если сейчас действует период тишины (поддерживает окно через полночь)."""
    if not enabled or not start or not end:
        return False
    if start == end:
        # Одинаковое начало и конец = круглосуточная тишина
        return True
    current = (now_local or user_local_now(user)).time()
    if start <= end:
        return start <= current < end
    return current >= start or current < end
