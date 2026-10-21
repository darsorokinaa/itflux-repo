"""Разовые всплывающие окна в кабинете (А — «Премиум» заканчивается, Б — оплата не завершилась,
В — спасибо «Профи»). Тексты одобрены владелицей 21.10.2026. Без промокодов: согласия на рекламу
в кабинете у адресатов нет.

* Одно окно на человека: приоритет В (30) > Б (20) > А (10). Остальные сообщения — в колокольчик.
* Показ один раз: shown_at/closed_at на сервере (OneShotPopup), повтор на других устройствах исключён.
* Текст с датой рендерится при выдаче: «через N дней / завтра / сегодня», «Сегодня заканчивается / Закончилась».
* Письмо (Б, одному человеку с действующим согласием на e-mail рекламу) — строго один раз:
  запись SubscriptionReminderLog(kind=oneshot_b_email, channel=email) создаётся до отправки.
"""

from __future__ import annotations

import logging
import re
from datetime import date, datetime, timedelta
from html import escape
from zoneinfo import ZoneInfo

from django.conf import settings
from django.db import IntegrityError, connection, transaction
from django.utils import timezone

logger = logging.getLogger(__name__)

MSK = ZoneInfo("Europe/Moscow")
SIGNATURE = "Дарья, «Цифровой поток»"
PRICING_PATH = "/pricing"
PRICING_URL = "https://itflux-academy.ru/pricing"
SUPPORT_EMAIL = "itflux.academy@yandex.ru"

PRIORITY = {"pro_thanks": 30, "payment_unfinished": 20, "premium_end": 10}

# Группа В: подписки «Профи», заканчивающиеся 21.10.2026 (получили r62 N2).
PRO_THANKS_PERIOD_END = date(2026, 10, 21)
B_EMAIL_KIND = "oneshot_b_email"
B_EMAIL_PERIOD = date(2026, 10, 21)  # ключ идемпотентности письма (одно письмо на человека)

A_TITLE = "{when} заканчивается бесплатный «Премиум»"
A_TEXT = (
    "Здравствуйте! {when} закончится бесплатный доступ к «Премиуму» на платформе «Цифровой поток». "
    "Ваши ученики, уроки, задания и журнал сохранятся. На тарифе «Старт» будут доступны до 5 учеников, "
    "10 вариантов и 3 рабочие тетради в месяц, без интерактивов и расширенной библиотеки материалов. "
    "Тарифы и условия — на странице тарифов."
)
A_BUTTON = "Тарифы"

B_TITLE = "Оплата не завершилась"
B_TEXT = (
    "Здравствуйте! Вы начинали оформлять подписку на «Цифровом потоке», но оплата не прошла. "
    f"Если что-то не получилось, напишите на {SUPPORT_EMAIL} — я помогу."
)
B_BUTTON = "Перейти к тарифам"
B_EMAIL_PROMO = (
    "Если захотите попробовать ещё раз — промокод potok1110: −50% на первый месяц «Профи» (995 ₽), "
    "действует до 30 ноября."
)

C_TITLE = "Спасибо, что работаете с «Цифровым потоком»"
C_TEXT = (
    "Здравствуйте! {when} Ваша подписка «Профи». Спасибо, что были с платформой с самого начала! "
    "Ученики, уроки и задания сохранятся. Если что-то было неудобно — напишите на "
    f"{SUPPORT_EMAIL}, каждое замечание передаю в работу."
)
C_BUTTON = "Продлить «Профи»"

_TEST_RE = re.compile(r"(test|тест|demo|qa|e2e|smoke|example)", re.I)
_TEST_EMAIL_RE = re.compile(r"(test|тест|demo|e2e|example\.|mailinator|@itflux|itflux\.academy)", re.I)


# ── общие проверки ─────────────────────────────────────────────────────────

def msk_date(dt) -> date:
    return dt.astimezone(MSK).date()


def is_service_account(user) -> bool:
    """Служебные и тестовые аккаунты (те же правила, что в отчётах 21.10)."""
    from .r62_notifications import EXCLUDED_USER_IDS

    if not user or user.pk in EXCLUDED_USER_IDS or user.is_staff or user.is_superuser:
        return True
    email = (user.email or "").strip()
    if email.lower() == SUPPORT_EMAIL:
        return True
    return bool(_TEST_RE.search(user.username or "") or _TEST_EMAIL_RE.search(email))


