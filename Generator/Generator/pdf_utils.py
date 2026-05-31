"""PDF generation helpers."""
import base64
import hashlib
import os
import re
import tempfile
from pathlib import Path
from urllib.parse import urlparse
from django.conf import settings as django_settings
from django.contrib.staticfiles import finders
from django.utils.safestring import mark_safe

from .latex_utils import process_latex, batch_render_mathjax, extract_latex_formulas
from .models import TaskPreview


def _title_is_part_2(title: str) -> bool:
    t = (title or "").lower()
    return "часть" in t and "2" in t and "12" not in t and "21" not in t


SUBJECT_GENITIVE = {
    "inf": "информатике",
    "math": "математике",
    "math_base": "математике (база)",
    "phys": "физике",
    "hist": "истории",
    "bio": "биологии",
    "soc": "обществознанию",
    "rus": "русскому языку",
    "lit": "литературе",
    "geo": "географии",
    "eng": "английскому языку",
    "chem": "химии",
}

EXAM_DURATION_MINUTES = {
    ("ege", "inf"): 235,
    ("ege", "math"): 235,
    ("ege", "math_base"): 180,
    ("ege", "phys"): 235,
    ("ege", "hist"): 210,
    ("ege", "bio"): 235,
    ("ege", "soc"): 210,
    ("ege", "rus"): 210,
    ("ege", "lit"): 235,
    ("ege", "geo"): 180,
    ("ege", "eng"): 180,
    ("ege", "chem"): 210,
    ("oge", "inf"): 150,
    ("oge", "math"): 235,
    ("oge", "phys"): 180,
    ("oge", "hist"): 180,
    ("oge", "bio"): 180,
    ("oge", "soc"): 180,
    ("oge", "rus"): 235,
    ("oge", "lit"): 235,
    ("oge", "geo"): 150,
    ("oge", "eng"): 135,
    ("oge", "chem"): 180,
}


def _format_ru_balls(n) -> str:
    """Возвращает строку «1 балл / 2 балла / 5 баллов»."""
    try:
        num = int(n)
    except (TypeError, ValueError):
        num = 0
    abs_n = abs(num) % 100
    last = abs_n % 10
    if 11 <= abs_n <= 14:
        return f"{num} баллов"
    if last == 1:
        return f"{num} балл"
    if 2 <= last <= 4:
        return f"{num} балла"
    return f"{num} баллов"


def _answers_columns_for_pdf(rows: list) -> list[list]:
    """Делим карточки ответов на 1/2/3 колонки заранее — чтобы CSS multi-column
    в WeasyPrint не рвал карточки на границе колонки (видимый артефакт-«огрызок»)."""
    if not rows:
        return []
    n = len(rows)
    if n <= 8:
        cols_count = 1
    elif n <= 14:
        cols_count = 2
    else:
        cols_count = 3
    per_col = (n + cols_count - 1) // cols_count
    return [rows[i * per_col:(i + 1) * per_col] for i in range(cols_count) if rows[i * per_col:(i + 1) * per_col]]


def get_pdf_css():
    css_path = finders.find('css/pdf.css')
    if not css_path:
        css_path = os.path.join(django_settings.STATIC_ROOT or '', 'css', 'pdf.css')
    if css_path and os.path.exists(css_path):
        with open(css_path, 'r', encoding='utf-8') as f:
            return f.read()
    return ''


