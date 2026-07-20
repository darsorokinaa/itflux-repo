"""Student cabinet API — scoped to the logged-in pupil."""

from django.db import models
from django.db.models import Q
from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from .choices import AssignmentStatus, HomeworkStatus, MaterialStatus, MeetingProvider, StudentStatus, SubmissionStatus
from .models import (
    FlashcardItem,
    Homework,
    HomeworkSubmission,
    Interactive,
    InteractiveAssignment,
    InteractiveAttempt,
    Lesson,
    LessonAssignment,
    MatchingPair,
    DirectMaterialAssignment,
    Material,
    OrderingItem,
    QuizQuestion,
    Profile,
    ScheduleEvent,
    Student,
    StudentGroup,
)
from .permissions import IsCabinetStudent
from .plan_schedule import resolve_plan_item_for_event
from .schedule_events import _participants_to_json, _plan_item_to_json


def resolve_roster_students(user):
    profile = getattr(user, "profile", None)
    if not profile or profile.role != Profile.Role.STUDENT:
        return Student.objects.none()

    return (
        Student.objects.filter(user=user)
        .exclude(status=StudentStatus.ARCHIVED)
        .select_related("teacher", "teacher__profile")
        .order_by("id")
    )


def resolve_roster_student(user, teacher_id=None):
    qs = resolve_roster_students(user)
    if teacher_id:
        return qs.filter(teacher_id=teacher_id).first()
    return qs.first()


def _student_ids_and_groups(students):
    if isinstance(students, Student):
        student_list = [students]
    else:
        student_list = list(students)
    if not student_list:
        return [], StudentGroup.objects.none()
    student_ids = [s.id for s in student_list]
    groups = StudentGroup.objects.filter(students__id__in=student_ids).distinct()
    return student_ids, groups


def _student_groups(students):
    _, groups = _student_ids_and_groups(students)
    return groups


def _lesson_assignments_qs(students):
    student_ids, groups = _student_ids_and_groups(students)
    return LessonAssignment.objects.filter(
        Q(student_id__in=student_ids) | Q(group__in=groups)
    ).select_related("lesson", "teacher", "teacher__profile")


def _homework_qs(students):
    student_ids, groups = _student_ids_and_groups(students)
    return (
        Homework.objects.filter(Q(student_id__in=student_ids) | Q(group__in=groups))
        .exclude(status=HomeworkStatus.DRAFT)
        .select_related("lesson", "teacher", "teacher__profile")
        .prefetch_related("tasks")
    )


def _interactive_assignments_qs(students):
    student_ids, groups = _student_ids_and_groups(students)
    return InteractiveAssignment.objects.filter(
        Q(student_id__in=student_ids) | Q(group__in=groups)
    ).select_related("interactive", "teacher", "teacher__profile", "lesson")


def _schedule_qs(students):
    student_ids, groups = _student_ids_and_groups(students)
    return ScheduleEvent.objects.filter(
        Q(student_id__in=student_ids)
        | Q(group__in=groups)
        | Q(
            participants__student_id__in=student_ids,
            participants__status__in=["invited", "accepted"],
        )
    ).exclude(status=ScheduleEvent.Status.CANCELLED).select_related(
        "owner", "owner__profile", "lesson", "student", "group",
        "lesson_plan_item", "lesson_plan_item__plan",
        "series", "series__lesson_plan_item", "series__lesson_plan_item__plan",
    ).prefetch_related("plan_items", "plan_items__plan").distinct()


def _pick_student(students, teacher=None):
    if isinstance(students, Student):
        return students
    if teacher is not None:
        matched = students.filter(teacher=teacher).first()
        if matched:
            return matched
    return students.first()


def _direction_label(student):
    return student.get_direction_display() if student.direction else "Обучение"


def _teacher_name(user):
    profile = getattr(user, "profile", None)
    if profile:
        return profile.get_display_name()
    return user.get_full_name() or user.username


def _student_display_names(students):
    names = set()
    roster = students if not isinstance(students, Student) else [students]
    for s in roster:
        full = f"{s.first_name} {s.last_name}".strip().lower()
        if full:
            names.add(full)
        if s.first_name:
            names.add(s.first_name.strip().lower())
    return names


def _schedule_event_topic(event, students):
    plan_item, _ = resolve_plan_item_for_event(event)
    if plan_item:
        label = (getattr(plan_item, "title", None) or getattr(plan_item, "topic", None) or "").strip()
        if label:
            return label

    topic = (event.topic or "").strip()
    linked = getattr(event, "lesson_plan_item", None)
    if linked and not topic:
        topic = (getattr(linked, "topic", None) or getattr(linked, "title", None) or "").strip()
    lesson = getattr(event, "lesson", None)
    if not topic and lesson:
        topic = (lesson.topic or lesson.subtopic or lesson.title or "").strip()
    title = (event.title or "").strip()
    if not topic and title.lower() not in _student_display_names(students):
        topic = title
    if topic:
        return topic
    if event.event_type in ("individual", "individual_lesson"):
        return "Индивидуальное занятие"
    if event.event_type in ("group", "group_lesson"):
        return "Групповое занятие"
    return "Занятие"


