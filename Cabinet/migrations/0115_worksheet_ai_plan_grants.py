from django.db import migrations


GRANTS = {
    "start": 80,
    "teacher": 400,
    "pro": 800,
    "premium": 1200,
    "school": 2000,
    "default": 20,
}

COSTS = {
    "base_worksheet_generation": 5,
    "task_from_bank": 0,
    "task_rewrite": 1,
    "task_theme_adaptation": 1,
    "ai_new_task": 3,
    "ai_design": 5,
    "theory_block": 2,
    "image_generation": 8,
}

LABELS = {
    "base_worksheet_generation": "Сборка листа",
    "task_from_bank": "Задание из банка",
    "task_rewrite": "Переформулировка",
    "task_theme_adaptation": "Адаптация под тему",
    "ai_new_task": "Новое задание",
    "ai_design": "Оформление",
    "theory_block": "Теория",
    "image_generation": "Картинка к заданию",
}


def write_grants_and_costs(apps, schema_editor):
    Pricing = apps.get_model("Cabinet", "WorksheetAIPricing")
    row = Pricing.objects.filter(code="default").first()
    if row is None:
        Pricing.objects.create(
            code="default",
            is_active=True,
            config={
                "costs": COSTS,
                "cost_labels": LABELS,
                "monthly_grant_by_plan": GRANTS,
            },
        )
        return
    config = dict(row.config) if isinstance(row.config, dict) else {}
    costs = dict(config.get("costs") or {})
    costs.update(COSTS)
    labels = dict(config.get("cost_labels") or {})
    labels.update(LABELS)
    grants = dict(config.get("monthly_grant_by_plan") or {})
    grants.update(GRANTS)
    config["costs"] = costs
    config["cost_labels"] = labels
    config["monthly_grant_by_plan"] = grants
    row.config = config
    row.save(update_fields=["config"])


class Migration(migrations.Migration):

    dependencies = [
        ("Cabinet", "0114_worksheet_document_status"),
    ]

    operations = [
        migrations.RunPython(write_grants_and_costs, migrations.RunPython.noop),
    ]