def is_teacher(user) -> bool:
    from .models import Profile

    return bool(getattr(user, "pk", None)) and Profile.objects.filter(user_id=user.pk, role="teacher").exists()


def table_ready() -> bool:
    from .models import OneShotPopup

    return OneShotPopup._meta.db_table in connection.introspection.table_names()


def plural_days(n: int) -> str:
    n10, n100 = n % 10, n % 100
    if n10 == 1 and n100 != 11:
        return "день"
    if 2 <= n10 <= 4 and not 12 <= n100 <= 14:
        return "дня"
    return "дней"


def premium_when(end_dt, now) -> str | None:
    """«Через N дней» / «Завтра» / «Сегодня»; None — уже закончилось."""
    if end_dt <= now:
        return None
    n = (msk_date(end_dt) - msk_date(now)).days
    if n <= 0:
        return "Сегодня"
    if n == 1:
        return "Завтра"
    return f"Через {n} {plural_days(n)}"


# ── рендер ─────────────────────────────────────────────────────────────────

def render(kind: str, context: dict, now=None) -> dict | None:
    """Заголовок и текст на момент показа. None — окно больше неактуально."""
    now = now or timezone.now()
    if kind == "premium_end":
        end = datetime.fromisoformat(context["expires_at"])
        when = premium_when(end, now)
        if when is None:
            return None
        return {"title": A_TITLE.format(when=when), "message": A_TEXT.format(when=when)}
    if kind == "payment_unfinished":
        return {"title": B_TITLE, "message": B_TEXT}
    if kind == "pro_thanks":
        end = date.fromisoformat(context["period_end"])
        when = "Сегодня заканчивается" if msk_date(now) <= end else "Закончилась"
        return {"title": C_TITLE, "message": C_TEXT.format(when=when)}
    raise ValueError(kind)


def still_relevant(popup, now=None) -> bool:
    """Проверка перед показом: подписка не закончилась / не продлена / оплата не прошла."""
    from .models import Payment, TeacherSubscription

    now = now or timezone.now()
    if popup.show_until and popup.show_until <= now:
        return False
    ctx = popup.context or {}
    if popup.kind == "premium_end":
        sub = TeacherSubscription.objects.select_related("plan").filter(teacher_id=popup.user_id).first()
        return bool(
            sub and sub.plan.slug == "premium" and sub.expires_at and sub.expires_at > now
            and sub.expires_at.isoformat() == ctx.get("expires_at")
        )
    if popup.kind == "payment_unfinished":
        since = ctx.get("last_pending_at")
        qs = Payment.objects.filter(teacher_id=popup.user_id, status=Payment.Status.PAID)
        if since:
            qs = qs.filter(created_at__gt=datetime.fromisoformat(since))
        return not qs.exists()
    if popup.kind == "pro_thanks":
        # продлил «Профи» на новый период — благодарность за окончание уже не к месту
        sub = TeacherSubscription.objects.select_related("plan").filter(teacher_id=popup.user_id).first()
        end = date.fromisoformat(ctx["period_end"])
        return not (sub and sub.plan.slug == "pro" and sub.is_valid() and sub.expires_at and msk_date(sub.expires_at) > end)
    return True


def payload(popup, now=None) -> dict | None:
    r = render(popup.kind, popup.context or {}, now)
    if r is None:
        return None
    return {
        "id": popup.pk, "kind": popup.kind, "title": r["title"], "message": r["message"],
        "signature": SIGNATURE, "button_label": popup.button_label, "button_url": popup.button_url,
        "close_label": "Закрыть",
    }


# ── выдача и закрытие (API) ────────────────────────────────────────────────

def next_popup(user, now=None):
    """Одно ожидающее окно с наибольшим приоритетом; неактуальные помечаются expired."""
    from .models import OneShotPopup

    now = now or timezone.now()
    if not is_teacher(user):
        return None
    for p in OneShotPopup.objects.filter(user=user, status=OneShotPopup.Status.PENDING).order_by("-priority", "pk"):
        data = payload(p, now) if still_relevant(p, now) else None
        if data is None:
            OneShotPopup.objects.filter(pk=p.pk, status=OneShotPopup.Status.PENDING).update(
                status=OneShotPopup.Status.EXPIRED, updated_at=now
            )
            continue
        return data
    return None


