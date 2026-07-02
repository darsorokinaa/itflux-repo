from django.db import migrations, models


def backfill_plan_subject(apps, schema_editor):
    LessonPlan = apps.get_model("Cabinet", "LessonPlan")
    for plan in LessonPlan.objects.all().only("pk", "direction", "subject"):
        if plan.direction == "school":
            plan.subject = "math"
        elif not plan.subject:
            plan.subject = "informatics"
        plan.save(update_fields=["subject"])


class Migration(migrations.Migration):

    dependencies = [
        ("Cabinet", "0020_interactive_sound_background"),
    ]

    operations = [
        migrations.AddField(
            model_name="lessonplan",
            name="subject",
            field=models.CharField(
                choices=[
                    ("informatics", "Информатика"),
                    ("math", "Математика"),
                    ("other", "Другое"),
                ],
                default="informatics",
                max_length=20,
                verbose_name="Предмет",
            ),
        ),
        migrations.RunPython(backfill_plan_subject, migrations.RunPython.noop),
    ]
