"""r36/r44: публичные SEO-страницы «Задание N ОГЭ/ЕГЭ — предмет» из банка задач (только реальные данные БД)."""
import html
from html.parser import HTMLParser
import json
import re

from django.db.models import Count, Q
from django.http import Http404, HttpResponse, HttpResponsePermanentRedirect
from django.utils.html import strip_tags

from . import seo
from .models import InterestingItem, Lesson, Task, TaskGroup, TaskGroupMember, TaskList

LEVELS = {"oge": "ОГЭ", "ege": "ЕГЭ"}
MIN_TASKS = 3
_ACTIVE = Q(task__is_active=True, task__scope="global")


def _plural(n, one, few, many):
    n = abs(int(n)) % 100
    if 10 < n < 20:
        return many
    n %= 10
    return one if n == 1 else few if 2 <= n <= 4 else many


def _fmt(n):
    return f"{int(n):,}".replace(",", "\u00a0")


def published_tasklists():
    return (TaskList.objects.filter(level__level__in=LEVELS.keys())
            .select_related("level", "subject")
            .annotate(n=Count("task", filter=_ACTIVE)).filter(n__gte=MIN_TASKS)
            .order_by("level__level", "subject__subject_short", "task_number"))


def sitemap_paths():
    seen_hubs = set()
    for tl in published_tasklists():
        hub = f"/zadaniya/{tl.level.level}/{tl.subject.subject_short}"
        if hub in seen_hubs:
            continue
        seen_hubs.add(hub)
        yield hub
        for u in units(tl.level.level, tl.subject.subject_short):
            yield f"{hub}/{u['slug']}"


def sitemap_entries(by_tl, by_pair):
    """r87: (путь, lastmod) — только математика и информатика; lastmod = max(Task.updated_at)."""
    seen = set()
    for tl in published_tasklists():
        lvl, subj = tl.level.level, tl.subject.subject_short
        if subj not in seo.FOCUS_SUBJECTS or (lvl, subj) in seen:
            continue
        seen.add((lvl, subj))
        hub = f"/zadaniya/{lvl}/{subj}"
        yield hub, by_pair.get((lvl, subj))
        for u in units(lvl, subj):
            yield f"{hub}/{u['slug']}", max([by_tl[t.id] for t in u["tls"] if by_tl.get(t.id)], default=None)


MIN_GROUPS = 3


def _complete_groups(level, subject):
    """r45: группы из БД (TaskGroup/TaskGroupMember — так их собирает генератор): {номера: [group_id, ...]}
    учитываются только группы, где все задачи активны и в общем банке."""
    rows = (TaskGroupMember.objects.filter(task_group__level__level=level, task_group__subject__subject_short=subject)
            .values_list("task_group_id", "task_number", "task__is_active", "task__scope"))
    by_g, bad = {}, set()
    for gid, num, active, scope in rows:
        by_g.setdefault(gid, set()).add(num)
        if not active or scope != "global":
            bad.add(gid)
    sig = {}
    for gid, nums in by_g.items():
        if gid in bad or len(nums) < 2:
            continue
        k = tuple(sorted(nums))
        if k[-1] - k[0] + 1 != len(k):
            continue
        sig.setdefault(k, []).append(gid)
    return {k: v for k, v in sig.items() if len(v) >= MIN_GROUPS}


def group_signatures(level, subject):
    """Непересекающиеся блоки номеров (самый частый вариант выигрывает)."""
    taken, out = set(), []
    for k, gids in sorted(_complete_groups(level, subject).items(), key=lambda kv: -len(kv[1])):
        if taken.isdisjoint(k):
            taken.update(k)
            out.append((k, gids))
    return sorted(out)


def units(level, subject):
    tls = [t for t in published_tasklists() if t.level.level == level and t.subject.subject_short == subject]
    by_num = {t.task_number: t for t in tls}
    groups = {k[0]: (k, g) for k, g in group_signatures(level, subject) if all(n in by_num for n in k)}
    out, skip = [], set()
    for t in tls:
        n = t.task_number
        if n in skip:
            continue
        if n in groups:
            k, gids = groups[n]
            skip.update(k)
            out.append({"a": k[0], "b": k[-1], "nums": k, "tls": [by_num[x] for x in k], "gids": gids,
                        "slug": f"{k[0]}-{k[-1]}", "label": f"{k[0]}–{k[-1]}"})
        else:
            out.append({"a": n, "b": n, "nums": (n,), "tls": [t], "gids": None, "slug": str(n), "label": str(n)})
    return out


def _unit_of(us, n):
    return next((u for u in us if n in u["nums"]), None)


def _excerpt(raw, n=420):
    text = html.unescape(strip_tags(str(raw or "")))
    text = re.sub(r"\s+", " ", text).strip()
    return text if len(text) <= n else text[: n - 1].rsplit(" ", 1)[0] + "…"



# ---------- r44: безопасный рендер HTML задач (whitelist, без JS/стилей) ----------
_OK_TAGS = {"p", "br", "b", "i", "strong", "em", "u", "s", "sub", "sup", "span", "div", "table", "tbody", "thead",
            "tr", "td", "th", "img", "ul", "ol", "li", "code", "pre", "blockquote", "hr", "h3", "h4", "h5", "figure",
            "figcaption", "caption", "small"}
_VOID = {"br", "img", "hr"}
_DROP_CONTENT = {"script", "style", "iframe", "object", "embed", "noscript", "template", "svg", "math", "form",
                 "input", "button", "textarea", "select", "head", "title"}


