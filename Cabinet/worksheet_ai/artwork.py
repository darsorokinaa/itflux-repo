"""Иллюстрированный фон листа: рисунок по краям, центр свободен для заданий."""

from __future__ import annotations

import re
from urllib.parse import quote

_SVG_RE = re.compile(r"<svg\b[^>]*>.*?</svg>", re.IGNORECASE | re.DOTALL)
_BAD_RE = re.compile(
    r"<\s*/?\s*(script|foreignObject|iframe|embed|object|image|use)\b|javascript:|on\w+\s*=",
    re.IGNORECASE,
)
_URL_RE = re.compile(r"https?:", re.IGNORECASE)
_XMLNS_RE = re.compile(r"xmlns(?::\w+)?\s*=\s*['\"]http://www\.w3\.org/[^'\"]+['\"]", re.IGNORECASE)
_TEXT_RE = re.compile(r"<text\b[^>]*>.*?</text>|<tspan\b[^>]*>.*?</tspan>", re.IGNORECASE | re.DOTALL)
_DRAW_RE = re.compile(r"<(path|circle|rect|polygon|ellipse|line|polyline)\b", re.IGNORECASE)
_STOCK = (
    "спокойное оформление листа, без лишнего декора.",
    "строгий бланк без декора.",
    "светлый фон, тонкие формулы и небольшие акценты по краям. центральная область чистая.",
    "почти пустой лист, только тонкая рамка.",
    "строгий экзаменационный бланк без декора.",
    "аккуратная учебная полоса, спокойные поля.",
)


def artwork_requested(params: dict) -> bool:
    """Картинка фона нужна только по описанию оформления. Готовый стиль и пожелания к заданиям её не заказывают."""
    chunks = []
    for key in ("custom_style", "theme"):
        text = str(params.get(key) or "").strip()
        if text:
            chunks.append(text)
    if not chunks:
        return False
    blob = "\n".join(chunks).lower().replace("ё", "е")
    for stock in _STOCK:
        blob = blob.replace(stock, " ")
    return len(re.sub(r"[\s.]+", "", blob)) >= 8


_MOOD = (
    (re.compile(r"гарри\s*поттер\w*", re.IGNORECASE), "старинная школа волшебства"),
    (re.compile(r"хогвартс\w*", re.IGNORECASE), "замок, свечи, пергамент и золото"),
)


def illustration_prompt(notes: str) -> str:
    """Промпт картинки фона: настроение листа, без имён чужих персонажей."""
    text = str(notes or "").strip()
    for pattern, replacement in _MOOD:
        text = pattern.sub(replacement, text)
    lowered = text.lower().replace("ё", "е")
    for stock in _STOCK:
        lowered = lowered.replace(stock, " ")
    cleaned = re.sub(r"\s+", " ", lowered).strip(" .")
    if not cleaned:
        cleaned = "яркий учебный плакат с крупными иллюстрациями"
    return (
        "Создай красивый тематический фон для учебного рабочего листа в вертикальном формате A4. "
        "Фон должен выглядеть как цельная профессиональная иллюстрация, а не как шаблон из отдельных блоков, карточек, секций или рамок для заданий. "
        "Главный принцип: оформление располагается преимущественно по краям листа и создаёт атмосферу темы, а центральная часть остаётся светлой, спокойной и достаточно свободной для последующего размещения текста, формул и заданий редактором. "
        "Используй тематические иллюстрации по теме; декоративные элементы по краям, в углах, сверху и снизу; небольшие орнаменты, символы, предметы, абстрактные формы, стикеры, линии, ленты или графические детали; цельную цветовую композицию; аккуратную декоративную рамку или визуальное обрамление, если оно подходит стилю. "
        "Не создавай отдельные прямоугольники, карточки, плашки, поля для ответов, таблицы, блоки с заголовками или специальные области под отдельные задания. "
        "Не рисуй белые карточки и контейнеры поверх фона. "
        "Центральную рабочую область не перегружай иллюстрациями. Она должна оставаться преимущественно светлой и хорошо подходить для наложения учебного контента. "
        "Фон не должен быть пустым бежевым или серым минимализмом. Используй выразительные, гармоничные цвета и заметные тематические детали, но не ухудшай читаемость будущего текста. "
        "Не добавляй никаких букв, цифр, слов, формул, подписей, логотипов или водяных знаков. Весь текст будет добавлен отдельно редактором. "
        "Не изображай известных персонажей, бренды или защищённых авторским правом героев. "
        f"Стиль и тематика оформления: {cleaned}. "
        "Результат должен выглядеть как законченный дизайнерский фон для современного учебного рабочего листа: выразительный по краям, аккуратный в центре, цельный по композиции и пригодный для печати."
    )


