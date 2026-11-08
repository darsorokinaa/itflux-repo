"""Цепочка миграций ВПР на чистой PostgreSQL.

Проверка идёт отдельным процессом: старые data-миграции пишут в подключение
по умолчанию, поэтому его имя и есть пустая база. Скрипты архивов не запускаются.
"""

import os
import subprocess
import sys
from pathlib import Path

import psycopg2
from django.conf import settings
from django.test import SimpleTestCase
from psycopg2 import sql
from psycopg2.extensions import ISOLATION_LEVEL_AUTOCOMMIT

FRESH_DB = "itflux_vpr_fresh_5012"
CHAIN_DB = "itflux_vpr_chain_5012"
PRE_0116 = "0115_r131_razbor"
MIGRATION_0116 = "0116_vpr_inf8_truth_table_rows"
MIGRATION_0117 = "0117_task_answer_spec"

TARGET_TEMPLATE = (
    "<p>Заполните таблицу истинности выражения.</p>"
    r"<p>\(A \land \lnot B\)</p>"
    "<p>В ответе запишите 4 цифры подряд — значения столбца результата.</p>"
)
TARGET_ANSWER = "<p>1010 0010</p>"
KEEPER_TEMPLATE = "<p>Заполните таблицу истинности выражения.</p>" + r"<p>\(A \land B\)</p>"
KEEPER_ANSWER = "0001"
AFTER_ANSWER = "10 00 11 00"


def _admin_connection():
    cfg = settings.DATABASES["default"]
    conn = psycopg2.connect(
        dbname="postgres",
        user=cfg.get("USER") or "postgres",
        password=cfg.get("PASSWORD") or "",
        host=cfg.get("HOST") or "localhost",
        port=cfg.get("PORT") or 5432,
    )
    conn.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)
    return conn


def _recreate_database(name: str) -> None:
    conn = _admin_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute(
                "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = %s AND pid <> pg_backend_pid()",
                [name],
            )
            cursor.execute(sql.SQL("DROP DATABASE IF EXISTS {}").format(sql.Identifier(name)))
            cursor.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(name)))
    finally:
        conn.close()


def _drop_database(name: str) -> None:
    conn = _admin_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute(
                "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = %s AND pid <> pg_backend_pid()",
                [name],
            )
            cursor.execute(sql.SQL("DROP DATABASE IF EXISTS {}").format(sql.Identifier(name)))
    finally:
        conn.close()


def _child_env(name: str) -> dict:
    cfg = settings.DATABASES["default"]
    env = os.environ.copy()
    env["PGDATABASE"] = name
    env["PGUSER"] = str(cfg.get("USER") or "postgres")
    env["PGPASSWORD"] = str(cfg.get("PASSWORD") or "")
    env["PGHOST"] = str(cfg.get("HOST") or "localhost")
    env["PGPORT"] = str(cfg.get("PORT") or 5432)
    env.setdefault("DJANGO_SETTINGS_MODULE", "Generator.settings")
    return env


class PostgresMigrationChainTests(SimpleTestCase):
    databases = {"default"}

    def test_fresh_forward_and_seeded_0116_do_not_touch_legacy_rows(self):
        for name, mode in ((FRESH_DB, "fresh"), (CHAIN_DB, "chain")):
            _recreate_database(name)
            try:
                proc = subprocess.run(
                    [sys.executable, str(Path(__file__).resolve()), mode],
                    cwd=str(Path(__file__).resolve().parents[2]),
                    env=_child_env(name),
                    text=True,
                    capture_output=True,
                    timeout=600,
                    check=False,
                )
                self.assertEqual(
                    proc.returncode,
                    0,
                    f"{mode}\n{proc.stdout}\n{proc.stderr}",
                )
                self.assertIn(f"OK {mode}", proc.stdout)
            finally:
                _drop_database(name)


def _setup_django():
    root = Path(__file__).resolve().parents[2]
    generator = root / "Generator"
    # Как в manage.py: каталог с пакетом приложения идёт раньше корня репозитория.
    for path in (str(root), str(generator)):
        if path in sys.path:
            sys.path.remove(path)
        sys.path.insert(0, path)
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "Generator.settings")
    import django

    django.setup()


def _check(condition, message: str) -> None:
    if not condition:
        raise SystemExit(message)


