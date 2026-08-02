from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("Cabinet", "0049_notification_dispatch_fields"),
    ]

    operations = [
        migrations.AlterField(
            model_name="scheduleeventparticipant",
            name="role",
            field=models.CharField(
                choices=[
                    ("organizer", "Организатор"),
                    ("coteacher", "Соучитель"),
                    ("student", "Ученик"),
                    ("parent", "Родитель"),
                    ("guest", "Гость"),
                ],
                default="student",
                max_length=20,
                verbose_name="Роль",
            ),
        ),
        migrations.AddField(
            model_name="meetingmaterialsession",
            name="follow_policy",
            field=models.CharField(
                choices=[
                    ("strict", "Следовать за учителем"),
                    ("independent", "Самостоятельный просмотр"),
                ],
                default="strict",
                help_text="strict — ученик на странице ведущего; independent — может листать сам",
                max_length=20,
                verbose_name="Следование за ведущим",
            ),
        ),
        migrations.AddField(
            model_name="meetingmaterialsession",
            name="controller",
            field=models.ForeignKey(
                blank=True,
                help_text="Ведущий глобальной позиции (учитель или соучитель)",
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="controlled_meeting_material_sessions",
                to=settings.AUTH_USER_MODEL,
                verbose_name="Кто управляет материалом",
            ),
        ),
        migrations.AddField(
            model_name="meetingmaterialsession",
            name="independent_user_ids",
            field=models.JSONField(
                blank=True,
                default=list,
                help_text="Персональные исключения из strict follow",
                verbose_name="User id в самостоятельном просмотре",
            ),
        ),
        migrations.AlterField(
            model_name="meetingmaterialsession",
            name="interaction_mode",
            field=models.CharField(
                choices=[
                    ("view_only", "Только просмотр"),
                    ("collaborative", "Совместное управление"),
                ],
                default="view_only",
                help_text="view_only / collaborative — рисование и аннотации",
                max_length=20,
                verbose_name="Режим взаимодействия",
            ),
        ),
    ]
