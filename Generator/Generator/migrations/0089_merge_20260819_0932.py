# Merge lesson-shop branch with seasonal-theme parallel branch.

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("Generator", "0087_merge_20260815_1223"),
        ("Generator", "0088_alter_seasonaltheme_hero_history_icon_and_more"),
    ]

    operations = []
