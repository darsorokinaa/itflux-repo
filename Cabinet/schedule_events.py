from django.utils import timezone

from .choices import ParticipantStatus
from .models import ScheduleEvent
from .plan_schedule import (
    get_active_enrollment,
    resolve_plan_item_for_event,
)


def local_event_id(pk):
    return f"local-{pk}"


def logical_series_key(event):
    if event.series_id:
        return f"series-{event.series_id}"
    if not event.is_recurring_instance:
        return None
    parts = [str(event.owner_id), (event.title or "").strip().lower()]
    if event.student_id:
        parts.append(f"student-{event.student_id}")
    elif event.group_id:
        parts.append(f"group-{event.group_id}")
    else:
        return None
    return "orphan-" + "-".join(parts)


def parse_local_event_id(event_id):
    if not event_id:
        return None
    text = str(event_id).strip()
    if text.startswith("local-"):
        text = text[6:]
    if text.isdigit():
        return int(text)
    return None


def _material_to_json(material):
    return {
        "id": material.id,
        "title": material.title,
        "description": material.description or "",
        "materialType": material.material_type,
        "materialTypeLabel": material.get_material_type_display(),
        "topic": material.topic or "",
        "subtopic": material.subtopic or "",
        "externalUrl": material.external_url or "",
        "fileUrl": material.file.url if material.file else "",
    }


def _interactive_to_json(interactive):
    return {
        "id": interactive.id,
        "title": interactive.title,
        "interactiveType": interactive.interactive_type,
        "interactiveTypeLabel": interactive.get_interactive_type_display(),
        "topic": interactive.topic or "",
        "subtopic": interactive.subtopic or "",
    }


def _plan_item_to_json(item, *, lesson_number=None):
    linked = getattr(item, "linked_lesson", None)
    return {
        "id": item.id,
        "order": item.order,
        "lessonNumber": lesson_number if lesson_number is not None else item.order,
        "title": item.title,
        "topic": item.topic or "",
        "subtopic": item.subtopic or "",
        "taskNumber": item.task_number or "",
        "goal": item.goal or "",
        "description": item.description or "",
        "teacherComment": item.teacher_comment or "",
        "planTitle": item.plan.title if item.plan_id else "",
        "linkedLessonId": item.linked_lesson_id,
        "linkedLessonTitle": linked.title if linked else "",
        "lessonMaterialsNotes": item.lesson_materials_notes or "",
        "materials": [_material_to_json(m) for m in item.materials.all()],
        "attachedInteractives": [_interactive_to_json(i) for i in item.attached_interactives.all()],
        "homeworkMaterials": [_material_to_json(m) for m in item.homework_materials.all()],
        "homeworkInteractives": [_interactive_to_json(i) for i in item.homework_interactives.all()],
        "homeworkDescription": item.homework_description or "",
    }


def _participants_to_json(event):
    participants = []
    for participant in event.participants.exclude(status=ParticipantStatus.REMOVED):
        name = (participant.display_name or "").strip()
        if not name and participant.student_id and participant.student:
            name = participant.student.full_name
        if not name and participant.teacher_id and participant.teacher:
            name = participant.teacher.get_full_name() or participant.teacher.username
        if not name and participant.user_id and participant.user:
            name = participant.user.get_full_name() or participant.user.username
        if not name:
            continue
        participants.append({
            "name": name,
            "role": participant.role,
            "roleLabel": participant.get_role_display(),
        })

    if not participants and event.student_id and getattr(event, "student", None):
        participants.append({
            "name": event.student.full_name,
            "role": "student",
            "roleLabel": "Ученик",
        })
    elif not participants and event.group_id and getattr(event, "group", None):
        participants.append({
            "name": event.group.title,
            "role": "group",
            "roleLabel": "Группа",
        })
    elif not participants and event.audience:
        participants.append({
            "name": event.audience,
            "role": "audience",
            "roleLabel": "Участники",
        })

    return participants


