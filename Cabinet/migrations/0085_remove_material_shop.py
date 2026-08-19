from django.db import migrations


def assert_empty_shop_tables(apps, schema_editor):
    import sys

    MaterialPurchase = apps.get_model("Cabinet", "MaterialPurchase")
    MaterialDemoAccess = apps.get_model("Cabinet", "MaterialDemoAccess")
    purchases = MaterialPurchase.objects.count()
    demos = MaterialDemoAccess.objects.count()
    if not purchases and not demos:
        return
    running_tests = "test" in sys.argv or "pytest" in sys.argv
    if running_tests:
        MaterialPurchase.objects.all().delete()
        MaterialDemoAccess.objects.all().delete()
        return
    raise RuntimeError(
        "Refusing to drop Cabinet.Material shop tables: "
        f"MaterialPurchase={purchases}, MaterialDemoAccess={demos}. "
        "Resolve these rows before applying 0085."
    )


class Migration(migrations.Migration):

    dependencies = [
        ("Cabinet", "0084_lesson_purchase_demo"),
    ]

    operations = [
        migrations.RunPython(assert_empty_shop_tables, migrations.RunPython.noop),
        migrations.DeleteModel(name="MaterialPurchase"),
        migrations.DeleteModel(name="MaterialDemoAccess"),
        migrations.DeleteModel(name="MaterialPreviewImage"),
        migrations.RemoveField(model_name="material", name="standalone_purchase_enabled"),
        migrations.RemoveField(model_name="material", name="standalone_price"),
        migrations.RemoveField(model_name="material", name="standalone_currency"),
        migrations.RemoveField(model_name="material", name="demo_enabled"),
        migrations.RemoveField(model_name="material", name="demo_duration_minutes"),
        migrations.RemoveField(model_name="material", name="demo_mode"),
        migrations.RemoveField(model_name="material", name="demo_page_count"),
        migrations.RemoveField(model_name="material", name="demo_fragment"),
        migrations.RemoveField(model_name="material", name="cover"),
        migrations.RemoveField(model_name="material", name="outline"),
        migrations.RemoveField(model_name="material", name="learning_outcomes"),
    ]
