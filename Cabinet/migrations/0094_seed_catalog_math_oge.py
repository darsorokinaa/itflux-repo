from django.db import migrations


def seed_catalog_plans(apps, schema_editor):
    # Сид использует живые модели (не исторические): на чистой тестовой БД
    # колонки из более поздних миграций ещё нет. В тестах сид не нужен (r40).
    import sys
    if "test" in sys.argv:
        return
    from Cabinet.catalog_plans import sync_all_catalog_plans

    sync_all_catalog_plans()


def noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("Cabinet", "0093_lessonplan_is_public"),
    ]

    operations = [
        migrations.RunPython(seed_catalog_plans, noop),
    ]
