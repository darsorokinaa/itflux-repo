"""
r62 (17.10.2026): разовые уведомления в кабинете (ТОЛЬКО in-app, без e-mail), одобрены владельцем.

* N1 — legacy «Премиум» (активный): за 3 календарных дня до окончания (или сразу, если осталось меньше).
* N2 — 3 старые платные подписки «Профи» (sub 165/178/268): сразу.

Отправка только 09:00–21:00 по Москве. Один раз на человека: запись в SubscriptionReminderLog
(kind=r62_n1 / r62_n2, channel=in_app, уникальный ключ) + Notification.event_key.
Рекламный абзац — только при действующем согласии MARKETING_CONSENT_V1 на канал inapp_marketing
(r52_consent.has_promo_consent). Запуск: manage.py send_r62_notifications [--dry-run] (cron, ежечасно).
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from django.db import IntegrityError, transaction
from django.utils import timezone

logger = logging.getLogger(__name__)

MSK = ZoneInfo("Europe/Moscow")
SEND_HOURS = (9, 21)  # [09:00, 21:00) МСК
N1_DAYS_BEFORE = 3
N2_SUB_IDS = (165, 178, 268)
N2_EXPECTED = {165: 231, 178: 257, 268: 426}
EXCLUDED_SUBSCRIPTION_IDS = {1}
EXCLUDED_USER_IDS = {2}

N1_URL = "https://itflux-academy.ru/pricing?utm_source=platform&utm_medium=notification&utm_campaign=tariffs_oct&utm_content=premium"
N2_URL = "https://itflux-academy.ru/pricing?utm_source=platform&utm_medium=notification&utm_campaign=tariffs_oct&utm_content=profi_old"

N1_TITLE = "Ваш «Премиум» заканчивается {date}"
N1_BUTTON = "Посмотреть тарифы"
N1_P1 = (
    "{greet} Это Дарья. Тарифа «Премиум» больше нет, а Ваш действует до {date}. После этого аккаунт перейдёт "
    "на бесплатный «Старт»: до 5 учеников, весь кабинет, банк ФИПИ, 10 вариантов в месяц и 30 токенов Цифрика. "
    "Все данные сохранятся, автосписаний нет."
)
N1_PROMO = (
    "Чтобы работать без ограничений, переходите на «Профи». Месяц стоит 1 990 ₽ вместо 2 990 ₽, а первый месяц "
    "по промокоду potok1110 стоит 995 ₽. Год стоит 16 716 ₽, а по промокоду potok1110y 10 029,60 ₽. "
    "Промокоды действуют до 30.11."
)

N2_TITLE = "„Профи“ теперь дешевле"
N2_BUTTON = "Продлить «Профи»"
N2_P1 = (
    "{greet} Это Дарья. {date} заканчивается Ваша подписка «Профи». Продлить её теперь можно дешевле: "
    "1 990 ₽ в месяц вместо 2 990 ₽, возможности те же."
)
N2_PROMO = (
    "Для Вас тоже действуют промокоды до 30.11: первый месяц по potok1110 стоит 995 ₽, год по potok1110y "
    "стоит 10 029,60 ₽ вместо 16 716 ₽."
)
N2_P3 = (
    "Автосписаний нет, продление вручную через Т-Банк. Если не продлевать, аккаунт перейдёт на бесплатный "
    "«Старт», данные сохранятся."
)
SIGNATURE = "Дарья, Цифровой поток."


def msk(dt):
    return dt.astimezone(MSK)


def fmt_date(dt) -> str:
    return msk(dt).strftime("%d.%m.%Y")


def greeting(user) -> str:
    name = (user.first_name or "").strip()
    return f"{name}, здравствуйте!" if name else "Здравствуйте!"


def in_send_window(now) -> bool:
    return SEND_HOURS[0] <= msk(now).hour < SEND_HOURS[1]


def next_window_start(now):
    local = msk(now)
    if local.hour < SEND_HOURS[0]:
        return local.replace(hour=SEND_HOURS[0], minute=0, second=0, microsecond=0)
    if local.hour >= SEND_HOURS[1]:
        return (local + timedelta(days=1)).replace(hour=SEND_HOURS[0], minute=0, second=0, microsecond=0)
    return local


def has_consent(user) -> bool:
    from .r52_consent import has_promo_consent

    return has_promo_consent(user, "inapp_marketing")


def render(which: str, user, end_dt, promo: bool) -> dict:
    d = fmt_date(end_dt)
    g = greeting(user)
    if which == "n1":
        paras = [N1_P1.format(greet=g, date=d)] + ([N1_PROMO] if promo else []) + [SIGNATURE]
        title, button, url = N1_TITLE.format(date=d), N1_BUTTON, N1_URL
    else:
        paras = [N2_P1.format(greet=g, date=d)] + ([N2_PROMO] if promo else []) + [N2_P3, SIGNATURE]
        title, button, url = N2_TITLE, N2_BUTTON, N2_URL
    # Колокольчик кабинета не рисует отдельную кнопку и открывает только относительные ссылки,
    # поэтому ссылка дублируется текстом в конце сообщения, а в payload — относительный путь.
    paras.append(f"{button}: {url}")
    return {
        "title": title,
        "message": "\n".join(paras),
        "button": button,
        "url": url,
        "rel_url": url.replace("https://itflux-academy.ru", ""),
        "version": "promo" if promo else "service",
    }


def _excluded(sub) -> bool:
    u = sub.teacher
    return bool(
        sub.pk in EXCLUDED_SUBSCRIPTION_IDS or u.pk in EXCLUDED_USER_IDS or u.is_staff or u.is_superuser
    )


def n1_subscriptions(now):
    from .models import TeacherSubscription

    qs = (
        TeacherSubscription.objects.select_related("plan", "teacher")
        .filter(plan__slug="premium", expires_at__gt=now,
                status__in=[TeacherSubscription.Status.ACTIVE, TeacherSubscription.Status.TRIAL])
        .order_by("expires_at", "pk")
    )
    return [s for s in qs if s.is_valid() and not _excluded(s)]


def n2_subscriptions(now):
    from .models import TeacherSubscription

    out = []
    for s in TeacherSubscription.objects.select_related("plan", "teacher").filter(pk__in=N2_SUB_IDS).order_by("pk"):
        if N2_EXPECTED.get(s.pk) != s.teacher_id or _excluded(s):
            continue
        if s.plan.slug != "pro" or not s.expires_at or s.expires_at <= now or not s.is_valid():
            continue
        out.append(s)
    return out


def due_at(which: str, sub, now):
    """Когда отправлять (МСК, aware). Окно 09–21 МСК."""
    if which == "n2":
        target = msk(now)
    else:
        day = msk(sub.expires_at).date() - timedelta(days=N1_DAYS_BEFORE)
        target = datetime(day.year, day.month, day.day, SEND_HOURS[0], 0, tzinfo=MSK)
        if target < msk(now):
            target = msk(now)
    return next_window_start(target)


def already_sent(which, sub):
    from .models import SubscriptionReminderLog

    return SubscriptionReminderLog.objects.filter(
        teacher_id=sub.teacher_id, kind=f"r62_{which}", channel="in_app"
    ).first()


def plan(now=None, only=("n1", "n2")) -> list[dict]:
    now = now or timezone.now()
    rows = []
    for which in only:
        subs = n1_subscriptions(now) if which == "n1" else n2_subscriptions(now)
        for s in subs:
            promo = has_consent(s.teacher)
            log = already_sent(which, s)
            when = due_at(which, s, now)
            if log:
                state = "already_sent"
            elif when <= msk(now) and in_send_window(now):
                state = "due_now"
            else:
                state = "scheduled"
            rows.append({
                "sub": s, "which": which, "user_id": s.teacher_id, "sub_id": s.pk,
                "end_date": fmt_date(s.expires_at), "consent": promo, "state": state,
                "due_at": when, "log": log,
            })
    return rows


def send_one(which, sub, now, promo) -> str:
    from .choices import NotificationChannel, NotificationStatus
    from .models import Notification, SubscriptionReminderLog
    from .r50_tariffs import _local_date

    r = render(which, sub.teacher, sub.expires_at, promo)
    end = _local_date(sub.expires_at)
    try:
        with transaction.atomic():
            log = SubscriptionReminderLog.objects.create(
                teacher=sub.teacher, kind=f"r62_{which}", period_end=end, channel="in_app",
                plan_slug=sub.plan.slug, status=SubscriptionReminderLog.Status.SENT,
                detail=f"r62 sub={sub.pk} {r['version']}",
            )
            note, created = Notification.objects.get_or_create(
                recipient_user=sub.teacher,
                channel=NotificationChannel.IN_APP,
                event_key=f"r62:{which}:{sub.pk}",
                defaults={
                    "recipient_teacher": sub.teacher,
                    "event_type": f"subscription_r62_{which}",
                    "title": r["title"][:255],
                    "message": r["message"],
                    "status": NotificationStatus.SENT,
                    "sent_at": now,
                    "payload": {
                        "type": f"subscription_r62_{which}", "link": r["rel_url"], "url": r["rel_url"],
                        "button": r["button"], "button_url": r["url"], "version": r["version"],
                        "sub_id": sub.pk,
                    },
                },
            )
            if not created:
                log.detail = f"r62 sub={sub.pk} notification existed id={note.pk}"
                log.save(update_fields=["detail"])
    except IntegrityError:
        return "duplicate"
    logger.info("r62_notification_sent which=%s sub=%s user=%s version=%s", which, sub.pk, sub.teacher_id, r["version"])
    return "sent"


def run(now=None, *, dry_run=False, only=("n1", "n2")) -> dict:
    from collections import Counter

    now = now or timezone.now()
    rows = plan(now, only)
    stats = Counter()
    for row in rows:
        if row["state"] == "due_now" and not dry_run:
            row["result"] = send_one(row["which"], row["sub"], now, row["consent"])
        else:
            row["result"] = row["state"]
        stats[f"{row['which']}:{row['result']}"] += 1
    return {"now_msk": msk(now).isoformat(timespec="minutes"), "in_window": in_send_window(now),
            "dry_run": dry_run, "stats": dict(stats), "rows": rows}
