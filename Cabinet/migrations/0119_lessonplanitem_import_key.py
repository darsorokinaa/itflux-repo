from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("Cabinet", "0118_plan_weekday_slots_and_status_reason"),
    ]

    operations = [
        migrations.AddField(
            model_name="lessonplanitem",
            name="import_key",
            field=models.CharField(
                blank=True,
                db_index=True,
                help_text="Скрытый код строки Excel. Повторная загрузка того же файла узнаёт новое занятие и не создаёт копию.",
                max_length=80,
                verbose_name="Ключ импорта",
            ),
        ),
    ]
