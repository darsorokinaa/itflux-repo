from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("Cabinet", "0117_one_worksheet_draft"),
    ]

    operations = [
        migrations.AddField(
            model_name="lessonplanenrollment",
            name="weekday_slots",
            field=models.JSONField(
                blank=True,
                default=list,
                help_text="Список {weekday, start_time, duration_minutes}. День недели занятия считается по дате.",
                verbose_name="Слоты по дням недели",
            ),
        ),
        migrations.AddField(
            model_name="scheduleevent",
            name="status_reason",
            field=models.CharField(
                blank=True,
                help_text="Причина отмены, пропуска или восстановления. Не заменяет учебные данные.",
                max_length=500,
                verbose_name="Причина статуса",
            ),
        ),
    ]
