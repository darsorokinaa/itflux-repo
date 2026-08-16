"""Teacher-initiated access recovery for students. Never exposes the current password."""

from __future__ import annotations

import logging
from urllib.parse import urlencode

from django.conf import settings
from django.contrib.auth.tokens import default_token_generator
from django.core.mail import send_mail
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode

from .invitations import create_student_invitation, invitation_join_path
from .models import Student

logger = logging.getLogger("cabinet.student_access")


class StudentAccessError(ValueError):
    def __init__(self, message, code="access_error"):
        super().__init__(message)
        self.code = code


def _public_origin(request=None) -> str:
    origin = (getattr(settings, "LK_PUBLIC_URL", "") or "").rstrip("/")
    if origin:
        return origin
    if request is not None:
        return request.build_absolute_uri("/").rstrip("/")
    return ""


def _password_reset_path(user) -> str:
    uid = urlsafe_base64_encode(force_bytes(user.pk))
    token = default_token_generator.make_token(user)
    query = urlencode({"mode": "reset", "uid": uid, "token": token})
    return f"/cabinet/login?{query}"


def _send_reset_email(user, reset_url: str) -> bool:
    email = (user.email or "").strip()
    if not email:
        return False
    profile = getattr(user, "profile", None)
    name = ""
    if profile:
        name = " ".join(part for part in (profile.name, profile.surname) if part).strip()
    greeting = f"Здравствуйте{', ' + name if name else ''}!"
    body = "\n".join(
        [
            greeting,
            "",
            "Учитель создал ссылку для восстановления доступа на платформе «Цифровой поток».",
            "Перейдите по ссылке, чтобы задать новый пароль:",
            "",
            reset_url,
            "",
            "Ссылка действует ограниченное время. Если вы не запрашивали сброс, проигнорируйте это письмо.",
        ]
    )
    try:
        sent = send_mail(
            subject="Восстановление доступа — Цифровой поток",
            message=body,
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[email],
            fail_silently=False,
        )
        return bool(sent)
    except Exception:
        logger.exception("Не удалось отправить ссылку восстановления на %s", email)
        return False


def create_student_access_reset(teacher, student: Student, *, request=None) -> dict:
    if student.teacher_id != teacher.id:
        raise StudentAccessError("Ученик принадлежит другому учителю", code="forbidden")

    origin = _public_origin(request)

    if not student.user_id:
        invitation = create_student_invitation(
            teacher,
            email=student.email or "",
            first_name=student.first_name,
            last_name=student.last_name,
            direction=student.direction,
            grade=student.grade,
            existing_student=student,
        )
        join_path = invitation_join_path(invitation.token)
        logger.info(
            "student access invite created teacher=%s student=%s invitation=%s",
            teacher.id,
            student.pk,
            invitation.pk,
        )
        return {
            "ok": True,
            "type": "invitation",
            "student_id": student.pk,
            "has_email": bool((student.email or "").strip()),
            "emailed": False,
            "join_path": join_path,
            "url": f"{origin}{join_path}" if origin else join_path,
            "message": "Ученик ещё не зарегистрирован. Отправьте ему ссылку-приглашение.",
        }

    user = student.user
    reset_path = _password_reset_path(user)
    reset_url = f"{origin}{reset_path}" if origin else reset_path
    emailed = False
    if (user.email or "").strip():
        emailed = _send_reset_email(user, reset_url)
    logger.info(
        "student access reset created teacher=%s student=%s user=%s emailed=%s",
        teacher.id,
        student.pk,
        user.id,
        emailed,
    )
    return {
        "ok": True,
        "type": "password_reset",
        "student_id": student.pk,
        "has_email": bool((user.email or student.email or "").strip()),
        "emailed": emailed,
        "join_path": reset_path,
        "url": reset_url,
        "message": (
            "Ссылка для нового пароля создана."
            + (" Письмо отправлено ученику." if emailed else " Скопируйте ссылку и передайте её ученику.")
        ),
    }
