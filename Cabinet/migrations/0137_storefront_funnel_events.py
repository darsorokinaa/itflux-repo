from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("Cabinet", "0136_storefront_acquisition_notices"),
    ]

    operations = [
        migrations.AlterField(
            model_name="storefrontevent",
            name="event_name",
            field=models.CharField(
                choices=[
                    ("pricing_view", "Просмотр /pricing"),
                    ("tariff_click", "Клик по тарифу"),
                    ("promo_applied", "Промокод применён"),
                    ("payment_created", "Платёж создан"),
                    ("homework_created", "Домашнее задание создано"),
                    ("invite_accepted", "Приглашение принято"),
                ],
                db_index=True,
                max_length=32,
                verbose_name="Событие",
            ),
        ),
    ]
