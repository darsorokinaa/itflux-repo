"""Заполняет каталог тарифов, если в БД нет Старт/Учитель/Профи/Премиум."""

from django.db import migrations


def seed_if_missing(apps, schema_editor):
    TariffPlan = apps.get_model("Cabinet", "TariffPlan")
    required = {"start", "teacher", "pro", "premium"}
    existing = set(TariffPlan.objects.filter(slug__in=required).values_list("slug", flat=True))
    if existing.issuperset(required):
        return
    # Каталог берётся из текущего кода, но записываются только поля,
    # которые уже есть в этой миграции. Иначе свежая база падает на
    # столбцах, добавленных позже (например ai_images_monthly_limit).
    from Cabinet.management.commands.seed_tariffs import TARIFFS

    field_names = {field.name for field in TariffPlan._meta.concrete_fields}
    for raw in TARIFFS:
        slug = raw["slug"]
        defaults = {
            key: value
            for key, value in raw.items()
            if key != "slug" and key in field_names
        }
        TariffPlan.objects.update_or_create(slug=slug, defaults=defaults)


def noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("Cabinet", "0073_deactivate_launch_premium_registration_promo"),
    ]

    operations = [
        migrations.RunPython(seed_if_missing, noop),
    ]
