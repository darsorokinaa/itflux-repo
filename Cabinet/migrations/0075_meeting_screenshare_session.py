import django.db.models.deletion
import uuid
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("Cabinet", "0074_ensure_default_tariff_plans"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="MeetingScreenShareSession",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("uuid", models.UUIDField(default=uuid.uuid4, editable=False, unique=True)),
                ("presenter_jitsi_id", models.CharField(blank=True, default="", max_length=255, verbose_name="Jitsi participant id докладчика")),
                ("participants_can_annotate", models.BooleanField(default=True, verbose_name="Участники могут рисовать")),
                ("content_width", models.PositiveIntegerField(blank=True, null=True, verbose_name="Ширина демонстрируемого кадра")),
                ("content_height", models.PositiveIntegerField(blank=True, null=True, verbose_name="Высота демонстрируемого кадра")),
                ("annotations", models.JSONField(blank=True, default=list, verbose_name="Аннотации")),
                ("recent_operation_ids", models.JSONField(blank=True, default=list, verbose_name="Недавние operation_id")),
                ("version", models.PositiveIntegerField(default=1, verbose_name="Версия")),
                ("is_active", models.BooleanField(db_index=True, default=True, verbose_name="Активна")),
                ("started_at", models.DateTimeField(auto_now_add=True, verbose_name="Начало")),
                ("ended_at", models.DateTimeField(blank=True, null=True, verbose_name="Окончание")),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "meeting",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="screenshare_sessions",
                        to="Cabinet.videomeeting",
                        verbose_name="Видеоурок",
                    ),
                ),
                (
                    "presenter_user",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="presented_screenshare_sessions",
                        to=settings.AUTH_USER_MODEL,
                        verbose_name="Кто демонстрирует",
                    ),
                ),
            ],
            options={
                "verbose_name": "Сессия демонстрации экрана",
                "verbose_name_plural": "Сессии демонстрации экрана",
                "ordering": ["-started_at"],
            },
        ),
        migrations.AddIndex(
            model_name="meetingscreensharesession",
            index=models.Index(fields=["meeting", "is_active"], name="Cabinet_mee_meeting_ss_idx"),
        ),
    ]