class _Clean(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out, self.stack, self.skip, self.imgs, self.ext_img = [], [], 0, 0, False

    def handle_starttag(self, tag, attrs):
        if tag in _DROP_CONTENT:
            if tag not in _VOID:
                self.skip += 1
            return
        if self.skip or tag not in _OK_TAGS:
            return
        a = dict(attrs)
        extra = ""
        if tag == "img":
            src = (a.get("src") or "").strip()
            if not src.startswith("/media/"):
                self.ext_img = True
                return
            self.imgs += 1
            w = a.get("width") or ""
            extra = (f' src="{html.escape(src, quote=True)}" alt="Иллюстрация к задаче {self.imgs}" loading="lazy" decoding="async"'
                     + (f' width="{w}"' if w.isdigit() else ""))
        elif tag in ("td", "th"):
            for k in ("colspan", "rowspan"):
                if (a.get(k) or "").isdigit():
                    extra += f' {k}="{a[k]}"'
        elif tag == "table":
            self.out.append('<div class="zt-tbl">')
        self.out.append(f"<{tag}{extra}>")
        if tag not in _VOID:
            self.stack.append(tag)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in _VOID and self.stack and self.stack[-1] == tag:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        if tag in _DROP_CONTENT:
            self.skip = max(0, self.skip - 1)
            return
        if self.skip or tag not in self.stack:
            return
        while self.stack:
            t = self.stack.pop()
            self.out.append(f"</{t}>")
            if t == "table":
                self.out.append("</div>")
            if t == tag:
                break

    def handle_data(self, data):
        if not self.skip:
            self.out.append(html.escape(data, quote=False))

    def result(self):
        while self.stack:
            t = self.stack.pop()
            self.out.append(f"</{t}>" + ("</div>" if t == "table" else ""))
        return "".join(self.out)


def clean_task_html(raw):
    raw = str(raw or "")
    for _ in range(3):  # HTML, сохранённый экранированным
        if raw.lstrip().startswith("&lt;"):
            raw = html.unescape(raw)
    p = _Clean()
    p.feed(raw)
    p.close()
    out = p.result()
    out = re.sub(r"<p>\s*(?:&nbsp;|\u00a0|\s)*</p>", "", out)
    return out, p.imgs, p.ext_img


_SUBJ_DAT = {"Математика": "математике", "Информатика": "информатике", "Физика": "физике", "Химия": "химии",
             "Русский язык": "русскому языку", "Английский язык (устный)": "английскому языку (устная часть)",
             "Английский язык (письменная часть)": "английскому языку (письменная часть)"}


def subj_dat(name):
    return _SUBJ_DAT.get(name, f"предмету «{name}»")


def clean_topic(t):
    t = re.sub(r"^(\d+(?:\.\d+)*)\s+\1\s+", "", (t or "").strip())
    t = re.sub(r"^\d+(?:\.\d+)+\s+", "", t)
    t = re.sub(r"\s*[-–—·]\s*\d+\s*(?=\(|$)", " ", t).strip()
    t = t.replace("\u00ac", "").replace("рас-творов", "растворов")
    if re.match(r"^Задание\s+\d+", t):
        return ""
    if len(t) >= 98:
        cut = t[:96]
        t = (cut.rsplit(",", 1)[0] if "," in cut[40:] else cut.rsplit(" ", 1)[0]).rstrip(" ,.(") + "…"
    return t


def lc_first(t):
    if len(t) > 1 and not t[1].isupper() and not t[:3].isupper():
        return t[0].lower() + t[1:]
    return t


CSS = """
:root{--blue:#255AE9;--blue2:#1550D8;--navy:#0B2F9F;--ink:#050505;--ink2:#343D55;--muted:#5A6490;--line:rgba(30,64,175,.1);--lime:#D7FF2F}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;font-family:"TikTok Sans",Manrope,system-ui,-apple-system,sans-serif;font-size:15px;line-height:1.55;color:var(--ink);background:#F2F4FF;
background-image:linear-gradient(rgba(43,82,245,.04) 1px,transparent 1px),linear-gradient(90deg,rgba(43,82,245,.04) 1px,transparent 1px);background-size:32px 32px}
a{color:var(--blue);text-decoration:none}a:hover{text-decoration:underline}
h1,h2,h3,.zt-brand{font-family:Bounded,system-ui,sans-serif;font-weight:900;letter-spacing:-.04em;line-height:1.1}
.zt-wrap{max-width:1180px;margin:0 auto;padding:0 24px}
.zt-head{position:sticky;top:0;z-index:20;background:#fff;border-bottom:1px solid var(--line);box-shadow:0 8px 30px rgba(18,62,173,.05)}
.zt-head .zt-wrap{display:flex;align-items:center;gap:18px;min-height:68px}
.zt-brand{display:flex;align-items:center;gap:10px;color:var(--ink);font-size:16px;white-space:nowrap}.zt-brand:hover{text-decoration:none}
.zt-brand img{width:32px;height:32px}
.zt-nav{display:flex;gap:4px;overflow-x:auto;scrollbar-width:none;flex:1;min-width:0}.zt-nav::-webkit-scrollbar{display:none}
.zt-nav a{color:var(--ink2);font-weight:700;font-size:13px;padding:10px 11px;border-radius:9px;white-space:nowrap}
.zt-nav a:hover{background:#EEF2FF;text-decoration:none}
.zt-cab{background:var(--blue);color:#fff!important;font-weight:700;font-size:13px;padding:10px 14px;border-radius:9px;white-space:nowrap}
.zt-crumbs{font-size:13px;color:var(--muted);margin:22px 0 14px}.zt-crumbs a{color:var(--muted)}.zt-crumbs span{margin:0 6px;opacity:.6}
.zt-hero{position:relative;overflow:hidden;border-radius:30px;padding:44px;color:#fff;border:1px solid rgba(255,255,255,.14);
background:radial-gradient(circle at 18% -8%,rgba(111,141,255,.28),transparent 44%),radial-gradient(circle at 84% 12%,rgba(37,99,235,.24),transparent 40%),linear-gradient(140deg,#0F2F7F,#123EAD 46%,#1D4ED8);
box-shadow:0 22px 52px rgba(18,62,173,.3),inset 0 1px 0 rgba(255,255,255,.18);display:grid;grid-template-columns:minmax(0,1.5fr) minmax(260px,1fr);gap:36px;align-items:center}
.zt-hero::before{content:"";position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,.05) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.05) 1px,transparent 1px);background-size:32px 32px;pointer-events:none}
.zt-hero>*{position:relative}
.zt-eyebrow{display:inline-flex;align-items:center;gap:8px;border:1px solid rgba(255,255,255,.28);background:rgba(255,255,255,.08);border-radius:999px;padding:6px 12px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.1em}
.zt-eyebrow::before{content:"";width:8px;height:8px;border-radius:50%;background:var(--lime);box-shadow:0 0 0 3px rgba(215,255,47,.25)}
.zt-hero h1{font-size:clamp(28px,3.6vw,44px);margin:18px 0 14px;color:#fff}
.zt-hero p{font-size:16px;color:rgba(255,255,255,.86);margin:0 0 10px;max-width:640px}
.zt-btns{display:flex;flex-wrap:wrap;gap:12px;margin-top:22px}
.zt-btn{display:inline-flex;align-items:center;gap:8px;height:48px;padding:0 22px;border-radius:14px;font-weight:700;font-size:15px;border:1px solid transparent;transition:transform .15s}
.zt-btn:hover{text-decoration:none;transform:translateY(-1px)}
.zt-btn--lime{background:linear-gradient(#D7FF2F,#BFE72B);color:#102A6F;box-shadow:0 12px 24px rgba(215,255,47,.28)}
.zt-btn--glass{background:rgba(255,255,255,.08);color:#fff;border-color:rgba(255,255,255,.28)}
.zt-btn--blue{background:var(--blue);color:#fff;box-shadow:0 10px 22px rgba(37,90,233,.25)}
.zt-btn--ghost{background:#fff;color:var(--blue);border-color:rgba(37,90,233,.35)}
.zt-stats{background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.2);border-radius:22px;padding:14px;display:grid;gap:10px}
.zt-stat{background:#fff;color:var(--ink);border-radius:16px;padding:14px 16px}
.zt-stat b{display:block;font-family:Bounded,system-ui,sans-serif;font-size:24px;color:#0B2F9F;letter-spacing:-.03em}
.zt-stat span{font-size:13px;color:var(--muted)}
.zt-sec{margin:44px 0}.zt-sec h2{font-size:clamp(22px,2.4vw,28px);margin:0 0 6px}.zt-sec>p.zt-sub{color:var(--muted);margin:0 0 18px}
.zt-chips{display:flex;flex-wrap:wrap;gap:8px}
.zt-chip{background:#fff;border:1px solid var(--line);border-radius:999px;padding:8px 14px;font-weight:600;font-size:14px;color:var(--ink2);box-shadow:0 4px 14px rgba(11,47,159,.05)}
.zt-chip em{font-style:normal;color:var(--blue);margin-left:6px;font-weight:700}
.zt-card{background:#fff;border:1px solid var(--line);border-radius:22px;padding:22px 24px;box-shadow:0 8px 24px rgba(11,47,159,.06)}
.zt-tasks{display:grid;gap:16px}
.zt-task-head{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap}
.zt-tag{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--blue);background:#EEF2FF;border-radius:8px;padding:5px 9px}
.zt-tbody{font-size:16px;line-height:1.6;overflow-wrap:anywhere}
.zt-tbody p{margin:0 0 .7em}.zt-tbody img{max-width:100%;height:auto;vertical-align:middle;border-radius:6px}
.zt-tbl{overflow-x:auto;margin:10px 0}.zt-tbody table{border-collapse:collapse}.zt-tbody td,.zt-tbody th{border:1px solid #DDE3F5;padding:6px 10px;vertical-align:top}
.zt-tbody pre,.zt-tbody code{font-family:"JetBrains Mono",monospace;font-size:14px;background:#F5F7FF;border-radius:8px}.zt-tbody pre{padding:12px;overflow-x:auto}
.zt-tbody mjx-container{max-width:100%;overflow-x:auto;overflow-y:hidden}
.zt-clamp{position:relative}.zt-clamp>input{position:absolute;opacity:0;pointer-events:none}
.zt-clamp>input:not(:checked)~.zt-tbody{max-height:420px;overflow:hidden;-webkit-mask-image:linear-gradient(#000 70%,transparent);mask-image:linear-gradient(#000 70%,transparent)}
.zt-clamp>label{display:inline-block;margin-top:8px;color:var(--blue);font-weight:700;cursor:pointer}
.zt-clamp>input:checked~label{display:none}
.zt-q{padding:14px 0;border-top:1px solid #EEF1FA}.zt-q--ctx{border-top:0;padding-top:0}.zt-q-head{display:flex;align-items:center;gap:10px;margin-bottom:10px}.zt-q-head .zt-num{min-width:32px;height:32px;font-size:14px}
.zt-task-foot{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-top:16px;padding-top:14px;border-top:1px dashed #DDE3F5;flex-wrap:wrap;color:var(--muted);font-size:14px}
.zt-steps{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;counter-reset:s}
.zt-step{counter-increment:s}.zt-step::before{content:counter(s);display:grid;place-items:center;width:40px;height:40px;border-radius:12px;background:linear-gradient(140deg,#123EAD,#1D4ED8);color:#fff;font-family:Bounded,sans-serif;font-weight:900;margin-bottom:12px}
.zt-step h3{font-size:17px;margin:0 0 6px}.zt-step p{margin:0;color:var(--muted)}
.zt-band{border-radius:26px;padding:30px 34px;background:linear-gradient(140deg,#0F2F7F,#1D4ED8);color:#fff;display:flex;justify-content:space-between;align-items:center;gap:20px;flex-wrap:wrap}
.zt-band h2{color:#fff;margin:0 0 6px}.zt-band p{margin:0;color:rgba(255,255,255,.85)}
.zt-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px}
.zt-link{display:block;color:var(--ink);transition:transform .15s,box-shadow .15s}.zt-link:hover{text-decoration:none;transform:translateY(-2px);box-shadow:0 14px 30px rgba(11,47,159,.12)}
.zt-link h3{font-size:16px;margin:8px 0 6px}.zt-link small{color:var(--muted);font-size:13px}
.zt-num{display:inline-grid;place-items:center;min-width:38px;height:38px;padding:0 8px;border-radius:12px;background:#EEF2FF;color:var(--blue);font-family:Bounded,sans-serif;font-weight:900}
.zt-nums{display:flex;flex-wrap:wrap;gap:8px}.zt-nums a,.zt-nums b{display:inline-grid;place-items:center;min-width:42px;height:42px;border-radius:12px;background:#fff;border:1px solid var(--line);font-weight:700}
.zt-nums b{background:var(--blue);color:#fff;border-color:var(--blue)}.zt-nums a:hover{text-decoration:none;border-color:var(--blue)}
.zt-pn{display:flex;justify-content:space-between;gap:12px;margin-top:16px;flex-wrap:wrap}
.zt-foot{margin-top:56px;background:#fff;border-top:1px solid var(--line);color:var(--muted);font-size:14px}
.zt-foot .zt-wrap{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;padding-top:20px;padding-bottom:20px}.zt-foot a{color:var(--muted);margin-left:16px}
@media (max-width:900px){.zt-hero{grid-template-columns:1fr;padding:30px 24px}.zt-stats{grid-template-columns:repeat(3,1fr)}.zt-steps{grid-template-columns:1fr}}
@media (max-width:640px){.zt-wrap{padding:0 14px}.zt-head .zt-wrap{gap:10px;min-height:58px}.zt-brand span{display:none}.zt-cab{padding:9px 10px}
.zt-hero{border-radius:22px;padding:24px 18px}.zt-stats{grid-template-columns:1fr 1fr}.zt-stat b{font-size:20px}.zt-btn{width:100%;justify-content:center}
.zt-card{padding:18px 16px;border-radius:18px}.zt-band{padding:24px 20px}.zt-foot a{margin:0 12px 0 0}}
"""

PAGE = """<!doctype html>
<html lang="ru"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<meta name="description" content="{desc}">
<link rel="canonical" href="{canonical}">
<meta property="og:type" content="website"><meta property="og:title" content="{title}">
<meta property="og:description" content="{desc}"><meta property="og:url" content="{canonical}">
<meta property="og:image" content="{og}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta property="og:site_name" content="Цифровой поток"><meta property="og:locale" content="ru_RU"><meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="{og}">
<link rel="icon" type="image/png" href="/static/favicon.png?v=1">
<link rel="preload" href="/fonts/Bounded-Variable.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/fonts/site.css">
{ld}
<style>
@font-face{{font-family:Bounded;src:url(/fonts/Bounded-Variable.woff2) format("woff2-variations"),url(/fonts/Bounded-Variable.woff2) format("woff2");font-weight:200 900;font-display:swap}}
{css}
</style></head><body>
<header class="zt-head"><div class="zt-wrap"><a class="zt-brand" href="/"><img src="/static/favicon.png?v=1" alt="" width="32" height="32"><span>Цифровой поток</span></a>
<nav class="zt-nav" aria-label="Разделы"><a href="/zadaniya">Задания ОГЭ и ЕГЭ</a><a href="/tasks">Все задачи</a><a href="/generator">Генератор вариантов</a><a href="/lessons">Готовые уроки</a><a href="/interesting">Тренажёры и интерактивы</a><a href="/pricing">Тарифы</a></nav>
<a class="zt-cab" href="/cabinet/login">Личный кабинет</a></div></header>
<main class="zt-wrap">{body}</main>
<footer class="zt-foot"><div class="zt-wrap"><span>© Цифровой поток — генератор вариантов ОГЭ и ЕГЭ, уроки и кабинет учителя</span>
<span><a href="/privacy">Политика конфиденциальности</a><a href="/messages-agreement">Соглашение о сообщениях</a></span></div></footer>
{scripts}
</body></html>"""

MATHJAX = ('<script src="/vendor/mathjax/itflux-config.js" defer></script>'
           '<script src="/vendor/mathjax/tex-mml-chtml.js" defer '
           'onload="MathJax.startup.promise.then(function(){return MathJax.typesetPromise()}).catch(function(){})"></script>')


def _render(title, desc, canonical, body, lds, math=False):
    ld = "\n".join(
        '<script type="application/ld+json">%s</script>' % json.dumps(x, ensure_ascii=False).replace("</", "<\\/")
        for x in [seo.organization_ld()] + lds)
    e = lambda s: html.escape(s, quote=True)
    page = PAGE.format(title=e(title), desc=e(desc), canonical=e(canonical), og=seo.DEFAULT_OG_IMAGE, ld=ld, body=body,
                       css=CSS, scripts=MATHJAX if math else "")
    resp = HttpResponse(page, content_type="text/html; charset=utf-8")
    resp["Cache-Control"] = "public, max-age=600"
    return resp


def _crumbs(items):
    lst = {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
        {"@type": "ListItem", "position": i + 1, "name": name, "item": seo.SITE_ORIGIN + url} for i, (name, url) in enumerate(items)]}
    htm = "<span>›</span>".join(f'<a href="{url}">{html.escape(name)}</a>' for name, url in items[:-1]) \
        + f"<span>›</span>{html.escape(items[-1][0])}"
    return lst, f'<nav class="zt-crumbs" aria-label="Навигация">{htm}</nav>'


