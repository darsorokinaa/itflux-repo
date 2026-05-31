"""
Склеить в БД пары задач, где условие и варианты 1) 2) … попали в разные записи при импорте.

Ищем: предыдущая запись — только условие, следующая — только таблица вариантов
(тот же task_id / subtopic_id).

Запуск:
    python fix_merge_split_choice_tasks.py
    python fix_merge_split_choice_tasks.py --dry-run
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

import django
import psycopg2

ROOT = Path(__file__).parent.resolve()
sys.path.insert(0, str(ROOT))

from fipi_html_normalize import html_has_choice_options_table, html_has_task_question_text

LOOKBACK_ROWS = 12  # варианты могут идти не сразу после условия в Excel

DB = {
    "dbname": os.environ.get("PGDATABASE", "itflux"),
    "user": os.environ.get("PGUSER", "postgres"),
    "password": os.environ.get("PGPASSWORD", "postgres"),
    "host": os.environ.get("PGHOST", "localhost"),
    "port": os.environ.get("PGPORT", "5432"),
}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    conn = psycopg2.connect(**DB)
    cur = conn.cursor()
    cur.execute(
        """
        SELECT id, task_id, subtopic_id, task_template
        FROM "Generator_task"
        WHERE is_active = TRUE
        ORDER BY task_id, subtopic_id NULLS FIRST, id
        """
    )
    rows = cur.fetchall()

    merged = 0
    deleted = 0
    to_delete: set[int] = set()

    def _q_only(html: str) -> bool:
        return html_has_task_question_text(html) and not html_has_choice_options_table(html)

    def _c_only(html: str) -> bool:
        return html_has_choice_options_table(html) and not html_has_task_question_text(html)

    i = 0
    while i < len(rows):
        id_b, tl_b, st_b, html_b = rows[i]
        if id_b in to_delete or not _c_only(html_b):
            i += 1
            continue

        partner_idx = None
        for j in range(i - 1, max(i - LOOKBACK_ROWS, -1), -1):
            id_a, tl_a, st_a, html_a = rows[j]
            if id_a in to_delete or tl_a != tl_b:
                break
            if _q_only(html_a):
                partner_idx = j
                break

        if partner_idx is None:
            i += 1
            continue

        id_a, tl_a, st_a, html_a = rows[partner_idx]
        new_html = (html_a or "").strip() + (html_b or "").strip()
        print(f"  [merge] {id_b} → {id_a} (task_list={tl_a})")
        if not args.dry_run:
            cur.execute(
                'UPDATE "Generator_task" SET task_template = %s WHERE id = %s',
                (new_html, id_a),
            )
            cur.execute('DELETE FROM "Generator_task" WHERE id = %s', (id_b,))
        merged += 1
        deleted += 1
        rows[partner_idx] = (id_a, tl_a, st_a, new_html)
        to_delete.add(id_b)
        rows.pop(i)
        continue

    if args.dry_run:
        conn.rollback()
        print(f"\n[dry-run] Будет склеено пар: {merged}, удалено записей: {deleted}")
    else:
        conn.commit()
        print(f"\nГотово. Склеено пар: {merged}, удалено записей: {deleted}")

    cur.close()
    conn.close()


if __name__ == "__main__":
    main()
