from django.db import migrations, models


def collapse_drafts(apps, schema_editor):
    document = apps.get_model("Cabinet", "WorksheetDocument")
    seen = set()
    drop = []
    rows = document.objects.filter(status="draft").order_by("teacher_id", "-updated_at")
    for row in rows.iterator():
        if row.teacher_id in seen:
            drop.append(row.pk)
        else:
            seen.add(row.teacher_id)
    if drop:
        document.objects.filter(pk__in=drop).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("Cabinet", "0116_worksheet_assembly_free"),
    ]

    operations = [
        migrations.RunPython(collapse_drafts, migrations.RunPython.noop),
        migrations.AddConstraint(
            model_name="worksheetdocument",
            constraint=models.UniqueConstraint(
                condition=models.Q(status="draft"),
                fields=("teacher",),
                name="ws_doc_one_draft_per_teacher",
            ),
        ),
    ]