def _schedule_event_subtitle(event, students):
    plan_item, _ = resolve_plan_item_for_event(event)
    if not plan_item:
        return ""
    topic = _schedule_event_topic(event, students)
    parts = []
    if plan_item.topic and plan_item.topic.strip() and plan_item.topic.strip() != topic:
        parts.append(plan_item.topic.strip())
    if plan_item.subtopic and plan_item.subtopic.strip():
        parts.append(plan_item.subtopic.strip())
    plan = getattr(plan_item, "plan", None)
    if plan and plan.exam_type and plan.exam_type != "none":
        parts.append(plan.get_exam_type_display())
    return " · ".join(parts)


def _schedule_format_label(event):
    if event.format == ScheduleEvent.Format.OFFLINE:
        return "Офлайн"
    provider = event.get_meeting_provider_display()
    if event.meeting_provider and event.meeting_provider != MeetingProvider.NONE:
        if event.meeting_provider == MeetingProvider.YANDEX_TELEMOST:
            short = "Телемост"
        elif event.meeting_provider == MeetingProvider.JITSI:
            short = "Jitsi"
        else:
            short = provider
        return f"Онлайн · {short}"
    return "Онлайн"


def _lesson_assignment_for_event(students, event):
    if not event.lesson_id:
        return None
    return _lesson_assignments_qs(students).filter(lesson_id=event.lesson_id).first()


def _video_meeting_payload(event):
    """Краткие данные Jitsi-комнаты для карточек ученика."""
    try:
        from .models import VideoMeeting
        from .video_meeting_service import meeting_join_window_state, ui_state_message

        vm = VideoMeeting.objects.filter(schedule_event_id=event.pk).first()
    except Exception:
        return None, event.meeting_url or ""
    if vm is None:
        return None, event.meeting_url or ""
    join_state = meeting_join_window_state(event, vm)
    payload = {
        "uuid": str(vm.uuid),
        "status": vm.status,
        "statusLabel": vm.get_status_display(),
        "joinState": join_state,
        "joinStateLabel": ui_state_message(join_state),
        "pageUrl": f"/cabinet/meetings/{vm.uuid}",
    }
    meeting_url = event.meeting_url or ""
    if not meeting_url and vm.status in ("scheduled", "live"):
        meeting_url = payload["pageUrl"]
    return payload, meeting_url


def _serialize_schedule_lesson_card(event, students):
    assignment = _lesson_assignment_for_event(students, event)
    lesson = getattr(event, "lesson", None)
    materials_count = 0
    homework_title = None
    if lesson:
        materials_count = lesson.materials.filter(status=MaterialStatus.PUBLISHED).count()
        hw = _homework_qs(students).filter(lesson_id=lesson.id).first()
        if hw:
            homework_title = hw.title
    video_meeting, meeting_url = _video_meeting_payload(event)

    return {
        "id": event.id,
        "kind": "schedule",
        "topic": _schedule_event_topic(event, students),
        "starts_at": event.starts_at.isoformat(),
        "ends_at": event.ends_at.isoformat() if event.ends_at else None,
        "teacher_name": _teacher_name(event.owner),
        "format": event.get_format_display(),
        "format_label": _schedule_format_label(event),
        "meeting_url": meeting_url,
        "video_meeting": video_meeting,
        "status": event.status,
        "status_label": event.get_status_display(),
        "lesson_id": event.lesson_id,
        "assignment_id": assignment.id if assignment else None,
        "materials_count": materials_count,
        "homework_title": homework_title,
    }


def _serialize_recent_lesson_card(assignment, students):
    lesson = assignment.lesson
    materials_count = lesson.materials.filter(status=MaterialStatus.PUBLISHED).count()
    hw = _homework_qs(students).filter(lesson_id=lesson.id).first()
    when = assignment.due_at or assignment.assigned_at
    return {
        "id": assignment.id,
        "kind": "assignment",
        "topic": lesson.topic or lesson.title,
        "starts_at": when.isoformat() if when else None,
        "teacher_name": _teacher_name(assignment.teacher),
        "assignment_id": assignment.id,
        "materials_count": materials_count,
        "homework_title": hw.title if hw else None,
    }


def _collect_student_materials(students, limit=None):
    items = []
    seen = set()
    assignments = (
        _lesson_assignments_qs(students)
        .select_related("lesson")
        .prefetch_related("lesson__materials")
        .order_by("-assigned_at", "-id")
    )
    for assignment in assignments:
        lesson = assignment.lesson
        lesson_topic = lesson.topic or lesson.title
        for material in lesson.materials.filter(status=MaterialStatus.PUBLISHED).order_by("-updated_at", "-id"):
            if material.id in seen:
                continue
            seen.add(material.id)
            items.append({
                "id": material.id,
                "title": material.title,
                "type": material.material_type,
                "type_label": material.get_material_type_display(),
                "topic": material.topic or "",
                "lesson_topic": lesson_topic,
                "assignment_id": assignment.id,
                "external_url": material.external_url or "",
                "file_url": material.file.url if material.file else "",
                "cover_theme": "material",
                "updated_at": material.updated_at.isoformat() if material.updated_at else None,
            })
    items.sort(key=lambda row: row.get("updated_at") or "", reverse=True)
    if limit is not None:
        return items[:limit]
    return items


def _recent_materials(students, limit=3):
    return _collect_student_materials(students, limit=limit)


def _cover_theme_from_lesson(lesson):
    exam = (lesson.exam_type or "").lower()
    if exam == "oge":
        return "oge"
    if exam == "ege":
        return "ege"
    if "python" in (lesson.topic or "").lower() or lesson.direction == "python":
        return "python"
    return "ege"


