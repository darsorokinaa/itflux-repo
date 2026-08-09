"""Уведомления о подписке платформы (не биллинг учеников)."""

from __future__ import annotations

import logging
from decimal import Decimal

from django.utils import timezone

logger = logging.getLogger(__name__)


def _format_money(amount) -> str:
    value = Decimal(str(amount or 0)).quantize(Decimal("1"))
    return f"{int(value):,}".replace(",", " ") + " ₽"


def _format_date(dt) -> str:
    if not dt:
        return ""
    local = timezone.localtime(dt)
    months = (
        "",
        "января",
        "февраля",
        "марта",
        "апреля",
        "мая",
        "июня",
        "июля",
        "августа",
        "сентября",
        "октября",
        "ноября",
        "декабря",
    )
    return f"{local.day} {months[local.month]} {local.year}"


def _dispatch_or_create(
    *,
    user,
    event_key: str,
    event_type: str,
    title: str,
    message: str,
    payload: dict,
):
    """Использует NotificationDispatcher при возможности; иначе get_or_create IN_APP."""
    try:
        from .notification_dispatch import NotificationDispatcher

        result = NotificationDispatcher.notify(
            recipient=user,
            event_type=event_type,
            title=title,
            message=message,
            dedup_key=event_key,
            payload=payload,
            url=(payload or {}).get("link") or "/cabinet/upgrade",
            force=True,
            create_in_app=True,
        )
        if result and not getattr(result, "skipped", False):
            return True
        if result and getattr(result, "reason", "") in ("duplicate", "dedup"):
            return False
    except Exception:
        logger.debug("NotificationDispatcher unavailable for %s", event_type, exc_info=True)

    from .choices import NotificationChannel, NotificationStatus
    from .models import Notification

    _, was_created = Notification.objects.get_or_create(
        recipient_user=user,
        channel=NotificationChannel.IN_APP,
        event_key=event_key,
        defaults={
            "recipient_teacher": user,
            "event_type": event_type,
            "title": title,
            "message": message,
            "status": NotificationStatus.PENDING,
            "payload": payload,
        },
    )
    return was_created


def notify_subscription_expiry_reminder(
    *,
    days_ahead: int,
    window_start=None,
    window_end=None,
) -> int:
    """
    Напоминания за 7 / 3 / 1 день до ends_at.
    Ключ уникален по subscription + expires_at date + bucket → нет дублей.
    При смене ends_at старые ключи больше не матчятся.
    """
    from .models import TeacherSubscription
    from .pricing_service import base_plan_price

    if days_ahead not in (7, 3, 1):
        return 0

    qs = TeacherSubscription.objects.filter(
        status__in=[
            TeacherSubscription.Status.ACTIVE,
            TeacherSubscription.Status.TRIAL,
        ],
        expires_at__gte=window_start,
        expires_at__lt=window_end,
    ).select_related("teacher", "plan")

    created = 0
    for sub in qs:
        plan = sub.plan
        if not plan or plan.is_free or plan.slug == "start":
            continue
        ends_date = timezone.localtime(sub.expires_at).date().isoformat()
        from .subscription_downgrade import DowngradeService, is_free_plan

        pending = DowngradeService.payload_for_subscription(sub)
        next_plan = DowngradeService.effective_next_plan(sub)
        event_key = (
            f"subscription:{sub.pk}:{ends_date}:expiry_{days_ahead}"
            f":next_{getattr(next_plan, 'slug', 'none')}"
        )
        event_type = f"subscription_expiry_{days_ahead}_days"
        plan_name = plan.name
        next_name = next_plan.name if next_plan else plan_name
        ends_label = _format_date(sub.expires_at)
        amount = base_plan_price(next_plan or plan, sub.billing_period or "month")
        amount_label = _format_money(amount)
        auto = bool(sub.auto_renew) and next_plan and not is_free_plan(next_plan)
        to_start = bool(pending and pending.get("is_to_start"))
        changing = bool(pending and pending.get("to_plan_slug") != plan.slug)

        if changing and to_start:
            if days_ahead == 7:
                title = f"«{plan_name}» действует ещё 7 дней"
                message = (
                    f"Тариф «{plan_name}» действует ещё 7 дней — до {ends_label}. "
                    f"После этого вы перейдёте на «{next_name}»."
                )
            elif days_ahead == 3:
                title = f"Через 3 дня — тариф «{next_name}»"
                message = (
                    f"Тариф «{plan_name}» действует ещё 3 дня. "
                    f"После этого будет доступен «{next_name}»."
                )
            else:
                title = f"Завтра переход на «{next_name}»"
                message = (
                    f"Завтра заканчивается «{plan_name}». "
                    f"Будет активирован тариф «{next_name}»."
                )
            cta = "Управление подпиской"
        elif changing and auto:
            if days_ahead == 7:
                title = f"Смена тарифа через 7 дней"
                message = (
                    f"Через 7 дней тариф «{plan_name}» сменится на «{next_name}». "
                    f"Планируемое списание — {amount_label}."
                )
            elif days_ahead == 3:
                title = f"Смена на «{next_name}» через 3 дня"
                message = (
                    f"Через 3 дня тариф «{plan_name}» сменится на «{next_name}». "
                    f"К списанию — {amount_label}."
                )
            else:
                title = f"Завтра списание за «{next_name}»"
                message = (
                    f"Завтра «{plan_name}» сменится на «{next_name}». "
                    f"Списание — {amount_label}."
                )
            cta = "Управление подпиской"
        elif changing:
            if days_ahead == 7:
                title = f"«{plan_name}» ещё 7 дней"
                message = (
                    f"Тариф «{plan_name}» действует ещё 7 дней. "
                    f"После этого вы перейдёте на «{next_name}»."
                )
            elif days_ahead == 3:
                title = f"До перехода на «{next_name}» — 3 дня"
                message = (
                    f"До окончания «{plan_name}» осталось 3 дня. "
                    f"Далее — тариф «{next_name}» (нужна оплата)."
                )
            else:
                title = f"Завтра конец «{plan_name}»"
                message = (
                    f"Завтра заканчивается «{plan_name}». "
                    f"Чтобы получить «{next_name}», оплатите тариф."
                )
            cta = "Управление подпиской"
        elif auto:
            if days_ahead == 7:
                title = f"Автопродление «{plan_name}»"
                message = (
                    f"Подписка «{plan_name}» продлится автоматически {ends_label}. "
                    f"Планируемая сумма списания — {amount_label}."
                )
                cta = "Управление подпиской"
            elif days_ahead == 3:
                title = f"Автопродление через 3 дня"
                message = (
                    f"Через 3 дня автоматически продлим подписку «{plan_name}». "
                    f"К списанию — {amount_label}."
                )
                cta = "Управление подпиской"
            else:
                title = f"Автопродление завтра"
                message = (
                    f"Завтра запланировано автопродление подписки «{plan_name}» "
                    f"на {amount_label}."
                )
                cta = "Управление подпиской"
        else:
            if days_ahead == 7:
                title = f"Подписка «{plan_name}» заканчивается через 7 дней"
                message = (
                    f"Подписка «{plan_name}» закончится через 7 дней — {ends_label}. "
                    f"После окончания будет доступен тариф «Старт». "
                    f"Продлите подписку, чтобы сохранить полный доступ."
                )
                cta = "Продлить подписку"
            elif days_ahead == 3:
                title = f"До окончания подписки «{plan_name}» — 3 дня"
                message = f"До окончания подписки «{plan_name}» осталось 3 дня."
                cta = "Продлить"
            else:
                title = f"Подписка «{plan_name}» заканчивается завтра"
                message = (
                    f"Подписка «{plan_name}» заканчивается завтра. "
                    f"Продлите её, чтобы не потерять доступ к функциям тарифа."
                )
                cta = "Продлить сейчас"

        payload = {
            "plan_slug": plan.slug,
            "plan_name": plan_name,
            "next_plan_slug": getattr(next_plan, "slug", None),
            "next_plan_name": next_name,
            "expires_at": sub.expires_at.isoformat(),
            "days_ahead": days_ahead,
            "auto_renew": auto,
            "pending_plan": pending,
            "next_charge_amount": str(amount) if auto else None,
            "link": "/cabinet/upgrade",
            "cta": cta,
        }
        if _dispatch_or_create(
            user=sub.teacher,
            event_key=event_key,
            event_type=event_type,
            title=title,
            message=message,
            payload=payload,
        ):
            created += 1
            logger.info(
                "subscription_reminder_%s_sent subscription=%s teacher=%s",
                days_ahead,
                sub.pk,
                sub.teacher_id,
            )
    return created


