# Generated manually for collaboration_permission on MeetingMaterialSession

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("Cabinet", "0060_seasonal_themes"),
    ]

    operations = [
        migrations.AddField(
            model_name="meetingmaterialsession",
            name="collaboration_permission",
            field=models.CharField(
                choices=[
                    ("answers_only", "Только ответы"),
                    ("annotate", "Комментарии и рисование"),
                    ("edit_content", "Редактирование содержимого"),
                    ("full", "Полный совместный доступ"),
                ],
                default="annotate",
                help_text="answers_only | annotate | edit_content | full",
                max_length=32,
                verbose_name="Уровень прав совместной работы",
            ),
        ),
    ]
