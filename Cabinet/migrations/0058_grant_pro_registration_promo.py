"""
Выдаёт всем учителям актуальный тариф «Профи» (slug=pro) на 3 месяца
с даты регистрации и мигрирует legacy slug=profi → pro.
"""

from __future__ import annotations

from calendar import monthrange
from datetime import datetime
from zoneinfo import ZoneInfo

from django.db import migrations
from django.utils import timezone


PROMO_MONTHS = 3
PROMO_UNTIL = datetime(2026, 10, 1, 0, 0, 0)
PROMO_TZ = ZoneInfo("Europe/Moscow")


def _add_months(dt, months: int):
    if timezone.is_naive(dt):
        dt = timezone.make_aware(dt, PROMO_TZ)
    year = dt.year + (dt.month - 1 + months) // 12
    month = (dt.month - 1 + months) % 12 + 1
    day = min(dt.day, monthrange(year, month)[1])
    return dt.replace(year=year, month=month, day=day)


def forwards(apps, schema_editor):
    TariffPlan = apps.get_model("Cabinet", "TariffPlan")
    TeacherSubscription = apps.get_model("Cabinet", "TeacherSubscription")
    Profile = apps.get_model("Cabinet", "Profile")
    User = apps.get_model("auth", "User")

    pro = TariffPlan.objects.filter(slug="pro").first()
    if not pro:
        pro = TariffPlan.objects.create(
            slug="pro",
            name="Профи",
            price_month=2990,
            sort_order=2,
            is_active=True,
            content_access_rank=2,
        )
    else:
        updates = []
        if int(getattr(pro, "content_access_rank", 0) or 0) < 2:
            pro.content_access_rank = 2
            updates.append("content_access_rank")
        if not pro.is_active:
            pro.is_active = True
            updates.append("is_active")
        if updates:
            pro.save(update_fields=updates)

    profi = TariffPlan.objects.filter(slug="profi").exclude(pk=pro.pk).first()
    if profi:
        TeacherSubscription.objects.filter(plan=profi).update(plan=pro)
        profi.is_active = False
        profi.save(update_fields=["is_active"])

    deadline = timezone.make_aware(PROMO_UNTIL, PROMO_TZ)
    now = timezone.now()
    teacher_ids = Profile.objects.filter(role="teacher").values_list("user_id", flat=True)

    for user in User.objects.filter(id__in=teacher_ids).iterator():
        profile = Profile.objects.filter(user_id=user.id).first()
        started = None
        if profile and getattr(profile, "reg_date", None):
            started = profile.reg_date
        elif user.date_joined:
            started = user.date_joined
        else:
            started = now
        if timezone.is_naive(started):
            started = timezone.make_aware(started, PROMO_TZ)
        if started >= deadline:
            continue

        promo_expires = _add_months(started, PROMO_MONTHS)
        sub = TeacherSubscription.objects.filter(teacher_id=user.id).select_related("plan").first()

        if sub is None:
            if promo_expires <= now:
                continue
            TeacherSubscription.objects.create(
                teacher_id=user.id,
                plan_id=pro.id,
                status="trial",
                source="launch_promo",
                is_legacy_promo=True,
                started_at=started,
                expires_at=promo_expires,
                promo_started_at=started,
                promo_ends_at=promo_expires,
                current_period_start=started,
                current_period_end=promo_expires,
                auto_renew=False,
            )
            continue

        plan_slug = getattr(sub.plan, "slug", None) if sub.plan_id else None
        # Не трогаем premium/school
        if plan_slug in ("premium", "school"):
            continue
        # Уже актуальный pro с достаточным сроком
        if (
            plan_slug == "pro"
            and sub.expires_at
            and sub.expires_at >= promo_expires
            and sub.status in ("active", "trial")
        ):
            continue
        if plan_slug == "pro" and sub.expires_at is None and sub.status in ("active", "trial"):
            continue

        expires_at = promo_expires
        if sub.expires_at and sub.expires_at > expires_at:
            expires_at = sub.expires_at
        if expires_at <= now and plan_slug == "pro":
            continue

        sub.plan_id = pro.id
        sub.status = "trial"
        sub.source = "launch_promo"
        sub.is_legacy_promo = True
        sub.started_at = started
        sub.expires_at = expires_at
        sub.promo_started_at = started
        sub.promo_ends_at = expires_at
        sub.current_period_start = started
        sub.current_period_end = expires_at
        sub.auto_renew = False
        sub.save()


def backwards(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("Cabinet", "0057_lesson_reminder_defaults_empty_disabled"),
    ]

    operations = [
        migrations.RunPython(forwards, backwards),
    ]
