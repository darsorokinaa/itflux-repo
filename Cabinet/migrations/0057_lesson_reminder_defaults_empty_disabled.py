# Empty [] historically meant "use defaults"; now [] means disabled.
# Migrate existing empty lists to the standard intervals so behaviour does not change.

from django.db import migrations


DEFAULT_REMINDERS = [1440, 60, 10]


def forwards(apps, schema_editor):
    NotificationPreference = apps.get_model("Cabinet", "NotificationPreference")
    for prefs in NotificationPreference.objects.all().iterator():
        raw = prefs.lesson_reminder_minutes
        if raw is None or raw == [] or raw == "[]":
            prefs.lesson_reminder_minutes = list(DEFAULT_REMINDERS)
            prefs.save(update_fields=["lesson_reminder_minutes"])


def backwards(apps, schema_editor):
    # No-op: cannot distinguish "never customized" from "explicit defaults".
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("Cabinet", "0056_push_delivery_log_status_max_length"),
    ]

    operations = [
        migrations.RunPython(forwards, backwards),
    ]
