"""Публичная заявка на диагностику академии: проверка, хранение, письмо."""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import re

from django.conf import settings
from django.db import transaction
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.http import require_http_methods

from Cabinet.rate_limit import client_ip, rate_limit_check, rate_limit_json_response

from .academy_consent import ACADEMY_CONSENT_VERSION
from .academy_models import AcademyLead

logger = logging.getLogger(__name__)

# Текст галочки и полная формулировка версии — Cabinet.academy_consent.
ACADEMY_NOTIFY_EMAIL = "itflux.academy@yandex.com"
ACADEMY_SUCCESS_MESSAGE = (
    "Заявка принята. Я свяжусь с вами, чтобы выбрать время диагностики "
    "и рассказать, как подключиться к платформе."
)
ACADEMY_RATE_LIMIT = 8
ACADEMY_RATE_WINDOW_SEC = 3600

_TELEGRAM_NAME = r"[A-Za-z][A-Za-z0-9_]{4,31}"
_TELEGRAM_RE = re.compile(rf"^@({_TELEGRAM_NAME})$")
_TELEGRAM_LINK_RE = re.compile(
    rf"^(?:https?://)?(?:t\.me|telegram\.me)/({_TELEGRAM_NAME})/?$",
    re.IGNORECASE,
)
_UTM_LIMITS = {
    "utm_source": 32,
    "utm_medium": 32,
    "utm_campaign": 64,
    "utm_content": 64,
    "utm_term": 64,
}
_SUBJECTS = {choice.value for choice in AcademyLead.Subject}
_EGE_SUBJECTS = {AcademyLead.Subject.EGE_INF}
_MISMATCH = "Для 9 класса доступен ОГЭ по информатике, для 10–11 классов — ЕГЭ."


def hash_client_ip(ip: str) -> str:
    raw = (ip or "").strip()
    if not raw or raw == "unknown":
        return ""
    key = (settings.SECRET_KEY or "").encode("utf-8")
    return hmac.new(key, b"academy-lead-ip:" + raw.encode("utf-8"), hashlib.sha256).hexdigest()


def _clip(value, limit: int) -> str:
    text = str(value or "").replace("\x00", "").strip()
    return text[:limit]


def _telegram_ok(value: str) -> bool:
    return bool(_TELEGRAM_RE.match(value) or _TELEGRAM_LINK_RE.match(value))


def _phone_ok(value: str) -> bool:
    if re.search(r"[A-Za-zА-Яа-яЁё]", value):
        return False
    digits = re.sub(r"\D", "", value)
    if len(digits) == 11 and digits[0] in "78":
        return True
    if len(digits) == 10 and digits[0] != "0":
        return True
    return bool(value.strip().startswith("+") and 11 <= len(digits) <= 15)


def _contact_error(value: str) -> str:
    if not value:
        return "Укажите Telegram @username или телефон."
    if _telegram_ok(value) or _phone_ok(value):
        return ""
    return "Проверьте контакт: Telegram в виде @username или номер телефона."


def _grade_value(value):
    if value in (None, ""):
        return None
    try:
        grade = int(value)
    except (TypeError, ValueError):
        return None
    if grade not in AcademyLead.Grade.values:
        return None
    return grade


def _subject_error(grade, subject: str) -> str:
    if subject not in _SUBJECTS:
        return "Выберите предмет."
    if grade is None:
        return ""
    oge_ok = grade == 9 and subject == AcademyLead.Subject.OGE_INF
    ege_ok = grade in (10, 11) and subject in _EGE_SUBJECTS
    if oge_ok or ege_ok:
        return ""
    return _MISMATCH


def _consent_error(consent: bool, version: str) -> str:
    if not consent:
        return "Нужно согласие на обработку персональных данных."
    if version != ACADEMY_CONSENT_VERSION:
        return "Обновите страницу и отметьте согласие ещё раз."
    return ""


