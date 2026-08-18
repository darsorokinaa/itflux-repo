from django.db import migrations, models


def backfill_ledger_keys(apps, schema_editor):
    BillingTransaction = apps.get_model("Cabinet", "BillingTransaction")
    charges = (
        BillingTransaction.objects.filter(
            transaction_type="charge",
            is_reversal=False,
            event_billing_id__isnull=False,
        )
        .order_by("created_at", "id")
    )
    used_event_billing = set()
    for tx in charges.iterator():
        key = f"charge:{tx.event_billing_id}"
        if tx.event_billing_id in used_event_billing:
            key = f"charge-dup:{tx.id}"
        else:
            used_event_billing.add(tx.event_billing_id)
        BillingTransaction.objects.filter(pk=tx.pk).update(ledger_key=key)

    packages = (
        BillingTransaction.objects.filter(
            transaction_type="package_consumption",
            is_reversal=False,
            event_billing_id__isnull=False,
        )
        .order_by("created_at", "id")
    )
    used_pkg = set()
    for tx in packages.iterator():
        key = f"package:{tx.event_billing_id}"
        if tx.event_billing_id in used_pkg:
            key = f"package-dup:{tx.id}"
        else:
            used_pkg.add(tx.event_billing_id)
        BillingTransaction.objects.filter(pk=tx.pk).update(ledger_key=key)


def unfill_ledger_keys(apps, schema_editor):
    BillingTransaction = apps.get_model("Cabinet", "BillingTransaction")
    BillingTransaction.objects.filter(ledger_key__isnull=False).update(ledger_key=None)


class Migration(migrations.Migration):

    dependencies = [
        ("Cabinet", "0079_activation_event_and_acquisition"),
    ]

    operations = [
        migrations.AddField(
            model_name="billingtransaction",
            name="ledger_key",
            field=models.CharField(
                blank=True,
                help_text="Идемпотентный ключ активной операции, например charge:<event_billing_id>",
                max_length=128,
                null=True,
                unique=True,
            ),
        ),
        migrations.RunPython(backfill_ledger_keys, unfill_ledger_keys),
    ]