MATH_CSS = mark_safe("""<style>
/* MathJax SVG output — color для WeasyPrint (currentColor заменяется в latex_utils) */
.math-display { display: block; text-align: center; margin: .85em 0; font-size: 1.28em; color: #111827; }
.math-display svg { display: inline-block; vertical-align: middle; max-width: 100%; }
.math-inline { display: inline; vertical-align: middle; color: #111827; font-size: 1.12em; }
.math-inline svg { display: inline-block; vertical-align: middle; }
/* Fallback: HTML math (frac, sqrt, etc.) when MathJax unavailable */
.frac { display: inline-block; vertical-align: middle; text-align: center; margin: 0 .15em; }
.num { display: block; border-bottom: 1px solid #000; padding: 0 .2em .1em; min-width: 1em; }
.den { display: block; padding: .1em .2em 0; }
.sqrt-arg { border-top: 1px solid #000; padding: 0 .1em; }
.math-env { display: block; margin: .5em 0 .5em 1em; }
.math-row { display: block; margin: .2em 0; }
.cases-table { display: inline-table; vertical-align: middle; border-collapse: collapse; margin: .3em 0; }
.cases-brace { font-size: 2.2em; line-height: 1; padding-right: .15em; vertical-align: middle; font-family: serif; font-weight: 100; }
.cases-row { padding: .15em 0; }
.array-table { display: inline-table; border-collapse: collapse; margin: .3em 0; table-layout: fixed; }
.array-cell { padding: 0 .4em; text-align: center; width: 1%; }
.mf { font-style: normal; }
sup { font-size: .75em; vertical-align: super; }
sub { font-size: .75em; vertical-align: sub; }
/* verbatim (код) — MathJax не поддерживает */
.latex-verbatim { display: block; margin: .5em 0; font-family: "DejaVu Sans Mono", "DejaVuSansMono", monospace; font-size: 0.9em; background: #f5f5f5; padding: .5em; border-radius: 4px; }
</style>""")


_RE_IMG_SRC = re.compile(r'src=["\']([^"\']+)["\']', re.IGNORECASE)

# Удаляем у элементов внутри таблиц все цветовые inline-объявления
# (color/background/border-*) — FIPI-HTML часто красит ячейки оранжевым через
# style="..." или <font color=...>. CSS не может перебить inline-!important,
# поэтому правим HTML.
_RE_TABLE_BLOCK = re.compile(r"<table\b[^>]*>.*?</table>", re.IGNORECASE | re.DOTALL)
_RE_ANY_TAG = re.compile(r"<(/?)(\w+)([^>]*)>", re.IGNORECASE)
_RE_STYLE_ATTR = re.compile(
    r"""\sstyle\s*=\s*(?:"([^"]*)"|'([^']*)')""",
    re.IGNORECASE,
)
_RE_BGCOLOR_ATTR = re.compile(r"""\s(bgcolor|color)\s*=\s*(?:"[^"]*"|'[^']*'|\S+)""", re.IGNORECASE)


def _strip_color_declarations(style_value: str) -> str:
    """Убираем декларации color/background*/border* из строки style."""
    kept: list[str] = []
    for decl in style_value.split(";"):
        decl_stripped = decl.strip()
        if not decl_stripped:
            continue
        prop = decl_stripped.split(":", 1)[0].strip().lower()
        if prop in ("color", "background", "background-color", "background-image"):
            continue
        if prop.startswith("border"):
            continue
        kept.append(decl_stripped)
    return "; ".join(kept)


def _clean_attrs(attrs: str) -> str:
    """Удаляет color/bgcolor атрибуты и чистит style от цветовых деклараций."""
    attrs = _RE_BGCOLOR_ATTR.sub("", attrs)

    def replace_style(sm: "re.Match[str]") -> str:
        raw = sm.group(1) if sm.group(1) is not None else sm.group(2)
        cleaned = _strip_color_declarations(raw or "")
        return f' style="{cleaned}"' if cleaned else ""

    return _RE_STYLE_ATTR.sub(replace_style, attrs)


def _clean_table_block(block: str) -> str:
    """В пределах одного <table>...</table> чистим все теги."""

    def replace_tag(m: "re.Match[str]") -> str:
        closing = m.group(1) or ""
        tag = m.group(2)
        attrs = m.group(3) or ""
        tag_lc = tag.lower()
        if tag_lc == "font":
            return "</span>" if closing else "<span>"
        if closing:
            return f"</{tag}>"
        return f"<{tag}{_clean_attrs(attrs)}>"

    return _RE_ANY_TAG.sub(replace_tag, block)


def strip_table_inline_colors(html: str) -> str:
    """Чистит inline-цвета во всех таблицах HTML — включая потомков и <font>."""
    if not html or "<table" not in html.lower():
        return html
    return _RE_TABLE_BLOCK.sub(lambda m: _clean_table_block(m.group(0)), html)


_RE_OGE_INF_13_REQS = re.compile(
    # «Требования к оформлению (работы|презентации)» … «три блока текста;»
    # с возможной обёрткой в <p>/<h{1-6}> и любыми тегами/<br> внутри.
    r"(?:<(?:p|h[1-6])\b[^>]*>\s*)?"
    r"Требовани[яе]\s+к\s+оформлению\s+(?:работы|презентации)"
    r"[\s\S]*?три\s+блока\s+текста\s*[;:.\u2026]?"
    r"\s*(?:</(?:p|h[1-6])>)?",
    re.IGNORECASE,
)

