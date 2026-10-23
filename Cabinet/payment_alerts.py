"""r101: алерты по оплатам.

Канал:
* logger.error("payment_alert kind=... ") — попадает в journald/лог приложения (как остальные ERROR);
* счётчик в кэше (Redis на проде): payment_alert:<kind>:<YYYY-MM-DD>, хранится 35 дней —
  смотреть командой ``manage.py payment_alerts_report [--days N]``;
* Telegram администратору (send_telegram_message → TELEGRAM_CHAT_ID), только если
  PAYMENT_ALERTS_TELEGRAM=1, не чаще 1 сообщения на kind в час (троттлинг в кэше).
Никаких ПДн/секретов в тексте: только id платежа, статусы и коды.
"""
from __future__ import annotations

import logging
from datetime import timedelta

from django.conf import settings
from django.core.cache import cache
from django.utils import timezone

logger = logging.getLogger("Cabinet.payments.alerts")

KINDS = ("webhook_rejected", "webhook_error", "confirmed_without_webhook", "init_failed")
TTL = 35 * 24 * 3600


def _key(kind: str, day) -> str:
    return f"payment_alert:{kind}:{day.isoformat()}"


def _truthy(v) -> bool:
    return str(v or "").strip().lower() in ("1", "true", "yes", "on")


def record_alert(kind: str, **ctx) -> None:
    safe = " ".join(f"{k}={str(v)[:120]}" for k, v in sorted(ctx.items()))
    logger.error("payment_alert kind=%s %s", kind, safe)
    try:
        key = _key(kind, timezone.localdate())
        if not cache.add(key, 1, TTL):
            cache.incr(key)
    except Exception:  # кэш недоступен — лог уже есть
        logger.warning("payment_alert counter failed kind=%s", kind)
    if not _truthy(getattr(settings, "PAYMENT_ALERTS_TELEGRAM", "")):
        return
    try:
        if not cache.add(f"payment_alert_tg:{kind}", 1, 3600):
            return
        from Generator.telegram_utils import escape_telegram_html, send_telegram_message

        send_telegram_message(escape_telegram_html(f"⚠️ Оплаты: {kind}\n{safe}"))
    except Exception:
        logger.exception("payment_alert telegram failed kind=%s", kind)


def counters(days: int = 7) -> dict:
    today = timezone.localdate()
    out = {}
    for i in range(days):
        day = today - timedelta(days=i)
        for kind in KINDS:
            try:
                n = cache.get(_key(kind, day)) or 0
            except Exception:
                n = 0
            if n:
                out.setdefault(day.isoformat(), {})[kind] = int(n)
    return out
