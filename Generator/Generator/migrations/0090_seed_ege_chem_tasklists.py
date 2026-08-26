from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("Generator", "0089_merge_20260819_0932"),
    ]

    operations = [
        migrations.AlterField(
            model_name="tasklist",
            name="task_title",
            field=models.CharField(max_length=255),
        ),
    ]
