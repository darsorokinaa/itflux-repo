from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("Generator", "0036_seed_subject_math_base"),
    ]

    operations = [
        migrations.CreateModel(
            name="LessonRoom",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("room_id", models.CharField(db_index=True, max_length=200, unique=True)),
                ("jwt_payload", models.JSONField(blank=True, default=dict)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={
                "verbose_name": "Комната урока (ЛК)",
                "verbose_name_plural": "Комнаты уроков (ЛК)",
            },
        ),
    ]
