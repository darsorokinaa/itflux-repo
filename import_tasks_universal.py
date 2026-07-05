"""
Универсальный импорт задач из Excel в Generator_task.

Настройте секцию КОНФИГУРАЦИЯ под нужный файл и запустите:
    python import_tasks_universal.py

Поддерживает:
  - несколько ссылок в files_urls / img_url в одной ячейке;
  - разделители: ; , пробелы, переносы строк, %20;
  - скачивание нескольких файлов одной задачи с упаковкой в ZIP;
  - скачивание нескольких картинок и добавление их в task_template.
"""

import json
import os
import re
import zipfile
import hashlib
from pathlib import Path
from datetime import datetime, timezone
from urllib.parse import urlparse, unquote
import html as html_lib

import pandas as pd
import requests
import urllib3

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

import psycopg2

# normalize_fipi_task_html: mjx→LaTeX, картинки, разворот layout-таблиц ФИПИ
from fipi_html_normalize import (
    fipi_folder_ids,
    html_has_choice_options_table,
    html_has_task_question_text,
    normalize_fipi_task_html,
)

# ──────────────────────────── КОНФИГУРАЦИЯ ────────────────────────────────────

# Файл, который импортируем.
EXCEL_FILE = "/opt/itfluxacademy/itflux/27egeinf.xlsx"

# Колонка с текстом задачи.
COL_TASK = "task_template"

# Колонка с URL файлов.
# Можно хранить несколько ссылок в одной ячейке:
#   https://.../27-115a.txt; https://.../27-115b.txt
#   https://.../27-115a.txt https://.../27-115b.txt
#   https://.../27-115a.txt
#   https://.../27-115b.txt
COL_FILES = "files_urls"

# Колонка с URL изображений.
# Можно хранить несколько ссылок в одной ячейке.
COL_IMAGES = "img_url"

# Колонка с ответом.
COL_ANSWER = "answer"

# Колонка с номером задания ЕГЭ/ОГЭ.
# В твоих файлах она обычно называется tasklist_id, но по смыслу там номер задания: 26, 27 и т.д.
COL_TASK_NUMBER = "tasklist_id"

# Колонка с подтемой.
COL_SUBTOPIC = "subtopic"

# Колонка с created_by, если есть. Если None или пусто — используется CREATED_BY_DEFAULT.
COL_CREATED_BY = "created_by"

# Предмет и уровень для поиска TaskList.
SUBJECT = "inf"
LEVEL = "ege"

# Если подтемы нет в БД — создать автоматически.
CREATE_SUBTOPIC_IF_MISSING = True

# Склеивание строк ФИПИ, где условие и варианты оказались в разных строках.
MERGE_SPLIT_QUESTION_CHOICE_ROWS = True

# Полный HTML из парсера ФИПИ — подстановка для строк «только варианты».
ALL_JSON_PATH = Path(__file__).parent / "all.json"
USE_ALL_JSON_FOR_ORPHAN_CHOICES = True

# Значения полей БД.
CREATED_BY_DEFAULT = "admin_dasha"
MAX_SCORE = 1
IS_ACTIVE = True

# ──────────────────────────────────────────────────────────────────────────────

MEDIA_ROOT = Path(__file__).parent / "Generator" / "media"
TASK_FILES_DIR = MEDIA_ROOT / "task_files"

DB = {
    "dbname": os.environ.get("PGDATABASE", "itflux"),
    "user": os.environ.get("PGUSER", "itflux_user"),
    "password": os.environ.get("PGPASSWORD", "StrongPass123itflux2026"),
    "host": os.environ.get("PGHOST", "itflux-academy.ru"),
    "port": os.environ.get("PGPORT", "5433"),
}

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Referer": "https://kpolyakov.spb.ru/",
    "Accept": "*/*",
}


def split_urls(value) -> list[str]:
    """
    Достаёт ВСЕ ссылки из ячейки Excel.

    Исправляет проблему вида:
      https://site/a.txt;%20https://site/b.txt
      https://site/a.gif%20%20https://site/b.gif

    Результат:
      ["https://site/a.txt", "https://site/b.txt"]
    """
    if value is None:
        return []

    try:
        if pd.isna(value):
            return []
    except TypeError:
        pass

    text = html_lib.unescape(str(value)).strip()
    if not text or text.lower() in {"nan", "none", "null"}:
        return []

    # Частая проблема после Excel/CSV: пробелы закодированы как %20 между ссылками.
    # Для kpolyakov это безопасно: ссылки на файлы без пробелов.
    text = text.replace("%20", " ")
    text = text.replace("%3B", ";").replace("%3b", ";")
    text = text.replace("\\n", "\n")

    # Берём все http/https URL до пробела, ; или ,
    urls = re.findall(r"https?://[^\s;,]+", text)

    cleaned = []
    seen = set()
    for url in urls:
        url = url.strip().strip('"').strip("'").strip()
        # Убираем случайную пунктуацию в конце.
        url = url.rstrip(").]")
        if url and url not in seen:
            cleaned.append(url)
            seen.add(url)

    return cleaned


