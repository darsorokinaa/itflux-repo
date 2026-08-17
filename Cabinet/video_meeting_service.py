"""Бизнес-логика видеоконференций Jitsi (доступ, комнаты, посещаемость)."""

from __future__ import annotations

import logging
import secrets
from dataclasses import dataclass
from datetime import timedelta
from typing import Literal

from django.conf import settings
from django.contrib.auth.models import User
from django.db import IntegrityError, transaction
from django.db.models import Q
from django.utils import timezone

logger = logging.getLogger(__name__)

from .choices import MeetingProvider, ParticipantRole, ParticipantStatus
from .jitsi_service import (
    JitsiConfigError,
    build_user_info,
    decode_jitsi_jwt_unsafe_for_tests,
    generate_jitsi_jwt,
    get_jitsi_auth_mode,
    get_jitsi_domain,
    get_jitsi_sub,
    jwt_expires_at,
)
from .models import MeetingAttendance, Profile, ScheduleEvent, Student, VideoMeeting
from .schedule_series import _ensure_organizer

# Краткий разрыв (reload вкладки, Strict Mode, мигание сети) не считается уходом.
ATTENDANCE_RECONNECT_GRACE = timedelta(seconds=180)

# Watchdog LIVE-комнат: не закрывать только потому, что комната давно создана.
STALE_LIVE_AFTER_EVENT_END = timedelta(hours=12)
STALE_LIVE_INACTIVITY = timedelta(hours=6)
LIVE_ACTIVITY_TOUCH_INTERVAL = timedelta(minutes=2)


class VideoMeetingError(Exception):
    def __init__(self, message: str, *, code: str = "error", status: int = 400):
        super().__init__(message)
        self.message = message
        self.code = code
        self.status = status


AccessRole = Literal["teacher", "coteacher", "student", "staff", "none"]


@dataclass(frozen=True)
class AccessResult:
    allowed: bool
    role: AccessRole
    is_moderator: bool
    reason: str = ""
    ui_state: str = ""
    can_control_material: bool = False


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


