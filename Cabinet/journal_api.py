"""API электронного журнала успеваемости (/api/cabinet/journal/)."""

from __future__ import annotations

import csv
import io
from decimal import Decimal, InvalidOperation

from django.db.models import Avg, Count, Prefetch, Q
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .journal_models import (
    AssessmentCriterion,
    AssessmentTemplate,
    AssessmentTemplateCriterion,
    AttendanceStatus,
    JournalAttentionMarker,
    JournalStatus,
    JournalTag,
    JournalTeacherSettings,
    LessonJournal,
    RecordPublishStatus,
    SCALE_BOUNDS,
    ScaleType,
    StudentLessonRecord,
)
from .journal_service import (
    JournalError,
    analytics_for_student,
    attendance_report,
    build_gradebook,
    build_homework_result_payload,
    build_journal_entries_feed,
    performance_summary,
    bulk_apply_comment,
    bulk_apply_criterion,
    bulk_mark_present,
    complete_journal,
    copy_scores_from_previous,
    create_offline_journal,
    dashboard_attention,
    ensure_default_criteria,
    ensure_default_tags,
    ensure_default_templates,
    fill_status_for_journal,
    format_overall_score_display,
    get_or_create_journal,
    get_or_create_journal_settings,
    publish_record,
    resolve_homework_for_journal_record,
    serialize_criterion,
    serialize_journal,
    serialize_record,
    topic_history,
    unpublish_record,
    update_journal,
    update_lesson_topics,
)
from .homework_from_review import HomeworkFromReviewError
from .models import ScheduleEvent, Student, StudentGroup
from .permissions import IsCabinetStudent, IsCabinetTeacher
from .student_errors import collect_student_errors, create_homework_from_student_errors


def _err(exc: Exception) -> Response:
    if isinstance(exc, JournalError):
        return Response({"detail": exc.message, "code": exc.code}, status=exc.status)
    raise exc


def _hw_err(exc: Exception) -> Response:
    if isinstance(exc, HomeworkFromReviewError):
        return Response({"detail": exc.message, "code": exc.code}, status=exc.status)
    raise exc


class JournalGradebookView(APIView):
    """Классическая матрица журнала: ученики × даты/темы."""

    permission_classes = [IsAuthenticated, IsCabinetTeacher]

    def get(self, request):
        try:
            data = build_gradebook(
                request.user,
                group_id=request.query_params.get("group_id"),
                student_id=request.query_params.get("student_id"),
                date_from=request.query_params.get("date_from"),
                date_to=request.query_params.get("date_to"),
            )
        except JournalError as e:
            return _err(e)
        return Response(data)


class JournalEntriesView(APIView):
    """Единая лента: уроки + ДЗ (результат из HomeworkSubmission)."""

    permission_classes = [IsAuthenticated, IsCabinetTeacher]

    def get(self, request):
        params = request.query_params
        data = build_journal_entries_feed(
            request.user,
            student_id=params.get("student_id"),
            group_id=params.get("group_id"),
            date_from=params.get("date_from"),
            date_to=params.get("date_to"),
            entry_type=params.get("entry_type"),
            homework_status=params.get("homework_status"),
            overdue_only=params.get("overdue") in {"1", "true", "yes"},
            reviewed=params.get("reviewed"),
            homework_only=params.get("homework_only") in {"1", "true", "yes"},
            limit=min(int(params.get("limit") or 200), 500),
        )
        return Response(data)


class JournalOverviewView(APIView):
    permission_classes = [IsAuthenticated, IsCabinetTeacher]

    def get(self, request):
        ensure_default_templates(request.user)
        data = dashboard_attention(request.user)
        recent = (
            LessonJournal.objects.filter(teacher=request.user, is_archived=False)
            .select_related("schedule_event", "group", "student")
            .prefetch_related("student_records")
            .order_by("-lesson_date", "-id")[:10]
        )
        data["recent"] = [
            {
                "id": j.id,
                "schedule_event_id": j.schedule_event_id,
                "lesson_date": j.lesson_date.isoformat(),
                "topic": j.actual_topic or j.planned_topic,
                "fill_status": fill_status_for_journal(j),
                "status": j.status,
                "group_title": j.group.title if j.group_id else None,
                "student_name": j.student.full_name if j.student_id else None,
            }
            for j in recent
        ]
        return Response(data)


