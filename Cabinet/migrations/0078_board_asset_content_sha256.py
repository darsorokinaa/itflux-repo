from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("Cabinet", "0077_homework_submission_unique_homework_student"),
    ]

    operations = [
        migrations.AddField(
            model_name="interactiveboardasset",
            name="content_sha256",
            field=models.CharField(
                blank=True,
                db_index=True,
                default="",
                max_length=64,
                verbose_name="SHA-256 содержимого",
            ),
        ),
    ]
