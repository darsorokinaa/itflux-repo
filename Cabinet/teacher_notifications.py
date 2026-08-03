"""Teacher-facing notification emitters (Web Push + in-app) for cabinet events."""

from __future__ import annotations

import logging
from datetime import timedelta

from django.contrib.auth.models import User
from django.db.models import Count, Q
from django.utils import timezone

from .models import Notification, NotificationPreference, Profile, Student
from .notifications import get_or_create_preferences
from .webpush import notify_user_channels, send_web_push_to_user

logger = logging.getLogger(__name__)


def _override_allows(student: Student | None, category: str, default: bool = True) -> bool:
    """Per-student override: None inherits teacher default."""
    if student is None:
        return default
    try:
        ov = student.notify_override
    except Exception:
        return default
    mode = getattr(ov, "mode", "all") or "all"
    if mode == "mute_optional" and category in (
        "attendance", "messages", "materials",
    ):
        return False
    if mode == "important_only" and category in (
        "attendance", "messages", "materials", "daily_schedule",
    ):
        return False
    field_map = {
        "homework": "notify_homework",
        "messages": "notify_messages",
        "overdue": "notify_overdue",
        "billing": "notify_billing",
        "attendance": "notify_attendance",
        "new_student": None,
    }
    field = field_map.get(category)
    if field:
        val = getattr(ov, field, None)
        if val is not None:
            return bool(val)
    return default


def notify_teacher_new_student(*, teacher: User, student: Student) -> None:
    prefs = get_or_create_preferences(teacher)
    if not prefs.notify_new_student:
        return
    if not _override_allows(student, "new_student", True):
        return
    name = student.full_name or "Ученик"
    notify_user_channels(
        teacher,
        title="Новый ученик присоединился",
        message=f"{name} добавлен(а) в ваш кабинет",
        payload={
            "type": "new_student",
            "event_type": "new_student",
            "student_id": student.pk,
            "url": f"/cabinet/students?student={student.pk}",
        },
        push_priority="important",
        tag=f"new-student-{student.pk}",
    )


def notify_teacher_homework_submitted(
    *,
    teacher: User,
    student: Student,
    title: str,
    message: str,
    payload: dict,
    is_resubmit: bool = False,
) -> None:
    """In-app + push respect prefs; push mode may defer to digest cron."""
    from .notification_catalog import NotificationEventType
    from .notification_dispatch import NotificationDispatcher

    prefs = get_or_create_preferences(teacher)
    if not getattr(prefs, "notify_homework", True):
        return
    if is_resubmit and not getattr(prefs, "notify_homework_resubmitted", True):
        return
    if not _override_allows(student, "homework", True):
        return

    event_type = (
        NotificationEventType.HOMEWORK_RESUBMITTED
        if is_resubmit
        else NotificationEventType.HOMEWORK_SUBMITTED
    )
    payload = dict(payload or {})
    payload["type"] = event_type
    payload["event_type"] = event_type
    submission_id = payload.get("submission_id") or payload.get("homework_id") or "x"
    dedup_key = f"{event_type}:{submission_id}:{student.pk}:{teacher.pk}"

    mode = getattr(prefs, "homework_review_push_mode", "each") or "each"
    use_push = mode == "each"
    NotificationDispatcher.notify(
        teacher,
        event_type,
        title=title,
        message=message,
        payload=payload,
        url=payload.get("url") or "/cabinet/review",
        dedup_key=dedup_key,
        recipient_teacher=teacher,
        skip_actor=False,
        create_push=use_push,
        create_telegram=use_push,  # digest modes: telegram тоже через cron-сводку
        push_tag=f"hw-review-{payload.get('homework_id')}-{student.pk}",
        private_title="Новая работа на проверку",
        private_message="Ученик сдал работу",
    )
    # digest_15 / digest_60 / in_app_only — push handled by cron