class JournalLessonsListView(APIView):
    permission_classes = [IsAuthenticated, IsCabinetTeacher]

    def get(self, request):
        qs = (
            LessonJournal.objects.filter(teacher=request.user, is_archived=False)
            .select_related("schedule_event", "group", "student")
            .prefetch_related("student_records")
            .order_by("-lesson_date", "-id")
        )
        params = request.query_params
        if params.get("student_id"):
            sid = params["student_id"]
            qs = qs.filter(Q(student_id=sid) | Q(student_records__student_id=sid)).distinct()
        if params.get("group_id"):
            qs = qs.filter(group_id=params["group_id"])
        if params.get("date_from"):
            qs = qs.filter(lesson_date__gte=params["date_from"])
        if params.get("date_to"):
            qs = qs.filter(lesson_date__lte=params["date_to"])
        if params.get("status"):
            qs = qs.filter(status=params["status"])
        if params.get("unfilled") in {"1", "true", "yes"}:
            qs = qs.filter(status__in=[JournalStatus.DRAFT, JournalStatus.REOPENED])
        if params.get("needs_attention") in {"1", "true", "yes"}:
            qs = qs.filter(student_records__requires_attention=True).distinct()
        if params.get("no_comment") in {"1", "true", "yes"}:
            qs = qs.filter(
                Q(student_records__teacher_comment="") | Q(student_records__teacher_comment__isnull=True)
            ).distinct()
        if params.get("attendance"):
            qs = qs.filter(student_records__attendance_status=params["attendance"]).distinct()
        if params.get("q"):
            q = params["q"]
            qs = qs.filter(
                Q(actual_topic__icontains=q)
                | Q(planned_topic__icontains=q)
                | Q(group__title__icontains=q)
                | Q(student__first_name__icontains=q)
                | Q(student__last_name__icontains=q)
            ).distinct()

        items = []
        for j in qs[:200]:
            event = j.schedule_event
            audience = j.group.title if j.group_id else (j.student.full_name if j.student_id else "—")
            attendance_summary = {}
            for r in j.student_records.all():
                attendance_summary[r.attendance_status] = attendance_summary.get(r.attendance_status, 0) + 1
            items.append(
                {
                    "id": j.id,
                    "schedule_event_id": j.schedule_event_id,
                    "lesson_date": j.lesson_date.isoformat(),
                    "starts_at": event.starts_at.isoformat() if event else None,
                    "ends_at": event.ends_at.isoformat() if event else None,
                    "topic": j.actual_topic or j.planned_topic,
                    "planned_topic": j.planned_topic,
                    "actual_topic": j.actual_topic,
                    "audience": audience,
                    "is_group": bool(j.group_id),
                    "status": j.status,
                    "fill_status": fill_status_for_journal(j),
                    "attendance_summary": attendance_summary,
                    "format": event.format if event else None,
                    "is_offline": bool(event and event.format == ScheduleEvent.Format.OFFLINE),
                }
            )
        return Response({"results": items, "count": len(items)})

    def post(self, request):
        try:
            journal = create_offline_journal(
                request.user,
                request.data if isinstance(request.data, dict) else {},
            )
        except JournalError as e:
            return _err(e)
        journal = (
            LessonJournal.objects.select_related(
                "schedule_event",
                "group",
                "student",
                "homework",
                "previous_homework",
                "assessment_template",
            )
            .prefetch_related(
                Prefetch(
                    "student_records",
                    queryset=StudentLessonRecord.objects.select_related("student").prefetch_related(
                        "criterion_scores__criterion", "tags"
                    ),
                )
            )
            .get(pk=journal.pk)
        )
        return Response(serialize_journal(journal), status=status.HTTP_201_CREATED)


class JournalLessonDetailView(APIView):
    permission_classes = [IsAuthenticated, IsCabinetTeacher]

    def _get_event(self, request, lesson_id: int) -> ScheduleEvent:
        return get_object_or_404(ScheduleEvent, pk=lesson_id, owner=request.user)

    def get(self, request, lesson_id: int):
        event = self._get_event(request, lesson_id)
        try:
            journal = get_or_create_journal(event, request.user)
        except JournalError as e:
            return _err(e)
        journal = (
            LessonJournal.objects.select_related(
                "schedule_event",
                "group",
                "student",
                "homework",
                "previous_homework",
                "assessment_template",
            )
            .prefetch_related(
                Prefetch(
                    "student_records",
                    queryset=StudentLessonRecord.objects.select_related("student").prefetch_related(
                        "criterion_scores__criterion", "tags"
                    ),
                )
            )
            .get(pk=journal.pk)
        )
        return Response(serialize_journal(journal))

    def post(self, request, lesson_id: int):
        return self.patch(request, lesson_id)

    def patch(self, request, lesson_id: int):
        event = self._get_event(request, lesson_id)
        try:
            journal = get_or_create_journal(event, request.user)
            journal = update_journal(
                journal,
                request.user,
                request.data if isinstance(request.data, dict) else {},
                expected_version=request.data.get("version"),
                tab_token=request.data.get("tab_token"),
            )
        except JournalError as e:
            return _err(e)
        return Response(serialize_journal(journal))


class JournalLessonTopicsView(APIView):
    """Частичное обновление планируемой и фактической темы занятия."""

    permission_classes = [IsAuthenticated, IsCabinetTeacher]

    def patch(self, request, lesson_id: int):
        event = get_object_or_404(ScheduleEvent, pk=lesson_id, owner=request.user)
        try:
            journal = get_or_create_journal(event, request.user)
            payload = request.data if isinstance(request.data, dict) else {}
            journal = update_lesson_topics(
                journal,
                request.user,
                payload,
                expected_version=payload.get("version"),
            )
        except JournalError as e:
            return _err(e)
        return Response(serialize_journal(journal))

    def post(self, request, lesson_id: int):
        return self.patch(request, lesson_id)


class JournalLessonCompleteView(APIView):
    permission_classes = [IsAuthenticated, IsCabinetTeacher]

    def post(self, request, lesson_id: int):
        event = get_object_or_404(ScheduleEvent, pk=lesson_id, owner=request.user)
        try:
            journal = get_or_create_journal(event, request.user)
            if request.data:
                journal = update_journal(journal, request.user, request.data)
            journal = complete_journal(
                journal, request.user, force=bool(request.data.get("force"))
            )
        except JournalError as e:
            return _err(e)
        journal = LessonJournal.objects.prefetch_related(
            "student_records__criterion_scores__criterion",
            "student_records__tags",
            "student_records__student",
        ).select_related(
            "schedule_event", "homework", "previous_homework", "group", "student"
        ).get(pk=journal.pk)
        return Response(serialize_journal(journal))


