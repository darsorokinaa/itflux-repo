"""
r50: новая тарифная сетка «Старт / Репетитор / Профи / Школа».

* пробный «Профи» на 14 дней (один раз на аккаунт);
* «Вы сэкономили ≈ X ч» для страницы тарифов;
* подписанные ссылки «оплатить в один клик» и «отписаться»;
* напоминания об окончании подписки (7/3/0 дней) и пробного периода (3/1/0).
  Реальная отправка выключена флагом SUBSCRIPTION_REMINDERS_R50_ENABLED (по умолчанию False).
"""

from __future__ import annotations

import hashlib
import logging
import os
from datetime import datetime, time as time_cls, timedelta

from django.conf import settings
from django.core import signing
from django.db import transaction
from django.utils import timezone

logger = logging.getLogger(__name__)

TRIAL_DAYS = 14
TRIAL_PLAN_SLUG = "pro"
TEST_EMAIL = "itflux.academy@yandex.ru"
PAY_SALT = "r50-pay-link"
UNSUB_SALT = "r50-unsubscribe"
LINK_MAX_AGE = 60 * 60 * 24 * 45

# Промокоды-спецпредложение для бывшего бесплатного «Премиума».
OFFER_CODE_MONTH = "potok1110"
OFFER_CODE_YEAR = "potok1110y"
OFFER_TEXT = (
    "скидка 50 % на первый месяц «Профи» (промокод potok1110) или 40 % на «Профи» за год "
    "(промокод potok1110y) — до 30 ноября 2026 года"
)
OFFER_UNTIL = datetime(2026, 11, 30, 23, 59, 59)

# Минуты, которые экономит одно действие (оценка владельца).
SAVED_MINUTES = {"variant": 15, "homework_checked": 10, "journal": 5, "payment": 2}

PLAN_LABELS = {"start": "Старт", "teacher": "Репетитор", "pro": "Профи", "premium": "Премиум", "materials": "Только материалы", "school": "Школа"}


def reminders_enabled() -> bool:
    val = getattr(settings, "SUBSCRIPTION_REMINDERS_R50_ENABLED", None)
    if val is None:
        val = os.environ.get("SUBSCRIPTION_REMINDERS_R50_ENABLED", "")
    return str(val).strip().lower() in ("1", "true", "yes", "on")


def public_url() -> str:
    return (getattr(settings, "LK_PUBLIC_URL", "") or "https://itflux-academy.ru").rstrip("/")


# ── Пробный период ───────────────────────────────────────────────────────────

def _is_teacher(user) -> bool:
    profile = getattr(user, "profile", None)
    return bool(profile and getattr(profile, "role", "") == "teacher")


def trial_status(user) -> dict:
    from .models import Payment, TeacherSubscription, TrialGrant

    out = {"available": False, "used": False, "active": False, "ends_at": None, "days": TRIAL_DAYS}
    if not user or not getattr(user, "is_authenticated", False) or not _is_teacher(user):
        return out
    grant = TrialGrant.objects.filter(teacher=user).first()
    sub = TeacherSubscription.objects.select_related("plan").filter(teacher=user).first()
    if grant:
        out["used"] = True
        out["ends_at"] = grant.ends_at.isoformat()
        out["active"] = bool(
            sub and sub.status == TeacherSubscription.Status.TRIAL and sub.plan.slug == grant.plan_slug
            and sub.expires_at and sub.expires_at > timezone.now()
        )
        return out
    had_paid = Payment.objects.filter(teacher=user, status=Payment.Status.PAID).exists()
    had_promo = bool(
        sub and (
            sub.is_legacy_promo
            or sub.promo_ends_at
            or sub.source in (
                TeacherSubscription.Source.LAUNCH_PROMO,
                TeacherSubscription.Source.PAYMENT,
                TeacherSubscription.Source.PROMO_CODE,
                TeacherSubscription.Source.PROMOTION,
                TeacherSubscription.Source.REFERRAL,
            )
        )
    )
    on_start = (sub is None) or sub.plan.slug == "start" or not sub.is_valid()
    if had_paid or had_promo:
        out["used"] = True  # бесплатный период уже был (акция/оплата)
        return out
    out["available"] = bool(on_start)
    return out


class TrialError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code
        self.message = message