def mark_shown(user, popup_id, now=None) -> bool:
    from .models import OneShotPopup

    now = now or timezone.now()
    return bool(OneShotPopup.objects.filter(pk=popup_id, user=user, status=OneShotPopup.Status.PENDING).update(
        status=OneShotPopup.Status.SHOWN, shown_at=now, updated_at=now
    ))


def mark_closed(user, popup_id, action: str = "close", now=None) -> bool:
    from .models import OneShotPopup

    now = now or timezone.now()
    action = action if action in ("close", "button") else "close"
    p = OneShotPopup.objects.filter(pk=popup_id, user=user).first()
    if not p or p.closed_at:
        return False
    p.status = OneShotPopup.Status.CLOSED
    p.closed_at = now
    p.shown_at = p.shown_at or now
    p.close_action = action
    p.save(update_fields=["status", "closed_at", "shown_at", "close_action", "updated_at"])
    return True


# ── создание: одно окно на человека, остальное — в колокольчик ─────────────

def _bell(user, kind, key, button_label, button_url, context, now):
    from .choices import NotificationChannel, NotificationStatus
    from .models import Notification

    r = render(kind, context, now)
    if r is None:
        return "skip_expired"
    message = "\n".join([r["message"], SIGNATURE, f"{button_label}: {button_url}"])
    _, created = Notification.objects.get_or_create(
        recipient_user=user, channel=NotificationChannel.IN_APP, event_key=f"oneshot:{key}",
        defaults={
            "recipient_teacher": user, "event_type": f"oneshot_{kind}", "title": r["title"][:255],
            "message": message, "status": NotificationStatus.SENT, "sent_at": now,
            "payload": {"type": f"oneshot_{kind}", "link": button_url, "url": button_url, "button": button_label},
        },
    )
    return "bell" if created else "bell_exists"


def place(user, kind: str, key: str, context: dict, *, button_label: str, button_url: str = PRICING_PATH,
          show_until=None, now=None, dry_run: bool = False, existing=None) -> str:
    """Создаёт окно или (если у человека уже есть окно равного/высшего приоритета) — запись в колокольчике.

    Возвращает: popup / exists / bell / bell_exists / superseded+popup / skip_expired.
    existing — список (priority, status, key) для dry-run без таблицы.
    """
    from .models import OneShotPopup

    now = now or timezone.now()
    prio = PRIORITY[kind]
    if existing is None:
        existing = list(OneShotPopup.objects.filter(user=user).exclude(
            status=OneShotPopup.Status.SUPERSEDED).values_list("priority", "status", "key"))
    if any(k == key for _, _, k in existing):
        return "exists"
    if render(kind, context, now) is None:
        return "skip_expired"
    active = [(p, s, k) for p, s, k in existing if s != OneShotPopup.Status.EXPIRED]
    blocker = [e for e in active if e[0] >= prio or e[1] != OneShotPopup.Status.PENDING]
    if blocker:
        return "bell" if dry_run else _bell(user, kind, key, button_label, button_url, context, now)
    lower_pending = [e for e in active if e[0] < prio and e[1] == OneShotPopup.Status.PENDING]
    if dry_run:
        existing.append((prio, OneShotPopup.Status.PENDING, key))
        return "superseded+popup" if lower_pending else "popup"
    with transaction.atomic():
        for old in OneShotPopup.objects.select_for_update().filter(
            user=user, status=OneShotPopup.Status.PENDING, priority__lt=prio
        ):
            old.status = OneShotPopup.Status.SUPERSEDED
            old.save(update_fields=["status", "updated_at"])
            _bell(user, old.kind, old.key, old.button_label, old.button_url, old.context, now)
        try:
            with transaction.atomic():
                OneShotPopup.objects.create(
                    user=user, key=key, kind=kind, priority=prio, button_label=button_label,
                    button_url=button_url, context=context, show_until=show_until,
                )
        except IntegrityError:
            return "exists"
    return "superseded+popup" if lower_pending else "popup"


# ── группа А (из r62 N1) ───────────────────────────────────────────────────

def premium_popup_eligible(sub, now=None) -> bool:
    now = now or timezone.now()
    return bool(
        sub.plan.slug == "premium" and sub.expires_at and sub.expires_at > now
        and not (sub.scheduled_plan_id and getattr(sub.scheduled_plan, "slug", "") == "pro")
        and not is_service_account(sub.teacher)
    )