class JournalLessonPublishView(APIView):
    permission_classes = [IsAuthenticated, IsCabinetTeacher]

    def post(self, request, lesson_id: int):
        event = get_object_or_404(ScheduleEvent, pk=lesson_id, owner=request.user)
        try:
            journal = get_or_create_journal(event, request.user)
            notify = request.data.get("notify", True)
            notify_change = bool(request.data.get("notify_change", False))
            record_ids = request.data.get("record_ids")
            qs = journal.student_records.all()
            if record_ids:
                qs = qs.filter(id__in=record_ids)
            published = []
            for record in qs:
                publish_record(
                    record, request.user, notify=bool(notify), notify_change=notify_change
                )
                published.append(record.id)
        except JournalError as e:
            return _err(e)
        journal = LessonJournal.objects.prefetch_related(
            "student_records__criterion_scores__criterion",
            "student_records__tags",
            "student_records__student",
        ).select_related("schedule_event", "homework").get(pk=journal.pk)
        return Response({"published_record_ids": published, "journal": serialize_journal(journal)})


class JournalLessonBulkView(APIView):
    permission_classes = [IsAuthenticated, IsCabinetTeacher]

    def post(self, request, lesson_id: int):
        event = get_object_or_404(ScheduleEvent, pk=lesson_id, owner=request.user)
        action = request.data.get("action")
        try:
            journal = get_or_create_journal(event, request.user)
            if action == "mark_all_present":
                count = bulk_mark_present(
                    journal, request.user, only_unmarked=bool(request.data.get("only_unmarked"))
                )
            elif action == "apply_criterion":
                value = request.data.get("value")
                if value is not None and value != "":
                    value = Decimal(str(value))
                else:
                    value = None
                count = bulk_apply_criterion(
                    journal,
                    request.user,
                    criterion_id=int(request.data["criterion_id"]),
                    value=value,
                    is_not_applicable=bool(request.data.get("is_not_applicable")),
                    overwrite_touched=bool(request.data.get("overwrite_touched")),
                )
            elif action == "apply_comment":
                count = bulk_apply_comment(
                    journal,
                    request.user,
                    comment=request.data.get("comment") or "",
                    overwrite_touched=bool(request.data.get("overwrite_touched")),
                    include_private=bool(request.data.get("include_private")),
                )
            elif action == "copy_previous":
                count = copy_scores_from_previous(
                    journal,
                    request.user,
                    overwrite_touched=bool(request.data.get("overwrite_touched")),
                )
            elif action == "clear_scores":
                if not request.data.get("confirm"):
                    raise JournalError("Требуется подтверждение", code="confirm_required")
                count = 0
                for record in journal.student_records.all():
                    for sc in record.criterion_scores.all():
                        if (record.fields_touched or {}).get(f"criterion_{sc.criterion_id}") and not request.data.get(
                            "overwrite_touched"
                        ):
                            continue
                        sc.value = None
                        sc.is_not_applicable = False
                        sc.save()
                        count += 1
            else:
                raise JournalError("Неизвестное действие", code="bad_action")
        except (JournalError, KeyError, InvalidOperation, ValueError) as e:
            if isinstance(e, JournalError):
                return _err(e)
            return Response({"detail": str(e)}, status=400)
        journal = LessonJournal.objects.prefetch_related(
            "student_records__criterion_scores__criterion",
            "student_records__tags",
            "student_records__student",
        ).select_related("schedule_event").get(pk=journal.pk)
        return Response({"count": count, "journal": serialize_journal(journal)})


class JournalStudentView(APIView):
    permission_classes = [IsAuthenticated, IsCabinetTeacher]

    def get(self, request, student_id: int):
        student = get_object_or_404(Student, pk=student_id, teacher=request.user)
        records = (
            StudentLessonRecord.objects.filter(journal__teacher=request.user, student=student)
            .select_related("journal", "journal__schedule_event")
            .prefetch_related("criterion_scores__criterion", "tags")
            .order_by(
                "-journal__lesson_date",
                "-journal__schedule_event__starts_at",
                "-journal__id",
                "-id",
            )[:50]
        )
        att = attendance_report(request.user, student_id=student_id)
        analytics = analytics_for_student(request.user, student_id)
        summary = performance_summary(request.user, student_id=student_id)
        markers = list(
            JournalAttentionMarker.objects.filter(
                teacher=request.user, student=student, is_active=True
            ).values("id", "reason", "custom_reason", "note", "created_at")
        )
        return Response(
            {
                "student": {
                    "id": student.id,
                    "full_name": student.full_name,
                    "direction": student.direction,
                },
                "attendance": att,
                "analytics": analytics,
                "summary": summary,
                "attention_markers": markers,
                "lessons": [
                    {
                        "record_id": r.id,
                        "journal_id": r.journal_id,
                        "schedule_event_id": r.journal.schedule_event_id,
                        "lesson_date": r.journal.lesson_date.isoformat(),
                        "starts_at": (
                            r.journal.schedule_event.starts_at.isoformat()
                            if r.journal.schedule_event_id and r.journal.schedule_event
                            else (r.journal.started_at.isoformat() if r.journal.started_at else None)
                        ),
                        "ends_at": (
                            r.journal.schedule_event.ends_at.isoformat()
                            if r.journal.schedule_event_id and r.journal.schedule_event
                            else (r.journal.finished_at.isoformat() if r.journal.finished_at else None)
                        ),
                        "topic": r.journal.actual_topic or r.journal.planned_topic,
                        "planned_topic": r.journal.planned_topic,
                        "actual_topic": r.journal.actual_topic,
                        "attendance_status": r.attendance_status,
                        "overall_score": str(r.overall_score) if r.overall_score is not None else None,
                        "overall_score_mode": r.journal.overall_score_mode,
                        "overall_score_display": format_overall_score_display(
                            r.overall_score, r.journal.overall_score_mode
                        )
                        or None,
                        "teacher_comment": r.teacher_comment,
                        "private_note": r.private_note,
                        "recommendation": r.recommendation,
                        "strengths": r.strengths,
                        "difficulties": r.difficulties,
                        "requires_attention": r.requires_attention,
                        "publish_status": r.publish_status,
                        "lesson_summary": r.journal.lesson_summary,
                        "material_covered": r.journal.material_covered,
                        "material_to_repeat": r.journal.material_to_repeat,
                        "next_lesson_plan": r.journal.next_lesson_plan,
                        "recommendations": r.journal.recommendations,
                        "status": r.journal.status,
                        "is_offline": bool(
                            r.journal.schedule_event_id
                            and r.journal.schedule_event
                            and r.journal.schedule_event.format == ScheduleEvent.Format.OFFLINE
                        ),
                        "criterion_scores": serialize_record(r)["criterion_scores"],
                    }
                    for r in records
                ],
            }
        )