def _how(ln):
    return (f"<section class='zt-sec'><h2>Как это работает</h2><p class='zt-sub'>Собирайте варианты, используйте готовые "
            f"уроки, выдавайте домашние задания и отслеживайте результаты учеников без лишних вкладок и ручной проверки.</p>"
            f"<div class='zt-steps'>"
            f"<div class='zt-card zt-step'><h3>Выберите номера и темы</h3><p>В генераторе отметьте нужные задания {ln} "
            f"и темы из банка задач.</p></div>"
            f"<div class='zt-card zt-step'><h3>Получите вариант</h3><p>Генератор соберёт вариант в формате {ln} "
            f"или рабочую тетрадь для учеников.</p></div>"
            f"<div class='zt-card zt-step'><h3>Распечатайте или выдайте</h3><p>Скачайте PDF или выдайте задание ученикам "
            f"через кабинет учителя.</p></div></div></section>")


def _band(level, subject, ln):
    return ("<section class='zt-sec zt-band'><div><h2>Пространство для учителей</h2>"
            "<p>Для репетиторов, преподавателей и онлайн-школ, которым важно держать материалы, учеников и задания в одной системе.</p></div>"
            "<div class='zt-btns' style='margin:0'><a class='zt-btn zt-btn--lime' href='/cabinet/login'>Зарегистрироваться бесплатно</a>"
            f"<a class='zt-btn zt-btn--glass' href='/generator'>Открыть генератор</a></div></section>")


