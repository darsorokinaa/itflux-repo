"""Ранний вход ученика в комнату урока (экран ожидания до прихода учителя).

Окно раннего входа: [starts_at − EARLY_ENTRY_BEFORE, ends_at].
Все сравнения — в UTC (aware datetime из БД), поэтому часовой пояс учителя
и ученика на окно не влияет: он нужен только для отображения времени.

Что НЕ меняется:
- join-config / JWT Jitsi и LiveKit по-прежнему выдаются только при status=live
  (после «Начать урок» учителем) и только с ролью из resolve_access —
  ученик никогда не получает moderator/owner;
- ученик не стартует урок, запись, лобби и не меняет room_name;
- проверка камеры/микрофона/связи идёт в отдельной диагностической комнате
  (connection-probe), а не в комнате урока.
"""

from __future__ import annotations

from datetime import timedelta

from django.contrib.auth.models import User
from django.utils import timezone

from .choices import MeetingProvider
from .models import ScheduleEvent, VideoMeeting

EARLY_ENTRY_BEFORE = timedelta(minutes=15)

_NON_LESSON_EVENT_TYPES = frozenset(
    {
        ScheduleEvent.EventType.HOMEWORK,
        ScheduleEvent.EventType.REVIEW,
        ScheduleEvent.EventType.HOMEWORK_DEADLINE,
        ScheduleEvent.EventType.PERSONAL,
        ScheduleEvent.EventType.BLOCKED,
    }
)


def early_entry_window(event: ScheduleEvent):
    """(opens_at, closes_at) в UTC."""
    return event.starts_at - EARLY_ENTRY_BEFORE, event.ends_at


def event_supports_platform_room(event: ScheduleEvent) -> bool:
    """Урок онлайн на платформенной комнате (не Телемост/не внешняя ссылка)."""
    if event.format != ScheduleEvent.Format.ONLINE:
        return False
    if event.event_type in _NON_LESSON_EVENT_TYPES:
        return False
    provider = event.meeting_provider or ""
    if provider == MeetingProvider.JITSI:
        return True
    if provider in ("", MeetingProvider.NONE, MeetingProvider.MANUAL):
        # Ручная внешняя ссылка учителя — не подменяем её своей комнатой.
        return not (event.meeting_url or "").strip()
    return False


def early_entry_eligible(event: ScheduleEvent, meeting: VideoMeeting | None = None) -> bool:
    """Урок в принципе может иметь ранний вход (без учёта текущего времени)."""
    if event.status != ScheduleEvent.Status.PLANNED:
        return False
    if meeting is not None:
        if meeting.status in (VideoMeeting.Status.FINISHED, VideoMeeting.Status.CANCELLED):
            return False
        return True
    return event_supports_platform_room(event)


def early_entry_state(event: ScheduleEvent, meeting: VideoMeeting | None = None, *, now=None) -> str:
    """not_eligible | too_early | open | closed."""
    if not early_entry_eligible(event, meeting):
        return "not_eligible"
    now = now or timezone.now()
    opens_at, closes_at = early_entry_window(event)
    if now < opens_at:
        return "too_early"
    if now > closes_at:
        return "closed"
    return "open"


