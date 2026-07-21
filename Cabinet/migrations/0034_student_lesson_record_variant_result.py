from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("Cabinet", "0033_video_meeting_presented"),
    ]

    operations = [
        migrations.AddField(
            model_name="studentlessonrecord",
            name="variant_result",
            field=models.JSONField(
                blank=True,
                default=dict,
                help_text="Подробные ответы live-варианта: задания, ответы ученика, верно/неверно, %",
                verbose_name="Результат варианта на уроке",
            ),
        ),
    ]
