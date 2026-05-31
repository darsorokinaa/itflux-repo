"""
Перенумерация pk TaskList и Task подряд с 1 (PostgreSQL, DEFERRED constraints).

Вызывается только из data-миграции ``0056_renumber_tasklist_and_task_primary_keys``.
"""

from __future__ import annotations

from django.db import transaction


def _q(conn, name: str) -> str:
    return conn.ops.quote_name(name)


def _models(apps):
    return (
        apps.get_model("Generator", "TaskList"),
        apps.get_model("Generator", "Variant"),
        apps.get_model("Generator", "Task"),
        apps.get_model("Generator", "SubTopic"),
        apps.get_model("Generator", "Criteria"),
        apps.get_model("Generator", "Tag"),
        apps.get_model("Generator", "TaskGroupMember"),
        apps.get_model("Generator", "VariantContent"),
        apps.get_model("Generator", "ErrorReport"),
    )


def _renumber_tasklists(conn, apps) -> None:
    TaskList, Variant, Task, SubTopic, Criteria, _, _, _, _ = _models(apps)

    ids = list(TaskList.objects.order_by("id").values_list("id", flat=True))
    if not ids:
        return

    old_to_new = {old_id: i + 1 for i, old_id in enumerate(ids)}

    for v in Variant.objects.exclude(content__isnull=True).iterator(chunk_size=100):
        content = v.content
        if not content:
            continue
        new_content = {}
        changed = False
        for k, val in content.items():
            try:
                oid = int(str(k).strip())
            except ValueError:
                new_content[str(k)] = val
                continue
            if oid in old_to_new:
                nk = str(old_to_new[oid])
                new_content[nk] = val
                if nk != str(k):
                    changed = True
            else:
                new_content[str(k)] = val
        if changed:
            v.content = new_content
            v.save(update_fields=["content"])

    offset = max(ids) + 1_000_000
    tl_table = TaskList._meta.db_table
    task_table = Task._meta.db_table
    sub_table = SubTopic._meta.db_table
    crit_table = Criteria._meta.db_table

    pairs = [(old_id + offset, old_to_new[old_id]) for old_id in ids]

    tl_q, task_q, sub_q, crit_q = (
        _q(conn, tl_table),
        _q(conn, task_table),
        _q(conn, sub_table),
        _q(conn, crit_table),
    )
    q_id = _q(conn, "id")
    q_task_id = _q(conn, "task_id")
    q_task_list_id = _q(conn, "task_list_id")
    q_task_number_id = _q(conn, "task_number_id")

    with transaction.atomic():
        with conn.cursor() as c:
            c.execute("SET CONSTRAINTS ALL DEFERRED")

            c.execute(
                f"UPDATE {task_q} SET {q_task_id} = {q_task_id} + %s WHERE {q_task_id} IS NOT NULL",
                [offset],
            )
            c.execute(
                f"UPDATE {sub_q} SET {q_task_list_id} = {q_task_list_id} + %s",
                [offset],
            )
            c.execute(
                f"UPDATE {crit_q} SET {q_task_number_id} = {q_task_number_id} + %s",
                [offset],
            )
            c.execute(
                f"UPDATE {tl_q} SET {q_id} = {q_id} + %s",
                [offset],
            )

            c.execute(
                """
                CREATE TEMP TABLE _tl_remap (
                    shifted_id bigint NOT NULL,
                    final_id bigint NOT NULL
                ) ON COMMIT DROP
                """
            )
            c.executemany(
                "INSERT INTO _tl_remap (shifted_id, final_id) VALUES (%s, %s)",
                pairs,
            )

            c.execute(
                f"""
                UPDATE {task_q} AS t SET {q_task_id} = r.final_id
                FROM _tl_remap r
                WHERE t.{q_task_id} = r.shifted_id
                """
            )
            c.execute(
                f"""
                UPDATE {sub_q} AS s SET {q_task_list_id} = r.final_id
                FROM _tl_remap r
                WHERE s.{q_task_list_id} = r.shifted_id
                """
            )
            c.execute(
                f"""
                UPDATE {crit_q} AS cr SET {q_task_number_id} = r.final_id
                FROM _tl_remap r
                WHERE cr.{q_task_number_id} = r.shifted_id
                """
            )
            c.execute(
                f"""
                UPDATE {tl_q} AS tl SET {q_id} = r.final_id
                FROM _tl_remap r
                WHERE tl.{q_id} = r.shifted_id
                """
            )

            c.execute(
                f"""
                SELECT setval(
                    pg_get_serial_sequence(%s, 'id'),
                    COALESCE((SELECT MAX({q_id}) FROM {tl_q}), 1),
                    true
                )
                """,
                [f'"{tl_table}"'],
            )


