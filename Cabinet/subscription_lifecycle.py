"""
Периодическая обработка подписок платформы:

* напоминания за 7 / 3 / 1 день;
* автопродление (Charge по RebillId);
* истечение → тариф «Старт» (данные пользователя не удаляются).

Запускается management-командой process_subscriptions (cron).
"""

from __future__ import annotations

import logging
from datetime import timedelta

from django.db import transaction
from django.utils import timezone

logger = logging.getLogger(__name__)

# Окно автопродления: за N часов до конца и небольшой запас после.
RENEW_AHEAD = timedelta(hours=6)
RENEW_GRACE = timedelta(hours=24)
# Не чаще одной попытки Charge на период (idempotency_key + last_renewal_attempt).
MIN_RENEW_ATTEMPT_GAP = timedelta(hours=12)


def _local_day_bounds(days_ahead: int):
    """
    Границы «локального» календарного дня через N дней (timezone-aware).
    Используем TIME_ZONE проекта (обычно Europe/Moscow).
    """
    from datetime import datetime, time as time_cls

    now = timezone.localtime(timezone.now())
    target = (now + timedelta(days=int(days_ahead))).date()
    tz = timezone.get_current_timezone()
    start = timezone.make_aware(datetime.combine(target, time_cls.min), tz)
    end = start + timedelta(days=1)
    return start, end


def process_expiry_reminders(*, days_list=(7, 3, 1)) -> dict:
    from .subscription_notifications import notify_subscription_expiry_reminder

    results = {}
    for days in days_list:
        start, end = _local_day_bounds(int(days))
        created = notify_subscription_expiry_reminder(days_ahead=int(days), window_start=start, window_end=end)
        results[int(days)] = created
        logger.info("subscription_reminder_%s_sent count=%s", days, created)
    return results


def process_auto_renewals(*, limit: int = 200) -> dict:
    """Списывает по RebillId подписки с auto_renew, у которых подходит срок."""
    from .models import TeacherSubscription
    from .payment_service import PaymentProviderService

    now = timezone.now()
    window_start = now - RENEW_GRACE
    window_end = now + RENEW_AHEAD

    qs = (
        TeacherSubscription.objects.select_related("plan", "teacher")
        .filter(
            auto_renew=True,
            status__in=[
                TeacherSubscription.Status.ACTIVE,
                TeacherSubscription.Status.TRIAL,
                TeacherSubscription.Status.PAST_DUE,
            ],
            expires_at__gte=window_start,
            expires_at__lte=window_end,
        )
        .exclude(tbank_rebill_id="")
        .exclude(plan__is_free=True)
        .exclude(plan__slug="start")
        .order_by("expires_at")[:limit]
    )

    ok = failed = skipped = 0
    for sub in qs:
        with transaction.atomic():
            locked = (
                TeacherSubscription.objects.select_for_update()
                .select_related("plan", "teacher")
                .filter(pk=sub.pk)
                .first()
            )
            if not locked or not locked.auto_renew or not locked.tbank_rebill_id:
                skipped += 1
                continue
            if locked.last_renewal_attempt_at and (
                now - locked.last_renewal_attempt_at < MIN_RENEW_ATTEMPT_GAP
            ):
                skipped += 1
                continue
            locked.last_renewal_attempt_at = now
            locked.save(update_fields=["last_renewal_attempt_at", "updated_at"])

        # Charge / GetState вне lock, чтобы не держать строку на время HTTP.
        try:
            result = PaymentProviderService.create_recurrent_payment(locked)
        except Exception as exc:
            TeacherSubscription.objects.filter(pk=locked.pk).update(
                last_renewal_error=str(exc)[:255],
                updated_at=timezone.now(),
            )
            logger.exception("auto_renew_failed subscription=%s", locked.pk)
            failed += 1
            continue

        if result.get("ok"):
            TeacherSubscription.objects.filter(pk=locked.pk).update(
                last_renewal_error="",
                updated_at=timezone.now(),
            )
            ok += 1
        else:
            error = str(result.get("error") or "failed")[:255]
            payment = result.get("payment")
            fields = {
                "last_renewal_error": error,
                "updated_at": timezone.now(),
            }
            if result.get("error") == "already_failed" or (
                payment is not None
                and getattr(payment, "status", None) == payment.Status.FAILED
            ):
                fields["auto_renew"] = False
            TeacherSubscription.objects.filter(pk=locked.pk).update(**fields)
            failed += 1

    return {"ok": ok, "failed": failed, "skipped": skipped}


