# Generated manually for teacher availability booking

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models
import Cabinet.availability_models


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("Cabinet", "0100_alter_lessonplan_subject"),
    ]

    operations = [
        migrations.CreateModel(
            name="TeacherAvailability",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                (
                    "date",
                    models.DateField(
                        blank=True,
                        help_text="Если задана — окно действует только в этот день.",
                        null=True,
                        verbose_name="Конкретная дата",
                    ),
                ),
                (
                    "weekday",
                    models.PositiveSmallIntegerField(
                        blank=True,
                        help_text="0 = понедельник … 6 = воскресенье. Для повторяющегося окна в периоде.",
                        null=True,
                        verbose_name="День недели",
                    ),
                ),
                ("start_time", models.TimeField(verbose_name="Начало")),
                ("end_time", models.TimeField(verbose_name="Окончание")),
                ("slot_duration_minutes", models.PositiveSmallIntegerField(default=60, verbose_name="Длительность слота, мин")),
                ("valid_from", models.DateField(verbose_name="Доступно с")),
                ("valid_until", models.DateField(verbose_name="Доступно по")),
                ("is_active", models.BooleanField(db_index=True, default=True, verbose_name="Активно")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "teacher",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="availability_windows",
                        to=settings.AUTH_USER_MODEL,
                        verbose_name="Учитель",
                    ),
                ),
            ],
            options={
                "verbose_name": "Свободное время учителя",
                "verbose_name_plural": "Свободное время учителей",
                "ordering": ["valid_from", "start_time", "id"],
            },
        ),
        migrations.CreateModel(
            name="TeacherBookingLink",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                (
                    "token",
                    models.CharField(
                        db_index=True,
                        default=Cabinet.availability_models.generate_booking_token,
                        max_length=64,
                        unique=True,
                        verbose_name="Токен",
                    ),
                ),
                ("date_from", models.DateField(blank=True, null=True, verbose_name="Показать с")),
                ("date_to", models.DateField(blank=True, null=True, verbose_name="Показать по")),
                ("is_active", models.BooleanField(db_index=True, default=True, verbose_name="Активна")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "teacher",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="booking_link",
                        to=settings.AUTH_USER_MODEL,
                        verbose_name="Учитель",
                    ),
                ),
            ],
            options={
                "verbose_name": "Ссылка на запись",
                "verbose_name_plural": "Ссылки на запись",
            },
        ),
        migrations.CreateModel(
            name="TeacherBooking",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("weekday", models.PositiveSmallIntegerField(verbose_name="День недели")),
                ("start_time", models.TimeField(verbose_name="Время начала")),
                ("end_time", models.TimeField(verbose_name="Время окончания")),
                ("first_date", models.DateField(verbose_name="Первая дата")),
                (
                    "status",
                    models.CharField(
                        choices=[("active", "Активна"), ("cancelled", "Отменена")],
                        db_index=True,
                        default="active",
                        max_length=20,
                        verbose_name="Статус",
                    ),
                ),
                (
                    "source",
                    models.CharField(
                        choices=[("self_service", "Самостоятельная запись")],
                        default="self_service",
                        max_length=24,
                        verbose_name="Источник",
                    ),
                ),
                ("booked_at", models.DateTimeField(auto_now_add=True)),
                ("cancelled_at", models.DateTimeField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "booking_link",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="bookings",
                        to="Cabinet.teacherbookinglink",
                        verbose_name="Ссылка",
                    ),
                ),
                (
                    "cancelled_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="cancelled_teacher_bookings",
                        to=settings.AUTH_USER_MODEL,
                        verbose_name="Отменил",
                    ),
                ),
                (
                    "series",
                    models.OneToOneField(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="availability_booking",
                        to="Cabinet.scheduleeventseries",
                        verbose_name="Расписание",
                    ),
                ),
                (
                    "student",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="teacher_bookings",
                        to="Cabinet.student",
                        verbose_name="Ученик",
                    ),
                ),
                (
                    "teacher",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="teacher_bookings",
                        to=settings.AUTH_USER_MODEL,
                        verbose_name="Учитель",
                    ),
                ),
            ],
            options={
                "verbose_name": "Запись на постоянное время",
                "verbose_name_plural": "Записи на постоянное время",
                "ordering": ["-booked_at"],
            },
        ),
        migrations.AddIndex(
            model_name="teacheravailability",
            index=models.Index(
                fields=["teacher", "is_active", "valid_from", "valid_until"],
                name="Cabinet_tea_teacher_6f3a21_idx",
            ),
        ),
        migrations.AddConstraint(
            model_name="teacheravailability",
            constraint=models.CheckConstraint(
                condition=models.Q(("end_time__gt", models.F("start_time"))),
                name="cabinet_avail_end_after_start",
            ),
        ),
        migrations.AddConstraint(
            model_name="teacheravailability",
            constraint=models.CheckConstraint(
                condition=models.Q(("date__isnull", False), ("weekday__isnull", False), _connector="OR"),
                name="cabinet_avail_date_or_weekday",
            ),
        ),
        migrations.AddIndex(
            model_name="teacherbooking",
            index=models.Index(fields=["teacher", "status"], name="Cabinet_tea_teacher_8c1e44_idx"),
        ),
        migrations.AddIndex(
            model_name="teacherbooking",
            index=models.Index(fields=["student", "status"], name="Cabinet_tea_student_9b2f11_idx"),
        ),
        migrations.AddConstraint(
            model_name="teacherbooking",
            constraint=models.UniqueConstraint(
                condition=models.Q(("status", "active")),
                fields=("teacher", "weekday", "start_time"),
                name="cabinet_unique_active_teacher_weekday_slot",
            ),
        ),
    ]
