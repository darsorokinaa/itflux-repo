from django.db import migrations


def drop_homework_issuances(apps, schema_editor):
    # r126: ДЗ больше не входят в лимит вариантов — убираем их учёт.
    apps.get_model("Cabinet", "VariantIssuance").objects.filter(source="homework").delete()


class Migration(migrations.Migration):
    dependencies = [("Cabinet", "0132_r125_variant_live")]
    operations = [migrations.RunPython(drop_homework_issuances, migrations.RunPython.noop)]
