from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("Cabinet", "0011_split_lessonplan_enrollment"),
    ]

    operations = [
        migrations.AddField(
            model_name="lessonplanenrollment",
            name="plan_start_order",
            field=models.PositiveIntegerField(
                default=1,
                help_text="Номер урока в плане, с которого начинается прохождение (1 = с первого)",
                verbose_name="Начать с урока плана",
            ),
        ),
        migrations.AddField(
            model_name="scheduleevent",
            name="plan_cancel_action",
            field=models.CharField(
                blank=True,
                choices=[
                    ("shift", "Перенести тему на следующее занятие"),
                    ("skip", "Пропустить тему для ученика"),
                ],
                max_length=8,
                verbose_name="Действие с темой плана при отмене",
            ),
        ),
    ]
