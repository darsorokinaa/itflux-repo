from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("Cabinet", "0090_student_material_folder_parent"),
    ]

    operations = [
        migrations.CreateModel(
            name="MeetingTechnicalEvent",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("role", models.CharField("Роль", blank=True, default="", max_length=32)),
                (
                    "event_type",
                    models.CharField(
                        choices=[
                            ("conference_joined", "conference_joined"),
                            ("conference_left", "conference_left"),
                            ("participant_joined", "participant_joined"),
                            ("participant_left", "participant_left"),
                            ("conference_failed", "conference_failed"),
                            ("connection_failed", "connection_failed"),
                            ("peer_connection_failure", "peer_connection_failure"),
                            ("ready_to_close", "ready_to_close"),
                            ("room_mismatch", "room_mismatch"),
                            ("connection_reconnecting", "connection_reconnecting"),
                            ("connection_restored", "connection_restored"),
                            ("participant_count", "participant_count"),
                            ("join_config_issued", "join_config_issued"),
                        ],
                        db_index=True,
                        max_length=40,
                        verbose_name="Тип события",
                    ),
                ),
                ("occurred_at", models.DateTimeField("Когда", auto_now_add=True, db_index=True)),
                ("browser_tab_session_id", models.CharField("Вкладка", blank=True, default="", max_length=64)),
                ("call_session_id", models.CharField("Сессия звонка", blank=True, default="", max_length=64)),
                (
                    "jitsi_participant_id",
                    models.CharField("Jitsi participant id", blank=True, default="", max_length=255),
                ),
                (
                    "source",
                    models.CharField(
                        choices=[("frontend", "frontend"), ("backend", "backend")],
                        default="frontend",
                        max_length=16,
                        verbose_name="Источник",
                    ),
                ),
                ("reason", models.CharField("Причина/код", blank=True, default="", max_length=128)),
                ("metadata", models.JSONField("Метаданные", blank=True, default=dict)),
                (
                    "meeting",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="technical_events",
                        to="Cabinet.videomeeting",
                        verbose_name="Конференция",
                    ),
                ),
                (
                    "user",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="meeting_technical_events",
                        to=settings.AUTH_USER_MODEL,
                        verbose_name="Пользователь",
                    ),
                ),
            ],
            options={
                "verbose_name": "Техническое событие видеоконференции",
                "verbose_name_plural": "Технические события видеоконференций",
                "ordering": ["-occurred_at"],
                "indexes": [
                    models.Index(
                        fields=["meeting", "event_type", "occurred_at"],
                        name="cabinet_mee_meeting_tech_idx",
                    )
                ],
            },
        ),
    ]