class JournalStudentErrorsView(APIView):
    """Банк ошибок ученика: задачи с ошибками по предметам."""

    permission_classes = [IsAuthenticated, IsCabinetTeacher]

    def get(self, request, student_id: int):
        student = get_object_or_404(Student, pk=student_id, teacher=request.user)
        include_partial = str(request.query_params.get("include_partial", "1")).lower() not in (
            "0",
            "false",
            "no",
        )
        summary_only = str(request.query_params.get("summary", "")).lower() in (
            "1",
            "true",
            "yes",
        ) or str(request.query_params.get("include_details", "1")).lower() in (
            "0",
            "false",
            "no",
        )
        try:
            data = collect_student_errors(
                teacher=request.user,
                student=student,
                include_partial=include_partial,
                include_details=not summary_only,
            )
        except HomeworkFromReviewError as exc:
            return _hw_err(exc)
        return Response(data)


class JournalStudentErrorsHomeworkView(APIView):
    """Составить работу над ошибками и выдать как ДЗ."""

    permission_classes = [IsAuthenticated, IsCabinetTeacher]

    def post(self, request, student_id: int):
        student = get_object_or_404(Student, pk=student_id, teacher=request.user)
        payload = request.data if isinstance(request.data, dict) else {}
        try:
            result = create_homework_from_student_errors(
                teacher=request.user,
                student=student,
                title=payload.get("title") or "",
                description=payload.get("description") or "",
                due_at=payload.get("due_at"),
                mode=payload.get("mode") or "assign",
                comment=payload.get("comment") or "",
                generator_task_ids=payload.get("generator_task_ids"),
                selected_tasks=payload.get("selected_tasks"),
                idempotency_key=payload.get("idempotency_key") or "",
            )
        except HomeworkFromReviewError as exc:
            return _hw_err(exc)

        homeworks_payload = []
        for item in result.get("homeworks") or []:
            hw = item["homework"]
            homeworks_payload.append(
                {
                    "id": hw.id,
                    "title": hw.title,
                    "status": hw.status,
                    "due_at": hw.due_at.isoformat() if hw.due_at else None,
                    "subject": item.get("subject"),
                    "level": item.get("level"),
                    "tasks_count": item.get("tasks_count"),
                    "created": item.get("created"),
                    "homework_url": f"/cabinet/homework/{hw.id}",
                }
            )

        primary = result["homework"]
        return Response(
            {
                "id": primary.id,
                "title": primary.title,
                "status": primary.status,
                "due_at": primary.due_at.isoformat() if primary.due_at else None,
                "homework_url": f"/cabinet/homework/{primary.id}",
                "created": result.get("created"),
                "idempotent": result.get("idempotent"),
                "notified": result.get("notified"),
                "tasks_count": result.get("tasks_count"),
                "count": result.get("count"),
                "message": result.get("message"),
                "homeworks": homeworks_payload,
            },
            status=status.HTTP_201_CREATED if result.get("created") else status.HTTP_200_OK,
        )


