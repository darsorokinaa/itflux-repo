"""
Универсальный импорт задач из Excel в Generator_task.

Настройте секцию КОНФИГУРАЦИЯ под нужный файл и запустите:
    python import_tasks_universal.py

В Excel добавьте колонки (имена настраиваются в КОНФИГУРАЦИИ):
  - task_number — номер задания (1, 2, 3 …) → привязка к TaskList (SUBJECT + LEVEL)
  - subtopic    — название подтемы → SubTopic (создаётся, если нет в БД)
"""
import json
import os
import re
import pandas as pd
import requests
import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
import psycopg2
from pathlib import Path
from datetime import datetime, timezone
from urllib.parse import urlparse

# normalize_fipi_task_html: mjx→LaTeX, картинки, разворот layout-таблиц ФИПИ (см. fipi_html_normalize.py)
from fipi_html_normalize import (
    fipi_folder_ids,
    html_has_choice_options_table,
    html_has_task_question_text,
    normalize_fipi_task_html,
)

# ──────────────────────────── КОНФИГУРАЦИЯ ────────────────────────────────────

EXCEL_FILE = "/Users/darsorokina/Desktop/Преподавание/result/inf_kes_4_6.xlsx"

# Колонка с текстом задачи.
# Для Excel из fipi_parser_inf_html.py используй "task_html" —
# эта колонка уже содержит <img src="https://..."> теги с картинками.
COL_TASK = "text"

# Колонка с URL файла для поля files (zip/pdf и т.п.), None — не используется
COL_FILES = 'file_url'       # ZIP-архив презентации

# Колонка с URL изображений для вставки в task_template, None — не используется
# Несколько URL в ячейке разделяются запятой ИЛИ переносом строки.
# Для fipi_parser_inf_html.py не нужно — картинки уже встроены в task_html.
COL_IMAGES = 'image_url'     # PNG/GIF слайды (через запятую)

# Колонка с ответом, None — пустая строка
COL_ANSWER = None    # например: "answer"

# Номер задания (ОГЭ/ЕГЭ) и подтема — привязка к TaskList / SubTopic в БД
COL_TASK_NUMBER = "task_number"   # None — не заполнять task_id
COL_SUBTOPIC = None      # None — не заполнять subtopic_id

# Предмет и уровень для поиска TaskList (subject_short и level.level в БД)
SUBJECT = "inf"   # например math, inf
LEVEL = "ege"      # например oge, ege, vpr

# Если подтемы нет в БД — создать автоматически (иначе только существующие)
CREATE_SUBTOPIC_IF_MISSING = True

# В Excel условие и варианты 1) 2) … часто в соседних строках — склеивать в одну задачу
MERGE_SPLIT_QUESTION_CHOICE_ROWS = True

# Полный HTML из парсера ФИПИ — подстановка для строк «только варианты» (другое ID папки в Excel)
ALL_JSON_PATH = Path(__file__).parent / "all.json"
USE_ALL_JSON_FOR_ORPHAN_CHOICES = True

# Значения полей БД
CREATED_BY = "ФИПИ"
MAX_SCORE  = 1
IS_ACTIVE  = True

# ──────────────────────────────────────────────────────────────────────────────

MEDIA_ROOT     = Path(__file__).parent / "Generator" / "media"
TASK_FILES_DIR = MEDIA_ROOT / "task_files"

DB = {
    "dbname":   os.environ.get("PGDATABASE", "itflux"),
    "user":     os.environ.get("PGUSER", "postgres"),
    "password": os.environ.get("PGPASSWORD", "postgres"),
    "host":     os.environ.get("PGHOST", "localhost"),
    "port":     os.environ.get("PGPORT", "5432"),
}

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Referer":    "https://oge.fipi.ru/",
    "Accept":     "*/*",
}


def media_filename_from_url(url: str) -> str:
    """Уникальное имя файла: иначе innerimg0.gif от разных задач перезаписывает друг друга."""
    path = urlparse(url.strip()).path
    m = re.search(r"questions/([A-F0-9]+)/([^/]+)$", path, re.IGNORECASE)
    if m:
        return f"{m.group(1)}_{m.group(2)}"
    base = path.split("/")[-1] or "file"
    stem, ext = os.path.splitext(base)
    digest = __import__("hashlib").sha256(url.encode()).hexdigest()[:12]
    return f"{stem}_{digest}{ext}" if ext else f"{stem}_{digest}"


