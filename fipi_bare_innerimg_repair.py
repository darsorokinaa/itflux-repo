"""
Коллизия innerimg*.gif при импорте ФИПИ.

Стратегия: при уверенном совпадении с all.json подменять task_template целиком
(normalize_fipi_task_html), а не только src — иначе условие и варианты расходятся.
"""
from __future__ import annotations

import json
import os
import re
from functools import lru_cache
from pathlib import Path
from typing import Callable

ROOT = Path(__file__).resolve().parent
ALL_JSON = ROOT / "all.json"

_RE_BARE_INNERIMG = re.compile(
    r'task_files/innerimg([0-4])\.gif',
    re.IGNORECASE,
)
_RE_FIPI_INNERIMG_URL = re.compile(
    r'https?://[^"\']+/questions/([A-F0-9]{32})/innerimg([0-4])\.gif',
    re.IGNORECASE,
)
_RE_FIPI_FOLDER = re.compile(
    r"questions/([A-F0-9]{32})/",
    re.IGNORECASE,
)
_RE_FIPI_DOCS_BASE = re.compile(
    r"(https?://[^/]+/docs/[^/]+/questions/[A-F0-9]{32})",
    re.IGNORECASE,
)


def html_has_bare_fipi_innerimg(html: str) -> bool:
    return bool(html and _RE_BARE_INNERIMG.search(html))


def html_has_remote_fipi_innerimg(html: str) -> bool:
    return bool(
        html
        and re.search(
            r'https?://[^"\']+/questions/[A-F0-9]{32}/innerimg[0-4]\.gif',
            html,
            re.IGNORECASE,
        )
    )


def html_needs_fipi_choice_repair(html: str) -> bool:
    if not html:
        return False
    if html_has_bare_fipi_innerimg(html) or html_has_remote_fipi_innerimg(html):
        return True
    from fipi_html_normalize import html_has_choice_options_table

    if not html_has_choice_options_table(html):
        return False
    return bool(
        re.search(r"xs3qvrsrc[^\"'\s>]+\.(?:png|gif)", html, re.IGNORECASE)
        or re.search(r"неравенств", html, re.IGNORECASE)
    )


def _normalize_interval_text(raw: str) -> str:
    s = (raw or "").replace("\xa0", " ").strip()
    s = s.replace("\\(", "").replace("\\)", "")
    s = re.sub(r"[\[\]\(\)]", "", s)
    s = re.sub(r"\s+", "", s)
    s = s.replace(";", ",").replace("−", "-").replace("–", "-")
    s = s.replace("∞", "inf").replace("⁢", "")
    return s.lower()


def _choice_rows_from_table(table_html: str) -> list[tuple[str, str]]:
    from rebuild_choice_tasks_from_all_json import (
        _RE_TABLE_CELL,
        _RE_TABLE_ROW,
        _cell_plain_text,
        _row_choice_number,
    )

    items: list[tuple[str, str]] = []
    for row_m in _RE_TABLE_ROW.finditer(table_html or ""):
        cells = _RE_TABLE_CELL.findall(row_m.group(1))
        if not cells:
            continue
        num = None
        num_idx = 0
        for i, cell in enumerate(cells):
            num = _row_choice_number(cell)
            if num is not None:
                num_idx = i
                break
        if num is None:
            continue
        body_parts = cells[num_idx + 1 :] if num_idx + 1 < len(cells) else []
        if not body_parts:
            body_parts = [cells[num_idx]]
        body = " ".join(_cell_plain_text(c) for c in body_parts).strip()
        if body and not re.fullmatch(r"\d+\)?", body.replace(" ", "")):
            items.append((num, body))
    return items


