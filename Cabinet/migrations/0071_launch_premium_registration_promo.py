"""
Стартовая акция: тариф «Премиум» на 3 месяца с даты регистрации.

Создаёт запись Promotion (код launch-premium) — её можно править в админке
(Cabinet → Акции): выключить «Активна» или сдвинуть «Можно получить до».

Затем выдаёт Премиум всем учителям, которые попадают под акцию.
"""

from __future__ import annotations

from calendar import monthrange
from datetime import datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

from django.db import migrations
from django.utils import timezone


LAUNCH_CODE = "launch-premium"
PROMO_PLAN_SLUG = "premium"
PROMO_MONTHS = 3
PROMO_TZ = ZoneInfo("Europe/Moscow")
PROMO_START = datetime(2026, 1, 1, 0, 0, 0)
PROMO_END = datetime(2027, 1, 1, 0, 0, 0)


def _aware(dt):
    if timezone.is_naive(dt):
        return timezone.make_aware(dt, PROMO_TZ)
    return dt


def _add_months(dt, months: int):
    dt = _aware(dt)
    year = dt.year + (dt.month - 1 + months) // 12
    month = (dt.month - 1 + months) % 12 + 1
    day = min(dt.day, monthrange(year, month)[1])
    return dt.replace(year=year, month=month, day=day)


def _grant_premium(apps, plan, ends):
    TeacherSubscription = apps.get_model("Cabinet", "TeacherSubscription")
    Profile = apps.get_model("Cabinet", "Profile")
    User = apps.get_model("auth", "User")

    now = timezone.now()
    teacher_ids = Profile.objects.filter(role="teacher").values_list("user_id", flat=True)
    skip_slugs = {"school"}

    for user in User.objects.filter(id__in=teacher_ids).iterator():
        profile = Profile.objects.filter(user_id=user.id).first()
        started = None
        if profile and getattr(profile, "reg_date", None):
            started = profile.reg_date
        elif user.date_joined:
            started = user.date_joined
        else:
            started = now
        started = _aware(started)
        if started >= ends:
            continue

        promo_expires = _add_months(started, PROMO_MONTHS)
        sub = (
            TeacherSubscription.objects.filter(teacher_id=user.id)
            .select_related("plan")
            .first()
        )
        if sub is None:
            if promo_expires <= now:
                continue
            TeacherSubscription.objects.create(
                teacher_id=user.id,
                plan_id=plan.id,
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
        if plan_slug in skip_slugs:
            continue

        valid = sub.status in ("active", "trial") and (
            sub.expires_at is None or sub.expires_at > now
        )
        if plan_slug == PROMO_PLAN_SLUG and valid:
            if sub.expires_at is None or sub.expires_at >= promo_expires:
                continue

        keep_unlimited = (
            valid
            and sub.expires_at is None
            and plan_slug != PROMO_PLAN_SLUG
            and float(getattr(sub.plan, "price_month", 0) or 0) > 0
        )
        if keep_unlimited:
            sub.plan_id = plan.id
            sub.source = "launch_promo"
            sub.is_legacy_promo = True
            sub.save()
            continue

        if promo_expires <= now and plan_slug == PROMO_PLAN_SLUG:
            continue

        expires_at = promo_expires
        if sub.expires_at and sub.expires_at > expires_at:
            expires_at = sub.expires_at
        if expires_at <= now and plan_slug not in (
            "start", "teacher", "repetitor", "profi", "pro", None,
        ):
            continue

        sub.plan_id = plan.id
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


def forwards(apps, schema_editor):
    TariffPlan = apps.get_model("Cabinet", "TariffPlan")
    Promotion = apps.get_model("Cabinet", "Promotion")

    plan = TariffPlan.objects.filter(slug=PROMO_PLAN_SLUG).first()
    if plan is None:
        plan = TariffPlan.objects.create(
            slug=PROMO_PLAN_SLUG,
            name="Премиум",
            price_month=Decimal("3990"),
            price_year=Decimal("39900"),
            sort_order=3,
            is_active=True,
            is_public=True,
            is_free=False,
            content_access_rank=3,
            cta_type="checkout",
        )
    else:
        updates = []
        if not plan.is_active:
            plan.is_active = True
            updates.append("is_active")
        if int(getattr(plan, "content_access_rank", 0) or 0) < 3:
            plan.content_access_rank = 3
            updates.append("content_access_rank")
        if updates:
            plan.save(update_fields=updates)

    starts = _aware(PROMO_START)
    ends = _aware(PROMO_END)
    if not Promotion.objects.filter(code=LAUNCH_CODE).exists():
        Promotion.objects.create(
            code=LAUNCH_CODE,
            name="Стартовая акция: Премиум",
            title="Акция до 1 января",
            short_description=(
                "Всем зарегистрировавшимся на платформе — тариф «Премиум» "
                "на 3 месяца с даты регистрации."
            ),
            description=(
                "Стартовая акция: при регистрации учитель получает тариф «Премиум» "
                "на 3 месяца с даты регистрации. Чтобы завершить акцию, снимите "
                "флаг «Активна» или измените дату «Можно получить до». "
                "Код launch-premium не меняйте — по нему выдаётся тариф."
            ),
            how_to_get=(
                "Выдаётся автоматически при регистрации учителя. "
                "Не меняйте код launch-premium. Чтобы завершить — выключите "
                "«Активна» или поставьте дату окончания."
            ),
            terms="Срок считается с даты регистрации, не с момента входа.",
            button_text="Выбрать тариф",
            plan_id=plan.pk,
            benefit_type="free_period",
            promo_price=None,
            free_months=PROMO_MONTHS,
            starts_at=starts,
            ends_at=ends,
            display_starts_at=starts,
            display_ends_at=ends,
            is_active=True,
            eligibility_type="all",
            claim_mode="automatic",
            allow_promo_codes=False,
            max_redemptions=None,
            max_redemptions_per_user=None,
            priority=100,
        )

    _grant_premium(apps, plan, ends)


def backwards(apps, schema_editor):
    Promotion = apps.get_model("Cabinet", "Promotion")
    Promotion.objects.filter(code=LAUNCH_CODE).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("Cabinet", "0070_student_material_folders"),
    ]

    operations = [
        migrations.RunPython(forwards, backwards),
    ]