def serialize_early_entry(event: ScheduleEvent, meeting: VideoMeeting | None = None, *, now=None) -> dict:
    opens_at, closes_at = early_entry_window(event)
    state = early_entry_state(event, meeting, now=now)
    return {
        "eligible": state != "not_eligible",
        "state": state,
        "open": state == "open",
        "opensAt": opens_at.isoformat(),
        "closesAt": closes_at.isoformat(),
        "beforeMinutes": int(EARLY_ENTRY_BEFORE.total_seconds() // 60),
    }


def student_room_entry_path(event: ScheduleEvent) -> str:
    """Страница-переходник: создаёт (при необходимости) комнату и ведёт в неё."""
    return f"/cabinet/student/lessons/room/{event.pk}"


def assert_student_early_access(user: User, event: ScheduleEvent, meeting: VideoMeeting | None, *, now=None):
    """Ученик этого урока (для группы — участник группы) и окно открыто."""
    from .video_meeting_service import VideoMeetingError, resolve_access

    access = resolve_access(user, event)
    if not access.allowed:
        raise VideoMeetingError(access.reason or "Доступ запрещён", code="forbidden", status=403)
    if access.role != "student":
        raise VideoMeetingError("Экран ожидания доступен ученикам урока", code="forbidden", status=403)
    if meeting is not None and meeting.status == VideoMeeting.Status.LIVE:
        return access
    state = early_entry_state(event, meeting, now=now)
    if state == "too_early":
        raise VideoMeetingError(
            f"Комната откроется за {int(EARLY_ENTRY_BEFORE.total_seconds() // 60)} минут до начала урока",
            code="too_early",
            status=409,
        )
    if state == "closed":
        raise VideoMeetingError("Время урока прошло", code="window_closed", status=409)
    if state == "not_eligible":
        if meeting is not None and meeting.status == VideoMeeting.Status.FINISHED:
            raise VideoMeetingError("Урок завершён", code="finished", status=409)
        if event.status == ScheduleEvent.Status.CANCELLED or (
            meeting is not None and meeting.status == VideoMeeting.Status.CANCELLED
        ):
            raise VideoMeetingError("Урок отменён", code="cancelled", status=409)
        raise VideoMeetingError("Для этого урока нет комнаты на платформе", code="no_room", status=409)
    return access


def ensure_meeting_for_student_early_entry(*, user: User, event: ScheduleEvent, now=None) -> VideoMeeting:
    """Возвращает (или создаёт в статусе scheduled) комнату урока для ученика в окне.

    Комната создаётся от имени учителя урока (created_by = owner), статус не меняется:
    урок становится live только по «Начать урок» учителя.
    """
    from .video_meeting_service import get_or_create_meeting_for_event

    meeting = VideoMeeting.objects.filter(schedule_event=event).first()
    assert_student_early_access(user, event, meeting, now=now)
    if meeting is not None:
        return meeting
    meeting, _created = get_or_create_meeting_for_event(event=event, created_by=event.owner)
    return meeting


# ---------------------------------------------------------------------------
# Содержимое экрана ожидания
# ---------------------------------------------------------------------------

_OPEN_HOMEWORK_STATES = ("new", "in_progress", "overdue", "needs_fix")
MAX_HOMEWORK_REMINDERS = 3
MAX_MATERIALS = 8


def _students_for_event(user: User, event: ScheduleEvent):
    """Карточки ученика у учителя этого урока, которые относятся к уроку."""
    from .models import Student

    qs = Student.objects.filter(user=user, status="active", teacher_id=event.owner_id)
    ids = []
    for student in qs:
        if event.student_id == student.id:
            ids.append(student.id)
        elif event.group_id and event.group.students.filter(id=student.id).exists():
            ids.append(student.id)
        elif event.participants.filter(student_id=student.id).exists():
            ids.append(student.id)
    return list(Student.objects.filter(id__in=ids)) or list(qs)


def _homework_reminders(students, event: ScheduleEvent) -> list[dict]:
    from .choices import HomeworkStatus
    from .student_api import _homework_qs, _homework_student_status

    if not students:
        return []
    items = []
    hws = (
        _homework_qs(students)
        .filter(teacher_id=event.owner_id)
        .exclude(status=HomeworkStatus.ARCHIVED)
        .order_by("-created_at", "-id")[:30]
    )
    for hw in hws:
        student = next((s for s in students if hw.student_id in (None, s.id)), students[0])
        state, _label, _sub = _homework_student_status(hw, student)
        if state not in _OPEN_HOMEWORK_STATES:
            continue
        items.append(
            {
                "id": hw.id,
                "title": hw.title or "Домашнее задание",
                "state": "needs_fix" if state == "needs_fix" else "not_submitted",
                "text": (
                    f"Домашнее задание «{hw.title}» вернулось на доработку"
                    if state == "needs_fix"
                    else f"Домашнее задание «{hw.title}» ещё не сдано"
                ),
                "href": f"/cabinet/student/assignments/{hw.id}",
            }
        )
        if len(items) >= MAX_HOMEWORK_REMINDERS:
            break
    return items


def _previous_topic(students, event: ScheduleEvent) -> dict | None:
    from .journal_models import JournalStatus, RecordPublishStatus, StudentLessonRecord

    if not students:
        return None
    record = (
        StudentLessonRecord.objects.filter(
            student__in=students,
            journal__teacher_id=event.owner_id,
            journal__is_archived=False,
            journal__schedule_event__starts_at__lt=event.starts_at,
            visible_to_student=True,
            publish_status__in=[
                RecordPublishStatus.PUBLISHED,
                RecordPublishStatus.EDITED_AFTER_PUBLISH,
            ],
        )
        .exclude(journal__status=JournalStatus.CANCELLED)
        .exclude(journal__schedule_event_id=event.pk)
        .select_related("journal")
        .order_by("-journal__schedule_event__starts_at", "-journal__id")
        .first()
    )
    if record is None:
        return None
    topic = (record.journal.actual_topic or record.journal.planned_topic or "").strip()
    if not topic:
        return None
    return {"topic": topic, "text": f"Повторите тему «{topic}»."}


def event_attached_materials(event: ScheduleEvent) -> list:
    """Материалы, прикреплённые учителем к этому уроку: в расписании
    (ScheduleEventMaterial), в пункте плана урока и в выданном уроке (Lesson).
    Только опубликованные; ДЗ-материалы плана сюда не входят."""
    from .choices import MaterialStatus
    from .models import Material, ScheduleEventMaterial
    from .plan_schedule import resolve_plan_item_for_event

    ids: list[int] = []
    for mid in (
        ScheduleEventMaterial.objects.filter(event=event, material__isnull=False)
        .order_by("order", "id")
        .values_list("material_id", flat=True)
    ):
        ids.append(mid)
    try:
        plan_item, _num = resolve_plan_item_for_event(event)
    except Exception:
        plan_item = None
    if plan_item is not None:
        ids.extend(plan_item.materials.values_list("id", flat=True))
    if event.lesson_id:
        ids.extend(event.lesson.materials.values_list("id", flat=True))
    seen, ordered = set(), []
    for mid in ids:
        if mid not in seen:
            seen.add(mid)
            ordered.append(mid)
    by_id = {
        m.id: m
        for m in Material.objects.filter(
            id__in=ordered, status=MaterialStatus.PUBLISHED, teacher_id=event.owner_id
        ).select_related("cabinet_file")
    }
    return [by_id[mid] for mid in ordered if mid in by_id]


def _event_q_for_students(student_ids):
    from django.db.models import Q

    return (
        Q(student_id__in=student_ids)
        | Q(group__students__id__in=student_ids)
        | Q(participants__student_id__in=student_ids)
    )


def open_waiting_events_for_user(user: User, *, now=None) -> list:
    """Уроки, где пользователь — ученик и окно раннего входа (или урок live) сейчас открыто."""
    from .models import Student
    from .video_meeting_service import resolve_access

    if not user or not getattr(user, "is_authenticated", False):
        return []
    student_ids = list(Student.objects.filter(user=user, status="active").values_list("id", flat=True))
    if not student_ids:
        return []
    now = now or timezone.now()
    candidates = (
        ScheduleEvent.objects.filter(
            status=ScheduleEvent.Status.PLANNED,
            starts_at__lte=now + EARLY_ENTRY_BEFORE,
            ends_at__gte=now - timedelta(hours=3),
        )
        .filter(_event_q_for_students(student_ids))
        .select_related("owner", "lesson", "group")
        .distinct()[:10]
    )
    out = []
    for event in candidates:
        meeting = VideoMeeting.objects.filter(schedule_event=event).first()
        live = meeting is not None and meeting.status == VideoMeeting.Status.LIVE
        if not live and early_entry_state(event, meeting, now=now) != "open":
            continue
        if resolve_access(user, event).role != "student":
            continue
        out.append(event)
    return out


def student_can_access_waiting_material(user: User, material, *, now=None) -> bool:
    """Доп. правило доступа к файлу/ссылке материала: материал прикреплён к уроку,
    где пользователь — ученик, и окно урока открыто сейчас. Вне окна — нет."""
    if material is None:
        return False
    for event in open_waiting_events_for_user(user, now=now):
        if any(m.id == material.id for m in event_attached_materials(event)):
            return True
    return False


def student_can_read_file_via_waiting_room(user: User, file_obj, *, now=None) -> bool:
    from .models import Material

    materials = list(Material.objects.filter(cabinet_file=file_obj))
    return any(student_can_access_waiting_material(user, m, now=now) for m in materials)


def _lesson_materials(students, event: ScheduleEvent) -> list[dict]:
    """Материалы к уроку (расписание, план, выданный урок). Ссылки — через
    обычные авторизованные адреса ученика; права на файл проверяются там же
    (files_services), включая правило окна раннего входа."""
    from .files_services import material_file_url, material_view_url

    if not students:
        return []
    out = []
    for material in event_attached_materials(event)[:MAX_MATERIALS]:
        view_url = material_view_url(material, for_student=True)
        file_url = material_file_url(material, for_student=True)
        external = (material.external_url or "").strip()
        href = view_url or file_url or external
        if href and not (href.startswith("/api/cabinet/student/") or href.startswith("https://")):
            href = ""
        out.append(
            {
                "id": material.id,
                "title": material.title or "Материал",
                "typeLabel": material.get_material_type_display(),
                "href": href,
                "downloadUrl": file_url if file_url.startswith("/api/cabinet/student/") else "",
            }
        )
    return out


def build_waiting_room_payload(*, user: User, meeting: VideoMeeting, now=None) -> dict:
    event = meeting.schedule_event
    assert_student_early_access(user, event, meeting, now=now)
    students = _students_for_event(user, event)
    return {
        "meetingUuid": str(meeting.uuid),
        "status": meeting.status,
        "earlyEntry": serialize_early_entry(event, meeting, now=now),
        "startsAt": event.starts_at.isoformat(),
        "endsAt": event.ends_at.isoformat(),
        "reminders": {
            "homework": _homework_reminders(students, event),
            "previousTopic": _previous_topic(students, event),
        },
        "materials": _lesson_materials(students, event),
    }