def task_hub(request, level, subject):
    if level not in LEVELS:
        raise Http404
    tls = [tl for tl in published_tasklists() if tl.level.level == level and tl.subject.subject_short == subject]
    if not tls:
        raise Http404
    ln, sname = LEVELS[level], tls[0].subject.subject_name
    total = sum(tl.n for tl in tls)
    ntop = (Task.objects.filter(task__in=tls, is_active=True, scope="global").exclude(subtopic=None)
            .values("subtopic").distinct().count())
    title = seo.short_title(f"Задания {ln} по {subj_dat(sname)}: все номера", "с темами", sep=" ")
    desc = (f"{_fmt(total)} {_plural(total, 'задача', 'задачи', 'задач')} {ln} по {subj_dat(sname)} в банке "
            f"«Цифрового потока»: {len(tls)} {_plural(len(tls), 'номер', 'номера', 'номеров')} с темами и генератор вариантов.")
    canonical = f"{seo.SITE_ORIGIN}/zadaniya/{level}/{subject}"
    ld_c, crumbs = _crumbs([("Главная", "/"), ("Задания", "/zadaniya"), (f"{ln}", f"/zadaniya/{level}"), (sname, f"/zadaniya/{level}/{subject}")])
    us = units(level, subject)
    def _card(u):
        n_t = sum(t.n for t in u["tls"])
        ms = sum(t.max_score or 0 for t in u["tls"])
        tt = clean_topic(u["tls"][0].task_title) or f"Задание {u['label']}"
        extra = (f" · {len(u['gids'])} {_plural(len(u['gids']), 'блок', 'блока', 'блоков')} с общим условием" if u["gids"] else "")
        return (f'<a class="zt-card zt-link" href="/zadaniya/{level}/{subject}/{u["slug"]}"><span class="zt-num">{u["label"]}</span>'
                f'<h3>{html.escape(tt)}</h3><small>{_fmt(n_t)} {_plural(n_t, "задача", "задачи", "задач")}{extra} · до {ms} '
                f'{_plural(ms, "балла", "баллов", "баллов")}</small></a>')
    cards = "".join(_card(u) for u in us)
    stats = (f"<div class='zt-stats'><div class='zt-stat'><b>{_fmt(total)}</b><span>задач в банке</span></div>"
             f"<div class='zt-stat'><b>{len(tls)}</b><span>{_plural(len(tls), 'номер', 'номера', 'номеров')} задания</span></div>"
             + (f"<div class='zt-stat'><b>{_fmt(ntop)}</b><span>{_plural(ntop, 'тема', 'темы', 'тем')}</span></div>" if ntop else "")
             + "</div>")
    body = (f"{crumbs}<section class='zt-hero'><div><span class='zt-eyebrow'>{ln} · {html.escape(sname)}</span>"
            f"<h1>Задания {ln} по {html.escape(subj_dat(sname))}</h1>"
            f"<p>{html.escape(desc)}</p><p>Выберите номер задания, чтобы посмотреть примеры задач и темы, или сразу соберите вариант.</p>"
            f"<div class='zt-btns'><a class='zt-btn zt-btn--lime' href='/{level}/{subject}'>Решать задания {ln}</a>"
            f"<a class='zt-btn zt-btn--glass' href='/generator'>Собрать вариант →</a></div></div>{stats}</section>"
            f"<section class='zt-sec'><h2>Все номера {ln} по {html.escape(subj_dat(sname))}</h2>"
            f"<p class='zt-sub'>Задачи из банка, сгруппированные по номерам и темам.</p><div class='zt-grid'>{cards}</div></section>"
            + _how(ln) + _band(level, subject, ln))
    return _render(title, desc, canonical, body, [ld_c])


