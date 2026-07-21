"""Бизнес-логика видеоконференций Jitsi (доступ, комнаты, посещаемость)."""

from __future__ import annotations

import logging
import secrets
from dataclasses import dataclass
from typing import Literal

from django.conf import settings
from django.contrib.auth.models import User
from django.db import IntegrityError, transaction
from django.utils import timezone

logger = logging.getLogger(__name__)

from .choices import MeetingProvider, ParticipantRole, ParticipantStatus
from .jitsi_service import (
    JitsiConfigError,
    build_user_info,
    generate_jitsi_jwt,
    get_jitsi_auth_mode,
    get_jitsi_domain,
)
from .models import MeetingAttendance, Profile, ScheduleEvent, Student, VideoMeeting
from .schedule_series import _ensure_organizer


class VideoMeetingError(Exception):
    def __init__(self, message: str, *, code: str = "error", status: int = 400):
        super().__init__(message)
        self.message = message
        self.code = code
        self.status = status


AccessRole = Literal["teacher", "student", "staff", "none"]


@dataclass(frozen=True)
class AccessResult:
    allowed: bool
    role: AccessRole
    is_moderator: bool
    reason: str = ""
    ui_state: str = ""


def _join_before_minutes() -> int:
    return max(0, int(getattr(settings, "JITSI_JOIN_BEFORE_MINUTES", 15) or 15))


def _join_after_minutes() -> int:
    return max(0, int(getattr(settings, "JITSI_JOIN_AFTER_MINUTES", 30) or 30))


def generate_secure_room_name() -> str:
    """Криптографически непредсказуемое имя комнаты без PII.

    Только [A-Za-z0-9]: дефисы/подчёркивания на Prosody дают рассинхрон MUC —
    участники оказываются в «разных» комнатах и не видят друг друга.
    """
    return f"digitalstream{secrets.token_hex(16)}"


def generate_room_name() -> str:
    """Alias для совместимости с существующими вызовами/тестами."""
    return generate_secure_room_name()


def sanitize_room_name(room_name: str) -> str:
    """Убирает символы, из‑за которых Prosody/Jitsi расходятся по MUC."""
    cleaned = "".join(ch for ch in (room_name or "") if ch.isalnum()).lower()
    return cleaned or generate_secure_room_name()


def get_student_profiles_for_user(user: User):
    return Student.objects.filter(user=user, status="active")


def user_is_event_teacher(user: User, event: ScheduleEvent) -> bool:
    if event.owner_id == user.pk:
        return True
    return event.participants.filter(
        role=ParticipantRole.ORGANIZER,
        teacher_id=user.pk,
        status__in=[ParticipantStatus.INVITED, ParticipantStatus.ACCEPTED],
    ).exists()


def user_is_event_student(user: User, event: ScheduleEvent) -> bool:
    students = get_student_profiles_for_user(user)
    if not students.exists():
        return False
    student_ids = list(students.values_list("id", flat=True))
    if event.student_id and event.student_id in student_ids:
        return True
    if event.group_id and event.group.students.filter(id__in=student_ids).exists():
        return True
    return event.participants.filter(
        student_id__in=student_ids,
        role=ParticipantRole.STUDENT,
        status__in=[ParticipantStatus.INVITED, ParticipantStatus.ACCEPTED],
    ).exists()


def resolve_access(user: User | None, event: ScheduleEvent) -> AccessResult:
    if user is None or not user.is_authenticated:
        return AccessResult(False, "none", False, "Требуется авторизация", "login_required")

    profile = getattr(user, "profile", None)
    if profile is not None and (profile.account_blocked or not profile.account_active):
        return AccessResult(False, "none", False, "Аккаунт недоступен", "account_blocked")

    if user.is_staff or user.is_superuser:
        return AccessResult(True, "staff", True, "", "ok")

    if profile is not None and profile.role == Profile.Role.PARENT:
        return AccessResult(
            False,
            "none",
            False,
            "У вас нет доступа к этому уроку",
            "no_access",
        )

    if user_is_event_teacher(user, event):
        return AccessResult(True, "teacher", True, "", "ok")

    if user_is_event_student(user, event):
        return AccessResult(True, "student", False, "", "ok")

    return AccessResult(
        False,
        "none",
        False,
        "У вас нет доступа к этому уроку",
        "no_access",
    )


