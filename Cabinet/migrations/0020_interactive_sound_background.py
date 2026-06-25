from django.db import migrations, models
import Cabinet.models


class Migration(migrations.Migration):

    dependencies = [
        ("Cabinet", "0019_interactive_wheel"),
    ]

    operations = [
        migrations.AddField(
            model_name="interactivesoundpack",
            name="sound_background",
            field=models.FileField(
                blank=True,
                help_text="Фоновая музыка или ambient — проигрывается по кругу во время интерактива",
                null=True,
                upload_to=Cabinet.models.interactive_sound_upload_to,
                verbose_name="Фоновый",
            ),
        ),
    ]
