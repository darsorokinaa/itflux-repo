from django.db import migrations


def seed_catalog_plans(apps, schema_editor):
    from Cabinet.catalog_plans import sync_all_catalog_plans

    sync_all_catalog_plans()


def noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("Cabinet", "0098_seed_catalog_math_ege"),
    ]

    operations = [
        migrations.RunPython(seed_catalog_plans, noop),
    ]
