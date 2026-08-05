import Generator.seasonal_theme_models
from django.db import migrations, models


HONEY_HISTORY_TITLE = "Медовый Спас: история и традиции"

HONEY_HISTORY_BODY = (
    "Медовый Спас ежегодно отмечают 14 августа. В православном календаре этот день "
    "связан с празднеством Всемилостивому Спасу и Пресвятой Богородице, а также с "
    "Изнесением Честных Древ Животворящего Креста Господня. С этой даты начинается "
    "Успенский пост.\n"
    "\n"
    "Народное название появилось потому, что к середине августа обычно завершался "
    "основной сбор мёда. Пасечники приносили мёд нового урожая в храм для освящения, "
    "после чего им угощали близких, детей и нуждающихся.\n"
    "\n"
    "Праздник также называли Спасом на воде. В этот день освящали колодцы, родники и "
    "водоёмы, проводили крестные ходы и малое водосвятие.\n"
    "\n"
    "Ещё одно народное название — Маковей, или Маковый Спас. В это время начинали "
    "собирать мак и готовили постные блюда: медовые пряники, коврижки, блины, пироги "
    "с маком и медовый квас.\n"
    "\n"
    "Главный смысл праздника — благодарность Богу за урожай, забота о ближних и "
    "начало короткого, но строгого Успенского поста."
)


def seed_honey_history(apps, schema_editor):
    SeasonalTheme = apps.get_model("Generator", "SeasonalTheme")
    SeasonalTheme.objects.filter(slug="medovyj-spas").update(
        hero_history_title=HONEY_HISTORY_TITLE,
        hero_history_body=HONEY_HISTORY_BODY,
        hero_history_link_label="Узнать историю праздника",
    )
    try:
        from Generator.seasonal_theme_service import invalidate_seasonal_theme_cache

        invalidate_seasonal_theme_cache()
    except Exception:
        pass


def unseed_honey_history(apps, schema_editor):
    SeasonalTheme = apps.get_model("Generator", "SeasonalTheme")
    SeasonalTheme.objects.filter(slug="medovyj-spas").update(
        hero_history_title="",
        hero_history_body="",
        hero_history_link_label="Узнать историю праздника",
    )


class Migration(migrations.Migration):

    dependencies = [
        ("Generator", "0079_seasonal_theme_hero_sticker"),
    ]

    operations = [
        migrations.AddField(
            model_name="seasonaltheme",
            name="hero_history_title",
            field=models.CharField(
                blank=True,
                default="",
                help_text="Заголовок модального окна. Пусто — справка скрыта.",
                max_length=160,
                verbose_name="Историческая справка: заголовок",
            ),
        ),
        migrations.AddField(
            model_name="seasonaltheme",
            name="hero_history_body",
            field=models.TextField(
                blank=True,
                default="",
                help_text="Текст модалки. Абзацы разделяйте пустой строкой.",
                verbose_name="Историческая справка: текст",
            ),
        ),
        migrations.AddField(
            model_name="seasonaltheme",
            name="hero_history_link_label",
            field=models.CharField(
                blank=True,
                default="Узнать историю праздника",
                help_text="Подпись ссылки рядом со стикером.",
                max_length=80,
                verbose_name="Историческая справка: ссылка",
            ),
        ),
        migrations.AddField(
            model_name="seasonaltheme",
            name="hero_history_icon",
            field=models.ImageField(
                blank=True,
                help_text="Небольшая тематическая иконка (банка мёда, соты, пчела). Необязательно.",
                null=True,
                upload_to=Generator.seasonal_theme_models.seasonal_theme_upload_to,
                verbose_name="Историческая справка: иконка",
            ),
        ),
        migrations.RunPython(seed_honey_history, unseed_honey_history),
    ]
