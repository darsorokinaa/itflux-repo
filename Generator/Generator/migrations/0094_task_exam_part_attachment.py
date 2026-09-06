from django.db import migrations, models
import django.db.models.deletion
import Generator.models


class Migration(migrations.Migration):

    dependencies = [
        ("Generator", "0093_teacher_task_bank"),
    ]

    operations = [
        migrations.AddField(
            model_name="task",
            name="exam_part",
            field=models.PositiveSmallIntegerField(
                blank=True,
                choices=[(1, "Первая часть"), (2, "Вторая часть")],
                db_index=True,
                help_text="1 — первая часть, 2 — вторая. Пусто, если не экзамен или не указано.",
                null=True,
                verbose_name="Часть экзамена",
            ),
        ),
        migrations.CreateModel(
            name="TaskAttachment",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("file", models.FileField(upload_to=Generator.models.teacher_task_attachment_upload_to)),
                ("original_name", models.CharField(blank=True, max_length=255)),
                ("size", models.PositiveIntegerField(default=0)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "task",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="attachments",
                        to="Generator.task",
                    ),
                ),
            ],
            options={
                "ordering": ["id"],
                "verbose_name": "Вложение задачи",
                "verbose_name_plural": "Вложения задач",
            },
        ),
    ]
