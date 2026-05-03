"""
Утилита для отправки сообщений в Telegram через Bot API.
"""
import json
import logging
import os
import urllib.error
import urllib.parse
import urllib.request

logger = logging.getLogger(__name__)

# Обход прокси для api.telegram.org (403 при использовании HTTP_PROXY/HTTPS_PROXY)
_NO_PROXY_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def send_telegram_message(
    text: str,
    bot_token: str | None = None,
    chat_id: str | list | None = None,
    message_thread_id: int | None = None,
) -> bool:
    """
    Отправляет сообщение в Telegram одному или нескольким получателям.

    Args:
        text: Текст сообщения (HTML).
        bot_token: Токен бота. Если None — из settings.
        chat_id: ID чата или список ID. Группа — отрицательное число (напр. -1001234567890).
                 Если None — из settings (TELEGRAM_CHAT_ID, через запятую).
        message_thread_id: ID топика в чате (для групп с темами). Если None — из settings.

    Returns:
        True если хотя бы одному доставлено, иначе False.
    """
    from django.conf import settings

    token = bot_token or getattr(settings, "TELEGRAM_BOT_TOKEN", None)
    if not token:
        logger.warning("Telegram: TELEGRAM_BOT_TOKEN не задан")
        return False

    raw = chat_id if chat_id is not None else getattr(settings, "TELEGRAM_CHAT_ID", None)
    if not raw:
        logger.warning("Telegram: TELEGRAM_CHAT_ID не задан")
        return False

    thread_id = message_thread_id
    if thread_id is None:
        raw_thread = (
            getattr(settings, "TELEGRAM_TOPIC_ID", None)
            or os.environ.get("TELEGRAM_TOPIC_ID")
        )
        if raw_thread:
            try:
                thread_id = int(str(raw_thread).strip())
            except (ValueError, TypeError):
                logger.warning("Telegram: неверный TELEGRAM_TOPIC_ID=%r, отправка в общий чат", raw_thread)
                thread_id = None

    ids = [str(x).strip() for x in (raw.split(",") if isinstance(raw, str) else raw) if str(x).strip()]
    if not ids:
        logger.warning("Telegram: нет получателей")
        return False

    url = f"https://api.telegram.org/bot{token}/sendMessage"

    def _send(cid: str, use_thread: bool) -> bool:
        data = {
            "chat_id": cid,
            "text": text,
            "parse_mode": "HTML",
            "disable_web_page_preview": True,
        }
        if use_thread and thread_id is not None:
            data["message_thread_id"] = thread_id
        try:
            body = urllib.parse.urlencode(data).encode("utf-8")
            req = urllib.request.Request(url, data=body, method="POST")
            req.add_header("Content-Type", "application/x-www-form-urlencoded")
            # Используем opener без прокси — иначе 403 через HTTP_PROXY/HTTPS_PROXY
            with _NO_PROXY_OPENER.open(req, timeout=15) as resp:
                result = json.loads(resp.read().decode())
                if result.get("ok"):
                    return True
                logger.error(
                    "Telegram API error chat_id=%s: %s (%s)",
                    cid,
                    result.get("error_code"),
                    result.get("description", ""),
                )
                return False
        except urllib.error.HTTPError as e:
            try:
                err_body = e.read().decode()
                err_data = json.loads(err_body) if err_body else {}
                desc = err_data.get("description", err_body[:200])
                logger.error("Telegram HTTP error chat_id=%s status=%s: %s", cid, e.code, desc)
                if "message thread" in desc.lower() or "topics" in desc.lower():
                    return False
            except Exception:
                pass
            logger.exception("Telegram send to %s failed", cid)
            return False
        except (urllib.error.URLError, OSError, json.JSONDecodeError) as e:
            logger.exception("Telegram send to %s failed: %s", cid, e)
            return False

    success = False
    for cid in ids:
        if _send(cid, use_thread=True):
            success = True
        elif thread_id is not None and _send(cid, use_thread=False):
            logger.info("Telegram: отправлено в общий чат (топик недоступен)")
            success = True
    return success
