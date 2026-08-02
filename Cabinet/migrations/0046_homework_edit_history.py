from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("Cabinet", "0045_rename_cabinet_pus_user_id_8f3a1b_idx_cabinet_pus_user_id_59c45b_idx_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="homeworktask",
            name="is_active",
            field=models.BooleanField(
                default=True,
                help_text="False — задание исключено из ДЗ без удаления из БД (ответы сохраняются).",
                verbose_name="Активно в ДЗ",
            ),
        ),
        migrations.CreateModel(
            name="HomeworkEditHistory",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("changed_fields", models.JSONField(blank=True, default=list, verbose_name="Изменённые поля")),
                ("tasks_added", models.JSONField(blank=True, default=list, verbose_name="Добавленные задания")),
                ("tasks_removed", models.JSONField(blank=True, default=list, verbose_name="Удалённые задания")),
                ("old_due_at", models.DateTimeField(blank=True, null=True, verbose_name="Прежний срок")),
                ("new_due_at", models.DateTimeField(blank=True, null=True, verbose_name="Новый срок")),
                (
                    "previous_score",
                    models.DecimalField(
                        blank=True,
                        decimal_places=2,
                        max_digits=5,
                        null=True,
                        verbose_name="Прежний балл",
                    ),
                ),
                (
                    "previous_result_meta",
                    models.JSONField(
                        blank=True,
                        default=dict,
                        help_text="Компактные метаданные (статус, комментарий, score), без полных файлов.",
                        verbose_name="Снимок результата до правки",
                    ),
                ),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "actor",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="homework_edits",
                        to=settings.AUTH_USER_MODEL,
                        verbose_name="Кто изменил",
                    ),
                ),
                (
                    "homework",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="edit_history",
                        to="Cabinet.homework",
                        verbose_name="Домашнее задание",
                    ),
                ),
            ],
            options={
                "verbose_name": "История правки ДЗ",
                "verbose_name_plural": "История правок ДЗ",
                "ordering": ["-created_at"],
            },
        ),
    ]
