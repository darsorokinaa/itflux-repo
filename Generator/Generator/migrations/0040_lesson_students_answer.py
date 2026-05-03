from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("Generator", "0038_lessonroom_lesson_ended_at"),
    ]

    operations = [
        migrations.CreateModel(
            name="LessonStudentsAnswer",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("room_id", models.CharField(blank=True, db_index=True, default="", max_length=200)),
                ("variant_id", models.PositiveIntegerField(db_index=True, default=0)),
                ("task_number", models.CharField(blank=True, default="", max_length=32)),
                ("teacher", models.CharField(blank=True, default="", max_length=200)),
                ("student", models.CharField(blank=True, default="", max_length=200)),
                ("answer", models.TextField(blank=True, default="")),
                ("payload", models.JSONField(blank=True, default=dict)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={
                "verbose_name": "Ответ ученика на уроке",
                "verbose_name_plural": "Ответы учеников на уроке",
                "indexes": [
                    models.Index(fields=["room_id", "variant_id"], name="lesson_answer_room_variant_idx"),
                    models.Index(fields=["variant_id", "task_number"], name="lesson_answer_variant_task_idx"),
                ],
                "constraints": [
                    models.UniqueConstraint(
                        fields=("room_id", "variant_id", "task_number", "student"),
                        name="lesson_answer_unique_per_student_task",
                    ),
                ],
            },
        ),
    ]