def content_image_prompt(notes: str) -> str:
    """Промпт иллюстрации внутри задания: объект в кадре, без чужих персонажей."""
    text = str(notes or "").strip()
    for pattern, replacement in _MOOD:
        text = pattern.sub(replacement, text)
    cleaned = re.sub(r"\s+", " ", text).strip(" .")
    if len(cleaned) < 3:
        cleaned = "простой учебный рисунок"
    return (
        "Нарисуй одну яркую учебную иллюстрацию для задания. "
        "Объект крупно по центру, цвета насыщенные, фон светлый, чтобы предмет сразу читался. "
        "Без букв, цифр, слов, формул и логотипов. "
        "Не изображай известных персонажей. "
        f"Что нарисовать: {cleaned}."
    )


def clean_svg(raw: str) -> str:
    match = _SVG_RE.search(str(raw or ""))
    if not match:
        return ""
    svg = _TEXT_RE.sub("", match.group(0))
    if _BAD_RE.search(svg) or _URL_RE.search(_XMLNS_RE.sub("", svg)):
        return ""
    if not _DRAW_RE.search(svg):
        return ""
    if len(svg) > 50000:
        return ""
    if "xmlns=" not in svg[:180].lower():
        svg = svg.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"', 1)
    return svg


def svg_data_url(raw: str) -> str:
    svg = clean_svg(raw)
    if not svg:
        return ""
    return "data:image/svg+xml;charset=utf-8," + quote(svg, safe="")