def schedule_event_to_json(event):
    local_start = timezone.localtime(event.starts_at)
    local_end = timezone.localtime(event.ends_at)
    today = timezone.localdate()
    link = (event.telemost_url or "").strip() or None
    is_online = event.format == ScheduleEvent.Format.ONLINE
    video_meeting_json = None
    # Reverse OneToOne raises DoesNotExist — не используем getattr.
    try:
        from .models import VideoMeeting
        meeting = VideoMeeting.objects.filter(schedule_event_id=event.pk).first()
    except Exception:
        meeting = None
    if meeting is not None:
        from .video_meeting_service import meeting_join_window_state, ui_state_message
        join_state = meeting_join_window_state(event, meeting)
        video_meeting_json = {
            "uuid": str(meeting.uuid),
            "status": meeting.status,
            "statusLabel": meeting.get_status_display(),
            "joinState": join_state,
            "joinStateLabel": ui_state_message(join_state),
            "pageUrl": f"/cabinet/meetings/{meeting.uuid}",
        }
        if not link and meeting.status in ("scheduled", "live"):
            link = video_meeting_json["pageUrl"]

    recurrence = None
    series_id = None
    if event.series_id:
        series_id = f"series-{event.series_id}"
        s = event.series
        recurrence = {
            "type": s.recurrence_type,
            "interval": s.recurrence_interval,
            "weekdays": s.recurrence_weekdays or [],
            "until": s.recurrence_until.isoformat() if s.recurrence_until else None,
            "count": s.recurrence_count,
        }

    participant_ids = list(
        event.participants.exclude(status=ParticipantStatus.REMOVED).values_list("student_id", flat=True)
    )
    plan_item, lesson_number = resolve_plan_item_for_event(event)
    plan_item_json = _plan_item_to_json(plan_item, lesson_number=lesson_number) if plan_item else None
    participants = _participants_to_json(event)
    audience = event.audience or ""
    if not audience and participants:
        audience = ", ".join(p["name"] for p in participants if p["role"] != "organizer")

    topic = event.topic or ""
    if plan_item_json:
        topic = plan_item_json.get("topic") or plan_item_json.get("title") or topic

    has_plan = plan_item_json is not None or get_active_enrollment(event) is not None

    return {
        "id": local_event_id(event.pk),
        "dayOffset": (local_start.date() - today).days,
        "startsAt": local_start.isoformat(),
        "endsAt": local_end.isoformat(),
        "startTime": local_start.strftime("%H:%M"),
        "endTime": local_end.strftime("%H:%M"),
        "title": event.title,
        "topic": topic,
        "type": event.event_type,
        "audience": audience,
        "format": "Онлайн" if is_online else "Офлайн",
        "link": link,
        "videoMeeting": video_meeting_json,
        "meetingProvider": event.meeting_provider,
        "materials": event.materials or "",
        "status": event.status,
        "statusLabel": event.get_status_display(),
        "tags": event.tags or [],
        "source": "local",
        "readOnly": False,
        "seriesId": series_id,
        "logicalSeriesKey": logical_series_key(event),
        "recurrence": recurrence,
        "isRecurring": bool(event.series_id and event.is_recurring_instance),
        "hasOrphanSeries": bool(
            not event.series_id
            and event.is_recurring_instance
        ),
        "studentId": event.student_id,
        "groupId": event.group_id,
        "lessonId": event.lesson_id,
        "lessonPlanItemId": plan_item.id if plan_item else event.lesson_plan_item_id,
        "planLessonNumber": lesson_number,
        "hasPlan": has_plan,
        "timezone": event.timezone,
        "reminderMinutes": event.reminder_minutes,
        "participantStudentIds": [x for x in participant_ids if x],
        "participants": participants,
        "planItem": plan_item_json,
        "planItems": [plan_item_json] if plan_item_json else [],
        "teacherComment": event.teacher_comment or "",
    }


def list_schedule_events(*, user, date_from, date_to, include_cancelled=False):
    qs = ScheduleEvent.objects.filter(
        owner=user,
        starts_at__date__lte=date_to,
        ends_at__date__gte=date_from,
    ).select_related(
        "series",
        "series__lesson_plan_item",
        "series__lesson_plan_item__plan",
        "student",
        "group",
        "lesson_plan_item",
        "lesson_plan_item__plan",
        "lesson_plan_item__linked_lesson",
    ).prefetch_related(
        "participants",
        "participants__student",
        "participants__teacher",
        "participants__user",
        "plan_items",
        "plan_items__materials",
        "plan_items__attached_interactives",
        "plan_items__homework_materials",
        "plan_items__homework_interactives",
        "plan_items__plan",
        "lesson_plan_item__materials",
        "lesson_plan_item__attached_interactives",
        "lesson_plan_item__homework_materials",
        "lesson_plan_item__homework_interactives",
        "series__lesson_plan_item__materials",
        "series__lesson_plan_item__attached_interactives",
        "series__lesson_plan_item__homework_materials",
        "series__lesson_plan_item__homework_interactives",
    )
    if not include_cancelled:
        qs = qs.exclude(status=ScheduleEvent.Status.CANCELLED)
    return [schedule_event_to_json(ev) for ev in qs.order_by("starts_at")]