def meeting_join_window_state(
    event: ScheduleEvent,
    meeting: VideoMeeting | None,
    *,
    now=None,
) -> str:
    """
    Состояния UI для ученика/кнопок:
    too_early | window_closed | available | scheduled | live | finished | cancelled | event_cancelled

    При status=live всегда «live»: ссылка активна до finish/cancel, не до ends_at.
    Окно JITSI_JOIN_* применяется только до старта урока (scheduled / available).
    """
    now = now or timezone.now()
    if event.status == ScheduleEvent.Status.CANCELLED:
        return "event_cancelled"
    if meeting is not None and meeting.status == VideoMeeting.Status.CANCELLED:
        return "cancelled"
    if meeting is not None and meeting.status == VideoMeeting.Status.FINISHED:
        return "finished"
    # Пока урок идёт (live) — ссылка активна до явного завершения, без отсечки по расписанию.
    if meeting is not None and meeting.status == VideoMeeting.Status.LIVE:
        return "live"

    before = timezone.timedelta(minutes=_join_before_minutes())
    after = timezone.timedelta(minutes=_join_after_minutes())
    window_start = event.starts_at - before
    window_end = event.ends_at + after

    if now < window_start:
        return "too_early"
    if now > window_end:
        return "window_closed"
    if meeting is not None and meeting.status == VideoMeeting.Status.SCHEDULED:
        return "scheduled"
    return "available"


def ui_state_message(state: str) -> str:
    before = _join_before_minutes()
    mapping = {
        "too_early": f"Подключение будет доступно за {before} минут до начала",
        "window_closed": "Урок завершён",
        "available": "Подключиться к уроку",
        "scheduled": "Урок ещё не начался",
        "live": "Урок идёт",
        "finished": "Урок завершён",
        "cancelled": "Урок отменён",
        "event_cancelled": "Урок отменён",
        "no_access": "У вас нет доступа к этому уроку",
        "login_required": "Требуется авторизация",
        "later": "Урок начнётся позже",
        "not_live": "Урок ещё не начат",
    }
    return mapping.get(state, state)


def assert_can_manage_meeting(user: User, meeting: VideoMeeting) -> AccessResult:
    access = resolve_access(user, meeting.schedule_event)
    if not access.allowed:
        raise VideoMeetingError(access.reason or "Доступ запрещён", code="forbidden", status=403)
    if access.role not in ("teacher", "staff"):
        raise VideoMeetingError("Только учитель может управлять конференцией", code="forbidden", status=403)
    return access


def assert_can_join_meeting(user: User, meeting: VideoMeeting, *, for_config: bool = True) -> AccessResult:
    """
    Проверка доступа к конференции.

    JWT / join-config и посещаемость доступны только при статусе live.
    Страница ожидания (detail/status) доступна и до старта.
    """
    meeting.refresh_from_db(fields=["status", "room_name"])
    event = meeting.schedule_event
    if hasattr(event, "refresh_from_db"):
        event.refresh_from_db(fields=["status", "starts_at", "ends_at"])
    access = resolve_access(user, event)
    if not access.allowed:
        raise VideoMeetingError(access.reason or "Доступ запрещён", code="forbidden", status=403)

    if meeting.status == VideoMeeting.Status.CANCELLED or event.status == ScheduleEvent.Status.CANCELLED:
        raise VideoMeetingError("Урок отменён", code="cancelled", status=409)
    if meeting.status == VideoMeeting.Status.FINISHED:
        raise VideoMeetingError("Урок завершён", code="finished", status=409)
    if meeting.status != VideoMeeting.Status.LIVE:
        raise VideoMeetingError("Урок ещё не начат", code="not_live", status=409)

    # При live вход открыт до finish/cancel — расписание (too_early / window_closed) не режет ссылку.
    return access


