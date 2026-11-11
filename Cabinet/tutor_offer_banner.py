"""Баннер «Репетитор» для пробного «Премиума» до 30 ноября 2026 включительно (МСК)."""

from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

from django.utils import timezone

from .storefront_models import TeacherUiDismissal

MSK = ZoneInfo("Europe/Moscow")
BANNER_UNTIL = datetime(2026, 11, 30, 23, 59, 59, tzinfo=MSK)
OFFER_HREF = "/pricing?promo=potok1110"
CTA_LABEL = "Выбрать „Репетитор“"
_ACTIVE_HEAD = "Пробный „Премиум“ заканчивается {дата}."
_EXPIRED_HEAD = "Пробный „Премиум“ закончился, всё созданное сохранилось."
_REST = (
    " Чтобы ученики, ДЗ и материалы остались под рукой без ограничений „Старта“, "
    "переходите на „Репетитор“: первый месяц 495 ₽ по коду potok1110, дальше 990 ₽ в месяц. "
    "Акция до 30 ноября."
)
_MONTHS = (
    "", "января", "февраля", "марта", "апреля", "мая", "июня",
    "июля", "августа", "сентября", "октября", "ноября", "декабря",
)
_PAID_SLUGS = frozenset({"teacher", "pro", "premium", "materials"})


def banner_window_open(now=None) -> bool:
    current = now or timezone.now()
    if timezone.is_naive(current):
        current = timezone.make_aware(current, MSK)
    return current.astimezone(MSK) <= BANNER_UNTIL


def _day_month(dt) -> str:
    local = timezone.localtime(dt, MSK)
    return f"{local.day} {_MONTHS[local.month]}"


def _had_premium_trial(sub) -> bool:
    from .models import TeacherSubscription

    if sub.source == TeacherSubscription.Source.LAUNCH_PROMO:
        return True
    if sub.is_legacy_promo and sub.plan.slug == "premium":
        return True
    return sub.plan.slug == "premium" and sub.status == TeacherSubscription.Status.TRIAL


def _trial_still_active(sub) -> bool:
    from .models import TeacherSubscription

    if sub.plan.slug != "premium" or not sub.is_valid():
        return False
    if sub.source == TeacherSubscription.Source.PAYMENT:
        return False
    return sub.status in (TeacherSubscription.Status.TRIAL, TeacherSubscription.Status.ACTIVE) and (
        sub.source == TeacherSubscription.Source.LAUNCH_PROMO or sub.is_legacy_promo or sub.status == TeacherSubscription.Status.TRIAL
    )


def _on_paid_tariff(sub) -> bool:
    """Действующий платный тариф. Пробный «Премиум» сюда не входит."""
    if not sub.is_valid():
        return False
    if _trial_still_active(sub):
        return False
    slug = sub.plan.slug
    if slug in ("start", "school") or getattr(sub.plan, "is_free", False):
        return False
    return slug in _PAID_SLUGS


def build_premium_trial_banner(user, *, now=None) -> dict | None:
    from .models import Profile, TeacherSubscription

    if not user or not getattr(user, "is_authenticated", False):
        return None
    if not banner_window_open(now):
        return None
    profile = getattr(user, "profile", None)
    if profile is None or getattr(profile, "role", "") != Profile.Role.TEACHER:
        return None
    sub = (
        TeacherSubscription.objects.select_related("plan")
        .filter(teacher=user)
        .first()
    )
    if sub is None or not _had_premium_trial(sub) or _on_paid_tariff(sub):
        return None
    if TeacherUiDismissal.objects.filter(
        user=user,
        notice_key=TeacherUiDismissal.PREMIUM_TRIAL_TUTOR_OFFER,
    ).exists():
        return None
    active = _trial_still_active(sub)
    end = sub.promo_ends_at or sub.expires_at or sub.current_period_end
    if active and end:
        text = _ACTIVE_HEAD.format(дата=_day_month(end)) + _REST
        variant = "active"
    else:
        text = _EXPIRED_HEAD + _REST
        variant = "expired"
    return {
        "visible": True,
        "variant": variant,
        "text": text,
        "cta_label": CTA_LABEL,
        "cta_href": OFFER_HREF,
        "notice_key": TeacherUiDismissal.PREMIUM_TRIAL_TUTOR_OFFER,
    }