_RE_OGE_INF_13_EMPTY_P = re.compile(
    r"<p\b[^>]*>\s*(?:&nbsp;|\u00a0|\s|<br\s*/?>)*\s*</p>",
    re.IGNORECASE,
)


def strip_oge_inf_13_requirements(html: str) -> str:
    """Удаляет стандартный блок «Требования к оформлению …» из HTML задания 13 ОГЭ
    информатики для PDF: пользователь просит не дублировать инструкции из шапки варианта."""
    if not html or "Требовани" not in html:
        return html
    new_html, n = _RE_OGE_INF_13_REQS.subn("", html, count=1)
    if n == 0:
        return html
    # Подчищаем пустые абзацы, оставшиеся после вырезания
    new_html = _RE_OGE_INF_13_EMPTY_P.sub("", new_html)
    return new_html.lstrip()
_RE_DATA_IMAGE = re.compile(r'^data:image/(\w+);base64,', re.IGNORECASE)
_MAX_DATA_URL_LEN = 16_000  # Data URL длиннее — во временный файл (WeasyPrint нестабилен с большими base64)


def _resolve_image_url(url: str, request=None) -> str:
    """Преобразует URL изображения в file:// для надёжной загрузки WeasyPrint."""
    if not url:
        return url
    url = url.strip()

    # data:image URL → временный файл (WeasyPrint нестабилен с base64, file:// надёжнее)
    if url.startswith("data:image/") and ";base64," in url[:50]:
        if len(url) > _MAX_DATA_URL_LEN:  # только длинные — короткие иконки оставляем
            try:
                m = _RE_DATA_IMAGE.match(url)
                ext = (m.group(1).lower() if m else "png").replace("jpeg", "jpg")
                data = base64.b64decode(url.split(",", 1)[1])
                fd, path = tempfile.mkstemp(suffix=f".{ext}", prefix="weasy_img_")
                try:
                    os.write(fd, data)
                finally:
                    os.close(fd)
                return Path(path).as_uri()
            except Exception:
                pass
        return url

    if url.startswith("http://") or url.startswith("https://"):
        return url

    # /media/ или media/ — локальный файл
    media_root = django_settings.MEDIA_ROOT
    rel_path = None
    if url.startswith("/media/"):
        rel_path = url[len("/media/"):].lstrip("/")
    elif url.startswith("media/"):
        rel_path = url[len("media/"):].lstrip("/")

    if rel_path and media_root:
        local_path = Path(media_root) / rel_path.replace("/", os.sep)
        if local_path.exists():
            return local_path.as_uri()
        if request and url.startswith("/media/"):
            return request.build_absolute_uri(url)

    # Относительные пути — абсолютный URL
    if request and url and not url.startswith(("http", "data:", "file:")):
        return request.build_absolute_uri(url if url.startswith("/") else "/" + url)

    return url


def rewrite_content_image_urls(html: str, request=None) -> str:
    """Заменяет относительные URL изображений на file:// для PDF."""
    def replacer(m):
        old_url = m.group(1)
        new_url = _resolve_image_url(old_url, request)
        safe_url = new_url.replace('"', "%22")
        return f'src="{safe_url}"'
    return _RE_IMG_SRC.sub(replacer, html)


def resolve_background_image(filename: str, request=None) -> str:
    if not filename:
        return ""
    img_path = finders.find(filename)
    if not img_path:
        img_path = os.path.join(django_settings.STATIC_ROOT or "", filename)
    if img_path and os.path.exists(img_path):
        return f"file://{img_path}"
    if request:
        base = (django_settings.STATIC_URL or "/").rstrip("/")
        rel = filename.lstrip("/")
        return request.build_absolute_uri(f"{base}/{rel}")
    return ""