def notify_teacher_student_message(
    *,
    teacher: User,
    student: Student,
    preview: str,
    url: str,
) -> None:
    prefs = get_or_create_preferences(teacher)
    if not prefs.notify_student_message:
        return
    if not _override_allows(student, "messages", True):
        return
    safe = (preview or "").strip().replace("\n", " ")
    if len(safe) > 120:
        safe = safe[:117] + "…"
    name = student.full_name or "Ученик"
    notify_user_channels(
        teacher,
        title=f"Новое сообщение от {name}",
        message=safe or "Ученик оставил комментарий к заданию",
        payload={
            "type": "student_message",
            "event_type": "student_message",
            "student_id": student.pk,
            "url": url,
        },
        push_priority="normal",
        tag=f"student-msg-{student.pk}",
    )


def notify_teacher_student_entered_room(
    *,
    teacher: User,
    student_user: User,
    meeting,
    is_new_session: bool,
) -> None:
    if not is_new_session:
        return
    prefs = get_or_create_preferences(teacher)
    if not prefs.notify_student_entered_room:
        return

    # Only in reasonable window: 15 min before start … while LIVE
    event = meeting.schedule_event
    now = timezone.now()
    starts = event.starts_at
    if meeting.status != meeting.Status.LIVE:
        if not starts or now < starts - timedelta(minutes=15):
            return
        if event.ends_at and now > event.ends_at:
            return

    # Rate-limit: one push per student per meeting
    already = Notification.objects.filter(
        recipient_user=teacher,
        payload__type="student_entered_room",
        payload__meeting_uuid=str(meeting.uuid),
        payload__student_user_id=student_user.pk,
        created_at__gte=now - timedelta(hours=6),
    ).exists()
    if already:
        return

    student = Student.objects.filter(teacher=teacher, user=student_user).first()
    if student and not _override_allows(student, "attendance", True):
        return
    name = (student.full_name if student else None) or student_user.get_full_name() or student_user.username
    url = f"/cabinet/meetings/{meeting.uuid}"
    notify_user_channels(
        teacher,
        title="Ученик вошёл в комнату",
        message=f"{name} ожидает начала урока",
        payload={
            "type": "student_entered_room",
            "event_type": "student_entered_room",
            "meeting_uuid": str(meeting.uuid),
            "event_id": event.pk,
            "student_user_id": student_user.pk,
            "student_id": student.pk if student else None,
            "url": url,
        },
        push_priority="normal",
        tag=f"room-enter-{meeting.uuid}-{student_user.pk}",
    )


def notify_teacher_auto_check_attention(
    *,
    teacher: User,
    student: Student,
    homework_title: str,
    review_url: str,
    reason: str = "manual",
) -> None:
    prefs = get_or_create_preferences(teacher)
    if not prefs.notify_auto_check_attention:
        return
    if not _override_allows(student, "homework", True):
        return
    if reason == "failed":
        title = "Не удалось проверить работу автоматически"
        message = "Откройте работу и проверьте ответы вручную"
    else:
        title = "Автопроверка завершена"
        message = f"В работе ученика найдены задания для ручной проверки · {student.full_name}"
    notify_user_channels(
        teacher,
        title=title,
        message=message,
        payload={
            "type": "auto_check_attention",
            "event_type": "auto_check_attention",
            "student_id": student.pk,
            "url": review_url,
        },
        push_priority="important",
        tag=f"autocheck-{student.pk}-{homework_title[:40]}",
    )


def result_needs_manual_review(result_payload: dict | None) -> tuple[bool, str]:
    """Detect open / unchecked / failed auto-check items in submission payload."""
    if not isinstance(result_payload, dict):
        return False, ""
    checked = result_payload.get("checked")
    needs_manual = result_payload.get("needs_manual") or result_payload.get("manual_review")
    if needs_manual:
        return True, "manual"
    open_tasks = result_payload.get("open_tasks") or result_payload.get("unchecked")
    if open_tasks:
        return True, "manual"
    if isinstance(checked, dict) and checked:
        # All boolean False or mixed with nulls suggesting open answers
        values = list(checked.values())
        if any(v is None for v in values):
            return True, "manual"
    errors = result_payload.get("check_errors") or result_payload.get("errors")
    if errors:
        return True, "failed"
    return False, ""


