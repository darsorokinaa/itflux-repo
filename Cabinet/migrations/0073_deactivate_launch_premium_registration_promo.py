"""Выключает стартовую акцию Premium для новых регистраций.

Запись Promotion (код launch-premium) сохраняется: историю и механизм
включения/выключения в админке не трогаем. Уже выданные Premium не меняются.
"""

from django.db import migrations


LAUNCH_PROMO_CODE = "launch-premium"


def deactivate_launch_promo(apps, schema_editor):
    Promotion = apps.get_model("Cabinet", "Promotion")
    Promotion.objects.filter(code=LAUNCH_PROMO_CODE, is_active=True).update(is_active=False)


def noop_reverse(apps, schema_editor):
    # Обратный ход не включает акцию снова: это осознанное отключение кампании.
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("Cabinet", "0072_push_subscription_disabled_by_user"),
    ]

    operations = [
        migrations.RunPython(deactivate_launch_promo, noop_reverse),
    ]
