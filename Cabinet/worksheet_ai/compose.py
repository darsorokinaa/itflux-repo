"""Сборка листа только из блоков, которые уже умеет редактор."""

from __future__ import annotations

import html

from .textutil import safe_image_src, sheet_html

STYLE_TO_EDITOR = {
    "minimal": ("minimal", False, False),
    "school": ("textbook", False, False),
    "whiteboard": ("whiteboard", False, False),
    "edtech": ("textbook", False, False),
    "strict": ("exam", False, True),
    "game": ("whiteboard", False, False),
    "thematic": ("whiteboard", False, False),
    "print": ("minimal", True, False),
    "custom": ("minimal", False, False),
}
STYLE_PROMPT = {
    "minimal": "Почти пустой лист, только тонкая рамка.",
    "textbook": "Аккуратная учебная полоса, спокойные поля.",
    "whiteboard": "Светлый фон, тонкие формулы и небольшие акценты по краям. Центральная область чистая.",
    "exam": "Строгий экзаменационный бланк без декора.",
}
_STOCK_PROMPTS = {
    " ".join(text.lower().replace("ё", "е").split()).strip(" .")
    for text in (
        *STYLE_PROMPT.values(),
        "Спокойное оформление листа, без лишнего декора.",
        "Строгий бланк без декора.",
    )
}

LEVEL_LABEL = {"basic": "база", "standard": "стандарт", "advanced": "повышенный"}
BAND_TITLE = {
    "basic": "Базовый уровень",
    "standard": "Стандартный уровень",
    "advanced": "Повышенный уровень",
}
GOAL_PURPOSE = {
    "intro": "intro",
    "practice": "practice",
    "reinforce": "practice",
    "review": "review",
    "check": "check",
    "test_prep": "check",
    "exam_prep": "check",
    "other": "practice",
}
STUDENT_INSTRUCTION = {
    "training": "Решите задания по порядку. Кратко запишите ответ.",
    "homework": "Домашняя работа. Решите задания и оставьте ход решения там, где он нужен.",
    "independent": "Самостоятельная работа. Решите задания без подсказок.",
    "control": "Контрольная работа. Решите задания самостоятельно.",
    "quiz": "Проверочная работа. Запишите только ответ, если не сказано иначе.",
    "lesson": "Рабочий лист урока. Сначала прочитайте вступление, затем решите задания.",
    "review": "Повторение. Вспомните правило и решите задания от простого к сложному.",
    "other": "Решите задания по теме листа.",
}


def _block_id(prefix: str, number: int) -> str:
    return f"ai{prefix}{number}"


def question_with_images(item: dict) -> str:
    question = sheet_html(item.get("text") or "")
    tags = []
    seen = set()
    for src in item.get("images") or []:
        safe = safe_image_src(src)
        if not safe or safe in seen:
            continue
        seen.add(safe)
        tags.append(f'<p><img src="{html.escape(safe, quote=True)}" alt=""></p>')
    return f"{question}{''.join(tags)}" if question else "".join(tags)


def editor_task(item: dict) -> dict:
    task_type = item.get("task_type") or "short_answer"
    question = question_with_images(item)
    answer = item.get("answer") or ""
    solution = item.get("solution") or ""
    if task_type == "single_choice" and item.get("options"):
        options = []
        correct = str(answer).strip().upper()
        for index, option in enumerate(item["options"]):
            label = chr(65 + index)
            text = option.get("text") if isinstance(option, dict) else str(option)
            options.append({
                "id": f"opt{index}{item.get('key', index)}",
                "label": label,
                "text": text,
                "correct": bool(option.get("correct")) if isinstance(option, dict) and "correct" in option else label == correct or text == answer,
            })
        return {
            "type": "single_choice",
            "question": question,
            "q": question,
            "content": {"multiple": False, "shuffle": True},
            "answer": {"options": options},
            "teacher_settings": {},
            "student_settings": {},
        }
    if task_type == "solution" or len(solution) > 80:
        return {
            "type": "solution",
            "question": question,
            "q": question,
            "content": {"lines": "4", "showWork": True, "showAnswer": True, "checkMode": "manual"},
            "answer": {"final": answer, "solution": solution},
            "teacher_settings": {},
            "student_settings": {},
        }
    return {
        "type": "short_answer",
        "question": question,
        "q": question,
        "content": {"answerKind": "text", "tolerance": 0, "caseInsensitive": True, "ignoreSpaces": True},
        "answer": {"values": [answer] if answer else [""]},
        "teacher_settings": {},
        "student_settings": {},
    }