def start_trial(user, *, source: str = "manual"):
    from .models import TariffPlan, TeacherSubscription, TrialGrant
    from .subscription_service import SubscriptionLimitService

    status = trial_status(user)
    if not status["available"]:
        raise TrialError("TRIAL_NOT_AVAILABLE", "Пробный период уже использован или недоступен для этого аккаунта.")
    plan = TariffPlan.objects.filter(slug=TRIAL_PLAN_SLUG, is_active=True).first()
    if not plan:
        raise TrialError("TRIAL_PLAN_MISSING", "Тариф «Профи» недоступен.")
    SubscriptionLimitService.get_or_create_subscription(user)
    now = timezone.now()
    ends = now + timedelta(days=TRIAL_DAYS)
    with transaction.atomic():
        sub = TeacherSubscription.objects.select_for_update().get(teacher=user)
        if TrialGrant.objects.filter(teacher=user).exists():
            raise TrialError("TRIAL_NOT_AVAILABLE", "Пробный период уже использован.")
        TrialGrant.objects.create(teacher=user, plan_slug=plan.slug, started_at=now, ends_at=ends, source=source)
        sub.plan = plan
        sub.status = TeacherSubscription.Status.TRIAL
        sub.source = TeacherSubscription.Source.SELF
        sub.expires_at = ends
        sub.current_period_start = now
        sub.current_period_end = ends
        sub.auto_renew = False
        sub.billing_period = TeacherSubscription.BillingPeriod.MONTH
        sub.save(update_fields=[
            "plan", "status", "source", "expires_at", "current_period_start",
            "current_period_end", "auto_renew", "billing_period", "updated_at",
        ])
    try:
        from .worksheet_ai.billing import ensure_period_grant

        ensure_period_grant(user)
    except Exception:
        logger.exception("trial token grant failed user=%s", user.pk)
    logger.info("r50_trial_started user=%s until=%s source=%s", user.pk, ends.isoformat(), source)
    return sub


def is_r50_trial(sub) -> bool:
    from .models import TrialGrant

    if not sub or sub.status != sub.Status.TRIAL:
        return False
    grant = TrialGrant.objects.filter(teacher_id=sub.teacher_id).first()
    return bool(grant and sub.expires_at and abs((grant.ends_at - sub.expires_at).total_seconds()) < 86400 * 2)


# ── «Вы сэкономили ≈ X ч» ─────────────────────────────────────────────────────

def saved_time(user) -> dict:
    from Generator.models import Variant

    from .billing_models import StudentPayment
    from .choices import SubmissionStatus
    from .journal_models import LessonJournal
    from .models import HomeworkSubmission

    counts = {
        "variant": Variant.objects.filter(owner_teacher=user).count(),
        "homework_checked": HomeworkSubmission.objects.filter(
            homework__teacher=user, status=SubmissionStatus.CHECKED
        ).count(),
        "journal": LessonJournal.objects.filter(teacher=user).count(),
        "payment": StudentPayment.objects.filter(billing_account__teacher=user).count(),
    }
    minutes = sum(SAVED_MINUTES[k] * v for k, v in counts.items())
    hours = minutes / 60.0
    if hours >= 10:
        shown = int(round(hours))
    else:
        shown = round(hours, 1)
    return {"minutes": minutes, "hours": shown, "counts": counts, "per_item_minutes": SAVED_MINUTES}


# ── Подписанные ссылки ───────────────────────────────────────────────────────

def make_pay_token(user, plan_slug: str, period: str = "month", promo: str = "", kind: str = "") -> str:
    return signing.dumps({"u": user.pk, "p": plan_slug, "b": period, "c": promo, "k": kind}, salt=PAY_SALT, compress=True)


def make_pay_link(user, plan_slug, period="month", promo="", kind="") -> str:
    return f"{public_url()}/api/cabinet/r50/pay/{make_pay_token(user, plan_slug, period, promo, kind)}/"


def read_pay_token(token: str) -> dict:
    return signing.loads(token, salt=PAY_SALT, max_age=LINK_MAX_AGE)


def make_unsubscribe_link(user) -> str:
    token = signing.dumps({"u": user.pk}, salt=UNSUB_SALT)
    return f"{public_url()}/api/cabinet/r50/unsubscribe/{token}/"


def read_unsubscribe_token(token: str) -> int:
    return int(signing.loads(token, salt=UNSUB_SALT)["u"])


