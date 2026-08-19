from django.db import migrations, models
import django.db.models.deletion


def set_demo_duration_40(apps, schema_editor):
    Material = apps.get_model("Cabinet", "Material")
    Material.objects.update(demo_duration_minutes=40)


def noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("Cabinet", "0082_alter_material_access_level_help"),
    ]

    operations = [
        migrations.AddField(
            model_name="material",
            name="cover",
            field=models.ImageField(
                blank=True,
                help_text="Публичное превью. Не заменяет оригинальный файл.",
                null=True,
                upload_to="cabinet/material-covers/",
                verbose_name="Обложка",
            ),
        ),
        migrations.AddField(
            model_name="material",
            name="outline",
            field=models.TextField(
                blank=True,
                help_text="Видно до регистрации. Не даёт сам материал.",
                verbose_name="Содержание / структура",
            ),
        ),
        migrations.AddField(
            model_name="material",
            name="learning_outcomes",
            field=models.TextField(
                blank=True,
                help_text="Для какого класса/предмета и какой результат. Видно анониму.",
                verbose_name="Чему посвящён материал",
            ),
        ),
        migrations.AddField(
            model_name="material",
            name="demo_mode",
            field=models.CharField(
                choices=[
                    ("partial", "Ограниченный фрагмент"),
                    ("full_watermarked", "Весь материал с водяным знаком"),
                ],
                default="full_watermarked",
                help_text="Ограниченный фрагмент или весь материал с водяным знаком. Пользователю технические названия не показываются.",
                max_length=32,
                verbose_name="Режим демоверсии",
            ),
        ),
        migrations.AddField(
            model_name="material",
            name="demo_page_count",
            field=models.PositiveSmallIntegerField(
                default=3,
                help_text="Для режима «ограниченный фрагмент»: сколько первых страниц PDF или экранов отдать.",
                verbose_name="Страниц/экранов в фрагменте",
            ),
        ),
        migrations.AddField(
            model_name="material",
            name="demo_fragment",
            field=models.TextField(
                blank=True,
                help_text="Специально выбранная demo-часть (текст/HTML). Если пусто, для фрагмента берутся первые страницы файла.",
                verbose_name="Фрагмент демоверсии",
            ),
        ),
        migrations.AlterField(
            model_name="material",
            name="demo_duration_minutes",
            field=models.PositiveSmallIntegerField(
                default=40,
                help_text="В этом релизе demo-session всегда 40 минут. Поле сохранено для отображения и будущих настроек.",
                verbose_name="Длительность демо (мин)",
            ),
        ),
        migrations.RunPython(set_demo_duration_40, noop),
        migrations.CreateModel(
            name="MaterialPreviewImage",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("image", models.ImageField(upload_to="cabinet/material-previews/", verbose_name="Изображение")),
                ("caption", models.CharField(blank=True, max_length=255, verbose_name="Подпись")),
                ("sort_order", models.PositiveSmallIntegerField(default=0, verbose_name="Порядок")),
                (
                    "material",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="preview_images",
                        to="Cabinet.material",
                        verbose_name="Материал",
                    ),
                ),
            ],
            options={
                "verbose_name": "Превью материала",
                "verbose_name_plural": "Превью материалов",
                "ordering": ["sort_order", "id"],
            },
        ),
    ]