def build_pdf_context(request, variant, subject, author_filter=None):
    contents = list(
        variant.variantcontent_set
        .select_related('task', 'task__task', 'task__task__part')
        .order_by('order')
    )
    author_trimmed = (author_filter or "").strip()
    if author_trimmed:
        contents = [c for c in contents if (c.task.author or "").strip() == author_trimmed]

    # Batch-render all LaTeX formulas (tasks + answers) in one Node.js call before processing
    all_formulas = []
    for item in contents:
        raw = str(item.task.task_template or "").strip()
        if raw:
            all_formulas.extend(extract_latex_formulas(raw))
        raw_ans = str(item.task.answer or "").strip()
        if raw_ans:
            all_formulas.extend(extract_latex_formulas(raw_ans))
    if all_formulas:
        unique_formulas = list(dict.fromkeys(all_formulas))
        batch_render_mathjax(unique_formulas)

    processed_contents = []
    seen_parts = []
    answers_by_part = {}

    def fix_pdf_html(html: str) -> str:
        """Исправление &аmp; (кириллическая а), двойного escape и LaTeX \\& для PDF."""
        s = html.replace("&\u0430mp;", "&amp;").replace("&amp;amp;", "&amp;")
        # LaTeX tabular: \& → & в тексте запросов; в HTML иногда остаётся буквально
        s = re.sub(r"\\&", "&", s)
        s = s.replace("&#92;&", "&")
        return s

    level_short = str(getattr(variant.level, "level", "") or "").lower()
    is_oge_inf_pdf = (subject == "inf" and level_short == "oge")

    for item in contents:
        raw_text = str(item.task.task_template or "").strip()
        tasklist_obj = getattr(item.task, "task", None)
        task_number_int = getattr(tasklist_obj, "task_number", None)
        is_oge_inf_13_task = is_oge_inf_pdf and task_number_int == 13
        if raw_text and is_oge_inf_13_task:
            raw_text = strip_oge_inf_13_requirements(raw_text)
        if not raw_text:
            rendered_text = mark_safe("<p>&nbsp;</p>")
        else:
            html = process_latex(raw_text, for_pdf=True)
            html = fix_pdf_html(html)
            html = strip_table_inline_colors(html)
            html = rewrite_content_image_urls(html, request)
            rendered_text = mark_safe(html)
        part_obj = item.task.task.part
        part = part_obj.part_title if part_obj else None
        part_id = part_obj.pk if part_obj else None

        # Обработка LaTeX и HTML в ответах (часть 2)
        raw_answer = str(item.task.answer or "").strip()
        if raw_answer:
            html = process_latex(raw_answer, for_pdf=True)
            html = fix_pdf_html(html)
            html = strip_table_inline_colors(html)
            html = rewrite_content_image_urls(html, request)
            rendered_answer = mark_safe(html)
        else:
            rendered_answer = ""

        if part not in seen_parts:
            seen_parts.append(part)

        file_url = None
        if item.task.files:
            f = item.task.files
            # Всегда используем HTTP(S) URL для ссылок в PDF — file:// не работает при просмотре PDF на другом устройстве
            try:
                url = f.url
                if url:
                    file_url = request.build_absolute_uri(url)
            except Exception:
                pass
            if not file_url and f.name:
                media_url = getattr(django_settings, "MEDIA_URL", "/media/") or "/media/"
                rel = (media_url.rstrip("/") + "/" + f.name.lstrip("/")).replace("//", "/")
                file_url = request.build_absolute_uri(rel)

        part_title_for = part_obj.part_title if part_obj else ""
        is_part_2 = _title_is_part_2(part_title_for or "")
        max_score = int(item.task.max_score or 1)
        max_score_phrase = _format_ru_balls(max_score)
        is_oge_inf_part_2 = is_oge_inf_pdf and is_part_2
        entry = {
            "type": "task",
            "order": item.order,
            "text": rendered_text,
            "answer": rendered_answer,
            "part": part,
            "part_id": part_id,
            "subject": subject,
            "file_url": file_url,
            "is_part_2": is_part_2,
            "is_oge_inf_part_2": is_oge_inf_part_2,
            "is_oge_inf_13": is_oge_inf_13_task,
            "task_number": task_number_int,
            "max_score": max_score,
            "max_score_phrase": max_score_phrase,
            "subdivision": (item.task.task.subdivision or "") if item.task.task else "",
            "is_long": is_part_2 or max_score > 1,
        }
        processed_contents.append(entry)
        answers_by_part.setdefault(part or "Без части", []).append(entry)

    # Получаем TaskPreview для subject/level и вставляем перед соответствующими частями
    previews = TaskPreview.objects.filter(
        subject=variant.var_subject,
        level=variant.level,
    ).select_related("part", "preview_type")

    previews_by_part = {}
    instruction_previews = []
    for pv in previews:
        raw_html = str(pv.task_preview_text or "").strip()
        if not raw_html:
            continue
        # ОГЭ информатика: в превью «Часть 2» иногда лежат «Требования к оформлению …» —
        # пользователь просит не показывать эту шапку в PDF.
        if is_oge_inf_pdf:
            raw_html = strip_oge_inf_13_requirements(raw_html)
        if not raw_html.strip():
            continue
        html = process_latex(raw_html, for_pdf=True)
        html = fix_pdf_html(html)
        html = strip_table_inline_colors(html)
        html = rewrite_content_image_urls(html, request)
        preview_html = mark_safe(html)
        pt = pv.preview_type
        pt_text = (pt.preview_type_text or "").lower()
        is_instruction = pt and "инструк" in pt_text
        is_reminder = pt and "напоминание" in pt_text
        block = {
            "type": "preview",
            "preview_html": preview_html,
            "part_title": pv.part.part_title if pv.part else None,
            "part_id": pv.part_id,
            "is_instruction": is_instruction,
            "is_reminder": is_reminder,
        }
        if pv.part_id is None:
            instruction_previews.append(block)
        else:
            previews_by_part.setdefault(pv.part_id, []).append(block)

    # Объединяем: инструкции в начале, затем задачи с превью перед каждой новой частью
    merged_contents = []
    last_part_id = object()  # sentinel
    part_2_seen = False

    def _is_part_2(item):
        title = (item.get("part_title") or item.get("part") or "").lower()
        return "часть" in title and "2" in title and "12" not in title and "21" not in title

    for block in instruction_previews:
        merged_contents.append(block)
    for entry in processed_contents:
        part_id = entry.get("part_id")
        if part_id != last_part_id and part_id is not None:
            for block in previews_by_part.get(part_id, []):
                if _is_part_2(block) and not part_2_seen:
                    block = dict(block)
                    block["start_new_page"] = True
                    part_2_seen = True
                merged_contents.append(block)
            last_part_id = part_id
        elif part_id != last_part_id and part_id is None:
            last_part_id = part_id
        if entry.get("type") == "task" and _is_part_2(entry) and not part_2_seen:
            entry = dict(entry)
            entry["start_new_page"] = True
            part_2_seen = True
        merged_contents.append(entry)

    answers_parts = [
        {"part": p, "items": answers_by_part[p]}
        for p in seen_parts
        if (p or "Без части") in answers_by_part
    ]

    subject_label = {
        "inf": "Информатика",
        "math": "Математика",
    }.get(subject, variant.var_subject.subject_name or str(subject))
    level_val = str(variant.level.level).lower()
    level_label = {"oge": "ОГЭ", "ege": "ЕГЭ"}.get(level_val, level_val.upper())
    if level_val.isdigit():
        level_label = f"{level_val} класс"
    header_subject_level = f"{subject_label}, {level_label}"
    header_logo = resolve_background_image("img/digital-flow-logo.png", request=request)
    header_variant = f"Вариант № {variant.id}"
    base_url = request.build_absolute_uri("/").rstrip("/") or "/"
    footer_left = mark_safe(f'© <a href="{base_url}" class="pdf-footer-link">Цифровой поток</a>')

    # Таблица(ы) ответов: вертикальные строки; при большом числе — две колонки на одной странице
    answers_columns = _answers_columns_for_pdf(list(processed_contents))

    # Инструкции — отдельно (одна колонка сверху), остальное — задачи и напоминания
    instruction_blocks = [b for b in merged_contents if b.get("type") == "preview" and b.get("is_instruction")]
    tasks_content = [b for b in merged_contents if b.get("type") != "preview" or not b.get("is_instruction")]

    tasks_segments = [{"mode": "columns", "items": tasks_content}]

    pdf_task_count = sum(1 for x in tasks_content if x.get("type") == "task")
    n = int(pdf_task_count)
    if n % 10 == 1 and n % 100 != 11:
        pdf_task_count_phrase = f"{n} задание"
    elif 2 <= (n % 10) <= 4 and (n % 100 < 10 or n % 100 >= 20):
        pdf_task_count_phrase = f"{n} задания"
    else:
        pdf_task_count_phrase = f"{n} заданий"
    pdf_task_meta_line = f"{subject_label} · {level_label} · {pdf_task_count_phrase}"
    parsed = urlparse(base_url)
    pdf_site_domain = (parsed.netloc or "").strip() or base_url.replace("https://", "").replace("http://", "").strip("/")

    subject_genitive = SUBJECT_GENITIVE.get(str(subject), (subject_label or "").lower())
    duration_min = EXAM_DURATION_MINUTES.get((level_val, str(subject)))
    if duration_min:
        exam_duration_label = f"{duration_min} минут"
        exam_duration_min = int(duration_min)
    else:
        exam_duration_label = ""
        exam_duration_min = 0
    pdf_header_subject_line = f"{level_label} по {subject_genitive}".strip()
    pdf_task_count_number = int(pdf_task_count)

    return {
        "variant": variant,
        "instruction_blocks": instruction_blocks,
        "tasks_content": tasks_content,
        "tasks_segments": tasks_segments,
        "contents": merged_contents,
        "answers_columns": answers_columns,
        "answers_parts": answers_parts,
        "math_styles": MATH_CSS,
        "pdf_css": get_pdf_css(),
        "subject": subject,
        "subject_label": subject_label,
        "level_label": level_label,
        "header_subject_level": header_subject_level,
        "header_logo": header_logo,
        "header_variant": header_variant,
        "footer_left": footer_left,
        "pdf_task_meta_line": pdf_task_meta_line,
        "pdf_task_count_phrase": pdf_task_count_phrase,
        "pdf_site_domain": pdf_site_domain,
        "pdf_header_subject_line": pdf_header_subject_line,
        "subject_genitive": subject_genitive,
        "exam_duration_label": exam_duration_label,
        "exam_duration_min": exam_duration_min,
        "pdf_task_count_number": pdf_task_count_number,
    }


