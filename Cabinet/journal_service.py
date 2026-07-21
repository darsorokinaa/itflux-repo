"""Бизнес-логика электронного журнала успеваемости."""

from __future__ import annotations

import secrets
from datetime import timedelta
from decimal import Decimal, ROUND_HALF_UP
from typing import Any

from django.contrib.auth.models import User
from django.db import transaction
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
from .models import Homework, HomeworkSubmission, ScheduleEvent, Student, StudentGroup


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
        students = list(event.group.students.all())
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
    return students


def planned_topic_for_event(event: ScheduleEvent) -> str:
    if event.topic:
        return event.topic
    item = getattr(event, "lesson_plan_item", None)
    if item is not None:
        return (item.topic or item.title or "").strip()
    lesson = getattr(event, "lesson", None)
    if lesson is not None:
        return (lesson.topic or lesson.title or "").strip()
    return ""


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
        actual_topic=planned,
        assessment_template=template,
        homework=event.homework,
        overall_score_mode=settings.overall_score_mode,
        created_by=teacher,
        updated_by=teacher,
        edit_token=secrets.token_hex(16),
    )
    write_audit(actor=teacher, action="created", journal=journal)
    _ensure_student_records(journal, event, teacher)
    return journal


def _strip_answer_html(html: str) -> str:
    import re

    text = re.sub(r"<[^>]+>", " ", str(html or ""))
    text = text.replace("&nbsp;", " ")
    return re.sub(r"\s+", " ", text).strip()


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
        ok = None
        if tid_key and tid_key in checked:
            ok = bool(checked[tid_key])
        elif num_key and num_key in checked:
            ok = bool(checked[num_key])
        if ok is None:
            continue
        student_answer = ""
        if num_key and by_num.get(num_key) is not None:
            student_answer = str(by_num.get(num_key))
        elif tid_key and by_id.get(tid_key) is not None:
            student_answer = str(by_id.get(tid_key))
        rows.append(
            {
                "id": tid,
                "number": num,
                "student_answer": student_answer,
                "correct_answer": _strip_answer_html(task.get("answer") or ""),
                "ok": ok,
            }
        )
    score = compute_score_percent(visible)
    checked_count = len(rows)
    correct_count = sum(1 for r in rows if r.get("ok") is True)
    return {
        "homeworkId": homework.id,
        "variantId": variant_id,
        "title": title or homework.title or "Вариант",
        "score_percent": score,
        "checked_count": checked_count,
        "correct_count": correct_count,
        "tasks": rows,
    }


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
    if not journal.actual_topic and title:
        journal.actual_topic = title
        update_fields.append("actual_topic")
    # Live-вариант — материал урока; не затираем обычное ДЗ, если оно уже привязано.
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
        journal.actual_topic = journal.planned_topic
        changed.append("actual_topic")

    records_payload = payload.get("student_records") or []
    for rp in records_payload:
        _update_student_record(journal, teacher, rp)

    journal.updated_by = teacher
    journal.version += 1
    journal.save()
    return (
        LessonJournal.objects.select_related(
            "schedule_event", "group", "student", "homework", "assessment_template"
        )
        .prefetch_related(
            Prefetch(
                "student_records",
                queryset=StudentLessonRecord.objects.select_related("student").prefetch_related(
                    "criterion_scores__criterion", "tags", "tag_links__tag"
                ),
            )
        )
        .get(pk=journal.pk)
    )


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
    settings = get_or_create_journal_settings(teacher)
    records = list(journal.student_records.all())
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

    return journal


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
    direct = _safe_float(variant_result.get("score_percent"))
    if direct is not None:
        return direct
    tasks = variant_result.get("tasks") or []
    if not isinstance(tasks, list) or not tasks:
        return None
    checked = [t for t in tasks if isinstance(t, dict) and t.get("ok") is not None]
    if not checked:
        return None
    correct = sum(1 for t in checked if t.get("ok") is True)
    return round(100.0 * correct / len(checked), 1)


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
    score_series: list[dict] = []
    # title -> {values, description, scale_type, min_value, max_value, sort_order, id}
    criteria_meta: dict[str, dict] = {}
    attention_count = 0
    comments_count = 0

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
        if overall is not None:
            lesson_scores.append(overall)
        if variant_pct is not None:
            variant_scores.append(variant_pct)
        if r.requires_attention:
            attention_count += 1
        if (r.teacher_comment or "").strip():
            comments_count += 1

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
                "overall_score": overall,
                "variant_score": variant_pct,
                "attendance": r.attendance_status,
                "homework_status": r.journal.previous_homework_status or "",
            }
        )

    # ДЗ по журналам (статус проверки предыдущего ДЗ + факт выдачи)
    hw_by_status: dict[str, int] = {}
    hw_assigned = 0
    hw_skipped = 0
    for j in journals_qs.only(
        "id", "homework_id", "homework_skipped", "previous_homework_status"
    )[:200]:
        if j.homework_id and not j.homework_skipped:
            hw_assigned += 1
        if j.homework_skipped:
            hw_skipped += 1
        st = (j.previous_homework_status or "").strip()
        if st:
            hw_by_status[st] = hw_by_status.get(st, 0) + 1

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

    avg_lesson = round(sum(lesson_scores) / len(lesson_scores), 1) if lesson_scores else None
    avg_variant = (
        round(sum(variant_scores) / len(variant_scores), 1) if variant_scores else None
    )

    # Комбинированный индекс: урок 50% + ДЗ 25% + посещаемость 25%
    composite_parts = []
    if avg_lesson is not None:
        composite_parts.append(("lesson", avg_lesson, 0.5))
    if hw_completion is not None:
        composite_parts.append(("homework", hw_completion, 0.25))
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
    if hw_completion is not None:
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
                    "present": 0,
                    "total": 0,
                    "hw_done": 0,
                    "hw_checked": 0,
                },
            )
            bucket["total"] += 1
            ov = _safe_float(r.overall_score)
            if ov is not None:
                bucket["scores"].append(ov)
            vp = _variant_score_percent(r.variant_result)
            if vp is not None:
                bucket["variant_scores"].append(vp)
            if r.attendance_status in {
                AttendanceStatus.PRESENT,
                AttendanceStatus.LATE,
                AttendanceStatus.LEFT_EARLY,
                AttendanceStatus.PARTIAL,
            }:
                bucket["present"] += 1
            st = r.journal.previous_homework_status or ""
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
            att_rate = (
                round(100.0 * bucket["present"] / bucket["total"], 1)
                if bucket["total"]
                else None
            )
            hw_rate = (
                round(100.0 * bucket["hw_done"] / bucket["hw_checked"], 1)
                if bucket["hw_checked"]
                else None
            )
            parts = []
            if avg_s is not None:
                parts.append((avg_s, 0.5))
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


def serialize_record(record: StudentLessonRecord, *, for_student: bool = False) -> dict:
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
    variant_result = record.variant_result or {}
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
    return data


def serialize_journal(journal: LessonJournal, *, for_student: bool = False) -> dict:
    event = journal.schedule_event
    hw = journal.homework
    data = {
        "id": journal.id,
        "schedule_event_id": journal.schedule_event_id,
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
        "assessment_template_id": journal.assessment_template_id,
        "completed_at": journal.completed_at.isoformat() if journal.completed_at else None,
        "updated_at": journal.updated_at.isoformat() if journal.updated_at else None,
        "is_group": bool(journal.group_id),
        "student_records": [
            serialize_record(r, for_student=for_student) for r in journal.student_records.all()
        ],
        "billing_hint": {
            "note": "Посещаемость из журнала используется модулем оплат. Не выбирайте её повторно.",
            "attendance_to_delivery": {
                r.student_id: attendance_to_delivery_status(r.attendance_status)
                for r in journal.student_records.all()
            },
        },
    }
    if hw:
        data["homework"] = {
            "id": hw.id,
            "title": hw.title,
            "due_at": hw.due_at.isoformat() if hw.due_at else None,
            "tasks_count": hw.tasks.count(),
            "status": hw.status,
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