# ── Напоминания ──────────────────────────────────────────────────────────────

SUB_OFFSETS = {"sub_7": 7, "sub_3": 3, "sub_end": 0}
TRIAL_OFFSETS = {"trial_3": 3, "trial_1": 1, "trial_end": 0}


def _fmt_date(dt) -> str:
    months = ("", "января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа",
              "сентября", "октября", "ноября", "декабря")
    d = timezone.localtime(dt) if isinstance(dt, datetime) else dt
    return f"{d.day} {months[d.month]} {d.year}"


def offer_active(now=None) -> bool:
    now = now or timezone.now()
    until = timezone.make_aware(OFFER_UNTIL, timezone.get_current_timezone())
    return now <= until


def _audience(sub) -> str:
    if is_r50_trial(sub):
        return "trial"
    if sub.plan.slug == "premium" and (
        sub.source == sub.Source.LAUNCH_PROMO or sub.status == sub.Status.TRIAL or sub.is_legacy_promo
    ):
        return "free_premium"
    return "paid"


def _price_label(slug: str) -> str:
    from .models import TariffPlan

    plan = TariffPlan.objects.filter(slug=slug).first()
    if not plan or not plan.price_month:
        return ""
    m = f"{int(plan.price_month):,}".replace(",", "\u00a0")
    y = f"{int(plan.price_year):,}".replace(",", "\u00a0") if plan.price_year else ""
    return f"{m} ₽ в месяц" + (f" или {y} ₽ в год" if y else "")