class JournalGroupView(APIView):
    permission_classes = [IsAuthenticated, IsCabinetTeacher]

    def get(self, request, group_id: int):
        group = get_object_or_404(StudentGroup, pk=group_id, teacher=request.user)
        journals = (
            LessonJournal.objects.filter(teacher=request.user, group=group, is_archived=False)
            .select_related("schedule_event")
            .prefetch_related("student_records__student", "student_records__criterion_scores")
            .order_by("-lesson_date", "-schedule_event__starts_at", "-id")[:40]
        )
        attention = (
            JournalAttentionMarker.objects.filter(
                teacher=request.user, is_active=True, student__groups=group
            )
            .select_related("student")
            .distinct()
        )
        summary = performance_summary(request.user, group_id=group_id)
        return Response(
            {
                "group": {"id": group.id, "title": group.title},
                "summary": summary,
                "attention_students": [
                    {"id": m.student_id, "name": m.student.full_name, "reason": m.reason}
                    for m in attention
                ],
                "lessons": [
                    {
                        "id": j.id,
                        "schedule_event_id": j.schedule_event_id,
                        "lesson_date": j.lesson_date.isoformat(),
                        "starts_at": (
                            j.schedule_event.starts_at.isoformat()
                            if j.schedule_event_id and j.schedule_event
                            else (j.started_at.isoformat() if j.started_at else None)
                        ),
                        "ends_at": (
                            j.schedule_event.ends_at.isoformat()
                            if j.schedule_event_id and j.schedule_event
                            else (j.finished_at.isoformat() if j.finished_at else None)
                        ),
                        "topic": j.actual_topic or j.planned_topic,
                        "planned_topic": j.planned_topic,
                        "actual_topic": j.actual_topic,
                        "fill_status": fill_status_for_journal(j),
                        "status": j.status,
                        "is_offline": bool(
                            j.schedule_event_id
                            and j.schedule_event
                            and j.schedule_event.format == ScheduleEvent.Format.OFFLINE
                        ),
                        "homework_id": j.homework_id,
                        "lesson_summary": j.lesson_summary,
                        "material_covered": j.material_covered,
                        "material_to_repeat": j.material_to_repeat,
                        "next_lesson_plan": j.next_lesson_plan,
                        "recommendations": j.recommendations,
                        "overall_score_mode": j.overall_score_mode,
                        "avg_overall": _avg_overall(j),
                        "avg_overall_display": format_overall_score_display(
                            _avg_overall(j), j.overall_score_mode
                        )
                        or None,
                        "students": [
                            {
                                "record_id": r.id,
                                "student_id": r.student_id,
                                "student_name": r.student.full_name,
                                "attendance_status": r.attendance_status,
                                "overall_score": (
                                    str(r.overall_score) if r.overall_score is not None else None
                                ),
                                "overall_score_display": format_overall_score_display(
                                    r.overall_score, j.overall_score_mode
                                )
                                or None,
                                "teacher_comment": r.teacher_comment,
                                "recommendation": r.recommendation,
                                "strengths": r.strengths,
                                "difficulties": r.difficulties,
                                "private_note": r.private_note,
                                "requires_attention": r.requires_attention,
                                "publish_status": r.publish_status,
                            }
                            for r in j.student_records.all()
                        ],
                    }
                    for j in journals
                ],
            }
        )


def _avg_overall(journal: LessonJournal):
    vals = [
        float(r.overall_score)
        for r in journal.student_records.all()
        if r.overall_score is not None
    ]
    if not vals:
        return None
    return round(sum(vals) / len(vals), 2)


class JournalAttendanceView(APIView):
    permission_classes = [IsAuthenticated, IsCabinetTeacher]

    def get(self, request):
        data = attendance_report(
            request.user,
            student_id=request.query_params.get("student_id"),
            group_id=request.query_params.get("group_id"),
            date_from=request.query_params.get("date_from"),
            date_to=request.query_params.get("date_to"),
        )
        return Response(data)


class JournalAnalyticsView(APIView):
    permission_classes = [IsAuthenticated, IsCabinetTeacher]

    def get(self, request):
        student_id = request.query_params.get("student_id")
        if not student_id:
            return Response({"detail": "student_id обязателен"}, status=400)
        student = get_object_or_404(Student, pk=student_id, teacher=request.user)
        return Response(analytics_for_student(request.user, student.id))


class JournalCriteriaView(APIView):
    permission_classes = [IsAuthenticated, IsCabinetTeacher]

    def get(self, request):
        criteria = ensure_default_criteria(request.user)
        return Response({"results": [serialize_criterion(c) for c in criteria]})

    def post(self, request):
        scale = request.data.get("scale_type") or ScaleType.FIVE_POINT
        lo, hi = SCALE_BOUNDS.get(scale, (Decimal("1"), Decimal("5")))
        min_v = request.data.get("min_value", lo)
        max_v = request.data.get("max_value", hi)
        c = AssessmentCriterion.objects.create(
            teacher=request.user,
            title=(request.data.get("title") or "").strip(),
            description=request.data.get("description") or "",
            scale_type=scale,
            min_value=Decimal(str(min_v)),
            max_value=Decimal(str(max_v)),
            sort_order=int(request.data.get("sort_order") or 0),
            is_active=bool(request.data.get("is_active", True)),
            visible_to_student=bool(request.data.get("visible_to_student", True)),
        )
        return Response(serialize_criterion(c), status=201)


class JournalCriterionDetailView(APIView):
    permission_classes = [IsAuthenticated, IsCabinetTeacher]

    def patch(self, request, criterion_id: int):
        c = get_object_or_404(AssessmentCriterion, pk=criterion_id, teacher=request.user)
        for field in (
            "title",
            "description",
            "scale_type",
            "sort_order",
            "is_active",
            "visible_to_student",
            "is_recommended_default",
        ):
            if field in request.data:
                setattr(c, field, request.data[field])
        if "min_value" in request.data:
            c.min_value = Decimal(str(request.data["min_value"]))
        if "max_value" in request.data:
            c.max_value = Decimal(str(request.data["max_value"]))
        c.save()
        return Response(serialize_criterion(c))

    def delete(self, request, criterion_id: int):
        c = get_object_or_404(AssessmentCriterion, pk=criterion_id, teacher=request.user)
        c.is_active = False
        c.save(update_fields=["is_active", "updated_at"])
        return Response(status=204)


