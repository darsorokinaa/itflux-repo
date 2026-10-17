"""
r61: автопродление с привязкой карты (рекуррентные платежи Т-Банка).

* согласие на автопродление — отдельная галочка в checkout (по умолчанию выключена);
  текст, версия и время согласия сохраняются в метаданных платежа и в журнале согласий
  messaging.UserConsentLog (consent_type="auto_renew");
* auto_renew=True ставится только при согласии И сохранённом RebillId;
* уведомление о предстоящем списании за 3 дня — только подпискам с auto_renew + RebillId;
* повторная попытка списания при отказе банка, затем отключение автопродления.
"""

from __future__ import annotations

import hashlib
import logging
from datetime import timedelta

from django.db import transaction
from django.utils import timezone

logger = logging.getLogger(__name__)

AUTO_RENEW_CONSENT_VERSION = "AUTO_RENEW_V1_2026-10-17"
CONSENT_TYPE = "auto_renew"
CONSENT_CHANNEL = "auto_renew"
NOTICE_KIND = "renew_3"
NOTICE_DAYS = 3
# Сколько попыток Charge на один период: первая (за ~6 ч до конца) + одна повторная (через ≥12 ч).
MAX_RENEW_ATTEMPTS = 2


def consent_text_sha(text: str) -> str:
    return hashlib.sha256((text or "").encode("utf-8")).hexdigest()


def build_consent_meta(*, text: str = "", version: str = "", amount=None, billing_period: str = "month",
                       plan_slug: str = "", source: str = "checkout") -> dict:
    text = (text or "").strip()[:2000]
    return {
        "accepted": True,
        "accepted_at": timezone.now().isoformat(),
        "text_version": (version or AUTO_RENEW_CONSENT_VERSION)[:64],
        "text": text,
        "text_sha256": consent_text_sha(text),
        "renewal_amount": str(amount) if amount is not None else None,
        "billing_period": billing_period,
        "plan_slug": plan_slug,
        "source": source,
    }


def _client_ip(request):
    if request is None:
        return None
    raw = (request.META.get("HTTP_X_REAL_IP") or request.META.get("HTTP_X_FORWARDED_FOR") or
           request.META.get("REMOTE_ADDR") or "").split(",")[0].strip()
    return raw or None


def log_consent(user, *, granted: bool, text: str = "", version: str = "", source: str = "checkout",
                request=None) -> None:
    """Пишет согласие/отзыв в журнал согласий (без изменения маркетинговых согласий)."""
    try:
        from messaging.models import UserConsentLog

        UserConsentLog.objects.create(
            user=user,
            consent_type=CONSENT_TYPE,
            channel=CONSENT_CHANNEL,
            action=UserConsentLog.Action.GRANTED if granted else UserConsentLog.Action.REVOKED,
            consent_text_version=(version or AUTO_RENEW_CONSENT_VERSION)[:64],
            text_sha256=consent_text_sha(text),
            source=source[:64],
            ip_address=_client_ip(request),
            user_agent=((request.META.get("HTTP_USER_AGENT") if request is not None else "") or "")[:300],
        )
    except Exception:
        logger.exception("r61 auto_renew consent log failed user=%s", getattr(user, "pk", None))