def _serialize_lesson_card(assignment, students):
    student = _pick_student(students, assignment.teacher)
    lesson = assignment.lesson
    progress = 45 if assignment.status == AssignmentStatus.IN_PROGRESS else (
        100 if assignment.status in (AssignmentStatus.COMPLETED, AssignmentStatus.CHECKED) else 0
    )
    status_map = {
        AssignmentStatus.ASSIGNED: ("new", "Новый"),
        AssignmentStatus.IN_PROGRESS: ("in_progress", "В процессе"),
        AssignmentStatus.COMPLETED: ("completed", "Пройден"),
        AssignmentStatus.CHECKED: ("completed", "Пройден"),
        AssignmentStatus.OVERDUE: ("repeat", "Нужно повторить"),
    }
    sid, slabel = status_map.get(assignment.status, ("new", "Новый"))
    return {
        "id": assignment.id,
        "lesson_id": lesson.id,
        "title": lesson.title,
        "topic": lesson.topic or lesson.subtopic or "",
        "direction": lesson.get_exam_type_display() if lesson.exam_type else _direction_label(student),
        "status": sid,
        "status_label": slabel,
        "progress_percent": progress,
        "assigned_at": assignment.assigned_at.isoformat() if assignment.assigned_at else None,
        "scheduled_at": assignment.due_at.isoformat() if assignment.due_at else None,
        "due_at": assignment.due_at.isoformat() if assignment.due_at else None,
        "materials_count": lesson.materials.count(),
        "cover_theme": _cover_theme_from_lesson(lesson),
    }


def _homework_student_status(homework, student):
    submission = (
        HomeworkSubmission.objects.filter(homework=homework, student=student)
        .order_by("-submitted_at")
        .first()
    )
    now = timezone.now()
    if submission:
        if submission.status == SubmissionStatus.CHECKED:
            return "checked", "Проверено", submission
        if submission.status == SubmissionStatus.NEEDS_REVISION:
            return "needs_fix", "Нужно исправить", submission
        if submission.status == SubmissionStatus.RETURNED:
            return "needs_fix", "Нужно исправить", submission
        return "submitted", "Сдано", submission
    if homework.due_at and homework.due_at < now:
        return "overdue", "Просрочено", None
    if homework.status == HomeworkStatus.ASSIGNED:
        return "new", "Новый", None
    return "in_progress", "В работе", None


def _serialize_assignment_card(homework, students):
    student = _pick_student(students, homework.teacher)
    sid, slabel, submission = _homework_student_status(homework, student)
    return {
        "id": homework.id,
        "title": homework.title,
        "type": "homework",
        "type_label": "Домашнее задание",
        "due_at": homework.due_at.isoformat() if homework.due_at else None,
        "status": sid,
        "status_label": slabel,
        "result_percent": float(submission.score) if submission and submission.score is not None else None,
        "topic": (homework.lesson.topic or homework.lesson.title) if homework.lesson else "",
        "cover_theme": _cover_theme_from_lesson(homework.lesson) if homework.lesson else "ege",
        "lesson_id": homework.lesson_id,
    }


def _interactive_to_player_payload(interactive):
    itype = interactive.interactive_type
    if itype == "ordering":
        itype = "sequence"
    payload = {
        "id": str(interactive.id),
        "type": itype,
        "title": interactive.get_display_title(),
        "instruction": interactive.instruction or "",
        "exam": interactive.get_exam_type_display() if interactive.exam_type else "без экзамена",
        "topic": interactive.topic or "",
        "backgroundSlug": getattr(interactive.background, "slug", None) or "light-gray",
        "cardStyleSlug": getattr(interactive.card_style, "slug", None) or "classic",
        "soundPackSlug": getattr(interactive.sound_pack, "slug", None) or "soft",
        "soundEnabled": interactive.sound_enabled,
        "params": {
            "shuffleQuestions": True,
            "shuffleOptions": True,
            "showAnswersAtEnd": True,
            "showCorrectImmediately": False,
            "showExplanationAfterAnswer": True,
            "allowRetry": True,
        },
    }
    if interactive.interactive_type == "flashcards":
        payload["cards"] = [
            {
                "front": c.front_text,
                "back": c.back_text,
                "front_image_url": c.front_image_url,
                "back_image_url": c.back_image_url,
                "hint": c.hint,
                "explanation": c.explanation,
            }
            for c in FlashcardItem.objects.filter(interactive=interactive).order_by("order", "id")
        ]
    elif interactive.interactive_type == "matching":
        payload["pairs"] = [
            {
                "left": p.left_text,
                "right": p.right_text,
                "left_image_url": p.left_image_url,
                "right_image_url": p.right_image_url,
                "explanation": p.explanation,
            }
            for p in MatchingPair.objects.filter(interactive=interactive).order_by("order", "id")
        ]
        payload["shufflePairs"] = True
    elif interactive.interactive_type == "quiz":
        payload["questions"] = [
            {
                "id": str(q.id),
                "text": q.question_text,
                "image_url": q.image_url,
                "answer_type": q.answer_type,
                "answers": q.answers,
                "explanation": q.explanation,
                "points": q.points,
            }
            for q in QuizQuestion.objects.filter(interactive=interactive).order_by("order", "id")
        ]
    elif interactive.interactive_type == "wheel":
        payload["segments"] = [
            {
                "id": s.external_id or str(s.id),
                "title": s.title,
                "description": s.description,
                "color": s.color,
                "points": s.points,
                "order": s.order,
            }
            for s in interactive.wheel_segments.all().order_by("order", "id")
        ]
        payload["wheelSettings"] = interactive.wheel_settings or {}
    else:
        payload["steps"] = [
            {
                "text": s.text,
                "image_url": s.image_url,
                "explanation": s.explanation,
                "position": s.correct_order,
            }
            for s in OrderingItem.objects.filter(interactive=interactive).order_by("correct_order", "id")
        ]
    return payload


