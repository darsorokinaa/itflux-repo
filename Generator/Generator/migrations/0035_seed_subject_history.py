from django.db import migrations


def seed_subject_history(apps, schema_editor):
    Subject = apps.get_model("Generator", "Subject")
    if Subject.objects.filter(subject_short__iexact="history").exists():
        return
    Subject.objects.create(subject_short="history", subject_name="История")


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("Generator", "0034_error_report"),
    ]

    operations = [
        migrations.RunPython(seed_subject_history, noop_reverse),
    ]
