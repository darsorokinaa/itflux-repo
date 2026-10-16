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
CANONICAL_ALIASES = {"/gotovye-uroki": "/lessons", "/for-teachers": "/teachers", "/about": "/", "/generator": "/subject", "/vpr": "/subject/vpr", "/login": "/cabinet/login"}

# Служебные разделы: не индексируются.
NOINDEX_RE = re.compile(
    r"^/(cabinet|teacher|book|invite|community|parent|lesson/join|search|search-variant|dev|tasks/my|worksheets)(/|$)"
)

SITEMAP_STATIC = ("/", "/pricing", "/repetitor", "/lessons", "/interesting", "/tasks", "/subject", "/teachers", "/privacy", "/personal-data-consent", "/offer", "/contacts")


def _norm(path):
    path = re.sub(r"/{2,}", "/", path or "/")
    if len(path) > 1:
        path = path.rstrip("/") or "/"
    return path


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
        "sameAs": ["https://t.me/itfluxacademy", "https://vk.com/itfluxacademy"],
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
        meta.update(title=f"{les.title} — готовый урок{(' ' + exam) if exam else ''} по предмету {les.subject} — {BRAND}"[:180],
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
        return meta

    m = re.fullmatch(r"/lessons/collections/([^/]+)", p)
    if m:
        col = LessonCollection.objects.filter(slug=m.group(1), status=LessonCollection.Status.PUBLISHED).first()
        if not col:
            return None
        desc = _clip(col.short_description or col.description or f"Курс «{col.title}».")
        meta.update(title=f"{col.title} — курс уроков — {BRAND}", description=desc,
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
        meta.update(title=f"{it.title} — онлайн-тренажёр — {BRAND}", description=desc,
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
            meta.update(title=f"Вариант №{m.group(3)} {ln} по предмету {name} — {BRAND}",
                        description=f"Вариант {ln} по предмету {name}: решайте задания онлайн, проверяйте ответы и скачивайте PDF.",
                        canonical=f"{SITE_ORIGIN}{p}", noindex=True)
        else:
            meta.update(title=f"{ln} {name}: задания и генератор вариантов — {BRAND}",
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
            '<a href="/tasks">Банк задач</a> · <a href="/subject">Генератор вариантов</a></nav></div>'
        )
        doc = doc.replace('<div id="root"></div>', block + '\n  <div id="root"></div>', 1)
    return doc


def robots_txt_body():
    return (
        "User-agent: *\n"
        "Disallow: /cabinet/\n"
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
        "Disallow: /cabinet/\n"
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
        f"Host: https://{SITE_HOST}\n"
        "\n"
        f"Sitemap: {SITE_ORIGIN}/sitemap.xml\n"
    )


def sitemap_xml_body():
    from .models import InterestingItem, Lesson, LessonCollection, TaskList

    today = timezone.now().date().isoformat()
    rows = []
    prio = {"/": "1.0", "/pricing": "0.9", "/repetitor": "0.9", "/lessons": "0.9", "/interesting": "0.9",
            "/tasks": "0.8", "/subject": "0.8"}
    for p in SITEMAP_STATIC:
        rows.append((SITE_ORIGIN + p, today, "weekly", prio.get(p, "0.5")))
    for lvl in ("oge", "ege", "vpr"):
        rows.append((f"{SITE_ORIGIN}/subject/{lvl}", today, "weekly", "0.8"))
    pairs = (TaskList.objects.values_list("level__level", "subject__subject_short").distinct())
    for lvl, subj in sorted(set(pairs)):
        if lvl in LEVEL_NAMES and subj and re.fullmatch(r"[a-z0-9_-]+", subj):
            rows.append((f"{SITE_ORIGIN}/{lvl}/{subj}", today, "weekly", "0.7"))
    for les in (Lesson.objects.filter(status=Lesson.Status.PUBLISHED).exclude(access_level=Lesson.AccessLevel.PRIVATE)
                .only("slug", "updated_at").order_by("id")):
        rows.append((f"{SITE_ORIGIN}/lessons/{les.slug}/view", les.updated_at.date().isoformat(), "monthly", "0.7"))
    for col in LessonCollection.objects.filter(status=LessonCollection.Status.PUBLISHED).order_by("id"):
        lm = getattr(col, "updated_at", None)
        rows.append((f"{SITE_ORIGIN}/lessons/collections/{col.slug}", lm.date().isoformat() if lm else today, "monthly", "0.7"))
    for it in InterestingItem.objects.filter(status=InterestingItem.Status.PUBLISHED).only("slug", "updated_at").order_by("id"):
        rows.append((f"{SITE_ORIGIN}/interesting/{it.slug}/view", it.updated_at.date().isoformat(), "monthly", "0.7"))
    try:  # r36: страницы «Задание N»
        from . import seo_tasks
        for p in seo_tasks.sitemap_paths():
            rows.append((SITE_ORIGIN + p, today, "weekly", "0.6"))
    except Exception:
        pass
    body = "\n".join(
        f"  <url>\n    <loc>{html.escape(loc)}</loc>\n    <lastmod>{lm}</lastmod>\n"
        f"    <changefreq>{cf}</changefreq>\n    <priority>{pr}</priority>\n  </url>"
        for loc, lm, cf, pr in rows
    )
    return ('<?xml version="1.0" encoding="UTF-8"?>\n'
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + body + "\n</urlset>\n")
