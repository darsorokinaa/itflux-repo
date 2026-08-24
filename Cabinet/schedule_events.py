from django.utils import timezone

from .choices import HomeworkStatus, ParticipantStatus
from .models import Homework, ScheduleEvent
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
    from .files_services import material_file_url, material_view_url

    return {
        "id": material.id,
        "title": material.title,
        "description": material.description or "",
        "materialType": material.material_type,
        "materialTypeLabel": material.get_material_type_display(),
        "topic": material.topic or "",
        "subtopic": material.subtopic or "",
        "externalUrl": material.external_url or "",
        "fileUrl": material_file_url(material),
        "previewUrl": material_view_url(material),
        "cabinetFileId": str(material.cabinet_file_id) if material.cabinet_file_id else None,
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
        "status": item.status,
        "statusLabel": item.get_status_display() if hasattr(item, "get_status_display") else item.status,
        "completedAt": item.completed_at.isoformat() if getattr(item, "completed_at", None) else None,
    }


def resolve_assigned_homework_for_event(event) -> Homework | None:
    """Выданное ДЗ для карточки урока — только явно привязанное к событию."""
    if not event.homework_id:
        return None
    hw = getattr(event, "homework", None)
    if hw is not None and hw.status != HomeworkStatus.ARCHIVED:
        return hw
    return (
        Homework.objects.filter(pk=event.homework_id)
        .exclude(status=HomeworkStatus.ARCHIVED)
        .first()
    )


