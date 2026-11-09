from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("Generator", "0117_task_answer_spec"),
    ]

    operations = [
        migrations.AddField(
            model_name="seasonaltheme",
            name="dark_background",
            field=models.BooleanField(
                default=False,
                help_text=(
                    "Включите, если цвет фона тёмный (например #8E2632). "
                    "Текст шапки, меню, заголовков страницы, подвала и ссылок вне карточек станет светлым. "
                    "Текст внутри карточек, таблиц, заданий, формул и кода остаётся тёмным."
                ),
                verbose_name="Тёмный фон",
            ),
        ),
    ]