def validate_academy_lead(data: dict) -> tuple[dict, dict]:
    """Вернуть очищенные поля и словарь ошибок. Пустой словарь ошибок — данные можно сохранять."""
    errors = {}
    student_name = _clip(data.get("student_name"), 200)
    parent_name = _clip(data.get("parent_name"), 200)
    comment = _clip(data.get("comment"), 4000)
    contact = _clip(data.get("contact"), 80)
    grade = _grade_value(data.get("grade"))
    subject = _clip(data.get("subject"), 16)
    consent = data.get("consent") is True
    version = _clip(data.get("consent_text_version") or ACADEMY_CONSENT_VERSION, 64)

    if not student_name:
        errors["student_name"] = "Укажите имя ученика."
    if grade is None:
        errors["grade"] = "Выберите класс."
    subject_problem = _subject_error(grade, subject)
    if subject_problem:
        errors["subject"] = subject_problem
    contact_problem = _contact_error(contact)
    if contact_problem:
        errors["contact"] = contact_problem
    if len(str(data.get("comment") or "")) > 4000:
        errors["comment"] = "Комментарий слишком длинный."
    consent_problem = _consent_error(consent, version)
    if consent_problem:
        errors["consent"] = consent_problem

    cleaned = {
        "student_name": student_name,
        "parent_name": parent_name,
        "grade": grade,
        "subject": subject,
        "contact": contact,
        "comment": comment,
        "consent": consent,
        "consent_text_version": ACADEMY_CONSENT_VERSION,
    }
    for key, limit in _UTM_LIMITS.items():
        cleaned[key] = _clip(data.get(key), limit)
    cleaned["referrer"] = _clip(data.get("referrer"), 500)
    return cleaned, errors


def _schedule_email(lead: AcademyLead) -> None:
    lead_id = lead.pk
    lines = [
        f"Новая заявка академии #{lead_id}",
        "",
        f"Имя ученика: {lead.student_name}",
        f"Имя родителя: {lead.parent_name or '—'}",
        f"Класс: {lead.get_grade_display()}",
        f"Предмет: {lead.get_subject_display()}",
        f"Контакт: {lead.contact}",
        "",
        lead.comment or "Комментарий: —",
        "",
        f"utm_source: {lead.utm_source or '—'}",
        f"utm_medium: {lead.utm_medium or '—'}",
        f"utm_campaign: {lead.utm_campaign or '—'}",
        f"utm_content: {lead.utm_content or '—'}",
        f"utm_term: {lead.utm_term or '—'}",
        f"referrer: {lead.referrer or '—'}",
        "",
        f"Админка: /admin/Cabinet/academylead/{lead_id}/change/",
    ]
    body = "\n".join(lines)
    mail_subject = f"Заявка академии #{lead_id}: {lead.student_name}"

    def send() -> None:
        try:
            from django.core.mail import send_mail

            send_mail(
                mail_subject,
                body,
                getattr(settings, "DEFAULT_FROM_EMAIL", None),
                [ACADEMY_NOTIFY_EMAIL],
                fail_silently=False,
            )
        except Exception:
            logger.exception("academy lead email failed id=%s", lead_id)

    transaction.on_commit(send)


def _read_payload(request):
    try:
        data = json.loads(request.body.decode("utf-8") or "{}")
    except (TypeError, ValueError):
        return None, JsonResponse({"ok": False, "error": "Некорректный JSON"}, status=400)
    if isinstance(data, dict):
        return data, None
    return None, JsonResponse({"ok": False, "error": "Некорректные данные"}, status=400)


def _store_lead(request, cleaned):
    with transaction.atomic():
        lead = AcademyLead.objects.create(
            student_name=cleaned["student_name"],
            parent_name=cleaned["parent_name"],
            grade=cleaned["grade"],
            subject=cleaned["subject"],
            contact=cleaned["contact"],
            comment=cleaned["comment"],
            consent=True,
            consent_at=timezone.now(),
            consent_text_version=cleaned["consent_text_version"],
            utm_source=cleaned["utm_source"],
            utm_medium=cleaned["utm_medium"],
            utm_campaign=cleaned["utm_campaign"],
            utm_content=cleaned["utm_content"],
            utm_term=cleaned["utm_term"],
            referrer=cleaned["referrer"],
            ip_hash=hash_client_ip(client_ip(request)),
        )
        _schedule_email(lead)
    return JsonResponse({"ok": True, "id": lead.pk, "message": ACADEMY_SUCCESS_MESSAGE})


def _lead_response(request, data):
    if str(data.get("company_website") or "").strip():
        logger.info("academy lead honeypot hit")
        return JsonResponse({"ok": True, "message": ACADEMY_SUCCESS_MESSAGE})
    cleaned, errors = validate_academy_lead(data)
    if errors:
        return JsonResponse({"ok": False, "errors": errors}, status=400)
    return _store_lead(request, cleaned)


@require_http_methods(["POST"])
def api_academy_lead(request):
    if not rate_limit_check(request, "academy_lead", ACADEMY_RATE_LIMIT, ACADEMY_RATE_WINDOW_SEC):
        return rate_limit_json_response("academy_lead")
    data, error = _read_payload(request)
    if error is not None:
        return error
    return _lead_response(request, data)
