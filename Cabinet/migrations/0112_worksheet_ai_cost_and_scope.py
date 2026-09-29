from django.db import migrations, models


OLD_GRANTS = {
    "start": 40,
    "teacher": 120,
    "pro": 300,
    "premium": 800,
    "default": 40,
}
NEW_GRANTS = {
    "start": 20,
    "teacher": 50,
    "pro": 100,
    "premium": 200,
    "default": 20,
}


def tighten_provisional_grants(apps, schema_editor):
    Pricing = apps.get_model("Cabinet", "WorksheetAIPricing")
    for row in Pricing.objects.all():
        config = row.config if isinstance(row.config, dict) else {}
        grants = config.get("monthly_grant_by_plan") or {}
        if not isinstance(grants, dict):
            continue
        unchanged = True
        for key, value in OLD_GRANTS.items():
            try:
                current = int(grants.get(key, value))
            except (TypeError, ValueError):
                unchanged = False
                break
            if current != value:
                unchanged = False
                break
        if not unchanged:
            continue
        updated = dict(grants)
        updated.update(NEW_GRANTS)
        config = dict(config)
        config["monthly_grant_by_plan"] = updated
        row.config = config
        row.save(update_fields=["config"])


class Migration(migrations.Migration):

    dependencies = [
        ("Cabinet", "0111_worksheet_ai"),
    ]

    operations = [
        migrations.AddField(
            model_name="knowledgeinstruction",
            name="exam",
            field=models.CharField(
                blank=True,
                choices=[
                    ("oge", "ОГЭ"),
                    ("ege", "ЕГЭ"),
                    ("ege_base", "ЕГЭ база"),
                    ("ege_profile", "ЕГЭ профиль"),
                    ("vpr", "ВПР"),
                ],
                default="",
                max_length=16,
                verbose_name="Экзамен",
            ),
        ),
        migrations.AddField(
            model_name="knowledgeinstruction",
            name="grade_from",
            field=models.PositiveSmallIntegerField(blank=True, null=True, verbose_name="Класс от"),
        ),
        migrations.AddField(
            model_name="knowledgeinstruction",
            name="grade_to",
            field=models.PositiveSmallIntegerField(blank=True, null=True, verbose_name="Класс до"),
        ),
        migrations.AddField(
            model_name="worksheetaigeneration",
            name="input_tokens",
            field=models.PositiveIntegerField(default=0, verbose_name="Входные токены провайдера"),
        ),
        migrations.AddField(
            model_name="worksheetaigeneration",
            name="latency_ms",
            field=models.PositiveIntegerField(default=0, verbose_name="Задержка, мс"),
        ),
        migrations.AddField(
            model_name="worksheetaigeneration",
            name="output_tokens",
            field=models.PositiveIntegerField(default=0, verbose_name="Выходные токены провайдера"),
        ),
        migrations.AddField(
            model_name="worksheetaigeneration",
            name="provider_calls",
            field=models.PositiveSmallIntegerField(default=0, verbose_name="Вызовов провайдера"),
        ),
        migrations.AddField(
            model_name="worksheetaigeneration",
            name="provider_cost",
            field=models.DecimalField(
                decimal_places=4, default=0, max_digits=12, verbose_name="Стоимость провайдера, ₽"
            ),
        ),
        migrations.AddField(
            model_name="worksheetaigeneration",
            name="retry_count",
            field=models.PositiveSmallIntegerField(default=0, verbose_name="Повторы"),
        ),
        migrations.RunPython(tighten_provisional_grants, migrations.RunPython.noop),
    ]