def place_premium(sub, now=None, dry_run=False, existing=None) -> str:
    now = now or timezone.now()
    if not premium_popup_eligible(sub, now):
        return "not_eligible"
    ctx = {"expires_at": sub.expires_at.isoformat(), "sub_id": sub.pk}
    key = f"premium_end:{sub.pk}:{msk_date(sub.expires_at).isoformat()}"
    return place(sub.teacher, "premium_end", key, ctx, button_label=A_BUTTON, show_until=sub.expires_at,
                 now=now, dry_run=dry_run, existing=existing)


# ── группы Б и В ───────────────────────────────────────────────────────────

def group_c(now=None):
    """В: получили r62 N2 по «Профи», который заканчивается 21.10.2026."""
    from django.contrib.auth.models import User

    from .models import SubscriptionReminderLog

    ids = SubscriptionReminderLog.objects.filter(
        kind="r62_n2", channel="in_app", status=SubscriptionReminderLog.Status.SENT, period_end=PRO_THANKS_PERIOD_END
    ).values_list("teacher_id", flat=True)
    return [u for u in User.objects.filter(pk__in=set(ids)).select_related("profile").order_by("pk") if not is_service_account(u)]


def group_b(now=None):
    """Б: есть pending-платёж и после последнего pending не было успешной оплаты."""
    from django.contrib.auth.models import User

    from .models import Payment

    now = now or timezone.now()
    last = {}
    for tid, created in Payment.objects.filter(status=Payment.Status.PENDING, created_at__lte=now).values_list(
        "teacher_id", "created_at"
    ):
        if tid not in last or created > last[tid]:
            last[tid] = created
    out = []
    for u in User.objects.filter(pk__in=list(last)).select_related("profile").order_by("pk"):
        if is_service_account(u):
            continue
        if Payment.objects.filter(teacher=u, status=Payment.Status.PAID, created_at__gt=last[u.pk]).exists():
            continue
        out.append((u, last[u.pk]))
    return out


def render_b_email(user) -> dict:
    from .r52_consent import make_marketing_unsubscribe_link

    unsub = make_marketing_unsubscribe_link(user)
    paras = [B_TEXT, B_EMAIL_PROMO]
    text = "\n\n".join(paras) + f"\n\nТарифы: {PRICING_URL}\n\n{SIGNATURE}\n\n—\n«Цифровой поток», itflux-academy.ru\n"
    text += f"Отписаться от рекламных писем (акции и промокоды): {unsub}\n"
    html = "".join(f"<p>{escape(p)}</p>" for p in paras)
    html += (
        f'<p><a href="{PRICING_URL}" style="display:inline-block;padding:12px 22px;background:#4f46e5;'
        f'color:#fff;border-radius:10px;text-decoration:none;font-weight:600">Тарифы</a></p>'
        f"<p>{escape(SIGNATURE)}</p>"
        '<hr><p style="color:#888;font-size:12px">«Цифровой поток», itflux-academy.ru<br>'
        f'<a href="{unsub}" style="color:#888">Отписаться от рекламных писем (акции и промокоды)</a></p>'
    )
    return {"subject": B_TITLE, "text": text, "html": html, "unsubscribe": unsub}


def send_b_email(user, now=None, dry_run=False, retry_failed=False) -> str:
    """Одно письмо, строго один раз (журнал создаётся до отправки)."""
    from django.core.mail import EmailMultiAlternatives

    from .models import EmailOptOut, SubscriptionReminderLog
    from .r52_consent import has_promo_consent

    if not has_promo_consent(user, "email_marketing"):
        return "no_consent"
    if not user.email or EmailOptOut.objects.filter(user=user).exists():
        return "no_email_or_optout"
    prev = SubscriptionReminderLog.objects.filter(
        teacher=user, kind=B_EMAIL_KIND, period_end=B_EMAIL_PERIOD, channel="email"
    ).first()
    if prev and not (retry_failed and prev.status == SubscriptionReminderLog.Status.FAILED):
        return f"already_{prev.status}"
    if dry_run:
        return "email_would_send"
    rendered = render_b_email(user)
    try:
        with transaction.atomic():
            if prev:
                log = SubscriptionReminderLog.objects.select_for_update().get(pk=prev.pk)
                if log.status != SubscriptionReminderLog.Status.FAILED:
                    return f"already_{log.status}"
                log.status = SubscriptionReminderLog.Status.SENT
                log.detail = "oneshot B email retry"
                log.save(update_fields=["status", "detail"])
            else:
                log = SubscriptionReminderLog.objects.create(
                    teacher=user, kind=B_EMAIL_KIND, period_end=B_EMAIL_PERIOD, channel="email",
                    plan_slug="pro", status=SubscriptionReminderLog.Status.SENT, detail="oneshot B email promo",
                )
    except IntegrityError:
        return "duplicate"
    try:
        msg = EmailMultiAlternatives(
            subject=rendered["subject"], body=rendered["text"],
            from_email=getattr(settings, "DEFAULT_FROM_EMAIL", None), to=[user.email],
            headers={"List-Unsubscribe": f"<{rendered['unsubscribe']}>"},
        )
        msg.attach_alternative(rendered["html"], "text/html")
        msg.send(fail_silently=False)
    except Exception as exc:  # noqa: BLE001
        log.status = SubscriptionReminderLog.Status.FAILED
        log.detail = str(exc)[:255]
        log.save(update_fields=["status", "detail"])
        logger.exception("oneshot B email failed user=%s", user.pk)
        return "email_failed"
    return "email_sent"


