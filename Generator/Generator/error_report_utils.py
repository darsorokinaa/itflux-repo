"""Уведомления о сообщениях об ошибках в заданиях."""
import logging

from django.conf import settings
from django.core.mail import send_mail

logger = logging.getLogger(__name__)

SUBJECT_LABELS = {
    "inf": "Информатика",
    "math": "Математика",
    "rus": "Русский язык",
    "phys": "Физика",
    "chem": "Химия",
    "bio": "Биология",
    "hist": "История",
    "soc": "Обществознание",
    "eng": "Английский язык",
    "eng_speaking": "Английский язык (устная часть)",
    "geo": "География",
    "lit": "Литература",
    "math_base": "Математика (база)",
}

LEVEL_LABELS = {"oge": "ОГЭ", "ege": "ЕГЭ", "vpr": "ВПР"}

ERROR_TYPE_LABELS = {
    "typo": "Опечатка",
    "wrong_condition": "Неверное условие",
    "wrong_answer": "Не сходится ответ",
    "other": "Другое",
}


def notify_error_report_email(
    *,
    subject: str,
    level: str,
    task_number: int | None,
    task_id: int | None,
    variant_id: int | None,
    error_type: str,
    comment: str,
) -> bool:
    """Отправляет письмо о новом сообщении об ошибке. False — если SMTP не настроен или сбой."""
    recipient = getattr(settings, "ERROR_REPORT_NOTIFY_EMAIL", "").strip()
    if not recipient:
        logger.warning("ERROR_REPORT_NOTIFY_EMAIL не задан — письмо не отправлено")
        return False

    host_user = getattr(settings, "EMAIL_HOST_USER", "").strip()
    if not host_user:
        logger.warning("EMAIL_HOST_USER не задан — письмо об ошибке не отправлено")
        return False

    subject_label = SUBJECT_LABELS.get(str(subject).lower(), str(subject))
    level_label = LEVEL_LABELS.get(str(level).lower(), str(level).upper())
    error_label = ERROR_TYPE_LABELS.get(str(error_type), str(error_type))

    task_str = f"№{task_number}" if task_number is not None else "—"
    lines = [
        "Новое сообщение об ошибке в задании",
        "",
        f"Предмет: {subject_label}",
        f"Уровень: {level_label}",
        f"Задание: {task_str}",
    ]
    if task_id is not None:
        lines.append(f"ID задачи: {task_id}")
    if variant_id is not None:
        lines.append(f"ID варианта: {variant_id}")
    lines.extend(
        [
            f"Тип ошибки: {error_label}",
            "",
            "Комментарий:",
            (comment or "").strip() or "—",
        ]
    )
    body = "\n".join(lines)
    mail_subject = f"[ITFlux] Ошибка в задании {task_str} — {subject_label} {level_label}"

    try:
        sent = send_mail(
            subject=mail_subject,
            message=body,
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[recipient],
            fail_silently=False,
        )
        return bool(sent)
    except Exception:
        logger.exception("Не удалось отправить письмо об ошибке на %s", recipient)
        return False