def download(url: str) -> str | None:
    url = url.strip()
    filename = media_filename_from_url(url)
    dest = TASK_FILES_DIR / filename
    if dest.exists():
        print(f"    [skip] {filename}")
        return f"task_files/{filename}"
    try:
        r = requests.get(url, timeout=30, verify=False, headers=HEADERS)
        r.raise_for_status()
        dest.write_bytes(r.content)
        print(f"    [ok]   {filename}")
        return f"task_files/{filename}"
    except Exception as e:
        print(f"    [err]  {filename}: {e}")
        return None


def _png_choice_sig(html: str) -> tuple[str, ...] | None:
    names = sorted(
        set(re.findall(r"xs3qvrsrc[^\"'\s>]+\.png", html or "", re.IGNORECASE))
    )
    return tuple(names) if len(names) >= 2 else None


def _load_all_json_choice_index() -> dict[tuple[str, ...], str]:
    """Сигнатура png-вариантов → полный task_html из all.json."""
    if not USE_ALL_JSON_FOR_ORPHAN_CHOICES or not ALL_JSON_PATH.is_file():
        return {}
    data = json.loads(ALL_JSON_PATH.read_text(encoding="utf-8"))
    index: dict[tuple[str, ...], str] = {}
    for row in data:
        html = (row.get("task_html") or "").strip()
        sig = _png_choice_sig(html)
        if sig and html:
            index[sig] = html
    return index


def _resolve_choices_from_all_json(
    choices_html: str, index: dict[tuple[str, ...], str]
) -> str | None:
    sig = _png_choice_sig(choices_html)
    if sig and sig in index:
        return index[sig]
    return None


def get_urls(cell) -> list[str]:
    if not cell or (isinstance(cell, float)):
        return []
    # Поддерживаем оба сепаратора: запятая и перенос строки (ФИПИ использует \n)
    raw = str(cell).replace("\n", ",")
    return [u.strip() for u in raw.split(",") if u.strip()]


def _cell_str(row, col: str | None) -> str:
    if not col or col not in row.index:
        return ""
    v = row.get(col)
    if pd.isna(v):
        return ""
    return str(v).strip()


def _parse_task_number(raw: str) -> int | None:
    if not raw:
        return None
    s = str(raw).strip().replace(",", ".")
    try:
        n = int(float(s))
        return n if n > 0 else None
    except (TypeError, ValueError):
        return None


_task_list_cache: dict[tuple[str, str, int], int | None] = {}
_subtopic_cache: dict[tuple[int, str], int] = {}


def resolve_task_list_id(cur, subject_short: str, level_slug: str, task_number: int) -> int | None:
    key = (subject_short, level_slug, task_number)
    if key in _task_list_cache:
        return _task_list_cache[key]
    cur.execute(
        """
        SELECT tl.id
        FROM "Generator_tasklist" tl
        JOIN "Generator_subject" s ON tl.subject_id = s.id
        JOIN "Generator_level" l ON tl.level_id = l.id
        WHERE s.subject_short = %s AND l.level = %s AND tl.task_number = %s
        LIMIT 1
        """,
        (subject_short, level_slug, task_number),
    )
    row = cur.fetchone()
    task_list_id = row[0] if row else None
    _task_list_cache[key] = task_list_id
    return task_list_id


def resolve_subtopic_id(cur, task_list_id: int, title: str) -> int | None:
    title = (title or "").strip()
    if not title:
        return None
    key = (task_list_id, title)
    if key in _subtopic_cache:
        return _subtopic_cache[key]

    cur.execute(
        """
        SELECT id FROM "Generator_subtopic"
        WHERE task_list_id = %s AND title = %s
        LIMIT 1
        """,
        (task_list_id, title),
    )
    row = cur.fetchone()
    if row:
        _subtopic_cache[key] = row[0]
        return row[0]

    if not CREATE_SUBTOPIC_IF_MISSING:
        return None

    cur.execute(
        """
        SELECT COALESCE(MAX("order"), 0) + 1
        FROM "Generator_subtopic"
        WHERE task_list_id = %s
        """,
        (task_list_id,),
    )
    order = cur.fetchone()[0]
    cur.execute(
        """
        INSERT INTO "Generator_subtopic" (task_list_id, title, "order")
        VALUES (%s, %s, %s)
        RETURNING id
        """,
        (task_list_id, title, order),
    )
    subtopic_id = cur.fetchone()[0]
    _subtopic_cache[key] = subtopic_id
    print(f"    [subtopic] создана «{title}» (id={subtopic_id})")
    return subtopic_id


