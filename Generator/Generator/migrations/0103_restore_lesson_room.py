from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("Generator", "0100_task_ai_candidate"),
    ]

    operations = [
        migrations.CreateModel(
            name="LessonRoom",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("room_id", models.CharField(db_index=True, max_length=200, unique=True)),
                ("jwt_payload", models.JSONField(blank=True, default=dict)),
                (
                    "lesson_ended_at",
                    models.DateTimeField(
                        blank=True,
                        help_text="После установки вход по той же ссылке (комната) запрещён.",
                        null=True,
                        verbose_name="Урок завершён",
                    ),
                ),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={
                "verbose_name": "Комната урока (ЛК)",
                "verbose_name_plural": "Комнаты уроков (ЛК)",
            },
        ),
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
                ("is_correct", models.BooleanField(default=False)),
                ("is_empty", models.BooleanField(default=False)),
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
        migrations.CreateModel(
            name="LessonStudentResult",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("room_id", models.CharField(blank=True, db_index=True, default="", max_length=200)),
                ("variant_id", models.PositiveIntegerField(db_index=True, default=0)),
                ("teacher", models.CharField(blank=True, default="", max_length=200)),
                ("student", models.CharField(blank=True, default="", max_length=200)),
                ("total_tasks", models.PositiveIntegerField(default=0)),
                ("correct_count", models.PositiveIntegerField(default=0)),
                ("wrong_count", models.PositiveIntegerField(default=0)),
                ("empty_count", models.PositiveIntegerField(default=0)),
                ("teacher_comment", models.TextField(blank=True, default="")),
                ("payload", models.JSONField(blank=True, default=dict)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={
                "verbose_name": "Результат ученика в уроке",
                "verbose_name_plural": "Результаты учеников в уроке",
                "indexes": [
                    models.Index(fields=["room_id", "variant_id"], name="lesson_result_room_variant_idx"),
                    models.Index(fields=["room_id", "student"], name="lesson_result_room_student_idx"),
                ],
                "constraints": [
                    models.UniqueConstraint(
                        fields=("room_id", "variant_id", "student"),
                        name="lesson_result_unique_per_student",
                    ),
                ],
            },
        ),
    ]
