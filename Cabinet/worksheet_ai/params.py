"""Разбор формы. Цена, user_id и список заданий с клиента не принимаются."""

from __future__ import annotations

from Generator.models import Level, Subject

from .textutil import clean_text

BLOCKED = {
    "user_id", "teacher_id", "cost", "price", "balance", "estimated_cost",
    "task_ids", "selected_tasks", "model", "plan", "credits",
}

GOALS = {"intro", "practice", "review", "reinforce", "check", "test_prep", "exam_prep", "other"}
FORMATS = {"training", "homework", "independent", "control", "quiz", "lesson", "review", "other"}
STYLES = {"minimal", "school", "whiteboard", "edtech", "strict", "game", "thematic", "print", "custom"}
DIFFICULTIES = {"basic", "standard", "advanced", "mixed"}
WORDING = {"original", "rephrase", "theme"}
INTENSITIES = {"light", "medium", "vivid"}

GOAL_DEFAULT_THEORY = {"intro"}
FORMAT_DEFAULT_THEORY = {"lesson"}


def exam_code(level_label: str) -> str:
    label = (level_label or "").lower()
    if "огэ" in label:
        return "oge"
    if "егэ" in label and "проф" in label:
        return "ege_profile"
    if "егэ" in label and "баз" in label:
        return "ege_base"
    if "егэ" in label:
        return "ege"
    if "впр" in label:
        return "vpr"
    return ""


class ParseError(Exception):
    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


def parse_request(raw: dict, *, max_tasks: int) -> dict:
    data = dict(raw or {})
    for key in BLOCKED:
        data.pop(key, None)
    try:
        subject_id = int(data.get("subject_id"))
    except (TypeError, ValueError) as exc:
        raise ParseError("Выберите предмет.") from exc
    subject = Subject.objects.filter(pk=subject_id).first()
    if not subject:
        raise ParseError("Предмет не найден.")
    grade = None
    if data.get("grade") not in (None, ""):
        try:
            grade = int(data.get("grade"))
        except (TypeError, ValueError) as exc:
            raise ParseError("Класс указан неверно.") from exc
        if grade < 1 or grade > 11:
            raise ParseError("Класс должен быть от 1 до 11.")
    level_id = None
    level_label = ""
    if data.get("level_id") not in (None, ""):
        try:
            level_id = int(data.get("level_id"))
        except (TypeError, ValueError) as exc:
            raise ParseError("Уровень указан неверно.") from exc
        level = Level.objects.filter(pk=level_id).first()
        if not level:
            raise ParseError("Уровень не найден.")
        level_label = level.level_rus or level.level
    if grade is None and level_id is None:
        raise ParseError("Укажите класс или уровень.")
    topic = clean_text(data.get("topic"), 200)
    if len(topic) < 2:
        raise ParseError("Укажите тему рабочего листа.")
    try:
        task_count = int(data.get("task_count") or 10)
    except (TypeError, ValueError) as exc:
        raise ParseError("Укажите количество заданий.") from exc
    if task_count < 1 or task_count > max_tasks:
        raise ParseError(f"Количество заданий должно быть от 1 до {max_tasks}.")
    difficulty = data.get("difficulty") or "standard"
    if difficulty not in DIFFICULTIES:
        raise ParseError("Неизвестная сложность.")
    goal = data.get("goal") or "practice"
    if goal not in GOALS:
        raise ParseError("Неизвестная цель листа.")
    sheet_format = data.get("format") or "training"
    if sheet_format not in FORMATS:
        raise ParseError("Неизвестный формат листа.")
    style = data.get("style") or "school"
    if style not in STYLES:
        raise ParseError("Неизвестный стиль оформления.")
    wording = data.get("wording") or "original"
    if wording not in WORDING:
        raise ParseError("Неизвестный режим условий.")
    intensity = data.get("style_intensity") or "light"
    if intensity not in INTENSITIES:
        raise ParseError("Неизвестная интенсивность стилизации.")
    subtopics = []
    for item in data.get("subtopics") or []:
        text = clean_text(item, 120)
        if text and text not in subtopics:
            subtopics.append(text)
        if len(subtopics) >= 8:
            break
    wants_theory = data.get("wants_theory")
    if wants_theory is None:
        wants_theory = goal in GOAL_DEFAULT_THEORY or sheet_format in FORMAT_DEFAULT_THEORY
    if sheet_format in {"control", "quiz"} and data.get("wants_theory") is None:
        wants_theory = False
    return {
        "subject_id": subject.id,
        "subject_name": subject.subject_name or subject.subject_short,
        "grade": grade,
        "level_id": level_id,
        "level_label": level_label,
        "topic": topic,
        "subtopics": subtopics,
        "task_count": task_count,
        "difficulty": difficulty,
        "goal": goal,
        "goal_text": clean_text(data.get("goal_text"), 400),
        "format": sheet_format,
        "style": style,
        "custom_style": clean_text(data.get("custom_style"), 800),
        "theme": clean_text(data.get("theme"), 200),
        "wording": wording,
        "style_intensity": intensity,
        "ai_design": bool(data.get("ai_design")),
        "exam": exam_code(level_label),
        "wishes": clean_text(data.get("wishes"), 4000),
        "wants_theory": bool(wants_theory),
        "variant_id": _variant_id(data.get("variant_id")),
    }


def _variant_id(value):
    if value in (None, "", 0, "0"):
        return None
    try:
        number = int(value)
    except (TypeError, ValueError) as exc:
        raise ParseError("Номер варианта должен быть числом.") from exc
    if number < 1:
        raise ParseError("Укажите номер варианта.")
    return number
