"""Неактивный пример сезонной темы (не включается автоматически)."""

from django.db import migrations


def seed_example(apps, schema_editor):
    SeasonalTheme = apps.get_model("Generator", "SeasonalTheme")
    if SeasonalTheme.objects.filter(slug="example-new-year").exists():
        return
    SeasonalTheme.objects.create(
        name="Пример: Новогоднее оформление",
        slug="example-new-year",
        description=(
            "Неактивный пример. Включите тему в админке, задайте даты и загрузите паттерны. "
            "По умолчанию не применяется на сайте."
        ),
        is_active=False,
        is_draft=True,
        priority=10,
        allow_user_disable=True,
        allow_manual_selection=True,
        is_default_seasonal_theme=True,
        background_color="#F7FAFC",
        background_repeat="repeat",
        background_size="240px",
        background_opacity=0.18,
        animation_type="snow",
        animation_intensity="minimal",
        animation_max_elements=20,
        exclude_routes=["/cabinet/boards", "/teacher/boards", "/cabinet/meetings", "/lessons"],
        surfaces={
            "task_card": {
                "border_color": "#BBD8F2",
                "accent_color": "#4D8FC9",
                "pattern_opacity": 0.12,
            },
            "accent": {"accent_color": "#4D8FC9"},
        },
    )


def unseed(apps, schema_editor):
    SeasonalTheme = apps.get_model("Generator", "SeasonalTheme")
    SeasonalTheme.objects.filter(slug="example-new-year", is_draft=True, is_active=False).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("Generator", "0074_seasonal_themes"),
    ]

    operations = [
        migrations.RunPython(seed_example, unseed),
    ]
