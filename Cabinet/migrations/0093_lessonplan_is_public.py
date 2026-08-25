from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


def mark_legacy_catalog_plans(apps, schema_editor):
    """Старые шаблоны каталога хранились как teacher=NULL — помечаем is_public=True."""
    LessonPlan = apps.get_model("Cabinet", "LessonPlan")
    LessonPlan.objects.filter(teacher__isnull=True).update(is_public=True)


class Migration(migrations.Migration):

    dependencies = [
        ("Cabinet", "0092_unique_active_plan_enrollment"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name="lessonplan",
            name="is_public",
            field=models.BooleanField(
                db_index=True,
                default=False,
                help_text="Готовый план каталога: другие учителя могут создать свою копию, но не изменяют оригинал.",
                verbose_name="Публичный шаблон",
            ),
        ),
        migrations.AlterField(
            model_name="lessonplan",
            name="teacher",
            field=models.ForeignKey(
                blank=True,
                help_text="Автор плана. Пусто допускается у старых шаблонов каталога.",
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="lesson_plans",
                to=settings.AUTH_USER_MODEL,
                verbose_name="Автор",
            ),
        ),
        migrations.RunPython(mark_legacy_catalog_plans, migrations.RunPython.noop),
    ]
