from django.db import migrations


def forwards(apps, schema_editor):
    from Cabinet.homework_backfill import cleanup_live_meeting_review_items

    stats = cleanup_live_meeting_review_items(dry_run=False)
    print(
        " cleanup live-meeting review items: "
        f"deleted={stats['deleted']} review_ids={stats['review_ids']}"
    )


class Migration(migrations.Migration):

    dependencies = [
        ("Cabinet", "0040_backfill_homework_submitted_at"),
    ]

    operations = [
        migrations.RunPython(forwards, migrations.RunPython.noop),
    ]