def _plain_prompt(text: str) -> bool:
    cleaned = " ".join(str(text or "").lower().replace("ё", "е").split()).strip(" .")
    return not cleaned or cleaned in _STOCK_PROMPTS


def design_for(params: dict) -> dict:
    style_id, mono, toner = STYLE_TO_EDITOR.get(params.get("style") or "school", STYLE_TO_EDITOR["school"])
    theme = str(params.get("theme") or "").strip()
    custom = str(params.get("custom_style") or "").strip()
    requested = theme or custom
    if _plain_prompt(requested):
        prompt = STYLE_PROMPT.get(style_id, "Спокойное оформление листа, без лишнего декора.")
    else:
        prompt = requested
        if style_id == "exam" and "Строгий бланк" not in prompt:
            prompt = "Строгий бланк без декора. " + prompt
    density = "плотная" if "компакт" in (params.get("wishes") or "").lower() else "обычная"
    wishes = (params.get("wishes") or "").lower()
    lines = 3
    if any(mark in wishes for mark in ("побольше места", "место для решения", "место для записи")):
        lines = 6
    elif params.get("format") in {"control", "homework", "independent"}:
        lines = 4
    return {
        "style": style_id,
        "mono": mono or params.get("style") == "print",
        "toner": toner,
        "density": density,
        "themePrompt": prompt[:800],
        "workLines": lines,
        "accentNote": (theme or custom)[:120],
        "source": "layout",
    }


def apply_ai_design(base: dict, payload: dict) -> dict:
    """Модель выбирает только поля, которые уже умеет редактор."""
    design = dict(base)
    style = payload.get("style")
    if style in {"whiteboard", "minimal", "exam", "textbook"}:
        design["style"] = style
    if "mono" in payload:
        design["mono"] = bool(payload.get("mono"))
    if "toner" in payload:
        design["toner"] = bool(payload.get("toner"))
    density = payload.get("density")
    if density in {"обычная", "плотная"}:
        design["density"] = density
    lines = payload.get("work_lines")
    if isinstance(lines, bool) or not isinstance(lines, int):
        lines = None
    if isinstance(lines, int) and 0 <= lines <= 8:
        design["workLines"] = lines
    intro = str(payload.get("intro") or "").strip()
    if intro:
        design["intro"] = intro[:400]
    sections = []
    for item in payload.get("sections") or []:
        title = item.get("title") if isinstance(item, dict) else item
        title = str(title or "").strip()
        if not title:
            continue
        sections.append(title[:80])
        if len(sections) >= 4:
            break
    if sections:
        design["sections"] = sections
    design["source"] = "ai"
    return design