class JournalTemplatesView(APIView):
    permission_classes = [IsAuthenticated, IsCabinetTeacher]

    def get(self, request):
        templates = ensure_default_templates(request.user)
        return Response(
            {
                "results": [
                    {
                        "id": t.id,
                        "title": t.title,
                        "is_default": t.is_default,
                        "subject": t.subject,
                        "student_id": t.student_id,
                        "group_id": t.group_id,
                        "lesson_type": t.lesson_type,
                        "criterion_ids": list(
                            t.template_criteria.order_by("sort_order").values_list(
                                "criterion_id", flat=True
                            )
                        ),
                    }
                    for t in AssessmentTemplate.objects.filter(teacher=request.user).prefetch_related(
                        "template_criteria"
                    )
                ]
            }
        )

    def post(self, request):
        t = AssessmentTemplate.objects.create(
            teacher=request.user,
            title=(request.data.get("title") or "").strip(),
            is_default=bool(request.data.get("is_default")),
            subject=request.data.get("subject") or "",
            lesson_type=request.data.get("lesson_type") or "",
            student_id=request.data.get("student_id"),
            group_id=request.data.get("group_id"),
        )
        for order, cid in enumerate(request.data.get("criterion_ids") or []):
            if AssessmentCriterion.objects.filter(id=cid, teacher=request.user).exists():
                AssessmentTemplateCriterion.objects.create(
                    template=t, criterion_id=cid, sort_order=order
                )
        return Response({"id": t.id, "title": t.title}, status=201)


class JournalTemplateDetailView(APIView):
    permission_classes = [IsAuthenticated, IsCabinetTeacher]

    def patch(self, request, template_id: int):
        t = get_object_or_404(AssessmentTemplate, pk=template_id, teacher=request.user)
        for field in ("title", "is_default", "subject", "lesson_type", "student_id", "group_id"):
            if field in request.data:
                setattr(t, field, request.data[field])
        t.save()
        if "criterion_ids" in request.data:
            t.template_criteria.all().delete()
            for order, cid in enumerate(request.data.get("criterion_ids") or []):
                if AssessmentCriterion.objects.filter(id=cid, teacher=request.user).exists():
                    AssessmentTemplateCriterion.objects.create(
                        template=t, criterion_id=cid, sort_order=order
                    )
        return Response({"id": t.id, "title": t.title})


class JournalTagsView(APIView):
    permission_classes = [IsAuthenticated, IsCabinetTeacher]

    def get(self, request):
        tags = ensure_default_tags(request.user)
        return Response(
            {
                "results": [
                    {
                        "id": t.id,
                        "title": t.title,
                        "is_active": t.is_active,
                        "visible_to_student": t.visible_to_student,
                        "sort_order": t.sort_order,
                    }
                    for t in JournalTag.objects.filter(teacher=request.user).order_by("sort_order")
                ]
            }
        )

    def post(self, request):
        t = JournalTag.objects.create(
            teacher=request.user,
            title=(request.data.get("title") or "").strip(),
            visible_to_student=bool(request.data.get("visible_to_student", True)),
            sort_order=int(request.data.get("sort_order") or 0),
        )
        return Response({"id": t.id, "title": t.title}, status=201)


class JournalSettingsView(APIView):
    permission_classes = [IsAuthenticated, IsCabinetTeacher]

    def get(self, request):
        s = get_or_create_journal_settings(request.user)
        return Response(
            {
                "overall_score_mode": s.overall_score_mode,
                "require_topic": s.require_topic,
                "require_attendance": s.require_attendance,
                "require_comment": s.require_comment,
                "auto_calculate_overall": s.auto_calculate_overall,
                "publish_mode": s.publish_mode,
                "show_results_to_student": s.show_results_to_student,
                "show_results_to_parent": s.show_results_to_parent,
                "notify_student_on_publish": s.notify_student_on_publish,
                "notify_teacher_daily_digest": s.notify_teacher_daily_digest,
                "default_template_id": s.default_template_id,
            }
        )

    def patch(self, request):
        s = get_or_create_journal_settings(request.user)
        for field in (
            "overall_score_mode",
            "require_topic",
            "require_attendance",
            "require_comment",
            "auto_calculate_overall",
            "publish_mode",
            "show_results_to_student",
            "show_results_to_parent",
            "notify_student_on_publish",
            "notify_teacher_daily_digest",
            "default_template_id",
        ):
            if field in request.data:
                setattr(s, field, request.data[field])
        s.save()
        return self.get(request)


class JournalTopicsView(APIView):
    permission_classes = [IsAuthenticated, IsCabinetTeacher]

    def get(self, request):
        return Response(
            {"results": topic_history(request.user, q=request.query_params.get("q") or "")}
        )


class JournalAttentionView(APIView):
    permission_classes = [IsAuthenticated, IsCabinetTeacher]

    def post(self, request):
        student = get_object_or_404(Student, pk=request.data.get("student_id"), teacher=request.user)
        marker = JournalAttentionMarker.objects.create(
            teacher=request.user,
            student=student,
            reason=request.data.get("reason") or "custom",
            custom_reason=request.data.get("custom_reason") or "",
            note=request.data.get("note") or "",
            source_record_id=request.data.get("record_id"),
        )
        return Response({"id": marker.id}, status=201)

    def delete(self, request):
        marker_id = request.data.get("id") or request.query_params.get("id")
        marker = get_object_or_404(
            JournalAttentionMarker, pk=marker_id, teacher=request.user
        )
        marker.is_active = False
        marker.resolved_at = timezone.now()
        marker.save(update_fields=["is_active", "resolved_at", "updated_at"])
        return Response(status=204)


