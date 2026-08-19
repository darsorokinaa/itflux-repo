# Idempotent index rename: safe when 0081_merge already renamed indexes on prod.

from django.db import migrations


def rename_activation_indexes(apps, schema_editor):
    connection = schema_editor.connection
    if connection.vendor != "postgresql":
        return
    renames = (
        ("Cabinet_act_user_id_evt_idx", "Cabinet_act_user_id_7d47c8_idx"),
        ("Cabinet_act_event_n_time_idx", "Cabinet_act_event_n_0116cd_idx"),
    )
    with connection.cursor() as cursor:
        for old_name, new_name in renames:
            cursor.execute(
                """
                SELECT indexname FROM pg_indexes
                WHERE schemaname = current_schema()
                  AND indexname = ANY(%s)
                """,
                [[old_name, new_name]],
            )
            names = {row[0] for row in cursor.fetchall()}
            if old_name in names:
                cursor.execute(
                    f'ALTER INDEX "{old_name}" RENAME TO "{new_name}"'
                )


class Migration(migrations.Migration):

    dependencies = [
        ("Cabinet", "0085_remove_material_shop"),
    ]

    operations = [
        migrations.RunPython(rename_activation_indexes, migrations.RunPython.noop),
    ]
