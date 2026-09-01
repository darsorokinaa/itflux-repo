import Generator.seasonal_theme_models
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("Generator", "0091_subtopic_title_max_length"),
    ]

    operations = [
        migrations.AddField(
            model_name="seasonaltheme",
            name="meeting_header_decor",
            field=models.ImageField(
                blank=True,
                help_text=(
                    "Картинка на верхней панели видеозвонка и интерактивной доски. "
                    "Если пусто — берётся «Декор верхней панели»."
                ),
                null=True,
                upload_to=Generator.seasonal_theme_models.seasonal_theme_upload_to,
                verbose_name="Декор шапки звонка и доски",
            ),
        ),
        migrations.AlterField(
            model_name="seasonaltheme",
            name="header_decor",
            field=models.ImageField(
                blank=True,
                help_text=(
                    "Картинка в шапке кабинета. Если для звонка не загружено своё фото — используется и там."
                ),
                null=True,
                upload_to=Generator.seasonal_theme_models.seasonal_theme_upload_to,
                verbose_name="Декор верхней панели",
            ),
        ),
        migrations.AlterField(
            model_name="seasonalthemedecoration",
            name="zone",
            field=models.CharField(
                choices=[
                    ("page_background", "Общий фон страницы"),
                    ("top_bar", "Верхняя панель"),
                    ("sidebar", "Боковое меню"),
                    ("task_cards", "Карточки задач"),
                    ("lesson_cards", "Карточки уроков"),
                    ("dashboard", "Дашборд"),
                    ("catalog", "Каталог"),
                    ("profile", "Профиль"),
                    ("login", "Экран входа"),
                    ("video_meeting", "Видеозвонок и доска"),
                    ("custom_routes", "Конкретные маршруты"),
                ],
                default="page_background",
                max_length=32,
                verbose_name="Зона отображения",
            ),
        ),
    ]
