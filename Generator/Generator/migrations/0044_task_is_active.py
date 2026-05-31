from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("Generator", "0043_alter_announcement_button_url_alter_errorreport_id"),
    ]

    operations = [
        migrations.AddField(
            model_name="task",
            name="is_active",
            field=models.BooleanField(db_index=True, default=True, verbose_name="Активна"),
        ),
    ]
