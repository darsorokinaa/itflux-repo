from django.db import migrations


def seed_catalog_plans(apps, schema_editor):
    import sys
    if "test" in sys.argv:  # сид на живых моделях не работает на чистой тестовой БД (r40)
        return
    from Cabinet.catalog_plans import sync_all_catalog_plans

    sync_all_catalog_plans()


def noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("Cabinet", "0097_seed_catalog_rus_oge"),
    ]

    operations = [
        migrations.RunPython(seed_catalog_plans, noop),
    ]