def media_filename_from_url(url: str) -> str:
    """
    Уникальное имя файла.

    Иначе одинаковые имена вроде 7581.gif или innerimg0.gif от разных задач
    могут перезаписываться.
    """
    url = url.strip()
    path = urlparse(url).path
    base = unquote(path.split("/")[-1] or "file")

    stem, ext = os.path.splitext(base)
    digest = hashlib.sha256(url.encode("utf-8")).hexdigest()[:12]

    if ext:
        return f"{stem}_{digest}{ext}"
    return f"{stem}_{digest}"


def download(url: str) -> str | None:
    """
    Скачивает один файл/картинку в Generator/media/task_files.
    Возвращает относительный путь для БД: task_files/filename.ext
    """
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


def make_zip_for_files(local_paths: list[str], row_number: int) -> str | None:
    """
    Если у задачи несколько файлов, поле files в БД всё равно одно.
    Поэтому упаковываем несколько скачанных файлов в ZIP и в БД кладём ZIP.

    local_paths — относительные пути вида task_files/name.txt.
    """
    local_paths = [p for p in local_paths if p]
    if not local_paths:
        return None

    if len(local_paths) == 1:
        return local_paths[0]

    digest = hashlib.sha256("|".join(local_paths).encode("utf-8")).hexdigest()[:12]
    zip_name = f"task_{row_number}_files_{digest}.zip"
    zip_path = TASK_FILES_DIR / zip_name

    if zip_path.exists():
        print(f"    [zip skip] {zip_name}")
        return f"task_files/{zip_name}"

    try:
        with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            for rel_path in local_paths:
                abs_path = MEDIA_ROOT / rel_path
                if abs_path.exists():
                    zf.write(abs_path, arcname=Path(rel_path).name)
        print(f"    [zip ok] {zip_name}")
        return f"task_files/{zip_name}"
    except Exception as e:
        print(f"    [zip err] {zip_name}: {e}")
        return local_paths[0] if local_paths else None


def _png_choice_sig(html: str) -> tuple[str, ...] | None:
    names = sorted(
        set(re.findall(r"xs3qvrsrc[^\"'\s>]+\.png", html or "", re.IGNORECASE))
    )
    return tuple(names) if len(names) >= 2 else None


def _load_all_json_choice_index() -> dict[tuple[str, ...], str]:
    """
    Сигнатура png-вариантов → полный task_html из all.json.
    """
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
    choices_html: str,
    index: dict[tuple[str, ...], str],
) -> str | None:
    sig = _png_choice_sig(choices_html)
    if sig and sig in index:
        return index[sig]
    return None


def get_urls(cell) -> list[str]:
    """
    Старое имя функции оставлено для совместимости.
    Теперь внутри используется нормальный парсер ссылок.
    """
    return split_urls(cell)


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


