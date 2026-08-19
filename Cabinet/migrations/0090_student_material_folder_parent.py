# Nested student material folders — parent FK, scoped unique name.

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("Cabinet", "0089_sync_activation_event_index_state"),
    ]

    operations = [
        migrations.RemoveConstraint(
            model_name="studentmaterialfolder",
            name="cabinet_unique_student_material_folder_name",
        ),
        migrations.AddField(
            model_name="studentmaterialfolder",
            name="parent",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name="children",
                to="Cabinet.studentmaterialfolder",
                verbose_name="Родительская папка",
            ),
        ),
        migrations.AddConstraint(
            model_name="studentmaterialfolder",
            constraint=models.UniqueConstraint(
                fields=("teacher", "student", "parent", "name"),
                name="cabinet_unique_student_material_folder_name",
            ),
        ),
    ]
