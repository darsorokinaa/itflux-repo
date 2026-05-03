from django.db import migrations


def seed_subject_math_base(apps, schema_editor):
    Subject = apps.get_model("Generator", "Subject")
    if Subject.objects.filter(subject_short__iexact="math_base").exists():
        return
    Subject.objects.create(
        subject_short="math_base",
        subject_name="Математика базовая",
    )


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("Generator", "0035_seed_subject_history"),
    ]

    operations = [
        migrations.RunPython(seed_subject_math_base, noop_reverse),
    ]
