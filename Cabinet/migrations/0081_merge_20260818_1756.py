# Parallel branch that was already applied on some production servers before lesson-shop merge.

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("Cabinet", "0080_billing_ledger_key"),
    ]

    operations = [
        migrations.RenameIndex(
            model_name="activationevent",
            new_name="Cabinet_act_user_id_7d47c8_idx",
            old_name="Cabinet_act_user_id_evt_idx",
        ),
        migrations.RenameIndex(
            model_name="activationevent",
            new_name="Cabinet_act_event_n_0116cd_idx",
            old_name="Cabinet_act_event_n_time_idx",
        ),
    ]
