"""DRF API for schedule series, participants, and notifications."""

from datetime import datetime

from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from .models import (
    LessonPlanItem,
    Notification,
    ScheduleEvent,
    ScheduleEventChangeLog,
    ScheduleEventParticipant,
    ScheduleEventSeries,
    Student,
)
from .permissions import IsCabinetTeacher
from .schedule_service import (
    add_participant,
    apply_series_edit,
    cancel_event_with_scope,
    cancel_series,
    check_conflicts,
    coerce_schedule_datetime,
    create_series,
    create_single_event,
    move_event_with_scope,
    remove_participant,
    update_event,
)
from .schedule_series import DEFAULT_HORIZON_DAYS, generate_events_for_series
from .serializers import (
    NotificationSerializer,
    ScheduleEventChangeLogSerializer,
    ScheduleEventParticipantSerializer,
    ScheduleEventSerializer,
    ScheduleEventSeriesSerializer,
    ScheduleSeriesCreateSerializer,
)


class TeacherScopedMixin:
    permission_classes = [IsCabinetTeacher]

    def get_teacher(self):
        return self.request.user


class ScheduleSeriesViewSet(TeacherScopedMixin, viewsets.ModelViewSet):
    serializer_class = ScheduleEventSeriesSerializer

    def get_queryset(self):
        return ScheduleEventSeries.objects.filter(teacher=self.get_teacher()).select_related(
            "group", "lesson", "lesson_plan_item",
        )

    def get_serializer_class(self):
        if self.action == "create":
            return ScheduleSeriesCreateSerializer
        return ScheduleEventSeriesSerializer

    def perform_create(self, serializer):
        from rest_framework.exceptions import PermissionDenied

        from .subscription_access import AccessDenied, SubscriptionAccessService

        teacher = self.get_teacher()
        try:
            SubscriptionAccessService.raise_if_cannot_use_schedule(teacher)
        except AccessDenied as exc:
            raise PermissionDenied(detail=exc.to_dict()) from exc
        data = serializer.validated_data
        student_ids = data.pop("student_ids", None)
        extra_student_ids = data.pop("extra_student_ids", None)
        group_id = data.pop("group_id", None) or (data.get("group") and data["group"].pk)
        notify = data.pop("notify_participants", True)
        student_subject_id = data.pop("student_subject_id", None)
        if student_subject_id is None and data.get("student_subject"):
            ss = data.pop("student_subject", None)
            student_subject_id = ss.pk if ss else None

        series_data = {
            **data,
            "notify_participants": notify,
            "student_subject_id": student_subject_id,
        }
        if isinstance(series_data.get("start_date"), str):
            series_data["start_date"] = datetime.strptime(series_data["start_date"], "%Y-%m-%d").date()
        series, events = create_series(
            teacher=teacher,
            series_data=series_data,
            student_ids=student_ids,
            group_id=group_id,
            extra_student_ids=extra_student_ids,
            notify=notify,
        )
        serializer.instance = series
        serializer.created_events = events

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            self.perform_create(serializer)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        out = ScheduleEventSeriesSerializer(serializer.instance, context=self.get_serializer_context()).data
        out["events_created"] = len(getattr(serializer, "created_events", []))
        return Response(out, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="cancel")
    def cancel_series_action(self, request, pk=None):
        series = self.get_object()
        from_date = request.data.get("from_date")
        if from_date:
            from_date = datetime.strptime(from_date, "%Y-%m-%d").date()
        events = cancel_series(
            series,
            changed_by=request.user,
            from_date=from_date,
            notify=request.data.get("notify_participants", True),
            plan_cancel_action=(
                request.data.get("plan_cancel_action")
                or request.data.get("planOnCancel")
                or ""
            ).strip() or None,
        )
        return Response({"cancelled": len(events)})

    @action(detail=True, methods=["post"], url_path="regenerate")
    def regenerate(self, request, pk=None):
        series = self.get_object()
        date_to = timezone.localdate()
        from datetime import timedelta

        date_to += timedelta(days=int(request.data.get("days", DEFAULT_HORIZON_DAYS)))
        created = generate_events_for_series(series, timezone.localdate(), date_to)
        return Response({"created": len(created)})


