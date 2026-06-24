from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("Cabinet", "0012_plan_schedule_cancel"),
    ]

    operations = [
        migrations.AddField(
            model_name="lessonplanitem",
            name="attached_interactives",
            field=models.ManyToManyField(
                blank=True,
                related_name="plan_items_as_lesson_material",
                to="Cabinet.interactive",
                verbose_name="Интерактивы на уроке",
            ),
        ),
        migrations.AddField(
            model_name="lessonplanitem",
            name="homework_interactives",
            field=models.ManyToManyField(
                blank=True,
                related_name="plan_items_as_homework",
                to="Cabinet.interactive",
                verbose_name="Интерактивы к ДЗ",
            ),
        ),
        migrations.AddField(
            model_name="lessonplanitem",
            name="homework_materials",
            field=models.ManyToManyField(
                blank=True,
                related_name="homework_plan_items",
                to="Cabinet.material",
                verbose_name="Материалы к ДЗ",
            ),
        ),
    ]
