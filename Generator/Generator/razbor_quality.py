"""r131: проверка качества .md-разбора перед публикацией (ответы, LaTeX, картинки)."""
import html
import json
import os
import re
import subprocess
from pathlib import Path

IMG_RE = re.compile(r"!\[([^\]]*)\]\(([^)\s]+)\)")
TASK_HEAD_RE = re.compile(r"^#{2,4}\s.*?task_id\s*(\d+)", re.M)
ANSWER_RE = re.compile(r"\*\*\s*Ответ\s*:\s*(?:\*\*\s*)?([^*\n]+?)\s*(?:\*\*|$)", re.M)  # r132: и «**Ответ:** X»
MATH_RE = re.compile(r"\$\$(.+?)\$\$|(?<!\\)\$(.+?)(?<!\\)\$", re.S)
TEX_OUTSIDE_RE = re.compile(r"\\(?:cdot|times|dfrac|frac|sqrt|le|ge|approx|pi|text|left|right)\b|\{,\}|\\%")
CODE_RE = re.compile(r"```.*?```|`[^`\n]*`", re.S)


def media_rel(src):
    """/workspace/razbory/in/img/task_files/x.png -> task_files/x.png; /media/x -> x."""
    if src.startswith(("http://", "https://", "data:")):
        return None
    if src.startswith("/media/"):
        return src[len("/media/"):]
    if "/img/" in src:
        return src.split("/img/", 1)[1]
    return src.lstrip("/")


def rewrite_images(md):
    def sub(m):
        rel = media_rel(m.group(2))
        return m.group(0) if rel is None else f"![{m.group(1)}](/media/{rel})"
    return IMG_RE.sub(sub, md)


def norm_answer(s):
    s = html.unescape(re.sub(r"<[^>]+>", " ", s or ""))
    s = re.sub(r"\.?\s*В банке тот же ответ\.?\s*$", "", s.strip(), flags=re.I)  # r134
    # r136: обёртки \( \) и \[ \] из банка
    s = re.sub(r"\\[()\[\]]", "", s)
    # r133: LaTeX-оформление ответа -> текст как в базе ($-5$; $(2{,}5;0)$; \sqrt{5}; \le)
    s = s.replace("$", "").replace("{,}", ",").replace("\\,", "").replace("\\;", "").replace("\\!", "")
    s = s.replace("\\ ", " ").replace("\\left", "").replace("\\right", "").replace("\\{", "{").replace("\\}", "}")
    s = re.sub(r"\\sqrt\{([^{}]*)\}", r"√\1", s)
    # r136: \frac{a}{b}, \dfrac{a}b, \dfrac32 -> a/b
    arg = r"(\{[^{}]*\}|[0-9A-Za-z])"
    s = re.sub(r"\\[dt]?frac\s*" + arg + r"\s*" + arg,
               lambda m: m.group(1).strip("{}") + "/" + m.group(2).strip("{}"), s)
    for a, b in (("\\le", "≤"), ("\\ge", "≥"), ("\\pi", "π"), ("\\cdot", "·"), ("\\infty", "∞"),
                 ("\\in", "∈"), ("\\cup", "∪"), ("\\pm", "±"), ("−", "-"), ("–", "-")):
        s = s.replace(a, b)
    s = s.replace("\u00a0", " ").strip().rstrip(".").replace(" ", "").replace(".", ",").lower()
    s = re.sub(r"^[a-zа-я]∈", "", s)  # r136: «a∈(…)» == «(…)»
    s = re.sub(r"(\d),0+(?!\d)", r"\1", s)  # r136: 90,0 == 90
    s = re.sub(r"(\d,\d*?[1-9])0+(?!\d)", r"\1", s)  # 2,50 == 2,5
    return s


NUM_RE = re.compile(r"\d+(?:,\d+)?")
LONG_ANSWER = 40  # r136: длиннее — развёрнутый ответ-решение из банка


def answer_parts(s):
    """r136: «а)X;б)Y» -> ['X', 'Y'] (пусто, если пунктов нет)."""
    parts = re.split(r"(?:^|[;,])\s*[абвг]\)", s)
    return [p.strip(";,") for p in parts[1:]] if len(parts) > 1 else []


def answers_match(got_raw, want_raw):
    """r136: -> (ok, lenient). lenient=True: банк хранит развёрнутое решение, сверено только число."""
    got, want = norm_answer(got_raw), norm_answer(want_raw)
    cands = [got] + answer_parts(got)
    if any(c == want or strip_unit(c) == want for c in cands):
        return True, False
    if len(want) > LONG_ANSWER:
        final = (answer_parts(got) or [got])[-1]
        nums = NUM_RE.findall(final)
        wnums = set(NUM_RE.findall(want))
        return bool(nums) and all(n in wnums for n in nums), True
    return False, False


def strip_unit(s):
    """r133: «65км/ч» -> «65» (только хвост из букв/единиц после числа)."""
    m = re.fullmatch(r"(-?\d+(?:,\d+)?)[a-zа-яё/²³°]+", s)
    return m.group(1) if m else s


def math_segments(md):
    body = CODE_RE.sub(" ", md)
    return [(m.group(1) if m.group(1) is not None else m.group(2), m.group(1) is not None) for m in MATH_RE.finditer(body)]


def latex_text_problems(md):
    probs = []
    body = CODE_RE.sub(" ", md)
    for para in re.split(r"\n\s*\n", body):
        for ln in para.splitlines():
            if len(re.findall(r"(?<!\\)\$", ln)) % 2:
                probs.append(f"непарный $ в строке: {ln.strip()[:120]}")
        outside = MATH_RE.sub(" ", para)
        for ln in outside.splitlines():
            if TEX_OUTSIDE_RE.search(ln) and "$" not in ln.replace("\\$", ""):
                probs.append(f"LaTeX-команда вне формулы: {ln.strip()[:120]}")
            elif TEX_OUTSIDE_RE.search(ln):
                probs.append(f"LaTeX-команда вне $…$ (вероятно, потерян $): {ln.strip()[:120]}")
    seen, out = set(), []
    for p in probs:
        if p not in seen:
            seen.add(p); out.append(p)
    return out