class ScheduleEventViewSetExtended(TeacherScopedMixin, viewsets.ModelViewSet):
    serializer_class = ScheduleEventSerializer

    def get_object(self):
        """Фронтенд везде оперирует id вида "local-42" — принимаем оба формата,
        иначе DRF не находит объект по нечисловому pk и отдаёт 404."""
        from .schedule_events import parse_local_event_id

        lookup_url_kwarg = self.lookup_url_kwarg or self.lookup_field
        raw_pk = self.kwargs.get(lookup_url_kwarg)
        numeric_pk = parse_local_event_id(raw_pk)
        if numeric_pk is not None:
            self.kwargs[lookup_url_kwarg] = numeric_pk
        return super().get_object()

    def get_queryset(self):
        qs = ScheduleEvent.objects.filter(owner=self.get_teacher()).select_related(
            "student", "student_subject", "group", "lesson", "series",
        ).prefetch_related("participants")
        params = self.request.query_params
        date_from = params.get("date_from")
        date_to = params.get("date_to")
        if date_from:
            qs = qs.filter(ends_at__date__gte=date_from)
        if date_to:
            qs = qs.filter(starts_at__date__lte=date_to)
        show_cancelled = params.get("include_cancelled")
        if not show_cancelled:
            qs = qs.exclude(status=ScheduleEvent.Status.CANCELLED)
        return qs.order_by("starts_at")

    def perform_create(self, serializer):
        from .subscription_access import AccessDenied, SubscriptionAccessService

        teacher = self.get_teacher()
        try:
            SubscriptionAccessService.raise_if_cannot_use_schedule(teacher)
        except AccessDenied as exc:
            from rest_framework.exceptions import PermissionDenied

            raise PermissionDenied(detail=exc.to_dict()) from exc
        data = serializer.validated_data
        student_ids = self.request.data.get("student_ids")
        extra_student_ids = self.request.data.get("extra_student_ids")
        group_id = data.get("group") and data["group"].pk
        notify = self.request.data.get("notify_participants", True)
        payload = {
            **data,
            "notify_participants": notify,
            "student_subject": self.request.data.get("student_subject")
            or self.request.data.get("student_subject_id"),
        }
        event = create_single_event(
            teacher=teacher,
            data=payload,
            student_ids=student_ids,
            group_id=group_id,
            extra_student_ids=extra_student_ids,
            notify=notify,
        )
        serializer.instance = event

    def create(self, request, *args, **kwargs):
        try:
            return super().create(request, *args, **kwargs)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

    def update(self, request, *args, **kwargs):
        event = self.get_object()
        scope = request.data.get("scope")
        notify = request.data.get("notify_participants", True)
        data = dict(request.data)
        if "student_subject" in data or "student_subject_id" in data:
            from .student_subjects import resolve_student_subject_for_write

            ss_id = data.get("student_subject") or data.get("student_subject_id")
            try:
                student = event.student
                if student is None and data.get("student"):
                    student = Student.objects.filter(
                        pk=data.get("student"), teacher=self.get_teacher()
                    ).first()
                ss = resolve_student_subject_for_write(
                    teacher=self.get_teacher(),
                    student=student,
                    student_subject_id=ss_id,
                    allow_empty=True,
                )
            except ValueError as exc:
                return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
            data["student_subject"] = ss.id if ss else None
        try:
            if scope and event.series_id:
                apply_series_edit(event, scope=scope, changed_by=request.user, data=data, notify=notify)
            else:
                update_event(event, changed_by=request.user, data=data, notify=notify)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        event.refresh_from_db()
        return Response(ScheduleEventSerializer(event, context=self.get_serializer_context()).data)

    @action(detail=True, methods=["post"], url_path="ensure-plan-item")
    def ensure_plan_item(self, request, pk=None):
        """Создаёт/линкует пункт плана, чтобы к занятию можно было прикреплять материалы."""
        from .plan_schedule import ensure_event_plan_item
        from .schedule_events import _plan_item_to_json

        event = self.get_object()
        item, lesson_number = ensure_event_plan_item(event, teacher=request.user)
        return Response({
            "ok": True,
            "eventId": event.pk,
            "planItem": _plan_item_to_json(item, lesson_number=lesson_number),
        })

    def _sync_error_response(self, exc):
        from .lesson_plan_content_sync import LessonPlanSyncConflict, LessonPlanSyncError
        if isinstance(exc, LessonPlanSyncConflict):
            return Response(
                {"detail": exc.message, "code": exc.code, **exc.extra},
                status=status.HTTP_409_CONFLICT,
            )
        if isinstance(exc, LessonPlanSyncError):
            return Response(
                {"detail": exc.message, "code": exc.code, **exc.extra},
                status=exc.status,
            )
        raise

    def _event_payload(self, event):
        from .schedule_events import schedule_event_to_json
        event.refresh_from_db()
        return {
            "ok": True,
            "event": ScheduleEventSerializer(event, context=self.get_serializer_context()).data,
            "scheduleEvent": schedule_event_to_json(event),
        }

    @action(detail=True, methods=["post"], url_path="link-plan-item")
    def link_plan_item(self, request, pk=None):
        from .lesson_plan_content_sync import LessonLearningPlanSyncService, LessonPlanSyncError

        event = self.get_object()
        item_id = request.data.get("lesson_plan_item_id") or request.data.get("lesson_plan_item")
        if not item_id:
            return Response({"detail": "Укажите lesson_plan_item_id."}, status=400)
        item = get_object_or_404(LessonPlanItem, pk=item_id)
        try:
            LessonLearningPlanSyncService.link_plan_item(event, item, teacher=self.get_teacher())
        except LessonPlanSyncError as exc:
            return self._sync_error_response(exc)
        return Response(self._event_payload(event))

    @action(detail=True, methods=["post"], url_path="sync-to-plan")
    def sync_to_plan(self, request, pk=None):
        from .lesson_plan_content_sync import LessonLearningPlanSyncService, LessonPlanSyncError

        event = self.get_object()
        try:
            result = LessonLearningPlanSyncService.sync_lesson_to_plan(
                event,
                teacher=self.get_teacher(),
                mode=request.data.get("mode") or "update_linked",
                student_ids=request.data.get("student_ids"),
                confirm_all_students=bool(request.data.get("confirm_all_students")),
                title=request.data.get("create_title") or request.data.get("title") or "",
                material_ids=request.data.get("material_ids"),
            )
        except LessonPlanSyncError as exc:
            return self._sync_error_response(exc)
        payload = self._event_payload(event)
        payload["sync"] = result
        return Response(payload)

    @action(detail=True, methods=["post"], url_path="sync-from-plan")
    def sync_from_plan(self, request, pk=None):
        from .lesson_plan_content_sync import LessonLearningPlanSyncService, LessonPlanSyncError
        from .plan_schedule import resolve_plan_item_for_event

        event = self.get_object()
        item = event.lesson_plan_item
        if item is None:
            item, _ = resolve_plan_item_for_event(event)
        if item is None:
            return Response({"detail": "Урок не связан с пунктом плана."}, status=400)
        try:
            if not event.lesson_plan_item_id:
                LessonLearningPlanSyncService.link_plan_item(
                    event, item, teacher=self.get_teacher(),
                )
            else:
                LessonLearningPlanSyncService.set_plan_sync_enabled(
                    event, teacher=self.get_teacher(), enabled=True,
                )
                result = LessonLearningPlanSyncService.sync_plan_item_to_lessons(
                    item, teacher=self.get_teacher(),
                )
                # force this event even if starts_at in the past but still planned
                if event.pk not in result.get("updated_event_ids", []):
                    if event.status not in LessonLearningPlanSyncService.TERMINAL_STATUSES:
                        LessonLearningPlanSyncService._copy_item_fields_to_event(
                            event, item, force_fields=None,
                        )
                        LessonLearningPlanSyncService._sync_plan_materials_onto_event(event, item)
                        from django.utils import timezone as dj_tz
                        from .choices import LessonContentSource
                        event.plan_sync_enabled = True
                        event.content_source = LessonContentSource.PLAN
                        event.plan_synced_at = dj_tz.now()
                        event.manual_override_fields = []
                        event.save()
        except LessonPlanSyncError as exc:
            return self._sync_error_response(exc)
        return Response(self._event_payload(event))

    @action(detail=True, methods=["post"], url_path="plan-sync")
    def plan_sync(self, request, pk=None):
        from .lesson_plan_content_sync import LessonLearningPlanSyncService, LessonPlanSyncError

        event = self.get_object()
        if "plan_sync_enabled" not in request.data and "enabled" not in request.data:
            return Response({"detail": "Укажите plan_sync_enabled."}, status=400)
        enabled = request.data.get("plan_sync_enabled", request.data.get("enabled"))
        try:
            LessonLearningPlanSyncService.set_plan_sync_enabled(
                event, teacher=self.get_teacher(), enabled=bool(enabled),
            )
        except LessonPlanSyncError as exc:
            return self._sync_error_response(exc)
        return Response(self._event_payload(event))

    @action(detail=True, methods=["post"], url_path="content")
    def update_content(self, request, pk=None):
        """Редактирование темы/описания с выбором направления синхронизации."""
        from .lesson_plan_content_sync import LessonLearningPlanSyncService, LessonPlanSyncError

        event = self.get_object()
        try:
            result = LessonLearningPlanSyncService.apply_lesson_edit(
                event,
                request.data,
                teacher=self.get_teacher(),
                sync_action=request.data.get("sync_action") or "",
                resolve_conflict=request.data.get("resolve_conflict"),
                student_ids=request.data.get("student_ids"),
                confirm_all_students=bool(request.data.get("confirm_all_students")),
            )
        except LessonPlanSyncError as exc:
            return self._sync_error_response(exc)
        payload = self._event_payload(event)
        payload["edit"] = result
        return Response(payload)

    @action(detail=True, methods=["post"], url_path="event-materials")
    def event_materials(self, request, pk=None):
        from .choices import ScheduleMaterialSource
        from .lesson_plan_content_sync import LessonLearningPlanSyncService, LessonPlanSyncError

        event = self.get_object()
        action_name = (request.data.get("action") or "attach").strip().lower()
        source = request.data.get("source") or ScheduleMaterialSource.LESSON_MANUAL
        try:
            if action_name == "detach":
                deleted = LessonLearningPlanSyncService.detach_material(
                    event,
                    teacher=self.get_teacher(),
                    material_id=request.data.get("material_id"),
                    interactive_id=request.data.get("interactive_id"),
                    source=request.data.get("source"),
                )
                payload = self._event_payload(event)
                payload["deleted"] = deleted
                return Response(payload)
            link = LessonLearningPlanSyncService.attach_material(
                event,
                teacher=self.get_teacher(),
                material_id=request.data.get("material_id"),
                interactive_id=request.data.get("interactive_id"),
                source=source,
                order=request.data.get("order"),
            )
        except LessonPlanSyncError as exc:
            return self._sync_error_response(exc)
        payload = self._event_payload(event)
        payload["linkId"] = link.id
        return Response(payload)

    @action(detail=True, methods=["post"], url_path="cancel")
    def cancel(self, request, pk=None):
        event = self.get_object()
        scope = request.data.get("scope")
        notify = request.data.get("notify_participants", True)
        plan_cancel_action = (
            request.data.get("plan_cancel_action")
            or request.data.get("planOnCancel")
            or ""
        ).strip() or None
        cancel_event_with_scope(
            event,
            changed_by=request.user,
            scope=scope,
            notify=notify,
            plan_cancel_action=plan_cancel_action,
        )
        event.refresh_from_db()
        return Response(ScheduleEventSerializer(event).data)

    @action(detail=True, methods=["post"], url_path="complete")
    def complete(self, request, pk=None):
        event = self.get_object()
        from .plan_sync import PlanSyncService

        PlanSyncService.mark_event_completed(event, teacher=request.user, ensure_journal=True)
        event.refresh_from_db()
        try:
            from .billing_service import auto_finalize_after_lesson_complete

            auto_finalize_after_lesson_complete(event=event, teacher=request.user)
        except Exception:
            pass
        return Response(ScheduleEventSerializer(event).data)

    @action(detail=False, methods=["get"], url_path="next-plan-item")
    def next_plan_item(self, request):
        from .plan_sync import PlanSyncService
        from .plan_schedule import get_active_enrollment
        from .schedule_events import _plan_item_to_json

        student_id = request.query_params.get("student_id")
        group_id = request.query_params.get("group_id")
        student_subject_id = request.query_params.get("student_subject_id")
        if not student_id and not group_id:
            return Response({"item": None, "enrollment_id": None})
        event = ScheduleEvent(
            owner=self.get_teacher(),
            student_id=int(student_id) if student_id else None,
            group_id=int(group_id) if group_id else None,
            student_subject_id=int(student_subject_id) if student_subject_id else None,
            starts_at=timezone.now(),
            ends_at=timezone.now(),
            title="",
        )
        enrollment = get_active_enrollment(event)
        if enrollment is None:
            return Response({"item": None, "enrollment_id": None})
        item = PlanSyncService.get_next_plan_item(enrollment)
        return Response({
            "enrollment_id": enrollment.pk,
            "plan_id": enrollment.plan_id,
            "plan_title": enrollment.plan.title if enrollment.plan_id else "",
            "item": _plan_item_to_json(item) if item else None,
        })

    @action(detail=True, methods=["post"], url_path="move")
    def move(self, request, pk=None):
        event = self.get_object()
        starts_at = coerce_schedule_datetime(
            request.data.get("starts_at"),
            event=event,
            teacher=request.user,
            tz_name=request.data.get("timezone"),
        )
        ends_at = coerce_schedule_datetime(
            request.data.get("ends_at"),
            event=event,
            teacher=request.user,
            tz_name=request.data.get("timezone"),
        )
        scope = request.data.get("scope")
        notify = request.data.get("notify_participants", True)
        move_event_with_scope(
            event,
            starts_at=starts_at,
            ends_at=ends_at,
            changed_by=request.user,
            scope=scope,
            notify=notify,
        )
        return Response(ScheduleEventSerializer(event).data)

    @action(detail=True, methods=["get", "post"], url_path="participants")
    def participants(self, request, pk=None):
        event = self.get_object()
        if request.method == "GET":
            qs = event.participants.exclude(status="removed")
            return Response(ScheduleEventParticipantSerializer(qs, many=True).data)
        student_id = request.data.get("student_id")
        student = get_object_or_404(Student, pk=student_id, teacher=self.get_teacher())
        participant = add_participant(
            event,
            student=student,
            changed_by=request.user,
            notify=request.data.get("notify_participants", True),
        )
        return Response(ScheduleEventParticipantSerializer(participant).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["delete"], url_path=r"participants/(?P<participant_id>[^/.]+)")
    def remove_participant_action(self, request, pk=None, participant_id=None):
        event = self.get_object()
        participant = get_object_or_404(event.participants, pk=participant_id)
        remove_participant(
            participant,
            changed_by=request.user,
            notify=request.data.get("notify_participants", True),
        )
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["get"], url_path="history")
    def history(self, request, pk=None):
        event = self.get_object()
        logs = event.change_logs.all()[:50]
        return Response(ScheduleEventChangeLogSerializer(logs, many=True).data)

    @action(detail=False, methods=["post"], url_path="check-conflicts")
    def check_conflicts_action(self, request):
        starts_at = coerce_schedule_datetime(
            request.data.get("starts_at"),
            teacher=self.get_teacher(),
            tz_name=request.data.get("timezone"),
        )
        ends_at = coerce_schedule_datetime(
            request.data.get("ends_at"),
            teacher=self.get_teacher(),
            tz_name=request.data.get("timezone"),
        )
        conflicts = check_conflicts(
            teacher=self.get_teacher(),
            starts_at=starts_at,
            ends_at=ends_at,
            student_id=request.data.get("student_id"),
            group_id=request.data.get("group_id"),
            exclude_event_id=request.data.get("exclude_event_id"),
        )
        return Response({"conflicts": conflicts, "has_conflicts": bool(conflicts)})


