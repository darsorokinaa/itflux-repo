"""r35: SEO для публичных страниц SPA: мета-теги, canonical, JSON-LD, robots.txt, sitemap.xml.

Главный домен — itflux-academy.ru (самый посещаемый, на нём работает кабинет).
"""
import html
import json
import re

from django.utils import timezone

SITE_ORIGIN = "https://itflux-academy.ru"
SITE_HOST = "itflux-academy.ru"
BRAND = "Цифровой поток"
DEFAULT_DESCRIPTION = (
    "Цифровой поток — рабочее пространство учителя и репетитора: генератор вариантов ОГЭ и ЕГЭ "
    "в формате КИМ, банк из 25 000+ задач, готовые уроки, тренажёры, онлайн-доска и видеоуроки."
)
DEFAULT_OG_IMAGE = SITE_ORIGIN + "/og-image.png"  # r36: 1200x630

LEVEL_NAMES = {"oge": "ОГЭ", "ege": "ЕГЭ", "vpr": "ВПР", "school": "Школьная программа"}

STATIC_PAGES = {
    "/": (
        "Цифровой поток — генератор вариантов ОГЭ и ЕГЭ, уроки и кабинет учителя",
        DEFAULT_DESCRIPTION,
    ),
    "/pricing": (
        "Тарифы для репетиторов — " + BRAND,
        "Тарифы «Цифрового потока»: бесплатный Старт, Репетитор, Профи и Школа. "
        "Расписание, журнал, учёт оплат и проверка ДЗ доступны на всех тарифах.",
    ),
    "/repetitor": (
        "Платформа для репетитора: уроки, доска, ДЗ и учёт оплат — " + BRAND,
        "Всё для репетитора ОГЭ и ЕГЭ в одном кабинете: видеоурок с онлайн-доской, домашние задания "
        "с автопроверкой, расписание, журнал, учёт оплат и кабинет родителя.",
    ),
    "/lessons": (
        "Готовые уроки для учителя — " + BRAND,
        "Готовые уроки по информатике, математике, русскому языку и другим предметам: "
        "презентации, задания и материалы для занятий и подготовки к ОГЭ и ЕГЭ.",
    ),
    "/interesting": (
        "Тренажёры и интерактивы для подготовки к ОГЭ и ЕГЭ — " + BRAND,
        "Бесплатные онлайн-тренажёры и интерактивы по заданиям ОГЭ и ЕГЭ: логарифмы, грамматика, "
        "информатика и другие темы.",
    ),
    "/tasks": (
        "Банк задач ОГЭ, ЕГЭ и ВПР — " + BRAND,
        "Банк из 25 000+ задач ОГЭ, ЕГЭ и ВПР с фильтрами по предмету, номеру и теме: "
        "соберите вариант или рабочую тетрадь за пару минут.",
    ),
    "/teachers": (
        "Сообщество учителей — " + BRAND,
        "Сообщество преподавателей платформы «Цифровой поток»: новости, отзывы, предложения "
        "и участие в развитии проекта.",
    ),
    "/privacy": (
        "Политика обработки персональных данных — " + BRAND,
        "Политика обработки персональных данных платформы «Цифровой поток»: какие данные, зачем, кому передаются, сроки и права.",
    ),
    "/personal-data-consent": (  # r52
        "Согласие на обработку персональных данных — " + BRAND,
        "Согласие на обработку персональных данных пользователей платформы «Цифровой поток».",
    ),
    "/offer": (  # r50
        "Публичная оферта — " + BRAND,
        "Публичная оферта онлайн-сервиса «Цифровой поток» для репетиторов: тарифы, оплата, возврат, пробный период.",
    ),
    "/contacts": (  # r50
        "Контакты и реквизиты — " + BRAND,
        "Контакты и реквизиты «Цифрового потока»: e-mail, телефон, ИП Сорокина Д. В.",
    ),
    "/messages-agreement": (
        "Соглашение об использовании сообщений — " + BRAND,
        "Соглашение об использовании сообщений на платформе «Цифровой поток».",
    ),
    "/subject": (
        "Генератор вариантов ОГЭ, ЕГЭ и ВПР — " + BRAND,
        "Генератор экзаменационных вариантов в формате КИМ: выберите экзамен и предмет, "
        "соберите вариант и скачайте PDF.",
    ),
    "/cabinet/login": (
        "Вход в личный кабинет — " + BRAND,
        "Вход в личный кабинет учителя, ученика или родителя на платформе «Цифровой поток».",
    ),
}