_SUBJECT_NOMINATIVE = {
    "inf": "Информатика",
    "math": "Математика",
    "math_base": "Математика (база)",
    "phys": "Физика",
    "hist": "История",
    "bio": "Биология",
    "soc": "Обществознание",
    "rus": "Русский язык",
    "lit": "Литература",
    "geo": "География",
    "eng": "Английский язык",
    "chem": "Химия",
}

_LEVEL_LABEL = {"oge": "ОГЭ", "ege": "ЕГЭ"}


def build_pdf_filename(variant) -> tuple[str, str]:
    """Имя сохраняемого PDF варианта.

    Возвращает (ascii_fallback, pretty_utf8) — первое для устаревших клиентов
    (Content-Disposition filename=...), второе для filename*=UTF-8'' (RFC 5987),
    его и видит пользователь в современном браузере.
    """
    level_short = (getattr(variant.level, "level", "") or "").strip().lower()
    subj_short = (getattr(variant.var_subject, "subject_short", "") or "").strip().lower()
    subj_full = (getattr(variant.var_subject, "subject_name", "") or "").strip()
    subject_label = _SUBJECT_NOMINATIVE.get(subj_short) or subj_full or (subj_short or "Вариант")
    level_label = _LEVEL_LABEL.get(level_short, level_short.upper() or "")
    pretty_bits = [f"Вариант {variant.id}", subject_label]
    if level_label:
        pretty_bits.append(level_label)
    pretty = " — ".join(pretty_bits) + ".pdf"
    ascii_fallback = f"variant_{variant.id}_{subj_short or 'x'}_{level_short or 'x'}.pdf"
    return ascii_fallback, pretty


def get_pdf_cache_path(variant_id, theme, author_filter=None):
    safe_theme = theme or "default"
    base_dir = django_settings.MEDIA_ROOT or os.path.join(django_settings.BASE_DIR, "media")
    cache_dir = os.path.join(base_dir, "pdfs")
    os.makedirs(cache_dir, exist_ok=True)
    suffix = f"variant_{variant_id}_{safe_theme}"
    if author_filter:
        author_slug = hashlib.md5(author_filter.encode("utf-8")).hexdigest()[:12]
        suffix = f"{suffix}_author_{author_slug}"
    return os.path.join(cache_dir, f"{suffix}.pdf")
