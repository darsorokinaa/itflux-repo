from django.db import migrations, models
from django.db.models import Q


def cancel_duplicate_enrollments(apps, schema_editor):
    LessonPlanEnrollment = apps.get_model("Cabinet", "LessonPlanEnrollment")
    groups = {}
    qs = LessonPlanEnrollment.objects.filter(status__in=["active", "paused"]).order_by("id")
    for enrollment in qs:
        if enrollment.student_id and enrollment.student_subject_id:
            key = ("subject", enrollment.teacher_id, enrollment.student_id, enrollment.student_subject_id)
        elif enrollment.student_id:
            key = ("unbound", enrollment.teacher_id, enrollment.student_id)
        elif enrollment.group_id:
            key = ("group", enrollment.teacher_id, enrollment.group_id)
        else:
            continue
        groups.setdefault(key, []).append(enrollment)

    for rows in groups.values():
        if len(rows) < 2:
            continue
        canonical = max(rows, key=lambda row: (row.created_at, row.pk))
        for row in rows:
            if row.pk == canonical.pk:
                continue
            row.status = "cancelled"
            extra = f"[dedupe] дубль активного назначения, каноническое #{canonical.pk}"
            row.notes = f"{row.notes}\n{extra}".strip() if row.notes else extra
            row.save(update_fields=["status", "notes", "updated_at"])


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("Cabinet", "0091_meeting_technical_event"),
    ]

    operations = [
        migrations.RunPython(cancel_duplicate_enrollments, noop_reverse),
        migrations.AddConstraint(
            model_name="lessonplanenrollment",
            constraint=models.UniqueConstraint(
                condition=Q(
                    status__in=("active", "paused"),
                    student__isnull=False,
                    student_subject__isnull=False,
                ),
                fields=("teacher", "student", "student_subject"),
                name="cabinet_uniq_active_enrollment_student_subject",
            ),
        ),
        migrations.AddConstraint(
            model_name="lessonplanenrollment",
            constraint=models.UniqueConstraint(
                condition=Q(
                    status__in=("active", "paused"),
                    student__isnull=False,
                    student_subject__isnull=True,
                ),
                fields=("teacher", "student"),
                name="cabinet_uniq_active_enrollment_student_unbound",
            ),
        ),
        migrations.AddConstraint(
            model_name="lessonplanenrollment",
            constraint=models.UniqueConstraint(
                condition=Q(
                    status__in=("active", "paused"),
                    group__isnull=False,
                ),
                fields=("teacher", "group"),
                name="cabinet_uniq_active_enrollment_group",
            ),
        ),
    ]