def latex_render_problems(md, frontend_dir):
    """Рендер всех формул через mathjax-full (node). Возвращает список ошибок."""
    segs = math_segments(md)
    if not segs:
        return []
    script = Path(frontend_dir) / "scripts" / "razbor_check_latex.cjs"
    try:
        p = subprocess.run(["node", str(script)], input=json.dumps([{"latex": s, "display": d} for s, d in segs]),
                           capture_output=True, text=True, timeout=120, cwd=str(frontend_dir))
        res = json.loads(p.stdout or "[]")
    except Exception as e:  # noqa: BLE001
        return [f"не удалось запустить проверку LaTeX: {e}"]
    return [f"формула не рендерится: ${r['latex'][:80]}$ — {r['error']}" for r in res if r.get("error")]


def image_problems(md, media_root, img_root=None, copy=False):
    """Картинки: есть в MEDIA_ROOT или копируются из img_root; файл должен открываться."""
    probs, copied = [], []
    for m in IMG_RE.finditer(md):
        rel = media_rel(m.group(2))
        if rel is None:
            continue
        if ".." in Path(rel).parts:
            probs.append(f"недопустимый путь картинки: {m.group(2)}"); continue
        dst = Path(media_root) / rel
        if not dst.is_file():
            src = Path(img_root) / rel if img_root else None
            if src is None or not src.is_file():
                probs.append(f"картинки нет ни на сервере, ни в исходниках: {rel}"); continue
            if copy:
                dst.parent.mkdir(parents=True, exist_ok=True)
                import shutil
                shutil.copy2(src, dst); copied.append(rel)
                check = dst
            else:
                check = src
        else:
            check = dst
        try:
            from PIL import Image
            with Image.open(check) as im:
                im.verify()
        except Exception as e:  # noqa: BLE001
            if str(check).lower().endswith(".svg") and check.stat().st_size > 0:
                continue
            probs.append(f"картинка не открывается: {rel} ({e})")
    return probs, copied


def answer_problems(md, exam, subject, number, notes=None):
    from .models import Task
    probs = []
    heads = list(TASK_HEAD_RE.finditer(md))
    for i, h in enumerate(heads):
        tid = int(h.group(1))
        end = heads[i + 1].start() if i + 1 < len(heads) else len(md)
        nxt = re.search(r"^#{1,3}\s", md[h.end():end], re.M)
        chunk = md[h.end(): h.end() + nxt.start()] if nxt else md[h.end():end]
        am = ANSWER_RE.search(chunk)
        t = Task.objects.filter(pk=tid).select_related("task__level", "task__subject").first()
        if t is None:
            probs.append(f"task_id {tid}: задачи нет в базе"); continue
        if not (t.is_active and t.scope == "global"):
            probs.append(f"task_id {tid}: задача не в публичном банке")
        tl = t.task
        if tl and (tl.level.level != exam or tl.subject.subject_short != subject or tl.task_number != number):
            probs.append(f"task_id {tid}: в базе это {tl.level.level}/{tl.subject.subject_short} №{tl.task_number}")
        if not am and not re.search(r"\d", norm_answer(t.answer)):
            continue  # r134: практическое задание (файл/программа), числового ответа в базе нет
        if not am:
            probs.append(f"task_id {tid}: в разборе нет строки «**Ответ: …**»"); continue
        got, want = norm_answer(am.group(1)), norm_answer(t.answer)
        if not re.search(r"\d", want):
            continue  # r133: ответ-доказательство/без чисел в базе — формат не сверяем
        ok, lenient = answers_match(am.group(1), t.answer)
        if ok and lenient and notes is not None:
            notes.append(f"task_id {tid}: развёрнутый ответ в банке, сверено итоговое число «{am.group(1)}»")
        if not ok:
            probs.append(f"task_id {tid}: ответ в разборе «{am.group(1)}», в базе «{norm_answer(t.answer)}»")
    return probs


# r134: `…/img/<rel>` (архивы/файлы к заданию) -> ссылка на скачивание /media/<rel>
FILE_RE = re.compile(r"`(/[^`\s]*/img/([^`\s]+\.(?:zip|rar|7z|csv|ods|xlsx|xls|txt|docx|odt|py)))`", re.I)


def rewrite_files(md):
    return FILE_RE.sub(lambda m: f"[{Path(m.group(2)).name}](/media/{m.group(2)})", md)


def file_problems(md, media_root, img_root=None, copy=False):
    import shutil
    probs, copied = [], []
    for m in FILE_RE.finditer(md):
        rel = m.group(2)
        if ".." in Path(rel).parts:
            probs.append(f"недопустимый путь файла: {rel}"); continue
        dst = Path(media_root) / rel
        if dst.is_file() and dst.stat().st_size > 0:
            continue
        src = Path(img_root) / rel if img_root else None
        if src is None or not src.is_file():
            probs.append(f"файла нет ни на сервере, ни в исходниках: {rel}"); continue
        if copy:
            dst.parent.mkdir(parents=True, exist_ok=True); shutil.copy2(src, dst); copied.append(rel)
    rest = FILE_RE.sub("", md)
    rest = IMG_RE.sub("", rest)
    for line in rest.splitlines():
        if "/workspace/" in line:
            probs.append(f"в тексте остался локальный путь: {line.strip()[:120]}")
    return probs, copied
