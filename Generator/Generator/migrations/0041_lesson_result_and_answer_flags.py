from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("Generator", "0040_lesson_students_answer"),
    ]

    operations = [
        migrations.AddField(
            model_name="lessonstudentsanswer",
            name="is_correct",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="lessonstudentsanswer",
            name="is_empty",
            field=models.BooleanField(default=False),
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