def _serialize_interactive_card(assignment, students):
    student = _pick_student(students, assignment.teacher)
    interactive = assignment.interactive
    attempt = (
        InteractiveAttempt.objects.filter(assignment=assignment, student=student)
        .order_by("-started_at")
        .first()
    )
    if attempt and attempt.status == AssignmentStatus.COMPLETED:
        sid, slabel = "completed", "Пройден"
        action = "result"
    elif attempt:
        sid, slabel = "in_progress", "В процессе"
        action = "continue"
    else:
        sid, slabel = "new", "Новый"
        action = "start"

    type_labels = {
        "flashcards": "Карточки",
        "matching": "Сопоставление",
        "ordering": "Порядок",
        "quiz": "Викторина",
    }
    itype = interactive.interactive_type
    if itype == "ordering":
        itype = "sequence"
    count = 0
    if interactive.interactive_type == "flashcards":
        count = interactive.flashcards.count()
    elif interactive.interactive_type == "matching":
        count = interactive.matching_pairs.count()
    elif interactive.interactive_type == "quiz":
        count = interactive.quiz_questions.count()
    else:
        count = interactive.ordering_items.count()

    cover_theme = "ege"
    if interactive.interactive_type == "matching":
        cover_theme = "oge"
    elif interactive.interactive_type == "ordering":
        cover_theme = "school"
    elif interactive.interactive_type == "quiz":
        cover_theme = "quiz"

    return {
        "id": assignment.id,
        "interactive_id": interactive.id,
        "title": interactive.get_display_title(),
        "type": itype,
        "type_label": type_labels.get(interactive.interactive_type, "Интерактив"),
        "items_count": count,
        "status": sid,
        "status_label": slabel,
        "action": action,
        "score_percent": float(attempt.score_percent) if attempt and attempt.score_percent is not None else None,
        "cover_theme": cover_theme,
    }


def _assignment_id_for_event(event, students):
    if not event.lesson_id:
        return None
    student_ids, groups = _student_ids_and_groups(students)
    assignment = (
        LessonAssignment.objects.filter(lesson_id=event.lesson_id)
        .filter(Q(student_id__in=student_ids) | Q(group__in=groups))
        .order_by("-assigned_at")
        .first()
    )
    return assignment.id if assignment else None


def _serialize_schedule_event(event, students):
    topic = _schedule_event_topic(event, students)
    video_meeting, meeting_url = _video_meeting_payload(event)
    return {
        "id": event.id,
        "topic": topic,
        "title": topic,
        "subtitle": _schedule_event_subtitle(event, students),
        "starts_at": event.starts_at.isoformat(),
        "ends_at": event.ends_at.isoformat() if event.ends_at else None,
        "teacher_name": _teacher_name(event.owner),
        "format": event.get_format_display(),
        "format_label": _schedule_format_label(event),
        "event_type": event.get_event_type_display(),
        "event_type_code": event.event_type,
        "meeting_url": meeting_url,
        "video_meeting": video_meeting,
        "status": event.status,
        "status_label": event.get_status_display(),
        "lesson_id": event.lesson_id,
        "assignment_id": _assignment_id_for_event(event, students),
    }


def _serialize_student_schedule_event_detail(event, students):
    plan_item_obj, lesson_number = resolve_plan_item_for_event(event)
    local_start = timezone.localtime(event.starts_at)
    local_end = timezone.localtime(event.ends_at)
    plan_item_json = None
    if plan_item_obj:
        plan_item_json = _plan_item_to_json(plan_item_obj, lesson_number=lesson_number)
    topic = _schedule_event_topic(event, students)
    homework_id = None
    homework_status = None
    if plan_item_obj:
        hw = _homework_qs(students).filter(lesson_plan_item_id=plan_item_obj.id).first()
        if hw:
            homework_id = hw.id
            student_obj = _pick_student(students, hw.teacher)
            if student_obj:
                sid, _, _ = _homework_student_status(hw, student_obj)
                homework_status = sid

    video_meeting, meeting_url = _video_meeting_payload(event)
    return {
        "id": event.id,
        "startsAt": local_start.isoformat(),
        "endsAt": local_end.isoformat(),
        "startTime": local_start.strftime("%H:%M"),
        "endTime": local_end.strftime("%H:%M"),
        "title": topic,
        "topic": topic,
        "type": event.event_type,
        "format": "Онлайн" if event.format == ScheduleEvent.Format.ONLINE else "Офлайн",
        "link": meeting_url,
        "videoMeeting": video_meeting,
        "status": event.status,
        "readOnly": True,
        "materials": event.materials or "",
        "tags": event.tags or [],
        "participants": _participants_to_json(event),
        "teacher_name": _teacher_name(event.owner),
        "assignment_id": _assignment_id_for_event(event, students),
        "homework_id": homework_id,
        "homework_status": homework_status,
        "planItem": plan_item_json,
        "planItems": [plan_item_json] if plan_item_json else [],
    }