def _renumber_tasks(conn, apps) -> None:
    _, _, Task, _, _, Tag, TaskGroupMember, VariantContent, ErrorReport = _models(apps)

    ids = list(Task.objects.order_by("id").values_list("id", flat=True))
    if not ids:
        return

    old_to_new = {old_id: i + 1 for i, old_id in enumerate(ids)}
    offset = max(ids) + 1_000_000
    task_table = Task._meta.db_table
    tag_table = Tag._meta.db_table
    tgm_table = TaskGroupMember._meta.db_table
    vc_table = VariantContent._meta.db_table
    er_table = ErrorReport._meta.db_table

    pairs = [(old_id + offset, old_to_new[old_id]) for old_id in ids]

    task_q = _q(conn, task_table)
    tag_q = _q(conn, tag_table)
    tgm_q = _q(conn, tgm_table)
    vc_q = _q(conn, vc_table)
    er_q = _q(conn, er_table)

    pair_rows = [(old_id, old_to_new[old_id]) for old_id in ids]

    q_id = _q(conn, "id")
    q_task_id = _q(conn, "task_id")

    with transaction.atomic():
        with conn.cursor() as c:
            c.execute("SET CONSTRAINTS ALL DEFERRED")

            c.execute(
                f"UPDATE {tag_q} SET {q_task_id} = {q_task_id} + %s WHERE {q_task_id} IS NOT NULL",
                [offset],
            )
            c.execute(
                f"UPDATE {tgm_q} SET {q_task_id} = {q_task_id} + %s WHERE {q_task_id} IS NOT NULL",
                [offset],
            )
            c.execute(
                f"UPDATE {vc_q} SET {q_task_id} = {q_task_id} + %s WHERE {q_task_id} IS NOT NULL",
                [offset],
            )

            c.execute(
                f"UPDATE {task_q} SET {q_id} = {q_id} + %s",
                [offset],
            )

            c.execute(
                """
                CREATE TEMP TABLE _task_remap (
                    shifted_id bigint NOT NULL,
                    final_id bigint NOT NULL
                ) ON COMMIT DROP
                """
            )
            c.executemany(
                "INSERT INTO _task_remap (shifted_id, final_id) VALUES (%s, %s)",
                pairs,
            )

            c.execute(
                f"""
                UPDATE {tag_q} AS g SET {q_task_id} = r.final_id
                FROM _task_remap r
                WHERE g.{q_task_id} = r.shifted_id
                """
            )
            c.execute(
                f"""
                UPDATE {tgm_q} AS m SET {q_task_id} = r.final_id
                FROM _task_remap r
                WHERE m.{q_task_id} = r.shifted_id
                """
            )
            c.execute(
                f"""
                UPDATE {vc_q} AS vc SET {q_task_id} = r.final_id
                FROM _task_remap r
                WHERE vc.{q_task_id} = r.shifted_id
                """
            )
            c.execute(
                f"""
                UPDATE {task_q} AS t SET {q_id} = r.final_id
                FROM _task_remap r
                WHERE t.{q_id} = r.shifted_id
                """
            )

            c.execute(
                """
                CREATE TEMP TABLE _task_er_remap (
                    old_id bigint NOT NULL,
                    final_id bigint NOT NULL
                ) ON COMMIT DROP
                """
            )
            c.executemany(
                "INSERT INTO _task_er_remap (old_id, final_id) VALUES (%s, %s)",
                pair_rows,
            )
            c.execute(
                f"""
                UPDATE {er_q} AS er SET {q_task_id} = m.final_id
                FROM _task_er_remap m
                WHERE er.{q_task_id} = m.old_id
                """
            )

            c.execute(
                f"""
                SELECT setval(
                    pg_get_serial_sequence(%s, 'id'),
                    COALESCE((SELECT MAX({q_id}) FROM {task_q}), 1),
                    true
                )
                """,
                [f'"{task_table}"'],
            )


def run_full_renumber_for_migration(apps, schema_editor) -> None:
    conn = schema_editor.connection
    if conn.vendor != "postgresql":
        return
    _renumber_tasklists(conn, apps)
    _renumber_tasks(conn, apps)


def noop_reverse(apps, schema_editor) -> None:
    pass
