"""Публичные SEO-лендинги: мета, примеры из открытого каталога и гостевое демо.

Примеры берутся из тех же публичных данных, что карточки уроков, тренажёры и банк
задач. Ответы, решения и файлы учителя в ответ не попадают. Вариант для гостя
собирается в памяти и не создаёт запись Variant.
"""
import html
import logging
import random
import re
from urllib.parse import urlencode

from django.core.cache import cache
from django.http import JsonResponse
from django.views.decorators.http import require_GET

from Cabinet.rate_limit import rate_limit_check, rate_limit_json_response

from .models import InterestingItem, Lesson, Task
from .seo import BRAND, SITE_ORIGIN
from .seo_tasks import _excerpt, clean_task_html
from .vpr_pack_files import scrub_teacher_links

logger = logging.getLogger(__name__)

MATERIALS_LIMIT = 30
MATERIALS_WINDOW = 60
SAMPLE_LIMIT = 8
SAMPLE_WINDOW = 60
TASK_ID_CACHE_SECONDS = 300
MAX_TASK_IDS = 2400
PER_NUMBER_CAP = 6
EXAMPLE_LIMIT = 3
MIN_PLAIN = 40

_TASK8_RE = re.compile(r"(?:№|задани[ея]|номер)\s*8(?!\d)", re.I)
_INFORMATICS_RE = re.compile(r"информат", re.I)
_EXAM_RE = re.compile(r"егэ|огэ", re.I)
_MATH_SUBJECT = (
    "математ",
    "алгебр",
    "геометр",
    "теория вероятност",
)


def _title(h1):
    return f"{h1} | {BRAND}"


def _page(slug, h1, description, kind, level="", subject=""):
    return {
        "slug": slug,
        "path": "/" + slug,
        "h1": h1,
        "title": _title(h1),
        "description": description,
        "kind": kind,
        "level": level,
        "subject": subject,
    }


PAGES = (
    _page(
        "generator-variantov-ege-informatika",
        "Генератор вариантов ЕГЭ по информатике",
        "Соберите пример варианта ЕГЭ по информатике из задач открытого банка. "
        "Условия можно смотреть без регистрации, ответы и решения на странице не показываются.",
        "variant",
        "ege",
        "inf",
    ),
    _page(
        "generator-variantov-oge-matematika",
        "Генератор вариантов ОГЭ по математике",
        "Соберите пример варианта ОГЭ по математике из задач открытого банка. "
        "Гость видит условия заданий без регистрации, без ответов и решений.",
        "variant",
        "oge",
        "math",
    ),
    _page(
        "gotovye-uroki-po-matematike",
        "Готовые уроки по математике",
        "Опубликованные уроки по математике из каталога: тема и краткое описание открыты без входа. "
        "Файл урока доступен после регистрации.",
        "lessons",
    ),
    _page(
        "interaktivnye-zadaniya-oge-ege-informatika",
        "Интерактивные задания ОГЭ/ЕГЭ по информатике",
        "Открытые тренажёры по информатике для ОГЭ и ЕГЭ. "
        "Бесплатный интерактив из каталога можно пройти без регистрации.",
        "interactive",
    ),
    _page(
        "onlajn-doska-dlya-repetitora-matematiki",
        "Онлайн-доска для репетитора математики",
        "Доска для занятия по математике в браузере: рисуйте и стирайте без регистрации. "
        "Рисунок остаётся на этом устройстве и не сохраняется на сервере.",
        "board",
    ),
)

PAGE_BY_SLUG = {page["slug"]: page for page in PAGES}
PAGE_BY_PATH = {page["path"]: page for page in PAGES}


def page_by_slug(slug):
    return PAGE_BY_SLUG.get(slug or "")


def page_by_path(path):
    path = path or "/"
    if len(path) > 1:
        path = path.rstrip("/") or "/"
    return PAGE_BY_PATH.get(path)


def register_path(slug):
    query = urlencode(
        (
            ("mode", "register"),
            ("role", "teacher"),
            ("utm_source", "seo"),
            ("utm_medium", "landing"),
            ("utm_campaign", slug),
        )
    )
    return f"/cabinet/login?{query}"


def meta_for(path):
    page = page_by_path(path)
    if page is None:
        return None
    canonical = SITE_ORIGIN + page["path"]
    links = [(other["h1"], other["path"]) for other in PAGES if other["path"] != page["path"]]
    return {
        "title": page["title"],
        "description": page["description"],
        "canonical": canonical,
        "h1": page["h1"],
        "noindex": False,
        "public": True,
        "links": links,
        "ld": [
            {
                "@context": "https://schema.org",
                "@type": "WebPage",
                "name": page["h1"],
                "description": page["description"],
                "url": canonical,
                "inLanguage": "ru",
                "isAccessibleForFree": True,
                "publisher": {
                    "@type": "Organization",
                    "name": BRAND,
                    "url": SITE_ORIGIN + "/",
                },
            }
        ],
    }


