from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("Generator", "0099_collection_files_variants"),
    ]

    operations = [
        migrations.AddField(
            model_name="task",
            name="ai_candidate_id",
            field=models.PositiveIntegerField(
                blank=True,
                db_index=True,
                help_text="Заполняется, когда проверенное AI-задание становится обычной задачей банка.",
                null=True,
                verbose_name="ID исходного AI-задания",
            ),
        ),
        migrations.AddConstraint(
            model_name="task",
            constraint=models.UniqueConstraint(
                condition=models.Q(ai_candidate_id__isnull=False),
                fields=("ai_candidate_id",),
                name="task_ai_candidate_uniq",
            ),
        ),
    ]