def get_or_create_meeting_for_event(
    *,
    event: ScheduleEvent,
    created_by: User,
) -> tuple[VideoMeeting, bool]:
    """Комната создаётся один раз на событие; повторный вызов не меняет room_name/статус."""
    if event.status == ScheduleEvent.Status.CANCELLED:
        raise VideoMeetingError("Нельзя создать комнату для отменённого урока", code="cancelled", status=409)
    if event.status in (ScheduleEvent.Status.DONE, ScheduleEvent.Status.COMPLETED):
        raise VideoMeetingError("Нельзя создать комнату для завершённого урока", code="finished", status=409)

    existing = VideoMeeting.objects.filter(schedule_event=event).first()
    if existing is not None:
        if existing.status == VideoMeeting.Status.CANCELLED:
            raise VideoMeetingError("Видеокомната этого урока отменена", code="cancelled", status=409)
        return existing, False

    access = resolve_access(created_by, event)
    if not access.allowed or access.role not in ("teacher", "staff"):
        raise VideoMeetingError("Только учитель урока может создать видеокомнату", code="forbidden", status=403)

    with transaction.atomic():
        _ensure_organizer(event, event.owner)
        try:
            meeting, created = VideoMeeting.objects.select_for_update().get_or_create(
                schedule_event=event,
                defaults={
                    "room_name": generate_secure_room_name(),
                    "created_by": created_by,
                    "status": VideoMeeting.Status.SCHEDULED,
                },
            )
        except IntegrityError:
            meeting = VideoMeeting.objects.select_for_update().get(schedule_event=event)
            created = False

        if created:
            update_fields = []
            if event.meeting_provider in ("", MeetingProvider.NONE, MeetingProvider.MANUAL):
                event.meeting_provider = MeetingProvider.JITSI
                update_fields.append("meeting_provider")
            if update_fields:
                event.save(update_fields=update_fields + ["updated_at"])
        return meeting, created


def start_meeting(*, meeting: VideoMeeting, user: User) -> VideoMeeting:
    assert_can_manage_meeting(user, meeting)

    with transaction.atomic():
        locked = (
            VideoMeeting.objects.select_for_update()
            .select_related("schedule_event")
            .get(pk=meeting.pk)
        )
        if locked.schedule_event.status == ScheduleEvent.Status.CANCELLED:
            raise VideoMeetingError("Урок отменён", code="cancelled", status=409)
        if locked.status == VideoMeeting.Status.FINISHED:
            raise VideoMeetingError("Урок уже завершён", code="finished", status=409)
        if locked.status == VideoMeeting.Status.CANCELLED:
            raise VideoMeetingError("Урок отменён", code="cancelled", status=409)
        if locked.status == VideoMeeting.Status.LIVE:
            return locked
        if locked.status != VideoMeeting.Status.SCHEDULED:
            raise VideoMeetingError(
                f"Нельзя начать урок из статуса «{locked.status}»",
                code="invalid_status",
                status=409,
            )

        locked.status = VideoMeeting.Status.LIVE
        locked.actual_started_at = timezone.now()
        locked.save(update_fields=["status", "actual_started_at", "updated_at"])
        return locked


def finish_meeting(*, meeting: VideoMeeting, user: User) -> VideoMeeting:
    assert_can_manage_meeting(user, meeting)
    now = timezone.now()
    with transaction.atomic():
        locked = VideoMeeting.objects.select_for_update().get(pk=meeting.pk)
        if locked.status == VideoMeeting.Status.FINISHED:
            return locked
        if locked.status == VideoMeeting.Status.CANCELLED:
            raise VideoMeetingError("Урок отменён", code="cancelled", status=409)
        if locked.status != VideoMeeting.Status.LIVE:
            raise VideoMeetingError(
                "Завершить можно только идущий урок",
                code="invalid_status",
                status=409,
            )

        presented_payload = dict(locked.presented_payload or {})

        locked.status = VideoMeeting.Status.FINISHED
        if locked.actual_finished_at is None:
            locked.actual_finished_at = now
        locked.presented_kind = ""
        locked.presented_payload = {}
        locked.presented_at = None
        locked.presented_by = None
        locked.save(
            update_fields=[
                "status",
                "actual_finished_at",
                "presented_kind",
                "presented_payload",
                "presented_at",
                "presented_by",
                "updated_at",
            ]
        )

        open_sessions = (
            MeetingAttendance.objects.select_for_update()
            .filter(meeting=locked, left_at__isnull=True)
        )
        for session in open_sessions:
            session.left_at = now
            session.duration_seconds = max(
                0, int((session.left_at - session.joined_at).total_seconds())
            )
            session.save(update_fields=["left_at", "duration_seconds"])

        # Подробные результаты live-варианта → журнал (если на уроке был вариант).
        try:
            from .journal_service import apply_live_variant_results_to_journal

            apply_live_variant_results_to_journal(
                event=locked.schedule_event,
                teacher=user,
                presented_payload=presented_payload,
            )
        except Exception:
            logger.exception(
                "Failed to import live variant results into journal meeting=%s",
                locked.uuid,
            )

        return locked