def _assigned_homework_to_json(homework: Homework | None, *, plan_item=None) -> dict | None:
    if homework is None:
        return None
    item = plan_item
    if item is None and homework.lesson_plan_item_id:
        item = homework.lesson_plan_item
    materials = []
    interactives = []
    description = (homework.description or "").strip()
    if item is not None:
        materials = [_material_to_json(m) for m in item.homework_materials.all()]
        interactives = [_interactive_to_json(i) for i in item.homework_interactives.all()]
        if not description:
            description = (item.homework_description or "").strip()
    if not materials and not interactives:
        # Кастомное ДЗ: собираем строки из задач.
        for task in homework.tasks.all():
            if task.interactive_id and task.interactive:
                interactives.append(_interactive_to_json(task.interactive))
            elif (task.description or "").strip() and task.task_type != "text":
                materials.append({
                    "id": f"task-{task.id}",
                    "title": task.title or "Материал",
                    "description": "",
                    "materialType": "file" if task.task_type == "file" else "link",
                    "materialTypeLabel": task.get_task_type_display(),
                    "topic": "",
                    "subtopic": "",
                    "externalUrl": (task.description or "").strip(),
                    "fileUrl": "",
                })
            elif (task.description or "").strip() and not description:
                description = task.description.strip()
    return {
        "id": homework.id,
        "title": homework.title or "Домашнее задание",
        "description": homework.description or "",
        "status": homework.status,
        "statusLabel": homework.get_status_display(),
        "dueAt": homework.due_at.isoformat() if homework.due_at else None,
        "studentId": homework.student_id,
        "groupId": homework.group_id,
        "planItemId": homework.lesson_plan_item_id,
        "homeworkDescription": description,
        "homeworkMaterials": materials,
        "homeworkInteractives": interactives,
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


def _student_subject_label(event):
    if not event.student_subject_id:
        return ""
    try:
        ss = event.student_subject
    except Exception:
        return ""
    if not ss:
        return ""
    try:
        return ss.display_label or ""
    except Exception:
        return getattr(ss, "subject", "") or ""


def schedule_event_to_json(event):
    from .schedule_service import resolve_schedule_timezone

    event_tz = resolve_schedule_timezone(event=event)
    local_start = event.starts_at.astimezone(event_tz)
    local_end = event.ends_at.astimezone(event_tz)
    today = timezone.now().astimezone(event_tz).date()
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
        # Всегда внутренняя страница конференции — не сырой Jitsi URL без JWT.
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

    overrides = set(event.manual_override_fields or [])
    stored_topic = event.topic or ""
    subtopic = event.subtopic or ""
    description = event.description or ""
    goal = event.goal or ""
    homework_description = event.homework_description or ""

    planned_topic = ""
    if plan_item_json:
        planned_topic = (plan_item_json.get("topic") or "").strip()
        if not planned_topic:
            plan_title = (plan_item_json.get("title") or "").strip()
            if plan_title and plan_title.lower() not in {
                (event.title or "").strip().lower(),
                (audience or "").strip().lower(),
            }:
                planned_topic = plan_title

    use_plan_topic = (
        bool(event.plan_sync_enabled)
        and "topic" not in overrides
        and event.status not in (
            ScheduleEvent.Status.DONE,
            ScheduleEvent.Status.COMPLETED,
            ScheduleEvent.Status.CANCELLED,
        )
    )
    topic = stored_topic
    if plan_item_json and use_plan_topic and planned_topic:
        topic = planned_topic
        if "subtopic" not in overrides:
            subtopic = plan_item_json.get("subtopic") or subtopic
        if "description" not in overrides:
            description = plan_item_json.get("description") or description
        if "goal" not in overrides:
            goal = plan_item_json.get("goal") or goal
        if "homework_description" not in overrides:
            homework_description = plan_item_json.get("homeworkDescription") or homework_description
    elif plan_item_json and use_plan_topic and not stored_topic:
        topic = planned_topic
        if "subtopic" not in overrides:
            subtopic = plan_item_json.get("subtopic") or subtopic
        if "description" not in overrides:
            description = plan_item_json.get("description") or description
        if "goal" not in overrides:
            goal = plan_item_json.get("goal") or goal
        if "homework_description" not in overrides:
            homework_description = plan_item_json.get("homeworkDescription") or homework_description

    has_plan = plan_item_json is not None or get_active_enrollment(event) is not None
    assigned_homework = _assigned_homework_to_json(
        resolve_assigned_homework_for_event(event),
    )

    from .lesson_plan_content_sync import LessonLearningPlanSyncService
    from .plan_sync import PlanSyncService
    sync_meta = LessonLearningPlanSyncService.sync_meta_payload(event, plan_item)
    enrollment = get_active_enrollment(event)
    plan_progress = (
        PlanSyncService.get_enrollment_progress(
            enrollment, event=event, plan_item=plan_item,
        )
        if enrollment
        else None
    )

    return {
        "id": local_event_id(event.pk),
        "dayOffset": (local_start.date() - today).days,
        "startsAt": local_start.isoformat(),
        "endsAt": local_end.isoformat(),
        "startTime": local_start.strftime("%H:%M"),
        "endTime": local_end.strftime("%H:%M"),
        "title": event.title,
        "topic": topic,
        "plannedTopic": planned_topic,
        "actualTopic": stored_topic or topic,
        "subtopic": subtopic,
        "description": description,
        "goal": goal,
        "homeworkDescription": homework_description,
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
        "studentSubjectId": event.student_subject_id,
        "studentSubjectLabel": _student_subject_label(event),
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
        "assignedHomework": assigned_homework,
        "homeworkId": assigned_homework["id"] if assigned_homework else None,
        "teacherComment": event.teacher_comment or "",
        "planSyncEnabled": sync_meta["planSyncEnabled"],
        "contentSource": sync_meta["contentSource"],
        "manualOverrideFields": sync_meta["manualOverrideFields"],
        "planSyncedAt": sync_meta["planSyncedAt"],
        "linkedPlanId": sync_meta["linkedPlanId"],
        "linkedPlanTitle": sync_meta["linkedPlanTitle"],
        "isAutoMaterialsPlan": sync_meta["isAutoMaterialsPlan"],
        "planMaterials": sync_meta["planMaterials"],
        "manualMaterials": sync_meta["manualMaterials"],
        "homeworkMaterials": sync_meta["homeworkMaterials"],
        "eventMaterials": sync_meta["allMaterials"],
        "planProgress": plan_progress,
        "planItemsTotal": (plan_progress or {}).get("total"),
        "planWarningLevel": (plan_progress or {}).get("warning_level") or "",
        "planWarningMessage": (plan_progress or {}).get("warning_message") or "",
    }


def list_schedule_events(*, user, date_from, date_to, include_cancelled=False):
    qs = _schedule_events_queryset(
        user=user,
        date_from=date_from,
        date_to=date_to,
        include_cancelled=include_cancelled,
    )
    try:
        from .plan_sync import PlanSyncService

        PlanSyncService.realign_enrollments_for_events(list(qs.order_by("starts_at")))
        qs = _schedule_events_queryset(
            user=user,
            date_from=date_from,
            date_to=date_to,
            include_cancelled=include_cancelled,
        )
    except Exception:
        import logging
        logging.getLogger("cabinet.plan_sync").exception(
            "plan realign on schedule list failed teacher=%s", user.pk,
        )
    events = []
    for ev in qs.order_by("starts_at"):
        try:
            events.append(schedule_event_to_json(ev))
        except Exception:
            # Один битый урок не должен обнулять весь календарь.
            continue
    return events


def _schedule_events_queryset(*, user, date_from, date_to, include_cancelled=False):
    qs = ScheduleEvent.objects.filter(
        owner=user,
        starts_at__date__lte=date_to,
        ends_at__date__gte=date_from,
    ).select_related(
        "series",
        "series__lesson_plan_item",
        "series__lesson_plan_item__plan",
        "student",
        "student_subject",
        "group",
        "homework",
        "lesson_plan_item",
        "lesson_plan_item__plan",
        "lesson_plan_item__linked_lesson",
    ).prefetch_related(
        "homework__tasks",
        "homework__tasks__interactive",
        "homework__lesson_plan_item__homework_materials",
        "homework__lesson_plan_item__homework_interactives",
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
        "event_materials",
        "event_materials__material",
        "event_materials__interactive",
    )
    if not include_cancelled:
        qs = qs.exclude(status=ScheduleEvent.Status.CANCELLED)
    return qs