def _applied() -> list[str]:
    from django.db import connection

    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT name FROM django_migrations
            WHERE app = 'Generator' AND name IN (%s, %s, %s)
            ORDER BY id
            """,
            [PRE_0116, MIGRATION_0116, MIGRATION_0117],
        )
        return [row[0] for row in cursor.fetchall()]


def _table(model_name: str) -> str:
    from django.apps import apps

    table = apps.get_model("Generator", model_name)._meta.db_table
    _check(table.replace("_", "").isalnum(), f"неожиданное имя таблицы {table}")
    return table


def _columns(table: str) -> set[str]:
    from django.db import connection

    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT column_name FROM information_schema.columns
            WHERE table_schema = current_schema() AND table_name = %s
            """,
            [table],
        )
        return {row[0] for row in cursor.fetchall()}


def _count(table: str) -> int:
    from django.db import connection

    with connection.cursor() as cursor:
        cursor.execute(sql.SQL("SELECT COUNT(*) FROM {}").format(sql.Identifier(table)))
        return cursor.fetchone()[0]


def _constraint(name: str) -> bool:
    from django.db import connection

    # Частичный UniqueConstraint Django создаёт как индекс, не как pg_constraint.
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT 1 FROM pg_constraint WHERE conname = %s
            UNION ALL
            SELECT 1 FROM pg_indexes WHERE indexname = %s
            LIMIT 1
            """,
            [name, name],
        )
        return cursor.fetchone() is not None


def _read(table: str, pk: int):
    from django.db import connection

    with connection.cursor() as cursor:
        cursor.execute(
            sql.SQL(
                """
                SELECT task_template, answer, truth_table_enabled, vpr_class,
                       is_active, vpr_advanced, created_by, max_score
                FROM {} WHERE id = %s
                """
            ).format(sql.Identifier(table)),
            [pk],
        )
        row = cursor.fetchone()
    _check(row is not None, f"нет задачи {pk}")
    return row


def _migrate(*args) -> None:
    from django.core.management import call_command

    call_command("migrate", *args, interactive=False, verbosity=0)


def _seed() -> dict[str, int]:
    from django.db import connection
    from django.db.migrations.loader import MigrationLoader

    apps = MigrationLoader(connection).project_state(("Generator", PRE_0116)).apps
    Level = apps.get_model("Generator", "Level")
    Subject = apps.get_model("Generator", "Subject")
    TaskList = apps.get_model("Generator", "TaskList")
    Task = apps.get_model("Generator", "Task")
    level = Level.objects.create(level="vpr", level_rus="ВПР")
    inf = Subject.objects.create(subject_short="inf", subject_name="Информатика")
    math = Subject.objects.create(subject_short="math", subject_name="Математика")
    inf6 = TaskList.objects.create(
        subject=inf, level=level, task_number=6, task_title="таблица", max_score=1, part=None,
    )
    inf12 = TaskList.objects.create(
        subject=inf, level=level, task_number=12, task_title="программа", max_score=1, part=None,
    )
    math6 = TaskList.objects.create(
        subject=math, level=level, task_number=6, task_title="чужая", max_score=1, part=None,
    )

    def make(task_list, text, grade, flags):
        template, answer = text
        advanced, enabled = flags
        row = Task.objects.create(
            task=task_list,
            task_template=template,
            answer=answer,
            vpr_class=grade,
            vpr_advanced=advanced,
            vpr_basic=True,
            truth_table_enabled=enabled,
            is_active=True,
            scope="global",
            status="ready",
            author="банк",
            max_score=1,
            created_by="LEGACY",
            owner_teacher=None,
            local_number=None,
        )
        return row.pk

    return {
        "target": make(inf6, (TARGET_TEMPLATE, TARGET_ANSWER), 8, (True, False)),
        "keeper": make(inf6, (KEEPER_TEMPLATE, KEEPER_ANSWER), 8, (True, False)),
        "class7": make(inf6, (TARGET_TEMPLATE, TARGET_ANSWER), 7, (True, True)),
        "outsider": make(inf12, (TARGET_TEMPLATE, TARGET_ANSWER), 8, (True, True)),
        "math": make(math6, (TARGET_TEMPLATE, TARGET_ANSWER), 8, (True, True)),
    }


def _assert_only_target_changed(before: dict, after: dict) -> None:
    target = after["target"]
    _check("В ответе запишите" not in target[0], "подсказка осталась у целевой задачи")
    _check("Заполните таблицу истинности" in target[0], "формула или просьба заполнить таблицу пропали")
    _check(r"A \land \lnot B" in target[0], "формула целевой задачи изменилась")
    _check(target[1] == AFTER_ANSWER, f"ответ целевой задачи {target[1]!r}")
    _check(target[2] is True, "у целевой задачи не включилась таблица")
    _check(target[3:] == before["target"][3:], f"лишние поля целевой задачи: {target}")
    for key in ("keeper", "class7", "outsider", "math"):
        _check(after[key] == before[key], f"{key} изменилась: {before[key]!r} -> {after[key]!r}")


def _assert_new_columns_empty(table: str, seeded: dict[str, int]) -> None:
    from django.db import connection

    with connection.cursor() as cursor:
        cursor.execute(
            sql.SQL(
                "SELECT id, source_key, import_batch, solution, answer_spec FROM {} WHERE id = ANY(%s)"
            ).format(sql.Identifier(table)),
            [list(seeded.values())],
        )
        rows = cursor.fetchall()
    _check(len(rows) == len(seeded), "число задач после 0117 изменилось")
    for pk, source_key, import_batch, solution, answer_spec in rows:
        _check(source_key is None, f"source_key у старой задачи {pk}")
        _check(import_batch is None, f"import_batch у старой задачи {pk}")
        _check(solution in (None, ""), f"solution у старой задачи {pk}: {solution!r}")
        _check(answer_spec is None, f"answer_spec у старой задачи {pk}")


def run_fresh() -> None:
    _migrate()
    applied = _applied()
    for name in (PRE_0116, MIGRATION_0116, MIGRATION_0117):
        _check(name in applied, f"на пустой базе нет {name}: {applied}")
    task = _table("Task")
    lists = _table("TaskList")
    _check("source_key" in _columns(task), "после полной миграции нет source_key")
    _check("vpr_class" in _columns(lists), "после полной миграции нет TaskList.vpr_class")
    _check(_count(task) == 0, "полная миграция создала задачи")
    print("OK fresh")


def run_chain() -> None:
    _migrate("Generator", PRE_0116)
    _check(MIGRATION_0116 not in _applied(), "0116 применилась раньше срока")
    task = _table("Task")
    lists = _table("TaskList")
    _check("source_key" not in _columns(task), "source_key есть до 0117")
    _check("vpr_class" not in _columns(lists), "TaskList.vpr_class есть до 0117")
    seeded = _seed()
    before = {key: _read(task, pk) for key, pk in seeded.items()}
    _check(_count(task) == len(seeded), "в базе лишние задачи до 0116")

    _migrate("Generator", MIGRATION_0116)
    _check(MIGRATION_0116 in _applied(), "0116 не отметилась")
    _check("source_key" not in _columns(task), "0116 создала source_key")
    after_0116 = {key: _read(task, pk) for key, pk in seeded.items()}
    _check(_count(task) == len(seeded), "0116 изменила число задач")
    _assert_only_target_changed(before, after_0116)

    _migrate("Generator", MIGRATION_0117)
    applied = _applied()
    _check(MIGRATION_0116 in applied and MIGRATION_0117 in applied, f"цепочка 0116→0117: {applied}")
    cols = _columns(task)
    for column in ("source_key", "import_batch", "solution", "answer_spec"):
        _check(column in cols, f"нет колонки {column}")
    _check("vpr_class" in _columns(lists), "нет TaskList.vpr_class")
    _check(_constraint("task_source_key_uniq"), "нет уникальности source_key")
    after_0117 = {key: _read(task, pk) for key, pk in seeded.items()}
    _check(after_0117 == after_0116, "0117 изменила тексты или флаги старых задач")
    _assert_new_columns_empty(task, seeded)

    _migrate("Generator", MIGRATION_0116)
    _check(MIGRATION_0117 not in _applied(), "0117 не откатилась")
    _check("source_key" not in _columns(task), "source_key осталась после отката 0117")
    _check("vpr_class" not in _columns(lists), "TaskList.vpr_class осталась после отката 0117")
    _check(not _constraint("task_source_key_uniq"), "ограничение source_key осталось")
    reversed_schema = {key: _read(task, pk) for key, pk in seeded.items()}
    _check(reversed_schema == after_0116, "откат 0117 изменил тексты задач")

    _migrate("Generator", PRE_0116)
    _check(MIGRATION_0116 not in _applied(), "0116 не откатилась")
    reversed_data = {key: _read(task, pk) for key, pk in seeded.items()}
    _check(reversed_data == after_0116, "пустой откат 0116 изменил уже записанные тексты")

    _migrate("Generator", MIGRATION_0117)
    forwarded = {key: _read(task, pk) for key, pk in seeded.items()}
    _check(forwarded == after_0116, "повторный проход 0116→0117 изменил задачи")
    _assert_new_columns_empty(task, seeded)
    _check(_count(task) == len(seeded), "повторный проход изменил число задач")
    print("OK chain")


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else ""
    # Тот же признак, что у manage.py test: без него settings требуют боевой SECRET_KEY.
    if "test" not in sys.argv:
        sys.argv.insert(1, "test")
    _setup_django()
    if mode == "fresh":
        run_fresh()
    elif mode == "chain":
        run_chain()
    else:
        raise SystemExit("нужен режим fresh или chain")