def run(now=None, *, dry_run=False, retry_failed=False) -> dict:
    """Б и В после выкладки + догоняющие окна А для тех, кому r62 N1 уже пришло."""
    from collections import Counter

    from .models import OneShotPopup, TeacherSubscription
    from .r62_notifications import already_sent, n1_subscriptions

    now = now or timezone.now()
    have_table = table_ready()
    if not dry_run and not have_table:
        raise RuntimeError("Таблица OneShotPopup не создана: сначала migrate Cabinet")
    sim = {}  # dry-run: состояние окон по пользователю

    def existing_for(user):
        if not dry_run:
            return None
        if user.pk not in sim:
            sim[user.pk] = list(OneShotPopup.objects.filter(user=user).exclude(
                status=OneShotPopup.Status.SUPERSEDED).values_list("priority", "status", "key")) if have_table else []
        return sim[user.pk]

    stats = Counter()
    c_users = group_c(now)
    stats["C_people"] = len(c_users)
    for u in c_users:
        ctx = {"period_end": PRO_THANKS_PERIOD_END.isoformat()}
        res = place(u, "pro_thanks", f"pro_thanks:{PRO_THANKS_PERIOD_END.isoformat()}", ctx,
                    button_label=C_BUTTON, now=now, dry_run=dry_run, existing=existing_for(u))
        stats[f"C:{res}"] += 1

    b_rows = group_b(now)
    stats["B_people"] = len(b_rows)
    from .r52_consent import has_promo_consent

    for u, last_pending in b_rows:
        if has_promo_consent(u, "email_marketing"):
            stats[f"B:{send_b_email(u, now, dry_run=dry_run, retry_failed=retry_failed)}"] += 1
            continue
        ctx = {"last_pending_at": last_pending.isoformat()}
        res = place(u, "payment_unfinished", "payment_unfinished:2026-10", ctx, button_label=B_BUTTON,
                    now=now, dry_run=dry_run, existing=existing_for(u))
        stats[f"B:{res}"] += 1

    # А: сейчас окна создаются только тем, кому r62 N1 уже ушло; остальным — r62 в свой срок.
    a_total = 0
    a_by_horizon = Counter()
    limit = datetime(2026, 11, 17, 23, 59, 59, tzinfo=MSK)
    for sub in n1_subscriptions(now):
        if not premium_popup_eligible(sub, now) or sub.expires_at > limit:
            continue
        a_total += 1
        days = (msk_date(sub.expires_at) - msk_date(now)).days
        a_by_horizon["<3d" if days < 3 else ">=3d"] += 1
        if already_sent("n1", sub):
            stats[f"A_backfill:{place_premium(sub, now, dry_run=dry_run, existing=existing_for(sub.teacher))}"] += 1
        else:
            stats["A_scheduled_with_r62"] += 1
    stats["A_people"] = a_total
    stats["A_scheduled_pro_excluded"] = TeacherSubscription.objects.filter(
        plan__slug="premium", scheduled_plan__slug="pro", expires_at__gt=now
    ).count()
    return {"now_msk": now.astimezone(MSK).isoformat(timespec="minutes"), "dry_run": dry_run,
            "table_ready": have_table, "stats": dict(sorted(stats.items())), "a_by_horizon": dict(a_by_horizon)}