class JournalExportView(APIView):
    permission_classes = [IsAuthenticated, IsCabinetTeacher]

    def get(self, request):
        fmt = (request.query_params.get("format") or "csv").lower()
        include_private = request.query_params.get("include_private") in {"1", "true", "yes"}
        qs = (
            StudentLessonRecord.objects.filter(journal__teacher=request.user, journal__is_archived=False)
            .select_related("journal", "student", "journal__group")
            .prefetch_related("criterion_scores__criterion")
            .order_by("-journal__lesson_date")
        )
        if request.query_params.get("student_id"):
            qs = qs.filter(student_id=request.query_params["student_id"])
        if request.query_params.get("group_id"):
            qs = qs.filter(journal__group_id=request.query_params["group_id"])
        if request.query_params.get("date_from"):
            qs = qs.filter(journal__lesson_date__gte=request.query_params["date_from"])
        if request.query_params.get("date_to"):
            qs = qs.filter(journal__lesson_date__lte=request.query_params["date_to"])

        rows = []
        for r in qs[:2000]:
            row = {
                "date": r.journal.lesson_date.isoformat(),
                "entry_type": "lesson",
                "topic": r.journal.actual_topic or r.journal.planned_topic,
                "student": r.student.full_name,
                "group": r.journal.group.title if r.journal.group_id else "",
                "attendance": r.attendance_status,
                "status": r.publish_status,
                "overall_score": str(r.overall_score) if r.overall_score is not None else "",
                "score_percent": str(r.overall_score) if r.overall_score is not None else "",
                "max_score": "100",
                "due_at": "",
                "submitted_at": "",
                "is_overdue": "",
                "comment": r.teacher_comment,
            }
            if include_private:
                row["private_note"] = r.private_note
            for sc in r.criterion_scores.all():
                if sc.is_not_applicable:
                    row[sc.criterion.title] = "N/A"
                elif sc.value is not None:
                    row[sc.criterion.title] = str(sc.value)
            rows.append(row)

        # Include homework results from canonical HomeworkSubmission source.
        include_hw = request.query_params.get("include_homework") not in {"0", "false", "no"}
        if include_hw:
            feed = build_journal_entries_feed(
                request.user,
                student_id=request.query_params.get("student_id"),
                group_id=request.query_params.get("group_id"),
                date_from=request.query_params.get("date_from"),
                date_to=request.query_params.get("date_to"),
                homework_only=True,
                limit=2000,
            )
            for e in feed.get("entries") or []:
                rows.append(
                    {
                        "date": e.get("date") or "",
                        "entry_type": "homework",
                        "topic": e.get("title") or "",
                        "student": e.get("student_name") or "",
                        "group": e.get("group_name") or "",
                        "attendance": "",
                        "status": e.get("status") or "",
                        "overall_score": (
                            str(e["score_percent"]) if e.get("score_percent") is not None else ""
                        ),
                        "score_percent": (
                            str(e["score_percent"]) if e.get("score_percent") is not None else ""
                        ),
                        "max_score": "100",
                        "due_at": e.get("due_at") or "",
                        "submitted_at": e.get("submitted_at") or "",
                        "is_overdue": "yes" if e.get("is_overdue") else "",
                        "comment": e.get("comment") or "",
                    }
                )

        if fmt == "xlsx":
            try:
                from openpyxl import Workbook
            except ImportError:
                fmt = "csv"
            else:
                wb = Workbook()
                ws = wb.active
                ws.title = "Journal"
                if not rows:
                    ws.append(["empty"])
                else:
                    headers = list(rows[0].keys())
                    ws.append(headers)
                    for row in rows:
                        ws.append([row.get(h, "") for h in headers])
                buf = io.BytesIO()
                wb.save(buf)
                resp = HttpResponse(
                    buf.getvalue(),
                    content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                )
                resp["Content-Disposition"] = 'attachment; filename="journal.xlsx"'
                return resp

        if fmt == "pdf":
            try:
                from weasyprint import HTML
            except Exception:
                fmt = "csv"
            else:
                html = "<h1>Журнал</h1><table border='1' cellpadding='4'><tr>"
                if rows:
                    keys = list(rows[0].keys())
                    html += "".join(f"<th>{k}</th>" for k in keys) + "</tr>"
                    for row in rows:
                        html += "<tr>" + "".join(f"<td>{row.get(k, '')}</td>" for k in keys) + "</tr>"
                html += "</table>"
                pdf = HTML(string=html).write_pdf()
                resp = HttpResponse(pdf, content_type="application/pdf")
                resp["Content-Disposition"] = 'attachment; filename="journal.pdf"'
                return resp

        buf = io.StringIO()
        if rows:
            writer = csv.DictWriter(buf, fieldnames=list(rows[0].keys()))
            writer.writeheader()
            writer.writerows(rows)
        else:
            buf.write("empty\n")
        resp = HttpResponse(buf.getvalue(), content_type="text/csv; charset=utf-8")
        resp["Content-Disposition"] = 'attachment; filename="journal.csv"'
        return resp


class JournalStudentsSummaryView(APIView):
    permission_classes = [IsAuthenticated, IsCabinetTeacher]

    def get(self, request):
        students = Student.objects.filter(teacher=request.user, status="active")
        results = []
        for s in students[:200]:
            last = (
                StudentLessonRecord.objects.filter(journal__teacher=request.user, student=s)
                .select_related("journal")
                .order_by("-journal__lesson_date")
                .first()
            )
            avg = StudentLessonRecord.objects.filter(
                journal__teacher=request.user, student=s, overall_score__isnull=False
            ).aggregate(a=Avg("overall_score"))["a"]
            att = attendance_report(request.user, student_id=s.id)
            attention = JournalAttentionMarker.objects.filter(
                teacher=request.user, student=s, is_active=True
            ).exists()
            results.append(
                {
                    "student_id": s.id,
                    "student_name": s.full_name,
                    "last_lesson_date": last.journal.lesson_date.isoformat() if last else None,
                    "last_topic": (last.journal.actual_topic or last.journal.planned_topic) if last else None,
                    "attendance_rate": att["attendance_rate_percent"],
                    "avg_score": float(avg) if avg is not None else None,
                    "requires_attention": attention,
                }
            )
        return Response({"results": results})