def render_reminder(*, user, kind: str, plan_name: str, end_dt, audience: str, now=None,
                    promo: bool = False, plan_slug: str = "") -> dict:
    """r52: СЛУЖЕБНАЯ версия по умолчанию (без скидок/промокодов/«акций», продление по обычной цене).
    Рекламный блок — только при promo=True (добровольное согласие на рекламу в этом канале, ст. 18 38-ФЗ)."""
    name = (user.first_name or "").strip() or user.username
    date_label = _fmt_date(end_dt)
    with_offer = bool(promo) and audience == "free_premium" and offer_active(now)
    if audience == "paid" and plan_slug in ("teacher", "pro", "premium"):
        pay_plan = plan_slug  # платный тариф продлевается тем же тарифом по его обычной цене
    else:
        pay_plan = "teacher" if plan_name in ("Репетитор", "Учитель") else "pro"
    pay_plan_name = PLAN_LABELS.get(pay_plan, plan_name)
    price = _price_label(pay_plan)
    pay_link = make_pay_link(user, pay_plan, "month", OFFER_CODE_MONTH if with_offer else "", kind)
    pay_link_year = make_pay_link(user, pay_plan, "year", OFFER_CODE_YEAR if with_offer else "", kind)
    unsub = make_unsubscribe_link(user)
    end_kind = kind.endswith("_end")
    days = {"sub_7": 7, "sub_3": 3, "trial_3": 3, "trial_1": 1}.get(kind, 0)

    if end_kind:
        subject = f"Подписка «{plan_name}» закончилась"
        lines = [
            f"Здравствуйте, {name}!",
            f"Срок тарифа «{plan_name}» истёк {date_label}. Сейчас у вас тариф «Старт». Ваши ученики, материалы и история сохранены.",
            "Вернуть все возможности можно в один клик" + (f": {OFFER_TEXT}." if with_offer else "."),
        ]
        button = "Возобновить подписку"
        in_app = f"Подписка «{plan_name}» закончилась, сейчас у вас тариф «Старт». Данные сохранены."
        in_app_btn = "Возобновить"
    elif days == 7:
        try:
            n = (_local_date(end_dt) - _local_date(now or timezone.now())).days if isinstance(end_dt, datetime) else 7
        except Exception:
            n = 7
        n = n if 4 <= n <= 7 else 7
        n_word = "дня" if n == 4 else "дней"
        subject = f"Подписка «{plan_name}» закончится через {n} {n_word}"
        lines = [
            f"Здравствуйте, {name}!",
            f"Ваш доступ к тарифу «{plan_name}» действует до {date_label}. Чтобы ученики, материалы и расписание работали без перерыва, продлите подписку заранее.",
        ]
        if with_offer:
            lines.append(f"Для вас — {OFFER_TEXT}.")
        lines.append(f"Если не продлить, после {date_label} аккаунт перейдёт на бесплатный тариф «Старт». Все данные сохранятся.")
        button = "Продлить подписку"
        in_app = f"Подписка «{plan_name}» закончится через {n} {n_word} ({date_label})."
        in_app_btn = "Продлить"
    else:
        # 3 дня (и 1 день для пробного — тот же шаблон с другим числом дней)
        word = "день" if days == 1 else "дня"
        subject = f"Остал{'ся' if days == 1 else 'ось'} {days} {word} подписки «{plan_name}»"
        lines = [
            f"Здравствуйте, {name}!",
            f"До окончания тарифа «{plan_name}» остал{'ся' if days == 1 else 'ось'} {days} {word}, он действует до {date_label}.",
        ]
        if with_offer:
            lines.append(f"Предложение на продление в силе: {OFFER_TEXT}.")
        lines.append(f"После {date_label} будут доступны возможности тарифа «Старт»: до 5 учеников, 10 вариантов и 3 рабочих листа в месяц.")
        button = "Продлить подписку"
        in_app = f"Остал{'ся' if days == 1 else 'ось'} {days} {word} тарифа «{plan_name}»."
        in_app_btn = "Продлить"

    if not with_offer and price:
        lines.append(
            f"Стоимость тарифа «{pay_plan_name}» — {price}." if pay_plan_name == plan_name
            else f"Продолжить работу с расширенными возможностями можно на тарифе «{pay_plan_name}»: {price}."
        )
    mkt_unsub = ""
    if with_offer:
        from .r52_consent import make_marketing_unsubscribe_link

        mkt_unsub = make_marketing_unsubscribe_link(user)
    text = "\n\n".join(lines) + f"\n\n{button}: {pay_link}\n"
    if with_offer:
        text += f"Оплатить «Профи» за год со скидкой 40 %: {pay_link_year}\n"
    text += f"\n—\n«Цифровой поток», itflux-academy.ru\nОтписаться от писем о подписке: {unsub}\n"
    if with_offer:
        text += f"Отписаться от рекламных писем (акции и промокоды): {mkt_unsub}\n"
    from html import escape

    html = "".join(f"<p>{escape(p)}</p>" for p in lines)
    html += (
        f'<p><a href="{pay_link}" style="display:inline-block;padding:12px 22px;background:#4f46e5;'
        f'color:#fff;border-radius:10px;text-decoration:none;font-weight:600">{escape(button)}</a></p>'
    )
    if with_offer:
        html += f'<p><a href="{pay_link_year}">Оплатить «Профи» за год со скидкой 40 %</a></p>'
    html += (
        '<hr><p style="color:#888;font-size:12px">«Цифровой поток», itflux-academy.ru · '
        f'<a href="{unsub}" style="color:#888">Отписаться от писем о подписке</a>'
        + (f' · <a href="{mkt_unsub}" style="color:#888">Отписаться от рекламных писем</a>' if with_offer else "")
        + "</p>"
    )
    return {
        "subject": subject, "text": text, "html": html, "pay_link": pay_link,
        "in_app_title": subject, "in_app_message": in_app, "in_app_button": in_app_btn,
        "with_offer": with_offer, "version": "promo" if with_offer else "service",
        "marketing_unsubscribe": mkt_unsub, "unsubscribe": mkt_unsub or unsub,
    }


def _local_date(dt):
    return timezone.localtime(dt).date()


EXCLUDED_SUBSCRIPTION_IDS = {1}  # r54: подписка владельца (Профи бессрочно) — без напоминаний


def candidate_subscriptions():
    from .models import TeacherSubscription

    return (
        TeacherSubscription.objects.select_related("plan", "teacher")
        .filter(
            status__in=[TeacherSubscription.Status.ACTIVE, TeacherSubscription.Status.TRIAL],
            expires_at__isnull=False,
        )
        .exclude(plan__slug__in=["start", "school"])
        .exclude(plan__is_free=True)
        .exclude(pk__in=EXCLUDED_SUBSCRIPTION_IDS)
        .exclude(teacher__is_superuser=True)
    )