def fallback_background_svg(prompt: str) -> str:
    """Рамка листа, если модель не вернула пригодный рисунок."""
    kind, paper, ink, accent, soft = _palette(prompt)
    motifs = _motifs(kind, ink, accent, soft)
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 794 1123">
      <rect width="794" height="1123" fill="{paper}"/>
      <rect x="86" y="168" width="622" height="820" rx="8" fill="{soft}"/>
      <rect x="18" y="18" width="758" height="1087" fill="none" stroke="{accent}" stroke-width="7"/>
      <rect x="30" y="30" width="734" height="1063" fill="none" stroke="{ink}" stroke-width="1.25"/>
      <rect x="38" y="38" width="718" height="1047" fill="none" stroke="{accent}" stroke-width="1.4"/>
      <path d="M78 150 H716" fill="none" stroke="{accent}" stroke-width="1.1"/>
      <path d="M78 162 H716" fill="none" stroke="{ink}" stroke-width="0.6"/>
      <path d="M78 968 H716" fill="none" stroke="{accent}" stroke-width="1.1"/>
      <path d="M78 980 H716" fill="none" stroke="{ink}" stroke-width="0.6"/>
      {_corner_plate(54, 54, ink, accent)}
      {_corner_plate(740, 54, ink, accent, "x")}
      {_corner_plate(54, 1069, ink, accent, "y")}
      {_corner_plate(740, 1069, ink, accent, "xy")}
      {motifs}
    </svg>'''


def _palette(prompt: str) -> tuple[str, str, str, str, str]:
    text = (prompt or "").lower().replace("ё", "е")
    if any(word in text for word in ("хогварт", "гарри", "волшеб", "сказк", "маг", "свеч", "замок", "башн")):
        return "magic", "#f4e7cf", "#5c3b16", "#b8893d", "#fbf6ea"
    if any(word in text for word in ("космос", "звезд", "планет", "галактик")):
        return "cosmos", "#eef3fb", "#1d3557", "#7ea2d4", "#f7faff"
    if any(word in text for word in ("информат", "алгоритм", "код", "егэ")):
        return "info", "#f4f7fb", "#1e3a5f", "#3d7ec9", "#f8fbff"
    if any(word in text for word in ("антич", "рим", "греч", "числ", "истор", "гравюр")):
        return "antique", "#f6efe2", "#4a3422", "#8d6a45", "#fbf7f0"
    return "study", "#f7f1e4", "#3e3428", "#8d6a45", "#fbf8f2"


def _motifs(kind: str, ink: str, accent: str, soft: str) -> str:
    if kind == "info":
        return _info_motifs(ink, accent)
    if kind == "cosmos":
        return _cosmos_motifs(ink, accent)
    if kind == "antique":
        return _antique_motifs(ink, accent)
    if kind == "magic":
        return _magic_motifs(ink, accent, soft)
    return _study_motifs(ink, accent)


def _corner_plate(x: int, y: int, ink: str, accent: str, flip: str = "") -> str:
    scale = ""
    if "x" in flip:
        scale += "scale(-1,1) "
    if "y" in flip:
        scale += "scale(1,-1) "
    return (
        f'<g transform="translate({x} {y}) {scale}" fill="none" stroke-linecap="round">'
        f'<path d="M0,34 H34 V0" stroke="{accent}" stroke-width="2.2"/>'
        f'<path d="M6,34 H28 V6" stroke="{ink}" stroke-width="0.9"/>'
        f'<path d="M0,18 C14,18 18,14 18,0" stroke="{accent}" stroke-width="1.3"/>'
        f'<path d="M0,10 C8,10 10,8 10,0" stroke="{ink}" stroke-width="0.8"/>'
        f'<circle cx="22" cy="22" r="2.2" stroke="{accent}" stroke-width="1"/>'
        f"</g>"
    )


def _place(x: int, y: int, body: str, flip: str = "") -> str:
    scale = ""
    if "x" in flip:
        scale += "scale(-1,1) "
    if "y" in flip:
        scale += "scale(1,-1) "
    return f'<g transform="translate({x} {y}) {scale}">{body}</g>'


def _magic_motifs(ink: str, accent: str, soft: str) -> str:
    candle = (
        f'<rect x="-5" y="0" width="10" height="28" rx="1.5" fill="{soft}" stroke="{ink}" stroke-width="1.2"/>'
        f'<rect x="-5" y="6" width="10" height="2" fill="{accent}"/>'
        f'<path d="M0,-16 C3,-10 4,-6 0,-2 C-4,-6 -3,-10 0,-16 Z" fill="{accent}" stroke="{ink}" stroke-width="0.8"/>'
        f'<path d="M0,-12 C1.2,-8 1.4,-6 0,-4 C-1.4,-6 -1.2,-8 0,-12 Z" fill="{soft}"/>'
    )
    tower = (
        f'<path d="M4,46 V22 H0 L14,4 L28,22 H24 V46 Z" fill="{soft}" stroke="{ink}" stroke-width="1.3"/>'
        f'<path d="M14,4 V0" stroke="{accent}" stroke-width="1.2"/>'
        f'<rect x="8" y="26" width="5" height="7" fill="none" stroke="{accent}" stroke-width="1"/>'
        f'<rect x="16" y="26" width="5" height="7" fill="none" stroke="{accent}" stroke-width="1"/>'
        f'<path d="M11,46 V36 H17 V46" fill="none" stroke="{ink}" stroke-width="1"/>'
    )
    arch = (
        f'<path d="M0,36 V14 C0,4 22,4 22,14 V36" fill="{soft}" stroke="{ink}" stroke-width="1.2"/>'
        f'<path d="M11,36 V16" stroke="{accent}" stroke-width="0.8"/>'
        f'<circle cx="11" cy="12" r="2" fill="{accent}"/>'
    )
    diamond = (
        f'<path d="M0,-10 L7,0 L0,10 L-7,0 Z" fill="none" stroke="{accent}" stroke-width="1.3"/>'
        f'<path d="M0,-5 L3.5,0 L0,5 L-3.5,0 Z" fill="{accent}"/>'
    )
    return "".join((
        _place(118, 78, candle),
        _place(676, 78, candle),
        _place(168, 62, tower),
        _place(598, 62, tower),
        _place(250, 78, arch),
        _place(522, 78, arch),
        _place(397, 92, diamond),
        _place(118, 1004, candle),
        _place(676, 1004, candle),
        _place(397, 1036, diamond),
    ))


def _antique_motifs(ink: str, accent: str) -> str:
    column = (
        f'<path d="M2,40 H22 M0,36 H24 M4,36 V8 H20 V36" fill="none" stroke="{ink}" stroke-width="1.3"/>'
        f'<path d="M4,8 C4,2 20,2 20,8" fill="none" stroke="{accent}" stroke-width="1.2"/>'
        f'<path d="M7,16 H17 M7,24 H17 M7,32 H17" stroke="{accent}" stroke-width="0.7"/>'
    )
    scroll = (
        f'<path d="M0,10 C8,0 20,0 28,8 C34,14 28,22 18,20 C10,18 12,10 20,12" fill="none" stroke="{ink}" stroke-width="1.3"/>'
        f'<path d="M6,14 H16" stroke="{accent}" stroke-width="0.8"/>'
    )
    return "".join((
        _place(150, 70, column),
        _place(620, 70, column),
        _place(250, 86, scroll),
        _place(500, 86, scroll),
        _place(150, 1010, column, "y"),
        _place(620, 1010, column, "y"),
    ))


def _info_motifs(ink: str, accent: str) -> str:
    screen = (
        f'<rect x="0" y="0" width="46" height="30" rx="4" fill="#ffffff" stroke="{ink}" stroke-width="1.6"/>'
        f'<path d="M8,22 L14,12 L20,18 L28,8" fill="none" stroke="{accent}" stroke-width="1.6"/>'
        f'<path d="M16,30 V36 H30 V30" fill="none" stroke="{ink}" stroke-width="1.4"/>'
        f'<path d="M12,36 H34" stroke="{ink}" stroke-width="1.4"/>'
    )
    nodes = (
        f'<circle cx="0" cy="0" r="5" fill="#ffffff" stroke="{accent}" stroke-width="1.6"/>'
        f'<circle cx="22" cy="-8" r="4" fill="#ffffff" stroke="{ink}" stroke-width="1.3"/>'
        f'<circle cx="24" cy="10" r="4" fill="#ffffff" stroke="{ink}" stroke-width="1.3"/>'
        f'<path d="M5,0 H18 M3,3 L20,8" stroke="{accent}" stroke-width="1.2"/>'
    )
    return "".join((
        _place(120, 68, screen),
        _place(620, 68, screen),
        _place(250, 86, nodes),
        _place(500, 86, nodes),
        _place(140, 1040, nodes),
        _place(610, 1040, nodes),
    ))


def _cosmos_motifs(ink: str, accent: str) -> str:
    planet = (
        f'<circle cx="16" cy="16" r="12" fill="#ffffff" stroke="{ink}" stroke-width="1.4"/>'
        f'<ellipse cx="16" cy="16" rx="20" ry="6" fill="none" stroke="{accent}" stroke-width="1.3" transform="rotate(-20 16 16)"/>'
        f'<circle cx="12" cy="12" r="2" fill="{accent}"/>'
    )
    spark = (
        f'<path d="M0,-7 V7 M-7,0 H7" stroke="{accent}" stroke-width="1.1"/>'
        f'<circle r="1.6" fill="{ink}"/>'
    )
    return "".join((
        _place(140, 64, planet),
        _place(610, 64, planet),
        _place(250, 84, spark),
        _place(520, 84, spark),
        _place(397, 78, spark),
        _place(180, 1036, spark),
        _place(610, 1036, spark),
    ))


def _study_motifs(ink: str, accent: str) -> str:
    book = (
        f'<path d="M0,8 C10,0 22,2 28,8 V26 C22,20 10,18 0,26 Z" fill="#fffdf8" stroke="{ink}" stroke-width="1.3"/>'
        f'<path d="M28,8 C38,0 50,2 56,8 V26 C50,20 38,18 28,26 Z" fill="#fffdf8" stroke="{ink}" stroke-width="1.3"/>'
        f'<path d="M28,8 V26" stroke="{accent}" stroke-width="1"/>'
    )
    return "".join((
        _place(160, 78, book),
        _place(560, 78, book),
        _place(300, 90, f'<path d="M0,8 H80" stroke="{accent}" stroke-width="1.2"/>'),
        _place(160, 1008, book, "y"),
        _place(560, 1008, book, "y"),
    ))
