"""Сохраняет прежний вид маршрута, у которого цвет был только запасным.

Раньше тип color не рисовался: страница всегда получала градиент
#9fc8e4 → #e7f3fb. Переносим ровно эту заготовку в явный градиент,
чтобы выбранные позже другие цвета остались цветом.
"""

from django.db import migrations


LEGACY_COLOR = "#e7f3fb"
ROUTE_GRADIENT = {
    "type": "gradient",
    "colors": ["#9fc8e4", "#c5e0f2", "#e7f3fb"],
    "direction": "vertical",
}


def preserve_legacy_route_gradient(apps, schema_editor):
    VariantTheme = apps.get_model("Generator", "VariantTheme")
    for theme in VariantTheme.objects.all().iterator():
        config = theme.config if isinstance(theme.config, dict) else None
        if not config:
            continue
        background = config.get("background")
        if not isinstance(background, dict):
            continue
        if str(background.get("type") or "").strip().lower() != "color":
            continue
        if str(background.get("color") or "").strip().lower() != LEGACY_COLOR:
            continue
        if set(background.keys()) - {"type", "color"}:
            continue
        updated = dict(config)
        updated["background"] = dict(ROUTE_GRADIENT)
        theme.config = updated
        theme.save(update_fields=["config"])


class Migration(migrations.Migration):

    dependencies = [
        ("Generator", "0105_varianttheme_sheet_background_image"),
    ]

    operations = [
        migrations.RunPython(preserve_legacy_route_gradient, migrations.RunPython.noop),
    ]
