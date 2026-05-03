# Generated manually

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("Generator", "0028_criteria"),
    ]

    operations = [
        migrations.CreateModel(
            name="Announcement",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("title", models.CharField(max_length=255, verbose_name="Заголовок")),
                ("body", models.TextField(blank=True, verbose_name="Текст")),
                ("button_label", models.CharField(blank=True, max_length=120, verbose_name="Подпись кнопки")),
                ("button_url", models.CharField(blank=True, max_length=500, verbose_name="Ссылка кнопки")),
                (
                    "accent",
                    models.CharField(
                        choices=[
                            ("default", "Синий"),
                            ("violet", "Фиолетовый"),
                            ("teal", "Бирюзовый"),
                            ("amber", "Тёплый"),
                        ],
                        default="default",
                        max_length=20,
                        verbose_name="Акцент",
                    ),
                ),
                ("show", models.BooleanField(default=True, verbose_name="Показывать")),
                (
                    "sort_order",
                    models.PositiveSmallIntegerField(
                        default=0,
                        help_text="Чем меньше число, тем выше объявление в списке",
                        verbose_name="Порядок",
                    ),
                ),
                ("created", models.DateTimeField(auto_now_add=True, verbose_name="Создано")),
            ],
            options={
                "verbose_name": "Объявление",
                "verbose_name_plural": "Объявления",
                "ordering": ["sort_order", "-created"],
            },
        ),
    ]
