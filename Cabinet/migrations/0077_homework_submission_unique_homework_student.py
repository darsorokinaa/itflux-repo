from django.db import migrations, models
from django.db.models import Count


def _reject_if_duplicates(apps, schema_editor):
    HomeworkSubmission = apps.get_model("Cabinet", "HomeworkSubmission")
    dup_count = (
        HomeworkSubmission.objects.values("homework_id", "student_id")
        .annotate(c=Count("id"))
        .filter(c__gt=1)
        .count()
    )
    if dup_count:
        raise RuntimeError(
            "Нельзя добавить UniqueConstraint(homework, student): "
            f"найдено {dup_count} групп дублей. "
            "Сначала: python manage.py audit_homework_submission_duplicates"
        )


class Migration(migrations.Migration):

    dependencies = [
        ("Cabinet", "0076_rename_cabinet_mee_meeting_ss_idx_cabinet_mee_meeting_a507c2_idx"),
    ]

    operations = [
        migrations.RunPython(_reject_if_duplicates, migrations.RunPython.noop),
        migrations.AddConstraint(
            model_name="homeworksubmission",
            constraint=models.UniqueConstraint(
                fields=("homework", "student"),
                name="cabinet_unique_homework_student_submission",
            ),
        ),
    ]