def cancel_meeting_for_event(event: ScheduleEvent) -> VideoMeeting | None:
    """При отмене урока связанная конференция переходит в cancelled (без удаления)."""
    meeting = VideoMeeting.objects.filter(schedule_event=event).first()
    if meeting is None:
        return None
    now = timezone.now()
    with transaction.atomic():
        locked = VideoMeeting.objects.select_for_update().get(pk=meeting.pk)
        if locked.status == VideoMeeting.Status.FINISHED:
            return locked
        if locked.status != VideoMeeting.Status.CANCELLED:
            locked.status = VideoMeeting.Status.CANCELLED
            if locked.actual_finished_at is None:
                locked.actual_finished_at = now
            locked.save(update_fields=["status", "actual_finished_at", "updated_at"])

        open_sessions = (
            MeetingAttendance.objects.select_for_update()
            .filter(meeting=locked, left_at__isnull=True)
        )
        for session in open_sessions:
            session.left_at = now
            session.duration_seconds = max(
                0, int((session.left_at - session.joined_at).total_seconds())
            )
            session.save(update_fields=["left_at", "duration_seconds"])
        return locked


def record_attendance_join(
    *,
    meeting: VideoMeeting,
    user: User,
    jitsi_participant_id: str = "",
) -> MeetingAttendance:
    """
    Идемпотентный вход: при открытой сессии того же пользователя возвращаем её.
    После выхода (left_at задан) следующее подключение создаёт новую сессию.
    """
    assert_can_join_meeting(user, meeting, for_config=False)
    now = timezone.now()
    participant_id = (jitsi_participant_id or "").strip()[:255]

    with transaction.atomic():
        open_session = (
            MeetingAttendance.objects.select_for_update()
            .filter(meeting=meeting, user=user, left_at__isnull=True)
            .order_by("-joined_at")
            .first()
        )
        if open_session:
            if participant_id and open_session.jitsi_participant_id != participant_id:
                open_session.jitsi_participant_id = participant_id
                open_session.save(update_fields=["jitsi_participant_id"])
            return open_session

        return MeetingAttendance.objects.create(
            meeting=meeting,
            user=user,
            joined_at=now,
            jitsi_participant_id=participant_id,
        )


def record_attendance_leave(
    *,
    meeting: VideoMeeting,
    user: User,
    jitsi_participant_id: str = "",
) -> MeetingAttendance | None:
    """Закрывает только открытую сессию текущего пользователя (идемпотентно)."""
    access = resolve_access(user, meeting.schedule_event)
    if not access.allowed:
        raise VideoMeetingError(access.reason or "Доступ запрещён", code="forbidden", status=403)

    now = timezone.now()
    participant_id = (jitsi_participant_id or "").strip()[:255]

    with transaction.atomic():
        qs = (
            MeetingAttendance.objects.select_for_update()
            .filter(meeting=meeting, user=user, left_at__isnull=True)
            .order_by("-joined_at")
        )
        if participant_id:
            matched = qs.filter(jitsi_participant_id=participant_id).first()
            session = matched or qs.first()
        else:
            session = qs.first()

        if session is None:
            # Повторный leave без открытой сессии — не ошибка.
            return (
                MeetingAttendance.objects.filter(meeting=meeting, user=user)
                .order_by("-joined_at")
                .first()
            )

        session.left_at = now
        session.duration_seconds = max(
            0, int((session.left_at - session.joined_at).total_seconds())
        )
        if participant_id and not session.jitsi_participant_id:
            session.jitsi_participant_id = participant_id
        session.save(update_fields=["left_at", "duration_seconds", "jitsi_participant_id"])
        return session


def ensure_muc_safe_room_name(meeting: VideoMeeting) -> str:
    """Если в БД осталось имя с '-' / '_', нормализуем один раз (та же комната для всех)."""
    current = meeting.room_name or ""
    safe = sanitize_room_name(current)
    if safe == current:
        return current
    with transaction.atomic():
        locked = VideoMeeting.objects.select_for_update().get(pk=meeting.pk)
        safe = sanitize_room_name(locked.room_name or "")
        if safe != locked.room_name:
            # Гарантируем уникальность при коллизии.
            candidate = safe
            suffix = 0
            while VideoMeeting.objects.filter(room_name=candidate).exclude(pk=locked.pk).exists():
                suffix += 1
                candidate = f"{safe}{suffix}"
            locked.room_name = candidate
            locked.save(update_fields=["room_name", "updated_at"])
            meeting.room_name = candidate
            return candidate
        meeting.room_name = locked.room_name
        return locked.room_name


