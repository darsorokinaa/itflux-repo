import Generator.variant_theme_models
from django.db import migrations, models
import django.db.models.deletion

import Generator.variant_theme_service as variant_theme_service


def seed_travel_theme(apps, schema_editor):
    VariantTheme = apps.get_model("Generator", "VariantTheme")
    if VariantTheme.objects.filter(slug="travel").exists():
        return
    VariantTheme.objects.create(
        name="Путешествие",
        slug="travel",
        description="Маршрут по заданиям: остановки, облака и самолёт. Не мешает решению задач.",
        layout_type="route",
        config=variant_theme_service.TRAVEL_CONFIG,
        is_active=True,
        is_published=False,
    )


def unseed_travel_theme(apps, schema_editor):
    VariantTheme = apps.get_model("Generator", "VariantTheme")
    VariantTheme.objects.filter(slug="travel").delete()


class Migration(migrations.Migration):

    dependencies = [
        ("Generator", "0094_task_exam_part_attachment"),
    ]

    operations = [
        migrations.CreateModel(
            name="VariantTheme",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("name", models.CharField(max_length=160, verbose_name="Название")),
                ("slug", models.SlugField(max_length=80, unique=True, verbose_name="Код")),
                ("description", models.TextField(blank=True, default="", verbose_name="Описание")),
                (
                    "layout_type",
                    models.CharField(
                        choices=[
                            ("classic", "Классический"),
                            ("cards", "Карточки"),
                            ("route", "Маршрут"),
                            ("game", "Игровой"),
                        ],
                        db_index=True,
                        default="classic",
                        max_length=32,
                        verbose_name="Макет",
                    ),
                ),
                (
                    "config",
                    models.JSONField(
                        blank=True,
                        default=dict,
                        help_text="labels, decorations, animation, background. Без HTML/JS.",
                        verbose_name="Конфигурация",
                    ),
                ),
                (
                    "preview_image",
                    models.ImageField(
                        blank=True,
                        null=True,
                        upload_to=Generator.variant_theme_models.variant_theme_upload_to,
                        verbose_name="Превью",
                    ),
                ),
                (
                    "background_image",
                    models.ImageField(
                        blank=True,
                        null=True,
                        upload_to=Generator.variant_theme_models.variant_theme_upload_to,
                        verbose_name="Фон",
                    ),
                ),
                (
                    "is_active",
                    models.BooleanField(
                        db_index=True,
                        default=True,
                        help_text="Выключенная тема не применяется к варианту (классическое оформление).",
                        verbose_name="Активна",
                    ),
                ),
                (
                    "is_published",
                    models.BooleanField(
                        db_index=True,
                        default=False,
                        help_text="Показывать в пользовательском каталоге, когда выбор тем откроют учителям.",
                        verbose_name="Опубликована",
                    ),
                ),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={
                "verbose_name": "Тема варианта",
                "verbose_name_plural": "Темы вариантов",
                "ordering": ["name", "id"],
            },
        ),
        migrations.AddField(
            model_name="variant",
            name="theme",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="variants",
                to="Generator.varianttheme",
                verbose_name="Тема оформления",
            ),
        ),
        migrations.RunPython(seed_travel_theme, unseed_travel_theme),
    ]
