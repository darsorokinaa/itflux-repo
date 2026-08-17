"""Бизнес-логика электронного журнала успеваемости."""

from __future__ import annotations

import secrets
from datetime import datetime, date as dt_date, time as dt_time, timedelta
from decimal import Decimal, ROUND_HALF_UP
from typing import Any
from zoneinfo import ZoneInfo

from django.contrib.auth.models import User
from django.db import IntegrityError, transaction
from django.db.models import Avg, Count, Q, Prefetch
from django.utils import timezone

from .billing_models import DeliveryStatus
from .journal_models import (
    ABSENT_ATTENDANCE,
    DEFAULT_CRITERIA,
    DEFAULT_TAGS,
    RECOMMENDED_CRITERION_TITLES,
    SCALE_BOUNDS,
    AssessmentCriterion,
    AssessmentTemplate,
    AssessmentTemplateCriterion,
    AttendanceStatus,
    JournalAttentionMarker,
    JournalAuditLog,
    JournalEditLock,
    JournalStatus,
    JournalTag,
    JournalTeacherSettings,
    LessonJournal,
    OverallScoreMode,
    PreviousHomeworkStatus,
    PublishMode,
    RecordPublishStatus,
    ScaleType,
    StudentCriterionScore,
    StudentLessonRecord,
    StudentLessonRecordTag,
)
from .models import Homework, HomeworkSubmission, ScheduleEvent, Student, StudentGroup, StudentSubject
from .submission_files import submission_has_files


class JournalError(Exception):
    def __init__(self, message: str, code: str = "journal_error", status: int = 400):
        super().__init__(message)
        self.message = message
        self.code = code
        self.status = status


