"""
Универсальный импорт задач из Excel в Generator_task.

Настройте секцию КОНФИГУРАЦИЯ под нужный файл и запустите:
    python import_tasks_universal.py

Поддерживает:
  - несколько ссылок в files_urls / img_url / audio_url в одной ячейке;
  - разделители: ; , пробелы, переносы строк, %20;
  - скачивание нескольких файлов одной задачи с упаковкой в ZIP;
  - скачивание нескольких картинок и добавление их в task_template;
  - импорт аудио из audio_url в поле files с игнорированием .gif и других картинок;
  - теги из справочника TagOption (несколько штук на задачу);
  - автора задачи (колонка author / автор или AUTHOR_DEFAULT);
  - тему программы (колонка theme / тема): ищет или создаёт TaskList
    для SUBJECT+LEVEL, затем к нему привязывает subtopic.

Тема программы (Generator_tasklist):
  В Excel колонка theme / тема / Theme с названием, например:
      Дроби и проценты
  Скрипт ищет TaskList с таким task_title у SUBJECT/LEVEL.
  Если нет — создаёт новый номер (task_number = max+1) и запись.
  Дальше по этому task_list_id создаётся/ищется subtopic (COL_SUBTOPIC).

  Старый способ через номер задания тоже работает (COL_TASK_NUMBER),
  если theme пустой.
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
EXCEL_FILE = "/opt/itfluxacademy/itflux/oge_rus_1_6.xlsx"
# EXCEL_FILE = "/Users/darsorokina/Desktop/oge_rus_1_6.xlsx"
# Колонка с текстом задачи.
COL_TASK = "task_template"

# Колонка с URL файлов.
# Можно хранить несколько ссылок в одной ячейке:
#   https://.../27-115a.txt; https://.../27-115b.txt
#   https://.../27-115a.txt https://.../27-115b.txt
#   https://.../27-115a.txt
#   https://.../27-115b.txt
COL_FILES = None

# Колонка с URL аудио/файлов аудиозадания.
# Если в этой колонке ФИПИ вместе с аудио отдаёт .gif-прелоадер,
# .gif и другие картинки будут проигнорированы.
COL_AUDIO = "audio_url"

# Колонка с URL изображений.
# Можно хранить несколько ссылок в одной ячейке.
COL_IMAGES = None

# Колонка с ответом.
COL_ANSWER = None

# Тема программы → Generator_tasklist.task_title (предмет/уровень из SUBJECT/LEVEL).
# Пример ячейки: «Дроби и проценты». Если темы нет в БД — создаётся автоматически.
COL_THEME = "theme"

# Номер задания ЕГЭ/ОГЭ (запасной способ, если theme пустой).
# В старых файлах колонка часто называется tasklist_id.
COL_TASK_NUMBER = None  # например "tasklist_id"

# Колонка с подтемой (создаётся под найденным/созданным TaskList).
COL_SUBTOPIC = "subtopic"

# Колонка с created_by, если есть. Если None или пусто — используется CREATED_BY_DEFAULT.
COL_CREATED_BY = "created_by"

# Колонка с автором задачи (поле author в БД).
# Если None — ищем сами: author / автор / Author.
# Если ячейка пустая — берётся AUTHOR_DEFAULT.
COL_AUTHOR = None  # например "author"

# Автор по умолчанию для всех задач этого импорта (если в Excel пусто).
AUTHOR_DEFAULT = ""

# Колонка с тегами задачи (опционально). Несколько тегов в ячейке через ; , | или перевод строки.
# Примеры значения ячейки: "novice; expert"  или  "Новичок, Есть в ЕГЭ"
COL_TAGS = None  # например "tags" / "теги"

# Теги по умолчанию для ВСЕХ задач этого импорта (slug или подпись из справочника).
# Пример: TAGS = ["novice"]  или  TAGS = ["difficulty:expert", "есть-в-егэ"]
TAGS = []

# Предмет и уровень для поиска/создания TaskList.
SUBJECT = "algebra"
LEVEL = "school"

# Если темы (TaskList) нет в БД — создать автоматически.
CREATE_TASKLIST_IF_MISSING = True

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
# part_id для новых TaskList (1 = часть 1).
TASKLIST_PART_ID = 1
# subdivision для новых TaskList: "" / "alg" / "geom"
TASKLIST_SUBDIVISION = ""

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


IMAGE_EXTENSIONS = {".gif", ".png", ".jpg", ".jpeg", ".webp", ".svg", ".bmp", ".ico"}
AUDIO_EXTENSIONS = {".mp3", ".wav", ".ogg", ".oga", ".m4a", ".aac", ".flac", ".wma", ".opus"}


def _url_extension(url: str) -> str:
    """Возвращает расширение из пути URL без query-параметров."""
    path = unquote(urlparse(url or "").path)
    return os.path.splitext(path)[1].lower()


def filter_audio_file_urls(urls: list[str]) -> list[str]:
    """
    Чистит ссылки из audio_url.

    В аудиоколонке ФИПИ иногда вместе с настоящим файлом лежит .gif
    или другая декоративная картинка. Их не скачиваем и не кладём в поле files.

    Логика:
      - картинки игнорируем всегда;
      - аудиофайлы оставляем;
      - ссылки без расширения или с нестандартным расширением тоже оставляем,
        потому что ФИПИ может отдавать файл через getfile/download.
    """
    result = []
    seen = set()

    for url in urls:
        clean = (url or "").strip()
        if not clean:
            continue

        ext = _url_extension(clean)

        if ext in IMAGE_EXTENSIONS:
            print(f"    [audio skip image] {clean}")
            continue

        if clean not in seen:
            result.append(clean)
            seen.add(clean)

    return result


def resolve_optional_column(df: pd.DataFrame, preferred: str | None, aliases: list[str]) -> str | None:
    """
    Находит колонку без падения на старых Excel.
    Например: audio_url / audio_urls / audio / audio_file.
    """
    if preferred and preferred in df.columns:
        return preferred

    lower_map = {str(c).strip().lower(): c for c in df.columns}
    for alias in aliases:
        col = lower_map.get(alias.lower())
        if col:
            return col

    return None


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
_task_list_theme_cache: dict[tuple[str, str, str], int | None] = {}
_subtopic_cache: dict[tuple[int, str], int] = {}
_subject_level_cache: dict[tuple[str, str], tuple[int, int] | None] = {}


def resolve_subject_level_ids(cur, subject_short: str, level_slug: str) -> tuple[int, int] | None:
    key = (subject_short, level_slug)
    if key in _subject_level_cache:
        return _subject_level_cache[key]

    cur.execute(
        """
        SELECT s.id, l.id
        FROM "Generator_subject" s
        CROSS JOIN "Generator_level" l
        WHERE s.subject_short = %s
          AND l.level = %s
        LIMIT 1
        """,
        (subject_short, level_slug),
    )
    row = cur.fetchone()
    if not row:
        _subject_level_cache[key] = None
        return None
    ids = (int(row[0]), int(row[1]))
    _subject_level_cache[key] = ids
    return ids


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


def resolve_or_create_task_list_by_theme(
    cur,
    subject_short: str,
    level_slug: str,
    theme_title: str,
) -> int | None:
    """
    Находит TaskList по названию темы (task_title) для SUBJECT/LEVEL
    или создаёт новый (task_number = max+1), если CREATE_TASKLIST_IF_MISSING.
    """
    title = " ".join((theme_title or "").split()).strip()
    if not title:
        return None
    # CharField(max_length=100)
    title = title[:100]

    cache_key = (subject_short, level_slug, title.casefold())
    if cache_key in _task_list_theme_cache:
        return _task_list_theme_cache[cache_key]

    cur.execute(
        """
        SELECT tl.id
        FROM "Generator_tasklist" tl
        JOIN "Generator_subject" s ON tl.subject_id = s.id
        JOIN "Generator_level" l ON tl.level_id = l.id
        WHERE s.subject_short = %s
          AND l.level = %s
          AND lower(btrim(tl.task_title)) = lower(%s)
        ORDER BY tl.task_number, tl.id
        LIMIT 1
        """,
        (subject_short, level_slug, title),
    )
    row = cur.fetchone()
    if row:
        task_list_id = int(row[0])
        _task_list_theme_cache[cache_key] = task_list_id
        return task_list_id

    if not CREATE_TASKLIST_IF_MISSING:
        _task_list_theme_cache[cache_key] = None
        return None

    ids = resolve_subject_level_ids(cur, subject_short, level_slug)
    if not ids:
        print(
            f"    [theme] предмет/уровень не найдены: "
            f"{subject_short} / {level_slug}"
        )
        _task_list_theme_cache[cache_key] = None
        return None

    subject_id, level_id = ids
    cur.execute(
        """
        SELECT COALESCE(MAX(task_number), 0) + 1
        FROM "Generator_tasklist"
        WHERE subject_id = %s
          AND level_id = %s
        """,
        (subject_id, level_id),
    )
    next_number = int(cur.fetchone()[0])

    subdivision = (TASKLIST_SUBDIVISION or "").strip()
    part_id = TASKLIST_PART_ID if TASKLIST_PART_ID else None

    cur.execute(
        """
        INSERT INTO "Generator_tasklist"
            (subject_id, level_id, part_id, task_number, task_title, max_score, subdivision)
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        RETURNING id
        """,
        (
            subject_id,
            level_id,
            part_id,
            next_number,
            title,
            MAX_SCORE,
            subdivision,
        ),
    )
    task_list_id = int(cur.fetchone()[0])
    _task_list_theme_cache[cache_key] = task_list_id
    _task_list_cache[(subject_short, level_slug, next_number)] = task_list_id
    print(
        f"    [theme] создана тема «{title}» "
        f"({subject_short}/{level_slug} №{next_number}, id={task_list_id})"
    )
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


def split_tags(value) -> list[str]:
    """Достаёт список тегов из ячейки Excel или строки конфига."""
    if value is None:
        return []
    try:
        if pd.isna(value):
            return []
    except TypeError:
        pass

    if isinstance(value, (list, tuple, set)):
        raw_parts = [str(v) for v in value]
    else:
        text = str(value).strip()
        if not text or text.lower() in {"nan", "none", "null"}:
            return []
        raw_parts = re.split(r"[;,\|\n\r]+", text)

    out: list[str] = []
    seen: set[str] = set()
    for part in raw_parts:
        tag = part.strip()
        if not tag:
            continue
        key = tag.casefold()
        if key in seen:
            continue
        seen.add(key)
        out.append(tag)
    return out


def resolve_tag_option_ids(cur, tags: list[str]) -> list[int]:
    """
    Резолвит теги справочника Generator_tagoption по:
      - slug (novice)
      - type:slug (difficulty:novice)
      - title / подпись (Новичок), без учёта регистра
    Не найденные теги печатает предупреждением и пропускает.
    """
    if not tags:
        return []

    ids: list[int] = []
    seen_ids: set[int] = set()

    for raw in tags:
        token = (raw or "").strip()
        if not token:
            continue

        row = None
        if ":" in token and not token.startswith("http"):
            type_slug, opt_slug = token.split(":", 1)
            type_slug = type_slug.strip()
            opt_slug = opt_slug.strip()
            if type_slug and opt_slug:
                cur.execute(
                    """
                    SELECT o.id
                    FROM "Generator_tagoption" o
                    JOIN "Generator_tagtype" t ON t.id = o.tag_type_id
                    WHERE o.is_active = TRUE
                      AND lower(t.slug) = lower(%s)
                      AND lower(o.slug) = lower(%s)
                    LIMIT 1
                    """,
                    (type_slug, opt_slug),
                )
                row = cur.fetchone()

        if row is None:
            cur.execute(
                """
                SELECT o.id
                FROM "Generator_tagoption" o
                WHERE o.is_active = TRUE
                  AND (
                    lower(o.slug) = lower(%s)
                    OR lower(o.title) = lower(%s)
                  )
                ORDER BY o.id
                LIMIT 1
                """,
                (token, token),
            )
            row = cur.fetchone()

        if not row:
            print(f"    [tag] не найден в справочнике: «{token}» — пропуск")
            continue

        tag_id = int(row[0])
        if tag_id in seen_ids:
            continue
        seen_ids.add(tag_id)
        ids.append(tag_id)

    return ids


def attach_task_tags(cur, task_id: int, tag_option_ids: list[int]) -> None:
    """Пишет M2M Generator_task_tag_options."""
    if not task_id or not tag_option_ids:
        return
    for tag_option_id in tag_option_ids:
        cur.execute(
            """
            INSERT INTO "Generator_task_tag_options" (task_id, tagoption_id)
            VALUES (%s, %s)
            ON CONFLICT (task_id, tagoption_id) DO NOTHING
            """,
            (task_id, tag_option_id),
        )


def insert_task(cur, payload: dict, now: datetime) -> int:
    cur.execute(
        """
        INSERT INTO "Generator_task"
            (task_template, files, answer, author, added_at, created_by,
             max_score, is_active, vpr_advanced, vpr_basic, truth_table_enabled,
             task_id, subtopic_id)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        RETURNING id
        """,
        (
            payload["task_template"],
            payload.get("local_file"),
            payload.get("answer", ""),
            payload.get("author") or None,
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
    task_id = cur.fetchone()[0]
    attach_task_tags(cur, task_id, payload.get("tag_option_ids") or [])
    return task_id


def main():
    TASK_FILES_DIR.mkdir(parents=True, exist_ok=True)

    df = pd.read_excel(EXCEL_FILE)
    audio_col = resolve_optional_column(
        df,
        COL_AUDIO,
        aliases=["audio_url", "audio_urls", "audio", "audio_file", "audio_files", "аудио", "айдио"],
    )

    print(f"Файл: {Path(EXCEL_FILE).name}  |  Строк: {len(df)}")
    print(f"Колонки: {list(df.columns)}")
    if audio_col:
        print(f"Аудио/файлы: колонка «{audio_col}»; .gif и картинки из неё игнорируются")
    else:
        print("Аудио/файлы: колонка не найдена, импорт аудио пропущен")

    if COL_THEME:
        print(
            f"Тема программы: колонка «{COL_THEME}» "
            f"(или aliases), предмет={SUBJECT}, уровень={LEVEL}, "
            f"автосоздание={'да' if CREATE_TASKLIST_IF_MISSING else 'нет'}"
        )
    if COL_TASK_NUMBER:
        print(
            f"Номер задания (fallback): колонка «{COL_TASK_NUMBER}», "
            f"предмет={SUBJECT}, уровень={LEVEL}"
        )
    if COL_SUBTOPIC:
        print(f"Подтема: колонка «{COL_SUBTOPIC}»")
    tags_col = resolve_optional_column(
        df,
        COL_TAGS,
        aliases=["tags", "tag", "теги", "тег", "tag_options"],
    )
    author_col = resolve_optional_column(
        df,
        COL_AUTHOR,
        aliases=["author", "автор", "Author", "AUTHOR"],
    )
    theme_col = resolve_optional_column(
        df,
        COL_THEME,
        aliases=["theme", "тема", "Theme", "task_title", "тема_программы"],
    )
    subtopic_col = resolve_optional_column(
        df,
        COL_SUBTOPIC,
        aliases=["subtopic", "подтема", "Subtopic", "sub_topic", "подтемы"],
    )
    if theme_col and theme_col != COL_THEME:
        print(f"Тема из Excel: колонка «{theme_col}»")
    if subtopic_col and COL_SUBTOPIC and subtopic_col != COL_SUBTOPIC:
        print(f"Подтема из Excel: колонка «{subtopic_col}»")
    if TAGS:
        print(f"Теги по умолчанию (TAGS): {TAGS}")
    if tags_col:
        print(f"Теги из Excel: колонка «{tags_col}»")
    if author_col:
        print(f"Автор: колонка «{author_col}»")
    elif AUTHOR_DEFAULT:
        print(f"Автор по умолчанию: «{AUTHOR_DEFAULT}»")
    print()

    # COL_AUDIO намеренно не требуем: старые Excel без аудиоколонки должны импортироваться как раньше.
    required_columns = [
        col for col in [COL_TASK, COL_FILES, COL_IMAGES, COL_ANSWER, COL_TASK_NUMBER]
        if col
    ]
    # theme / subtopic могут подхватиться по alias
    if COL_THEME and not theme_col:
        required_columns.append(COL_THEME)
    # подтема опциональна: если колонки нет — задачи без subtopic_id
    for col in required_columns:
        if col not in df.columns:
            raise SystemExit(f"В Excel нет колонки «{col}».")
    if not theme_col and not COL_TASK_NUMBER:
        raise SystemExit(
            "Нужна колонка темы (theme/тема) или номер задания (COL_TASK_NUMBER)."
        )
    if COL_SUBTOPIC and not subtopic_col:
        print(
            f"Подтема: колонка «{COL_SUBTOPIC}» не найдена — "
            "задачи будут без subtopic_id"
        )

    conn = psycopg2.connect(**DB)
    cur = conn.cursor()
    now = datetime.now(timezone.utc)

    default_tag_tokens = split_tags(TAGS)
    default_tag_ids = resolve_tag_option_ids(cur, default_tag_tokens)
    if default_tag_tokens:
        print(f"Теги по умолчанию резолвнуты: {len(default_tag_ids)} из {len(default_tag_tokens)}")
        print()

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
        author = (_cell_str(row, author_col) if author_col else "") or AUTHOR_DEFAULT

        row_tag_tokens = split_tags(row.get(tags_col)) if tags_col else []
        merged_tag_tokens: list[str] = []
        seen_tag_keys: set[str] = set()
        for token in [*default_tag_tokens, *row_tag_tokens]:
            key = token.casefold()
            if key in seen_tag_keys:
                continue
            seen_tag_keys.add(key)
            merged_tag_tokens.append(token)
        # Если только дефолтные — берём уже резолвнутые id; иначе резолвим смесь.
        if row_tag_tokens:
            tag_option_ids = resolve_tag_option_ids(cur, merged_tag_tokens)
        else:
            tag_option_ids = list(default_tag_ids)

        task_list_id = None
        subtopic_id = None

        theme_title = _cell_str(row, theme_col) if theme_col else ""
        if theme_title:
            task_list_id = resolve_or_create_task_list_by_theme(
                cur, SUBJECT, LEVEL, theme_title,
            )
            if task_list_id is None:
                print(
                    f"  [skip] строка {row_number}: тема «{theme_title}» не найдена "
                    f"({SUBJECT} / {LEVEL}"
                    f"{'' if CREATE_TASKLIST_IF_MISSING else ', CREATE_TASKLIST_IF_MISSING=False'})"
                )
                skip += 1
                continue
        elif COL_TASK_NUMBER:
            num_raw = _cell_str(row, COL_TASK_NUMBER)
            task_num = _parse_task_number(num_raw)

            if task_num is None:
                print(
                    f"  [skip] строка {row_number}: нет темы и нет номера задания "
                    f"(колонки theme / «{COL_TASK_NUMBER}»)"
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
        else:
            print(
                f"  [skip] строка {row_number}: пустая тема "
                f"и COL_TASK_NUMBER не задан"
            )
            skip += 1
            continue

        if subtopic_col:
            sub_title = _cell_str(row, subtopic_col)
            if sub_title:
                subtopic_id = resolve_subtopic_id(cur, task_list_id, sub_title)
                if subtopic_id is None:
                    print(
                        f"  [skip] строка {row_number}: подтема «{sub_title}» не найдена "
                        f"(CREATE_SUBTOPIC_IF_MISSING=False)"
                    )
                    skip += 1
                    continue

        # --- files + audio: один или несколько файлов ---
        # В БД поле files одно. Поэтому обычные files_urls и audio_url объединяем,
        # а если файлов несколько — make_zip_for_files упакует их в ZIP.
        local_file = None
        combined_file_urls = []

        if COL_FILES:
            combined_file_urls.extend(get_urls(row.get(COL_FILES)))

        if audio_col:
            audio_urls_raw = get_urls(row.get(audio_col))
            audio_urls = filter_audio_file_urls(audio_urls_raw)
            combined_file_urls.extend(audio_urls)

        # Дедупликация после объединения files_urls + audio_url.
        file_urls = []
        seen_file_urls = set()
        for file_url in combined_file_urls:
            if file_url and file_url not in seen_file_urls:
                file_urls.append(file_url)
                seen_file_urls.add(file_url)

        if file_urls:
            print(f"[{row_number}/{len(df)}] files/audio ({len(file_urls)} шт.):")

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
                    "author": author,
                    "created_by": created_by,
                    "task_list_id": task_list_id,
                    "subtopic_id": subtopic_id,
                    "tag_option_ids": tag_option_ids,
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
                    "author": author,
                    "created_by": created_by,
                    "task_list_id": task_list_id,
                    "subtopic_id": subtopic_id,
                    "tag_option_ids": tag_option_ids,
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