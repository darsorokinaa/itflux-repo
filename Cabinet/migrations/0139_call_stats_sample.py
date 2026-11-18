# ruff: noqa: RUF012

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("Cabinet", "0138_telemost_conference"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="CallStatsSample",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                (
                    "created_at",
                    models.DateTimeField(
                        auto_now_add=True, db_index=True, verbose_name="Время"
                    ),
                ),
                (
                    "role",
                    models.CharField(
                        blank=True, default="", max_length=16, verbose_name="Роль"
                    ),
                ),
                (
                    "provider",
                    models.CharField(
                        blank=True, default="", max_length=16, verbose_name="Звонок"
                    ),
                ),
                (
                    "rtt_ms",
                    models.PositiveIntegerField(
                        blank=True, null=True, verbose_name="RTT, мс"
                    ),
                ),
                (
                    "jitter_ms",
                    models.PositiveIntegerField(
                        blank=True, null=True, verbose_name="Джиттер, мс"
                    ),
                ),
                (
                    "loss_in_pct",
                    models.FloatField(
                        blank=True, null=True, verbose_name="Потери вх., %"
                    ),
                ),
                (
                    "loss_out_pct",
                    models.FloatField(
                        blank=True, null=True, verbose_name="Потери исх., %"
                    ),
                ),
                (
                    "bitrate_in_kbps",
                    models.PositiveIntegerField(
                        blank=True, null=True, verbose_name="Вх., кбит/с"
                    ),
                ),
                (
                    "bitrate_out_kbps",
                    models.PositiveIntegerField(
                        blank=True, null=True, verbose_name="Исх., кбит/с"
                    ),
                ),
                (
                    "audio_out_kbps",
                    models.PositiveIntegerField(
                        blank=True, null=True, verbose_name="Звук исх., кбит/с"
                    ),
                ),
                (
                    "share_direction",
                    models.CharField(
                        blank=True, default="", max_length=8, verbose_name="Экран"
                    ),
                ),
                (
                    "share_fps",
                    models.FloatField(blank=True, null=True, verbose_name="Экран, к/с"),
                ),
                (
                    "share_width",
                    models.PositiveIntegerField(
                        blank=True, null=True, verbose_name="Ширина экрана"
                    ),
                ),
                (
                    "share_height",
                    models.PositiveIntegerField(
                        blank=True, null=True, verbose_name="Высота экрана"
                    ),
                ),
                (
                    "quality_limitation",
                    models.CharField(
                        blank=True,
                        default="",
                        max_length=16,
                        verbose_name="Ограничение",
                    ),
                ),
                (
                    "connection_type",
                    models.CharField(
                        blank=True, default="", max_length=8, verbose_name="Соединение"
                    ),
                ),
                (
                    "transport",
                    models.CharField(
                        blank=True, default="", max_length=8, verbose_name="Транспорт"
                    ),
                ),
                (
                    "connection_quality",
                    models.CharField(
                        blank=True,
                        default="",
                        max_length=12,
                        verbose_name="Оценка LiveKit",
                    ),
                ),
                (
                    "reconnects",
                    models.PositiveIntegerField(default=0, verbose_name="Переподкл."),
                ),
                (
                    "meeting",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="call_stats_samples",
                        to="Cabinet.videomeeting",
                        verbose_name="Встреча",
                    ),
                ),
                (
                    "user",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="call_stats_samples",
                        to=settings.AUTH_USER_MODEL,
                        verbose_name="Пользователь",
                    ),
                ),
            ],
            options={
                "verbose_name": "Статистика звонка",
                "verbose_name_plural": "Статистика звонков",
                "ordering": ("-created_at",),
                "indexes": [
                    models.Index(
                        fields=["meeting", "created_at"],
                        name="callstats_meeting_created",
                    )
                ],
            },
        ),
    ]
