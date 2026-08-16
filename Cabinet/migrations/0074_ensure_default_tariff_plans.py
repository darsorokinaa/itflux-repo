"""Заполняет каталог тарифов, если в БД нет Старт/Учитель/Профи/Премиум."""

from django.db import migrations


def seed_if_missing(apps, schema_editor):
    TariffPlan = apps.get_model("Cabinet", "TariffPlan")
    required = {"start", "teacher", "pro", "premium"}
    existing = set(TariffPlan.objects.filter(slug__in=required).values_list("slug", flat=True))
    if existing.issuperset(required):
        return
    from Cabinet.management.commands.seed_tariffs import apply_tariff_catalog

    apply_tariff_catalog()


def noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("Cabinet", "0073_deactivate_launch_premium_registration_promo"),
    ]

    operations = [
        migrations.RunPython(seed_if_missing, noop),
    ]
