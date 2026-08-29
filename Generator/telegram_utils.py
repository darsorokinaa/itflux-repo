"""
Утилита для отправки сообщений в Telegram через Bot API.
"""
import html
import json
import logging
import os
import urllib.error
import urllib.parse
import urllib.request

logger = logging.getLogger(__name__)

# Обход прокси для api.telegram.org (403 при использовании HTTP_PROXY/HTTPS_PROXY)
_NO_PROXY_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def escape_telegram_html(text: str) -> str:
    """Экранирование пользовательского текста для parse_mode=HTML."""
    return html.escape(str(text or ""), quote=False)


def send_telegram_message(
    text: str,
    bot_token: str | None = None,
    chat_id: str | list | None = None,
    message_thread_id: int | None = None,
    *,
    parse_mode: str | None = "HTML",
    reply_markup: dict | None = None,
) -> bool:
    """
    Отправляет сообщение в Telegram одному или нескольким получателям.

    Args:
        text: Текст сообщения (HTML при parse_mode=HTML).
        bot_token: Токен бота. Если None — из settings.
        chat_id: ID чата или список ID. Группа — отрицательное число (напр. -1001234567890).
                 Если None — из settings (TELEGRAM_CHAT_ID, через запятую).
        message_thread_id: ID топика в чате (для групп с темами). Если None — из settings.
        parse_mode: HTML по умолчанию; при ошибке разбора повторяем без parse_mode.
        reply_markup: ReplyKeyboardMarkup или InlineKeyboardMarkup (словарь Bot API).

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
        logger.warning("Telegram: chat_id / TELEGRAM_CHAT_ID не задан")
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

    def _is_private_chat(cid: str) -> bool:
        try:
            return int(cid) > 0
        except (TypeError, ValueError):
            return False

    def _send(cid: str, use_thread: bool, mode: str | None) -> bool:
        data = {
            "chat_id": cid,
            "text": text,
            "disable_web_page_preview": True,
        }
        if mode:
            data["parse_mode"] = mode
        if reply_markup:
            data["reply_markup"] = reply_markup
        if use_thread and thread_id is not None:
            data["message_thread_id"] = thread_id
        try:
            body = json.dumps(data, ensure_ascii=False).encode("utf-8")
            req = urllib.request.Request(url, data=body, method="POST")
            req.add_header("Content-Type", "application/json")
            with _NO_PROXY_OPENER.open(req, timeout=15) as resp:
                result = json.loads(resp.read().decode())
                if result.get("ok"):
                    return True
                desc = str(result.get("description", ""))
                logger.error(
                    "Telegram API error chat_id=%s: %s (%s)",
                    cid,
                    result.get("error_code"),
                    desc,
                )
                if mode and "parse" in desc.lower():
                    return _send(cid, use_thread=use_thread, mode=None)
                return False
        except urllib.error.HTTPError as e:
            try:
                err_body = e.read().decode()
                err_data = json.loads(err_body) if err_body else {}
                desc = err_data.get("description", err_body[:200])
                logger.error("Telegram HTTP error chat_id=%s status=%s: %s", cid, e.code, desc)
                if mode and "parse" in str(desc).lower():
                    return _send(cid, use_thread=use_thread, mode=None)
                if "message thread" in str(desc).lower() or "topics" in str(desc).lower():
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
        if _is_private_chat(cid):
            if _send(cid, use_thread=False, mode=parse_mode):
                success = True
            continue
        if _send(cid, use_thread=True, mode=parse_mode):
            success = True
        elif thread_id is not None and _send(cid, use_thread=False, mode=parse_mode):
            logger.info("Telegram: отправлено в общий чат (топик недоступен)")
            success = True
    return success


def answer_telegram_callback_query(
    callback_query_id: str,
    text: str = "",
    bot_token: str | None = None,
) -> bool:
    """Закрывает крутилку на inline-кнопке."""
    from django.conf import settings

    token = bot_token or getattr(settings, "TELEGRAM_BOT_TOKEN", None)
    if not token or not callback_query_id:
        return False
    url = f"https://api.telegram.org/bot{token}/answerCallbackQuery"
    data = {"callback_query_id": str(callback_query_id)}
    if text:
        data["text"] = text[:200]
    try:
        body = urllib.parse.urlencode(data).encode("utf-8")
        req = urllib.request.Request(url, data=body, method="POST")
        req.add_header("Content-Type", "application/x-www-form-urlencoded")
        with _NO_PROXY_OPENER.open(req, timeout=10) as resp:
            result = json.loads(resp.read().decode())
            return bool(result.get("ok"))
    except (urllib.error.URLError, OSError, json.JSONDecodeError):
        logger.exception("Telegram answerCallbackQuery failed")
        return False
