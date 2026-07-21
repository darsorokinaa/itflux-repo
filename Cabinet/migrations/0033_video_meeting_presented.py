from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("Cabinet", "0032_teacher_application"),
    ]

    operations = [
        migrations.AddField(
            model_name="videomeeting",
            name="presented_at",
            field=models.DateTimeField(blank=True, null=True, verbose_name="Показано в"),
        ),
        migrations.AddField(
            model_name="videomeeting",
            name="presented_by",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="presented_video_meetings",
                to=settings.AUTH_USER_MODEL,
                verbose_name="Показал",
            ),
        ),
        migrations.AddField(
            model_name="videomeeting",
            name="presented_kind",
            field=models.CharField(
                blank=True,
                default="",
                help_text="board | variant | пусто",
                max_length=20,
                verbose_name="Показанный ресурс",
            ),
        ),
        migrations.AddField(
            model_name="videomeeting",
            name="presented_payload",
            field=models.JSONField(blank=True, default=dict, verbose_name="Данные показанного ресурса"),
        ),
    ]
