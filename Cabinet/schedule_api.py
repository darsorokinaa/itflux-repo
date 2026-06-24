"""DRF API for schedule series, participants, and notifications."""

from datetime import datetime

from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from .models import (
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
        teacher = self.get_teacher()
        data = serializer.validated_data
        student_ids = data.pop("student_ids", None)
        extra_student_ids = data.pop("extra_student_ids", None)
        group_id = data.pop("group_id", None) or (data.get("group") and data["group"].pk)
        notify = data.pop("notify_participants", True)

        series_data = {
            **data,
            "notify_participants": notify,
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
        self.perform_create(serializer)
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

    def get_queryset(self):
        qs = ScheduleEvent.objects.filter(owner=self.get_teacher()).select_related(
            "student", "group", "lesson", "series",
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
        teacher = self.get_teacher()
        data = serializer.validated_data
        student_ids = self.request.data.get("student_ids")
        extra_student_ids = self.request.data.get("extra_student_ids")
        group_id = data.get("group") and data["group"].pk
        notify = self.request.data.get("notify_participants", True)
        event = create_single_event(
            teacher=teacher,
            data={
                **data,
                "notify_participants": notify,
            },
            student_ids=student_ids,
            group_id=group_id,
            extra_student_ids=extra_student_ids,
            notify=notify,
        )
        serializer.instance = event

    def update(self, request, *args, **kwargs):
        event = self.get_object()
        scope = request.data.get("scope")
        notify = request.data.get("notify_participants", True)
        if scope and event.series_id:
            apply_series_edit(event, scope=scope, changed_by=request.user, data=request.data, notify=notify)
        else:
            update_event(event, changed_by=request.user, data=request.data, notify=notify)
        return Response(ScheduleEventSerializer(event, context=self.get_serializer_context()).data)

    @action(detail=True, methods=["post"], url_path="cancel")
    def cancel(self, request, pk=None):
        event = self.get_object()
        scope = request.data.get("scope")
        notify = request.data.get("notify_participants", True)
        if scope == "series" and event.series_id:
            cancel_series(event.series, changed_by=request.user, notify=notify)
        elif scope == "following" and event.series_id:
            cancel_series(
                event.series,
                changed_by=request.user,
                from_date=event.starts_at.date(),
                notify=notify,
            )
        else:
            cancel_event_with_scope(event, changed_by=request.user, scope=scope, notify=notify)
        return Response(ScheduleEventSerializer(event).data)

    @action(detail=True, methods=["post"], url_path="complete")
    def complete(self, request, pk=None):
        event = self.get_object()
        event.status = ScheduleEvent.Status.COMPLETED
        event.save(update_fields=["status", "updated_at"])
        return Response(ScheduleEventSerializer(event).data)

    @action(detail=True, methods=["post"], url_path="move")
    def move(self, request, pk=None):
        event = self.get_object()
        starts_at = request.data.get("starts_at")
        ends_at = request.data.get("ends_at")
        scope = request.data.get("scope")
        notify = request.data.get("notify_participants", True)
        if isinstance(starts_at, str):
            starts_at = datetime.fromisoformat(starts_at)
        if isinstance(ends_at, str):
            ends_at = datetime.fromisoformat(ends_at)
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
        starts_at = request.data.get("starts_at")
        ends_at = request.data.get("ends_at")
        if isinstance(starts_at, str):
            starts_at = datetime.fromisoformat(starts_at)
        if isinstance(ends_at, str):
            ends_at = datetime.fromisoformat(ends_at)
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

    def get_queryset(self):
        return Notification.objects.filter(recipient_user=self.request.user).order_by("-created_at")[:100]

    def list(self, request, *args, **kwargs):
        qs = self.get_queryset()
        unread = Notification.objects.filter(recipient_user=request.user, is_read=False).count()
        return Response({
            "items": NotificationSerializer(qs, many=True).data,
            "unread_count": unread,
        })

    @action(detail=True, methods=["post"], url_path="read")
    def mark_read(self, request, pk=None):
        n = get_object_or_404(Notification, pk=pk, recipient_user=request.user)
        n.is_read = True
        n.save(update_fields=["is_read"])
        return Response({"ok": True})

    @action(detail=False, methods=["post"], url_path="read-all")
    def read_all(self, request):
        Notification.objects.filter(recipient_user=request.user, is_read=False).update(is_read=True)
        return Response({"ok": True})

    @action(detail=False, methods=["get"], url_path="unread-count")
    def unread_count(self, request):
        count = Notification.objects.filter(recipient_user=request.user, is_read=False).count()
        return Response({"count": count})