def compose_worksheet(params: dict, tasks: list[dict], *, theory: str = "", design: dict | None = None) -> dict:
    design = design or design_for(params)
    blocks = []
    seq = 1
    theory = str(theory or "").strip()
    if theory:
        blocks.append({
            "id": _block_id("t", seq),
            "type": "heading",
            "text": "Теория",
            "align": "left",
            "fullWidth": True,
        })
        seq += 1
        blocks.append({
            "id": _block_id("t", seq),
            "type": "text",
            "text": theory,
            "align": "left",
            "fullWidth": True,
        })
        seq += 1
    instruction = design.get("intro") or STUDENT_INSTRUCTION.get(params.get("format") or "", STUDENT_INSTRUCTION["other"])
    blocks.append({
        "id": _block_id("n", seq),
        "type": "text",
        "text": instruction,
        "align": "left",
        "fullWidth": bool(theory),
    })
    seq += 1
    mixed = params.get("difficulty") == "mixed"
    exact_variant = bool(params.get("variant_id"))
    if not mixed and not exact_variant:
        for title in design.get("sections") or []:
            blocks.append({
                "id": _block_id("h", seq),
                "type": "heading",
                "text": title,
                "align": "left",
            })
            seq += 1
    last_band = None
    number = 0
    for index, item in enumerate(tasks, start=1):
        band = item.get("difficulty") or "standard"
        if mixed and not exact_variant and band != last_band:
            blocks.append({
                "id": _block_id("h", seq),
                "type": "heading",
                "text": BAND_TITLE.get(band, "Задания"),
                "groupId": band,
            })
            seq += 1
            last_band = band
        number += 1
        lines = design["workLines"] if item.get("needs_work") or item.get("task_type") == "solution" else 0
        if design["workLines"] >= 6:
            lines = design["workLines"]
        blocks.append({
            "id": _block_id("q", index),
            "type": "task",
            "number": number,
            "groupId": band,
            "groupTitle": BAND_TITLE.get(band, ""),
            "structure": "",
            "skill": item.get("skill") or "",
            "level": LEVEL_LABEL.get(band, "стандарт"),
            "points": 2 if band == "advanced" else 1,
            "task": editor_task({**item, "key": index}),
            "workArea": {"kind": "lines", "lines": lines} if lines else {"kind": "none"},
            "showLevel": False,
            "showPoints": False,
            "origin": item.get("origin") or "bank",
            "bankTaskId": item.get("bank_task_id"),
            "candidateId": item.get("candidate_id"),
            "x": 48,
            "y": 200,
            "w": 690,
            "h": 110,
            "z": number + 5,
            "padding": 8,
            "locked": False,
            "placed": False,
        })
    grade = str(params.get("grade") or "")
    if not grade and params.get("level_label"):
        grade = params["level_label"]
    goal = params.get("goal_text") or _goal_line(params)
    form = {
        "subject": params.get("subject_name") or "",
        "grade": grade,
        "topic": params.get("topic") or "Рабочий лист",
        "goal": goal,
        "purpose": GOAL_PURPOSE.get(params.get("goal") or "", "practice"),
        "count": len(tasks),
        "minutes": max(10, round(len(tasks) * 3.5)),
        "difficulty": "От простого к сложному" if mixed else "Равномерная",
        "style": design["style"],
        "themePrompt": design["themePrompt"],
        "extra": str(params.get("wishes") or "").strip()[:800],
        "background": design.get("background") or "",
        "mono": design["mono"],
        "toner": design["toner"],
        "density": design["density"],
        "answers": True,
        "solutions": True,
        "studentLine": True,
        "criteria": params.get("format") in {"control", "quiz"},
        "variants": 1,
        "variantNumber": str(params.get("variant_id") or ""),
    }
    return {"blocks": blocks, "form": form, "design": design}


def _goal_line(params: dict) -> str:
    topic = params.get("topic") or "теме"
    labels = {
        "intro": f"Познакомиться с темой «{topic}» и решить первые задания.",
        "practice": f"Отработать тему «{topic}».",
        "review": f"Повторить тему «{topic}».",
        "reinforce": f"Закрепить тему «{topic}».",
        "check": f"Проверить понимание темы «{topic}».",
        "test_prep": f"Подготовиться к контрольной по теме «{topic}».",
        "exam_prep": f"Подготовиться к экзамену по теме «{topic}».",
        "other": f"Решить задания по теме «{topic}».",
    }
    return labels.get(params.get("goal") or "", labels["practice"])
