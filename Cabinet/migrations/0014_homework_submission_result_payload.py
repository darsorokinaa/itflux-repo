from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("Cabinet", "0013_plan_item_resource_attachments"),
    ]

    operations = [
        migrations.AddField(
            model_name="homeworksubmission",
            name="result_payload",
            field=models.JSONField(blank=True, default=dict, verbose_name="Результат варианта"),
        ),
    ]