def process_expired_subscriptions(*, limit: int = 500) -> dict:
    """Истёкшие платные подписки → Старт (или apply prepaid/pending). Данные не удаляются."""
    from .models import TeacherSubscription
    from .subscription_access import SubscriptionAccessService
    from .subscription_downgrade import DowngradeService

    plan_changes = DowngradeService.apply_due_changes(limit=limit)

    now = timezone.now()
    start_plan = SubscriptionAccessService.get_start_plan()
    qs = (
        TeacherSubscription.objects.select_related("plan")
        .filter(
            expires_at__lte=now,
            status__in=[
                TeacherSubscription.Status.ACTIVE,
                TeacherSubscription.Status.TRIAL,
                TeacherSubscription.Status.PAST_DUE,
                TeacherSubscription.Status.CANCELLED,
            ],
        )
        .exclude(plan_id=start_plan.pk)
        .order_by("expires_at")[:limit]
    )

    moved = 0
    for sub in qs:
        with transaction.atomic():
            locked = TeacherSubscription.objects.select_for_update().filter(pk=sub.pk).first()
            if not locked or not locked.expires_at or locked.expires_at > now:
                continue
            if locked.plan_id == start_plan.pk:
                continue
            # Prepaid/pending ещё не применены — apply_due_changes разберёт.
            active_change = DowngradeService.get_active_change(locked)
            if active_change:
                continue
            # Если автопродление ещё в окне попытки — не демотируем сразу.
            if (
                locked.auto_renew
                and locked.tbank_rebill_id
                and locked.expires_at >= now - RENEW_GRACE
            ):
                continue
            locked.plan = start_plan
            locked.status = TeacherSubscription.Status.EXPIRED
            locked.auto_renew = False
            locked.scheduled_plan = None
            locked.scheduled_change_at = None
            locked.save(
                update_fields=[
                    "plan",
                    "status",
                    "auto_renew",
                    "scheduled_plan",
                    "scheduled_change_at",
                    "updated_at",
                ]
            )
            moved += 1
            logger.info(
                "subscription_expired teacher=%s subscription=%s → start",
                locked.teacher_id,
                locked.pk,
            )
    return {"moved_to_start": moved, "plan_changes": plan_changes}


def run_subscription_maintenance(*, renew: bool = True, remind: bool = True, expire: bool = True) -> dict:
    result = {}
    if remind:
        result["reminders"] = process_expiry_reminders()
    if renew:
        result["renewals"] = process_auto_renewals()
    if expire:
        result["expired"] = process_expired_subscriptions()
    return result


def subscription_banner_payload(sub) -> dict | None:
    """Данные баннера для главной кабинета (только платные активные)."""
    from .pricing_service import base_plan_price
    from .subscription_downgrade import DowngradeService, is_free_plan

    if not sub or not sub.is_valid():
        return None
    plan = sub.plan
    if not plan or plan.is_free or plan.slug == "start":
        return None
    if not sub.expires_at:
        return None

    now = timezone.now()
    delta = sub.expires_at - now
    days = max(0, int(delta.total_seconds() // 86400))
    if days > 7:
        return None

    next_plan = DowngradeService.effective_next_plan(sub)
    amount = base_plan_price(next_plan, sub.billing_period or "month") if next_plan else None
    auto = bool(sub.auto_renew) and next_plan and not is_free_plan(next_plan)
    pending = DowngradeService.payload_for_subscription(sub)
    return {
        "plan_name": plan.name,
        "plan_slug": plan.slug,
        "expires_at": sub.expires_at.isoformat(),
        "days_remaining": days,
        "auto_renew": auto,
        "next_charge_amount": str(amount) if auto else None,
        "currency": getattr(next_plan, "currency", plan.currency),
        "payment_method_mask": (sub.payment_method_mask or "") or None,
        "pending_plan": pending,
        "link": "/cabinet/upgrade",
    }