def build_join_config(*, meeting: VideoMeeting, user: User, request=None) -> dict:
    access = assert_can_join_meeting(user, meeting, for_config=True)
    # Перечитываем статус: между проверкой и выдачей JWT урок мог завершиться.
    meeting.refresh_from_db(fields=["status", "room_name"])
    if meeting.status != VideoMeeting.Status.LIVE:
        raise VideoMeetingError("Урок ещё не начат", code="not_live", status=409)
    room_name = ensure_muc_safe_room_name(meeting)
    event = meeting.schedule_event
    user_info = build_user_info(user, request)
    display_name = str(user_info.get("displayName") or "").strip()
    if not display_name:
        # Защита: пустое имя ломает prejoin («Присоединиться» не пускает).
        user_info["displayName"] = f"Пользователь {user.pk}"
        display_name = user_info["displayName"]

    jwt_token = None
    try:
        jwt_token = generate_jitsi_jwt(
            room_name=room_name,
            user=user,
            is_moderator=access.is_moderator,
            request=request,
        )
    except JitsiConfigError as exc:
        raise VideoMeetingError(str(exc), code="jwt_config", status=503) from exc

    if get_jitsi_domain() and (getattr(settings, "JITSI_AUTH_MODE", "none") or "").lower() == "jwt":
        if not jwt_token:
            raise VideoMeetingError("Не удалось сформировать JWT", code="jwt_missing", status=503)

    teacher_name = ""
    owner = event.owner
    owner_profile = getattr(owner, "profile", None)
    if owner_profile is not None:
        teacher_name = owner_profile.get_display_name()
    if not teacher_name:
        teacher_name = owner.get_full_name() or owner.username

    domain = get_jitsi_domain()
    auth_mode = get_jitsi_auth_mode()
    # meet.jit.si без JWT не доверяет startAsModerator — учитель должен нажать «Я организатор».
    requires_moderator_login = (
        access.is_moderator
        and not jwt_token
        and domain.rstrip(".").lower() in {"meet.jit.si", "8x8.vc"}
    )

    # join-config никогда не генерирует новую комнату — только сохранённый room_name.
    meeting.refresh_from_db(fields=["room_name"])
    if room_name != meeting.room_name:
        raise VideoMeetingError(
            "Несогласованное имя комнаты видеозанятия",
            code="room_mismatch",
            status=500,
        )

    logger.info(
        "Jitsi join configuration",
        extra={
            "meeting_uuid": str(meeting.uuid),
            "room_name": meeting.room_name,
            "domain": domain,
            "user_id": user.pk,
            "auth_mode": auth_mode,
            "is_moderator": access.is_moderator,
            "has_jwt": bool(jwt_token),
        },
    )

    subject = lesson_meeting_subject(event)
    audience = lesson_meeting_audience(event)

    return {
        "domain": domain,
        "roomName": meeting.room_name,
        "jwt": jwt_token,
        "authMode": auth_mode,
        "requiresModeratorLogin": requires_moderator_login,
        "userInfo": user_info,
        "meeting": {
            "uuid": str(meeting.uuid),
            "title": subject,
            "subject": subject,
            "audience": audience,
            "topic": event.topic or "",
            "teacherName": teacher_name,
            "startsAt": event.starts_at.isoformat(),
            "endsAt": event.ends_at.isoformat(),
            "status": meeting.status,
            "isModerator": access.is_moderator,
            "role": "organizer" if access.is_moderator else "participant",
            "roleLabel": "Организатор" if access.is_moderator else "Участник",
            "returnUrl": _return_url_for_role(access.role),
        },
    }


def _return_url_for_role(role: AccessRole) -> str:
    if role == "student":
        return "/cabinet/student/lessons"
    return "/cabinet/schedule"


