from django.db import migrations


def assembly_is_free(apps, schema_editor):
    Pricing = apps.get_model("Cabinet", "WorksheetAIPricing")
    row = Pricing.objects.filter(code="default").first()
    if row is None:
        return
    config = dict(row.config) if isinstance(row.config, dict) else {}
    costs = dict(config.get("costs") or {})
    costs["base_worksheet_generation"] = 0
    labels = dict(config.get("cost_labels") or {})
    labels["base_worksheet_generation"] = "Сборка листа"
    config["costs"] = costs
    config["cost_labels"] = labels
    row.config = config
    row.save(update_fields=["config"])


class Migration(migrations.Migration):

    dependencies = [
        ("Cabinet", "0115_worksheet_ai_plan_grants"),
    ]

    operations = [
        migrations.RunPython(assembly_is_free, migrations.RunPython.noop),
    ]
