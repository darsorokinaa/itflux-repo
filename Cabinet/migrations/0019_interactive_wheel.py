from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("Cabinet", "0018_interactive_sound_files"),
    ]

    operations = [
        migrations.AddField(
            model_name="interactive",
            name="wheel_settings",
            field=models.JSONField(blank=True, default=dict, verbose_name="Настройки колеса"),
        ),
        migrations.CreateModel(
            name="WheelSegment",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("external_id", models.CharField(blank=True, max_length=64, verbose_name="ID сектора")),
                ("title", models.CharField(max_length=255, verbose_name="Название")),
                ("description", models.TextField(blank=True, verbose_name="Описание")),
                ("color", models.CharField(default="#2563EB", max_length=20, verbose_name="Цвет")),
                ("points", models.IntegerField(default=0, verbose_name="Баллы")),
                ("order", models.PositiveIntegerField(default=0, verbose_name="Порядок")),
                (
                    "interactive",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="wheel_segments",
                        to="Cabinet.interactive",
                        verbose_name="Интерактив",
                    ),
                ),
            ],
            options={
                "verbose_name": "Сектор колеса",
                "verbose_name_plural": "Сектора колеса",
                "ordering": ["order", "id"],
            },
        ),
    ]