def _numgrid(level, subject, us, cur_slug, ln, sd):
    idx = next(i for i, u in enumerate(us) if u["slug"] == cur_slug)
    pu = us[idx - 1] if idx > 0 else None
    nu = us[idx + 1] if idx + 1 < len(us) else None
    word = lambda u: "Задания" if u["gids"] else "Задание"
    pn = "<div class='zt-pn'>" + (
        f"<a class='zt-btn zt-btn--ghost' href='/zadaniya/{level}/{subject}/{pu['slug']}'>← {word(pu)} {pu['label']}</a>"
        if pu else "<span></span>") + (
        f"<a class='zt-btn zt-btn--ghost' href='/zadaniya/{level}/{subject}/{nu['slug']}'>{word(nu)} {nu['label']} →</a>"
        if nu else "") + "</div>"
    cells = "".join(
        (f"<b>{u['label']}</b>" if u["slug"] == cur_slug else
         f"<a href='/zadaniya/{level}/{subject}/{u['slug']}' title='{html.escape(clean_topic(u['tls'][0].task_title), quote=True)}'>{u['label']}</a>")
        for u in us)
    return (f"<section class='zt-sec'><h2>Другие задания {ln} по {html.escape(sd)}</h2><div class='zt-nums'>{cells}</div>{pn}"
            f"<p><a href='/zadaniya/{level}/{subject}'>Все задания {ln} по {html.escape(sd)} →</a></p></section>")


