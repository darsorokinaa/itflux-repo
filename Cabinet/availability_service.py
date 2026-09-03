"""Compute teacher booking slots and convert a chosen slot into ScheduleEventSeries."""

from __future__ import annotations

from datetime import date, datetime, time, timedelta

from django.db import IntegrityError, transaction
from django.utils import timezone

from .availability_models import TeacherAvailability, TeacherBooking, TeacherBookingLink
from .choices import RecurrenceType, SeriesStatus, StudentStatus
from .models import ScheduleEvent, ScheduleEventSeries, Student
from .schedule_series import _weekdays_for_series
from .schedule_service import (
    cancel_series,
    check_conflicts,
    create_series,
    resolve_schedule_timezone,
)
from .student_subjects import active_subjects_for_student

SLOT_TAKEN_MESSAGE = "Это время уже занял другой ученик. Выберите другой свободный слот."
NOT_LINKED_MESSAGE = (
    "Чтобы записаться на постоянное время, ваш аккаунт должен быть подключён к этому преподавателю."
)
AUTH_REQUIRED_MESSAGE = "Чтобы записаться, войдите в аккаунт ученика."
WEEKDAY_NAMES = (
    "понедельник",
    "вторник",
    "среда",
    "четверг",
    "пятница",
    "суббота",
    "воскресенье",
)
MIN_SLOT_MINUTES = 15
MAX_SLOT_MINUTES = 240
MAX_HORIZON_DAYS = 90


class AvailabilityError(Exception):
    def __init__(self, message, *, code="availability_error", status=400):
        super().__init__(message)
        self.message = message
        self.code = code
        self.status = status


class SlotTakenError(AvailabilityError):
    def __init__(self, message=SLOT_TAKEN_MESSAGE):
        super().__init__(message, code="slot_taken", status=409)


def teacher_timezone(teacher):
    return resolve_schedule_timezone(teacher=teacher)


def parse_time_value(value):
    if isinstance(value, time):
        return value.replace(second=0, microsecond=0)
    text = str(value or "").strip()
    if not text:
        raise AvailabilityError("Укажите время.")
    parts = text.split(":")
    try:
        hour = int(parts[0])
        minute = int(parts[1]) if len(parts) > 1 else 0
    except (TypeError, ValueError) as exc:
        raise AvailabilityError("Некорректное время.") from exc
    if hour < 0 or hour > 23 or minute < 0 or minute > 59:
        raise AvailabilityError("Некорректное время.")
    return time(hour, minute)


def parse_date_value(value):
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    text = str(value or "").strip()
    try:
        return date.fromisoformat(text[:10])
    except ValueError as exc:
        raise AvailabilityError("Некорректная дата.") from exc


def time_to_minutes(value):
    value = parse_time_value(value)
    return value.hour * 60 + value.minute


