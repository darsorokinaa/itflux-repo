from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("Cabinet", "0103_teacher_task_bank_entitlements"),
    ]

    operations = [
        migrations.AddField(
            model_name="meetingscreensharesession",
            name="show_author_names",
            field=models.BooleanField(default=False, verbose_name="Показывать имена авторов"),
        ),
    ]