def task_page(request, level, subject, number):
    if level not in LEVELS:
        raise Http404
    neighbours = [t for t in published_tasklists() if t.level.level == level and t.subject.subject_short == subject]
    tl = next((t for t in neighbours if t.task_number == int(number)), None)
    if tl is None:
        raise Http404
    us = units(level, subject)
    u = _unit_of(us, tl.task_number)
    if u and u["gids"]:  # r45: номер из блока с общим условием -> страница блока (без дублей)
        return HttpResponsePermanentRedirect(f"/zadaniya/{level}/{subject}/{u['slug']}")
    ln, sname, n = LEVELS[level], tl.subject.subject_name, tl.task_number
    sd = subj_dat(sname)
    topic = clean_topic(tl.task_title)
    tasks = Task.objects.filter(task=tl, is_active=True, scope="global")
    topics = list(tasks.exclude(subtopic=None).values("subtopic__title").annotate(c=Count("id")).order_by("-c")[:16])
    samples, seen, pool = [], set(), []
    for t in tasks.order_by("id")[:300]:
        body, nimg, ext = clean_task_html(t.task_template)
        plain = _excerpt(t.task_template, 100000)
        key = plain[:200]
        if ext or len(plain) < 40 or key in seen or len(body) > 30000:
            continue
        seen.add(key)
        pool.append((t, body, len(plain)))
    used_sub = set()
    for item in pool:  # сначала по одной задаче на тему, потом добираем
        if item[0].subtopic_id not in used_sub:
            used_sub.add(item[0].subtopic_id)
            samples.append(item)
        if len(samples) == 3:
            break
    for item in pool:
        if len(samples) >= 3:
            break
        if item not in samples:
            samples.append(item)
    lessons = list(Lesson.objects.filter(status=Lesson.Status.PUBLISHED, exam_type=level, task_number=n,
                                         subject__iexact=sname).exclude(access_level=Lesson.AccessLevel.PRIVATE)[:6])
    num_re = re.compile(rf"задани[еяи]\s*№?\s*{n}\b", re.I)
    trainers = [it for it in InterestingItem.objects.filter(status=InterestingItem.Status.PUBLISHED)
                if ln in it.title and num_re.search(it.title)][:6]

    h1 = f"Задание {n} {ln} по {sd}" + (f": {lc_first(topic)}" if topic else "")
    title = seo.short_title(h1)
    topic_part = f" Темы: {', '.join(t['subtopic__title'] for t in topics[:3])}." if topics else ""
    desc = (f"Задание {n} {ln} по {sd}" + (f" ({lc_first(topic)})" if topic else "") + f": {_fmt(tl.n)} "
            f"{_plural(tl.n, 'задача', 'задачи', 'задач')} в банке, максимальный балл — {tl.max_score}.{topic_part}")[:300]
    canonical = f"{seo.SITE_ORIGIN}/zadaniya/{level}/{subject}/{n}"
    ld_c, crumbs = _crumbs([("Главная", "/"), ("Задания", "/zadaniya"), (f"{ln}", f"/zadaniya/{level}"),
                            (sname, f"/zadaniya/{level}/{subject}"), (f"Задание {n}", f"/zadaniya/{level}/{subject}/{n}")])
    stats = (f"<div class='zt-stats'><div class='zt-stat'><b>{_fmt(tl.n)}</b><span>{_plural(tl.n, 'задача', 'задачи', 'задач')} к заданию {n}</span></div>"
             + (f"<div class='zt-stat'><b>{len(topics)}</b><span>{_plural(len(topics), 'тема', 'темы', 'тем')}</span></div>" if topics else "")
             + f"<div class='zt-stat'><b>{tl.max_score}</b><span>макс. {_plural(tl.max_score or 0, 'балл', 'балла', 'баллов')} за задание</span></div></div>")
    parts = [crumbs,
             f"<section class='zt-hero'><div><span class='zt-eyebrow'>{ln} · {html.escape(sname)} · задание {n}</span>"
             f"<h1>{html.escape(h1)}</h1>"
             f"<p>В банке «Цифрового потока» — {_fmt(tl.n)} {_plural(tl.n, 'задача', 'задачи', 'задач')} к заданию {n} {ln} "
             f"по {html.escape(sd)}. Соберите из них вариант в формате {ln} или рабочую тетрадь для учеников.</p>"
             f"<p>Для репетиторов, преподавателей и онлайн-школ, которым важно держать материалы, учеников и задания в одной системе.</p>"
             f"<div class='zt-btns'><a class='zt-btn zt-btn--lime' href='/{level}/{subject}'>Решать задание {n} на платформе</a>"
             f"<a class='zt-btn zt-btn--glass' href='/generator'>Собрать вариант →</a></div></div>{stats}</section>"]
    if topics:
        parts.append("<section class='zt-sec'><h2>Темы задания</h2><p class='zt-sub'>Сколько задач каждой темы есть в банке.</p>"
                     "<div class='zt-chips'>" + "".join(
                         f"<span class='zt-chip'>{html.escape(t['subtopic__title'])}<em>{_fmt(t['c'])}</em></span>" for t in topics)
                     + "</div></section>")
    if samples:
        cards = []
        for i, (t, body, plen) in enumerate(samples, 1):
            sub = t.subtopic.title if t.subtopic_id else ""
            inner = f"<div class='zt-tbody'>{body}</div>"
            if plen > 700:
                inner = (f"<div class='zt-clamp'><input type='checkbox' id='zt-more-{i}'>{inner}"
                         f"<label for='zt-more-{i}'>Показать полностью ↓</label></div>")
            cards.append(f"<article class='zt-card'><div class='zt-task-head'><span class='zt-tag'>Пример {i}</span>"
                         + (f"<span class='zt-chip'>{html.escape(sub)}</span>" if sub else "") + f"</div>{inner}"
                         f"<div class='zt-task-foot'><span>Ответ и проверка — на платформе</span>"
                         f"<a class='zt-btn zt-btn--blue' href='/{level}/{subject}'>Решить на платформе</a></div></article>")
        parts.append(f"<section class='zt-sec'><h2>Примеры задач</h2><p class='zt-sub'>Задачи из банка к заданию {n}. "
                     f"Ответы скрыты — проверить решение можно на платформе.</p><div class='zt-tasks'>{''.join(cards)}</div></section>")
    parts.append(_how(ln))
    rel = ""
    if trainers:
        rel += "".join(f"<a class='zt-card zt-link' href='/interesting/{it.slug}/view'><span class='zt-tag'>Тренажёр</span>"
                       f"<h3>{html.escape(it.title)}</h3></a>" for it in trainers)
    if lessons:
        rel += "".join(f"<a class='zt-card zt-link' href='/lessons/{l.slug}/view'><span class='zt-tag'>Готовый урок</span>"
                       f"<h3>{html.escape(l.title)}</h3></a>" for l in lessons)
    if rel:
        parts.append(f"<section class='zt-sec'><h2>Тренажёры и уроки</h2><div class='zt-grid'>{rel}</div></section>")
    parts.append(_band(level, subject, ln))
    parts.append(_numgrid(level, subject, us, str(n), ln, sd))
    ld_page = {"@context": "https://schema.org", "@type": "LearningResource", "name": h1,
               "description": desc, "url": canonical, "inLanguage": "ru", "learningResourceType": "Сборник задач",
               "educationalLevel": ln, "about": topic or tl.task_title, "isAccessibleForFree": True,
               "provider": {"@type": "Organization", "name": seo.BRAND, "url": seo.SITE_ORIGIN + "/"}}
    math = any(re.search(r"\\\(|\\\[|\$", b) for _, b, _ in samples)
    return _render(title, desc, canonical, "".join(parts), [ld_c, ld_page], math=math)