def _public_task_ids(level, subject):
    key = f"seo-landing-task-ids:{level}:{subject}"
    grouped = cache.get(key)
    if grouped is not None:
        return grouped
    rows = (
        Task.objects.filter(
            is_active=True,
            scope=Task.Scope.GLOBAL,
            task__level__level=level,
            task__subject__subject_short=subject,
        )
        .order_by("task__task_number", "id")
        .values_list("id", "task__task_number")[:MAX_TASK_IDS]
    )
    grouped = {}
    for task_id, number in rows:
        if number is None:
            continue
        bucket = grouped.setdefault(int(number), [])
        if len(bucket) < PER_NUMBER_CAP:
            bucket.append(task_id)
    cache.set(key, grouped, TASK_ID_CACHE_SECONDS)
    return grouped


def _task_payload(task):
    raw = str(task.task_template or "")
    body, _images, external = clean_task_html(raw)
    plain = _excerpt(raw, 100000)
    if external or len(plain) < MIN_PLAIN or len(body) > 30000:
        return None
    spec = task.answer_spec if isinstance(getattr(task, "answer_spec", None), dict) else None
    files = spec.get("files") if spec else None
    body = scrub_teacher_links(body, files)
    task_list = task.task
    number = task_list.task_number if task_list else None
    level = task_list.level.level if task_list and task_list.level_id else ""
    subject = task_list.subject.subject_short if task_list and task_list.subject_id else ""
    href = f"/zadaniya/{level}/{subject}/{number}" if level and subject and number is not None else ""
    subtopic = task.subtopic.title if task.subtopic_id and task.subtopic else ""
    title = (task_list.task_title if task_list else "") or f"Задание {number}"
    return {
        "kind": "task",
        "id": task.id,
        "task_number": number,
        "title": title,
        "subtopic": subtopic,
        "text": _excerpt(plain, 420),
        "html": body[:12000],
        "href": href,
    }


def _first_usable(task_ids):
    tasks = Task.objects.filter(
        id__in=task_ids, is_active=True, scope=Task.Scope.GLOBAL
    ).select_related("task", "task__level", "task__subject", "subtopic")
    by_id = {task.id: task for task in tasks}
    for task_id in task_ids:
        task = by_id.get(task_id)
        if task is None:
            continue
        payload = _task_payload(task)
        if payload:
            return payload
    return None


def public_task_examples(level, subject, *, limit=EXAMPLE_LIMIT, randomize=False):
    grouped = _public_task_ids(level, subject)
    numbers = sorted(grouped)
    if randomize:
        random.shuffle(numbers)
    chosen = []
    for number in numbers:
        if len(chosen) >= limit:
            break
        payload = _first_usable(grouped[number])
        if payload:
            chosen.append(payload)
    return chosen


def _math_subject(lesson):
    subject = (lesson.subject or "").strip().lower()
    return subject.startswith(_MATH_SUBJECT)


def _lesson_rows(limit):
    rows = [
        lesson
        for lesson in Lesson.objects.filter(status=Lesson.Status.PUBLISHED)
        .exclude(access_level=Lesson.AccessLevel.PRIVATE)
        .filter(exam_type__in=(Lesson.ExamType.OGE, Lesson.ExamType.EGE))
        .order_by("id")
        if _math_subject(lesson)
    ]
    free = [lesson for lesson in rows if (lesson.access_level or "free") in ("free", "")]
    pool = free or rows
    pool.sort(key=lambda lesson: (lesson.task_number is None, lesson.task_number or 0, lesson.id))
    return pool[:limit]


def _lesson_payload(lesson):
    exam = {"oge": "ОГЭ", "ege": "ЕГЭ"}.get(lesson.exam_type or "", "")
    text = _excerpt(lesson.short_description or lesson.topic or "", 420)
    return {
        "kind": "lesson",
        "id": lesson.id,
        "slug": lesson.slug,
        "title": lesson.title,
        "subject": lesson.subject,
        "topic": lesson.topic or "",
        "exam_type": lesson.exam_type or "",
        "exam_label": exam,
        "task_number": lesson.task_number,
        "duration_minutes": lesson.duration_minutes,
        "text": text,
        "href": f"/lessons/{lesson.slug}/view",
    }


def _can_play_interesting(item):
    if item.status != InterestingItem.Status.PUBLISHED:
        return False
    if not item.file and not item.archive:
        return False
    from Cabinet.interesting_access import InterestingAccessService

    access = InterestingAccessService.get_access(None, item)
    return bool(access.get("can_view") and access.get("is_full"))


def _interactive_score(item):
    title = item.title or ""
    score = 0
    if _INFORMATICS_RE.search(title):
        score += 5
    if _EXAM_RE.search(title):
        score += 3
    if _TASK8_RE.search(title):
        score += 8
    return score


def _interactive_rows(limit):
    rows = []
    published = InterestingItem.objects.filter(status=InterestingItem.Status.PUBLISHED).order_by("id")
    for item in published:
        if not _INFORMATICS_RE.search(item.title or ""):
            continue
        if not _can_play_interesting(item):
            continue
        rows.append(item)
    rows.sort(key=lambda item: (-_interactive_score(item), item.id))
    return rows[:limit]


