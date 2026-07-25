from django.db import migrations


def forwards(apps, schema_editor):
    # Логика в модуле, чтобы не дублировать и можно было гонять командой.
    from Cabinet.homework_backfill import backfill_unsubmitted_homework_with_answers

    stats = backfill_unsubmitted_homework_with_answers(dry_run=False)
    print(
        " backfill homework submitted_at: "
        f"scanned={stats['scanned']} with_work={stats['with_work']} "
        f"submitted_at_set={stats['submitted_at_set']} "
        f"review_created={stats['review_created']} "
        f"review_exists={stats['review_exists']} "
        f"skipped_live={stats.get('skipped_live', 0)}"
    )


class Migration(migrations.Migration):

    dependencies = [
        ("Cabinet", "0039_teacher_community_feedback"),
    ]

    operations = [
        migrations.RunPython(forwards, migrations.RunPython.noop),
    ]