def group_page(request, level, subject, a, b):
    """r45: блок номеров с общим условием (TaskGroup), напр. /zadaniya/oge/math/1-5."""
    if level not in LEVELS:
        raise Http404
    a, b = int(a), int(b)
    us = units(level, subject)
    u = next((x for x in us if x["gids"] and x["a"] == a and x["b"] == b), None)
    if u is None:
        x = _unit_of(us, a)
        if x and x["gids"]:
            return HttpResponsePermanentRedirect(f"/zadaniya/{level}/{subject}/{x['slug']}")
        raise Http404
    tls, nums, label = u["tls"], u["nums"], u["label"]
    ln, sname = LEVELS[level], tls[0].subject.subject_name
    sd = subj_dat(sname)
    topic = clean_topic(tls[0].task_title)
    n_tasks = sum(t.n for t in tls)
    max_sum = sum(t.max_score or 0 for t in tls)
    n_blocks = len(u["gids"])
    # темы: подтема группы, иначе подтема задачи первого номера
    topic_counts = {}
    for g in TaskGroup.objects.filter(id__in=u["gids"]).select_related("subtopic"):
        if g.subtopic_id:
            topic_counts[g.subtopic.title] = topic_counts.get(g.subtopic.title, 0) + 1
    if not topic_counts:
        for r in (Task.objects.filter(taskgroupmember__task_group_id__in=u["gids"], taskgroupmember__task_number=a)
                  .exclude(subtopic=None).values("subtopic__title").annotate(c=Count("id"))):
            topic_counts[r["subtopic__title"]] = r["c"]
    topics = sorted(topic_counts.items(), key=lambda kv: -kv[1])[:16]
    # примеры: целые блоки, по одному на тему
    members = {}
    for m in (TaskGroupMember.objects.filter(task_group_id__in=sorted(u["gids"])[:400])
              .select_related("task", "task__subtopic", "task_group__subtopic").order_by("task_group_id", "task_number")):
        members.setdefault(m.task_group_id, []).append(m)
    samples, used, seen = [], set(), set()
    for pass_ in (0, 1):
        for gid, ms in members.items():
            if len(samples) == 3:
                break
            if gid in seen:
                continue
            g = ms[0].task_group
            sub = g.subtopic.title if g.subtopic_id else (ms[0].task.subtopic.title if ms[0].task.subtopic_id else "")
            if pass_ == 0 and sub in used:
                continue
            rendered, ok = [], True
            for m in ms:
                body, _, ext = clean_task_html(m.task.task_template)
                if ext or len(body) > 30000:
                    ok = False
                    break
                rendered.append((m.task_number, body, len(_excerpt(m.task.task_template, 100000))))
            if not ok or len(_excerpt(ms[0].task.task_template, 300)) < 20:
                continue
            seen.add(gid)
            used.add(sub)
            samples.append((sub, rendered))

    h1 = f"Задания {label} {ln} по {sd}" + (f": {lc_first(topic)}" if topic else "")
    title = seo.short_title(h1)
    topic_part = f" Темы: {', '.join(t for t, _ in topics[:3])}." if topics else ""
    desc = (f"Задания {label} {ln} по {sd}" + (f" ({lc_first(topic)})" if topic else "") +
            f" — блок с общим условием: {_fmt(n_blocks)} {_plural(n_blocks, 'блок', 'блока', 'блоков')} в банке, "
            f"{_fmt(n_tasks)} {_plural(n_tasks, 'задача', 'задачи', 'задач')}, до {max_sum} "
            f"{_plural(max_sum, 'балла', 'баллов', 'баллов')}.{topic_part}")[:300]
    canonical = f"{seo.SITE_ORIGIN}/zadaniya/{level}/{subject}/{u['slug']}"
    ld_c, crumbs = _crumbs([("Главная", "/"), ("Задания", "/zadaniya"), (f"{ln}", f"/zadaniya/{level}"),
                            (sname, f"/zadaniya/{level}/{subject}"), (f"Задания {label}", f"/zadaniya/{level}/{subject}/{u['slug']}")])
    stats = (f"<div class='zt-stats'><div class='zt-stat'><b>{_fmt(n_blocks)}</b><span>{_plural(n_blocks, 'блок', 'блока', 'блоков')} с общим условием</span></div>"
             f"<div class='zt-stat'><b>{_fmt(n_tasks)}</b><span>{_plural(n_tasks, 'задача', 'задачи', 'задач')} к заданиям {label}</span></div>"
             f"<div class='zt-stat'><b>{max_sum}</b><span>макс. {_plural(max_sum, 'балл', 'балла', 'баллов')} за блок</span></div></div>")
    parts = [crumbs,
             f"<section class='zt-hero'><div><span class='zt-eyebrow'>{ln} · {html.escape(sname)} · задания {label}</span>"
             f"<h1>{html.escape(h1)}</h1>"
             f"<p>Задания {label} {ln} по {html.escape(sd)} идут одним блоком: общее условие и {len(nums)} "
             f"{_plural(len(nums), 'вопрос', 'вопроса', 'вопросов')} к нему. В банке «Цифрового потока» — {_fmt(n_blocks)} "
             f"{_plural(n_blocks, 'такой блок', 'таких блока', 'таких блоков')}; генератор берёт блок целиком.</p>"
             f"<p>Для репетиторов, преподавателей и онлайн-школ, которым важно держать материалы, учеников и задания в одной системе.</p>"
             f"<div class='zt-btns'><a class='zt-btn zt-btn--lime' href='/{level}/{subject}'>Решать задания {label} на платформе</a>"
             f"<a class='zt-btn zt-btn--glass' href='/generator'>Собрать вариант →</a></div></div>{stats}</section>"]
    if topics:
        parts.append("<section class='zt-sec'><h2>Темы блока</h2><p class='zt-sub'>Сколько блоков каждой темы есть в банке.</p>"
                     "<div class='zt-chips'>" + "".join(
                         f"<span class='zt-chip'>{html.escape(t)}<em>{_fmt(c)}</em></span>" for t, c in topics) + "</div></section>")
    if samples:
        cards = []
        for i, (sub, rendered) in enumerate(samples, 1):
            qs = []
            for j, (num, body, plen) in enumerate(rendered):
                head = (f"<div class='zt-q-head'><span class='zt-num'>{num}</span><b>"
                        + ("Общее условие и задание " if j == 0 else "Задание ") + f"{num}</b></div>")
                inner = f"<div class='zt-tbody'>{body}</div>"
                if j == 0 and plen > 900:
                    inner = (f"<div class='zt-clamp'><input type='checkbox' id='zt-more-{i}'>{inner}"
                             f"<label for='zt-more-{i}'>Показать условие полностью ↓</label></div>")
                qs.append(f"<div class='zt-q{' zt-q--ctx' if j == 0 else ''}'>{head}{inner}</div>")
            cards.append(f"<article class='zt-card'><div class='zt-task-head'><span class='zt-tag'>Пример блока {i}</span>"
                         + (f"<span class='zt-chip'>{html.escape(sub)}</span>" if sub else "") + "</div>" + "".join(qs) +
                         f"<div class='zt-task-foot'><span>Ответы и проверка — на платформе</span>"
                         f"<a class='zt-btn zt-btn--blue' href='/{level}/{subject}'>Решить блок на платформе</a></div></article>")
        parts.append(f"<section class='zt-sec'><h2>Примеры блоков</h2><p class='zt-sub'>Общее условие показано один раз, "
                     f"под ним — вопросы с номерами. Ответы скрыты.</p><div class='zt-tasks'>{''.join(cards)}</div></section>")
    parts.append(_how(ln))
    trainers = []
    for n in nums:
        num_re = re.compile(rf"задани[еяи]\s*№?\s*{n}\b", re.I)
        trainers += [it for it in InterestingItem.objects.filter(status=InterestingItem.Status.PUBLISHED)
                     if ln in it.title and num_re.search(it.title) and it not in trainers]
    lessons = list(Lesson.objects.filter(status=Lesson.Status.PUBLISHED, exam_type=level, task_number__in=nums,
                                         subject__iexact=sname).exclude(access_level=Lesson.AccessLevel.PRIVATE)[:6])
    rel = "".join(f"<a class='zt-card zt-link' href='/interesting/{it.slug}/view'><span class='zt-tag'>Тренажёр</span>"
                  f"<h3>{html.escape(it.title)}</h3></a>" for it in trainers[:6])
    rel += "".join(f"<a class='zt-card zt-link' href='/lessons/{l.slug}/view'><span class='zt-tag'>Готовый урок</span>"
                   f"<h3>{html.escape(l.title)}</h3></a>" for l in lessons)
    if rel:
        parts.append(f"<section class='zt-sec'><h2>Тренажёры и уроки</h2><div class='zt-grid'>{rel}</div></section>")
    parts.append(_band(level, subject, ln))
    parts.append(_numgrid(level, subject, us, u["slug"], ln, sd))
    ld_page = {"@context": "https://schema.org", "@type": "LearningResource", "name": h1, "description": desc,
               "url": canonical, "inLanguage": "ru", "learningResourceType": "Сборник задач", "educationalLevel": ln,
               "about": topic or tls[0].task_title, "isAccessibleForFree": True,
               "provider": {"@type": "Organization", "name": seo.BRAND, "url": seo.SITE_ORIGIN + "/"}}
    math = any(re.search(r"\\\(|\\\[|\$", body) for _, r in samples for _, body, _ in r)
    return _render(title, desc, canonical, "".join(parts), [ld_c, ld_page], math=math)