def apply_auto_renew_consent(payment) -> bool:
    """
    Включает auto_renew, если в платеже есть согласие и на подписке уже есть RebillId.
    Идемпотентно (metadata.auto_renew_applied). Вызывается после активации тарифа и при
    позднем webhook с RebillId (когда оплату подтвердил GetState раньше уведомления).
    """
    from .models import Payment, TeacherSubscription

    meta = payment.metadata if isinstance(payment.metadata, dict) else {}
    if meta.get("recurrent_consent") is not True or meta.get("auto_renew_applied"):
        return False
    if payment.status != Payment.Status.PAID or not payment.subscription_id:
        return False
    with transaction.atomic():
        sub = TeacherSubscription.objects.select_for_update().select_related("plan").get(pk=payment.subscription_id)
        if not (sub.tbank_rebill_id or "").strip():
            return False
        if payment.plan_id and sub.plan_id != payment.plan_id:
            return False
        if not sub.is_valid():
            return False
        # Поздний webhook не должен включать обратно, если пользователь уже успел отключить.
        if meta.get("auto_renew_disabled_by_user"):
            return False
        sub.auto_renew = True
        sub.cancelled_at = None
        sub.save(update_fields=["auto_renew", "cancelled_at", "updated_at"])
        p = Payment.objects.select_for_update().get(pk=payment.pk)
        m = dict(p.metadata or {})
        m["auto_renew_applied"] = timezone.now().isoformat()
        p.metadata = m
        p.save(update_fields=["metadata", "updated_at"])
    logger.info("r61 auto_renew enabled by consent payment_id=%s subscription=%s", payment.pk, sub.pk)
    return True


def mark_user_disabled(sub) -> None:
    """Пользователь отключил автопродление — помечаем неприменённые согласия, чтобы поздний webhook их не включил."""
    from .models import Payment

    for p in Payment.objects.filter(subscription=sub, status=Payment.Status.PAID).order_by("-id")[:5]:
        m = dict(p.metadata or {})
        if m.get("recurrent_consent") is True and not m.get("auto_renew_applied") and not m.get("auto_renew_disabled_by_user"):
            m["auto_renew_disabled_by_user"] = timezone.now().isoformat()
            p.metadata = m
            p.save(update_fields=["metadata", "updated_at"])


def has_explicit_consent(sub) -> bool:
    """
    Явное согласие на автопродление: последняя запись журнала согласий auto_renew — «выдано».
    Пишется только галочкой в checkout или включением в кабинете с подтверждением текста.
    Старые платежи (до r61) и повторные уведомления банка согласия не создают.
    """
    try:
        from messaging.models import UserConsentLog

        last = (
            UserConsentLog.objects.filter(user_id=sub.teacher_id, consent_type=CONSENT_TYPE)
            .order_by("-id")
            .values_list("action", flat=True)
            .first()
        )
        return last == UserConsentLog.Action.GRANTED
    except Exception:
        logger.exception("r61 consent check failed sub=%s", getattr(sub, "pk", None))
        return False


def renewal_cycle_key(sub, plan) -> str:
    date = sub.expires_at.date().isoformat() if sub.expires_at else "na"
    return f"renew_{sub.pk}_{date}_{plan.slug}"


def failed_attempts(sub, plan) -> int:
    from .models import Payment

    return Payment.objects.filter(
        idempotency_key__startswith=renewal_cycle_key(sub, plan), status=Payment.Status.FAILED
    ).count()


# ── Уведомление о предстоящем списании ───────────────────────────────────────

def _fmt_money(amount) -> str:
    try:
        return f"{int(round(float(amount))):,}".replace(",", "\u00a0") + "\u00a0₽"
    except (TypeError, ValueError):
        return f"{amount} ₽"


def _fmt_date(dt) -> str:
    return timezone.localtime(dt).strftime("%d.%m.%Y")


