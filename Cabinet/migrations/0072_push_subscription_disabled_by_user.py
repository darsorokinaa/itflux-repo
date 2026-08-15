from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("Cabinet", "0071_launch_premium_registration_promo"),
    ]

    operations = [
        migrations.AddField(
            model_name="pushsubscription",
            name="disabled_by_user",
            field=models.BooleanField(
                default=False,
                help_text="True, если пользователь нажал «Отключить на этом устройстве». "
                "Не путать с истекшей подпиской (404/410).",
                verbose_name="Отключена пользователем",
            ),
        ),
    ]