def event_duration_minutes(event: ScheduleEvent) -> int | None:
    if not event.starts_at or not event.ends_at:
        return None
    delta = event.ends_at - event.starts_at
    minutes = int(delta.total_seconds() // 60)
    return max(minutes, 0)


def resolve_event_students(event: ScheduleEvent) -> list[Student]:
    students: list[Student] = []
    if event.group_id:
        students = list(event.group.students.exclude(status="archived"))
        if event.student_id and event.student not in students:
            students.append(event.student)
    elif event.student_id:
        students = [event.student]
    else:
        participant_students = (
            event.participants.filter(student__isnull=False)
            .select_related("student")
            .order_by("id")
        )
        seen = set()
        for p in participant_students:
            if p.student_id and p.student_id not in seen:
                seen.add(p.student_id)
                students.append(p.student)
    return [s for s in students if s and getattr(s, "status", None) != "archived"]


def planned_topic_for_event(event: ScheduleEvent) -> str:
    """Планируемая тема из карточки урока / пункта плана / каталожного урока.

    Использует тот же резолвинг пункта плана (явная связь → слот в enrollment),
    что и календарь (schedule_events.schedule_event_to_json) — иначе тема,
    видимая учителю в карточке урока, расходится с журналом.
    Не подставляет имя ученика/группы (часто лежит в event.title / item.title).
    """
    audience_names = {
        (getattr(event, "title", None) or "").strip().lower(),
        (getattr(event, "audience", None) or "").strip().lower(),
    }

    def _clean(value: str) -> str:
        text = (value or "").strip()
        if not text:
            return ""
        if text.lower() in audience_names:
            return ""
        return text

    topic = _clean(getattr(event, "topic", None) or "")

    item = getattr(event, "lesson_plan_item", None)
    if item is None:
        from .plan_schedule import resolve_plan_item_for_event

        item, _lesson_number = resolve_plan_item_for_event(event)
    if item is not None:
        planned = _clean(item.topic or "")
        if planned:
            return planned
        planned = _clean(item.title or "")
        if planned:
            return planned
    if topic:
        return topic
    lesson = getattr(event, "lesson", None)
    if lesson is not None:
        topic = _clean(lesson.topic or "")
        if topic:
            return topic
        topic = _clean(lesson.title or "")
        if topic:
            return topic
    return ""


def sync_planned_topic_from_event(event: ScheduleEvent) -> bool:
    """Подтягивает изменившуюся тему карточки/плана в ещё не финализированный журнал.

    Без этого journal.planned_topic замораживается на моменте создания записи
    журнала и расходится с темой, которую учитель видит в календаре или плане
    после последующих правок (см. LessonLearningPlanSyncService).
    Не трогает журнал, если факт по теме уже проставлен или журнал завершён/отменён —
    там источником истины становится сам журнал.
    """
    journal = LessonJournal.objects.filter(schedule_event_id=event.pk).first()
    if journal is None:
        return False
    if journal.actual_topic:
        return False
    if journal.status not in (JournalStatus.DRAFT, JournalStatus.REOPENED):
        return False
    planned = planned_topic_for_event(event)
    if journal.planned_topic == planned:
        return False
    journal.planned_topic = planned
    journal.save(update_fields=["planned_topic", "updated_at"])
    return True


def attendance_to_delivery_status(attendance: str) -> str:
    """Маппинг академической посещаемости → DeliveryStatus (финансы)."""
    mapping = {
        AttendanceStatus.PRESENT: DeliveryStatus.CONDUCTED,
        AttendanceStatus.LATE: DeliveryStatus.CONDUCTED,
        AttendanceStatus.LEFT_EARLY: DeliveryStatus.CONDUCTED,
        AttendanceStatus.PARTIAL: DeliveryStatus.CONDUCTED,
        AttendanceStatus.ABSENT_EXCUSED: DeliveryStatus.NO_SHOW,
        AttendanceStatus.ABSENT_UNEXCUSED: DeliveryStatus.NO_SHOW,
        AttendanceStatus.CANCELLED_BY_STUDENT: DeliveryStatus.CANCELLED_BY_STUDENT,
        AttendanceStatus.CANCELLED_BY_TEACHER: DeliveryStatus.CANCELLED_BY_TEACHER,
        AttendanceStatus.TECHNICAL_ISSUE: DeliveryStatus.CANCELLED_BY_TEACHER,
        AttendanceStatus.NOT_MARKED: DeliveryStatus.PLANNED,
    }
    return mapping.get(attendance, DeliveryStatus.PLANNED)


def get_or_create_journal_settings(teacher: User) -> JournalTeacherSettings:
    settings, _ = JournalTeacherSettings.objects.get_or_create(teacher=teacher)
    return settings


@transaction.atomic
def ensure_default_criteria(teacher: User) -> list[AssessmentCriterion]:
    existing = list(AssessmentCriterion.objects.filter(teacher=teacher).order_by("sort_order", "id"))
    if existing:
        return existing
    created = []
    for idx, (title, description, scale_type, recommended) in enumerate(DEFAULT_CRITERIA):
        lo, hi = SCALE_BOUNDS[scale_type]
        created.append(
            AssessmentCriterion.objects.create(
                teacher=teacher,
                title=title,
                description=description,
                scale_type=scale_type,
                min_value=lo,
                max_value=hi,
                sort_order=idx,
                is_active=recommended,
                is_recommended_default=recommended,
                visible_to_student=True,
            )
        )
    return created


@transaction.atomic
def ensure_default_tags(teacher: User) -> list[JournalTag]:
    existing = list(JournalTag.objects.filter(teacher=teacher).order_by("sort_order", "id"))
    if existing:
        return existing
    created = []
    for idx, (title, visible) in enumerate(DEFAULT_TAGS):
        created.append(
            JournalTag.objects.create(
                teacher=teacher,
                title=title,
                is_active=True,
                visible_to_student=visible,
                sort_order=idx,
            )
        )
    return created


@transaction.atomic
def ensure_default_templates(teacher: User) -> list[AssessmentTemplate]:
    ensure_default_criteria(teacher)
    existing = list(AssessmentTemplate.objects.filter(teacher=teacher))
    if existing:
        return existing
    criteria = {
        c.title: c
        for c in AssessmentCriterion.objects.filter(teacher=teacher)
    }
    templates_spec = [
        ("Индивидуальный урок", True, list(RECOMMENDED_CRITERION_TITLES)),
        ("Групповое занятие", False, list(RECOMMENDED_CRITERION_TITLES)),
        ("Пробный урок", False, ["Активность", "Понимание темы", "Работа на уроке"]),
        ("Подготовка к ОГЭ", False, list(RECOMMENDED_CRITERION_TITLES | {"Точность выполнения"})),
        ("Подготовка к ЕГЭ", False, list(RECOMMENDED_CRITERION_TITLES | {"Точность выполнения"})),
        ("Программирование", False, ["Активность", "Самостоятельность", "Понимание темы", "Точность выполнения"]),
    ]
    created = []
    for title, is_default, titles in templates_spec:
        tpl = AssessmentTemplate.objects.create(
            teacher=teacher,
            title=title,
            is_default=is_default,
        )
        for order, t in enumerate(titles):
            crit = criteria.get(t)
            if crit:
                AssessmentTemplateCriterion.objects.create(
                    template=tpl, criterion=crit, sort_order=order
                )
        created.append(tpl)
    settings = get_or_create_journal_settings(teacher)
    if settings.default_template_id is None and created:
        settings.default_template = created[0]
        settings.save(update_fields=["default_template", "updated_at"])
    return created


def resolve_assessment_template(
    teacher: User,
    *,
    event: ScheduleEvent | None = None,
    journal: LessonJournal | None = None,
    student: Student | None = None,
    group: StudentGroup | None = None,
) -> AssessmentTemplate | None:
    ensure_default_templates(teacher)
    if journal and journal.assessment_template_id:
        return journal.assessment_template
    student = student or (event.student if event else None)
    group = group or (event.group if event else None)
    if student:
        tpl = AssessmentTemplate.objects.filter(teacher=teacher, student=student).first()
        if tpl:
            return tpl
    if group:
        tpl = AssessmentTemplate.objects.filter(teacher=teacher, group=group).first()
        if tpl:
            return tpl
    subject = ""
    if event and event.lesson_id and getattr(event.lesson, "direction", None):
        subject = event.lesson.direction
    if subject:
        tpl = AssessmentTemplate.objects.filter(teacher=teacher, subject=subject, student__isnull=True, group__isnull=True).first()
        if tpl:
            return tpl
    settings = get_or_create_journal_settings(teacher)
    if settings.default_template_id:
        return settings.default_template
    return AssessmentTemplate.objects.filter(teacher=teacher, is_default=True).first()


def criteria_for_template(template: AssessmentTemplate | None, teacher: User) -> list[AssessmentCriterion]:
    if template:
        links = (
            AssessmentTemplateCriterion.objects.filter(template=template)
            .select_related("criterion")
            .order_by("sort_order", "id")
        )
        return [link.criterion for link in links if link.criterion.is_active]
    return list(
        AssessmentCriterion.objects.filter(
            teacher=teacher, is_active=True, is_recommended_default=True
        ).order_by("sort_order", "id")
    )


def write_audit(
    *,
    actor: User | None,
    action: str,
    journal: LessonJournal | None = None,
    student_record: StudentLessonRecord | None = None,
    field_name: str = "",
    old_value: Any = None,
    new_value: Any = None,
    meta: dict | None = None,
) -> None:
    JournalAuditLog.objects.create(
        journal=journal,
        student_record=student_record,
        actor=actor,
        action=action,
        field_name=field_name,
        old_value=old_value,
        new_value=new_value,
        meta=meta or {},
    )


def previous_homework_for_student(teacher: User, student: Student, before: ScheduleEvent) -> Homework | None:
    return (
        Homework.objects.filter(teacher=teacher)
        .filter(Q(student=student) | Q(group__students=student))
        .filter(created_at__lt=before.starts_at)
        .order_by("-created_at")
        .distinct()
        .first()
    )


def infer_previous_homework_status(homework: Homework | None, student: Student) -> str:
    if homework is None:
        return PreviousHomeworkStatus.NOT_ASSIGNED
    submission = (
        HomeworkSubmission.objects.filter(homework=homework, student=student)
        .order_by("-submitted_at", "-id")
        .first()
    )
    if submission is None:
        return PreviousHomeworkStatus.NOT_DONE
    status = (submission.status or "").lower()
    if status in {"checked", "reviewed", "graded"} and submission.score is not None:
        try:
            score = float(submission.score)
        except (TypeError, ValueError):
            score = None
        if score is not None:
            if score >= 80:
                return PreviousHomeworkStatus.FULL
            if score > 0:
                return PreviousHomeworkStatus.PARTIAL
            return PreviousHomeworkStatus.NOT_DONE
        return PreviousHomeworkStatus.FULL
    if status in {"submitted", "pending", "in_review"}:
        return PreviousHomeworkStatus.NOT_REVIEWED
    if status in {"partial"}:
        return PreviousHomeworkStatus.PARTIAL
    if status in {"not_done", "missing"}:
        return PreviousHomeworkStatus.NOT_DONE
    if submission.score is not None:
        return PreviousHomeworkStatus.FULL
    return PreviousHomeworkStatus.NOT_REVIEWED


@transaction.atomic
@transaction.atomic
def get_or_create_journal(event: ScheduleEvent, teacher: User) -> LessonJournal:
    if event.owner_id != teacher.id:
        raise JournalError("Урок принадлежит другому учителю", code="forbidden", status=403)

    ensure_default_criteria(teacher)
    ensure_default_tags(teacher)
    ensure_default_templates(teacher)

    journal = LessonJournal.objects.filter(schedule_event=event).select_for_update().first()
    if journal:
        _ensure_student_records(journal, event, teacher)
        return journal

    planned = planned_topic_for_event(event)
    duration = event_duration_minutes(event)
    template = resolve_assessment_template(teacher, event=event)
    settings = get_or_create_journal_settings(teacher)

    try:
        journal = LessonJournal.objects.create(
            schedule_event=event,
            teacher=teacher,
            group=event.group,
            student=event.student if not event.group_id else None,
            lesson_date=timezone.localtime(event.starts_at).date(),
            started_at=event.starts_at,
            finished_at=event.ends_at,
            planned_duration_minutes=duration,
            actual_duration_minutes=duration,
            planned_topic=planned,
            actual_topic="",
            assessment_template=template,
            homework=event.homework,
            overall_score_mode=settings.overall_score_mode,
            created_by=teacher,
            updated_by=teacher,
            edit_token=secrets.token_hex(16),
        )
    except IntegrityError:
        journal = LessonJournal.objects.filter(schedule_event=event).select_for_update().first()
        if journal is None:
            raise
        _ensure_student_records(journal, event, teacher)
        return journal
    write_audit(actor=teacher, action="created", journal=journal)
    _ensure_student_records(journal, event, teacher)
    return journal


def _teacher_timezone_name(teacher: User) -> str:
    profile = getattr(teacher, "profile", None)
    name = (getattr(profile, "timezone", None) or "").strip()
    return name or "Europe/Moscow"


def _zoneinfo(name: str):
    try:
        return ZoneInfo((name or "").strip() or "Europe/Moscow")
    except Exception:
        return ZoneInfo("Europe/Moscow")


def _parse_offline_starts(payload: dict, tz_name: str) -> datetime:
    tzinfo = _zoneinfo(tz_name)
    raw_dt = payload.get("starts_at")
    if raw_dt:
        text = str(raw_dt).replace("Z", "+00:00")
        try:
            parsed = datetime.fromisoformat(text)
        except ValueError as exc:
            raise JournalError("Некорректное время начала", code="bad_starts_at") from exc
        if timezone.is_naive(parsed):
            parsed = timezone.make_aware(parsed, tzinfo)
        return parsed

    raw_date = payload.get("lesson_date") or payload.get("date")
    if not raw_date:
        raise JournalError("Укажите дату занятия", code="date_required")
    try:
        lesson_date = dt_date.fromisoformat(str(raw_date)[:10])
    except ValueError as exc:
        raise JournalError("Некорректная дата занятия", code="bad_date") from exc

    raw_time = str(payload.get("starts_time") or payload.get("time") or "12:00").strip()
    try:
        parts = raw_time.split(":")
        hour = int(parts[0])
        minute = int(parts[1]) if len(parts) > 1 else 0
        clock = dt_time(hour=hour, minute=minute)
    except (TypeError, ValueError) as exc:
        raise JournalError("Некорректное время начала", code="bad_time") from exc
    naive = datetime.combine(lesson_date, clock)
    return timezone.make_aware(naive, tzinfo)


@transaction.atomic
def create_offline_journal(teacher: User, payload: dict) -> LessonJournal:
    """Занятие вне платформы: реальный ScheduleEvent (offline), без VideoMeeting.

    Журнал создаётся черновиком. Биллинг не финализируется до complete_journal.
    """
    if not isinstance(payload, dict):
        raise JournalError("Некорректные данные", code="invalid_payload")

    student_id = payload.get("student_id")
    group_id = payload.get("group_id")
    has_student = student_id not in (None, "", 0, "0")
    has_group = group_id not in (None, "", 0, "0")
    if has_student == has_group:
        raise JournalError("Укажите ученика или группу", code="audience_required")

    student = None
    group = None
    if has_student:
        student = Student.objects.filter(pk=student_id, teacher=teacher).first()
        if student is None:
            raise JournalError("Ученик не найден", code="student_not_found", status=404)
    else:
        group = StudentGroup.objects.filter(pk=group_id, teacher=teacher).first()
        if group is None:
            raise JournalError("Группа не найдена", code="group_not_found", status=404)

    student_subject = None
    subject_id = payload.get("student_subject_id")
    if subject_id not in (None, "", 0, "0"):
        qs = StudentSubject.objects.filter(pk=subject_id, student__teacher=teacher)
        if student is not None:
            qs = qs.filter(student=student)
        student_subject = qs.first()
        if student_subject is None:
            raise JournalError("Предмет не найден", code="subject_not_found", status=404)

    try:
        duration = int(payload.get("duration_minutes") or payload.get("actual_duration_minutes") or 60)
    except (TypeError, ValueError) as exc:
        raise JournalError("Некорректная продолжительность", code="bad_duration") from exc
    if duration <= 0 or duration > 24 * 60:
        raise JournalError("Продолжительность должна быть от 1 до 1440 минут", code="bad_duration")

    tz_name = (payload.get("timezone") or "").strip() or _teacher_timezone_name(teacher)
    starts_at = _parse_offline_starts(payload, tz_name)
    ends_at = starts_at + timedelta(minutes=duration)

    actual_topic = (payload.get("actual_topic") or payload.get("topic") or "").strip()[:500]
    planned_topic = (payload.get("planned_topic") or "").strip()[:500]
    title = (payload.get("title") or actual_topic or planned_topic or "Занятие вне платформы")[:200]

    event = ScheduleEvent.objects.create(
        owner=teacher,
        title=title,
        topic=actual_topic or planned_topic,
        starts_at=starts_at,
        ends_at=ends_at,
        event_type=(
            ScheduleEvent.EventType.GROUP_LESSON if group is not None else ScheduleEvent.EventType.INDIVIDUAL_LESSON
        ),
        format=ScheduleEvent.Format.OFFLINE,
        status=ScheduleEvent.Status.PLANNED,
        student=student,
        group=group,
        student_subject=student_subject,
        timezone=tz_name,
    )
    journal = get_or_create_journal(event, teacher)

    extra = {}
    if actual_topic:
        extra["actual_topic"] = actual_topic
    if planned_topic:
        extra["planned_topic"] = planned_topic
    for field in (
        "lesson_summary",
        "material_covered",
        "material_to_repeat",
        "next_lesson_plan",
        "recommendations",
        "actual_duration_minutes",
        "homework_id",
        "homework_skipped",
        "student_records",
    ):
        if field in payload:
            extra[field] = payload[field]
    if extra:
        journal = update_journal(journal, teacher, extra)
    return journal


def _sync_factual_topic_to_event(journal: LessonJournal) -> None:
    """Односторонняя запись фактической темы в карточку занятия. План не трогаем."""
    actual = (journal.actual_topic or "").strip()
    event = journal.schedule_event
    if event is None or not actual:
        return
    if (event.topic or "").strip() == actual:
        return
    event.topic = actual[:500]
    event.save(update_fields=["topic", "updated_at"])


def _strip_answer_html(html: str) -> str:
    import re

    text = re.sub(r"<[^>]+>", " ", str(html or ""))
    text = text.replace("&nbsp;", " ")
    return re.sub(r"\s+", " ", text).strip()


def _import_answers_equal():
    try:
        from Generator.answer_check import answers_equal
    except Exception:
        try:
            from Generator.Generator.answer_check import answers_equal
        except Exception:
            return None
    return answers_equal


def _resolve_answer_ok(
    student_answer: str,
    expected_answer: str,
    saved_ok,
    *,
    subject: str = "",
):
    """
    Вердикт для журнала: при наличии эталона пересчитываем (не доверяем checked ученика).
    Без эталона оставляем сохранённый флаг.
    """
    student = str(student_answer or "").strip()
    expected = str(expected_answer or "").strip()
    if not student:
        return None if saved_ok is None else bool(saved_ok)
    if expected:
        answers_equal = _import_answers_equal()
        if answers_equal is not None:
            return bool(answers_equal(student_answer, expected_answer, subject=subject))
    if saved_ok is None:
        return None
    return bool(saved_ok)


def _refresh_variant_result_verdicts(variant_result: dict | None, *, subject: str = "") -> dict | None:
    """Пересчитать ok/счётчики в уже сохранённом variant_result (для старых записей)."""
    if not isinstance(variant_result, dict) or not variant_result:
        return variant_result
    tasks = variant_result.get("tasks")
    if not isinstance(tasks, list) or not tasks:
        return variant_result
    fixed_tasks = []
    for task in tasks:
        if not isinstance(task, dict):
            continue
        row = dict(task)
        student = row.get("student_answer") or ""
        expected = row.get("correct_answer") or ""
        saved = row.get("ok")
        if saved is None and not str(student).strip():
            fixed_tasks.append(row)
            continue
        row["ok"] = _resolve_answer_ok(student, expected, saved, subject=subject)
        fixed_tasks.append(row)
    checked_count = sum(1 for r in fixed_tasks if r.get("ok") is not None)
    correct_count = sum(1 for r in fixed_tasks if r.get("ok") is True)
    out = dict(variant_result)
    out["tasks"] = fixed_tasks
    out["checked_count"] = checked_count
    out["correct_count"] = correct_count if checked_count else out.get("correct_count")
    if checked_count:
        out["score_percent"] = round(correct_count * 100 / checked_count, 2)
    return out


def build_variant_result_payload(
    *,
    homework: Homework,
    submission: HomeworkSubmission | None,
    tasks: list[dict],
    title: str = "",
    variant_id=None,
) -> dict:
    """Подробный результат live-варианта для записи журнала."""
    from .homework_api import compute_score_percent
    from .meeting_present import _live_result_only_checked

    raw = submission.result_payload if submission else None
    visible = _live_result_only_checked(raw, tasks) or {}
    checked = visible.get("checked") or {}
    by_num = visible.get("by_number") or {}
    by_id = visible.get("by_task_id") or {}
    rows = []
    for task in tasks:
        tid = task.get("id")
        num = task.get("number")
        tid_key = str(tid) if tid is not None else ""
        num_key = str(num) if num is not None else ""
        saved_ok = None
        if tid_key and tid_key in checked:
            saved_ok = bool(checked[tid_key])
        elif num_key and num_key in checked:
            saved_ok = bool(checked[num_key])
        if saved_ok is None:
            continue
        student_answer = ""
        # Сначала id задачи — номера в варианте могут дублироваться.
        if tid_key and by_id.get(tid_key) is not None:
            student_answer = str(by_id.get(tid_key))
        elif num_key and by_num.get(num_key) is not None:
            student_answer = str(by_num.get(num_key))
        correct_answer = task.get("answer") or ""
        ok = _resolve_answer_ok(student_answer, correct_answer, saved_ok)
        rows.append(
            {
                "id": tid,
                "number": num,
                "student_answer": student_answer,
                "correct_answer": _strip_answer_html(correct_answer),
                "ok": ok,
            }
        )
    checked_count = len(rows)
    correct_count = sum(1 for r in rows if r.get("ok") is True)
    score = round(correct_count * 100 / checked_count, 2) if checked_count else compute_score_percent(visible)
    return {
        "homeworkId": homework.id,
        "variantId": variant_id,
        "title": title or homework.title or "Вариант",
        "score_percent": score,
        "checked_count": checked_count,
        "correct_count": correct_count,
        "tasks": rows,
    }


HOMEWORK_STATUS_LABELS = {
    "submitted": "Сдано",
    "checked": "Проверено",
    "returned": "Возвращено",
    "needs_revision": "Нужна доработка",
    "not_submitted": "Не сдано",
    "not_assigned": "Не задавалось",
}


def _homework_variant_meta(homework: Homework) -> tuple[int | None, list[dict]]:
    from .homework_api import extract_variant_id, homework_has_variant_task
    from .meeting_present import _variant_tasks_answer_key

    if not homework_has_variant_task(homework):
        return None, []
    variant_id = None
    for task in homework.tasks.all():
        variant_id = extract_variant_id(task.description)
        if variant_id:
            break
    return variant_id, _variant_tasks_answer_key(variant_id)


def _answer_rows_from_submission(
    *,
    submission: HomeworkSubmission | None,
    tasks: list[dict],
    for_student: bool,
) -> list[dict]:
    """Строки ответов по ДЗ-варианту. by_number только если номер уникален."""
    raw = (submission.result_payload if submission else None) or {}
    if not isinstance(raw, dict):
        raw = {}
    by_id = raw.get("by_task_id") or raw.get("byTaskId") or {}
    by_num = raw.get("by_number") or raw.get("byNumber") or {}
    checked = raw.get("checked") or {}
    number_counts: dict[str, int] = {}
    for task in tasks:
        nk = str(task.get("number")) if task.get("number") is not None else ""
        if nk:
            number_counts[nk] = number_counts.get(nk, 0) + 1

    rows = []
    for task in tasks:
        tid = task.get("id")
        num = task.get("number")
        tid_key = str(tid) if tid is not None else ""
        num_key = str(num) if num is not None else ""
        student_answer = ""
        if tid_key and by_id.get(tid_key) is not None:
            student_answer = str(by_id.get(tid_key))
        elif num_key and number_counts.get(num_key, 0) <= 1 and by_num.get(num_key) is not None:
            student_answer = str(by_num.get(num_key))
        saved_ok = None
        if tid_key and tid_key in checked:
            saved_ok = bool(checked[tid_key])
        elif num_key and number_counts.get(num_key, 0) <= 1 and num_key in checked:
            saved_ok = bool(checked[num_key])
        expected_raw = task.get("answer") or ""
        # Есть ответ ученика и эталон — пересчитываем, даже если checked пустой/ложный.
        if saved_ok is None and str(student_answer).strip() and str(expected_raw).strip():
            saved_ok = False
        ok = _resolve_answer_ok(student_answer, expected_raw, saved_ok)
        row = {
            "id": tid,
            "number": num,
            "student_answer": student_answer,
            "ok": ok,
        }
        if not for_student:
            row["correct_answer"] = _strip_answer_html(expected_raw)
        rows.append(row)
    return rows


def resolve_homework_for_journal_record(
    journal: LessonJournal,
    student: Student,
) -> Homework | None:
    """Предыдущее ДЗ к уроку: из журнала или последнее выданное ученику до урока."""
    if journal.previous_homework_id:
        return journal.previous_homework
    event = journal.schedule_event
    if event is None:
        return None
    return previous_homework_for_student(journal.teacher, student, event)


def build_homework_result_payload(
    *,
    homework: Homework | None,
    student: Student,
    submission: HomeworkSubmission | None = None,
    for_student: bool = False,
) -> dict | None:
    """
    Результат домашнего задания для журнала / «Мои результаты».
    Live-вариант с урока сюда не попадает — он в variant_result записи.
    """
    from .homework_api import compute_score_percent, is_live_meeting_homework

    if homework is None:
        return None
    if is_live_meeting_homework(homework):
        return None

    if submission is None:
        submission = (
            HomeworkSubmission.objects.filter(homework=homework, student=student)
            .order_by("-submitted_at", "-id")
            .first()
        )

    status_key = "not_submitted"
    if submission:
        raw_status = (submission.status or "").strip().lower()
        # Незавершённый черновик (нет submitted_at) не считается итоговой сдачей.
        if raw_status == "submitted" and not submission.submitted_at:
            status_key = "not_submitted"
        elif raw_status in HOMEWORK_STATUS_LABELS and raw_status != "not_submitted":
            status_key = raw_status
        elif submission.submitted_at:
            status_key = "submitted"
        elif submission.result_payload or (submission.answer_text or "").strip() or submission_has_files(submission):
            status_key = "not_submitted"

    score = None
    if submission and submission.score is not None:
        try:
            score = float(submission.score)
        except (TypeError, ValueError):
            score = None
    if score is None and submission and submission.result_payload:
        score = compute_score_percent(submission.result_payload)

    variant_id, tasks = _homework_variant_meta(homework)
    task_rows = (
        _answer_rows_from_submission(
            submission=submission,
            tasks=tasks,
            for_student=for_student,
        )
        if tasks
        else []
    )

    checked_count = sum(1 for r in task_rows if r.get("ok") is not None)
    correct_count = sum(1 for r in task_rows if r.get("ok") is True)
    if score is None and checked_count:
        score = round(correct_count * 100 / checked_count, 2)

    from .homework_attempts import serialize_attempts

    attempts = serialize_attempts(submission) if submission else []
    overdue = False
    if homework.due_at and timezone.now() > homework.due_at:
        if not submission or not submission.submitted_at or submission.submitted_at > homework.due_at:
            overdue = True
        if status_key in {"not_submitted"} and homework.due_at < timezone.now():
            status_key = "overdue"

    HOMEWORK_STATUS_LABELS_EXT = {
        **HOMEWORK_STATUS_LABELS,
        "overdue": "Просрочено",
        "in_progress": "В работе",
        "new": "Не начато",
    }

    return {
        "entry_type": "homework",
        "homework_id": homework.id,
        "title": homework.title or "Домашнее задание",
        "description": (homework.description or "")[:500],
        "assigned_at": homework.created_at.isoformat() if homework.created_at else None,
        "due_at": homework.due_at.isoformat() if homework.due_at else None,
        "status": status_key,
        "status_label": HOMEWORK_STATUS_LABELS_EXT.get(status_key, status_key),
        "submitted_at": (
            submission.submitted_at.isoformat()
            if submission and submission.submitted_at
            else None
        ),
        "score_percent": score,
        "score": score,
        "max_score": 100,
        "teacher_comment": (submission.teacher_comment if submission else "") or "",
        "answer_text": (submission.answer_text if submission else "") or "",
        "has_attached_file": submission_has_files(submission),
        "has_variant": bool(tasks),
        "variant_id": variant_id,
        "checked_count": checked_count or None,
        "correct_count": correct_count if checked_count else None,
        "tasks": task_rows,
        "attempt_count": (
            submission.attempt_count
            if submission and submission.attempt_count
            else len(attempts) or (1 if submission and submission.submitted_at else 0)
        ),
        "attempts": attempts,
        "is_overdue": overdue,
        "review_type": "manual" if (submission and submission.status in {"submitted", "returned", "needs_revision", "checked"}) else "auto",
        "submission_id": submission.id if submission else None,
    }


def _submissions_by_student(
    homework: Homework | None,
    student_ids: list[int],
) -> dict[int, HomeworkSubmission]:
    if homework is None or not student_ids:
        return {}
    out: dict[int, HomeworkSubmission] = {}
    qs = (
        HomeworkSubmission.objects.filter(homework=homework, student_id__in=student_ids)
        .order_by("student_id", "-submitted_at", "-id")
    )
    for sub in qs:
        if sub.student_id not in out:
            out[sub.student_id] = sub
    return out


def apply_live_variant_results_to_journal(
    *,
    event: ScheduleEvent,
    teacher: User,
    presented_payload: dict | None = None,
) -> LessonJournal | None:
    """
    После урока сохраняет подробные ответы live-варианта в журнал ученика:
    оценка %, таблица заданий с ответами и верно/неверно.
    """
    from .meeting_present import _variant_tasks_answer_key

    payload = dict(presented_payload or {})
    homework_id = payload.get("homeworkId") or payload.get("homework_id")
    variant_id = payload.get("variantId") or payload.get("variant_id")
    title = (payload.get("title") or "").strip()

    homework = None
    if homework_id:
        homework = Homework.objects.filter(pk=homework_id, teacher=teacher).first()
    if homework is None:
        marker = f"live-meeting:{event.pk}:variant:"
        homework = (
            Homework.objects.filter(teacher=teacher, description__contains=marker)
            .order_by("-id")
            .first()
        )
    if homework is None:
        return None

    if not variant_id:
        from .homework_api import extract_variant_id

        for task in homework.tasks.all():
            variant_id = extract_variant_id(task.description)
            if variant_id:
                break

    tasks = _variant_tasks_answer_key(variant_id)
    journal = get_or_create_journal(event, teacher)
    update_fields = ["updated_at"]
    # Live-вариант — материал урока; не затираем обычное ДЗ, если оно уже привязано.
    # Фактическую тему не заполняем автоматически — только по действию учителя.
    if journal.homework_id is None:
        journal.homework = homework
        update_fields.append("homework")
    if "live-meeting" in (homework.description or "") and not (journal.material_covered or "").strip():
        journal.material_covered = title or homework.title or "Вариант на уроке"
        update_fields.append("material_covered")
    journal.updated_by = teacher
    update_fields.append("updated_by")
    journal.save(update_fields=list(dict.fromkeys(update_fields)))

    submissions = {
        row.student_id: row
        for row in HomeworkSubmission.objects.filter(homework=homework)
    }
    for record in journal.student_records.select_related("student"):
        submission = submissions.get(record.student_id)
        result_payload = build_variant_result_payload(
            homework=homework,
            submission=submission,
            tasks=tasks,
            title=title or homework.title,
            variant_id=variant_id,
        )
        if not result_payload.get("tasks") and not submission:
            continue
        record.variant_result = result_payload
        fields = ["variant_result", "updated_at"]
        score = result_payload.get("score_percent")
        if score is not None and (record.overall_score is None or not record.overall_score_manual):
            record.overall_score = Decimal(str(score))
            record.overall_score_manual = True
            record.overall_score_explanation = (
                f"По варианту: {result_payload.get('correct_count', 0)}/"
                f"{result_payload.get('checked_count', 0)} верно"
            )
            fields.extend(["overall_score", "overall_score_manual", "overall_score_explanation"])
        record.save(update_fields=fields)

    write_audit(
        actor=teacher,
        action="live_variant_imported",
        journal=journal,
        meta={"homework_id": homework.id, "variant_id": variant_id},
    )
    return journal


def _ensure_student_records(journal: LessonJournal, event: ScheduleEvent, teacher: User) -> None:
    students = resolve_event_students(event)
    existing = set(journal.student_records.values_list("student_id", flat=True))
    criteria = criteria_for_template(journal.assessment_template, teacher)
    for student in students:
        if student.id in existing:
            continue
        prev_hw = previous_homework_for_student(teacher, student, event)
        record = StudentLessonRecord.objects.create(
            journal=journal,
            student=student,
            attendance_status=AttendanceStatus.NOT_MARKED,
        )
        if journal.previous_homework_id is None and prev_hw:
            journal.previous_homework = prev_hw
            journal.previous_homework_status = infer_previous_homework_status(prev_hw, student)
            journal.save(update_fields=["previous_homework", "previous_homework_status", "updated_at"])
        for criterion in criteria:
            StudentCriterionScore.objects.get_or_create(
                student_record=record,
                criterion=criterion,
                defaults={"is_not_applicable": False},
            )


def validate_score_value(criterion: AssessmentCriterion, value: Decimal | None, is_na: bool) -> None:
    if is_na or value is None:
        return
    if value < criterion.min_value or value > criterion.max_value:
        raise JournalError(
            f"Значение критерия «{criterion.title}» вне диапазона "
            f"{criterion.min_value}–{criterion.max_value}",
            code="score_out_of_range",
        )


def compute_overall_score(
    record: StudentLessonRecord,
    mode: str,
) -> tuple[Decimal | None, str]:
    if mode == OverallScoreMode.NONE:
        return None, ""
    if record.overall_score_manual and record.overall_score is not None and mode != OverallScoreMode.AUTO_AVERAGE:
        return record.overall_score, "Ручная оценка"
    if mode != OverallScoreMode.AUTO_AVERAGE:
        return record.overall_score, "Ручная оценка" if record.overall_score is not None else ""

    scores = list(
        record.criterion_scores.filter(is_not_applicable=False, value__isnull=False).select_related("criterion")
    )
    if not scores:
        return None, "Недостаточно данных: нет заполненных критериев"

    # Нормализуем к 0–100, затем к шкале 1–5 для отображения среднего
    norms: list[Decimal] = []
    for s in scores:
        span = s.criterion.max_value - s.criterion.min_value
        if span <= 0:
            continue
        norm = (s.value - s.criterion.min_value) / span * Decimal("100")
        norms.append(norm)
    if not norms:
        return None, "Недостаточно данных: нет заполненных критериев"
    avg_pct = sum(norms) / Decimal(len(norms))
    result = avg_pct.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    explanation = f"Среднее по {len(norms)} критериям: {result}%"
    return result, explanation


def apply_absence_na(record: StudentLessonRecord, *, clear_values: bool = False) -> None:
    if record.attendance_status not in ABSENT_ATTENDANCE:
        return
    qs = record.criterion_scores.all()
    for score in qs:
        score.is_not_applicable = True
        if clear_values:
            score.value = None
        score.save(update_fields=["is_not_applicable", "value"] if clear_values else ["is_not_applicable"])


def _reload_journal(journal_id: int) -> LessonJournal:
    return (
        LessonJournal.objects.select_related(
            "schedule_event",
            "schedule_event__lesson",
            "schedule_event__lesson_plan_item",
            "group",
            "student",
            "homework",
            "assessment_template",
        )
        .prefetch_related(
            Prefetch(
                "student_records",
                queryset=StudentLessonRecord.objects.select_related("student").prefetch_related(
                    "criterion_scores__criterion", "tags", "tag_links__tag"
                ),
            )
        )
        .get(pk=journal_id)
    )


def _sync_planned_topic_to_lesson_and_plan(journal: LessonJournal, teacher: User) -> dict:
    """Синхронизирует planned_topic → ScheduleEvent / Lesson / LessonPlanItem.

    Фактическая тема сюда не передаётся. Циклы блокируются guard'ом
    LessonLearningPlanSyncService.
    """
    from .lesson_plan_content_sync import LessonLearningPlanSyncService, LessonPlanSyncError

    event = journal.schedule_event
    if event is None:
        return {"synced": False, "reason": "no_event"}

    planned = (journal.planned_topic or "").strip()
    actual = (journal.actual_topic or "").strip()
    event_updates = []
    # После complete фактическая тема — SoT карточки занятия. Плановую пишем только в план.
    keep_factual_on_event = bool(actual) and journal.status == JournalStatus.COMPLETED
    if not keep_factual_on_event and (event.topic or "").strip() != planned:
        event.topic = planned[:500]
        event_updates.append("topic")
    # Убрать topic из manual overrides, чтобы план мог снова синхронизироваться
    overrides = list(event.manual_override_fields or [])
    if "topic" in overrides:
        overrides = [f for f in overrides if f != "topic"]
        event.manual_override_fields = overrides
        event_updates.append("manual_override_fields")
    if event_updates:
        event.save(update_fields=list(dict.fromkeys(event_updates + ["updated_at"])))

    lesson = getattr(event, "lesson", None)
    if lesson is not None and lesson.teacher_id == teacher.id:
        lesson_updates = []
        if (lesson.topic or "").strip() != planned[:255]:
            lesson.topic = planned[:255]
            lesson_updates.append("topic")
        # Не перезаписываем title, если это не «техническое» название
        if lesson_updates:
            lesson.save(update_fields=list(dict.fromkeys(lesson_updates + ["updated_at"])))

    plan_result = None
    try:
        plan_result = LessonLearningPlanSyncService.sync_lesson_to_plan(
            event,
            teacher=teacher,
            mode="update_linked",
            confirm_all_students=True,
            title=planned,
        )
    except LessonPlanSyncError as exc:
        # Нет enrollment / draft plan — тема уже сохранена в журнале и карточке.
        if getattr(exc, "code", None) in {
            "no_enrollment",
            "draft_plan",
            "group_confirm_required",
            "alien_plan",
            "public_plan",
            "no_targets",
        }:
            return {
                "synced": True,
                "event_id": event.pk,
                "plan_updated": False,
                "plan_error": exc.code,
                "plan_message": exc.message,
            }
        raise JournalError(exc.message, code=exc.code, status=exc.status) from exc

    return {
        "synced": True,
        "event_id": event.pk,
        "plan_updated": bool((plan_result or {}).get("plan_updated")),
        "plan": plan_result,
    }


@transaction.atomic
def update_lesson_topics(
    journal: LessonJournal,
    teacher: User,
    payload: dict,
    *,
    expected_version: int | None = None,
) -> LessonJournal:
    """Частичное обновление planned_topic / actual_topic.

    planned_topic синхронизируется с карточкой урока и пунктом плана.
    actual_topic сохраняется только в журнале и не меняет план.
    """
    if journal.teacher_id != teacher.id:
        raise JournalError("Нет доступа", code="forbidden", status=403)
    if journal.is_archived:
        raise JournalError("Запись архивирована", code="archived", status=400)
    if expected_version is not None and journal.version != expected_version:
        raise JournalError(
            "Журнал изменён в другой вкладке. Обновите данные.",
            code="version_conflict",
            status=409,
        )
    if not isinstance(payload, dict):
        raise JournalError("Некорректные данные", code="invalid_payload")

    changed: list[str] = []
    if "planned_topic" in payload:
        new_planned = (payload.get("planned_topic") or "").strip()[:500]
        if journal.planned_topic != new_planned:
            write_audit(
                actor=teacher,
                action="update",
                journal=journal,
                field_name="planned_topic",
                old_value=journal.planned_topic,
                new_value=new_planned,
            )
            journal.planned_topic = new_planned
            changed.append("planned_topic")

    if "actual_topic" in payload:
        new_actual = (payload.get("actual_topic") or "").strip()[:500]
        if journal.actual_topic != new_actual:
            write_audit(
                actor=teacher,
                action="update",
                journal=journal,
                field_name="actual_topic",
                old_value=journal.actual_topic,
                new_value=new_actual,
            )
            journal.actual_topic = new_actual
            changed.append("actual_topic")

    if not changed:
        return _reload_journal(journal.pk)

    journal.updated_by = teacher
    journal.version += 1
    journal.save(update_fields=["planned_topic", "actual_topic", "updated_by", "version", "updated_at"])

    if "planned_topic" in changed:
        _sync_planned_topic_to_lesson_and_plan(journal, teacher)
    if "actual_topic" in changed and journal.status == JournalStatus.COMPLETED:
        _sync_factual_topic_to_event(journal)

    return _reload_journal(journal.pk)


@transaction.atomic
def update_journal(
    journal: LessonJournal,
    teacher: User,
    payload: dict,
    *,
    expected_version: int | None = None,
    tab_token: str | None = None,
) -> LessonJournal:
    if journal.teacher_id != teacher.id:
        raise JournalError("Нет доступа", code="forbidden", status=403)
    if journal.is_archived:
        raise JournalError("Запись архивирована", code="archived", status=400)
    if expected_version is not None and journal.version != expected_version:
        raise JournalError(
            "Журнал изменён в другой вкладке. Обновите данные.",
            code="version_conflict",
            status=409,
        )
    if tab_token:
        _acquire_edit_lock(journal, teacher, tab_token)

    # Планируемая тема — только через единый сервис синхронизации.
    topics_payload = {}
    if "planned_topic" in payload:
        topics_payload["planned_topic"] = payload.get("planned_topic")
    if topics_payload:
        journal = update_lesson_topics(journal, teacher, topics_payload)

    journal_fields = [
        "actual_topic",
        "lesson_summary",
        "material_covered",
        "material_to_repeat",
        "next_lesson_plan",
        "recommendations",
        "actual_duration_minutes",
        "started_at",
        "finished_at",
        "homework_skipped",
        "previous_homework_status",
        "overall_score_mode",
        "overall_score_formula",
    ]
    changed = []
    for field in journal_fields:
        if field in payload:
            old = getattr(journal, field)
            new = payload[field]
            if field == "actual_topic" and new is not None:
                new = (new or "").strip()[:500]
            if old != new:
                write_audit(
                    actor=teacher,
                    action="update",
                    journal=journal,
                    field_name=field,
                    old_value=old,
                    new_value=new,
                )
                setattr(journal, field, new)
                changed.append(field)

    if "homework_id" in payload:
        hw_id = payload["homework_id"]
        if hw_id is None:
            journal.homework = None
            changed.append("homework")
        else:
            hw = Homework.objects.filter(id=hw_id, teacher=teacher).first()
            if hw is None:
                raise JournalError("Домашнее задание не найдено", code="homework_not_found")
            journal.homework = hw
            journal.homework_skipped = False
            changed.extend(["homework", "homework_skipped"])

    if "assessment_template_id" in payload:
        tpl_id = payload["assessment_template_id"]
        if tpl_id:
            tpl = AssessmentTemplate.objects.filter(id=tpl_id, teacher=teacher).first()
            if tpl is None:
                raise JournalError("Шаблон не найден", code="template_not_found")
            journal.assessment_template = tpl
            changed.append("assessment_template")
            _sync_criteria_for_records(journal, teacher)

    if "use_planned_topic" in payload and payload["use_planned_topic"]:
        if journal.actual_topic != journal.planned_topic:
            write_audit(
                actor=teacher,
                action="update",
                journal=journal,
                field_name="actual_topic",
                old_value=journal.actual_topic,
                new_value=journal.planned_topic,
            )
            journal.actual_topic = journal.planned_topic
            changed.append("actual_topic")

    records_payload = payload.get("student_records") or []
    for rp in records_payload:
        _update_student_record(journal, teacher, rp)
        changed.append("student_records")

    if not changed and not topics_payload:
        return _reload_journal(journal.pk)

    if changed:
        journal.updated_by = teacher
        journal.version += 1
        journal.save()
        if "actual_topic" in changed and journal.status == JournalStatus.COMPLETED:
            _sync_factual_topic_to_event(journal)
    return _reload_journal(journal.pk)


def _sync_criteria_for_records(journal: LessonJournal, teacher: User) -> None:
    criteria = criteria_for_template(journal.assessment_template, teacher)
    crit_ids = {c.id for c in criteria}
    for record in journal.student_records.all():
        for criterion in criteria:
            StudentCriterionScore.objects.get_or_create(
                student_record=record,
                criterion=criterion,
                defaults={"is_not_applicable": False},
            )
        # Не удаляем старые оценки — только добавляем недостающие


def _update_student_record(journal: LessonJournal, teacher: User, rp: dict) -> StudentLessonRecord:
    record_id = rp.get("id")
    student_id = rp.get("student_id")
    if record_id:
        record = journal.student_records.select_for_update().filter(id=record_id).first()
    elif student_id:
        record = journal.student_records.select_for_update().filter(student_id=student_id).first()
    else:
        raise JournalError("Нужен id или student_id записи")
    if record is None:
        raise JournalError("Запись ученика не найдена", code="record_not_found", status=404)
    if record.student.teacher_id != teacher.id:
        raise JournalError("Ученик не принадлежит учителю", code="forbidden", status=403)

    touched = dict(record.fields_touched or {})
    changed_now: set[str] = set()
    simple_fields = [
        "attendance_status",
        "late_minutes",
        "attended_minutes",
        "teacher_comment",
        "private_note",
        "recommendation",
        "strengths",
        "difficulties",
        "visible_to_student",
        "visible_to_parent",
        "requires_attention",
        "overall_score_manual",
    ]
    for field in simple_fields:
        if field not in rp:
            continue
        new = rp[field]
        if field == "attendance_status" and new not in AttendanceStatus.values:
            raise JournalError(f"Некорректный статус посещаемости: {new}", code="bad_attendance")
        if field in {"late_minutes", "attended_minutes"} and new is not None and int(new) < 0:
            raise JournalError("Минуты не могут быть отрицательными", code="negative_minutes")
        old = getattr(record, field)
        if old != new:
            if record.publish_status == RecordPublishStatus.PUBLISHED:
                record.publish_status = RecordPublishStatus.EDITED_AFTER_PUBLISH
            write_audit(
                actor=teacher,
                action="update_record",
                journal=journal,
                student_record=record,
                field_name=field,
                old_value=old,
                new_value=new,
            )
            setattr(record, field, new)
            touched[field] = True
            changed_now.add(field)

    if "overall_score" in rp:
        val = rp["overall_score"]
        record.overall_score = Decimal(str(val)) if val is not None else None
        record.overall_score_manual = True
        touched["overall_score"] = True

    if "criterion_scores" in rp:
        for cs in rp["criterion_scores"]:
            crit_id = cs.get("criterion_id")
            score = record.criterion_scores.filter(criterion_id=crit_id).select_related("criterion").first()
            if score is None:
                criterion = AssessmentCriterion.objects.filter(id=crit_id, teacher=teacher).first()
                if criterion is None:
                    raise JournalError("Критерий не найден", code="criterion_not_found")
                score = StudentCriterionScore.objects.create(
                    student_record=record, criterion=criterion
                )
            is_na = bool(cs.get("is_not_applicable", score.is_not_applicable))
            value = cs.get("value", score.value)
            if value is not None and value != "":
                value = Decimal(str(value))
            else:
                value = None
            validate_score_value(score.criterion, value, is_na)
            score.value = None if is_na else value
            score.is_not_applicable = is_na
            if "comment" in cs:
                score.comment = cs.get("comment") or ""
            score.save()
            touched[f"criterion_{crit_id}"] = True

    if "tag_ids" in rp:
        tag_ids = list(rp["tag_ids"] or [])
        tags = list(JournalTag.objects.filter(teacher=teacher, id__in=tag_ids))
        StudentLessonRecordTag.objects.filter(record=record).exclude(
            tag_id__in=[t.id for t in tags]
        ).delete()
        for tag in tags:
            StudentLessonRecordTag.objects.get_or_create(record=record, tag=tag)
        touched["tags"] = True

    # Авто-NA при отсутствии
    if record.attendance_status in ABSENT_ATTENDANCE:
        apply_absence_na(record, clear_values=False)

    mode = journal.overall_score_mode
    if mode == OverallScoreMode.AUTO_AVERAGE and not record.overall_score_manual:
        overall, explanation = compute_overall_score(record, mode)
        record.overall_score = overall
        record.overall_score_explanation = explanation
        journal.overall_score_formula = "avg_normalized_to_percent"
    elif mode == OverallScoreMode.AUTO_AVERAGE and record.overall_score_manual:
        _, explanation = compute_overall_score(record, mode)
        record.overall_score_explanation = f"Ручная правка. Автобыло бы: {explanation}"

    record.fields_touched = touched
    if record.publish_status == RecordPublishStatus.DRAFT and any(touched.values()):
        record.publish_status = RecordPublishStatus.SAVED
    record.save()

    # Уже опубликованные итоги: отдельные события по комментарию/рекомендации
    # (не при автосохранении черновика — только после публикации).
    if record.publish_status in {
        RecordPublishStatus.PUBLISHED,
        RecordPublishStatus.EDITED_AFTER_PUBLISH,
    }:
        try:
            from .journal_notifications import (
                notify_journal_comment_added,
                notify_journal_recommendation_added,
            )

            if "teacher_comment" in changed_now:
                notify_journal_comment_added(record)
            if "recommendation" in changed_now:
                notify_journal_recommendation_added(record)
        except Exception:
            pass
    return record


def _acquire_edit_lock(journal: LessonJournal, teacher: User, tab_token: str) -> None:
    now = timezone.now()
    lock = JournalEditLock.objects.filter(journal=journal).first()
    if lock and lock.expires_at > now and lock.tab_token != tab_token and lock.holder_id != teacher.id:
        # Same teacher different tab still warned via version; other holder blocked
        if lock.holder_id != teacher.id:
            raise JournalError(
                "Журнал сейчас редактирует другой пользователь",
                code="edit_locked",
                status=409,
            )
    JournalEditLock.objects.update_or_create(
        journal=journal,
        defaults={
            "holder": teacher,
            "tab_token": tab_token,
            "expires_at": now + timedelta(minutes=15),
        },
    )


@transaction.atomic
def complete_journal(journal: LessonJournal, teacher: User, *, force: bool = False) -> LessonJournal:
    journal = LessonJournal.objects.select_for_update().select_related("schedule_event").get(pk=journal.pk)
    already_completed = journal.status == JournalStatus.COMPLETED

    settings = get_or_create_journal_settings(teacher)
    records = list(journal.student_records.all())
    if not already_completed:
        if settings.require_attendance and not force:
            unmarked = [r for r in records if r.attendance_status == AttendanceStatus.NOT_MARKED]
            if unmarked:
                raise JournalError(
                    f"Не отмечена посещаемость у {len(unmarked)} уч. Подтвердите или отметьте.",
                    code="attendance_required",
                    status=400,
                )
        if settings.require_topic and not (journal.actual_topic or "").strip() and not force:
            raise JournalError("Укажите фактическую тему урока", code="topic_required")
        if settings.require_comment and not force:
            missing = [r for r in records if not (r.teacher_comment or "").strip()]
            if missing:
                raise JournalError(
                    f"Нет комментария у {len(missing)} уч.",
                    code="comment_required",
                )

    event = journal.schedule_event
    if event.status not in {
        ScheduleEvent.Status.COMPLETED,
        ScheduleEvent.Status.DONE,
        ScheduleEvent.Status.CANCELLED,
    }:
        event.status = ScheduleEvent.Status.COMPLETED
        event.save(update_fields=["status", "updated_at"])

    _sync_factual_topic_to_event(journal)

    if already_completed:
        try:
            from .billing_service import auto_finalize_after_lesson_complete

            auto_finalize_after_lesson_complete(event=event, teacher=teacher)
        except Exception:
            pass
        return _reload_journal(journal.pk)

    journal.status = JournalStatus.COMPLETED
    journal.completed_at = timezone.now()
    journal.updated_by = teacher
    journal.version += 1
    journal.save()
    write_audit(actor=teacher, action="completed", journal=journal)

    # Автосписание абонемента / создание задолженности после завершения урока.
    try:
        from .billing_service import auto_finalize_after_lesson_complete

        auto_finalize_after_lesson_complete(event=event, teacher=teacher)
    except Exception:
        pass

    settings_obj = get_or_create_journal_settings(teacher)
    if settings_obj.publish_mode == PublishMode.IMMEDIATE:
        for record in records:
            publish_record(record, teacher, notify=True)

    return _reload_journal(journal.pk)


@transaction.atomic
def publish_record(
    record: StudentLessonRecord,
    teacher: User,
    *,
    notify: bool = True,
    notify_change: bool = False,
) -> StudentLessonRecord:
    journal = record.journal
    if journal.teacher_id != teacher.id:
        raise JournalError("Нет доступа", code="forbidden", status=403)
    was_published = record.publish_status in {
        RecordPublishStatus.PUBLISHED,
        RecordPublishStatus.EDITED_AFTER_PUBLISH,
    }
    record.publish_status = RecordPublishStatus.PUBLISHED
    record.published_at = timezone.now()
    record.visible_to_student = True
    record.save(update_fields=["publish_status", "published_at", "visible_to_student", "updated_at"])
    write_audit(
        actor=teacher,
        action="published",
        journal=journal,
        student_record=record,
        meta={"notify": notify, "notify_change": notify_change},
    )
    if notify and (not was_published or notify_change):
        from .journal_notifications import notify_lesson_results_published

        notify_lesson_results_published(record)
        record.last_notified_at = timezone.now()
        record.save(update_fields=["last_notified_at", "updated_at"])
    return record


@transaction.atomic
def unpublish_record(record: StudentLessonRecord, teacher: User) -> StudentLessonRecord:
    if record.journal.teacher_id != teacher.id:
        raise JournalError("Нет доступа", code="forbidden", status=403)
    record.publish_status = RecordPublishStatus.SAVED
    record.save(update_fields=["publish_status", "updated_at"])
    write_audit(
        actor=teacher,
        action="unpublished",
        journal=record.journal,
        student_record=record,
    )
    return record


@transaction.atomic
def archive_journal(journal: LessonJournal, teacher: User) -> LessonJournal:
    if journal.teacher_id != teacher.id:
        raise JournalError("Нет доступа", code="forbidden", status=403)
    if journal.status == JournalStatus.COMPLETED or any(
        r.publish_status == RecordPublishStatus.PUBLISHED for r in journal.student_records.all()
    ):
        journal.is_archived = True
        journal.save(update_fields=["is_archived", "updated_at"])
        write_audit(actor=teacher, action="archived", journal=journal)
        return journal
    raise JournalError(
        "Удаление опубликованных записей запрещено — используйте архивирование после публикации",
        code="delete_forbidden",
    )


def bulk_mark_present(journal: LessonJournal, teacher: User, *, only_unmarked: bool = False) -> int:
    qs = journal.student_records.all()
    if only_unmarked:
        qs = qs.filter(attendance_status=AttendanceStatus.NOT_MARKED)
    count = 0
    for record in qs:
        if record.attendance_status != AttendanceStatus.PRESENT:
            record.attendance_status = AttendanceStatus.PRESENT
            record.save(update_fields=["attendance_status", "updated_at"])
            count += 1
    write_audit(actor=teacher, action="bulk_mark_present", journal=journal, meta={"count": count})
    return count


def bulk_apply_criterion(
    journal: LessonJournal,
    teacher: User,
    *,
    criterion_id: int,
    value: Decimal | None,
    is_not_applicable: bool = False,
    overwrite_touched: bool = False,
) -> int:
    criterion = AssessmentCriterion.objects.filter(id=criterion_id, teacher=teacher).first()
    if criterion is None:
        raise JournalError("Критерий не найден")
    validate_score_value(criterion, value, is_not_applicable)
    count = 0
    for record in journal.student_records.all():
        key = f"criterion_{criterion_id}"
        if not overwrite_touched and (record.fields_touched or {}).get(key):
            continue
        score, _ = StudentCriterionScore.objects.get_or_create(
            student_record=record, criterion=criterion
        )
        score.value = None if is_not_applicable else value
        score.is_not_applicable = is_not_applicable
        score.save()
        count += 1
    return count


def bulk_apply_comment(
    journal: LessonJournal,
    teacher: User,
    *,
    comment: str,
    overwrite_touched: bool = False,
    include_private: bool = False,
) -> int:
    if include_private:
        raise JournalError(
            "Массовое копирование приватных заметок требует явного подтверждения через include_private=True и overwrite",
            code="private_bulk_blocked",
        )
    count = 0
    for record in journal.student_records.all():
        if not overwrite_touched and (record.fields_touched or {}).get("teacher_comment"):
            continue
        record.teacher_comment = comment
        record.save(update_fields=["teacher_comment", "updated_at"])
        count += 1
    return count


def copy_scores_from_previous(journal: LessonJournal, teacher: User, *, overwrite_touched: bool = False) -> int:
    event = journal.schedule_event
    prev = (
        LessonJournal.objects.filter(teacher=teacher, lesson_date__lt=journal.lesson_date)
        .exclude(pk=journal.pk)
        .order_by("-lesson_date", "-id")
        .first()
    )
    if prev is None:
        # same student/group
        if journal.group_id:
            prev = (
                LessonJournal.objects.filter(teacher=teacher, group_id=journal.group_id)
                .exclude(pk=journal.pk)
                .order_by("-lesson_date", "-id")
                .first()
            )
        elif journal.student_id:
            prev = (
                LessonJournal.objects.filter(teacher=teacher, student_id=journal.student_id)
                .exclude(pk=journal.pk)
                .order_by("-lesson_date", "-id")
                .first()
            )
    if prev is None:
        raise JournalError("Нет предыдущего урока для копирования", code="no_previous")
    prev_by_student = {r.student_id: r for r in prev.student_records.prefetch_related("criterion_scores")}
    count = 0
    for record in journal.student_records.prefetch_related("criterion_scores"):
        src = prev_by_student.get(record.student_id)
        if src is None:
            continue
        for src_score in src.criterion_scores.all():
            key = f"criterion_{src_score.criterion_id}"
            if not overwrite_touched and (record.fields_touched or {}).get(key):
                continue
            dst, _ = StudentCriterionScore.objects.get_or_create(
                student_record=record, criterion=src_score.criterion
            )
            dst.value = src_score.value
            dst.is_not_applicable = src_score.is_not_applicable
            dst.save()
            count += 1
    write_audit(
        actor=teacher,
        action="copy_from_previous",
        journal=journal,
        meta={"from_journal_id": prev.id, "count": count},
    )
    return count


def fill_status_for_journal(journal: LessonJournal) -> str:
    if journal.status == JournalStatus.CANCELLED:
        return "cancelled"
    records = list(journal.student_records.all())
    if not records:
        return "empty"
    if any(r.requires_attention for r in records):
        if journal.status == JournalStatus.COMPLETED:
            return "needs_attention"
    if journal.status == JournalStatus.COMPLETED:
        return "filled"
    if journal.status == JournalStatus.DRAFT:
        touched = any((r.fields_touched or {}) for r in records) or bool(journal.actual_topic)
        return "draft" if touched else "empty"
    if journal.status == JournalStatus.REOPENED:
        return "draft"
    return "empty"


def attendance_report(teacher: User, *, student_id=None, group_id=None, date_from=None, date_to=None) -> dict:
    qs = StudentLessonRecord.objects.filter(journal__teacher=teacher, journal__is_archived=False)
    if student_id:
        qs = qs.filter(student_id=student_id)
    if group_id:
        qs = qs.filter(journal__group_id=group_id)
    if date_from:
        qs = qs.filter(journal__lesson_date__gte=date_from)
    if date_to:
        qs = qs.filter(journal__lesson_date__lte=date_to)

    total = qs.count()
    by_status = {
        row["attendance_status"]: row["c"]
        for row in qs.values("attendance_status").annotate(c=Count("id"))
    }
    present_like = (
        by_status.get(AttendanceStatus.PRESENT, 0)
        + by_status.get(AttendanceStatus.LATE, 0)
        + by_status.get(AttendanceStatus.LEFT_EARLY, 0)
        + by_status.get(AttendanceStatus.PARTIAL, 0)
    )
    absent = (
        by_status.get(AttendanceStatus.ABSENT_EXCUSED, 0)
        + by_status.get(AttendanceStatus.ABSENT_UNEXCUSED, 0)
    )
    from django.db.models import Sum

    late_sum = qs.aggregate(s=Sum("late_minutes"))["s"] or 0
    unmarked = by_status.get(AttendanceStatus.NOT_MARKED, 0)
    rate = float(present_like) / total * 100 if total else 0.0
    return {
        "total_lessons": total,
        "present": by_status.get(AttendanceStatus.PRESENT, 0),
        "late": by_status.get(AttendanceStatus.LATE, 0),
        "absent": absent,
        "cancelled_by_student": by_status.get(AttendanceStatus.CANCELLED_BY_STUDENT, 0),
        "cancelled_by_teacher": by_status.get(AttendanceStatus.CANCELLED_BY_TEACHER, 0),
        "not_marked": unmarked,
        "attendance_rate_percent": round(rate, 1),
        "total_late_minutes": late_sum,
        "by_status": by_status,
    }


def analytics_for_student(teacher: User, student_id: int, *, limit: int = 20) -> dict:
    records = list(
        StudentLessonRecord.objects.filter(
            journal__teacher=teacher,
            student_id=student_id,
            journal__status=JournalStatus.COMPLETED,
        )
        .select_related("journal")
        .prefetch_related("criterion_scores__criterion")
        .order_by("-journal__lesson_date")[:limit]
    )
    records = list(reversed(records))
    if len(records) < 2:
        return {
            "enough_data": False,
            "message": "Недостаточно данных для оценки динамики",
            "series": [],
        }

    series = []
    for r in records:
        point = {
            "date": r.journal.lesson_date.isoformat(),
            "topic": r.journal.actual_topic or r.journal.planned_topic,
            "overall_score": float(r.overall_score) if r.overall_score is not None else None,
            "attendance": r.attendance_status,
            "criteria": {},
        }
        for sc in r.criterion_scores.all():
            if sc.is_not_applicable or sc.value is None:
                continue
            point["criteria"][sc.criterion.title] = float(sc.value)
        series.append(point)

    insights = []
    if len(series) >= 3:
        last3 = series[-3:]
        for title in ("Активность", "Понимание темы", "Самостоятельность"):
            vals = [p["criteria"].get(title) for p in last3 if p["criteria"].get(title) is not None]
            if len(vals) == 3 and vals[0] > vals[1] > vals[2]:
                insights.append(
                    f"Результат по критерию «{title}» снизился на последних трёх занятиях"
                )
            if len(vals) == 3 and vals[0] < vals[1] < vals[2]:
                insights.append(
                    f"Результат по критерию «{title}» вырос на последних трёх занятиях"
                )

    return {
        "enough_data": True,
        "message": "",
        "series": series,
        "insights": insights,
    }


HW_STATUS_LABELS = {
    PreviousHomeworkStatus.FULL: "Выполнено полностью",
    PreviousHomeworkStatus.PARTIAL: "Частично",
    PreviousHomeworkStatus.NOT_DONE: "Не выполнено",
    PreviousHomeworkStatus.NOT_ASSIGNED: "Не задавалось",
    PreviousHomeworkStatus.NOT_REVIEWED: "Не проверено",
}


def _safe_float(value) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _variant_score_percent(variant_result) -> float | None:
    if not isinstance(variant_result, dict) or not variant_result:
        return None
    refreshed = _refresh_variant_result_verdicts(variant_result) or variant_result
    tasks = refreshed.get("tasks") or []
    if isinstance(tasks, list) and tasks:
        checked = [t for t in tasks if isinstance(t, dict) and t.get("ok") is not None]
        if checked:
            correct = sum(1 for t in checked if t.get("ok") is True)
            return round(100.0 * correct / len(checked), 1)
    return _safe_float(refreshed.get("score_percent"))


def sync_previous_homework_status_from_submission(submission) -> None:
    """После проверки ДЗ обновляет previous_homework_status в связанных журналах."""
    if submission is None:
        return
    homework = getattr(submission, "homework", None)
    student = getattr(submission, "student", None)
    if homework is None or student is None:
        return
    status = infer_previous_homework_status(homework, student)
    LessonJournal.objects.filter(previous_homework_id=homework.id).filter(
        Q(student_id=student.id) | Q(group__students=student)
    ).update(previous_homework_status=status, updated_at=timezone.now())


def performance_summary(
    teacher: User,
    *,
    student_id: int | None = None,
    group_id: int | None = None,
    limit: int = 40,
) -> dict:
    """
    Сводка успеваемости: посещаемость, работа на уроке, ДЗ, критерии, динамика.
    Для ученика или группы.
    """
    if not student_id and not group_id:
        raise JournalError("Укажите student_id или group_id", code="scope_required")

    records_qs = (
        StudentLessonRecord.objects.filter(
            journal__teacher=teacher,
            journal__is_archived=False,
        )
        .select_related("journal", "journal__schedule_event", "student")
        .prefetch_related("criterion_scores__criterion")
    )
    journals_qs = LessonJournal.objects.filter(teacher=teacher, is_archived=False)

    if student_id:
        records_qs = records_qs.filter(student_id=student_id)
        journals_qs = journals_qs.filter(
            Q(student_id=student_id) | Q(student_records__student_id=student_id)
        ).distinct()
    if group_id:
        records_qs = records_qs.filter(journal__group_id=group_id)
        journals_qs = journals_qs.filter(group_id=group_id)

    attendance = attendance_report(
        teacher, student_id=student_id, group_id=group_id
    )

    records = list(
        records_qs.order_by(
            "-journal__lesson_date",
            "-journal__schedule_event__starts_at",
            "-id",
        )[:limit]
    )
    # Хронология для графиков: старые → новые
    chronology = list(reversed(records))

    lesson_scores: list[float] = []
    variant_scores: list[float] = []
    homework_scores: list[float] = []
    score_series: list[dict] = []
    # title -> {values, description, scale_type, min_value, max_value, sort_order, id}
    criteria_meta: dict[str, dict] = {}
    attention_count = 0
    comments_count = 0
    hw_by_status: dict[str, int] = {}

    # Все активные критерии учителя — чтобы пояснения были даже без оценок
    for c in AssessmentCriterion.objects.filter(teacher=teacher, is_active=True).order_by(
        "sort_order", "id"
    ):
        criteria_meta[c.title] = {
            "id": c.id,
            "title": c.title,
            "description": (c.description or "").strip(),
            "scale_type": c.scale_type,
            "min_value": _safe_float(c.min_value),
            "max_value": _safe_float(c.max_value),
            "sort_order": c.sort_order,
            "values": [],
        }

    for r in chronology:
        overall = _safe_float(r.overall_score)
        variant_pct = _variant_score_percent(r.variant_result)
        # Вариант на уроке учитываем в работе на уроке, если overall ещё не выставлен.
        lesson_point = overall if overall is not None else variant_pct
        if lesson_point is not None:
            lesson_scores.append(lesson_point)
        if variant_pct is not None:
            variant_scores.append(variant_pct)
        if r.requires_attention:
            attention_count += 1
        if (r.teacher_comment or "").strip():
            comments_count += 1

        # ДЗ: актуальный статус и % из сдачи (не устаревший previous_homework_status).
        hw = resolve_homework_for_journal_record(r.journal, r.student)
        hw_payload = build_homework_result_payload(
            homework=hw,
            student=r.student,
            for_student=False,
        )
        hw_score = _safe_float((hw_payload or {}).get("score_percent")) if hw_payload else None
        if hw_score is not None:
            homework_scores.append(hw_score)
        if hw is not None:
            st = infer_previous_homework_status(hw, r.student)
        else:
            st = (r.journal.previous_homework_status or "").strip()
        if st:
            hw_by_status[st] = hw_by_status.get(st, 0) + 1

        for sc in r.criterion_scores.all():
            if sc.is_not_applicable or sc.value is None:
                continue
            title = sc.criterion.title
            val = _safe_float(sc.value)
            if val is None:
                continue
            meta = criteria_meta.setdefault(
                title,
                {
                    "id": sc.criterion_id,
                    "title": title,
                    "description": (sc.criterion.description or "").strip(),
                    "scale_type": sc.criterion.scale_type,
                    "min_value": _safe_float(sc.criterion.min_value),
                    "max_value": _safe_float(sc.criterion.max_value),
                    "sort_order": sc.criterion.sort_order,
                    "values": [],
                },
            )
            if not meta.get("description"):
                meta["description"] = (sc.criterion.description or "").strip()
            meta["values"].append(val)

        score_series.append(
            {
                "date": r.journal.lesson_date.isoformat(),
                "starts_at": (
                    r.journal.schedule_event.starts_at.isoformat()
                    if r.journal.schedule_event_id and r.journal.schedule_event
                    else None
                ),
                "topic": r.journal.actual_topic or r.journal.planned_topic or "Урок",
                "student_name": r.student.full_name if group_id else None,
                "overall_score": lesson_point,
                "variant_score": variant_pct,
                "homework_score": hw_score,
                "attendance": r.attendance_status,
                "homework_status": st or "",
            }
        )

    # Факт выдачи ДЗ по журналам
    hw_assigned = 0
    hw_skipped = 0
    for j in journals_qs.only(
        "id", "homework_id", "homework_skipped", "previous_homework_status"
    )[:200]:
        if j.homework_id and not j.homework_skipped:
            hw_assigned += 1
        if j.homework_skipped:
            hw_skipped += 1

    hw_done = hw_by_status.get(PreviousHomeworkStatus.FULL, 0) + hw_by_status.get(
        PreviousHomeworkStatus.PARTIAL, 0
    )
    hw_checked = sum(
        hw_by_status.get(k, 0)
        for k in (
            PreviousHomeworkStatus.FULL,
            PreviousHomeworkStatus.PARTIAL,
            PreviousHomeworkStatus.NOT_DONE,
        )
    )
    hw_completion = round(100.0 * hw_done / hw_checked, 1) if hw_checked else None
    avg_homework = (
        round(sum(homework_scores) / len(homework_scores), 1) if homework_scores else None
    )
    # Для индекса: средний % ДЗ, иначе доля выполненных из проверенных.
    hw_metric = avg_homework if avg_homework is not None else hw_completion

    avg_lesson = round(sum(lesson_scores) / len(lesson_scores), 1) if lesson_scores else None
    avg_variant = (
        round(sum(variant_scores) / len(variant_scores), 1) if variant_scores else None
    )

    # Комбинированный индекс: урок(+вариант) 50% + ДЗ 25% + посещаемость 25%
    composite_parts = []
    if avg_lesson is not None:
        composite_parts.append(("lesson", avg_lesson, 0.5))
    elif avg_variant is not None:
        # Если overall нигде нет, но есть результаты вариантов — они идут в индекс.
        composite_parts.append(("lesson", avg_variant, 0.5))
    if hw_metric is not None:
        composite_parts.append(("homework", hw_metric, 0.25))
    if attendance.get("total_lessons"):
        composite_parts.append(
            ("attendance", float(attendance["attendance_rate_percent"]), 0.25)
        )
    if composite_parts:
        weight_sum = sum(w for _, _, w in composite_parts)
        composite = round(
            sum(v * w for _, v, w in composite_parts) / weight_sum, 1
        )
    else:
        composite = None

    SCALE_LABELS = {
        ScaleType.FIVE_POINT: "шкала 1–5",
        ScaleType.TEN_POINT: "шкала 1–10",
        ScaleType.PERCENTAGE: "проценты",
        ScaleType.BINARY: "да/нет",
    }
    # Fallback-описания из дефолтного набора, если у критерия пустое description
    default_desc = {title: desc for title, desc, *_ in DEFAULT_CRITERIA}

    criteria_avg = []
    for meta in sorted(
        criteria_meta.values(),
        key=lambda m: (m.get("sort_order", 0), m.get("title") or ""),
    ):
        vals = meta.get("values") or []
        title = meta["title"]
        description = meta.get("description") or default_desc.get(title, "")
        scale = meta.get("scale_type") or ScaleType.FIVE_POINT
        lo = meta.get("min_value")
        hi = meta.get("max_value")
        if lo is not None and hi is not None:
            scale_label = f"шкала {lo:g}–{hi:g}"
        else:
            scale_label = SCALE_LABELS.get(scale, "шкала")
        criteria_avg.append(
            {
                "id": meta.get("id"),
                "title": title,
                "description": description,
                "scale_type": scale,
                "scale_label": scale_label,
                "min_value": lo,
                "max_value": hi,
                "avg": round(sum(vals) / len(vals), 2) if vals else None,
                "count": len(vals),
                "min": round(min(vals), 2) if vals else None,
                "max": round(max(vals), 2) if vals else None,
            }
        )

    # Динамика: сравнение первой и второй половины серии
    trend = "flat"
    trend_delta = None
    scored_points = [p["overall_score"] for p in score_series if p["overall_score"] is not None]
    if len(scored_points) >= 4:
        mid = len(scored_points) // 2
        first_avg = sum(scored_points[:mid]) / mid
        second_avg = sum(scored_points[mid:]) / (len(scored_points) - mid)
        trend_delta = round(second_avg - first_avg, 1)
        if trend_delta >= 3:
            trend = "up"
        elif trend_delta <= -3:
            trend = "down"

    insights: list[str] = []
    if avg_lesson is not None:
        insights.append(f"Средний результат на уроке: {avg_lesson:g}%")
    if avg_variant is not None:
        insights.append(f"Средний результат по варианту на уроке: {avg_variant:g}%")
    if avg_homework is not None:
        insights.append(f"Средний результат по ДЗ: {avg_homework:g}%")
    elif hw_completion is not None:
        insights.append(f"Выполнение ДЗ (из проверенных): {hw_completion:g}%")
    if attendance.get("total_lessons"):
        insights.append(
            f"Посещаемость: {attendance['attendance_rate_percent']}% "
            f"({attendance['present'] + attendance['late']} из {attendance['total_lessons']})"
        )
    if trend == "up" and trend_delta is not None:
        insights.append(f"Динамика успеваемости растёт (+{trend_delta:g} п.п.)")
    elif trend == "down" and trend_delta is not None:
        insights.append(f"Динамика успеваемости снижается ({trend_delta:g} п.п.)")
    if attention_count:
        insights.append(f"Уроков с маркером внимания: {attention_count}")

    # Для группы — рейтинг учеников
    students_ranking: list[dict] = []
    if group_id:
        by_student: dict[int, dict] = {}
        for r in records:
            bucket = by_student.setdefault(
                r.student_id,
                {
                    "student_id": r.student_id,
                    "student_name": r.student.full_name,
                    "scores": [],
                    "variant_scores": [],
                    "homework_scores": [],
                    "present": 0,
                    "total": 0,
                    "hw_done": 0,
                    "hw_checked": 0,
                },
            )
            bucket["total"] += 1
            ov = _safe_float(r.overall_score)
            vp = _variant_score_percent(r.variant_result)
            lesson_point = ov if ov is not None else vp
            if lesson_point is not None:
                bucket["scores"].append(lesson_point)
            if vp is not None:
                bucket["variant_scores"].append(vp)
            hw = resolve_homework_for_journal_record(r.journal, r.student)
            hw_payload = build_homework_result_payload(
                homework=hw,
                student=r.student,
                for_student=False,
            )
            hw_score = _safe_float((hw_payload or {}).get("score_percent")) if hw_payload else None
            if hw_score is not None:
                bucket["homework_scores"].append(hw_score)
            if r.attendance_status in {
                AttendanceStatus.PRESENT,
                AttendanceStatus.LATE,
                AttendanceStatus.LEFT_EARLY,
                AttendanceStatus.PARTIAL,
            }:
                bucket["present"] += 1
            st = (
                infer_previous_homework_status(hw, r.student)
                if hw is not None
                else (r.journal.previous_homework_status or "")
            )
            if st in {
                PreviousHomeworkStatus.FULL,
                PreviousHomeworkStatus.PARTIAL,
                PreviousHomeworkStatus.NOT_DONE,
            }:
                bucket["hw_checked"] += 1
                if st in {PreviousHomeworkStatus.FULL, PreviousHomeworkStatus.PARTIAL}:
                    bucket["hw_done"] += 1

        for bucket in by_student.values():
            avg_s = (
                round(sum(bucket["scores"]) / len(bucket["scores"]), 1)
                if bucket["scores"]
                else None
            )
            avg_v = (
                round(sum(bucket["variant_scores"]) / len(bucket["variant_scores"]), 1)
                if bucket["variant_scores"]
                else None
            )
            avg_hw = (
                round(sum(bucket["homework_scores"]) / len(bucket["homework_scores"]), 1)
                if bucket["homework_scores"]
                else None
            )
            att_rate = (
                round(100.0 * bucket["present"] / bucket["total"], 1)
                if bucket["total"]
                else None
            )
            hw_rate = (
                avg_hw
                if avg_hw is not None
                else (
                    round(100.0 * bucket["hw_done"] / bucket["hw_checked"], 1)
                    if bucket["hw_checked"]
                    else None
                )
            )
            parts = []
            if avg_s is not None:
                parts.append((avg_s, 0.5))
            elif avg_v is not None:
                parts.append((avg_v, 0.5))
            if hw_rate is not None:
                parts.append((hw_rate, 0.25))
            if att_rate is not None:
                parts.append((att_rate, 0.25))
            index = (
                round(sum(v * w for v, w in parts) / sum(w for _, w in parts), 1)
                if parts
                else None
            )
            students_ranking.append(
                {
                    "student_id": bucket["student_id"],
                    "student_name": bucket["student_name"],
                    "avg_lesson_score": avg_s,
                    "avg_variant_score": avg_v,
                    "avg_homework_score": avg_hw,
                    "attendance_rate": att_rate,
                    "homework_rate": hw_rate,
                    "lessons_count": bucket["total"],
                    "performance_index": index,
                }
            )
        students_ranking.sort(
            key=lambda row: (
                row["performance_index"] is None,
                -(row["performance_index"] or 0),
            )
        )

    # Для группы на графиках — среднее по дате (иначе точки всех учеников смешиваются)
    chart_series = score_series
    if group_id and score_series:
        by_date: dict[str, dict] = {}
        for point in score_series:
            day = point["date"]
            bucket = by_date.setdefault(
                day,
                {
                    "date": day,
                    "topic": point.get("topic") or "Урок",
                    "scores": [],
                    "variants": [],
                },
            )
            if point.get("overall_score") is not None:
                bucket["scores"].append(point["overall_score"])
            if point.get("variant_score") is not None:
                bucket["variants"].append(point["variant_score"])
        chart_series = []
        for day in sorted(by_date.keys()):
            bucket = by_date[day]
            chart_series.append(
                {
                    "date": day,
                    "topic": bucket["topic"],
                    "overall_score": (
                        round(sum(bucket["scores"]) / len(bucket["scores"]), 1)
                        if bucket["scores"]
                        else None
                    ),
                    "variant_score": (
                        round(sum(bucket["variants"]) / len(bucket["variants"]), 1)
                        if bucket["variants"]
                        else None
                    ),
                }
            )

    analytics = (
        analytics_for_student(teacher, int(student_id), limit=limit)
        if student_id
        else {"enough_data": len(scored_points) >= 2, "series": chart_series, "insights": []}
    )

    return {
        "scope": "student" if student_id else "group",
        "lessons_in_summary": len(records),
        "composite_index": composite,
        "trend": trend,
        "trend_delta": trend_delta,
        "lesson_work": {
            "avg_score": avg_lesson,
            "scored_lessons": len(lesson_scores),
            "avg_variant_score": avg_variant,
            "variant_lessons": len(variant_scores),
            "comments_count": comments_count,
            "attention_count": attention_count,
        },
        "homework": {
            "assigned_count": hw_assigned,
            "skipped_count": hw_skipped,
            "completion_percent": hw_completion,
            "avg_score": avg_homework,
            "scored_count": len(homework_scores),
            "checked_count": hw_checked,
            "by_status": [
                {
                    "status": key,
                    "label": HW_STATUS_LABELS.get(key, key),
                    "count": count,
                }
                for key, count in sorted(hw_by_status.items(), key=lambda x: -x[1])
            ],
        },
        "attendance": attendance,
        "criteria": criteria_avg,
        "score_series": chart_series,
        "students_ranking": students_ranking,
        "insights": insights,
        "analytics": analytics,
    }


def topic_history(teacher: User, *, q: str = "", limit: int = 20) -> list[str]:
    qs = (
        LessonJournal.objects.filter(teacher=teacher)
        .exclude(actual_topic="")
        .order_by("-lesson_date")
        .values_list("actual_topic", flat=True)
    )
    if q:
        qs = qs.filter(actual_topic__icontains=q)
    seen = []
    for topic in qs[:200]:
        if topic not in seen:
            seen.append(topic)
        if len(seen) >= limit:
            break
    return seen


def dashboard_attention(teacher: User) -> dict:
    journals = LessonJournal.objects.filter(teacher=teacher, is_archived=False)
    empty_or_draft = journals.filter(
        status__in=[JournalStatus.DRAFT, JournalStatus.REOPENED]
    ).count()
    unmarked = StudentLessonRecord.objects.filter(
        journal__teacher=teacher,
        attendance_status=AttendanceStatus.NOT_MARKED,
        journal__schedule_event__starts_at__lte=timezone.now(),
    ).values("journal_id").distinct().count()
    attention_students = (
        JournalAttentionMarker.objects.filter(teacher=teacher, is_active=True)
        .values("student_id")
        .distinct()
        .count()
    )
    unpublished = StudentLessonRecord.objects.filter(
        journal__teacher=teacher,
        publish_status=RecordPublishStatus.SAVED,
        teacher_comment__gt="",
    ).count()
    return {
        "unfilled_journals": empty_or_draft,
        "unmarked_attendance_lessons": unmarked,
        "attention_students": attention_students,
        "unpublished_comments": unpublished,
    }


def serialize_criterion(c: AssessmentCriterion) -> dict:
    return {
        "id": c.id,
        "title": c.title,
        "description": c.description,
        "scale_type": c.scale_type,
        "min_value": str(c.min_value),
        "max_value": str(c.max_value),
        "sort_order": c.sort_order,
        "is_active": c.is_active,
        "is_recommended_default": c.is_recommended_default,
        "visible_to_student": c.visible_to_student,
    }


def serialize_record(
    record: StudentLessonRecord,
    *,
    for_student: bool = False,
    homework_result: dict | None = None,
    include_homework_result: bool = True,
) -> dict:
    scores = []
    for sc in record.criterion_scores.all():
        if for_student and not sc.criterion.visible_to_student:
            continue
        scores.append(
            {
                "criterion_id": sc.criterion_id,
                "criterion_title": sc.criterion.title,
                "scale_type": sc.criterion.scale_type,
                "min_value": str(sc.criterion.min_value),
                "max_value": str(sc.criterion.max_value),
                "value": str(sc.value) if sc.value is not None else None,
                "is_not_applicable": sc.is_not_applicable,
                "comment": sc.comment if not for_student or sc.criterion.visible_to_student else "",
            }
        )
    tags = []
    for tag in record.tags.all():
        if for_student and not tag.visible_to_student:
            continue
        tags.append({"id": tag.id, "title": tag.title, "visible_to_student": tag.visible_to_student})

    data = {
        "id": record.id,
        "student_id": record.student_id,
        "student_name": record.student.full_name,
        "attendance_status": record.attendance_status,
        "late_minutes": record.late_minutes,
        "attended_minutes": record.attended_minutes,
        "overall_score": str(record.overall_score) if record.overall_score is not None else None,
        "overall_score_manual": record.overall_score_manual,
        "overall_score_explanation": record.overall_score_explanation if not for_student else "",
        "teacher_comment": record.teacher_comment,
        "recommendation": record.recommendation,
        "strengths": record.strengths,
        "difficulties": record.difficulties if not for_student else "",
        "visible_to_student": record.visible_to_student,
        "publish_status": record.publish_status,
        "published_at": record.published_at.isoformat() if record.published_at else None,
        "criterion_scores": scores,
        "tags": tags,
        "requires_attention": False if for_student else record.requires_attention,
    }
    if not for_student:
        data["private_note"] = record.private_note
        data["visible_to_parent"] = record.visible_to_parent
        data["fields_touched"] = record.fields_touched or {}
        data["difficulties"] = record.difficulties
    variant_result = _refresh_variant_result_verdicts(record.variant_result or {}) or {}
    if for_student and isinstance(variant_result, dict):
        # Ученику — свои ответы и верно/неверно, без эталона.
        safe_tasks = []
        for task in variant_result.get("tasks") or []:
            if not isinstance(task, dict):
                continue
            safe_tasks.append(
                {
                    "id": task.get("id"),
                    "number": task.get("number"),
                    "student_answer": task.get("student_answer") or "",
                    "ok": task.get("ok"),
                }
            )
        data["variant_result"] = {
            "title": variant_result.get("title") or "",
            "score_percent": variant_result.get("score_percent"),
            "checked_count": variant_result.get("checked_count"),
            "correct_count": variant_result.get("correct_count"),
            "tasks": safe_tasks,
        }
    else:
        data["variant_result"] = variant_result

    if include_homework_result:
        if homework_result is None:
            hw = resolve_homework_for_journal_record(record.journal, record.student)
            homework_result = build_homework_result_payload(
                homework=hw,
                student=record.student,
                for_student=for_student,
            )
        data["homework_result"] = homework_result
    return data


def serialize_journal(journal: LessonJournal, *, for_student: bool = False) -> dict:
    event = journal.schedule_event
    hw = journal.homework
    records = list(journal.student_records.all())
    prev_hw = journal.previous_homework
    if prev_hw is None and event is not None:
        # Если в журнале ещё не зафиксировано предыдущее ДЗ — берём по первому ученику
        # и кэшируем разбор сдач по id ДЗ (у группы ДЗ может отличаться — тогда per-record).
        pass
    shared_prev = prev_hw
    shared_subs = _submissions_by_student(shared_prev, [r.student_id for r in records]) if shared_prev else {}

    student_records_data = []
    for r in records:
        hw_for_record = shared_prev
        sub = shared_subs.get(r.student_id) if shared_prev else None
        if hw_for_record is None:
            hw_for_record = resolve_homework_for_journal_record(journal, r.student)
            sub = None
        homework_result = build_homework_result_payload(
            homework=hw_for_record,
            student=r.student,
            submission=sub,
            for_student=for_student,
        )
        student_records_data.append(
            serialize_record(
                r,
                for_student=for_student,
                homework_result=homework_result,
            )
        )

    plan_item_id = None
    if event is not None:
        plan_item_id = event.lesson_plan_item_id
    data = {
        "id": journal.id,
        "schedule_event_id": journal.schedule_event_id,
        "lesson_plan_item_id": plan_item_id,
        "teacher_id": journal.teacher_id,
        "group_id": journal.group_id,
        "group_title": journal.group.title if journal.group_id else None,
        "student_id": journal.student_id,
        "lesson_date": journal.lesson_date.isoformat(),
        "starts_at": event.starts_at.isoformat() if event else None,
        "ends_at": event.ends_at.isoformat() if event else None,
        "started_at": journal.started_at.isoformat() if journal.started_at else None,
        "finished_at": journal.finished_at.isoformat() if journal.finished_at else None,
        "planned_duration_minutes": journal.planned_duration_minutes,
        "actual_duration_minutes": journal.actual_duration_minutes,
        "planned_topic": journal.planned_topic,
        "actual_topic": journal.actual_topic,
        "topic": (journal.actual_topic or journal.planned_topic or ""),
        "lesson_summary": journal.lesson_summary,
        "material_covered": journal.material_covered,
        "material_to_repeat": journal.material_to_repeat,
        "next_lesson_plan": journal.next_lesson_plan,
        "recommendations": journal.recommendations,
        "status": journal.status,
        "fill_status": fill_status_for_journal(journal),
        "overall_score_mode": journal.overall_score_mode,
        "overall_score_formula": journal.overall_score_formula,
        "version": journal.version,
        "homework_id": journal.homework_id,
        "homework_skipped": journal.homework_skipped,
        "homework": None,
        "previous_homework_id": journal.previous_homework_id,
        "previous_homework_status": journal.previous_homework_status,
        "previous_homework": None,
        "assessment_template_id": journal.assessment_template_id,
        "completed_at": journal.completed_at.isoformat() if journal.completed_at else None,
        "updated_at": journal.updated_at.isoformat() if journal.updated_at else None,
        "is_group": bool(journal.group_id),
        "format": event.format if event else None,
        "is_offline": bool(event and event.format == ScheduleEvent.Format.OFFLINE),
        "student_records": student_records_data,
        "billing_hint": {
            "note": "Посещаемость из журнала используется модулем оплат. Не выбирайте её повторно.",
            "attendance_to_delivery": {
                r.student_id: attendance_to_delivery_status(r.attendance_status)
                for r in records
            },
        },
    }
    if hw:
        from .homework_attachments import list_homework_attachments

        attachments = list_homework_attachments(hw)
        data["homework"] = {
            "id": hw.id,
            "title": hw.title,
            "due_at": hw.due_at.isoformat() if hw.due_at else None,
            "tasks_count": hw.tasks.count(),
            "status": hw.status,
            "attachments": attachments,
            "attachments_count": len(attachments),
        }
    if prev_hw:
        data["previous_homework"] = {
            "id": prev_hw.id,
            "title": prev_hw.title,
            "due_at": prev_hw.due_at.isoformat() if prev_hw.due_at else None,
        }
    if for_student:
        data.pop("billing_hint", None)
        data["student_records"] = [
            r for r in data["student_records"]
            if r["publish_status"] == RecordPublishStatus.PUBLISHED and r.get("visible_to_student", True)
        ]
        # strip private fields already handled in serialize_record
    return data


MONTH_LABELS_RU = (
    "",
    "ЯНВАРЬ",
    "ФЕВРАЛЬ",
    "МАРТ",
    "АПРЕЛЬ",
    "МАЙ",
    "ИЮНЬ",
    "ИЮЛЬ",
    "АВГУСТ",
    "СЕНТЯБРЬ",
    "ОКТЯБРЬ",
    "НОЯБРЬ",
    "ДЕКАБРЬ",
)


def format_overall_score_display(score, mode: str | None = None) -> str:
    """Форматирует итоговый результат для UI (проценты по умолчанию)."""
    if score is None:
        return ""
    value = float(score)
    mode = mode or OverallScoreMode.AUTO_AVERAGE
    if mode in {OverallScoreMode.PERCENTAGE, OverallScoreMode.AUTO_AVERAGE}:
        if value == int(value):
            return f"{int(value)}%"
        return f"{value:.1f}%"
    if value == int(value):
        return str(int(value))
    return f"{value:.1f}"


def cell_mark_from_record(record: StudentLessonRecord) -> dict:
    """Отображение ячейки классического журнала: % / н / б / оп."""
    att = record.attendance_status
    if att == AttendanceStatus.ABSENT_UNEXCUSED:
        return {"kind": "absent", "display": "н", "score": None, "css": "absent"}
    if att == AttendanceStatus.ABSENT_EXCUSED:
        return {"kind": "sick", "display": "б", "score": None, "css": "sick"}
    if att in {
        AttendanceStatus.CANCELLED_BY_STUDENT,
        AttendanceStatus.CANCELLED_BY_TEACHER,
        AttendanceStatus.TECHNICAL_ISSUE,
    }:
        return {"kind": "cancelled", "display": "отм", "score": None, "css": "cancelled"}
    if att == AttendanceStatus.NOT_MARKED and record.overall_score is None:
        return {"kind": "empty", "display": "", "score": None, "css": "empty"}

    score = float(record.overall_score) if record.overall_score is not None else None
    mode = getattr(record.journal, "overall_score_mode", OverallScoreMode.AUTO_AVERAGE)
    display = ""
    if score is not None:
        display = format_overall_score_display(score, mode)
    elif att == AttendanceStatus.PRESENT:
        display = ""
    elif att == AttendanceStatus.LATE:
        display = "оп"
    elif att in {AttendanceStatus.PARTIAL, AttendanceStatus.LEFT_EARLY}:
        display = "ч"

    css = "score"
    if att == AttendanceStatus.LATE:
        css = "late"
    return {
        "kind": "score" if score is not None else "attendance",
        "display": display,
        "score": score,
        "css": css,
        "late": att == AttendanceStatus.LATE,
        "has_homework": bool(record.journal.homework_id and not record.journal.homework_skipped),
        "has_comment": bool((record.teacher_comment or "").strip()),
    }


def build_gradebook(
    teacher: User,
    *,
    group_id: int | None = None,
    student_id: int | None = None,
    date_from=None,
    date_to=None,
) -> dict:
    """Матрица классического журнала: ученики × уроки (даты/темы)."""
    if not group_id and not student_id:
        raise JournalError("Укажите group_id или student_id", code="scope_required")

    group = None
    students: list[Student] = []
    if group_id:
        gid = int(group_id)
        group = StudentGroup.objects.filter(pk=gid, teacher=teacher).first()
        if group is None:
            raise JournalError("Группа не найдена", code="not_found", status=404)
        students = list(group.students.filter(status="active").order_by("last_name", "first_name"))
        journals_qs = LessonJournal.objects.filter(
            teacher=teacher, group_id=gid, is_archived=False
        )
    else:
        sid = int(student_id)
        student = Student.objects.filter(pk=sid, teacher=teacher).first()
        if student is None:
            raise JournalError("Ученик не найден", code="not_found", status=404)
        students = [student]
        journals_qs = LessonJournal.objects.filter(
            teacher=teacher, is_archived=False
        ).filter(Q(student_id=sid) | Q(student_records__student_id=sid)).distinct()

    if date_from:
        journals_qs = journals_qs.filter(lesson_date__gte=date_from)
    if date_to:
        journals_qs = journals_qs.filter(lesson_date__lte=date_to)

    journals = list(
        journals_qs.select_related("schedule_event", "homework")
        .prefetch_related(
            Prefetch(
                "student_records",
                queryset=StudentLessonRecord.objects.select_related("student"),
            )
        )
        .order_by("lesson_date", "schedule_event__starts_at", "id")[:120]
    )

    student_ids = [s.id for s in students]
    columns = []
    for journal in journals:
        topic = (journal.actual_topic or journal.planned_topic or "Без темы").strip()
        month = journal.lesson_date.month
        records_by_student = {r.student_id: r for r in journal.student_records.all()}
        cells = {}
        for sid in student_ids:
            record = records_by_student.get(sid)
            if record is None:
                cells[str(sid)] = {
                    "kind": "empty",
                    "display": "",
                    "score": None,
                    "css": "empty",
                    "record_id": None,
                }
            else:
                mark = cell_mark_from_record(record)
                mark["record_id"] = record.id
                mark["attendance_status"] = record.attendance_status
                mark["publish_status"] = record.publish_status
                cells[str(sid)] = mark

        columns.append(
            {
                "journal_id": journal.id,
                "schedule_event_id": journal.schedule_event_id,
                "lesson_date": journal.lesson_date.isoformat(),
                "day": journal.lesson_date.day,
                "month": month,
                "month_key": f"{journal.lesson_date.year}-{month:02d}",
                "month_label": MONTH_LABELS_RU[month],
                "year": journal.lesson_date.year,
                "topic": topic,
                "has_homework": bool(journal.homework_id and not journal.homework_skipped),
                "fill_status": fill_status_for_journal(journal),
                "column_type": "Урок",
                "cells": cells,
            }
        )

    # Группы месяцев и тем для многоуровневого заголовка
    month_spans = []
    topic_spans = []
    if columns:
        m_start = 0
        for i in range(1, len(columns) + 1):
            if i == len(columns) or columns[i]["month_key"] != columns[m_start]["month_key"]:
                month_spans.append(
                    {
                        "month_key": columns[m_start]["month_key"],
                        "label": columns[m_start]["month_label"],
                        "start": m_start,
                        "span": i - m_start,
                    }
                )
                m_start = i

        t_start = 0
        for i in range(1, len(columns) + 1):
            same = (
                i < len(columns)
                and columns[i]["topic"] == columns[t_start]["topic"]
                and columns[i]["month_key"] == columns[t_start]["month_key"]
            )
            if not same:
                topic_cols = columns[t_start:i]
                topic_avgs = {}
                for sid in student_ids:
                    scores = [
                        c["cells"][str(sid)]["score"]
                        for c in topic_cols
                        if c["cells"][str(sid)].get("score") is not None
                    ]
                    topic_avgs[str(sid)] = (
                        round(sum(scores) / len(scores), 2) if scores else None
                    )
                topic_spans.append(
                    {
                        "topic": columns[t_start]["topic"],
                        "month_key": columns[t_start]["month_key"],
                        "start": t_start,
                        "span": i - t_start,
                        "averages": topic_avgs,
                    }
                )
                t_start = i

    overall = {}
    for sid in student_ids:
        scores = [
            col["cells"][str(sid)]["score"]
            for col in columns
            if col["cells"][str(sid)].get("score") is not None
        ]
        overall[str(sid)] = round(sum(scores) / len(scores), 2) if scores else None

    return {
        "scope": {
            "type": "group" if group else "student",
            "id": group.id if group else students[0].id,
            "title": group.title if group else students[0].full_name,
        },
        "students": [
            {
                "id": s.id,
                "name": s.full_name,
                "index": idx + 1,
            }
            for idx, s in enumerate(students)
        ],
        "columns": columns,
        "month_spans": month_spans,
        "topic_spans": topic_spans,
        "overall_averages": overall,
    }


def _parse_date(value):
    if not value:
        return None
    if hasattr(value, "year"):
        return value
    from datetime import date as date_cls

    try:
        return date_cls.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def build_journal_entries_feed(
    teacher: User,
    *,
    student_id=None,
    group_id=None,
    date_from=None,
    date_to=None,
    entry_type: str | None = None,
    homework_status: str | None = None,
    overdue_only: bool = False,
    reviewed: str | None = None,
    homework_only: bool = False,
    limit: int = 200,
) -> dict:
    """
    Единая лента записей журнала: уроки + домашние задания.
    Результаты ДЗ читаются из HomeworkSubmission (без копирования в отдельную таблицу).
    """
    from .models import Homework, HomeworkSubmission, Student, StudentGroup

    d_from = _parse_date(date_from)
    d_to = _parse_date(date_to)
    entries: list[dict] = []

    student_ids: list[int] = []
    if student_id:
        student_ids = [int(student_id)]
    elif group_id:
        group = StudentGroup.objects.filter(pk=group_id, teacher=teacher).first()
        if group:
            student_ids = list(group.students.values_list("id", flat=True))

    include_lessons = not homework_only and (not entry_type or entry_type == "lesson")
    include_homework = not entry_type or entry_type == "homework" or homework_only

    if include_lessons:
        records = (
            StudentLessonRecord.objects.filter(journal__teacher=teacher, journal__is_archived=False)
            .select_related("journal", "student", "journal__group", "journal__schedule_event")
            .order_by("-journal__lesson_date", "-id")
        )
        if student_ids:
            records = records.filter(student_id__in=student_ids)
        if group_id:
            records = records.filter(journal__group_id=group_id)
        if d_from:
            records = records.filter(journal__lesson_date__gte=d_from)
        if d_to:
            records = records.filter(journal__lesson_date__lte=d_to)
        for r in records[:limit]:
            score = float(r.overall_score) if r.overall_score is not None else None
            comment = r.teacher_comment or ""
            entries.append(
                {
                    "id": f"lesson-{r.id}",
                    "entry_type": "lesson",
                    "entry_type_label": "Урок",
                    "date": r.journal.lesson_date.isoformat() if r.journal.lesson_date else None,
                    "sort_at": (
                        r.journal.started_at.isoformat()
                        if r.journal.started_at
                        else (r.journal.lesson_date.isoformat() if r.journal.lesson_date else None)
                    ),
                    "student_id": r.student_id,
                    "student_name": r.student.full_name,
                    "group_id": r.journal.group_id,
                    "group_name": r.journal.group.title if r.journal.group_id else "",
                    "teacher_id": teacher.id,
                    "title": r.journal.actual_topic or r.journal.planned_topic or "Урок",
                    "subject": "",
                    "status": r.publish_status,
                    "status_label": dict(RecordPublishStatus.choices).get(
                        r.publish_status, "Урок"
                    ),
                    "attendance": r.attendance_status,
                    "attendance_label": dict(AttendanceStatus.choices).get(
                        r.attendance_status, ""
                    ),
                    "score": score,
                    "score_percent": score,
                    "max_score": 100,
                    "comment": comment,
                    "comment_visibility": getattr(r, "comment_visibility", "student_only"),
                    "visible_to_student": bool(getattr(r, "visible_to_student", True)),
                    "visible_to_parent": bool(getattr(r, "visible_to_parent", False)),
                    "record_id": r.id,
                    "journal_id": r.journal_id,
                    "is_overdue": False,
                    "review_type": None,
                    "attempt_count": None,
                    "badge": "Урок",
                }
            )

    if include_homework:
        hw_qs = (
            Homework.objects.filter(teacher=teacher)
            .exclude(status="draft")
            .select_related("student", "group", "teacher")
            .prefetch_related(
                Prefetch(
                    "submissions",
                    queryset=HomeworkSubmission.objects.select_related("student").prefetch_related("attempts"),
                )
            )
            .order_by("-created_at")
        )
        if student_ids:
            hw_qs = hw_qs.filter(Q(student_id__in=student_ids) | Q(group__students__id__in=student_ids)).distinct()
        if group_id:
            hw_qs = hw_qs.filter(group_id=group_id)
        if d_from:
            hw_qs = hw_qs.filter(Q(due_at__date__gte=d_from) | Q(created_at__date__gte=d_from))
        if d_to:
            hw_qs = hw_qs.filter(Q(due_at__date__lte=d_to) | Q(created_at__date__lte=d_to))

        target_students = list(
            Student.objects.filter(teacher=teacher, id__in=student_ids)
            if student_ids
            else Student.objects.none()
        )
        if not student_ids and group_id:
            target_students = list(Student.objects.filter(teacher=teacher, groups__id=group_id))

        for hw in hw_qs[: max(limit, 50)]:
            students_for_hw = target_students
            if not students_for_hw:
                if hw.student_id:
                    students_for_hw = [hw.student]
                elif hw.group_id:
                    students_for_hw = list(hw.group.students.all()[:40])
            for st in students_for_hw:
                payload = build_homework_result_payload(homework=hw, student=st)
                if not payload:
                    continue
                st_key = payload.get("status") or "not_submitted"
                if homework_status and st_key != homework_status:
                    continue
                if overdue_only and not payload.get("is_overdue"):
                    continue
                if reviewed == "yes" and st_key != "checked":
                    continue
                if reviewed == "no" and st_key == "checked":
                    continue
                date_val = None
                if payload.get("submitted_at"):
                    date_val = payload["submitted_at"][:10]
                elif hw.due_at:
                    date_val = timezone.localtime(hw.due_at).date().isoformat()
                else:
                    date_val = timezone.localtime(hw.created_at).date().isoformat()
                entries.append(
                    {
                        "id": f"homework-{hw.id}-{st.id}",
                        "entry_type": "homework",
                        "entry_type_label": "ДЗ",
                        "date": date_val,
                        "sort_at": payload.get("submitted_at") or (hw.due_at.isoformat() if hw.due_at else hw.created_at.isoformat()),
                        "student_id": st.id,
                        "student_name": st.full_name,
                        "group_id": hw.group_id,
                        "group_name": hw.group.title if hw.group_id else "",
                        "teacher_id": teacher.id,
                        "title": payload.get("title") or hw.title,
                        "subject": "",
                        "status": st_key,
                        "status_label": payload.get("status_label"),
                        "attendance": None,
                        "score": payload.get("score_percent"),
                        "score_percent": payload.get("score_percent"),
                        "max_score": 100,
                        "comment": payload.get("teacher_comment") or "",
                        "homework_id": hw.id,
                        "submission_id": payload.get("submission_id"),
                        "due_at": payload.get("due_at"),
                        "submitted_at": payload.get("submitted_at"),
                        "assigned_at": payload.get("assigned_at"),
                        "is_overdue": bool(payload.get("is_overdue")),
                        "review_type": payload.get("review_type"),
                        "attempt_count": payload.get("attempt_count"),
                        "attempts": payload.get("attempts") or [],
                        "tasks": payload.get("tasks") or [],
                        "badge": "ДЗ",
                        "review_url": f"/cabinet/review?homework={hw.id}&student={st.id}",
                    }
                )

    entries.sort(key=lambda e: e.get("sort_at") or "", reverse=True)
    entries = entries[:limit]
    summary = homework_journal_summary(entries)
    return {
        "entries": entries,
        "summary": summary,
        "summary_hint": (
            "Средний результат ДЗ считается только по работам со статусом «Проверено» "
            "и ненулевым итоговым процентом. Посещаемость в средний результат не входит."
        ),
    }


def homework_journal_summary(entries: list[dict]) -> dict:
    hw = [e for e in entries if e.get("entry_type") == "homework"]
    checked_scores = [
        float(e["score_percent"])
        for e in hw
        if e.get("status") == "checked" and e.get("score_percent") is not None
    ]
    return {
        "homework_assigned": len(hw),
        "homework_submitted": sum(1 for e in hw if e.get("status") in {"submitted", "checked", "returned", "needs_revision"}),
        "homework_checked": sum(1 for e in hw if e.get("status") == "checked"),
        "homework_not_submitted": sum(1 for e in hw if e.get("status") in {"not_submitted", "overdue", "new", "in_progress"}),
        "homework_overdue": sum(1 for e in hw if e.get("is_overdue")),
        "homework_pending_review": sum(1 for e in hw if e.get("status") == "submitted"),
        "homework_average_percent": (
            round(sum(checked_scores) / len(checked_scores), 2) if checked_scores else None
        ),
    }