class NotificationViewSet(
    TeacherScopedMixin,
    mixins.ListModelMixin,
    viewsets.GenericViewSet,
):
    serializer_class = NotificationSerializer

    def _in_app_qs(self):
        from .choices import NotificationChannel

        return Notification.objects.filter(
            recipient_user=self.request.user,
            channel=NotificationChannel.IN_APP,
        )

    def get_queryset(self):
        return self._in_app_qs().order_by("-created_at")[:100]

    def list(self, request, *args, **kwargs):
        qs = self.get_queryset()
        unread = self._in_app_qs().filter(is_read=False).count()
        return Response({
            "items": NotificationSerializer(qs, many=True, context={"request": request}).data,
            "unread_count": unread,
        })

    @action(detail=True, methods=["post"], url_path="read")
    def mark_read(self, request, pk=None):
        n = get_object_or_404(self._in_app_qs(), pk=pk)
        n.is_read = True
        n.save(update_fields=["is_read"])
        return Response({"ok": True})

    @action(detail=False, methods=["post"], url_path="read-all")
    def read_all(self, request):
        self._in_app_qs().filter(is_read=False).update(is_read=True)
        return Response({"ok": True})

    @action(detail=False, methods=["post"], url_path="clear")
    def clear(self, request):
        deleted, _ = self._in_app_qs().delete()
        return Response({"ok": True, "deleted": deleted})

    @action(detail=False, methods=["get"], url_path="unread-count")
    def unread_count(self, request):
        count = self._in_app_qs().filter(is_read=False).count()
        return Response({"count": count})