def main():
    TASK_FILES_DIR.mkdir(parents=True, exist_ok=True)

    df = pd.read_excel(EXCEL_FILE)
    print(f"Файл: {Path(EXCEL_FILE).name}  |  Строк: {len(df)}")
    print(f"Колонки: {list(df.columns)}")
    if COL_TASK_NUMBER:
        print(f"Номер задания: колонка «{COL_TASK_NUMBER}», предмет={SUBJECT}, уровень={LEVEL}")
    if COL_SUBTOPIC:
        print(f"Подтема: колонка «{COL_SUBTOPIC}»")
    print()

    if COL_TASK_NUMBER and COL_TASK_NUMBER not in df.columns:
        raise SystemExit(f"В Excel нет колонки «{COL_TASK_NUMBER}» для номера задания.")
    if COL_SUBTOPIC and COL_SUBTOPIC not in df.columns:
        raise SystemExit(f"В Excel нет колонки «{COL_SUBTOPIC}» для подтемы.")

    conn = psycopg2.connect(**DB)
    cur  = conn.cursor()
    now  = datetime.now(timezone.utc)
    ok, err, skip = 0, 0, 0
    merged_rows = 0
    all_json_merged = 0
    pending_question: dict | None = None
    all_json_index = _load_all_json_choice_index()
    if all_json_index:
        print(f"all.json: индекс вариантов (png): {len(all_json_index)} записей")

    def _flush_pending() -> None:
        nonlocal pending_question, ok, err
        if not pending_question:
            return
        try:
            cur.execute(
                """
                INSERT INTO "Generator_task"
                    (task_template, files, answer, added_at, created_by,
                     max_score, is_active, vpr_advanced, vpr_basic, truth_table_enabled,
                     task_id, subtopic_id)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    pending_question["task_template"],
                    pending_question.get("local_file"),
                    pending_question.get("answer", ""),
                    now,
                    CREATED_BY,
                    MAX_SCORE,
                    IS_ACTIVE,
                    False,
                    False,
                    False,
                    pending_question["task_list_id"],
                    pending_question["subtopic_id"],
                ),
            )
            ok += 1
        except Exception as e:
            conn.rollback()
            print(f"  [DB ERR] отложенная строка {pending_question['row']}: {e}")
            err += 1
        pending_question = None

    for i, row in df.iterrows():
        raw_html = str(row[COL_TASK]) if pd.notna(row[COL_TASK]) else ""
        task_template = normalize_fipi_task_html(raw_html, download=download)
        answer        = str(row[COL_ANSWER]) if COL_ANSWER and pd.notna(row[COL_ANSWER]) else ""

        task_list_id = None
        subtopic_id = None
        if COL_TASK_NUMBER:
            num_raw = _cell_str(row, COL_TASK_NUMBER)
            task_num = _parse_task_number(num_raw)
            if task_num is None:
                print(f"  [skip] строка {i+1}: нет номера задания (колонка «{COL_TASK_NUMBER}»)")
                skip += 1
                continue
            task_list_id = resolve_task_list_id(cur, SUBJECT, LEVEL, task_num)
            if task_list_id is None:
                print(
                    f"  [skip] строка {i+1}: TaskList не найден "
                    f"({SUBJECT} / {LEVEL} №{task_num})"
                )
                skip += 1
                continue
            if COL_SUBTOPIC:
                sub_title = _cell_str(row, COL_SUBTOPIC)
                if sub_title:
                    subtopic_id = resolve_subtopic_id(cur, task_list_id, sub_title)
                    if subtopic_id is None:
                        print(
                            f"  [skip] строка {i+1}: подтема «{sub_title}» не найдена "
                            f"(CREATE_SUBTOPIC_IF_MISSING=False)"
                        )
                        skip += 1
                        continue

        # --- files: одиночный файл (zip / pdf) ---
        local_file = None
        if COL_FILES:
            for url in get_urls(row.get(COL_FILES)):
                print(f"[{i+1}/{len(df)}] files:")
                local_file = download(url)
                break  # FileField хранит один файл

        # --- img: картинки вставляются в task_template ---
        # ВАЖНО: если в task_template уже встроен <img src="…/<filename>"> (например
        # парсер ФИПИ уже вставил картинку в текст), повторно добавлять её не нужно —
        # иначе на сайте картинка задваивается.
        if COL_IMAGES:
            urls = get_urls(row.get(COL_IMAGES))
            existing_imgs = {
                Path(urlparse(s).path).name.lower()
                for s in re.findall(r'<img[^>]+src=["\']([^"\']+)["\']', task_template)
            }
            if urls:
                print(f"[{i+1}/{len(df)}] img ({len(urls)} шт.):")
            for url in urls:
                fname = Path(urlparse(url).path).name
                if fname and fname.lower() in existing_imgs:
                    print(f"    [skip] уже в тексте: {fname}")
                    continue
                path = download(url)
                if path:
                    task_template += f'<p><img src="/media/{path}"></p>'
                    existing_imgs.add(fname.lower())

        has_choices = html_has_choice_options_table(task_template)
        has_question = html_has_task_question_text(task_template)

        if MERGE_SPLIT_QUESTION_CHOICE_ROWS:
            choice_folders = fipi_folder_ids(task_template)
            pending_folders = (
                fipi_folder_ids(pending_question["task_template"])
                if pending_question
                else set()
            )

            if pending_question and has_choices and not has_question:
                if pending_folders & choice_folders:
                    pending_question["task_template"] += task_template
                    merged_rows += 1
                    print(
                        f"  [merge] строка {i+1} → варианты к строке "
                        f"{pending_question['row']} (папка {pending_folders & choice_folders})"
                    )
                    continue
                print(
                    f"  [merge-skip] строка {i+1}: папка вариантов {choice_folders} "
                    f"≠ условия {pending_folders} (строка {pending_question['row']})"
                )
                _flush_pending()
                full = _resolve_choices_from_all_json(task_template, all_json_index)
                if full:
                    task_template = normalize_fipi_task_html(full, download=download)
                    has_question = html_has_task_question_text(task_template)
                    has_choices = html_has_choice_options_table(task_template)
                    all_json_merged += 1
                    print(f"  [all.json] строка {i+1}: полная задача по сигнатуре вариантов")
                # иначе ниже — вставка только вариантов (как раньше)

            if has_question and not has_choices:
                _flush_pending()
                pending_question = {
                    "row": i + 1,
                    "task_template": task_template,
                    "local_file": local_file,
                    "answer": answer,
                    "task_list_id": task_list_id,
                    "subtopic_id": subtopic_id,
                }
                continue

            if has_choices and not has_question and not pending_question:
                full = _resolve_choices_from_all_json(task_template, all_json_index)
                if full:
                    task_template = normalize_fipi_task_html(full, download=download)
                    has_question = html_has_task_question_text(task_template)
                    has_choices = html_has_choice_options_table(task_template)
                    all_json_merged += 1
                    print(f"  [all.json] строка {i+1}: только варианты → полная задача")

            if pending_question:
                _flush_pending()

        try:
            cur.execute(
                """
                INSERT INTO "Generator_task"
                    (task_template, files, answer, added_at, created_by,
                     max_score, is_active, vpr_advanced, vpr_basic, truth_table_enabled,
                     task_id, subtopic_id)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    task_template,
                    local_file,
                    answer,
                    now,
                    CREATED_BY,
                    MAX_SCORE,
                    IS_ACTIVE,
                    False,
                    False,
                    False,
                    task_list_id,
                    subtopic_id,
                ),
            )
            ok += 1
        except Exception as e:
            conn.rollback()
            print(f"  [DB ERR] строка {i+1}: {e}")
            err += 1
            continue

    _flush_pending()

    conn.commit()
    cur.close()
    conn.close()
    print(
        f"\nГотово! Вставлено: {ok}, пропущено: {skip}, ошибок: {err}, "
        f"склеено строк: {merged_rows}, из all.json: {all_json_merged}"
    )


if __name__ == "__main__":
    main()