def notify_subscription_expiring(*, days_ahead: int = 3) -> int:
    """
    Legacy entrypoint для cron notify_subscription_expiring.
    Делегирует в точные окна 7/3/1; другие значения — no-op (кроме совместимости).
    """
    from .subscription_lifecycle import _local_day_bounds

    if days_ahead not in (7, 3, 1):
        # Старый cron мог передавать 14 — больше не шлём.
        return 0
    start, end = _local_day_bounds(days_ahead)
    return notify_subscription_expiry_reminder(
        days_ahead=days_ahead, window_start=start, window_end=end
    )


def notify_auto_renew_success(payment, subscription) -> bool:
    plan_name = subscription.plan.name if subscription.plan_id else "тариф"
    ends = _format_date(subscription.expires_at)
    amount = payment.final_amount if payment.final_amount is not None else payment.amount
    title = f"Подписка «{plan_name}» продлена"
    message = (
        f"Подписка «{plan_name}» успешно продлена до {ends}."
        + (f" Списано {_format_money(amount)}." if amount else "")
    )
    event_key = (
        f"subscription:{subscription.pk}:"
        f"{timezone.localtime(subscription.expires_at).date().isoformat()}:"
        f"renewed_{payment.pk}"
    )
    return _dispatch_or_create(
        user=payment.teacher,
        event_key=event_key,
        event_type="subscription_renewed",
        title=title,
        message=message,
        payload={
            "plan_slug": subscription.plan.slug if subscription.plan_id else None,
            "expires_at": subscription.expires_at.isoformat() if subscription.expires_at else None,
            "payment_id": payment.pk,
            "link": "/cabinet/upgrade",
            "cta": "Управление подпиской",
        },
    )


def notify_auto_renew_failed(payment) -> bool:
    plan = payment.plan
    plan_name = plan.name if plan else "тариф"
    sub = payment.subscription
    ends = _format_date(sub.expires_at) if sub and sub.expires_at else ""
    title = f"Не удалось продлить «{plan_name}»"
    message = (
        f"Не удалось автоматически продлить подписку «{plan_name}». "
        f"Оплатите её вручную, чтобы сохранить доступ."
    )
    if ends:
        message += f" Подписка действует до {ends}."
    event_key = f"subscription_renew_failed:{payment.pk}"
    return _dispatch_or_create(
        user=payment.teacher,
        event_key=event_key,
        event_type="subscription_renew_failed",
        title=title,
        message=message,
        payload={
            "plan_slug": plan.slug if plan else None,
            "payment_id": payment.pk,
            "expires_at": sub.expires_at.isoformat() if sub and sub.expires_at else None,
            "link": "/cabinet/upgrade",
            "cta": "Оплатить",
        },
    )