def _student_result_lesson_fields(record: StudentLessonRecord) -> dict:
    journal = record.journal
    event = journal.schedule_event if journal.schedule_event_id else None
    return {
        "lesson_date": journal.lesson_date.isoformat(),
        "starts_at": (
            event.starts_at.isoformat()
            if event
            else (journal.started_at.isoformat() if journal.started_at else None)
        ),
        "ends_at": (
            event.ends_at.isoformat()
            if event
            else (journal.finished_at.isoformat() if journal.finished_at else None)
        ),
        "topic": journal.actual_topic or journal.planned_topic,
        "planned_topic": journal.planned_topic,
        "actual_topic": journal.actual_topic,
        "lesson_summary": journal.lesson_summary,
        "material_covered": journal.material_covered,
        "material_to_repeat": journal.material_to_repeat,
        "next_lesson_plan": journal.next_lesson_plan,
        "recommendations": record.recommendation or journal.recommendations,
        "previous_homework_status": journal.previous_homework_status or "",
    }


def _checked_homework_result_entries(roster, already_homework_ids: set[int]) -> list[dict]:
    """Проверенные ДЗ, которых ещё нет в опубликованных итогах урока."""
    from .choices import SubmissionStatus
    from .homework_api import is_live_meeting_homework
    from .models import HomeworkSubmission

    student_ids = list(roster.values_list("id", flat=True))
    if not student_ids:
        return []
    submissions = (
        HomeworkSubmission.objects.filter(
            student_id__in=student_ids,
            status=SubmissionStatus.CHECKED,
        )
        .select_related("homework", "student")
        .order_by("-updated_at", "-submitted_at", "-id")
    )
    entries = []
    seen: set[int] = set()
    for sub in submissions:
        homework = sub.homework
        if homework is None or homework.id in already_homework_ids or homework.id in seen:
            continue
        if is_live_meeting_homework(homework):
            continue
        payload = build_homework_result_payload(
            homework=homework,
            student=sub.student,
            submission=sub,
            for_student=True,
        )
        if not payload:
            continue
        seen.add(homework.id)
        when = sub.submitted_at or sub.updated_at or homework.created_at
        date_val = timezone.localtime(when).date().isoformat() if when else None
        entries.append(
            {
                "id": f"hw-{homework.id}",
                "entry_type": "homework",
                "lesson_date": date_val,
                "starts_at": when.isoformat() if when else None,
                "ends_at": None,
                "topic": homework.title,
                "title": homework.title,
                "overall_score": payload.get("score_percent"),
                "teacher_comment": payload.get("teacher_comment") or "",
                "homework_result": payload,
                "homework_id": homework.id,
                "attendance_status": "",
                "criterion_scores": [],
                "tags": [],
                "visible_to_student": True,
            }
        )
        if len(entries) >= 50:
            break
    return entries


class StudentResultsListView(APIView):
    permission_classes = [IsAuthenticated, IsCabinetStudent]

    def get(self, request):
        roster = Student.objects.filter(user=request.user)
        records = (
            StudentLessonRecord.objects.filter(
                student__in=roster,
                publish_status=RecordPublishStatus.PUBLISHED,
                visible_to_student=True,
            )
            .select_related(
                "journal",
                "journal__schedule_event",
                "journal__previous_homework",
                "journal__teacher",
                "student",
            )
            .prefetch_related("criterion_scores__criterion", "tags")
            .order_by(
                "-journal__lesson_date",
                "-journal__schedule_event__starts_at",
                "-journal__id",
                "-id",
            )
        )
        results = []
        already_homework_ids: set[int] = set()
        for r in records[:100]:
            hw = resolve_homework_for_journal_record(r.journal, r.student)
            homework_result = build_homework_result_payload(
                homework=hw,
                student=r.student,
                for_student=True,
            )
            if homework_result and homework_result.get("homework_id"):
                already_homework_ids.add(int(homework_result["homework_id"]))
            results.append(
                {
                    **serialize_record(
                        r,
                        for_student=True,
                        homework_result=homework_result,
                    ),
                    **_student_result_lesson_fields(r),
                    "entry_type": "lesson",
                }
            )
        results.extend(_checked_homework_result_entries(roster, already_homework_ids))
        results.sort(
            key=lambda item: item.get("starts_at") or item.get("lesson_date") or "",
            reverse=True,
        )
        return Response({"results": results[:100]})


class StudentResultDetailView(APIView):
    permission_classes = [IsAuthenticated, IsCabinetStudent]

    def get(self, request, record_id: int):
        roster_ids = Student.objects.filter(user=request.user).values_list("id", flat=True)
        record = get_object_or_404(
            StudentLessonRecord.objects.select_related(
                "journal",
                "journal__schedule_event",
                "journal__previous_homework",
                "journal__teacher",
                "student",
            ).prefetch_related(
                "criterion_scores__criterion", "tags"
            ),
            pk=record_id,
            student_id__in=roster_ids,
            publish_status=RecordPublishStatus.PUBLISHED,
            visible_to_student=True,
        )
        hw = resolve_homework_for_journal_record(record.journal, record.student)
        homework_result = build_homework_result_payload(
            homework=hw,
            student=record.student,
            for_student=True,
        )
        data = serialize_record(
            record,
            for_student=True,
            homework_result=homework_result,
        )
        data.update(_student_result_lesson_fields(record))
        # Guard: never leak private_note
        data.pop("private_note", None)
        return Response(data)