def notify_teacher_package_low(*, teacher: User, student: Student, remaining, unit_label: str = "занятий") -> None:
    prefs = get_or_create_preferences(teacher)
    if not prefs.notify_package_low:
        return
    if not _override_allows(student, "billing", True):
        return
    privacy = prefs.push_privacy_mode
    title = f"У {student.full_name} осталось мало {unit_label}"
    message = "Проверьте или продлите абонемент" if privacy else f"Осталось: {remaining}"
    notify_user_channels(
        teacher,
        title=title,
        message=message,
        payload={
            "type": "billing_package_low",
            "event_type": "billing_package_low",
            "student_id": student.pk,
            "url": f"/cabinet/payments?student={student.pk}",
        },
        push_priority="important",
        tag=f"pkg-low-{student.pk}",
    )


def notify_teacher_unpaid_lesson(*, teacher: User, student: Student, when_label: str = "") -> None:
    prefs = get_or_create_preferences(teacher)
    if not prefs.notify_debt_created:
        return
    if not _override_allows(student, "billing", True):
        return
    title = "Урок проведён без оплаты"
    message = f"{student.full_name}" + (f" · {when_label}" if when_label else "")
    notify_user_channels(
        teacher,
        title=title,
        message=message,
        payload={
            "type": "billing_unpaid_lesson",
            "event_type": "billing_unpaid_lesson",
            "student_id": student.pk,
            "url": f"/cabinet/payments?student={student.pk}",
        },
        push_priority="important",
        tag=f"unpaid-{student.pk}-{when_label}",
        urgent=False,
    )


def send_homework_review_digests(*, window_minutes: int) -> int:
    """Aggregate pending review notifications into one push per teacher."""
    from .models import ReviewItem

    now = timezone.now()
    since = now - timedelta(minutes=window_minutes + 2)
    mode = "digest_15" if window_minutes <= 20 else "digest_60"
    sent = 0

    teachers = User.objects.filter(
        notification_preferences__homework_review_push_mode=mode,
        notification_preferences__push_enabled=True,
        is_active=True,
    ).distinct()

    for teacher in teachers:
        prefs = get_or_create_preferences(teacher)
        if prefs.homework_review_push_mode != mode:
            continue
        # Avoid double digest in same window
        recent_digest = Notification.objects.filter(
            recipient_user=teacher,
            payload__type="homework_review_digest",
            created_at__gte=now - timedelta(minutes=window_minutes),
        ).exists()
        if recent_digest:
            continue

        count = ReviewItem.objects.filter(
            teacher=teacher,
            status="pending",
            created_at__gte=since,
            source_type="homework",
        ).count()
        if count <= 0:
            continue
        title = "Новые работы на проверку" if count == 1 else f"{count} новых работ ожидают проверки"
        message = "Откройте раздел проверки"
        notify_user_channels(
            teacher,
            title=title,
            message=message,
            payload={
                "type": "homework_review_digest",
                "event_type": "homework_review_digest",
                "count": count,
                "url": "/cabinet/review",
            },
            push_priority="important",
            tag=f"hw-digest-{teacher.pk}-{window_minutes}",
            in_app=True,
        )
        sent += 1
    return sent