def current_stage(sub, today) -> str | None:
    """r54: только текущий этап (7/3 дня; для пробного 3/1). Без «догоняющих» писем за прошедшие этапы:
    осталось 5 дней → sub_7; осталось 2 дня → только sub_3. Этап не отправляется, если уже ушёл он же или более поздний."""
    from .models import SubscriptionReminderLog

    end = _local_date(sub.expires_at)
    days_left = (end - today).days
    if days_left <= 0:
        return None
    offsets = TRIAL_OFFSETS if _audience(sub) == "trial" else SUB_OFFSETS
    cands = sorted((off, kind) for kind, off in offsets.items() if off > 0 and days_left <= off)
    if not cands:
        return None
    off, kind = cands[0]
    later_or_same = [k for k, o in offsets.items() if 0 < o <= off]
    if SubscriptionReminderLog.objects.filter(
        teacher=sub.teacher, period_end=end, kind__in=later_or_same, channel__in=["email", "in_app"],
        status__in=[SubscriptionReminderLog.Status.SENT, SubscriptionReminderLog.Status.SKIPPED],
    ).exists():
        return None
    return kind


def due_now(now=None) -> list[dict]:
    """Что отправит ближайший запуск process_r50_reminders (для dry-run и контроля)."""
    now = now or timezone.now()
    today = _local_date(now)
    out = []
    for sub in candidate_subscriptions():
        auto = bool(sub.auto_renew and (sub.tbank_rebill_id or "").strip())
        kind = current_stage(sub, today)
        if not kind:
            continue
        out.append({"sub_id": sub.pk, "teacher_id": sub.teacher_id, "email": sub.teacher.email, "plan": sub.plan.slug,
                    "audience": _audience(sub), "expires_at": timezone.localtime(sub.expires_at).isoformat(timespec="minutes"),
                    "days_left": (_local_date(sub.expires_at) - today).days, "kind": kind,
                    "action": "skip: автопродление" if auto else "send"})
    return out


def plan_reminders(now=None, horizon_days: int | None = None) -> list[dict]:
    """Все будущие напоминания (для dry-run CSV) по текущим данным."""
    from .models import SubscriptionReminderLog

    now = now or timezone.now()
    today = _local_date(now)
    rows = []
    for sub in candidate_subscriptions():
        end = _local_date(sub.expires_at)
        if (horizon_days is not None and (end - today).days > horizon_days) or end < today - timedelta(days=1):
            continue
        audience = _audience(sub)
        offsets = TRIAL_OFFSETS if audience == "trial" else SUB_OFFSETS
        auto = bool(sub.auto_renew and (sub.tbank_rebill_id or "").strip())
        for kind, off in offsets.items():
            due = end - timedelta(days=off)
            if due < today:
                state = "missed (дата прошла)"
            elif auto:
                state = "skip: автопродление включено"
            elif getattr(getattr(sub.teacher, "email_opt_out", None), "pk", None):
                state = "email skip: отписан"
            else:
                state = "due today" if due == today else "scheduled"
            already = SubscriptionReminderLog.objects.filter(
                teacher=sub.teacher, kind=kind, period_end=end, status=SubscriptionReminderLog.Status.SENT
            ).exists()
            if already:
                state = "already sent"
            from .r52_consent import has_promo_consent

            em_ok = has_promo_consent(sub.teacher, "email_marketing")
            ia_ok = has_promo_consent(sub.teacher, "inapp_marketing")
            r = render_reminder(user=sub.teacher, kind=kind, plan_name=sub.plan.name, end_dt=sub.expires_at,
                                audience=audience, now=now, promo=em_ok, plan_slug=sub.plan.slug)
            ri = render_reminder(user=sub.teacher, kind=kind, plan_name=sub.plan.name, end_dt=sub.expires_at,
                                 audience=audience, now=now, promo=ia_ok, plan_slug=sub.plan.slug)
            rows.append({
                "teacher_id": sub.teacher_id, "username": sub.teacher.username, "email": sub.teacher.email,
                "plan": sub.plan.slug, "status": sub.status, "source": sub.source, "audience": audience,
                "expires_at": timezone.localtime(sub.expires_at).isoformat(timespec="minutes"),
                "kind": kind, "due_date": due.isoformat(), "state": state,
                "subject": r["subject"], "email_version": r["version"], "inapp_version": ri["version"],
                "email_marketing_consent": em_ok, "inapp_marketing_consent": ia_ok,
                "pay_link_plan": read_pay_token(r["pay_link"].rstrip("/").rsplit("/", 1)[-1])["p"],
            })
    rows.sort(key=lambda x: (x["due_date"], x["teacher_id"]))
    return rows


