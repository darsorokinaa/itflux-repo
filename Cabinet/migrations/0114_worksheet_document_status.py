from django.db import migrations, models


def mark_generated_sheets(apps, schema_editor):
    generation = apps.get_model("Cabinet", "WorksheetAIGeneration")
    document = apps.get_model("Cabinet", "WorksheetDocument")
    ids = list(
        generation.objects.exclude(worksheet_id=None).values_list("worksheet_id", flat=True)
    )
    if ids:
        document.objects.filter(pk__in=ids).update(status="saved")


class Migration(migrations.Migration):

    dependencies = [
        ("Cabinet", "0113_worksheet_ai_quality"),
    ]

    operations = [
        migrations.AddField(
            model_name="worksheetdocument",
            name="status",
            field=models.CharField(
                choices=[("draft", "Черновик"), ("saved", "Сохранено")],
                db_index=True,
                default="draft",
                max_length=16,
                verbose_name="Статус",
            ),
        ),
        migrations.RunPython(mark_generated_sheets, migrations.RunPython.noop),
    ]