def render_renewal_notice(*, user, plan_name: str, charge_at, amount, billing_period: str, card_mask: str = "") -> dict:
    from .r50_tariffs import public_url

    period_word = "год" if billing_period == "year" else "месяц"
    date = _fmt_date(charge_at)
    money = _fmt_money(amount)
    card = f" {card_mask}" if card_mask else ""
    name = (getattr(user, "first_name", "") or "").strip()
    hello = f"Здравствуйте, {name}!" if name else "Здравствуйте!"
    link = f"{public_url()}/cabinet/upgrade"
    subject = f"Автопродление «{plan_name}» {date}: спишем {money}"
    lines = [
        hello,
        "",
        f"{date} заканчивается оплаченный период тарифа «{plan_name}». В этот день мы автоматически продлим "
        f"подписку на {period_word} и спишем {money} с привязанной карты{card}.",
        "",
        "Если продлевать не нужно, отключите автопродление в кабинете: «Подписка и оплата» → "
        f"«Отключить автопродление». Доступ сохранится до {date}, затем аккаунт перейдёт на бесплатный "
        "тариф «Старт». Все данные сохранятся.",
        "",
        f"Управление подпиской: {link}",
        "",
        "Это служебное уведомление о предстоящем списании по подписке, на автопродление которой вы дали согласие.",
        "Цифровой поток",
    ]
    text = "\n".join(lines)
    from django.utils.html import escape

    html = "".join(
        f"<p>{escape(par).replace(chr(10), '<br>')}</p>" for par in "\n".join(lines).split("\n\n")
    ).replace(escape(link), f'<a href="{link}">{escape(link)}</a>')
    in_app = (
        f"{date} продлим подписку «{plan_name}» на {period_word} и спишем {money} с привязанной карты{card}. "
        "Отключить автопродление можно в разделе «Подписка и оплата»."
    )
    return {
        "subject": subject, "text": text, "html": html, "pay_link": "/cabinet/upgrade",
        "in_app_title": f"Скоро автопродление «{plan_name}»", "in_app_message": in_app,
        "in_app_button": "Управление подпиской", "version": "renewal_notice_v1",
        "unsubscribe": "",
    }


def renewal_notice_candidates(now=None):
    """Только подписки с auto_renew + RebillId, которые будут списаны в ближайшие NOTICE_DAYS дней."""
    from .models import TeacherSubscription
    from .r50_tariffs import EXCLUDED_SUBSCRIPTION_IDS

    now = now or timezone.now()
    return (
        TeacherSubscription.objects.select_related("plan", "teacher")
        .filter(
            auto_renew=True,
            status__in=[TeacherSubscription.Status.ACTIVE, TeacherSubscription.Status.TRIAL],
            expires_at__gt=now,
            expires_at__lte=now + timedelta(days=NOTICE_DAYS),
            cancelled_at__isnull=True,
        )
        .exclude(tbank_rebill_id="")
        .exclude(plan__is_free=True)
        .exclude(plan__slug__in=["start", "school"])
        .exclude(pk__in=EXCLUDED_SUBSCRIPTION_IDS)
        .exclude(teacher__is_superuser=True)
    )


def process_renewal_notices(now=None, *, force: bool = False) -> dict:
    """Ежечасно из process_subscriptions. Один раз на (учитель, дата окончания, канал)."""
    from .pricing_service import base_plan_price
    from .r50_tariffs import _deliver, _local_date, reminders_enabled
    from .subscription_downgrade import DowngradeService, is_free_plan

    if not (force or reminders_enabled()):
        return {"enabled": False}
    now = now or timezone.now()
    if not force and not (9 <= timezone.localtime(now).hour < 21):
        return {"enabled": True, "skipped": "quiet hours"}
    stats: dict[str, int] = {}
    for sub in renewal_notice_candidates(now):
        if not has_explicit_consent(sub):
            continue
        next_plan = DowngradeService.effective_next_plan(sub)
        if not next_plan or is_free_plan(next_plan):
            continue
        amount = base_plan_price(next_plan, sub.billing_period or "month")
        rendered = render_renewal_notice(
            user=sub.teacher, plan_name=next_plan.name, charge_at=sub.expires_at, amount=amount,
            billing_period=sub.billing_period or "month", card_mask=sub.payment_method_mask or "",
        )
        res = _deliver(sub.teacher, NOTICE_KIND, _local_date(sub.expires_at), next_plan.slug, rendered)
        for ch, st in res.items():
            stats[f"{ch}:{st}"] = stats.get(f"{ch}:{st}", 0) + 1
    logger.info("r61 renewal notices stats=%s", stats)
    return {"enabled": True, "stats": stats}