def _interactive_payload(item):
    return {
        "kind": "interactive",
        "id": item.id,
        "slug": item.slug,
        "title": item.title,
        "text": _excerpt(item.short_description or "", 420),
        "tag": item.tag or "",
        "href": f"/interesting/{item.slug}/view",
        "view_path": f"/api/interesting/{item.slug}/view/",
    }


def materials_for(page):
    kind = page["kind"]
    if kind == "variant":
        return public_task_examples(page["level"], page["subject"])
    if kind == "board":
        return public_task_examples("oge", "math")
    if kind == "lessons":
        return [_lesson_payload(lesson) for lesson in _lesson_rows(EXAMPLE_LIMIT)]
    if kind == "interactive":
        return [_interactive_payload(item) for item in _interactive_rows(EXAMPLE_LIMIT)]
    return []


def public_payload(page):
    materials = materials_for(page)
    play = None
    if page["kind"] == "interactive" and materials:
        first = materials[0]
        play = {
            "slug": first["slug"],
            "title": first["title"],
            "view_path": first["view_path"],
        }
    return {
        "slug": page["slug"],
        "path": page["path"],
        "h1": page["h1"],
        "title": page["title"],
        "description": page["description"],
        "canonical": SITE_ORIGIN + page["path"],
        "kind": page["kind"],
        "materials": materials,
        "play": play,
        "register_path": register_path(page["slug"]),
    }


def prerender_body(path):
    page = page_by_path(path)
    if page is None:
        return ""
    try:
        materials = materials_for(page)
    except Exception:
        logger.exception("seo landing examples failed for %s", path)
        materials = []
    parts = ['<section class="seo-prerender-examples"><h2>Примеры из открытого каталога</h2>']
    if not materials:
        parts.append("<p>Примеры подставляются из открытого каталога, когда они есть в банке.</p>")
    for item in materials:
        parts.append("<article>")
        parts.append(f"<h3>{html.escape(item.get('title') or '')}</h3>")
        if item.get("text"):
            parts.append(f"<p>{html.escape(item['text'])}</p>")
        href = item.get("href") or ""
        if href:
            parts.append(f'<p><a href="{html.escape(href, quote=True)}">Открыть материал</a></p>')
        parts.append("</article>")
    parts.append(
        f'<p><a href="{html.escape(register_path(page["slug"]), quote=True)}">Зарегистрироваться</a></p>'
    )
    parts.append("</section>")
    return "".join(parts)


def _lastmod(page):
    from django.db.models import Max

    kind = page["kind"]
    if kind in ("variant", "board"):
        level = page["level"] or "oge"
        subject = page["subject"] or "math"
        if kind == "board":
            level, subject = "oge", "math"
        return Task.objects.filter(
            is_active=True,
            scope=Task.Scope.GLOBAL,
            task__level__level=level,
            task__subject__subject_short=subject,
        ).aggregate(moment=Max("updated_at"))["moment"]
    if kind == "lessons":
        rows = _lesson_rows(EXAMPLE_LIMIT)
        return max((lesson.updated_at for lesson in rows), default=None)
    if kind == "interactive":
        rows = _interactive_rows(EXAMPLE_LIMIT)
        return max((item.updated_at for item in rows), default=None)
    return None


def sitemap_rows():
    rows = []
    for page in PAGES:
        try:
            moment = _lastmod(page)
        except Exception:
            logger.exception("seo landing lastmod failed for %s", page["slug"])
            moment = None
        lastmod = moment.date().isoformat() if moment else None
        rows.append((SITE_ORIGIN + page["path"], lastmod, "weekly", "0.8"))
    return rows


def _landing_response(payload, *, store=True):
    response = JsonResponse(payload)
    if store:
        response["Cache-Control"] = "public, max-age=120"
    else:
        response["Cache-Control"] = "no-store"
    return response


@require_GET
def api_landing(request, slug):
    if not rate_limit_check(request, "seo_landing", MATERIALS_LIMIT, MATERIALS_WINDOW):
        return rate_limit_json_response("seo_landing")
    page = page_by_slug(slug)
    if page is None:
        return JsonResponse({"error": "not_found"}, status=404)
    try:
        payload = public_payload(page)
    except Exception:
        logger.exception("seo landing payload failed for %s", slug)
        return JsonResponse({"error": "unavailable"}, status=500)
    return _landing_response(payload, store=True)


@require_GET
def api_landing_sample(request, slug):
    if not rate_limit_check(request, "seo_landing_sample", SAMPLE_LIMIT, SAMPLE_WINDOW):
        return rate_limit_json_response("seo_landing_sample")
    page = page_by_slug(slug)
    if page is None or page["kind"] != "variant":
        return JsonResponse({"error": "not_found"}, status=404)
    try:
        tasks = public_task_examples(page["level"], page["subject"], randomize=True)
    except Exception:
        logger.exception("seo landing sample failed for %s", slug)
        return JsonResponse({"error": "unavailable"}, status=500)
    return _landing_response({"tasks": tasks}, store=False)