def send_overdue_homework_digests(*, mode_filter: str | None = None) -> int:
    """Daily or immediate overdue homework summaries for teachers."""
    from .models import Homework, HomeworkSubmission

    now = timezone.now()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    sent = 0

    qs = NotificationPreference.objects.filter(notify_overdue_homework=True).select_related("user")
    if mode_filter:
        qs = qs.filter(overdue_homework_mode=mode_filter)

    for prefs in qs:
        teacher = prefs.user
        mode = prefs.overdue_homework_mode or "daily"
        if mode == "off" or mode == "in_app_only":
            # in_app_only: still create digest in-app once daily without push
            if mode == "off":
                continue
        if mode == "daily" and mode_filter == "immediate":
            continue
        if mode == "immediate" and mode_filter == "daily":
            continue

        # Already sent today for daily mode
        if mode in ("daily", "in_app_only"):
            if Notification.objects.filter(
                recipient_user=teacher,
                payload__type="overdue_homework_digest",
                created_at__gte=today_start,
            ).exists():
                continue

        homeworks = Homework.objects.filter(
            teacher=teacher,
            due_at__lt=now,
            due_at__gte=now - timedelta(days=14),
        ).select_related("student", "group")

        overdue_students = set()
        for hw in homeworks:
            targets = []
            if hw.student_id:
                targets.append(hw.student)
            if hw.group_id:
                targets.extend(list(hw.group.students.all()))
            for student in targets:
                if not student or not _override_allows(student, "overdue", True):
                    continue
                sub = (
                    HomeworkSubmission.objects.filter(homework=hw, student=student)
                    .order_by("-id")
                    .first()
                )
                if sub and sub.submitted_at:
                    continue
                overdue_students.add(student.pk)

        count = len(overdue_students)
        if count <= 0:
            continue

        title = "Просроченные домашние задания"
        message = (
            f"У {count} "
            f"{_plural(count, 'ученика', 'учеников', 'учеников')} "
            f"не выполнены задания в срок"
        )
        use_push = mode != "in_app_only"
        notify_user_channels(
            teacher,
            title=title,
            message=message,
            payload={
                "type": "overdue_homework_digest",
                "event_type": "overdue_homework_digest",
                "count": count,
                "url": "/cabinet/review?filter=overdue",
            },
            push=use_push,
            push_priority="normal",
            tag=f"overdue-{teacher.pk}-{today_start.date().isoformat()}",
        )
        sent += 1
    return sent


def send_student_absent_alerts(*, after_minutes: int = 5) -> int:
    """Notify teacher when LIVE meeting has no student attendance after N minutes."""
    from .choices import ParticipantStatus
    from .models import MeetingAttendance, ScheduleEventParticipant, VideoMeeting

    now = timezone.now()
    sent = 0
    meetings = (
        VideoMeeting.objects.filter(status=VideoMeeting.Status.LIVE)
        .select_related("schedule_event", "schedule_event__owner")
        .filter(actual_started_at__lte=now - timedelta(minutes=after_minutes))
        .filter(actual_started_at__gte=now - timedelta(hours=3))
    )

    for meeting in meetings:
        event = meeting.schedule_event
        teacher = event.owner
        if not teacher:
            continue
        prefs = get_or_create_preferences(teacher)
        if not prefs.notify_student_absent:
            continue
        # Skip offline formats without room requirement
        fmt = (getattr(event, "format", None) or "").lower()
        if fmt in ("offline", "очно", "in_person"):
            continue

        participants = ScheduleEventParticipant.objects.filter(
            event=event,
            status__in=[ParticipantStatus.INVITED, ParticipantStatus.ACCEPTED],
            student__isnull=False,
        ).select_related("student", "student__user")

        for part in participants:
            student = part.student
            if not student or not student.user_id:
                continue
            if not _override_allows(student, "attendance", True):
                continue
            if MeetingAttendance.objects.filter(meeting=meeting, user_id=student.user_id).exists():
                continue
            already = Notification.objects.filter(
                recipient_user=teacher,
                payload__type="student_absent",
                payload__meeting_uuid=str(meeting.uuid),
                payload__student_id=student.pk,
                created_at__gte=now - timedelta(hours=6),
            ).exists()
            if already:
                continue
            started = meeting.actual_started_at
            mins = int((now - started).total_seconds() // 60) if started else after_minutes
            notify_user_channels(
                teacher,
                title="Ученик ещё не подключился",
                message=f"{student.full_name} · урок начался {mins} мин назад",
                payload={
                    "type": "student_absent",
                    "event_type": "student_absent",
                    "meeting_uuid": str(meeting.uuid),
                    "event_id": event.pk,
                    "student_id": student.pk,
                    "url": f"/cabinet/meetings/{meeting.uuid}",
                },
                push_priority="important",
                tag=f"absent-{meeting.uuid}-{student.pk}",
            )
            sent += 1
    return sent


def _plural(n, one, few, many):
    abs_n = abs(n) % 100
    last = abs_n % 10
    if 10 < abs_n < 20:
        return many
    if last == 1:
        return one
    if 2 <= last <= 4:
        return few
    return many
