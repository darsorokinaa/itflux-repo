# Merge production index-rename branch with lesson-shop merge.

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        (
            "Cabinet",
            "0080_rename_cabinet_act_user_id_evt_idx_cabinet_act_user_id_7d47c8_idx_and_more",
        ),
        ("Cabinet", "0087_merge_20260819_0931"),
    ]

    operations = []
