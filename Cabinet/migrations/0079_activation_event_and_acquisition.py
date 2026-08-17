from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion
import django.utils.timezone


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("Cabinet", "0078_board_asset_content_sha256"),
    ]

    operations = [
        migrations.AddField(
            model_name="profile",
            name="acquisition_campaign",
            field=models.CharField(
                blank=True,
                default="",
                max_length=64,
                verbose_name="Acquisition campaign",
            ),
        ),
        migrations.AddField(
            model_name="profile",
            name="acquisition_medium",
            field=models.CharField(
                blank=True,
                default="",
                max_length=32,
                verbose_name="Acquisition medium",
            ),
        ),
        migrations.AddField(
            model_name="profile",
            name="acquisition_source",
            field=models.CharField(
                blank=True,
                db_index=True,
                default="",
                max_length=32,
                verbose_name="Acquisition source",
            ),
        ),
        migrations.CreateModel(
            name="ActivationEvent",
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
                ("event_name", models.CharField(db_index=True, max_length=64, verbose_name="Событие")),
                ("role", models.CharField(blank=True, max_length=20, verbose_name="Роль")),
                (
                    "occurred_at",
                    models.DateTimeField(
                        db_index=True,
                        default=django.utils.timezone.now,
                        verbose_name="Когда",
                    ),
                ),
                ("session_key", models.CharField(blank=True, max_length=64, verbose_name="Сессия")),
                ("object_type", models.CharField(blank=True, max_length=32, verbose_name="Тип объекта")),
                (
                    "object_id",
                    models.PositiveBigIntegerField(blank=True, null=True, verbose_name="ID объекта"),
                ),
                ("source", models.CharField(blank=True, max_length=64, verbose_name="Источник")),
                ("metadata", models.JSONField(blank=True, default=dict, verbose_name="Метаданные")),
                (
                    "kind",
                    models.CharField(
                        choices=[("intent", "Intent"), ("confirmed", "Confirmed")],
                        db_index=True,
                        max_length=16,
                        verbose_name="Достоверность",
                    ),
                ),
                (
                    "idempotency_key",
                    models.CharField(max_length=160, unique=True, verbose_name="Идемпотентность"),
                ),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "user",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="activation_events",
                        to=settings.AUTH_USER_MODEL,
                        verbose_name="Пользователь",
                    ),
                ),
            ],
            options={
                "verbose_name": "Событие активации",
                "verbose_name_plural": "События активации",
            },
        ),
        migrations.AddIndex(
            model_name="activationevent",
            index=models.Index(
                fields=["user", "event_name", "occurred_at"],
                name="Cabinet_act_user_id_evt_idx",
            ),
        ),
        migrations.AddIndex(
            model_name="activationevent",
            index=models.Index(
                fields=["event_name", "occurred_at"],
                name="Cabinet_act_event_n_time_idx",
            ),
        ),
    ]
