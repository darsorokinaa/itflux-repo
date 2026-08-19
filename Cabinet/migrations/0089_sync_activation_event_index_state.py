# Sync migration state with indexes already renamed on production (RunPython renames).

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("Cabinet", "0088_merge_20260819_0940"),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            database_operations=[],
            state_operations=[
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
            ],
        ),
    ]