class StudentScopedView(APIView):
    permission_classes = [IsCabinetStudent]

    def get_students(self):
        teacher_id = self.request.query_params.get("teacher_id")
        qs = resolve_roster_students(self.request.user)
        if teacher_id:
            qs = qs.filter(teacher_id=teacher_id)
        return qs

    def get_student(self):
        teacher_id = self.request.query_params.get("teacher_id")
        return resolve_roster_student(self.request.user, teacher_id=teacher_id)

    def student_response_or_error(self):
        students = self.get_students()
        if not students.exists():
            return None, Response(
                {"error": "Профиль ученика не привязан к аккаунту. Примите приглашение от учителя."},
                status=status.HTTP_404_NOT_FOUND,
            )
        return students, None

    def sync_student_releases(self, students):
        from .student_release import StudentReleaseService
        StudentReleaseService.release_due_events_for_students(students)


class StudentDashboardView(StudentScopedView):
    def get(self, request):
        students, err = self.student_response_or_error()
        if err:
            return err
        self.sync_student_releases(students)

        profile = request.user.profile
        lessons = list(_lesson_assignments_qs(students)[:20])
        homeworks = list(_homework_qs(students)[:20])
        interactives = list(_interactive_assignments_qs(students)[:20])
        today_start = timezone.now().replace(hour=0, minute=0, second=0, microsecond=0)
        today_end = today_start.replace(hour=23, minute=59, second=59)
        today_events = list(
            _schedule_qs(students).filter(starts_at__gte=today_start, starts_at__lte=today_end)[:5]
        )

        todo = []
        for hw in homeworks[:5]:
            roster = _pick_student(students, hw.teacher)
            sid, _, _ = _homework_student_status(hw, roster)
            if sid in ("new", "in_progress", "overdue", "needs_fix"):
                todo.append({"kind": "assignment", **_serialize_assignment_card(hw, students)})

        next_lesson = None
        now = timezone.now()
        upcoming = (
            _schedule_qs(students)
            .filter(ends_at__gt=now)
            .select_related("owner", "owner__profile", "lesson", "lesson_plan_item")
            .order_by("starts_at")
            .first()
        )
        if upcoming:
            card = _serialize_schedule_lesson_card(upcoming, students)
            card["title"] = card["topic"]
            next_lesson = card
        elif lessons:
            la = lessons[0]
            next_lesson = {
                "id": la.id,
                "kind": "assignment",
                "topic": la.lesson.topic or la.lesson.title,
                "title": la.lesson.topic or la.lesson.title,
                "starts_at": la.due_at.isoformat() if la.due_at else None,
                "teacher_name": _teacher_name(la.teacher),
                "format": "онлайн",
                "format_label": "Онлайн",
                "meeting_url": "",
                "status": la.status,
                "status_label": la.get_status_display() if hasattr(la, "get_status_display") else "",
                "lesson_id": la.lesson_id,
                "assignment_id": la.id,
            }

        completed_lessons = sum(
            1 for la in lessons if la.status in (AssignmentStatus.COMPLETED, AssignmentStatus.CHECKED)
        )
        open_hw = sum(
            1
            for hw in homeworks
            if _homework_student_status(hw, _pick_student(students, hw.teacher))[0]
            in ("new", "in_progress", "overdue")
        )
        done_hw = sum(
            1
            for hw in homeworks
            if _homework_student_status(hw, _pick_student(students, hw.teacher))[0]
            in ("checked", "submitted")
        )

        recent_lessons = []
        past_events = (
            _schedule_qs(students)
            .filter(starts_at__lt=timezone.now())
            .select_related("owner", "owner__profile", "lesson", "lesson_plan_item")
            .order_by("-starts_at")[:5]
        )
        seen_recent = set()
        for event in past_events:
            card = _serialize_schedule_lesson_card(event, students)
            key = f"schedule-{event.id}"
            if key in seen_recent:
                continue
            seen_recent.add(key)
            recent_lessons.append(card)
        if len(recent_lessons) < 3:
            for la in _lesson_assignments_qs(students).select_related("lesson", "teacher", "teacher__profile"):
                if la.status not in (AssignmentStatus.COMPLETED, AssignmentStatus.CHECKED):
                    continue
                key = f"assignment-{la.id}"
                if key in seen_recent:
                    continue
                seen_recent.add(key)
                recent_lessons.append(_serialize_recent_lesson_card(la, students))
                if len(recent_lessons) >= 3:
                    break
        recent_lessons = recent_lessons[:3]

        recent_materials = _recent_materials(students, limit=3)

        return Response({
            "greeting_name": profile.get_display_name().split()[0] if profile.get_display_name() else "Ученик",
            "summary": {
                "lessons_today": len(today_events),
                "assignments_due": open_hw,
                "interactives_new": sum(
                    1
                    for a in interactives
                    if not InteractiveAttempt.objects.filter(
                        assignment=a,
                        student=_pick_student(students, a.teacher),
                    ).exists()
                ),
            },
            "metrics": {
                "progress_percent": min(100, completed_lessons * 8 + 20) if lessons else 0,
                "assignments_left": open_hw,
                "assignments_done": done_hw,
                "lessons_completed": completed_lessons,
                "streak_days": 3,
            },
            "next_lesson": next_lesson,
            "todo": todo,
            "recent_materials": recent_materials,
            "recent_lessons": recent_lessons,
            "recent_results": [
                {
                    "title": hw.title,
                    "score_percent": float(sub.score) if sub.score is not None else None,
                    "completed_at": (sub.updated_at or sub.submitted_at).isoformat() if (sub.updated_at or sub.submitted_at) else None,
                }
                for hw in homeworks
                for sub in [
                    HomeworkSubmission.objects.filter(
                        homework=hw,
                        student=_pick_student(students, hw.teacher),
                        status=SubmissionStatus.CHECKED,
                    ).first()
                ]
                if sub
            ][:5],
            "today_schedule": [
                {
                    "id": e.id,
                    "title": e.title,
                    "starts_at": e.starts_at.isoformat(),
                    "ends_at": e.ends_at.isoformat() if e.ends_at else None,
                    "teacher_name": _teacher_name(e.owner),
                    "format": e.get_format_display(),
                    "meeting_url": e.meeting_url or "",
                }
                for e in today_events
            ],
        })


