"""Teacher availability windows and booking-link audit.

Confirmed bookings become ScheduleEventSeries — these models only store
published free time, the shareable link, and booking history.
"""

import secrets

from django.conf import settings
from django.db import models
from django.db.models import Q


def generate_booking_token():
    return secrets.token_urlsafe(16)


class TeacherAvailability(models.Model):
    """When the teacher is willing to accept a permanent-time booking."""

    teacher = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="availability_windows",
        verbose_name="Учитель",
    )
    date = models.DateField(
        "Конкретная дата",
        null=True,
        blank=True,
        help_text="Если задана — окно действует только в этот день.",
    )
    weekday = models.PositiveSmallIntegerField(
        "День недели",
        null=True,
        blank=True,
        help_text="0 = понедельник … 6 = воскресенье. Для повторяющегося окна в периоде.",
    )
    start_time = models.TimeField("Начало")
    end_time = models.TimeField("Окончание")
    slot_duration_minutes = models.PositiveSmallIntegerField("Длительность слота, мин", default=60)
    valid_from = models.DateField("Доступно с")
    valid_until = models.DateField("Доступно по")
    is_active = models.BooleanField("Активно", default=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Свободное время учителя"
        verbose_name_plural = "Свободное время учителей"
        ordering = ["valid_from", "start_time", "id"]
        indexes = [
            models.Index(fields=["teacher", "is_active", "valid_from", "valid_until"]),
        ]
        constraints = [
            models.CheckConstraint(
                condition=Q(end_time__gt=models.F("start_time")),
                name="cabinet_avail_end_after_start",
            ),
            models.CheckConstraint(
                condition=Q(date__isnull=False) | Q(weekday__isnull=False),
                name="cabinet_avail_date_or_weekday",
            ),
        ]

    def __str__(self):
        label = self.date.isoformat() if self.date else f"wd={self.weekday}"
        return f"{self.teacher_id} {label} {self.start_time}-{self.end_time}"


class TeacherBookingLink(models.Model):
    """Stable per-teacher URL. Visible dates follow published availability + this period."""

    teacher = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="booking_link",
        verbose_name="Учитель",
    )
    token = models.CharField(
        "Токен",
        max_length=64,
        unique=True,
        db_index=True,
        default=generate_booking_token,
    )
    date_from = models.DateField("Показать с", null=True, blank=True)
    date_to = models.DateField("Показать по", null=True, blank=True)
    is_active = models.BooleanField("Активна", default=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Ссылка на запись"
        verbose_name_plural = "Ссылки на запись"

    def __str__(self):
        return f"booking-link:{self.teacher_id}"


class TeacherBooking(models.Model):
    """Audit trail. Calendar source of truth remains ScheduleEventSeries."""

    class Status(models.TextChoices):
        ACTIVE = "active", "Активна"
        CANCELLED = "cancelled", "Отменена"

    class Source(models.TextChoices):
        SELF_SERVICE = "self_service", "Самостоятельная запись"

    teacher = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="teacher_bookings",
        verbose_name="Учитель",
    )
    student = models.ForeignKey(
        "Cabinet.Student",
        on_delete=models.CASCADE,
        related_name="teacher_bookings",
        verbose_name="Ученик",
    )
    series = models.OneToOneField(
        "Cabinet.ScheduleEventSeries",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="availability_booking",
        verbose_name="Расписание",
    )
    booking_link = models.ForeignKey(
        TeacherBookingLink,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="bookings",
        verbose_name="Ссылка",
    )
    weekday = models.PositiveSmallIntegerField("День недели")
    start_time = models.TimeField("Время начала")
    end_time = models.TimeField("Время окончания")
    first_date = models.DateField("Первая дата")
    status = models.CharField(
        "Статус",
        max_length=20,
        choices=Status.choices,
        default=Status.ACTIVE,
        db_index=True,
    )
    source = models.CharField(
        "Источник",
        max_length=24,
        choices=Source.choices,
        default=Source.SELF_SERVICE,
    )
    booked_at = models.DateTimeField(auto_now_add=True)
    cancelled_at = models.DateTimeField(null=True, blank=True)
    cancelled_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="cancelled_teacher_bookings",
        verbose_name="Отменил",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Запись на постоянное время"
        verbose_name_plural = "Записи на постоянное время"
        ordering = ["-booked_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["teacher", "weekday", "start_time"],
                condition=Q(status="active"),
                name="cabinet_unique_active_teacher_weekday_slot",
            ),
        ]
        indexes = [
            models.Index(fields=["teacher", "status"]),
            models.Index(fields=["student", "status"]),
        ]

    def __str__(self):
        return f"booking {self.student_id} wd={self.weekday} {self.start_time}"