def _send_email(to: str, rendered: dict) -> None:
    from django.core.mail import EmailMultiAlternatives

    msg = EmailMultiAlternatives(
        subject=rendered["subject"], body=rendered["text"],
        from_email=getattr(settings, "DEFAULT_FROM_EMAIL", None), to=[to],
        headers={"List-Unsubscribe": f"<{rendered.get('unsubscribe', '')}>"} if rendered.get("unsubscribe") else None,
    )
    msg.attach_alternative(rendered["html"], "text/html")
    msg.send(fail_silently=False)


def _create_in_app(user, kind, end, rendered):
    from .choices import NotificationChannel, NotificationStatus
    from .models import Notification

    Notification.objects.get_or_create(
        recipient_user=user,
        channel=NotificationChannel.IN_APP,
        event_key=f"r50:{kind}:{end.isoformat()}",
        defaults={
            "recipient_teacher": user,
            "event_type": f"subscription_r50_{kind}",
            "title": rendered["in_app_title"],
            "message": rendered["in_app_message"],
            "status": NotificationStatus.PENDING,
            "payload": {"link": rendered["pay_link"], "button": rendered["in_app_button"], "kind": kind},
        },
    )


def _deliver(sub_teacher, kind, end, plan_slug, rendered, render_args=None) -> dict:
    """Отправка один раз на (учитель, тип, дата окончания, канал)."""
    from django.db import IntegrityError

    from .models import EmailOptOut, SubscriptionReminderLog

    res = {}
    for channel in ("in_app", "email"):
        try:
            with transaction.atomic():
                log = SubscriptionReminderLog.objects.create(
                    teacher=sub_teacher, kind=kind, period_end=end, channel=channel,
                    plan_slug=plan_slug, status=SubscriptionReminderLog.Status.SENT,
                )
        except IntegrityError:
            res[channel] = "duplicate"
            continue
        if render_args is not None:
            from .r52_consent import has_promo_consent

            promo = has_promo_consent(sub_teacher, "inapp_marketing" if channel == "in_app" else "email_marketing")
            rendered = render_reminder(**dict(render_args, promo=promo))
            log.detail = rendered["version"]
            log.save(update_fields=["detail"])
        try:
            if channel == "in_app":
                _create_in_app(sub_teacher, kind, end, rendered)
            else:
                if EmailOptOut.objects.filter(user=sub_teacher).exists() or not sub_teacher.email:
                    log.status = SubscriptionReminderLog.Status.SKIPPED
                    log.detail = "opt-out or no email"
                    log.save(update_fields=["status", "detail"])
                    res[channel] = "skipped"
                    continue
                _send_email(sub_teacher.email, rendered)
            res[channel] = "sent"
        except Exception as exc:
            log.status = SubscriptionReminderLog.Status.FAILED
            log.detail = str(exc)[:255]
            log.save(update_fields=["status", "detail"])
            res[channel] = "failed"
            logger.exception("r50 reminder delivery failed teacher=%s kind=%s", sub_teacher.pk, kind)
    return res


def remember_expired(sub) -> None:
    """Перед переводом на «Старт» запоминаем прежний тариф — для письма «Подписка закончилась»."""
    from .models import SubscriptionReminderLog

    if not sub.expires_at or not sub.plan_id:
        return
    kind = "trial_end_meta" if is_r50_trial(sub) else ("free_premium_end_meta" if _audience(sub) == "free_premium" else "sub_end_meta")
    SubscriptionReminderLog.objects.get_or_create(
        teacher=sub.teacher, kind=kind, period_end=_local_date(sub.expires_at), channel="meta",
        defaults={"plan_slug": sub.plan.slug, "status": SubscriptionReminderLog.Status.SKIPPED, "detail": sub.plan.name},
    )


