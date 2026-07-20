"""Бизнес-логика видеоконференций Jitsi (доступ, комнаты, посещаемость)."""

from __future__ import annotations

import secrets
from dataclasses import dataclass
from typing import Literal

from django.conf import settings
from django.contrib.auth.models import User
from django.db import transaction
from django.utils import timezone

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


def generate_room_name() -> str:
    """Криптографически непредсказуемое имя комнаты без PII (только [A-Za-z0-9])."""
    # token_urlsafe даёт '-' и '_', из‑за которых на части Prosody бывают рассинхроны MUC.
    return f"digitalstream{secrets.token_hex(16)}"


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
    too_early | window_closed | available | live | finished | cancelled | event_cancelled
    """
    now = now or timezone.now()
    if event.status == ScheduleEvent.Status.CANCELLED:
        return "event_cancelled"
    if meeting is not None and meeting.status == VideoMeeting.Status.CANCELLED:
        return "cancelled"
    if meeting is not None and meeting.status == VideoMeeting.Status.FINISHED:
        return "finished"

    before = timezone.timedelta(minutes=_join_before_minutes())
    after = timezone.timedelta(minutes=_join_after_minutes())
    window_start = event.starts_at - before
    window_end = event.ends_at + after

    if now < window_start:
        return "too_early"
    if now > window_end:
        return "window_closed"
    if meeting is not None and meeting.status == VideoMeeting.Status.LIVE:
        return "live"
    return "available"


def ui_state_message(state: str) -> str:
    before = _join_before_minutes()
    mapping = {
        "too_early": f"Подключение будет доступно за {before} минут до начала",
        "window_closed": "Урок завершён",
        "available": "Подключиться к уроку",
        "live": "Урок идёт",
        "finished": "Урок завершён",
        "cancelled": "Урок отменён",
        "event_cancelled": "Урок отменён",
        "no_access": "У вас нет доступа к этому уроку",
        "login_required": "Требуется авторизация",
        "later": "Урок начнётся позже",
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
    event = meeting.schedule_event
    access = resolve_access(user, event)
    if not access.allowed:
        raise VideoMeetingError(access.reason or "Доступ запрещён", code="forbidden", status=403)

    state = meeting_join_window_state(event, meeting)
    if state in ("event_cancelled", "cancelled"):
        raise VideoMeetingError("Урок отменён", code="cancelled", status=403)
    if state == "finished":
        raise VideoMeetingError("Конференция завершена", code="finished", status=403)
    # Учитель может зайти заранее (подготовка комнаты); окно для учеников ограничено.
    if state == "too_early" and access.role not in ("teacher", "staff"):
        raise VideoMeetingError(
            ui_state_message("too_early"),
            code="too_early",
            status=403,
        )
    if state == "window_closed" and access.role not in ("teacher", "staff"):
        raise VideoMeetingError("Время подключения истекло", code="window_closed", status=403)

    return access


def get_or_create_meeting_for_event(*, event: ScheduleEvent, created_by: User) -> VideoMeeting:
    """Комната создаётся один раз на событие; повторный вызов не меняет room_name."""
    existing = VideoMeeting.objects.filter(schedule_event=event).first()
    if existing is not None:
        return existing

    access = resolve_access(created_by, event)
    if not access.allowed or access.role not in ("teacher", "staff"):
        raise VideoMeetingError("Только учитель урока может создать видеокомнату", code="forbidden", status=403)

    with transaction.atomic():
        # Учитель урока — организатор в участниках расписания.
        _ensure_organizer(event, event.owner)
        meeting, created = VideoMeeting.objects.select_for_update().get_or_create(
            schedule_event=event,
            defaults={
                "room_name": generate_room_name(),
                "created_by": created_by,
                "status": VideoMeeting.Status.SCHEDULED,
            },
        )
        if created:
            update_fields = []
            if event.meeting_provider in ("", MeetingProvider.NONE, MeetingProvider.MANUAL):
                event.meeting_provider = MeetingProvider.JITSI
                update_fields.append("meeting_provider")
            if update_fields:
                event.save(update_fields=update_fields + ["updated_at"])
        return meeting


def start_meeting(*, meeting: VideoMeeting, user: User) -> VideoMeeting:
    assert_can_manage_meeting(user, meeting)
    if meeting.status == VideoMeeting.Status.FINISHED:
        raise VideoMeetingError("Конференция уже завершена", code="finished", status=403)
    if meeting.status == VideoMeeting.Status.CANCELLED:
        raise VideoMeetingError("Конференция отменена", code="cancelled", status=403)

    with transaction.atomic():
        locked = VideoMeeting.objects.select_for_update().get(pk=meeting.pk)
        if locked.status != VideoMeeting.Status.LIVE:
            locked.status = VideoMeeting.Status.LIVE
            if locked.actual_started_at is None:
                locked.actual_started_at = timezone.now()
            locked.save(update_fields=["status", "actual_started_at", "updated_at"])
        return locked


def finish_meeting(*, meeting: VideoMeeting, user: User) -> VideoMeeting:
    assert_can_manage_meeting(user, meeting)
    now = timezone.now()
    with transaction.atomic():
        locked = VideoMeeting.objects.select_for_update().get(pk=meeting.pk)
        if locked.status != VideoMeeting.Status.FINISHED:
            locked.status = VideoMeeting.Status.FINISHED
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


def build_join_config(*, meeting: VideoMeeting, user: User, request=None) -> dict:
    access = assert_can_join_meeting(user, meeting, for_config=True)
    event = meeting.schedule_event
    user_info = build_user_info(user, request)

    jwt_token = None
    try:
        jwt_token = generate_jitsi_jwt(
            room_name=meeting.room_name,
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

    return {
        "domain": domain,
        "roomName": meeting.room_name,
        "jwt": jwt_token,
        "authMode": auth_mode,
        "requiresModeratorLogin": requires_moderator_login,
        "userInfo": user_info,
        "meeting": {
            "uuid": str(meeting.uuid),
            "title": event.title,
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


def serialize_meeting_summary(meeting: VideoMeeting | None, *, event: ScheduleEvent, user: User | None = None) -> dict | None:
    if meeting is None:
        return None
    access = resolve_access(user, event) if user is not None else None
    state = meeting_join_window_state(event, meeting)
    return {
        "uuid": str(meeting.uuid),
        "status": meeting.status,
        "statusLabel": meeting.get_status_display(),
        "joinState": state,
        "joinStateLabel": ui_state_message(state),
        "pageUrl": f"/cabinet/meetings/{meeting.uuid}",
        "isModerator": bool(access and access.is_moderator) if access else False,
        "actualStartedAt": meeting.actual_started_at.isoformat() if meeting.actual_started_at else None,
        "actualFinishedAt": meeting.actual_finished_at.isoformat() if meeting.actual_finished_at else None,
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