# Алиасы: страница открывается, но каноническим считается другой адрес.
CANONICAL_ALIASES = {"/for-teachers": "/teachers", "/about": "/", "/generator": "/subject", "/vpr": "/subject/vpr", "/login": "/cabinet/login"}

# Служебные разделы: не индексируются.
NOINDEX_RE = re.compile(
    r"^/(cabinet|teacher|book|invite|community|parent|lesson/join|search|search-variant|dev|tasks/my|worksheets)(/|$)"
)

# r87: /gotovye-uroki -> 301 /lessons (urls.py); параметры, не меняющие содержимое страницы.
REDIRECTS = {"/gotovye-uroki": "/lessons"}
NOINDEX_PARAMS = ("preview",)
CLEAN_PARAMS = ("preview", "_itflux_v")
MIRROR_HOSTS = ("cdn.itflux-academy.ru",)  # r87: зеркало-ретранслятор: canonical на основной домен + noindex
TITLE_MAX = 70
# r87: продвигаем пока только математику и информатику (sitemap, хабы /zadaniya, меню SEO-страниц)
FOCUS_SUBJECTS = ("math", "math_base", "inf")
FOCUS_LESSON_SUBJECT_RE = re.compile(r"^(математик|алгебр|геометр|теория вероятност|информатик)", re.I)
NON_FOCUS_TITLE_RE = re.compile(r"хими|русск|фразеолог|\bн и нн\b|ударени|граммати|физическ|камертон|струн", re.I)

SITEMAP_STATIC = ("/", "/pricing", "/repetitor", "/lessons", "/interesting", "/tasks", "/subject", "/teachers", "/privacy", "/personal-data-consent", "/offer", "/contacts")


def _norm(path):
    path = re.sub(r"/{2,}", "/", path or "/")
    if len(path) > 1:
        path = path.rstrip("/") or "/"
    return path


def _is_mirror(request):
    try:
        return request.get_host().split(":")[0].lower() in MIRROR_HOSTS
    except Exception:
        return False