def _find_choice_table_html(html: str) -> str | None:
    from fipi_html_normalize import _RE_INNER_TABLE, choice_options_table_html

    table = choice_options_table_html(html)
    if table:
        return table

    from rebuild_choice_tasks_from_all_json import _RE_TABLE_CELL, _RE_TABLE_ROW, _row_choice_number

    best = None
    best_numbered = 0
    for m in _RE_INNER_TABLE.finditer(html or ""):
        candidate = m.group(0)
        numbered = 0
        for row_m in _RE_TABLE_ROW.finditer(candidate):
            cells = _RE_TABLE_CELL.findall(row_m.group(1))
            if any(_row_choice_number(cell) is not None for cell in cells):
                numbered += 1
        if numbered > best_numbered:
            best_numbered = numbered
            best = candidate
    return best if best_numbered >= 2 else None


def normalized_text_choice_sig(html: str) -> tuple[str, ...] | None:
    table = _find_choice_table_html(html)
    if not table:
        return None
    texts: list[str] = []
    for _num, body in _choice_rows_from_table(table):
        norm = _normalize_interval_text(body)
        if norm:
            texts.append(norm)
    return tuple(texts) if len(texts) >= 2 else None


@lru_cache(maxsize=1)
def _load_all_json_rows() -> list[dict]:
    if not ALL_JSON.is_file():
        return []
    return json.loads(ALL_JSON.read_text(encoding="utf-8"))


@lru_cache(maxsize=1)
def _choice_matchers():
    from rebuild_choice_tasks_from_all_json import (
        _inequality_gif_json_rows,
        build_json_indexes,
    )

    data = _load_all_json_rows()
    by_png, by_gif_folder, _by_text = build_json_indexes(data)
    json_gif = _inequality_gif_json_rows(data)
    return by_png, by_gif_folder, json_gif


@lru_cache(maxsize=1)
def _json_by_normalized_text() -> dict[tuple[str, ...], dict]:
    idx: dict[tuple[str, ...], dict] = {}
    for row in _load_all_json_rows():
        sig = normalized_text_choice_sig(row.get("task_html") or "")
        if sig:
            idx[sig] = row
    return idx


@lru_cache(maxsize=1)
def _gif_neighbor_assignments() -> dict[int, tuple[dict, str]]:
    import psycopg2

    from rebuild_choice_tasks_from_all_json import match_gif_by_png_neighbors

    by_png, _by_gif, json_gif = _choice_matchers()
    db = {
        "dbname": os.environ.get("PGDATABASE", "itflux"),
        "user": os.environ.get("PGUSER", "postgres"),
        "password": os.environ.get("PGPASSWORD", "postgres"),
        "host": os.environ.get("PGHOST", "localhost"),
        "port": os.environ.get("PGPORT", "5432"),
    }
    try:
        conn = psycopg2.connect(**db)
        cur = conn.cursor()
        cur.execute(
            """
            SELECT id, task_template FROM "Generator_task"
            WHERE is_active = TRUE AND created_by = 'ФИПИ'
              AND task_template ~* '<table'
            ORDER BY id
            """
        )
        db_rows = cur.fetchall()
        cur.close()
        conn.close()
        return match_gif_by_png_neighbors(db_rows, list(json_gif), by_png)
    except Exception:
        return {}


def _is_bare_gif_only_task(html: str) -> bool:
    if not html_has_bare_fipi_innerimg(html):
        return False
    if re.search(r"xs3qvrsrc[^\"'\s>]+\.(?:png|gif)", html, re.IGNORECASE):
        return False
    return bool(re.search(r"task_files/innerimg[1-4]\.gif", html, re.IGNORECASE))


@lru_cache(maxsize=64)
def _ordinal_gif_inequality_rows(task_list_id: int, subtopic_id: int | None) -> tuple[int, ...]:
    import psycopg2

    db = {
        "dbname": os.environ.get("PGDATABASE", "itflux"),
        "user": os.environ.get("PGUSER", "postgres"),
        "password": os.environ.get("PGPASSWORD", "postgres"),
        "host": os.environ.get("PGHOST", "localhost"),
        "port": os.environ.get("PGPORT", "5432"),
    }
    try:
        conn = psycopg2.connect(**db)
        cur = conn.cursor()
        if subtopic_id is None:
            cur.execute(
                """
                SELECT id, task_template FROM "Generator_task"
                WHERE is_active = TRUE AND task_id = %s AND subtopic_id IS NULL
                ORDER BY id
                """,
                (task_list_id,),
            )
        else:
            cur.execute(
                """
                SELECT id, task_template FROM "Generator_task"
                WHERE is_active = TRUE AND task_id = %s AND subtopic_id = %s
                ORDER BY id
                """,
                (task_list_id, subtopic_id),
            )
        ids = [row_id for row_id, tpl in cur.fetchall() if _is_bare_gif_only_task(tpl or "")]
        cur.close()
        conn.close()
        return tuple(ids)
    except Exception:
        return ()