def process_r50_reminders(now=None, *, force: bool = False) -> dict:
    """Ежечасно из process_subscriptions. Без флага ничего не отправляет."""
    from .models import SubscriptionReminderLog, TariffPlan

    if not (force or reminders_enabled()):
        return {"enabled": False}
    now = now or timezone.now()
    today = _local_date(now)
    from collections import Counter

    stats = Counter()
    # r54: не пишем ночью — только 09:00–21:00 по местному времени (TIME_ZONE проекта)
    if not force and not (9 <= timezone.localtime(now).hour < 21):
        return {"enabled": True, "skipped": "quiet hours"}
    sent = 0
    for sub in candidate_subscriptions():
        if sub.auto_renew and (sub.tbank_rebill_id or "").strip():
            continue
        end = _local_date(sub.expires_at)
        audience = _audience(sub)
        # r54: только текущий этап, без догоняющих писем за пропущенные даты
        for kind in [k for k in [current_stage(sub, today)] if k]:
            args = dict(user=sub.teacher, kind=kind, plan_name=sub.plan.name, end_dt=sub.expires_at,
                        audience=audience, now=now, plan_slug=sub.plan.slug)
            res = _deliver(sub.teacher, kind, end, sub.plan.slug, None, render_args=args)
            for ch, st in res.items():
                stats[f"{kind}:{ch}:{st}"] += 1
            sent += 1
    # «Подписка закончилась»: по меткам remember_expired за сегодня/вчера, если не продлили.
    from .models import TeacherSubscription

    for meta in SubscriptionReminderLog.objects.filter(channel="meta", period_end__gte=today - timedelta(days=1)).select_related("teacher"):
        sub = TeacherSubscription.objects.select_related("plan").filter(teacher=meta.teacher).first()
        if not sub or (sub.plan.slug != "start" and sub.is_valid()):
            continue  # продлил — не пишем
        if sub.pk in EXCLUDED_SUBSCRIPTION_IDS or meta.teacher.is_superuser:
            continue
        kind = "trial_end" if meta.kind.startswith("trial") else "sub_end"
        audience = "trial" if kind == "trial_end" else ("free_premium" if meta.kind.startswith("free_premium") else "paid")
        end_dt = timezone.make_aware(datetime.combine(meta.period_end, time_cls(12, 0)))
        args = dict(user=meta.teacher, kind=kind, plan_name=meta.detail or PLAN_LABELS.get(meta.plan_slug, meta.plan_slug),
                    end_dt=end_dt, audience=audience, now=now, plan_slug=meta.plan_slug)
        res = _deliver(meta.teacher, kind, meta.period_end, meta.plan_slug, None, render_args=args)
        for ch, st in res.items():
            stats[f"{kind}:{ch}:{st}"] += 1
        sent += 1
    logger.info("r50 reminders run processed=%s stats=%s", sent, dict(stats))
    return {"enabled": True, "processed": sent, "stats": dict(stats)}


def send_test_reminders(to: str = TEST_EMAIL) -> list[str]:
    """Тестовая отправка всех шаблонов только на адрес владельца."""
    from django.contrib.auth.models import User

    if to.strip().lower() != TEST_EMAIL:
        raise ValueError("Тестовая отправка разрешена только на " + TEST_EMAIL)
    user = User(pk=0, username="Тест", first_name="Дарья", email=to)
    end = timezone.now() + timedelta(days=7)
    out = []
    for kind, aud, plan, slug, promo in (
        ("sub_7", "free_premium", "Премиум", "premium", False), ("sub_7", "free_premium", "Премиум", "premium", True),
        ("sub_3", "free_premium", "Премиум", "premium", False), ("sub_3", "free_premium", "Премиум", "premium", True),
        ("sub_end", "free_premium", "Премиум", "premium", False), ("sub_end", "free_premium", "Премиум", "premium", True),
        ("sub_7", "paid", "Профи", "pro", False), ("sub_3", "paid", "Премиум", "premium", False),
        ("trial_3", "trial", "Профи", "pro", False), ("trial_1", "trial", "Профи", "pro", False),
        ("trial_end", "trial", "Профи", "pro", False),
    ):
        r = render_reminder(user=user, kind=kind, plan_name=plan, end_dt=end, audience=aud, promo=promo, plan_slug=slug)
        tag = "РЕКЛАМНАЯ версия" if r["with_offer"] else "служебная версия"
        r = dict(r, subject=f"[ТЕСТ r52, {tag}] " + r["subject"])
        _send_email(to, r)
        out.append(r["subject"])
    return out


def r50_digest(token_seed: str) -> str:
    return hashlib.sha256(token_seed.encode()).hexdigest()[:32]
