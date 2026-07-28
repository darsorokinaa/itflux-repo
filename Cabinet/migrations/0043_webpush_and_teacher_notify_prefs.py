# Generated manually for Web Push + teacher notification prefs

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("Cabinet", "0042_profile_encrypted_avatar"),
    ]

    operations = [
        migrations.AddField(
            model_name="notificationpreference",
            name="push_enabled",
            field=models.BooleanField(default=True, verbose_name="Web Push"),
        ),
        migrations.AddField(
            model_name="notificationpreference",
            name="push_privacy_mode",
            field=models.BooleanField(
                default=False,
                help_text="Не показывать суммы и чувствительные детали на экране блокировки",
                verbose_name="Приватный режим push",
            ),
        ),
        migrations.AddField(
            model_name="notificationpreference",
            name="lesson_reminder_minutes",
            field=models.JSONField(
                blank=True,
                default=list,
                help_text="Пустой список — стандарт 24ч / 1ч / 10мин",
                verbose_name="Интервалы напоминаний (мин)",
            ),
        ),
        migrations.AddField(
            model_name="notificationpreference",
            name="notify_daily_schedule",
            field=models.BooleanField(default=True, verbose_name="Расписание на день"),
        ),
        migrations.AddField(
            model_name="notificationpreference",
            name="daily_schedule_hour",
            field=models.PositiveSmallIntegerField(
                blank=True,
                default=8,
                help_text="None / пусто — не отправлять; 0–23 — час локального времени",
                null=True,
                verbose_name="Час утреннего расписания",
            ),
        ),
        migrations.AddField(
            model_name="notificationpreference",
            name="notify_daily_schedule_empty",
            field=models.BooleanField(
                default=False,
                verbose_name="Сообщать, что сегодня уроков нет",
            ),
        ),
        migrations.AddField(
            model_name="notificationpreference",
            name="notify_new_student",
            field=models.BooleanField(default=True, verbose_name="Новые ученики"),
        ),
        migrations.AddField(
            model_name="notificationpreference",
            name="notify_homework_resubmitted",
            field=models.BooleanField(default=True, verbose_name="Исправленные работы"),
        ),
        migrations.AddField(
            model_name="notificationpreference",
            name="notify_overdue_homework",
            field=models.BooleanField(default=True, verbose_name="Просроченные задания"),
        ),
        migrations.AddField(
            model_name="notificationpreference",
            name="notify_student_message",
            field=models.BooleanField(default=True, verbose_name="Сообщения учеников"),
        ),
        migrations.AddField(
            model_name="notificationpreference",
            name="notify_student_entered_room",
            field=models.BooleanField(default=False, verbose_name="Ученик вошёл в комнату"),
        ),
        migrations.AddField(
            model_name="notificationpreference",
            name="notify_student_absent",
            field=models.BooleanField(default=False, verbose_name="Ученик не подключился"),
        ),
        migrations.AddField(
            model_name="notificationpreference",
            name="notify_auto_check_attention",
            field=models.BooleanField(default=True, verbose_name="Автопроверка требует внимания"),
        ),
        migrations.AddField(
            model_name="notificationpreference",
            name="notify_system",
            field=models.BooleanField(default=True, verbose_name="Системные события"),
        ),
        migrations.AddField(
            model_name="notificationpreference",
            name="homework_review_push_mode",
            field=models.CharField(
                default="each",
                help_text="each | digest_15 | digest_60 | in_app_only",
                max_length=16,
                verbose_name="Режим push по работам на проверку",
            ),
        ),
        migrations.AddField(
            model_name="notificationpreference",
            name="overdue_homework_mode",
            field=models.CharField(
                default="daily",
                help_text="immediate | daily | in_app_only | off",
                max_length=16,
                verbose_name="Режим просроченных ДЗ",
            ),
        ),
        migrations.AddField(
            model_name="notificationpreference",
            name="dnd_enabled",
            field=models.BooleanField(default=False, verbose_name="Не беспокоить"),
        ),
        migrations.AddField(
            model_name="notificationpreference",
            name="dnd_start",
            field=models.TimeField(blank=True, null=True, verbose_name="Не беспокоить с"),
        ),
        migrations.AddField(
            model_name="notificationpreference",
            name="dnd_end",
            field=models.TimeField(blank=True, null=True, verbose_name="Не беспокоить до"),
        ),
        migrations.AddField(
            model_name="notificationpreference",
            name="dnd_allow_urgent",
            field=models.BooleanField(default=True, verbose_name="Срочные во время тишины"),
        ),
        migrations.AlterField(
            model_name="notification",
            name="channel",
            field=models.CharField(
                choices=[
                    ("in_app", "В кабинете"),
                    ("email", "Email"),
                    ("vk", "ВКонтакте"),
                    ("telegram", "Telegram"),
                    ("push", "Web Push"),
                    ("sms", "SMS"),
                ],
                default="in_app",
                max_length=16,
                verbose_name="Канал",
            ),
        ),
        migrations.CreateModel(
            name="PushSubscription",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("endpoint", models.URLField(max_length=512, unique=True, verbose_name="Endpoint")),
                ("p256dh", models.CharField(max_length=255, verbose_name="p256dh")),
                ("auth", models.CharField(max_length=255, verbose_name="auth")),
                ("user_agent", models.CharField(blank=True, max_length=500, verbose_name="User-Agent")),
                ("device_label", models.CharField(blank=True, max_length=120, verbose_name="Устройство")),
                ("is_active", models.BooleanField(default=True, verbose_name="Активна")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("last_seen_at", models.DateTimeField(blank=True, null=True)),
                (
                    "user",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="push_subscriptions",
                        to=settings.AUTH_USER_MODEL,
                        verbose_name="Пользователь",
                    ),
                ),
            ],
            options={
                "verbose_name": "Push-подписка",
                "verbose_name_plural": "Push-подписки",
                "ordering": ["-updated_at"],
                "indexes": [
                    models.Index(fields=["user", "is_active"], name="Cabinet_pus_user_id_8f3a1b_idx"),
                ],
            },
        ),
    ]