# ---------- r87: хабы /zadaniya и /zadaniya/<level> + FAQ ----------

def _focus_index(levels):
    """[(level, ln, [(subject_short, subject_name, units, n_tasks)])] — только фокусные предметы."""
    tls = list(published_tasklists())
    out = []
    for level in levels:
        subs = []
        for subj in seo.FOCUS_SUBJECTS:
            mine = [t for t in tls if t.level.level == level and t.subject.subject_short == subj]
            if mine:
                subs.append((subj, mine[0].subject.subject_name, units(level, subj), sum(t.n for t in mine)))
        if subs:
            out.append((level, LEVELS[level], subs))
    return out


def _faq(idx):
    """Только факты из БД и из того, что уже есть на страницах; без обещаний результатов и сроков."""
    total = sum(n for _, _, subs in idx for _, _, _, n in subs)
    names = ", ".join(f"{ln} по {subj_dat(name)}" for _, ln, subs in idx for _, name, _, _ in subs)
    qa = [
        ("Что есть в разделе «Задания»?",
         f"Страницы по номерам заданий ({names}): темы номера, примеры задач из банка «Цифрового потока» "
         f"и ссылки на соседние номера, тренажёры и готовые уроки."),
        ("Сколько задач в банке по этим номерам?",
         f"Сейчас в банке {_fmt(total)} {_plural(total, 'активная задача', 'активные задачи', 'активных задач')} к этим номерам; "
         f"число на каждой странице считается по базе задач."),
        ("Есть ли ответы к задачам?",
         "На страницах раздела ответы скрыты. Проверить решение можно на платформе."),
        ("Можно ли собрать вариант из этих задач?",
         "Да. В генераторе вариантов можно выбрать номера и темы, собрать вариант в формате КИМ и скачать PDF."),
    ]
    grp = next((u for _, _, subs in idx for _, _, us, _ in subs for u in us if u["gids"]), None)
    if grp:
        qa.append(("Что значит «блок с общим условием»?",
                   "Некоторые номера идут одним блоком: одно общее условие и несколько вопросов к нему. "
                   f"Такие номера собраны на одной странице (например, «Задания {grp['label']}»), "
                   "и генератор берёт блок целиком."))
    ld = {"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [
        {"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in qa]}
    htm = ("<section class='zt-sec'><h2>Частые вопросы</h2>" + "".join(
        f"<details class='zt-card' style='margin:0 0 10px'><summary><b>{html.escape(q)}</b></summary>"
        f"<p>{html.escape(a)}</p></details>" for q, a in qa) + "</section>")
    return ld, htm


def _subject_block(level, ln, subj, name, us, n):
    cells = "".join(f"<a href='/zadaniya/{level}/{subj}/{u['slug']}' title='{html.escape(clean_topic(u['tls'][0].task_title), quote=True)}'>"
                    f"{u['label']}</a>" for u in us)
    return (f"<section class='zt-sec'><h2><a href='/zadaniya/{level}/{subj}'>{ln} по {html.escape(subj_dat(name))}</a></h2>"
            f"<p class='zt-sub'>{_fmt(n)} {_plural(n, 'задача', 'задачи', 'задач')} в банке · {len(us)} "
            f"{_plural(len(us), 'страница', 'страницы', 'страниц')} заданий</p><div class='zt-nums'>{cells}</div>"
            f"<p><a href='/zadaniya/{level}/{subj}'>Все задания {ln} по {html.escape(subj_dat(name))} →</a></p></section>")


def zadaniya_root(request):
    idx = _focus_index(("oge", "ege"))
    if not idx:
        raise Http404
    title = seo.short_title("Задания ОГЭ и ЕГЭ по математике и информатике")
    desc = ("Все номера заданий ОГЭ и ЕГЭ по математике и информатике: темы, примеры задач из банка "
            "«Цифрового потока», уроки и тренажёры по номерам.")
    canonical = f"{seo.SITE_ORIGIN}/zadaniya"
    ld_c, crumbs = _crumbs([("Главная", "/"), ("Задания", "/zadaniya")])
    ld_faq, faq = _faq(idx)
    blocks = "".join(f"<h2 style='margin-top:28px'><a href='/zadaniya/{level}'>Задания {ln}</a></h2>"
                     + "".join(_subject_block(level, ln, *sub) for sub in subs) for level, ln, subs in idx)
    body = (f"{crumbs}<section class='zt-hero'><div><span class='zt-eyebrow'>ОГЭ · ЕГЭ</span>"
            f"<h1>Задания ОГЭ и ЕГЭ по математике и информатике</h1><p>{html.escape(desc)}</p>"
            "<div class='zt-btns'><a class='zt-btn zt-btn--lime' href='/zadaniya/oge'>Задания ОГЭ</a>"
            "<a class='zt-btn zt-btn--glass' href='/zadaniya/ege'>Задания ЕГЭ</a></div></div></section>"
            + blocks + _how("ОГЭ и ЕГЭ") + faq)
    return _render(title, desc, canonical, body, [ld_c, ld_faq])


def zadaniya_level(request, level):
    if level not in LEVELS:
        raise Http404
    idx = _focus_index((level,))
    if not idx:
        raise Http404
    ln = LEVELS[level]
    title = seo.short_title(f"Задания {ln} по математике и информатике")
    desc = (f"Номера заданий {ln} по математике и информатике: темы, примеры задач из банка «Цифрового потока», "
            f"уроки и тренажёры по номерам.")
    canonical = f"{seo.SITE_ORIGIN}/zadaniya/{level}"
    ld_c, crumbs = _crumbs([("Главная", "/"), ("Задания", "/zadaniya"), (ln, f"/zadaniya/{level}")])
    ld_faq, faq = _faq(idx)
    other = "ege" if level == "oge" else "oge"
    body = (f"{crumbs}<section class='zt-hero'><div><span class='zt-eyebrow'>{ln}</span>"
            f"<h1>Задания {ln} по математике и информатике</h1><p>{html.escape(desc)}</p>"
            f"<div class='zt-btns'><a class='zt-btn zt-btn--lime' href='/subject/{level}'>Генератор вариантов {ln}</a>"
            f"<a class='zt-btn zt-btn--glass' href='/zadaniya/{other}'>Задания {LEVELS[other]} →</a></div></div></section>"
            + "".join(_subject_block(level, ln, *sub) for sub in idx[0][2]) + _how(ln) + faq)
    return _render(title, desc, canonical, body, [ld_c, ld_faq])
