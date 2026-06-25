from django.db import migrations, models
import Cabinet.models


class Migration(migrations.Migration):

    dependencies = [
        ("Cabinet", "0017_quiz_questions"),
    ]

    operations = [
        migrations.AlterField(
            model_name="interactivesoundpack",
            name="config",
            field=models.JSONField(
                blank=True,
                default=dict,
                help_text="Fallback-профили: flip, correct, wrong, next, end (freq/type/duration/volume)",
                verbose_name="Настройки звуков (синтез)",
            ),
        ),
        migrations.AddField(
            model_name="interactivesoundpack",
            name="sound_correct",
            field=models.FileField(
                blank=True,
                null=True,
                upload_to=Cabinet.models.interactive_sound_upload_to,
                verbose_name="Правильно",
            ),
        ),
        migrations.AddField(
            model_name="interactivesoundpack",
            name="sound_end",
            field=models.FileField(
                blank=True,
                null=True,
                upload_to=Cabinet.models.interactive_sound_upload_to,
                verbose_name="Конец",
            ),
        ),
        migrations.AddField(
            model_name="interactivesoundpack",
            name="sound_flip",
            field=models.FileField(
                blank=True,
                null=True,
                upload_to=Cabinet.models.interactive_sound_upload_to,
                verbose_name="Переворот",
            ),
        ),
        migrations.AddField(
            model_name="interactivesoundpack",
            name="sound_next",
            field=models.FileField(
                blank=True,
                null=True,
                upload_to=Cabinet.models.interactive_sound_upload_to,
                verbose_name="Следующий",
            ),
        ),
        migrations.AddField(
            model_name="interactivesoundpack",
            name="sound_wrong",
            field=models.FileField(
                blank=True,
                null=True,
                upload_to=Cabinet.models.interactive_sound_upload_to,
                verbose_name="Неправильно",
            ),
        ),
    ]
