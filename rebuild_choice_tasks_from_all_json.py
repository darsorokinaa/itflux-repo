"""
Восстановить task_template для задач с вариантами 1) 2) … из all.json по сигнатуре вариантов.

Исправляет:
- условие не от того задания (склейка «ближайшего соседа»);
- один innerimg0.gif на все задачи (коллизия имён при скачивании).

Запуск:
    python rebuild_choice_tasks_from_all_json.py --dry-run
    python rebuild_choice_tasks_from_all_json.py
    python rebuild_choice_tasks_from_all_json.py --task-id 36 --subtopic-id 122
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

import psycopg2

ROOT = Path(__file__).parent.resolve()
sys.path.insert(0, str(ROOT))

from fipi_html_normalize import (
    _RE_TABLE_CELL,
    _RE_TABLE_ROW,
    _cell_plain_text,
    _row_choice_number,
    choice_options_table_html,
    html_has_choice_options_table,
    normalize_fipi_task_html,
)
from import_tasks_universal import download

ALL_JSON = ROOT / "all.json"

DB = {
    "dbname": os.environ.get("PGDATABASE", "itflux"),
    "user": os.environ.get("PGUSER", "postgres"),
    "password": os.environ.get("PGPASSWORD", "postgres"),
    "host": os.environ.get("PGHOST", "localhost"),
    "port": os.environ.get("PGPORT", "5432"),
}


def png_choice_sig(html: str, extra_urls: str = "") -> tuple[str, ...] | None:
    s = (html or "") + " " + (extra_urls or "")
    names = sorted(set(re.findall(r"xs3qvrsrc[^\"'\s>]+\.png", s, re.IGNORECASE)))
    return tuple(names) if len(names) >= 2 else None


def gif_folder_sig(html: str, extra_urls: str = "") -> str | None:
    s = (html or "") + " " + (extra_urls or "")
    m = re.search(r"questions/([A-F0-9]+)/", s, re.IGNORECASE)
    if not m:
        return None
    if not re.search(r"innerimg[1-4]\.gif", s, re.IGNORECASE):
        return None
    return m.group(1).upper()


def text_choice_sig(html: str) -> tuple[str, ...] | None:
    t = choice_options_table_html(html)
    if not t:
        return None
    texts: list[str] = []
    for row_m in _RE_TABLE_ROW.finditer(t):
        cells = _RE_TABLE_CELL.findall(row_m.group(1))
        if not cells or _row_choice_number(cells[0]) is None:
            continue
        body = cells[1] if len(cells) > 1 else cells[0]
        plain = _cell_plain_text(body).replace("\xa0", " ").strip()
        if plain:
            texts.append(plain)
    return tuple(texts) if len(texts) >= 2 else None


def build_json_indexes(rows: list[dict]) -> tuple[dict, dict, dict]:
    by_png: dict[tuple[str, ...], dict] = {}
    by_gif_folder: dict[str, dict] = {}
    by_text: dict[tuple[str, ...], dict] = {}

    for row in rows:
        html = row.get("task_html") or ""
        images = " ".join(row.get("images") or [])
        png = png_choice_sig(html, images)
        if png:
            by_png[png] = row
            continue
        folder = gif_folder_sig(html, images)
        if folder:
            by_gif_folder[folder.upper()] = row
            continue
        text = text_choice_sig(html)
        if text:
            by_text[text] = row

    return by_png, by_gif_folder, by_text


def match_db_row(
    html: str,
    by_png: dict,
    by_gif_folder: dict,
    by_text: dict,
) -> tuple[dict | None, str]:
    png = png_choice_sig(html)
    if png and png in by_png:
        return by_png[png], "png"

    folder = gif_folder_sig(html)
    if folder and folder in by_gif_folder:
        return by_gif_folder[folder.upper()], "gif-folder"

    text = text_choice_sig(html)
    if text and text in by_text:
        return by_text[text], "text"

    return None, ""


def _global_for_png_html(html: str, by_png: dict) -> int | None:
    sig = png_choice_sig(html)
    if sig and sig in by_png:
        g = by_png[sig].get("global_number")
        return int(g) if g is not None else None
    return None


def _inequality_gif_json_rows(data: list[dict]) -> list[tuple[int, str, dict]]:
    rows: list[tuple[int, str, dict]] = []
    for row in data:
        html = row.get("task_html") or ""
        if not re.search(r"innerimg[1-4]\.gif", html, re.IGNORECASE):
            continue
        blob = html + " ".join(row.get("images") or [])
        if not re.search(
            r"неравенств|координатной\s+прямой|Укажите\s+решение",
            blob,
            re.IGNORECASE,
        ):
            continue
        folder = gif_folder_sig(html, " ".join(row.get("images") or []))
        if not folder:
            continue
        g = row.get("global_number")
        rows.append((int(g) if g is not None else 0, folder.upper(), row))
    return rows


def _is_gif_only_choice_db(html: str) -> bool:
    return bool(
        html_has_choice_options_table(html)
        and png_choice_sig(html) is None
        and re.search(r"innerimg[1-4]\.gif", html, re.IGNORECASE)
    )


def match_gif_by_png_neighbors(
    db_rows: list[tuple[int, str]],
    json_gif: list[tuple[int, str, dict]],
    by_png: dict,
) -> dict[int, tuple[dict, str]]:
    """Gif-задачи без папки FIPI в HTML: global_number между соседними png из all.json."""
    assignments: dict[int, tuple[dict, str]] = {}
    i = 0
    while i < len(db_rows):
        id_, html = db_rows[i]
        if not _is_gif_only_choice_db(html):
            i += 1
            continue
        prev_g = None
        for j in range(i - 1, -1, -1):
            g = _global_for_png_html(db_rows[j][1], by_png)
            if g is not None:
                prev_g = g
                break
        next_g = None
        for j in range(i + 1, len(db_rows)):
            g = _global_for_png_html(db_rows[j][1], by_png)
            if g is not None:
                next_g = g
                break
        lo = (prev_g or 0) + 1
        hi = (next_g or 10**9) - 1
        gif_block: list[int] = []
        while i < len(db_rows) and _is_gif_only_choice_db(db_rows[i][1]):
            gif_block.append(db_rows[i][0])
            i += 1
        cands = [r for r in json_gif if lo <= r[0] <= hi]
        if not cands:
            continue
        cands.sort(key=lambda x: x[0])
        if len(cands) == len(gif_block):
            for db_id, cand in zip(gif_block, cands):
                assignments[db_id] = (cand[2], f"gif-neighbor(g={cand[0]})")
        elif len(gif_block) == 1 and cands:
            if next_g is not None:
                best = min(cands, key=lambda c: abs(c[0] - next_g))
            else:
                best = cands[-1]
            assignments[gif_block[0]] = (best[2], f"gif-neighbor(g={best[0]})")
    return assignments


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--task-id", type=int, default=36, help="TaskList id (ОГЭ №13 = 36)")
    parser.add_argument("--subtopic-id", type=int, default=122)
    parser.add_argument("--all-fipi", action="store_true", help="Все активные задачи ФИПИ с вариантами")
    args = parser.parse_args()

    if not ALL_JSON.exists():
        print(f"Нет файла {ALL_JSON}")
        sys.exit(1)

    data = json.loads(ALL_JSON.read_text(encoding="utf-8"))
    by_png, by_gif_folder, by_text = build_json_indexes(data)
    json_gif = _inequality_gif_json_rows(data)
    print(
        f"Индекс all.json: png={len(by_png)}, gif-папок={len(by_gif_folder)}, "
        f"text={len(by_text)}, gif-неравенства={len(json_gif)}"
    )

    conn = psycopg2.connect(**DB)
    cur = conn.cursor()
    if args.all_fipi:
        cur.execute(
            """
            SELECT id, task_template FROM "Generator_task"
            WHERE is_active = TRUE AND created_by = 'ФИПИ'
              AND task_template ~* '<table'
            ORDER BY id
            """
        )
    else:
        cur.execute(
            """
            SELECT id, task_template FROM "Generator_task"
            WHERE is_active = TRUE AND task_id = %s AND subtopic_id = %s
            ORDER BY id
            """,
            (args.task_id, args.subtopic_id),
        )

    db_rows = cur.fetchall()
    gif_assignments = match_gif_by_png_neighbors(db_rows, json_gif, by_png)

    updated = 0
    skipped = 0
    for id_, html in db_rows:
        if not html_has_choice_options_table(html):
            continue
        row, how = match_db_row(html, by_png, by_gif_folder, by_text)
        if not row and id_ in gif_assignments:
            row, how = gif_assignments[id_]
        if not row:
            skipped += 1
            print(f"  [skip] {id_}: нет пары в all.json")
            continue

        raw = (row.get("task_html") or "").strip()
        if not raw:
            skipped += 1
            print(f"  [skip] {id_}: пустой task_html в json")
            continue

        if args.dry_run:
            print(f"  [dry-run] {id_} ← all.json ({how}, global={row.get('global_number')})")
            updated += 1
            continue

        new_html = normalize_fipi_task_html(raw, download=download)
        cur.execute(
            'UPDATE "Generator_task" SET task_template = %s WHERE id = %s',
            (new_html, id_),
        )
        print(f"  [ok] {id_} ← all.json ({how}, global={row.get('global_number')})")
        updated += 1

    if args.dry_run:
        conn.rollback()
        print(f"\n[dry-run] Обновлено: {updated}, без пары: {skipped}")
    else:
        conn.commit()
        print(f"\nГотово. Обновлено: {updated}, без пары: {skipped}")

    cur.close()
    conn.close()


if __name__ == "__main__":
    main()
