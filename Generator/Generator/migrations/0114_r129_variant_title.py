from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("Generator", "0113_r77_ege_math_profile_scale_2026")]

    operations = [
        migrations.AddField(
            model_name="variant",
            name="title",
            field=models.CharField("Название (учитель)", max_length=120, blank=True, default=""),
        ),
    ]