@lru_cache(maxsize=1)
def _json_gif_inequality_rows() -> tuple[dict, ...]:
    from rebuild_choice_tasks_from_all_json import _inequality_gif_json_rows

    data = _load_all_json_rows()
    rows = _inequality_gif_json_rows(data)
    filtered = [
        r[2]
        for r in rows
        if re.search(r"неравенств", (r[2].get("task_html") or ""), re.IGNORECASE)
    ]
    return tuple(filtered)


def _ordinal_json_row(task_db_id: int, task_list_id: int, subtopic_id: int | None) -> dict | None:
    db_ids = _ordinal_gif_inequality_rows(task_list_id, subtopic_id)
    json_rows = _json_gif_inequality_rows()
    if not db_ids or not json_rows:
        return None
    try:
        idx = db_ids.index(task_db_id)
    except ValueError:
        return None
    if idx >= len(json_rows):
        return None
    return json_rows[idx]


def _should_full_replace(how: str) -> bool:
    return how in ("png", "gif-folder", "text-norm") or (how or "").startswith("gif-neighbor")


def _resolve_json_row(
    html: str,
    *,
    task_db_id: int | None,
    task_list_id: int | None,
    subtopic_id: int | None,
    gif_assignments: dict,
) -> tuple[dict | None, str]:
    from rebuild_choice_tasks_from_all_json import match_db_row

    by_png, by_gif_folder, _json_gif = _choice_matchers()
    row, how = match_db_row(html, by_png, by_gif_folder, {})
    if row:
        return row, how or "match"

    nsig = normalized_text_choice_sig(html)
    if nsig:
        row = _json_by_normalized_text().get(nsig)
        if row:
            return row, "text-norm"

    if task_db_id is not None and task_db_id in gif_assignments:
        row, how = gif_assignments[task_db_id]
        return row, how

    if (
        task_db_id is not None
        and task_list_id is not None
        and _is_bare_gif_only_task(html)
    ):
        row = _ordinal_json_row(task_db_id, task_list_id, subtopic_id)
        if row:
            return row, "ordinal-gif"

    return None, ""


def _fipi_folder_from_row(row: dict) -> str | None:
    for src in row.get("images") or []:
        m = _RE_FIPI_FOLDER.search(str(src))
        if m:
            return m.group(1).upper()
    m = _RE_FIPI_FOLDER.search(row.get("task_html") or "")
    return m.group(1).upper() if m else None


def _fipi_docs_base_from_row(row: dict) -> str | None:
    for src in row.get("images") or []:
        m = _RE_FIPI_DOCS_BASE.search(str(src))
        if m:
            return m.group(1)
    m = _RE_FIPI_DOCS_BASE.search(row.get("task_html") or "")
    return m.group(1) if m else None


def _innerimg_urls_from_json_row(row: dict, *, only_nums: set[int] | None = None) -> dict[int, str]:
    urls: dict[int, str] = {}
    for src in row.get("images") or []:
        m = _RE_FIPI_INNERIMG_URL.search(str(src))
        if m:
            urls[int(m.group(2))] = m.group(0)
    for m in _RE_FIPI_INNERIMG_URL.finditer(row.get("task_html") or ""):
        urls[int(m.group(2))] = m.group(0)

    need = only_nums if only_nums is not None else set(range(5))
    folder = _fipi_folder_from_row(row)
    if folder and need - set(urls):
        base = _fipi_docs_base_from_row(row) or (
            f"https://oge.fipi.ru/docs/DE0E276E497AB3784C3FC4CC20248DC0/questions/{folder}"
        )
        for n in need:
            urls.setdefault(n, f"{base}/innerimg{n}.gif")
    return {k: v for k, v in urls.items() if k in need}


