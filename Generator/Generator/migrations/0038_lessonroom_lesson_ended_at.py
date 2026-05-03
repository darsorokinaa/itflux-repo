from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("Generator", "0037_lesson_room"),
    ]

    operations = [
        migrations.AddField(
            model_name="lessonroom",
            name="lesson_ended_at",
            field=models.DateTimeField(
                blank=True,
                help_text="После установки вход по той же ссылке (комната) запрещён.",
                null=True,
                verbose_name="Урок завершён",
            ),
        ),
    ]
