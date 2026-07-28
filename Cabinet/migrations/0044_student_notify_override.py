from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("Cabinet", "0043_webpush_and_teacher_notify_prefs"),
    ]

    operations = [
        migrations.CreateModel(
            name="StudentNotifyOverride",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                (
                    "mode",
                    models.CharField(
                        choices=[
                            ("all", "Все события"),
                            ("important_only", "Только важные"),
                            ("mute_optional", "Отключить необязательные"),
                        ],
                        default="all",
                        max_length=20,
                        verbose_name="Режим",
                    ),
                ),
                ("notify_homework", models.BooleanField(blank=True, null=True, verbose_name="Работы на проверку")),
                ("notify_messages", models.BooleanField(blank=True, null=True, verbose_name="Сообщения")),
                ("notify_overdue", models.BooleanField(blank=True, null=True, verbose_name="Просроченные задания")),
                ("notify_billing", models.BooleanField(blank=True, null=True, verbose_name="Оплаты")),
                ("notify_attendance", models.BooleanField(blank=True, null=True, verbose_name="Посещаемость")),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "student",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="notify_override",
                        to="Cabinet.student",
                        verbose_name="Ученик",
                    ),
                ),
            ],
            options={
                "verbose_name": "Уведомления об ученике",
                "verbose_name_plural": "Уведомления об учениках",
            },
        ),
    ]