def user_is_event_coteacher(user: User, event: ScheduleEvent) -> bool:
    """Соучитель: отдельная роль или organizer-участник, не являющийся owner."""
    if event.owner_id == user.pk:
        return False
    return event.participants.filter(
        role__in=[ParticipantRole.COTEACHER, ParticipantRole.ORGANIZER],
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
        return AccessResult(True, "staff", True, "", "ok", can_control_material=True)

    if profile is not None and profile.role == Profile.Role.PARENT:
        return AccessResult(
            False,
            "none",
            False,
            "У вас нет доступа к этому уроку",
            "no_access",
        )

    if event.owner_id == user.pk or (
        user_is_event_teacher(user, event) and not user_is_event_coteacher(user, event)
    ):
        # Owner / основной учитель.
        if event.owner_id == user.pk:
            return AccessResult(True, "teacher", True, "", "ok", can_control_material=True)
        return AccessResult(True, "teacher", True, "", "ok", can_control_material=True)

    if user_is_event_coteacher(user, event):
        return AccessResult(True, "coteacher", True, "", "ok", can_control_material=True)

    if user_is_event_teacher(user, event):
        return AccessResult(True, "teacher", True, "", "ok", can_control_material=True)

    if user_is_event_student(user, event):
        return AccessResult(True, "student", False, "", "ok", can_control_material=False)

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
    if access.role not in ("teacher", "coteacher", "staff"):
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
    """Комната создаётся один раз на событие; повторный вызов не меняет room_name/статус.

    Конкурентный первый вход сериализуется lock'ом строки ScheduleEvent, чтобы
    два запроса не создали две конференции.
    """
    if event.status == ScheduleEvent.Status.CANCELLED:
        raise VideoMeetingError("Нельзя создать комнату для отменённого урока", code="cancelled", status=409)
    if event.status in (ScheduleEvent.Status.DONE, ScheduleEvent.Status.COMPLETED):
        raise VideoMeetingError("Нельзя создать комнату для завершённого урока", code="finished", status=409)

    with transaction.atomic():
        locked_event = ScheduleEvent.objects.select_for_update().get(pk=event.pk)
        if locked_event.status == ScheduleEvent.Status.CANCELLED:
            raise VideoMeetingError("Нельзя создать комнату для отменённого урока", code="cancelled", status=409)
        if locked_event.status in (ScheduleEvent.Status.DONE, ScheduleEvent.Status.COMPLETED):
            raise VideoMeetingError("Нельзя создать комнату для завершённого урока", code="finished", status=409)

        existing = VideoMeeting.objects.filter(schedule_event=locked_event).first()
        if existing is not None:
            if existing.status == VideoMeeting.Status.CANCELLED:
                raise VideoMeetingError("Видеокомната этого урока отменена", code="cancelled", status=409)
            return existing, False

        access = resolve_access(created_by, locked_event)
        if not access.allowed or access.role not in ("teacher", "staff"):
            raise VideoMeetingError("Только учитель урока может создать видеокомнату", code="forbidden", status=403)

        _ensure_organizer(locked_event, locked_event.owner)
        try:
            meeting = VideoMeeting.objects.create(
                schedule_event=locked_event,
                room_name=generate_secure_room_name(),
                created_by=created_by,
                status=VideoMeeting.Status.SCHEDULED,
            )
            created = True
        except IntegrityError:
            meeting = VideoMeeting.objects.select_for_update().get(schedule_event=locked_event)
            created = False

        if created:
            update_fields = []
            if locked_event.meeting_provider in ("", MeetingProvider.NONE, MeetingProvider.MANUAL):
                locked_event.meeting_provider = MeetingProvider.JITSI
                update_fields.append("meeting_provider")
            if update_fields:
                locked_event.save(update_fields=update_fields + ["updated_at"])
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

        # Нормализуем room_name до первого входа в Jitsi. После LIVE имя замораживается.
        ensure_muc_safe_room_name(locked, allow_mutate=True)

        locked.status = VideoMeeting.Status.LIVE
        locked.actual_started_at = timezone.now()
        locked.save(update_fields=["status", "actual_started_at", "updated_at"])
    try:
        from .activation_events import LESSON_STARTED, record_event

        owner = meeting.schedule_event.owner if meeting.schedule_event_id else user
        record_event(
            LESSON_STARTED,
            owner,
            object_type="schedule_event",
            object_id=meeting.schedule_event_id,
            source="video_start",
        )
    except Exception:
        logger.exception("lesson_started analytics failed meeting=%s", getattr(meeting, "pk", None))
    return locked


def _close_live_meeting_locked(locked: VideoMeeting, *, now, reason: str) -> dict:
    """
    Техническое закрытие видеокомнаты.

    Не меняет ScheduleEvent.status и не трогает биллинг: факт окончания звонка
    не равен факту проведённого оплачиваемого занятия.
    """
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

    try:
        from .meeting_material_session import finalize_material_sessions_for_meeting

        finalize_material_sessions_for_meeting(locked)
    except Exception:
        logger.exception(
            "Failed to finalize material sessions meeting=%s reason=%s",
            locked.uuid,
            reason,
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

    logger.info(
        "video meeting closed meeting=%s event=%s reason=%s event_status=%s",
        locked.uuid,
        locked.schedule_event_id,
        reason,
        locked.schedule_event.status,
    )
    return presented_payload


def finish_meeting(*, meeting: VideoMeeting, user: User) -> VideoMeeting:
    assert_can_manage_meeting(user, meeting)
    now = timezone.now()
    with transaction.atomic():
        locked = VideoMeeting.objects.select_for_update().select_related("schedule_event").get(
            pk=meeting.pk
        )
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

        presented_payload = _close_live_meeting_locked(
            locked, now=now, reason="teacher_finish"
        )

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

        try:
            from .activation_events import LESSON_COMPLETED, maybe_record_core, record_event

            owner = locked.schedule_event.owner if locked.schedule_event_id else user
            record_event(
                LESSON_COMPLETED,
                owner,
                object_type="schedule_event",
                object_id=locked.schedule_event_id,
                source="video_finish",
            )
            maybe_record_core(
                owner,
                source="video_finish",
                object_type="schedule_event",
                object_id=locked.schedule_event_id,
            )
        except Exception:
            logger.exception("lesson_completed analytics failed meeting=%s", getattr(locked, "pk", None))

        return locked


def lesson_journal_next_step(event: ScheduleEvent) -> dict:
    return {
        "action": "complete_lesson_journal",
        "label": "Завершить занятие и заполнить журнал",
        "path": f"/cabinet/journal/lesson/{event.pk}?from=meeting",
        "eventId": event.pk,
        "eventStatus": event.status,
        "autoCompletesLesson": False,
    }


def touch_live_meeting_activity(meeting: VideoMeeting, *, now=None) -> None:
    """Heartbeat открытой LIVE-комнаты: не чаще, чем раз в LIVE_ACTIVITY_TOUCH_INTERVAL."""
    if meeting.status != VideoMeeting.Status.LIVE:
        return
    now = now or timezone.now()
    last = meeting.updated_at
    if last and now - last < LIVE_ACTIVITY_TOUCH_INTERVAL:
        return
    VideoMeeting.objects.filter(
        pk=meeting.pk,
        status=VideoMeeting.Status.LIVE,
    ).update(updated_at=now)
    meeting.updated_at = now


def _recent_open_attendance_exists(meeting: VideoMeeting, *, now, inactivity) -> bool:
    return meeting.attendance_sessions.filter(
        left_at__isnull=True,
        joined_at__gte=now - inactivity,
    ).exists()


def is_stale_live_meeting(
    meeting: VideoMeeting,
    *,
    now=None,
    after_event_end=STALE_LIVE_AFTER_EVENT_END,
    inactivity=STALE_LIVE_INACTIVITY,
) -> bool:
    now = now or timezone.now()
    if meeting.status != VideoMeeting.Status.LIVE:
        return False
    event = meeting.schedule_event
    if event.ends_at >= now - after_event_end:
        return False
    last_activity = meeting.updated_at or meeting.actual_started_at or meeting.created_at
    if last_activity and last_activity >= now - inactivity:
        return False
    if _recent_open_attendance_exists(meeting, now=now, inactivity=inactivity):
        return False
    return True


def expire_stale_live_meetings(
    *,
    now=None,
    dry_run=True,
    after_event_end=STALE_LIVE_AFTER_EVENT_END,
    inactivity=STALE_LIVE_INACTIVITY,
) -> dict:
    """
    Переводит явно протухшие LIVE-комнаты в finished.

    Не проводит занятие: ScheduleEvent и биллинг не меняются.
    """
    now = now or timezone.now()
    stale_before = now - inactivity
    candidates = (
        VideoMeeting.objects.filter(
            status=VideoMeeting.Status.LIVE,
            schedule_event__ends_at__lt=now - after_event_end,
        )
        .filter(Q(updated_at__lt=stale_before) | Q(updated_at__isnull=True))
        .select_related("schedule_event")
        .order_by("id")
    )
    report = {
        "dry_run": dry_run,
        "checked": 0,
        "expired": [],
        "skipped": [],
    }
    for meeting in candidates:
        report["checked"] += 1
        if not is_stale_live_meeting(
            meeting, now=now, after_event_end=after_event_end, inactivity=inactivity
        ):
            report["skipped"].append(
                {
                    "uuid": str(meeting.uuid),
                    "event_id": meeting.schedule_event_id,
                    "reason": "recent_activity_or_open_attendance",
                }
            )
            continue
        row = {
            "uuid": str(meeting.uuid),
            "event_id": meeting.schedule_event_id,
            "event_status": meeting.schedule_event.status,
            "ends_at": meeting.schedule_event.ends_at.isoformat(),
            "updated_at": meeting.updated_at.isoformat() if meeting.updated_at else None,
        }
        if dry_run:
            report["expired"].append(row)
            continue
        with transaction.atomic():
            locked = (
                VideoMeeting.objects.select_for_update()
                .select_related("schedule_event")
                .get(pk=meeting.pk)
            )
            if not is_stale_live_meeting(
                locked, now=now, after_event_end=after_event_end, inactivity=inactivity
            ):
                report["skipped"].append(
                    {
                        "uuid": str(meeting.uuid),
                        "event_id": meeting.schedule_event_id,
                        "reason": "changed_before_lock",
                    }
                )
                continue
            _close_live_meeting_locked(locked, now=now, reason="stale_watchdog")
            row["event_status_after"] = locked.schedule_event.status
            report["expired"].append(row)
    return report


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


def _notify_student_entered_after_join(meeting, user, *, is_new_session: bool):
    try:
        from .models import Profile
        from .teacher_notifications import notify_teacher_student_entered_room

        profile = getattr(user, "profile", None)
        if profile is None or profile.role != Profile.Role.STUDENT:
            return
        teacher = meeting.schedule_event.owner
        if not teacher or teacher.pk == user.pk:
            return
        notify_teacher_student_entered_room(
            teacher=teacher,
            student_user=user,
            meeting=meeting,
            is_new_session=is_new_session,
        )
    except Exception:
        logger.exception("Failed to notify teacher about student room enter")


def record_attendance_join(
    *,
    meeting: VideoMeeting,
    user: User,
    jitsi_participant_id: str = "",
) -> MeetingAttendance:
    """
    Идемпотентный вход: при открытой сессии того же пользователя возвращаем её.
    После короткого выхода (reload / сеть) в пределах grace — продолжаем ту же сессию.
    """
    assert_can_join_meeting(user, meeting, for_config=False)
    now = timezone.now()
    participant_id = (jitsi_participant_id or "").strip()[:255]
    is_new_session = False

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

        recent = (
            MeetingAttendance.objects.select_for_update()
            .filter(meeting=meeting, user=user, left_at__isnull=False)
            .order_by("-left_at")
            .first()
        )
        if (
            recent
            and recent.left_at
            and (now - recent.left_at) <= ATTENDANCE_RECONNECT_GRACE
        ):
            recent.left_at = None
            recent.duration_seconds = 0
            if participant_id:
                recent.jitsi_participant_id = participant_id
                recent.save(
                    update_fields=["left_at", "duration_seconds", "jitsi_participant_id"]
                )
            else:
                recent.save(update_fields=["left_at", "duration_seconds"])
            return recent

        if not participant_id:
            logger.info(
                "attendance join without jitsi_participant_id meeting=%s user=%s",
                meeting.uuid,
                user.pk,
            )
        session = MeetingAttendance.objects.create(
            meeting=meeting,
            user=user,
            joined_at=now,
            jitsi_participant_id=participant_id,
        )
        is_new_session = True

    if is_new_session:
        _notify_student_entered_after_join(meeting, user, is_new_session=True)
    return session


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


def _session_display_name(user: User) -> str:
    profile = getattr(user, "profile", None)
    name = profile.get_display_name() if profile else ""
    if not name:
        name = user.get_full_name() or user.username
    return name


def _session_end(session: MeetingAttendance, *, now=None):
    if session.left_at:
        return session.left_at
    return now or timezone.now()


def coalesce_attendance_sessions(
    sessions: list[MeetingAttendance],
    *,
    grace: timedelta = ATTENDANCE_RECONNECT_GRACE,
    now=None,
) -> list[dict]:
    """
    Склеивает короткие разрывы одного участника в непрерывное присутствие.
    Полезно и для уже записанных фрагментов после reload.
    """
    now = now or timezone.now()
    by_user: dict[int, list[MeetingAttendance]] = {}
    for row in sessions:
        by_user.setdefault(row.user_id, []).append(row)

    result = []
    for user_id, user_sessions in by_user.items():
        ordered = sorted(user_sessions, key=lambda s: s.joined_at)
        if not ordered:
            continue

        segments = []
        cur_start = ordered[0].joined_at
        cur_end = _session_end(ordered[0], now=now)
        cur_open = ordered[0].left_at is None
        ids = [ordered[0].pk]

        for session in ordered[1:]:
            sess_end = _session_end(session, now=now)
            gap = session.joined_at - cur_end
            if gap <= grace:
                if sess_end > cur_end:
                    cur_end = sess_end
                cur_open = cur_open or session.left_at is None
                ids.append(session.pk)
            else:
                segments.append((cur_start, cur_end, cur_open, ids))
                cur_start = session.joined_at
                cur_end = sess_end
                cur_open = session.left_at is None
                ids = [session.pk]
        segments.append((cur_start, cur_end, cur_open, ids))

        user = ordered[0].user
        name = _session_display_name(user)
        for start, end, still_open, seg_ids in segments:
            duration = max(0, int((end - start).total_seconds()))
            result.append({
                "id": seg_ids[0],
                "userId": user_id,
                "displayName": name,
                "joinedAt": start.isoformat(),
                "leftAt": None if still_open else end.isoformat(),
                "durationSeconds": duration,
                "jitsiParticipantId": "",
                "sessionCount": len(seg_ids),
            })

    result.sort(key=lambda row: row["joinedAt"], reverse=True)
    return result


def list_attendance_for_teacher(*, meeting: VideoMeeting, user: User) -> list[dict]:
    assert_can_manage_meeting(user, meeting)
    rows = list(
        MeetingAttendance.objects.filter(meeting=meeting)
        .select_related("user", "user__profile")
        .order_by("joined_at")
    )
    return coalesce_attendance_sessions(rows)


def ensure_muc_safe_room_name(meeting: VideoMeeting, *, allow_mutate: bool = False) -> str:
    """Канонический room_name. После старта урока имя нельзя менять — иначе участники разойдутся по MUC."""
    current = meeting.room_name or ""
    safe = sanitize_room_name(current)
    if safe == current:
        return current
    meeting.refresh_from_db(fields=["status", "room_name"])
    current = meeting.room_name or ""
    safe = sanitize_room_name(current)
    if safe == current:
        return current
    # LIVE/FINISHED: оба клиента должны получить тот же идентификатор, что уже в Jitsi.
    if not allow_mutate or meeting.status != VideoMeeting.Status.SCHEDULED:
        logger.warning(
            "jitsi_room_name_frozen meeting_uuid=%s status=%s room_name=%s",
            meeting.uuid,
            meeting.status,
            current,
        )
        return current
    with transaction.atomic():
        locked = VideoMeeting.objects.select_for_update().get(pk=meeting.pk)
        if locked.status != VideoMeeting.Status.SCHEDULED:
            meeting.room_name = locked.room_name
            return locked.room_name
        safe = sanitize_room_name(locked.room_name or "")
        if safe != locked.room_name:
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
    # join-config никогда не генерирует и не переименовывает комнату.
    room_name = ensure_muc_safe_room_name(meeting, allow_mutate=False)
    event = meeting.schedule_event
    user_info = build_user_info(user, request)
    display_name = str(user_info.get("displayName") or "").strip()
    if not display_name:
        # Защита: пустое имя ломает prejoin («Присоединиться» не пускает).
        user_info["displayName"] = f"Пользователь {user.pk}"
        display_name = user_info["displayName"]

    jwt_token = None
    try:
        configured_ttl = int(getattr(settings, "JITSI_TOKEN_TTL_SECONDS", 7200) or 7200)
        # Live-урок 60–120 мин не должен обрываться из-за exp. Не wildcard и не бессрочный токен.
        live_ttl = max(configured_ttl, 4 * 3600)
        jwt_token = generate_jitsi_jwt(
            room_name=room_name,
            user=user,
            is_moderator=access.is_moderator,
            request=request,
            ttl_seconds=live_ttl,
        )
    except JitsiConfigError as exc:
        raise VideoMeetingError(str(exc), code="jwt_config", status=503) from exc

    auth_mode = get_jitsi_auth_mode()
    # Важно: используем эффективный режим (в т.ч. auto-jwt на своём домене),
    # а не сырой JITSI_AUTH_MODE — иначе JWT может отсутствовать при AUTH_MODE=none.
    if auth_mode == "jwt" and not jwt_token:
        raise VideoMeetingError("Не удалось сформировать JWT", code="jwt_missing", status=503)

    teacher_name = ""
    owner = event.owner
    owner_profile = getattr(owner, "profile", None)
    if owner_profile is not None:
        teacher_name = owner_profile.get_display_name()
    if not teacher_name:
        teacher_name = owner.get_full_name() or owner.username

    domain = get_jitsi_domain()
    # Без JWT публичный meet.jit.si (и любой хост с wait-for-moderator) не даёт
    # права организатора из профиля — учителю нужно жать «Я организатор».
    requires_moderator_login = bool(access.is_moderator and not jwt_token)

    # join-config никогда не генерирует новую комнату — только сохранённый room_name.
    meeting.refresh_from_db(fields=["room_name"])
    if room_name != meeting.room_name:
        raise VideoMeetingError(
            "Несогласованное имя комнаты видеозанятия",
            code="room_mismatch",
            status=500,
        )

    jwt_claims: dict = {}
    jwt_exp_iso = None
    if jwt_token:
        try:
            jwt_claims = decode_jitsi_jwt_unsafe_for_tests(jwt_token)
        except Exception:
            jwt_claims = {}
        exp_dt = jwt_expires_at(jwt_token)
        jwt_exp_iso = exp_dt.isoformat() if exp_dt else None
        jwt_room = str(jwt_claims.get("room") or "")
        if jwt_room and jwt_room != room_name:
            raise VideoMeetingError(
                "JWT room не совпадает с roomName конференции",
                code="jwt_room_mismatch",
                status=500,
            )

    config_endpoint = f"/api/video-meetings/{meeting.uuid}/join-config/"
    logger.info(
        "jitsi_join_config lesson_id=%s schedule_event_id=%s meeting_uuid=%s "
        "user_id=%s role=%s room_name=%s domain=%s auth_mode=%s is_moderator=%s "
        "password_required=%s has_jwt=%s jwt_aud=%s jwt_iss=%s jwt_sub=%s "
        "jwt_room=%s jwt_exp=%s endpoint=%s",
        event.lesson_id or "",
        event.pk,
        meeting.uuid,
        user.pk,
        access.role,
        meeting.room_name,
        domain,
        auth_mode,
        access.is_moderator,
        False,
        bool(jwt_token),
        jwt_claims.get("aud", ""),
        jwt_claims.get("iss", ""),
        jwt_claims.get("sub", "") or get_jitsi_sub(),
        jwt_claims.get("room", room_name),
        jwt_exp_iso or "",
        config_endpoint,
    )

    subject = lesson_meeting_subject(event)
    audience = lesson_meeting_audience(event)

    return {
        "domain": domain,
        "roomName": meeting.room_name,
        "jwt": jwt_token,
        "authMode": auth_mode,
        "requiresModeratorLogin": requires_moderator_login,
        # Приложения не задаёт пароль комнаты Jitsi; «пароль» в UI Jitsi = token auth.
        "passwordRequired": False,
        "conferencePassword": None,
        "userInfo": user_info,
        "diagnostics": {
            "lessonId": event.lesson_id,
            "scheduleEventId": event.pk,
            "meetingUuid": str(meeting.uuid),
            "userId": user.pk,
            "role": access.role,
            "roomName": meeting.room_name,
            "domain": domain,
            "jwtAud": jwt_claims.get("aud"),
            "jwtIss": jwt_claims.get("iss"),
            "jwtSub": jwt_claims.get("sub") or get_jitsi_sub(),
            "jwtRoom": jwt_claims.get("room") or room_name,
            "jwtExp": jwt_exp_iso,
            "isModerator": access.is_moderator,
            "passwordRequired": False,
            "conferencePassword": None,
            "configEndpoint": config_endpoint,
        },
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


# Диагностическая комната Jitsi: не VideoMeeting, не урок, короткий JWT.
DIAGNOSTIC_ROOM_PREFIX = "diag"
DIAGNOSTIC_JWT_TTL_SECONDS = 180


def build_connection_probe_config(*, user: User, request=None) -> dict:
    """
    Конфиг проверки Jitsi без создания VideoMeeting и без побочных эффектов урока.

    Комната diagnostic_* живёт только на сервере Jitsi (если клиент её откроет)
    и не попадает в расписание, посещаемость, журнал и биллинг.
    """
    domain = get_jitsi_domain()
    auth_mode = get_jitsi_auth_mode()
    room_name = f"{DIAGNOSTIC_ROOM_PREFIX}{secrets.token_hex(16)}"
    user_info = build_user_info(user, request)
    display_name = str(user_info.get("displayName") or "").strip() or f"Пользователь {user.pk}"

    jwt_token = None
    jwt_ready = auth_mode != "jwt"
    if auth_mode == "jwt":
        try:
            jwt_token = generate_jitsi_jwt(
                room_name=room_name,
                user=user,
                is_moderator=True,
                request=request,
                ttl_seconds=DIAGNOSTIC_JWT_TTL_SECONDS,
            )
            jwt_ready = bool(jwt_token)
        except JitsiConfigError as exc:
            logger.warning(
                "jitsi_connection_probe_jwt_error user_id=%s domain=%s error=%s",
                user.pk,
                domain,
                exc,
            )
            jwt_ready = False

    logger.info(
        "jitsi_connection_probe user_id=%s domain=%s auth_mode=%s has_jwt=%s jwt_ready=%s room=%s",
        user.pk,
        domain,
        auth_mode,
        bool(jwt_token),
        jwt_ready,
        room_name,
    )

    return {
        "domain": domain,
        "roomName": room_name,
        "jwt": jwt_token,
        "authMode": auth_mode,
        "scriptUrl": f"https://{domain}/libs/external_api.min.js",
        "userInfo": {"displayName": display_name},
        "jwtReady": jwt_ready,
        "probe": True,
        "ttlSeconds": DIAGNOSTIC_JWT_TTL_SECONDS if jwt_token else None,
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
        "materialSession": _serialize_active_material_session(meeting, user=user),
    }


def _serialize_active_material_session(meeting: VideoMeeting, *, user: User | None = None) -> dict | None:
    try:
        from .meeting_material_session import get_active_material_session, serialize_material_session

        return serialize_material_session(get_active_material_session(meeting), user=user, include_state=True)
    except Exception:
        logger.exception("Failed to serialize material session meeting=%s", meeting.uuid)
        return None


def serialize_meeting_compact(meeting: VideoMeeting) -> dict:
    page_url = meeting_page_url(meeting)
    return {
        "uuid": str(meeting.uuid),
        "status": meeting.status,
        "joinUrl": page_url,
        "pageUrl": page_url,
    }


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