def resolve_task_list_id(
    cur,
    subject_short: str,
    level_slug: str,
    task_number: int,
) -> int | None:
    key = (subject_short, level_slug, task_number)
    if key in _task_list_cache:
        return _task_list_cache[key]

    cur.execute(
        """
        SELECT tl.id
        FROM "Generator_tasklist" tl
        JOIN "Generator_subject" s ON tl.subject_id = s.id
        JOIN "Generator_level" l ON tl.level_id = l.id
        WHERE s.subject_short = %s
          AND l.level = %s
          AND tl.task_number = %s
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
        SELECT id
        FROM "Generator_subtopic"
        WHERE task_list_id = %s
          AND title = %s
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


def insert_task(cur, payload: dict, now: datetime) -> None:
    cur.execute(
        """
        INSERT INTO "Generator_task"
            (task_template, files, answer, added_at, created_by,
             max_score, is_active, vpr_advanced, vpr_basic, truth_table_enabled,
             task_id, subtopic_id)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """,
        (
            payload["task_template"],
            payload.get("local_file"),
            payload.get("answer", ""),
            now,
            payload.get("created_by") or CREATED_BY_DEFAULT,
            MAX_SCORE,
            IS_ACTIVE,
            False,
            False,
            False,
            payload["task_list_id"],
            payload["subtopic_id"],
        ),
    )


def main():
    TASK_FILES_DIR.mkdir(parents=True, exist_ok=True)

    df = pd.read_excel(EXCEL_FILE)

    print(f"Файл: {Path(EXCEL_FILE).name}  |  Строк: {len(df)}")
    print(f"Колонки: {list(df.columns)}")

    if COL_TASK_NUMBER:
        print(
            f"Номер задания: колонка «{COL_TASK_NUMBER}», "
            f"предмет={SUBJECT}, уровень={LEVEL}"
        )
    if COL_SUBTOPIC:
        print(f"Подтема: колонка «{COL_SUBTOPIC}»")
    print()

    required_columns = [
        col for col in [COL_TASK, COL_FILES, COL_IMAGES, COL_ANSWER, COL_TASK_NUMBER, COL_SUBTOPIC]
        if col
    ]
    for col in required_columns:
        if col not in df.columns:
            raise SystemExit(f"В Excel нет колонки «{col}».")

    conn = psycopg2.connect(**DB)
    cur = conn.cursor()
    now = datetime.now(timezone.utc)

    ok = 0
    err = 0
    skip = 0
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
            insert_task(cur, pending_question, now)
            ok += 1
        except Exception as e:
            conn.rollback()
            print(f"  [DB ERR] отложенная строка {pending_question['row']}: {e}")
            err += 1

        pending_question = None

    for i, row in df.iterrows():
        row_number = i + 1

        raw_html = str(row[COL_TASK]) if pd.notna(row[COL_TASK]) else ""
        task_template = normalize_fipi_task_html(raw_html, download=download)

        answer = _cell_str(row, COL_ANSWER)
        created_by = _cell_str(row, COL_CREATED_BY) or CREATED_BY_DEFAULT

        task_list_id = None
        subtopic_id = None

        if COL_TASK_NUMBER:
            num_raw = _cell_str(row, COL_TASK_NUMBER)
            task_num = _parse_task_number(num_raw)

            if task_num is None:
                print(
                    f"  [skip] строка {row_number}: нет номера задания "
                    f"(колонка «{COL_TASK_NUMBER}»)"
                )
                skip += 1
                continue

            task_list_id = resolve_task_list_id(cur, SUBJECT, LEVEL, task_num)
            if task_list_id is None:
                print(
                    f"  [skip] строка {row_number}: TaskList не найден "
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
                            f"  [skip] строка {row_number}: подтема «{sub_title}» не найдена "
                            f"(CREATE_SUBTOPIC_IF_MISSING=False)"
                        )
                        skip += 1
                        continue

        # --- files: один или несколько файлов ---
        local_file = None
        if COL_FILES:
            file_urls = get_urls(row.get(COL_FILES))

            if file_urls:
                print(f"[{row_number}/{len(df)}] files ({len(file_urls)} шт.):")

            downloaded_files = []
            for file_url in file_urls:
                path = download(file_url)
                if path:
                    downloaded_files.append(path)

            local_file = make_zip_for_files(downloaded_files, row_number)

        # --- img: одна или несколько картинок ---
        if COL_IMAGES:
            img_urls = get_urls(row.get(COL_IMAGES))

            existing_imgs = {
                Path(urlparse(s).path).name.lower()
                for s in re.findall(
                    r'<img[^>]+src=["\']([^"\']+)["\']',
                    task_template,
                )
            }

            if img_urls:
                print(f"[{row_number}/{len(df)}] img ({len(img_urls)} шт.):")

            for img_url in img_urls:
                fname = Path(urlparse(img_url).path).name

                if fname and fname.lower() in existing_imgs:
                    print(f"    [skip] уже в тексте: {fname}")
                    continue

                path = download(img_url)
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
                        f"  [merge] строка {row_number} → варианты к строке "
                        f"{pending_question['row']} (папка {pending_folders & choice_folders})"
                    )
                    continue

                print(
                    f"  [merge-skip] строка {row_number}: папка вариантов {choice_folders} "
                    f"≠ условия {pending_folders} (строка {pending_question['row']})"
                )

                _flush_pending()

                full = _resolve_choices_from_all_json(task_template, all_json_index)
                if full:
                    task_template = normalize_fipi_task_html(full, download=download)
                    has_question = html_has_task_question_text(task_template)
                    has_choices = html_has_choice_options_table(task_template)
                    all_json_merged += 1
                    print(f"  [all.json] строка {row_number}: полная задача по сигнатуре вариантов")

            if has_question and not has_choices:
                _flush_pending()
                pending_question = {
                    "row": row_number,
                    "task_template": task_template,
                    "local_file": local_file,
                    "answer": answer,
                    "created_by": created_by,
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
                    print(f"  [all.json] строка {row_number}: только варианты → полная задача")

            if pending_question:
                _flush_pending()

        try:
            insert_task(
                cur,
                {
                    "task_template": task_template,
                    "local_file": local_file,
                    "answer": answer,
                    "created_by": created_by,
                    "task_list_id": task_list_id,
                    "subtopic_id": subtopic_id,
                },
                now,
            )
            ok += 1

        except Exception as e:
            conn.rollback()
            print(f"  [DB ERR] строка {row_number}: {e}")
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