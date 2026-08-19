# Merge lesson-shop branch with pre-existing production index-rename branch.

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("Cabinet", "0081_merge_20260818_1756"),
        ("Cabinet", "0086_rename_cabinet_act_user_id_evt_idx_cabinet_act_user_id_7d47c8_idx_and_more"),
    ]

    operations = []