class StudentLessonsView(StudentScopedView):
    def get(self, request):
        students, err = self.student_response_or_error()
        if err:
            return err
        self.sync_student_releases(students)
        items = [_serialize_lesson_card(la, students) for la in _lesson_assignments_qs(students)]
        return Response({"items": items})


class StudentLessonDetailView(StudentScopedView):
    def get(self, request, assignment_id):
        students, err = self.student_response_or_error()
        if err:
            return err
        self.sync_student_releases(students)
        la = _lesson_assignments_qs(students).filter(pk=assignment_id).select_related("lesson").first()
        if not la:
            return Response({"error": "Урок не найден."}, status=status.HTTP_404_NOT_FOUND)
        lesson = la.lesson
        materials = [
            {
                "id": m.id,
                "title": m.title,
                "type": m.material_type,
                "type_label": m.get_material_type_display(),
                "external_url": m.external_url or "",
                "file_url": m.file.url if m.file else "",
                "has_content": bool(m.content and m.content.strip()),
            }
            for m in lesson.materials.all()[:20]
        ]
        homeworks = [
            _serialize_assignment_card(hw, students)
            for hw in _homework_qs(students).filter(lesson=lesson)
        ]
        interactives = [
            _serialize_interactive_card(a, students)
            for a in _interactive_assignments_qs(students).filter(lesson=lesson)
        ]
        card = _serialize_lesson_card(la, students)
        card.update({
            "theory": lesson.theory_content or "",
            "practice": lesson.practice_content or "",
            "homework_description": lesson.homework_description or "",
            "materials": materials,
            "assignments": homeworks,
            "interactives": interactives,
            "teacher_name": _teacher_name(la.teacher),
        })
        return Response(card)

    def post(self, request, assignment_id):
        students, err = self.student_response_or_error()
        if err:
            return err
        la = _lesson_assignments_qs(students).filter(pk=assignment_id).first()
        if not la:
            return Response({"error": "Урок не найден."}, status=status.HTTP_404_NOT_FOUND)
        la.status = AssignmentStatus.COMPLETED
        la.save(update_fields=["status", "updated_at"])
        return Response({"ok": True, "status": "completed"})


class StudentAssignmentsView(StudentScopedView):
    def get(self, request):
        students, err = self.student_response_or_error()
        if err:
            return err
        self.sync_student_releases(students)
        items = [_serialize_assignment_card(hw, students) for hw in _homework_qs(students)]
        return Response({"items": items})


