"""Teacher availability and student self-booking API."""

from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from datetime import timedelta

from django.utils import timezone

from .availability_models import TeacherAvailability
from .availability_service import (
    AvailabilityError,
    SlotTakenError,
    book_slot_and_notify,
    cancel_student_booking,
    compute_available_slots,
    create_availability_windows,
    deactivate_availability,
    default_slot_duration,
    ensure_booking_link,
    parse_date_value,
    public_booking_page,
    publish_booking_link,
    serialize_availability,
    serialize_booking,
    serialize_booking_link,
    student_bookings,
    teacher_timezone,
    update_availability_window,
)
from .permissions import IsCabinetStudent, IsCabinetTeacher
from .subscription_access import AccessDenied, SubscriptionAccessService


def _error_response(exc):
    status_code = getattr(exc, "status", 400)
    return Response(
        {"error": getattr(exc, "message", str(exc)), "code": getattr(exc, "code", "availability_error")},
        status=status_code,
    )


def _access_denied_response(exc: AccessDenied):
    return Response(exc.to_dict(), status=403)


class TeacherAvailabilityListView(APIView):
    permission_classes = [IsAuthenticated, IsCabinetTeacher]

    def get(self, request):
        teacher = request.user
        tz = teacher_timezone(teacher)
        today = timezone.now().astimezone(tz).date()
        try:
            parsed_from = parse_date_value(request.query_params.get("from") or today)
            parsed_to = (
                parse_date_value(request.query_params.get("to"))
                if request.query_params.get("to")
                else parsed_from + timedelta(days=21)
            )
        except AvailabilityError as exc:
            return _error_response(exc)

        windows = TeacherAvailability.objects.filter(teacher=teacher, is_active=True).order_by(
            "valid_from", "start_time", "id",
        )
        slots = compute_available_slots(
            teacher=teacher,
            date_from=parsed_from,
            date_to=parsed_to,
            windows=windows,
        )
        link = ensure_booking_link(teacher)
        return Response({
            "items": [serialize_availability(item) for item in windows],
            "slots": slots,
            "link": serialize_booking_link(link, request=request, teacher=teacher),
            "default_slot_duration_minutes": default_slot_duration(teacher),
            "timezone": str(tz),
            "feature_allowed": SubscriptionAccessService.can_use_student_booking(teacher),
        })

    def post(self, request):
        try:
            SubscriptionAccessService.raise_if_cannot_use_student_booking(request.user)
            created = create_availability_windows(request.user, request.data or {})
        except AccessDenied as exc:
            return _access_denied_response(exc)
        except AvailabilityError as exc:
            return _error_response(exc)
        link = ensure_booking_link(request.user)
        return Response({
            "ok": True,
            "items": [serialize_availability(item) for item in created],
            "link": serialize_booking_link(link, request=request, teacher=request.user),
        }, status=201)


class TeacherAvailabilityDetailView(APIView):
    permission_classes = [IsAuthenticated, IsCabinetTeacher]

    def _get_item(self, request, pk):
        return TeacherAvailability.objects.filter(pk=pk, teacher=request.user).first()

    def patch(self, request, pk):
        item = self._get_item(request, pk)
        if item is None:
            return Response({"error": "Интервал не найден.", "code": "not_found"}, status=404)
        try:
            SubscriptionAccessService.raise_if_cannot_use_student_booking(request.user)
            item = update_availability_window(item, request.data or {})
        except AccessDenied as exc:
            return _access_denied_response(exc)
        except AvailabilityError as exc:
            return _error_response(exc)
        return Response({"ok": True, "item": serialize_availability(item)})

    def delete(self, request, pk):
        # Cleanup of previously painted free time stays available after downgrade.
        item = self._get_item(request, pk)
        if item is None:
            return Response({"error": "Интервал не найден.", "code": "not_found"}, status=404)
        deactivate_availability(item)
        return Response({"ok": True})


class TeacherBookingLinkView(APIView):
    permission_classes = [IsAuthenticated, IsCabinetTeacher]

    def get(self, request):
        link = ensure_booking_link(request.user)
        return Response(serialize_booking_link(link, request=request, teacher=request.user))

    def post(self, request):
        try:
            data = publish_booking_link(request.user, request.data or {}, request=request)
        except AccessDenied as exc:
            return _access_denied_response(exc)
        except AvailabilityError as exc:
            return _error_response(exc)
        return Response({"ok": True, **data})


class PublicBookingPageView(APIView):
    permission_classes = [AllowAny]

    def get(self, request, token):
        try:
            payload = public_booking_page(token, user=request.user, request=request)
        except AvailabilityError as exc:
            return _error_response(exc)
        return Response(payload)


class PublicBookingCreateView(APIView):
    permission_classes = [AllowAny]

    def post(self, request, token):
        data = request.data or {}
        try:
            booking = book_slot_and_notify(
                token=token,
                user=request.user,
                date_value=data.get("date"),
                start_time_value=data.get("start_time"),
            )
        except SlotTakenError as exc:
            return _error_response(exc)
        except AvailabilityError as exc:
            return _error_response(exc)
        return Response({"ok": True, "booking": serialize_booking(booking)}, status=201)


class StudentPermanentScheduleView(APIView):
    permission_classes = [IsAuthenticated, IsCabinetStudent]

    def get(self, request):
        items = student_bookings(request.user)
        return Response({"items": [serialize_booking(item) for item in items]})


class StudentPermanentScheduleCancelView(APIView):
    permission_classes = [IsAuthenticated, IsCabinetStudent]

    def post(self, request, booking_id):
        try:
            booking = cancel_student_booking(user=request.user, booking_id=booking_id)
        except AvailabilityError as exc:
            return _error_response(exc)
        return Response({"ok": True, "booking": serialize_booking(booking)})
