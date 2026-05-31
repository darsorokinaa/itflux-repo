"""
УСТАРЕЛО для задач с картинками: склейка «ближайшего соседа» подставляла чужое условие.
Используйте: python rebuild_choice_tasks_from_all_json.py

Этот скрипт оставлен для редких пар «только условие + только варианты» при импорте Excel.
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

import psycopg2

ROOT = Path(__file__).parent.resolve()
sys.path.insert(0, str(ROOT))

from fipi_html_normalize import (
    extract_question_html_without_choices,
    html_has_choice_options_table,
    html_has_task_question_text,
    normalize_fipi_task_html,
    task_uses_image_choices,
)
from import_tasks_universal import download

LOOKBACK = 8

DB = {
    "dbname": os.environ.get("PGDATABASE", "itflux"),
    "user": os.environ.get("PGUSER", "postgres"),
    "password": os.environ.get("PGPASSWORD", "postgres"),
    "host": os.environ.get("PGHOST", "localhost"),
    "port": os.environ.get("PGPORT", "5432"),
}


def _is_choices_only(html: str) -> bool:
    return html_has_choice_options_table(html) and not html_has_task_question_text(html)


def _is_full_choice_task(html: str) -> bool:
    return html_has_choice_options_table(html) and html_has_task_question_text(html)


def _find_partner(items: list[tuple[int, str]], idx: int) -> tuple[int, str] | None:
    c_html = items[idx][1]
    want_images = task_uses_image_choices(c_html)
    for j in range(idx - 1, max(idx - LOOKBACK, -1), -1):
        pid, phtml = items[j]
        if not _is_full_choice_task(phtml):
            continue
        if task_uses_image_choices(phtml) != want_images:
            continue
        q = extract_question_html_without_choices(phtml)
        if not q.strip():
            continue
        return pid, phtml
    return None


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--localize-gifs",
        action="store_true",
        help="Перекачать oge.fipi.ru (в т.ч. .gif) во всех задачах с вариантами",
    )
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

    by_group: dict[tuple, list[tuple[int, str]]] = {}
    for id_, tl, st, html in rows:
        by_group.setdefault((tl, st), []).append((id_, html or ""))

    fixed = 0
    skipped = 0
    localized = 0

    for _key, items in by_group.items():
        for idx, (cid, chtml) in enumerate(items):
            if not _is_choices_only(chtml):
                continue
            partner = _find_partner(items, idx)
            if partner is None:
                skipped += 1
                print(f"  [skip] {cid}: нет соседа с условием (lookback={LOOKBACK})")
                continue

            pid, phtml = partner
            question = extract_question_html_without_choices(phtml)
            new_html = (question + chtml).strip()
            if args.dry_run:
                print(f"  [dry-run] {cid} ← условие из {pid} (+{len(question)} симв.)")
            else:
                new_html = normalize_fipi_task_html(new_html, download=download)
                cur.execute(
                    'UPDATE "Generator_task" SET task_template = %s WHERE id = %s',
                    (new_html, cid),
                )
                print(f"  [fix] {cid} ← условие из {pid}")
            fixed += 1

    if args.localize_gifs and not args.dry_run:
        for id_, _tl, _st, html in rows:
            if not html or "oge.fipi.ru" not in html.lower():
                continue
            if not html_has_choice_options_table(html):
                continue
            new_html = normalize_fipi_task_html(html, download=download)
            if new_html != html:
                cur.execute(
                    'UPDATE "Generator_task" SET task_template = %s WHERE id = %s',
                    (new_html, id_),
                )
                localized += 1
                print(f"  [gif] {id_}")

    if args.dry_run:
        conn.rollback()
        print(f"\n[dry-run] Будет исправлено: {fixed}, без пары: {skipped}")
    else:
        conn.commit()
        print(f"\nГотово. Исправлено: {fixed}, без пары: {skipped}, localize-gifs: {localized}")

    cur.close()
    conn.close()


if __name__ == "__main__":
    main()