def lesson_meeting_audience(event: ScheduleEvent) -> str:
    """Имя ученика / группы для вкладки и subject конференции."""
    if event.student_id and getattr(event, "student", None):
        name = (event.student.full_name or "").strip()
        if name:
            return name
    if event.group_id and getattr(event, "group", None):
        name = (event.group.title or "").strip()
        if name:
            return name
    audience = (event.audience or "").strip()
    if audience:
        return audience
    participants = getattr(event, "participants", None)
    if participants is not None:
        names = []
        for participant in participants.all():
            if getattr(participant, "status", None) == ParticipantStatus.REMOVED:
                continue
            if getattr(participant, "role", None) == ParticipantRole.ORGANIZER:
                continue
            name = (getattr(participant, "display_name", None) or "").strip()
            if not name and participant.student_id and getattr(participant, "student", None):
                name = (participant.student.full_name or "").strip()
            if name:
                names.append(name)
        if names:
            return ", ".join(names)
    return (event.title or "").strip()


def lesson_meeting_subject(event: ScheduleEvent) -> str:
    """Название вкладки урока: «Урок · Имя ученика»."""
    name = lesson_meeting_audience(event)
    if not name:
        return "Урок"
    if name.lower().startswith("урок"):
        return name
    return f"Урок · {name}"


def meeting_page_url(meeting: VideoMeeting) -> str:
    return f"/cabinet/meetings/{meeting.uuid}"


def serialize_meeting_summary(meeting: VideoMeeting | None, *, event: ScheduleEvent, user: User | None = None) -> dict | None:
    if meeting is None:
        return None
    from .meeting_present import serialize_presented

    access = resolve_access(user, event) if user is not None else None
    state = meeting_join_window_state(event, meeting)
    page_url = meeting_page_url(meeting)
    return {
        "uuid": str(meeting.uuid),
        "status": meeting.status,
        "statusLabel": meeting.get_status_display(),
        "joinState": state,
        "joinStateLabel": ui_state_message(state),
        "pageUrl": page_url,
        "joinUrl": page_url,
        "isModerator": bool(access and access.is_moderator) if access else False,
        "actualStartedAt": meeting.actual_started_at.isoformat() if meeting.actual_started_at else None,
        "actualFinishedAt": meeting.actual_finished_at.isoformat() if meeting.actual_finished_at else None,
        "presented": serialize_presented(meeting, user=user),
    }


def serialize_meeting_compact(meeting: VideoMeeting) -> dict:
    page_url = meeting_page_url(meeting)
    return {
        "uuid": str(meeting.uuid),
        "status": meeting.status,
        "joinUrl": page_url,
        "pageUrl": page_url,
    }


def list_attendance_for_teacher(*, meeting: VideoMeeting, user: User) -> list[dict]:
    assert_can_manage_meeting(user, meeting)
    rows = (
        MeetingAttendance.objects.filter(meeting=meeting)
        .select_related("user", "user__profile")
        .order_by("-joined_at")
    )
    result = []
    for row in rows:
        profile = getattr(row.user, "profile", None)
        name = profile.get_display_name() if profile else ""
        if not name:
            name = row.user.get_full_name() or row.user.username
        result.append({
            "id": row.pk,
            "userId": row.user_id,
            "displayName": name,
            "joinedAt": row.joined_at.isoformat(),
            "leftAt": row.left_at.isoformat() if row.left_at else None,
            "durationSeconds": row.duration_seconds,
            "jitsiParticipantId": row.jitsi_participant_id,
        })
    return result


def get_meeting_by_uuid(meeting_uuid) -> VideoMeeting:
    try:
        return VideoMeeting.objects.select_related(
            "schedule_event",
            "schedule_event__owner",
            "schedule_event__owner__profile",
            "schedule_event__student",
            "schedule_event__group",
            "created_by",
        ).prefetch_related(
            "schedule_event__participants",
            "schedule_event__participants__student",
            "schedule_event__group__students",
        ).get(uuid=meeting_uuid)
    except (VideoMeeting.DoesNotExist, ValueError, TypeError) as exc:
        raise VideoMeetingError("Конференция не найдена", code="not_found", status=404) from exc


def get_event_for_teacher(event_id: int, user: User) -> ScheduleEvent:
    try:
        event = ScheduleEvent.objects.select_related(
            "owner", "student", "group", "video_meeting"
        ).prefetch_related("participants", "group__students").get(pk=event_id)
    except ScheduleEvent.DoesNotExist as exc:
        raise VideoMeetingError("Урок не найден", code="not_found", status=404) from exc
    access = resolve_access(user, event)
    if not access.allowed:
        raise VideoMeetingError(access.reason or "Доступ запрещён", code="forbidden", status=403)
    return event
