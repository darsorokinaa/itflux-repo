from django.db import migrations


def forwards(apps, schema_editor):
    # Нельзя импортировать текущие модели: на свежей БД колонки из поздних
    # миграций ещё нет. Исторический бэкфилл для пустых/тестовых БД не нужен.
    return


class Migration(migrations.Migration):

    dependencies = [
        ("Cabinet", "0039_teacher_community_feedback"),
    ]

    operations = [
        migrations.RunPython(forwards, migrations.RunPython.noop),
    ]
