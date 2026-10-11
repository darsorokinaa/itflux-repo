from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("Cabinet", "0119_lessonplanitem_import_key"),
    ]

    operations = [
        migrations.CreateModel(
            name="MeetingCallRoute",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                (
                    "active_provider",
                    models.CharField(
                        choices=[
                            ("meet", "Текущий Jitsi"),
                            ("jaas", "8x8 JaaS"),
                            ("livekit", "Собственный LiveKit"),
                        ],
                        default="meet",
                        max_length=16,
                        verbose_name="Активный провайдер",
                    ),
                ),
                ("generation", models.PositiveIntegerField(default=1, verbose_name="Поколение")),
                ("switched_at", models.DateTimeField(blank=True, null=True, verbose_name="Переключено")),
                (
                    "switch_reason",
                    models.CharField(blank=True, default="", max_length=64, verbose_name="Причина переключения"),
                ),
                (
                    "auto_switch_count",
                    models.PositiveSmallIntegerField(default=0, verbose_name="Автопереключений"),
                ),
                ("cooldown_until", models.DateTimeField(blank=True, null=True, verbose_name="Пауза до")),
                (
                    "circuit_open_until",
                    models.DateTimeField(blank=True, null=True, verbose_name="Circuit breaker до"),
                ),
                ("livekit_room", models.CharField(blank=True, default="", max_length=255, verbose_name="Комната LiveKit")),
                ("revoked_user_ids", models.JSONField(blank=True, default=list, verbose_name="Отозванные участники")),
                ("failure_reports", models.JSONField(blank=True, default=list, verbose_name="Отчёты о сбоях")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "meeting",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="call_route",
                        to="Cabinet.videomeeting",
                        verbose_name="Видеоконференция",
                    ),
                ),
                (
                    "switched_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="media_provider_switches",
                        to=settings.AUTH_USER_MODEL,
                        verbose_name="Кто переключил",
                    ),
                ),
            ],
            options={
                "verbose_name": "Маршрут видеосвязи",
                "verbose_name_plural": "Маршруты видеосвязи",
            },
        ),
    ]