class MirrorNoindexMiddleware:
    """r87: на cdn-зеркале всё отдаётся с X-Robots-Tag: noindex (canonical и так на основной домен)."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        resp = self.get_response(request)
        if _is_mirror(request):
            resp["X-Robots-Tag"] = "noindex, nofollow"
        elif _is_service_path(request):
            # r100: служебные адреса (кабинет, API, превью) — вне индекса даже при прямой ссылке
            resp["X-Robots-Tag"] = "noindex, nofollow"
        return resp


SERVICE_PATH_RE = re.compile(r"^/(cabinet|api|admin|teacher|parent|book|invite|dev|jitsi|ws)(/|$)")


def _is_service_path(request):
    """r100: /cabinet (включая /cabinet/login), /api/…, ?preview=… — X-Robots-Tag: noindex."""
    path = request.path or "/"
    return bool(SERVICE_PATH_RE.match(path)) or "preview" in request.GET


def _stem(w):
    return w.lower().strip("«»\"'.,:;()!?—–-")[:7]


def short_title(core, *extras, sep=" — ", limit=TITLE_MAX):
    """r87: «core — extras | Цифровой поток» ≤ limit символов; слова из extras, уже есть в core, не повторяем."""
    core = re.sub(r"\s+", " ", str(core or "")).strip()
    suffix = " | " + BRAND
    have = {_stem(w) for w in core.split()}
    parts = []
    for e in extras:
        ws = [w for w in str(e or "").split() if _stem(w) and _stem(w) not in have]
        if ws:
            parts.append(" ".join(ws))
            have.update(_stem(w) for w in ws)
    while parts and len(core + sep + " ".join(parts) + suffix) > limit:
        parts.pop()
    full = (core + (sep + " ".join(parts) if parts else "")).strip()
    room = limit - len(suffix)
    if len(full) > room:
        cut = full[: room - 1]
        cut = cut.rsplit(" ", 1)[0] if " " in cut[20:] else cut
        full = cut.rstrip(" ,.:;—–-(«") + "…"
    return full + suffix


def is_focus_lesson(les):
    return bool(FOCUS_LESSON_SUBJECT_RE.match((les.subject or "").strip()))


def _lesson_task_link(les):
    """r87: урок ОГЭ/ЕГЭ с номером задания -> ссылка на страницу /zadaniya (если она есть)."""
    if les.exam_type not in ("oge", "ege") or not les.task_number:
        return None
    subj = (les.subject or "").lower()
    short = "inf" if subj.startswith("информатик") else ("math" if subj.startswith("математик") and "базов" not in subj else None)
    if not short:
        return None
    try:
        from . import seo_tasks
        u = seo_tasks._unit_of(seo_tasks.units(les.exam_type, short), int(les.task_number))
    except Exception:
        return None
    if not u:
        return None
    word = "Задания" if u["gids"] else "Задание"
    return (f"{word} {u['label']} {LEVEL_NAMES[les.exam_type]} по {'информатике' if short == 'inf' else 'математике'}",
            f"/zadaniya/{les.exam_type}/{short}/{u['slug']}")


def _clip(text, n=200):
    text = re.sub(r"\s+", " ", str(text or "")).strip()
    return text if len(text) <= n else text[: n - 1].rsplit(" ", 1)[0] + "…"


def _abs_media(field):
    try:
        if field and field.name:
            return SITE_ORIGIN + field.url
    except Exception:
        pass
    return None


def organization_ld():
    return {
        "@context": "https://schema.org",
        "@type": "Organization",
        "name": BRAND,
        "alternateName": "ITFlux Academy",
        "url": SITE_ORIGIN + "/",
        "logo": SITE_ORIGIN + "/favicon.png",
        "sameAs": ["https://t.me/itfluxacademy", "https://vk.com/itfluxacademy",
                   "https://max.ru/channel_itfluxacademy"],
    }


def _subject_name(short):
    from .models import Subject
    s = Subject.objects.filter(subject_short=short).only("subject_name").first()
    return s.subject_name if s else None


def resolve(path):
    """Мета для пути. None => неизвестный путь (404)."""
    from .models import InterestingItem, Lesson, LessonCollection

    p = _norm(path)
    meta = {"title": None, "description": DEFAULT_DESCRIPTION, "canonical": None, "image": DEFAULT_OG_IMAGE,
            "noindex": False, "ld": [], "h1": None, "public": True}
    canon_path = CANONICAL_ALIASES.get(p, p)

    if NOINDEX_RE.match(p) or p in ("/login",):
        meta["noindex"] = True
        meta["public"] = p in ("/cabinet/login", "/login")
        if meta["public"]:
            meta["title"], meta["description"] = STATIC_PAGES["/cabinet/login"]
            meta["canonical"] = SITE_ORIGIN + "/cabinet/login"
        else:
            meta["title"] = "Личный кабинет — " + BRAND
        return meta

    if canon_path in STATIC_PAGES:
        meta["title"], meta["description"] = STATIC_PAGES[canon_path]
        meta["canonical"] = SITE_ORIGIN + canon_path
        if canon_path == "/":
            meta["ld"].append({"@context": "https://schema.org", "@type": "WebSite", "name": BRAND,
                               "url": SITE_ORIGIN + "/", "inLanguage": "ru"})
        return meta

    m = re.fullmatch(r"/lessons/([^/]+)/view", p)
    if m:
        les = (Lesson.objects.filter(slug=m.group(1), status=Lesson.Status.PUBLISHED)
               .exclude(access_level=Lesson.AccessLevel.PRIVATE).first())
        if not les:
            return None
        exam = LEVEL_NAMES.get(les.exam_type or "", "")
        desc = _clip(les.short_description or les.teacher_goal or
                     f"Готовый урок «{les.title}» по предмету {les.subject}.")
        if les.short_description and (Lesson.objects.filter(short_description=les.short_description,
                                                            status=Lesson.Status.PUBLISHED).exclude(pk=les.pk).exists()):
            desc = _clip(f"{les.title}: {les.short_description}")  # r87: без дублей description
        meta.update(title=short_title(les.title, "урок", exam, (les.subject or "").lower()),
                    description=desc, canonical=f"{SITE_ORIGIN}/lessons/{les.slug}/view",
                    image=_abs_media(les.cover_image) or DEFAULT_OG_IMAGE, h1=les.title)
        ld = {"@context": "https://schema.org", "@type": "LearningResource", "name": les.title,
              "description": desc, "url": meta["canonical"], "inLanguage": "ru",
              "learningResourceType": "Урок", "about": les.subject,
              "isAccessibleForFree": les.access_level == Lesson.AccessLevel.FREE,
              "provider": {"@type": "Organization", "name": BRAND, "url": SITE_ORIGIN + "/"}}
        if les.grade:
            ld["educationalLevel"] = f"{les.grade} класс"
        if les.duration_minutes:
            ld["timeRequired"] = f"PT{int(les.duration_minutes)}M"
        if meta["image"] != DEFAULT_OG_IMAGE:
            ld["image"] = meta["image"]
        meta["ld"].append(ld)
        link = _lesson_task_link(les)
        if link:
            meta["links"] = [link]
        return meta

    m = re.fullmatch(r"/lessons/collections/([^/]+)", p)
    if m:
        col = LessonCollection.objects.filter(slug=m.group(1), status=LessonCollection.Status.PUBLISHED).first()
        if not col:
            return None
        desc = _clip(col.short_description or col.description or f"Курс «{col.title}».")
        meta.update(title=short_title(col.title, "курс уроков"), description=desc,
                    canonical=f"{SITE_ORIGIN}/lessons/collections/{col.slug}",
                    image=_abs_media(col.cover_image) or DEFAULT_OG_IMAGE, h1=col.title)
        meta["ld"].append({"@context": "https://schema.org", "@type": "Course", "name": col.title,
                           "description": desc, "url": meta["canonical"], "inLanguage": "ru",
                           "provider": {"@type": "Organization", "name": BRAND, "sameAs": SITE_ORIGIN + "/"}})
        return meta

    m = re.fullmatch(r"/interesting/([^/]+)/view", p)
    if m:
        it = InterestingItem.objects.filter(slug=m.group(1), status=InterestingItem.Status.PUBLISHED).first()
        if not it:
            return None
        desc = _clip(it.short_description or f"Интерактивный тренажёр «{it.title}».")
        meta.update(title=short_title(it.title, "тренажёр"), description=desc,
                    canonical=f"{SITE_ORIGIN}/interesting/{it.slug}/view",
                    image=_abs_media(it.cover_image) or DEFAULT_OG_IMAGE, h1=it.title)
        meta["ld"].append({"@context": "https://schema.org", "@type": "LearningResource", "name": it.title,
                           "description": desc, "url": meta["canonical"], "inLanguage": "ru",
                           "learningResourceType": "Интерактивный тренажёр", "interactivityType": "active",
                           "isAccessibleForFree": it.access_level == "free",
                           "provider": {"@type": "Organization", "name": BRAND, "url": SITE_ORIGIN + "/"}})
        return meta

    m = re.fullmatch(r"/subject/(oge|ege|vpr|school)", p)
    if m:
        ln = LEVEL_NAMES[m.group(1)]
        meta.update(title=f"Генератор вариантов {ln} — {BRAND}",
                    description=f"Соберите вариант {ln} в формате КИМ по любому предмету: задачи из банка "
                                f"«Цифрового потока», автопроверка ответов и выгрузка в PDF.",
                    canonical=f"{SITE_ORIGIN}/subject/{m.group(1)}")
        return meta

    m = re.fullmatch(r"/(oge|ege|vpr|school)", p)
    if m:
        ln = LEVEL_NAMES[m.group(1)]
        meta.update(title=f"Подготовка к {ln}: задания по предметам — {BRAND}",
                    description=f"Задания {ln} по предметам с ответами и генератор вариантов на платформе «Цифровой поток».",
                    canonical=f"{SITE_ORIGIN}/{m.group(1)}")
        return meta

    m = re.fullmatch(r"/(oge|ege|vpr|school)/([a-z0-9_-]+)(?:/variant/(\d+))?", p)
    if m:
        name = _subject_name(m.group(2))
        if not name:
            return None
        ln = LEVEL_NAMES[m.group(1)]
        if m.group(3):
            meta.update(title=short_title(f"Вариант №{m.group(3)} {ln}: {name}"),
                        description=f"Вариант {ln} по предмету {name}: решайте задания онлайн, проверяйте ответы и скачивайте PDF.",
                        canonical=f"{SITE_ORIGIN}{p}", noindex=True)
        else:
            meta.update(title=short_title(f"{ln} {name}: задания", "и генератор вариантов", sep=" "),
                        description=f"Задания {ln} по предмету {name} по номерам КИМ: банк задач, ответы, "
                                    f"генератор вариантов и PDF для учителя.",
                        canonical=f"{SITE_ORIGIN}{p}")
        return meta

    return None


NOT_FOUND_META = {"title": "Страница не найдена — " + BRAND,
                  "description": "Такой страницы нет. Перейдите на главную или в банк задач «Цифрового потока».",
                  "canonical": None, "image": DEFAULT_OG_IMAGE, "noindex": True, "ld": [], "h1": "Страница не найдена",
                  "public": True}


def _attr(v):
    return html.escape(str(v or ""), quote=True)


def _set_meta(doc, attr, key, value):
    pat = re.compile(r'(<meta\s+%s="%s"\s+content=")[^"]*(")' % (attr, re.escape(key)), re.I)
    if pat.search(doc):
        return pat.sub(lambda mm: mm.group(1) + _attr(value) + mm.group(2), doc, count=1)
    return doc.replace("</head>", f'<meta {attr}="{key}" content="{_attr(value)}">\n</head>', 1)


def inject(index_html, path, meta):
    title = meta.get("title") or STATIC_PAGES["/"][0]
    desc = meta.get("description") or DEFAULT_DESCRIPTION
    doc = re.sub(r"<title>.*?</title>", lambda _m: f"<title>{html.escape(title)}</title>", index_html, count=1, flags=re.S)
    doc = re.sub(r'(<meta\s+name="description"\s+content=")[^"]*(")',
                 lambda mm: mm.group(1) + _attr(desc) + mm.group(2), doc, count=1, flags=re.S)
    doc = _set_meta(doc, "property", "og:title", title)
    doc = _set_meta(doc, "property", "og:description", desc)
    doc = _set_meta(doc, "property", "og:url", meta.get("canonical") or SITE_ORIGIN + _norm(path))
    doc = _set_meta(doc, "property", "og:image", meta.get("image") or DEFAULT_OG_IMAGE)
    if (meta.get("image") or DEFAULT_OG_IMAGE) == DEFAULT_OG_IMAGE:
        doc = _set_meta(doc, "property", "og:image:width", "1200")
        doc = _set_meta(doc, "property", "og:image:height", "630")
    doc = _set_meta(doc, "property", "og:site_name", BRAND)
    doc = _set_meta(doc, "property", "og:locale", "ru_RU")
    doc = _set_meta(doc, "name", "twitter:title", title)
    doc = _set_meta(doc, "name", "twitter:description", desc)
    doc = _set_meta(doc, "name", "twitter:image", meta.get("image") or DEFAULT_OG_IMAGE)
    extra = []
    if meta.get("canonical"):
        extra.append(f'<link rel="canonical" href="{_attr(meta["canonical"])}" />')
    if meta.get("noindex"):
        extra.append('<meta name="robots" content="noindex, follow" />')
    lds = [organization_ld()] + list(meta.get("ld") or [])
    for ld in lds:
        js = json.dumps(ld, ensure_ascii=False).replace("</", "<\\/")
        extra.append(f'<script type="application/ld+json">{js}</script>')
    seo_state = json.dumps({"path": _norm(path), "title": title, "description": desc,
                            "canonical": meta.get("canonical")}, ensure_ascii=False).replace("</", "<\\/")
    extra.append(f"<script>window.__ITFLUX_SEO__={seo_state};</script>")
    doc = doc.replace("</head>", "  " + "\n  ".join(extra) + "\n</head>", 1)
    if not meta.get("noindex") or meta is NOT_FOUND_META:
        h1 = meta.get("h1") or title.split(" — ")[0]
        block = (
            '<div id="seo-prerender" style="max-width:960px;margin:0 auto;padding:24px 16px;'
            'font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1f2a44">'
            f'<h1 style="font-size:28px;margin:0 0 12px">{html.escape(h1)}</h1>'
            f'<p style="font-size:16px;margin:0 0 12px">{html.escape(desc)}</p>'
            '<nav style="font-size:15px"><a href="/">Главная</a> · <a href="/pricing">Тарифы</a> · '
            '<a href="/lessons">Готовые уроки</a> · <a href="/interesting">Тренажёры</a> · '
            '<a href="/tasks">Банк задач</a> · <a href="/zadaniya">Задания ОГЭ и ЕГЭ</a> · '
            '<a href="/subject">Генератор вариантов</a></nav>'
            + "".join(f'<p style="font-size:15px;margin:12px 0 0"><a href="{_attr(href)}">{html.escape(label)}</a></p>'
                      for label, href in (meta.get("links") or []))
            + '</div>'
        )
        doc = doc.replace('<div id="root"></div>', block + '\n  <div id="root"></div>', 1)
    return doc


def robots_txt_body(mirror=False):
    if mirror:  # r87: cdn-зеркало не индексируется
        return "User-agent: *\nDisallow: /\n"
    return (
        "User-agent: *\n"
        "Disallow: /cabinet\n"
        "Disallow: /api/\n"
        "Disallow: /admin/\n"
        "Disallow: /teacher/\n"
        "Disallow: /book/\n"
        "Disallow: /invite/\n"
        "Disallow: /parent/\n"
        "Disallow: /community/invite/\n"
        "Disallow: /lesson/join\n"
        "Disallow: /jitsi/\n"
        "Disallow: /ws/\n"
        "Disallow: /dev/\n"
        "Disallow: /tasks/my\n"
        "Disallow: /search\n"
        "Allow: /cabinet/login\n"
        "Allow: /\n"
        "\n"
        "User-agent: Yandex\n"
        "Disallow: /cabinet\n"
        "Disallow: /api/\n"
        "Disallow: /admin/\n"
        "Disallow: /teacher/\n"
        "Disallow: /book/\n"
        "Disallow: /invite/\n"
        "Disallow: /parent/\n"
        "Disallow: /community/invite/\n"
        "Disallow: /lesson/join\n"
        "Disallow: /jitsi/\n"
        "Disallow: /ws/\n"
        "Disallow: /dev/\n"
        "Disallow: /tasks/my\n"
        "Disallow: /search\n"
        "Allow: /\n"
        "Clean-param: utm_source&utm_medium&utm_campaign&utm_content&utm_term&yclid&gclid&from\n"
        "Clean-param: " + "&".join(CLEAN_PARAMS) + "\n"
        "\n"
        f"Sitemap: {SITE_ORIGIN}/sitemap.xml\n"
    )


def _d(dt):
    return dt.date().isoformat() if dt else None


def sitemap_rows():
    """r87: только математика и информатика; lastmod — из updated_at в БД (без «сегодня» для всего подряд)."""
    from django.db.models import Max
    from .models import InterestingItem, Lesson, LessonCollection, Task, TaskList

    lessons = [les for les in Lesson.objects.filter(status=Lesson.Status.PUBLISHED)
               .exclude(access_level=Lesson.AccessLevel.PRIVATE).only("slug", "updated_at", "subject").order_by("id")
               if is_focus_lesson(les)]
    items = [it for it in InterestingItem.objects.filter(status=InterestingItem.Status.PUBLISHED)
             .only("slug", "updated_at", "title").order_by("id") if not NON_FOCUS_TITLE_RE.search(it.title or "")]
    by_pair = {}
    for lvl, subj, m in (Task.objects.filter(is_active=True, scope="global", task__subject__subject_short__in=FOCUS_SUBJECTS)
                         .values_list("task__level__level", "task__subject__subject_short").annotate(m=Max("updated_at"))
                         .values_list("task__level__level", "task__subject__subject_short", "m")):
        by_pair[(lvl, subj)] = m
    by_tl = dict(Task.objects.filter(is_active=True, scope="global", task__subject__subject_short__in=FOCUS_SUBJECTS)
                 .values("task_id").annotate(m=Max("updated_at")).values_list("task_id", "m"))
    les_lm = max((les.updated_at for les in lessons), default=None)
    it_lm = max((it.updated_at for it in items), default=None)
    content_lm = max([x for x in [les_lm, it_lm] + list(by_pair.values()) if x], default=None)

    rows = []
    prio = {"/": "1.0", "/pricing": "0.9", "/repetitor": "0.9", "/lessons": "0.9", "/interesting": "0.9",
            "/tasks": "0.8", "/subject": "0.8"}
    static_lm = {"/lessons": les_lm, "/interesting": it_lm, "/": content_lm, "/tasks": content_lm, "/subject": content_lm}
    for p in SITEMAP_STATIC:
        rows.append((SITE_ORIGIN + p, _d(static_lm.get(p)), "weekly", prio.get(p, "0.5")))
    for lvl in ("oge", "ege", "vpr"):
        lm = max([m for (l, _), m in by_pair.items() if l == lvl and m], default=None)
        rows.append((f"{SITE_ORIGIN}/subject/{lvl}", _d(lm), "weekly", "0.8"))
    for (lvl, subj), m in sorted(by_pair.items()):
        if lvl in LEVEL_NAMES and subj and re.fullmatch(r"[a-z0-9_-]+", subj):
            rows.append((f"{SITE_ORIGIN}/{lvl}/{subj}", _d(m), "weekly", "0.7"))
    for les in lessons:
        rows.append((f"{SITE_ORIGIN}/lessons/{les.slug}/view", _d(les.updated_at), "monthly", "0.7"))
    for col in LessonCollection.objects.filter(status=LessonCollection.Status.PUBLISHED).order_by("id"):
        rows.append((f"{SITE_ORIGIN}/lessons/collections/{col.slug}", _d(getattr(col, "updated_at", None)), "monthly", "0.7"))
    for it in items:
        rows.append((f"{SITE_ORIGIN}/interesting/{it.slug}/view", _d(it.updated_at), "monthly", "0.7"))
    try:  # r36/r87: страницы «Задание N» (только фокусные предметы)
        from . import seo_tasks
        z_lm = max([m for m in by_pair.values() if m], default=None)
        rows.append((SITE_ORIGIN + "/zadaniya", _d(z_lm), "weekly", "0.8"))
        for lvl in ("oge", "ege"):
            lm = max([m for (l, _), m in by_pair.items() if l == lvl and m], default=None)
            rows.append((f"{SITE_ORIGIN}/zadaniya/{lvl}", _d(lm), "weekly", "0.7"))
        for p, lm in seo_tasks.sitemap_entries(by_tl, by_pair):
            rows.append((SITE_ORIGIN + p, _d(lm), "weekly", "0.6"))
    except Exception:
        import logging
        logging.getLogger(__name__).exception("sitemap zadaniya failed")
    return rows


def sitemap_xml_body():
    rows = sitemap_rows()
    body = "\n".join(
        f"  <url>\n    <loc>{html.escape(loc)}</loc>\n" + (f"    <lastmod>{lm}</lastmod>\n" if lm else "")
        + f"    <changefreq>{cf}</changefreq>\n    <priority>{pr}</priority>\n  </url>"
        for loc, lm, cf, pr in rows
    )
    return ('<?xml version="1.0" encoding="UTF-8"?>\n'
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + body + "\n</urlset>\n")