def _bare_innerimg_nums(html: str) -> set[int]:
    nums: set[int] = set()
    for m in _RE_BARE_INNERIMG.finditer(html or ""):
        nums.add(int(m.group(1)))
    return nums


def _local_filename_for_fipi_url(url: str) -> str:
    from import_tasks_universal import media_filename_from_url

    return media_filename_from_url(url)


def _media_src_for_fipi_url(url: str, download: Callable[[str], str | None] | None) -> str:
    if download:
        try:
            local = download(url)
            if local:
                return f"/media/{local}"
        except Exception:
            pass
    return f"/media/task_files/{_local_filename_for_fipi_url(url)}"


def rewrite_bare_innerimg_srcs(
    html: str,
    innerimg_urls: dict[int, str],
    *,
    download: Callable[[str], str | None] | None = None,
) -> str:
    if not html or not innerimg_urls:
        return html

    out = html
    for num, fipi_url in sorted(innerimg_urls.items()):
        if not fipi_url or "innerimg" not in fipi_url.lower():
            continue
        filename = _media_src_for_fipi_url(fipi_url, download).rsplit("/", 1)[-1]

        def _repl_bare(m: re.Match[str], fname: str = filename) -> str:
            return f"{m.group(1)}{m.group(2)}{fname}{m.group(3)}"

        out = re.sub(
            rf'((?:src|href)\s*=\s*["\'])([^"\']*task_files/)innerimg{num}\.gif(["\'])',
            _repl_bare,
            out,
            flags=re.IGNORECASE,
        )

        def _repl_remote(m: re.Match[str], fname: str = filename) -> str:
            return f'{m.group(1)}/media/task_files/{fname}{m.group(2)}'

        out = re.sub(
            rf'((?:src|href)\s*=\s*["\'])https?://[^"\']+/questions/[A-F0-9]{{32}}/innerimg{num}\.gif(["\'])',
            _repl_remote,
            out,
            flags=re.IGNORECASE,
        )
    return out


def _apply_full_json_html(
    row: dict,
    *,
    download: Callable[[str], str | None] | None,
) -> str | None:
    from fipi_html_normalize import normalize_fipi_task_html

    raw = (row.get("task_html") or "").strip()
    if not raw:
        return None
    return normalize_fipi_task_html(raw, download=download)


def repair_bare_fipi_innerimg_html(
    html: str,
    *,
    task_db_id: int | None = None,
    task_list_id: int | None = None,
    subtopic_id: int | None = None,
    download: Callable[[str], str | None] | None = None,
) -> str:
    if not html_needs_fipi_choice_repair(html):
        return html

    gif_assignments = _gif_neighbor_assignments()
    row, how = _resolve_json_row(
        html,
        task_db_id=task_db_id,
        task_list_id=task_list_id,
        subtopic_id=subtopic_id,
        gif_assignments=gif_assignments,
    )

    if row and (_should_full_replace(how) or how == "ordinal-gif"):
        full = _apply_full_json_html(row, download=download)
        if full:
            return full

    if not row:
        remote_urls = {
            int(m.group(2)): m.group(0) for m in _RE_FIPI_INNERIMG_URL.finditer(html)
        }
        if remote_urls:
            return rewrite_bare_innerimg_srcs(html, remote_urls, download=download)
        return html

    # Запасной путь: только innerimg, которые реально есть в HTML (без синтеза лишних).
    bare_nums = _bare_innerimg_nums(html)
    remote_nums = {
        int(m.group(2))
        for m in _RE_FIPI_INNERIMG_URL.finditer(html or "")
    }
    nums = bare_nums | remote_nums
    if not nums:
        return html

    innerimg_urls = _innerimg_urls_from_json_row(row, only_nums=nums)
    if not innerimg_urls:
        return html

    return rewrite_bare_innerimg_srcs(html, innerimg_urls, download=download)