def minutes_to_time(total):
    total = int(total) % (24 * 60)
    return time(total // 60, total % 60)


def times_overlap(start_a, end_a, start_b, end_b):
    return time_to_minutes(start_a) < time_to_minutes(end_b) and time_to_minutes(end_a) > time_to_minutes(start_b)


def weekday_name(weekday):
    if weekday is None or weekday < 0 or weekday > 6:
        return ""
    return WEEKDAY_NAMES[weekday]


def format_slot_label(weekday, start):
    hhmm = parse_time_value(start).strftime("%H:%M")
    name = weekday_name(weekday)
    return f"{name}, {hhmm}" if name else hhmm


def default_slot_duration(teacher):
    try:
        from .billing_service import get_or_create_teacher_settings

        settings_obj = get_or_create_teacher_settings(teacher)
        minutes = int(getattr(settings_obj, "default_lesson_duration_minutes", 0) or 0)
        if MIN_SLOT_MINUTES <= minutes <= MAX_SLOT_MINUTES:
            return minutes
    except Exception:
        pass
    return 60


def normalize_slot_duration(value, *, fallback=60):
    try:
        minutes = int(value)
    except (TypeError, ValueError):
        minutes = fallback
    if minutes < MIN_SLOT_MINUTES or minutes > MAX_SLOT_MINUTES:
        raise AvailabilityError("Длительность слота должна быть от 15 до 240 минут.")
    return minutes


def teacher_display_name(teacher):
    profile = getattr(teacher, "profile", None)
    if profile:
        return profile.get_display_name()
    return teacher.get_full_name() or teacher.username


def ensure_booking_link(teacher):
    link, _created = TeacherBookingLink.objects.get_or_create(teacher=teacher)
    if not link.token:
        link.token = TeacherBookingLink._meta.get_field("token").default()
        link.save(update_fields=["token", "updated_at"])
    return link


def serialize_booking_link(link, *, request=None):
    path = f"/book/{link.token}"
    url = path
    if request is not None:
        url = request.build_absolute_uri(path)
    return {
        "token": link.token,
        "url": url,
        "path": path,
        "date_from": link.date_from.isoformat() if link.date_from else None,
        "date_to": link.date_to.isoformat() if link.date_to else None,
        "is_active": link.is_active,
    }


def serialize_availability(item):
    return {
        "id": item.pk,
        "date": item.date.isoformat() if item.date else None,
        "weekday": item.weekday,
        "weekday_label": weekday_name(item.weekday) if item.weekday is not None else "",
        "start_time": item.start_time.strftime("%H:%M"),
        "end_time": item.end_time.strftime("%H:%M"),
        "slot_duration_minutes": item.slot_duration_minutes,
        "valid_from": item.valid_from.isoformat(),
        "valid_until": item.valid_until.isoformat(),
        "is_active": item.is_active,
    }


def _iter_days(date_from, date_to):
    current = date_from
    while current <= date_to:
        yield current
        current += timedelta(days=1)


def availability_covers_date(item, day):
    if not item.is_active:
        return False
    if day < item.valid_from or day > item.valid_until:
        return False
    if item.date:
        return item.date == day
    if item.weekday is None:
        return False
    return day.weekday() == item.weekday


def generate_slot_starts(start_time, end_time, duration_minutes):
    start_m = time_to_minutes(start_time)
    end_m = time_to_minutes(end_time)
    if end_m <= start_m or duration_minutes <= 0:
        return []
    starts = []
    cursor = start_m
    while cursor + duration_minutes <= end_m:
        starts.append(minutes_to_time(cursor))
        cursor += duration_minutes
    return starts


def active_series_for_teacher(teacher):
    return list(
        ScheduleEventSeries.objects.filter(
            teacher=teacher,
            status=SeriesStatus.ACTIVE,
        )
    )


def series_occupies_weekday_time(series, weekday, start_time, end_time):
    if series.status != SeriesStatus.ACTIVE:
        return False
    if series.recurrence_type == RecurrenceType.NONE:
        return False
    weekdays = _weekdays_for_series(series)
    if not weekdays:
        weekdays = [series.start_date.weekday()] if series.start_date else []
    if weekday not in weekdays:
        return False
    return times_overlap(series.start_time, series.end_time, start_time, end_time)


def blocking_events_for_range(teacher, date_from, date_to, tz):
    start_dt = datetime.combine(date_from, time.min, tzinfo=tz)
    end_dt = datetime.combine(date_to + timedelta(days=1), time.min, tzinfo=tz)
    return list(
        ScheduleEvent.objects.filter(
            owner=teacher,
            starts_at__lt=end_dt,
            ends_at__gt=start_dt,
        )
        .exclude(status=ScheduleEvent.Status.CANCELLED)
        .select_related("series")
    )


def event_blocks_slot(event, slot_start, slot_end):
    if event.status == ScheduleEvent.Status.CANCELLED:
        return False
    if event.series_id:
        # Recurring occupancy is decided by the series, not a single occurrence.
        return False
    return event.starts_at < slot_end and event.ends_at > slot_start


def combine_local(day, clock, tz):
    clock = parse_time_value(clock)
    return datetime.combine(day, clock, tzinfo=tz)


def published_range(link, today):
    date_from = link.date_from or today
    date_to = link.date_to or (today + timedelta(days=13))
    if date_from < today:
        date_from = today
    if date_to < date_from:
        return None, None
    if (date_to - date_from).days > MAX_HORIZON_DAYS:
        date_to = date_from + timedelta(days=MAX_HORIZON_DAYS)
    return date_from, date_to


def compute_available_slots(
    *,
    teacher,
    date_from,
    date_to,
    windows=None,
    series_list=None,
    events=None,
):
    if date_from is None or date_to is None or date_to < date_from:
        return []
    tz = teacher_timezone(teacher)
    windows = list(windows if windows is not None else TeacherAvailability.objects.filter(
        teacher=teacher,
        is_active=True,
        valid_until__gte=date_from,
        valid_from__lte=date_to,
    ))
    series_list = series_list if series_list is not None else active_series_for_teacher(teacher)
    events = events if events is not None else blocking_events_for_range(teacher, date_from, date_to, tz)
    active_bookings = list(TeacherBooking.objects.filter(
        teacher=teacher,
        status=TeacherBooking.Status.ACTIVE
    ))
    slots = []
    seen = set()
    for day in _iter_days(date_from, date_to):
        if day < timezone.now().astimezone(tz).date():
            continue
        for window in windows:
            if not availability_covers_date(window, day):
                continue
            duration = window.slot_duration_minutes or 60
            for start in generate_slot_starts(window.start_time, window.end_time, duration):
                end = minutes_to_time(time_to_minutes(start) + duration)
                key = (day.isoformat(), start.strftime("%H:%M"))
                if key in seen:
                    continue
                if any(series_occupies_weekday_time(series, day.weekday(), start, end) for series in series_list):
                    continue
                slot_start = combine_local(day, start, tz)
                if slot_start < timezone.now():
                    continue
                slot_end = combine_local(day, end, tz)
                if any(event_blocks_slot(event, slot_start, slot_end) for event in events):
                    continue
                if any(b.weekday == day.weekday() and b.start_time == start for b in active_bookings):
                    continue
                seen.add(key)
                slots.append({
                    "date": day.isoformat(),
                    "weekday": day.weekday(),
                    "weekday_label": weekday_name(day.weekday()),
                    "start_time": start.strftime("%H:%M"),
                    "end_time": end.strftime("%H:%M"),
                    "duration_minutes": duration,
                    "availability_id": window.pk,
                })
    slots.sort(key=lambda item: (item["date"], item["start_time"]))
    return slots


def create_availability_windows(teacher, payload):
    start_time = parse_time_value(payload.get("start_time"))
    end_time = parse_time_value(payload.get("end_time"))
    if time_to_minutes(end_time) <= time_to_minutes(start_time):
        raise AvailabilityError("Время окончания должно быть позже времени начала.")
    duration = normalize_slot_duration(
        payload.get("slot_duration_minutes"),
        fallback=default_slot_duration(teacher),
    )
    if not generate_slot_starts(start_time, end_time, duration):
        raise AvailabilityError("В выбранный интервал не помещается ни одного слота выбранной длительности.")

    extra_intervals = payload.get("intervals") or []
    intervals = [(start_time, end_time)]
    for raw in extra_intervals:
        extra_start = parse_time_value(raw.get("start_time"))
        extra_end = parse_time_value(raw.get("end_time"))
        extra_duration = normalize_slot_duration(
            raw.get("slot_duration_minutes") or duration,
            fallback=duration,
        )
        if time_to_minutes(extra_end) <= time_to_minutes(extra_start):
            raise AvailabilityError("Время окончания должно быть позже времени начала.")
        if not generate_slot_starts(extra_start, extra_end, extra_duration):
            raise AvailabilityError("В выбранный интервал не помещается ни одного слота выбранной длительности.")
        intervals.append((extra_start, extra_end, extra_duration))
    # First interval uses `duration`; extras may override.
    normalized = [(intervals[0][0], intervals[0][1], duration)]
    for item in intervals[1:]:
        if len(item) == 3:
            normalized.append(item)
        else:
            normalized.append((item[0], item[1], duration))

    dates = [parse_date_value(value) for value in (payload.get("dates") or []) if value]
    date_from = payload.get("date_from") or payload.get("valid_from")
    date_to = payload.get("date_to") or payload.get("valid_until")
    weekdays = payload.get("weekdays")
    if weekdays is not None:
        weekdays = sorted({int(value) for value in weekdays if str(value).isdigit() and 0 <= int(value) <= 6})

    created = []
    if dates:
        for day in dates:
            for start, end, slot_minutes in normalized:
                created.append(
                    TeacherAvailability.objects.create(
                        teacher=teacher,
                        date=day,
                        weekday=day.weekday(),
                        start_time=start,
                        end_time=end,
                        slot_duration_minutes=slot_minutes,
                        valid_from=day,
                        valid_until=day,
                        is_active=True,
                    )
                )
        return created

    if not date_from or not date_to:
        raise AvailabilityError("Укажите даты или период свободного времени.")
    period_from = parse_date_value(date_from)
    period_to = parse_date_value(date_to)
    if period_to < period_from:
        raise AvailabilityError("Дата окончания периода не может быть раньше даты начала.")
    if weekdays:
        for weekday in weekdays:
            for start, end, slot_minutes in normalized:
                created.append(
                    TeacherAvailability.objects.create(
                        teacher=teacher,
                        date=None,
                        weekday=weekday,
                        start_time=start,
                        end_time=end,
                        slot_duration_minutes=slot_minutes,
                        valid_from=period_from,
                        valid_until=period_to,
                        is_active=True,
                    )
                )
        return created

    for day in _iter_days(period_from, period_to):
        for start, end, slot_minutes in normalized:
            created.append(
                TeacherAvailability.objects.create(
                    teacher=teacher,
                    date=day,
                    weekday=day.weekday(),
                    start_time=start,
                    end_time=end,
                    slot_duration_minutes=slot_minutes,
                    valid_from=day,
                    valid_until=day,
                    is_active=True,
                )
            )
    return created


def update_availability_window(item, payload):
    fields = []
    if "start_time" in payload:
        item.start_time = parse_time_value(payload.get("start_time"))
        fields.append("start_time")
    if "end_time" in payload:
        item.end_time = parse_time_value(payload.get("end_time"))
        fields.append("end_time")
    if "slot_duration_minutes" in payload:
        item.slot_duration_minutes = normalize_slot_duration(
            payload.get("slot_duration_minutes"),
            fallback=item.slot_duration_minutes,
        )
        fields.append("slot_duration_minutes")
    if "is_active" in payload:
        item.is_active = bool(payload.get("is_active"))
        fields.append("is_active")
    if "date_from" in payload or "valid_from" in payload:
        item.valid_from = parse_date_value(payload.get("date_from") or payload.get("valid_from"))
        fields.append("valid_from")
    if "date_to" in payload or "valid_until" in payload:
        item.valid_until = parse_date_value(payload.get("date_to") or payload.get("valid_until"))
        fields.append("valid_until")
    if time_to_minutes(item.end_time) <= time_to_minutes(item.start_time):
        raise AvailabilityError("Время окончания должно быть позже времени начала.")
    if not generate_slot_starts(item.start_time, item.end_time, item.slot_duration_minutes):
        raise AvailabilityError("В выбранный интервал не помещается ни одного слота выбранной длительности.")
    if fields:
        fields.append("updated_at")
        item.save(update_fields=fields)
    return item


def deactivate_availability(item):
    item.is_active = False
    item.save(update_fields=["is_active", "updated_at"])
    return item


def publish_booking_link(teacher, payload, *, request=None):
    link = ensure_booking_link(teacher)
    date_from = payload.get("date_from")
    date_to = payload.get("date_to")
    if date_from:
        link.date_from = parse_date_value(date_from)
    if date_to:
        link.date_to = parse_date_value(date_to)
    if link.date_from and link.date_to and link.date_to < link.date_from:
        raise AvailabilityError("Дата окончания публикации не может быть раньше даты начала.")
    if "is_active" in payload:
        link.is_active = bool(payload.get("is_active"))
    link.save()
    return serialize_booking_link(link, request=request)


def resolve_linked_student(user, teacher):
    if not user or not user.is_authenticated:
        return None
    profile = getattr(user, "profile", None)
    if profile is None or profile.role != profile.Role.STUDENT:
        return None
    return (
        Student.objects.filter(user=user, teacher=teacher)
        .exclude(status=StudentStatus.ARCHIVED)
        .select_related("user", "user__profile")
        .first()
    )


def serialize_booking(booking, *, teacher=None):
    series = booking.series
    start_time = series.start_time if series else booking.start_time
    end_time = series.end_time if series else booking.end_time
    weekday = series.start_date.weekday() if series and series.start_date else booking.weekday
    student = booking.student
    teacher = teacher or booking.teacher
    return {
        "id": booking.pk,
        "status": booking.status,
        "source": booking.source,
        "weekday": weekday,
        "weekday_label": weekday_name(weekday),
        "start_time": parse_time_value(start_time).strftime("%H:%M"),
        "end_time": parse_time_value(end_time).strftime("%H:%M"),
        "first_date": booking.first_date.isoformat() if booking.first_date else None,
        "booked_at": booking.booked_at.isoformat() if booking.booked_at else None,
        "cancelled_at": booking.cancelled_at.isoformat() if booking.cancelled_at else None,
        "series_id": booking.series_id,
        "student_id": student.pk if student else None,
        "student_name": student.full_name if student else "",
        "teacher_id": teacher.pk,
        "teacher_name": teacher_display_name(teacher),
        "label": format_slot_label(weekday, start_time),
        "self_booked": True,
    }


def public_booking_page(token, *, user=None, request=None):
    link = (
        TeacherBookingLink.objects.select_related("teacher", "teacher__profile")
        .filter(token=token, is_active=True)
        .first()
    )
    if link is None:
        raise AvailabilityError("Ссылка на запись не найдена или больше не действует.", code="not_found", status=404)
    teacher = link.teacher
    today = timezone.now().astimezone(teacher_timezone(teacher)).date()
    date_from, date_to = published_range(link, today)
    windows = TeacherAvailability.objects.filter(
        teacher=teacher,
        is_active=True,
        valid_until__gte=today,
    )
    slots = compute_available_slots(
        teacher=teacher,
        date_from=date_from,
        date_to=date_to,
        windows=windows,
    ) if date_from and date_to else []
    # Filter out dates that are before today in teacher's timezone
    dates = []
    by_date = {}
    for slot in slots:
        if date.fromisoformat(slot["date"]) < today:
            continue
        by_date.setdefault(slot["date"], []).append(slot)
    for day, day_slots in by_date.items():
        parsed = date.fromisoformat(day)
        dates.append({
            "date": day,
            "weekday": parsed.weekday(),
            "weekday_label": weekday_name(parsed.weekday()),
            "slots": day_slots,
        })

    student = resolve_linked_student(user, teacher) if user else None
    authenticated = bool(user and user.is_authenticated)
    role = ""
    if authenticated:
        profile = getattr(user, "profile", None)
        role = getattr(profile, "role", "") or ""
    my_bookings = []
    if student:
        my_bookings = [
            serialize_booking(booking, teacher=teacher)
            for booking in TeacherBooking.objects.filter(
                teacher=teacher,
                student=student,
                status=TeacherBooking.Status.ACTIVE,
            ).select_related("series", "student", "teacher", "teacher__profile")
        ]

    return {
        "teacher": {
            "id": teacher.pk,
            "name": teacher_display_name(teacher),
        },
        "link": serialize_booking_link(link, request=request),
        "date_from": date_from.isoformat() if date_from else None,
        "date_to": date_to.isoformat() if date_to else None,
        "dates": dates,
        "slots": slots,
        "authenticated": authenticated,
        "role": role,
        "linked": bool(student),
        "student": {
            "id": student.pk,
            "name": student.full_name,
        } if student else None,
        "my_bookings": my_bookings,
        "not_linked_message": NOT_LINKED_MESSAGE,
        "auth_required_message": AUTH_REQUIRED_MESSAGE,
        "confirm_warning": (
            "Вы выбираете постоянное время занятий. Это время будет закреплено за вами "
            "на период обучения. Если в дальнейшем потребуется изменить расписание, "
            "согласуйте это с преподавателем лично."
        ),
    }


def _notify_booking(booking, *, kind):
    from .notification_catalog import NotificationEventType
    from .webpush import notify_user_channels

    student = booking.student
    teacher = booking.teacher
    label = format_slot_label(booking.weekday, booking.start_time)
    student_name = student.full_name if student else "Ученик"
    if kind == "booked":
        teacher_title = "Ученик выбрал постоянное время"
        teacher_message = f"{student_name} выбрал(а) постоянное время занятий: {label}."
        student_title = "Вы записались на постоянное время"
        student_message = f"Вы записались на постоянное время: {label}."
        event_type = NotificationEventType.LESSON_CREATED
        teacher_url = "/cabinet/schedule"
        student_url = "/cabinet/student/lessons"
    else:
        teacher_title = "Ученик отменил постоянную запись"
        teacher_message = f"{student_name} отменил(а) постоянную запись на {label}."
        student_title = "Постоянная запись отменена"
        student_message = f"Вы отменили постоянную запись на {label}."
        event_type = NotificationEventType.LESSON_CANCELLED
        teacher_url = "/cabinet/schedule"
        student_url = "/cabinet/student/lessons"

    payload = {
        "type": "permanent_slot",
        "booking_id": booking.pk,
        "series_id": booking.series_id,
        "weekday": booking.weekday,
        "start_time": parse_time_value(booking.start_time).strftime("%H:%M"),
    }
    try:
        notify_user_channels(
            teacher,
            title=teacher_title,
            message=teacher_message,
            payload={**payload, "url": teacher_url},
            event_type=event_type,
            recipient_teacher=teacher,
            actor=student.user if student and student.user_id else None,
            skip_actor=True,
        )
    except Exception:
        pass
    if student and student.user_id:
        try:
            notify_user_channels(
                student.user,
                title=student_title,
                message=student_message,
                payload={**payload, "url": student_url},
                event_type=event_type,
                recipient_student=student,
                actor=student.user,
                skip_actor=False,
            )
        except Exception:
            pass


def book_slot(*, token, user, date_value, start_time_value):
    if not user or not user.is_authenticated:
        raise AvailabilityError(AUTH_REQUIRED_MESSAGE, code="auth_required", status=401)
    profile = getattr(user, "profile", None)
    if profile is None or profile.role != profile.Role.STUDENT:
        raise AvailabilityError(NOT_LINKED_MESSAGE, code="not_linked", status=403)

    slot_date = parse_date_value(date_value)
    start_time = parse_time_value(start_time_value)

    with transaction.atomic():
            link = TeacherBookingLink.objects.select_for_update().filter(
                token=token, is_active=True,
            ).first()
            if link is None:
                raise AvailabilityError("Ссылка на запись не найдена или больше не действует.", code="not_found", status=404)
            teacher = link.teacher
            student = Student.objects.select_for_update().filter(
                user=user, teacher=teacher,
            ).exclude(status=StudentStatus.ARCHIVED).first()
            if student is None:
                raise AvailabilityError(NOT_LINKED_MESSAGE, code="not_linked", status=403)

            tz = teacher_timezone(teacher)
            today = timezone.now().astimezone(tz).date()
            date_from, date_to = published_range(link, today)
            if date_from is None or slot_date < date_from or slot_date > date_to:
                raise AvailabilityError("Эта дата больше не доступна для записи.", code="period_closed", status=409)

            windows = list(TeacherAvailability.objects.select_for_update().filter(
                teacher=teacher,
                is_active=True,
                valid_until__gte=slot_date,
                valid_from__lte=slot_date,
            ))

            # Lock the booking slot itself to prevent double booking
            # We use select_for_update on a dummy query or just rely on the unique constraint
            # Actually, the unique constraint `cabinet_unique_active_teacher_weekday_slot` will prevent double booking at the DB level.
            # But we can also lock the teacher record to serialize bookings for this teacher.
            from django.contrib.auth.models import User
            User.objects.select_for_update().get(pk=teacher.pk)
            series_list = active_series_for_teacher(teacher)
            events = blocking_events_for_range(teacher, slot_date, slot_date, tz)
            matching = None
            end_time = None
            for window in windows:
                if not availability_covers_date(window, slot_date):
                    continue
                duration = window.slot_duration_minutes or 60
                for start in generate_slot_starts(window.start_time, window.end_time, duration):
                    if start != start_time:
                        continue
                    candidate_end = minutes_to_time(time_to_minutes(start) + duration)
                    matching = window
                    end_time = candidate_end
                    break
                if matching:
                    break
            if matching is None or end_time is None:
                raise SlotTakenError()

            weekday = slot_date.weekday()
            if any(series_occupies_weekday_time(series, weekday, start_time, end_time) for series in series_list):
                raise SlotTakenError()

            slot_start = combine_local(slot_date, start_time, tz)
            if slot_start < timezone.now():
                raise AvailabilityError("Нельзя записаться на прошедшее время.", code="past_time", status=409)
            slot_end = combine_local(slot_date, end_time, tz)
            if any(event_blocks_slot(event, slot_start, slot_end) for event in events):
                raise SlotTakenError()
            if check_conflicts(teacher=teacher, starts_at=slot_start, ends_at=slot_end, student_id=student.pk):
                raise SlotTakenError()

            if TeacherBooking.objects.filter(
                teacher=teacher,
                weekday=weekday,
                start_time=start_time,
                status=TeacherBooking.Status.ACTIVE,
            ).exists():
                raise SlotTakenError()

            subjects = list(active_subjects_for_student(student)[:1])
            series_data = {
                "title": student.full_name,
                "event_type": "individual_lesson",
                "timezone": str(tz),
                "start_date": slot_date,
                "start_time": start_time,
                "end_time": end_time,
                "recurrence_type": RecurrenceType.WEEKLY,
                "recurrence_weekdays": [weekday],
                "format": "online",
                "topic": "Постоянное занятие",
                "notify_participants": False,
            }
            if subjects:
                series_data["student_subject_id"] = subjects[0].pk
            else:
                series_data["skip_plan"] = True

            try:
                series, events_created = create_series(
                    teacher=teacher,
                    series_data=series_data,
                    student_ids=[student.pk],
                    notify=False,
                )
            except ValueError as exc:
                raise AvailabilityError(str(exc) or "Не удалось создать расписание.") from exc

            try:
                booking = TeacherBooking.objects.create(
                    teacher=teacher,
                    student=student,
                    series=series,
                    booking_link=link,
                    weekday=weekday,
                    start_time=start_time,
                    end_time=end_time,
                    first_date=slot_date,
                    status=TeacherBooking.Status.ACTIVE,
                    source=TeacherBooking.Source.SELF_SERVICE,
                )
            except IntegrityError as exc:
                raise SlotTakenError() from exc

            return booking, events_created


def book_slot_and_notify(*, token, user, date_value, start_time_value):
    booking, _events = book_slot(
        token=token,
        user=user,
        date_value=date_value,
        start_time_value=start_time_value,
    )
    _notify_booking(booking, kind="booked")
    return booking


def student_bookings(user):
    students = Student.objects.filter(user=user).exclude(status=StudentStatus.ARCHIVED)
    return list(
        TeacherBooking.objects.filter(
            student__in=students,
            status=TeacherBooking.Status.ACTIVE,
        ).select_related("series", "student", "teacher", "teacher__profile")
    )


def cancel_student_booking(*, booking_id, user):
    if not user or not user.is_authenticated:
        raise AvailabilityError(AUTH_REQUIRED_MESSAGE, code="auth_required", status=401)
    students = Student.objects.filter(user=user).exclude(status=StudentStatus.ARCHIVED)
    with transaction.atomic():
        booking = TeacherBooking.objects.select_for_update().filter(
            pk=booking_id, student__in=students,
        ).first()
        if booking is not None:
            booking = TeacherBooking.objects.select_related(
                "series", "student", "teacher", "teacher__profile",
            ).get(pk=booking.pk)
        if booking is None:
            raise AvailabilityError("Запись не найдена.", code="not_found", status=404)
        if booking.status != TeacherBooking.Status.ACTIVE:
            raise AvailabilityError("Эта запись уже отменена.")
        tz = teacher_timezone(booking.teacher)
        today = timezone.now().astimezone(tz).date()
        if booking.series_id:
            cancel_series(
                booking.series,
                changed_by=user,
                from_date=today,
                notify=False,
            )
        booking.status = TeacherBooking.Status.CANCELLED
        booking.cancelled_at = timezone.now()
        booking.cancelled_by = user
        booking.save(update_fields=["status", "cancelled_at", "cancelled_by", "updated_at"])
    _notify_booking(booking, kind="cancelled")
    return booking