class StudentAssignmentDetailView(StudentScopedView):
    def get(self, request, homework_id):
        students, err = self.student_response_or_error()
        if err:
            return err
        self.sync_student_releases(students)
        hw = (
            _homework_qs(students)
            .filter(pk=homework_id)
            .select_related("lesson_plan_item")
            .prefetch_related("tasks", "lesson_plan_item__homework_materials")
            .first()
        )
        if not hw:
            return Response({"error": "Задание не найдено."}, status=status.HTTP_404_NOT_FOUND)
        roster = _pick_student(students, hw.teacher)
        submission = (
            HomeworkSubmission.objects.filter(homework=hw, student=roster)
            .order_by("-submitted_at")
            .first()
        )
        from .homework_api import (
            cleanup_duplicate_homework_tasks,
            homework_has_variant_task,
            issue_homework_token,
            serialize_homework_tasks,
        )

        cleanup_duplicate_homework_tasks(hw)
        token = issue_homework_token(homework_id=hw.id, student_user_id=request.user.id)
        tasks = serialize_homework_tasks(hw, homework_id=hw.id, token=token)
        card = _serialize_assignment_card(hw, students)
        card.update({
            "description": hw.description or "",
            "tasks": tasks,
            "has_variant": homework_has_variant_task(hw),
            "answer_text": submission.answer_text if submission else "",
            "attached_file_url": submission.attached_file.url if submission and submission.attached_file else "",
            "attached_file_name": (
                submission.attached_file.name.split("/")[-1]
                if submission and submission.attached_file
                else ""
            ),
            "teacher_comment": submission.teacher_comment if submission else "",
            "mistakes": [],
            "variant_submitted": bool(submission and submission.result_payload),
            "result": submission.result_payload if submission and submission.status == SubmissionStatus.CHECKED else None,
        })
        return Response(card)

    def post(self, request, homework_id):
        students, err = self.student_response_or_error()
        if err:
            return err
        hw = _homework_qs(students).filter(pk=homework_id).first()
        if not hw:
            return Response({"error": "Задание не найдено."}, status=status.HTTP_404_NOT_FOUND)
        roster = _pick_student(students, hw.teacher)
        answer_text = (request.data.get("answer_text") or "").strip()
        attached_file = request.FILES.get("attached_file")
        if not answer_text and not attached_file:
            return Response(
                {"error": "Добавьте ответ или файл."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        existing = HomeworkSubmission.objects.filter(homework=hw, student=roster).first()
        if existing and existing.status == SubmissionStatus.CHECKED:
            return Response(
                {"error": "Работа уже проверена."},
                status=status.HTTP_403_FORBIDDEN,
            )
        if existing and existing.submitted_at and existing.status == SubmissionStatus.SUBMITTED:
            return Response(
                {"error": "Работа уже отправлена на проверку."},
                status=status.HTTP_403_FORBIDDEN,
            )
        submission, created = HomeworkSubmission.objects.get_or_create(
            homework=hw,
            student=roster,
            defaults={"answer_text": answer_text, "status": SubmissionStatus.SUBMITTED},
        )
        if not created:
            submission.answer_text = answer_text
            submission.status = SubmissionStatus.SUBMITTED
        if attached_file:
            submission.attached_file = attached_file
        submission.submitted_at = timezone.now()
        submission.save()
        from .homework_api import _ensure_review_item

        _ensure_review_item(submission)
        return Response({"ok": True, "status": "submitted"})


class StudentInteractivesView(StudentScopedView):
    def get(self, request):
        students, err = self.student_response_or_error()
        if err:
            return err
        items = [_serialize_interactive_card(a, students) for a in _interactive_assignments_qs(students)]
        return Response({"items": items})


class StudentInteractiveDetailView(StudentScopedView):
    def get(self, request, assignment_id):
        students, err = self.student_response_or_error()
        if err:
            return err
        assignment = _interactive_assignments_qs(students).filter(pk=assignment_id).first()
        if not assignment:
            return Response({"error": "Интерактив не найден."}, status=status.HTTP_404_NOT_FOUND)
        interactive = assignment.interactive
        from .choices import InteractiveStatus
        if interactive.status != InteractiveStatus.PUBLISHED:
            return Response({"error": "Интерактив недоступен."}, status=status.HTTP_403_FORBIDDEN)
        return Response({
            "assignment": _serialize_interactive_card(assignment, students),
            "interactive": _interactive_to_player_payload(interactive),
            "attempts_allowed": assignment.attempts_allowed,
        })

    def post(self, request, assignment_id):
        students, err = self.student_response_or_error()
        if err:
            return err
        assignment = _interactive_assignments_qs(students).filter(pk=assignment_id).first()
        if not assignment:
            return Response({"error": "Интерактив не найден."}, status=status.HTTP_404_NOT_FOUND)
        roster = _pick_student(students, assignment.teacher)
        score = request.data.get("score_percent")
        prior_attempts = InteractiveAttempt.objects.filter(
            assignment=assignment,
            student=roster,
        ).count()
        attempt = InteractiveAttempt.objects.create(
            assignment=assignment,
            student=roster,
            score_percent=score,
            status=AssignmentStatus.COMPLETED,
            completed_at=timezone.now(),
            raw_answers=request.data.get("raw_answers") or {},
            mistakes=request.data.get("mistakes") or [],
            attempts_count=prior_attempts + 1,
        )
        return Response({"ok": True, "attempt_id": attempt.id, "score_percent": score})


class StudentScheduleView(StudentScopedView):
    def get(self, request):
        students, err = self.student_response_or_error()
        if err:
            return err
        self.sync_student_releases(students)
        events = _schedule_qs(students).order_by("starts_at")[:50]
        return Response({
            "items": [_serialize_schedule_event(e, students) for e in events]
        })


class StudentScheduleEventDetailView(StudentScopedView):
    def get(self, request, event_id):
        students, err = self.student_response_or_error()
        if err:
            return err
        self.sync_student_releases(students)
        event = (
            _schedule_qs(students)
            .prefetch_related(
                "participants",
                "participants__student",
                "participants__teacher",
                "participants__user",
                "plan_items",
                "plan_items__materials",
                "plan_items__attached_interactives",
                "plan_items__homework_materials",
                "plan_items__homework_interactives",
                "plan_items__linked_lesson",
                "plan_items__plan",
                "lesson_plan_item__materials",
                "lesson_plan_item__attached_interactives",
                "lesson_plan_item__homework_materials",
                "lesson_plan_item__homework_interactives",
                "lesson_plan_item__linked_lesson",
                "lesson_plan_item__plan",
            )
            .filter(pk=event_id)
            .first()
        )
        if not event:
            return Response({"error": "Занятие не найдено."}, status=status.HTTP_404_NOT_FOUND)
        return Response(_serialize_student_schedule_event_detail(event, students))


class StudentProgressView(StudentScopedView):
    def get(self, request):
        students, err = self.student_response_or_error()
        if err:
            return err
        lessons = list(_lesson_assignments_qs(students))
        homeworks = list(_homework_qs(students))
        completed_lessons = sum(1 for la in lessons if la.status in (AssignmentStatus.COMPLETED, AssignmentStatus.CHECKED))
        done_hw = sum(
            1
            for hw in homeworks
            if _homework_student_status(hw, _pick_student(students, hw.teacher))[0]
            in ("checked", "submitted")
        )
        scores = [
            float(s.score)
            for hw in homeworks
            for s in [
                HomeworkSubmission.objects.filter(
                    homework=hw,
                    student=_pick_student(students, hw.teacher),
                    score__isnull=False,
                ).first()
            ]
            if s
        ]
        avg = round(sum(scores) / len(scores)) if scores else 0
        return Response({
            "overall_percent": min(100, completed_lessons * 8 + 20) if lessons else 0,
            "lessons_completed": completed_lessons,
            "assignments_done": done_hw,
            "average_score": avg,
            "weak_topics": [
                {"title": "Логика", "percent": 58, "status": "repeat"},
                {"title": "Системы счисления", "percent": 62, "status": "repeat"},
            ],
            "weekly": [40, 52, 48, 60, 64, 70, 76],
        })


def _collect_direct_materials(students):
    """Materials assigned directly by teachers to students or their groups."""
    from .models import DirectMaterialAssignment
    items = []
    seen = set()
    student_objs = list(students)
    group_ids = set()
    for s in student_objs:
        for g in s.groups.all():
            group_ids.add(g.id)

    qs = DirectMaterialAssignment.objects.filter(
        models.Q(student__in=student_objs) | models.Q(group_id__in=group_ids)
    ).select_related("material", "teacher").order_by("-assigned_at")

    for da in qs:
        m = da.material
        if m.id in seen:
            continue
        seen.add(m.id)
        items.append({
            "id": m.id,
            "title": m.title,
            "description": m.description or "",
            "type": m.material_type,
            "type_label": m.get_material_type_display(),
            "topic": m.topic or "",
            "lesson_topic": "",
            "assignment_id": None,
            "external_url": m.external_url or "",
            "file_url": m.file.url if m.file else "",
            "cover_theme": "material",
            "message": da.message or "",
            "direct": True,
            "assigned_at": da.assigned_at.isoformat(),
        })
    return items


class StudentMaterialsView(StudentScopedView):
    def get(self, request):
        students, err = self.student_response_or_error()
        if err:
            return err
        self.sync_student_releases(students)
        q = (request.GET.get("q") or "").strip().lower()
        lesson_items = _collect_student_materials(students, limit=200)
        direct_items = _collect_direct_materials(students)
        # merge, deduplicate by id (direct takes priority)
        seen = {it["id"] for it in direct_items}
        for it in lesson_items:
            if it["id"] not in seen:
                direct_items.append(it)
                seen.add(it["id"])
        all_items = direct_items
        if q:
            all_items = [
                it for it in all_items
                if q in it["title"].lower()
                or q in it.get("description", "").lower()
                or q in it.get("topic", "").lower()
                or q in it.get("type_label", "").lower()
            ]
        return Response({"items": all_items[:100]})


class StudentProfileView(StudentScopedView):
    def get(self, request):
        students, err = self.student_response_or_error()
        if err:
            return err
        profile = request.user.profile
        teachers = []
        all_groups = []
        for roster in students:
            teacher = roster.teacher
            group_titles = list(_student_groups(roster).values_list("title", flat=True))
            all_groups.extend(group_titles)
            teachers.append({
                "teacher_name": _teacher_name(teacher) if teacher else "",
                "teacher_email": teacher.email if teacher else "",
                "direction": _direction_label(roster),
                "grade": roster.grade,
                "groups": group_titles,
            })
        primary = students.first()
        return Response({
            "name": profile.name or (primary.first_name if primary else ""),
            "surname": profile.surname or (primary.last_name if primary else ""),
            "display_name": profile.get_display_name(),
            "email": request.user.email,
            "direction": _direction_label(primary) if primary else "",
            "grade": primary.grade if primary else None,
            "groups": list(dict.fromkeys(all_groups)),
            "teachers": teachers,
            "teacher_name": teachers[0]["teacher_name"] if teachers else "",
            "teacher_email": teachers[0]["teacher_email"] if teachers else "",
            "notifications_enabled": True,
        })

    def patch(self, request):
        students, err = self.student_response_or_error()
        if err:
            return err
        profile = request.user.profile
        if "name" in request.data:
            profile.name = request.data["name"]
        if "surname" in request.data:
            profile.surname = request.data["surname"]
        if "notifications_enabled" in request.data:
            pass
        profile.save()
        return Response({"ok": True})


class StudentNotificationsView(StudentScopedView):
    def get(self, request):
        from .models import Notification
        from .serializers import NotificationSerializer

        qs = Notification.objects.filter(recipient_user=request.user).order_by("-created_at")[:50]
        unread = Notification.objects.filter(recipient_user=request.user, is_read=False).count()
        return Response({
            "items": NotificationSerializer(qs, many=True).data,
            "unread_count": unread,
        })


class StudentNotificationReadView(StudentScopedView):
    def post(self, request, notification_id):
        from .models import Notification

        n = Notification.objects.filter(pk=notification_id, recipient_user=request.user).first()
        if not n:
            return Response({"error": "Not found"}, status=status.HTTP_404_NOT_FOUND)
        n.is_read = True
        n.save(update_fields=["is_read"])
        return Response({"ok": True})


class StudentNotificationsReadAllView(StudentScopedView):
    def post(self, request):
        from .models import Notification

        Notification.objects.filter(recipient_user=request.user, is_read=False).update(is_read=True)
        return Response({"ok": True})
