"""Единый подсчёт первичных баллов и статусов заданий варианта.

Количество верных заданий и набранные баллы считаются отдельно.
Пропуск и задание без ручной оценки не становятся неправильными.
Снимок состава хранится в результате попытки и не пересобирается,
если вариант потом изменили. Эталон задания внутри снимка обновляется,
когда в банке меняется ответ или текст этой задачи.
"""

from __future__ import annotations

import html
import re
from typing import Any

_BLOCK_CLOSE_RE = re.compile(r"</(?:p|div|li|tr|h[1-6])>", re.IGNORECASE)
_BR_RE = re.compile(r"<br\s*/?>", re.IGNORECASE)
_TAG_RE = re.compile(r"<[^>]+>")
_NUM_RE = re.compile(r"^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$")

_GRADE_KEYS = ("scores", "checked", "scoring", "manual_stats")


def task_max_points(task: dict | None) -> int:
    """Максимум задания. Пустое значение — 1, как в модели TaskList/Task."""
    raw = (task or {}).get("max_score")
    if raw is None or raw == "":
        return 1
    try:
        number = float(raw)
    except (TypeError, ValueError):
        return 1
    if number < 0:
        return 0
    return int(number) if number == int(number) else int(number)


def logical_exam_part(task: dict | None, level: str = "", subject: str = "") -> int:
    """Та же развилка, что inferExamTaskPart на клиенте: 1 авто, 2 вручную."""
    task = task or {}
    try:
        exam_part = int(task.get("exam_part"))
    except (TypeError, ValueError):
        exam_part = 0
    if exam_part == 2:
        return 2
    if exam_part == 1:
        return 1

    title = str(task.get("part_title") or "").strip().lower()
    if re.search(r"говорен|устн|speaking|oral", title):
        return 2
    if re.search(r"часть\s*2\b", title) or title == "2":
        return 2
    if re.search(r"часть\s*1\b", title) or title == "1":
        return 1

    try:
        part_id = int(task.get("part"))
    except (TypeError, ValueError):
        part_id = 0
    if part_id == 1:
        return 1
    if part_id == 2:
        return 2
    if part_id >= 3:
        return 2

    try:
        number = int(task.get("number"))
    except (TypeError, ValueError):
        number = 0
    lv = str(level or "").strip().lower()
    sub = str(subject or "").strip().lower()
    math_like = sub in {"math", "math_base"}
    if lv == "ege" and sub in {"eng", "eng_speaking"}:
        return 2
    if lv == "oge" and math_like:
        return 1 if number <= 19 else 2
    if lv == "ege" and math_like:
        return 1 if number <= 11 else 2
    if lv == "oge" and sub == "inf":
        return 1 if number <= 15 else 2
    if lv == "ege" and sub == "inf":
        return 1 if number <= 27 else 2
    if lv == "ege" and sub == "chem":
        return 1 if number <= 28 else 2
    return 1 if number <= 19 else 2


def lesson_result_counts(*, total_tasks: int, correct_count: int, answered_wrong_count: int) -> dict[str, int]:
    """Верно + неверно + пусто = число заданий. Пустые не входят в неверные."""
    total = max(0, int(total_tasks or 0))
    correct = max(0, int(correct_count or 0))
    wrong = max(0, int(answered_wrong_count or 0))
    if correct > total:
        correct = total
    if correct + wrong > total:
        wrong = total - correct
    return {
        "total_tasks": total,
        "correct_count": correct,
        "wrong_count": wrong,
        "empty_count": total - correct - wrong,
    }


def strip_previous_grades(payload: dict | None) -> dict:
    """Новая сдача после возврата не наследует баллы прошлой проверки."""
    out = dict(payload or {})
    for key in _GRADE_KEYS:
        out.pop(key, None)
    return out


def _html_to_text(value) -> str:
    text = str(value or "")
    text = _BR_RE.sub("\n", text)
    text = _BLOCK_CLOSE_RE.sub("\n", text)
    text = _TAG_RE.sub("", text)
    text = html.unescape(text).replace("\xa0", " ")
    return text.strip()


def _cell_norm(value) -> str:
    from .answer_check import normalize_answer

    return normalize_answer(value)


def _parse_table(raw, rows: int = 7, cols: int = 2) -> list[list[str]]:
    lines = str(raw or "").splitlines()
    matrix = []
    for index in range(rows):
        line = lines[index] if index < len(lines) else ""
        cells = [cell.strip() for cell in line.split("\t")[:cols]]
        while len(cells) < cols:
            cells.append("")
        matrix.append(cells)
    return matrix


def score_informatics_table(task_number, user_raw, correct_html) -> int | None:
    """0/1/2 для ЕГЭ информатика №26 и №27. None — обычное задание."""
    try:
        number = int(task_number)
    except (TypeError, ValueError):
        return None
    if number not in (26, 27):
        return None
    user = _parse_table(user_raw)
    correct = _parse_table(_html_to_text(correct_html))
    if number == 26:
        left = _cell_norm((user[0] or [""])[0]) == _cell_norm((correct[0] or [""])[0])
        right = _cell_norm((user[0] or ["", ""])[1]) == _cell_norm((correct[0] or ["", ""])[1])
        matched = int(left) + int(right)
        return 2 if matched == 2 else 1 if matched == 1 else 0
    row_ok = []
    for index in (0, 1):
        u = user[index]
        c = correct[index]
        row_ok.append(_cell_norm(u[0]) == _cell_norm(c[0]) and _cell_norm(u[1]) == _cell_norm(c[1]))
    if row_ok[0] and row_ok[1]:
        return 2
    if row_ok[0] or row_ok[1]:
        return 1
    return 0


def _numeric_equal(user_raw, expected_html) -> bool | None:
    expected_text = _html_to_text(expected_html)
    if re.search(r"\sили\s", expected_text, flags=re.IGNORECASE):
        return None

    def strip_num(value) -> str:
        return (
            str(value or "")
            .replace("\xa0", " ")
            .strip()
            .replace(",", ".")
        )

    user_text = strip_num(user_raw)
    correct_text = strip_num(expected_text)
    if not user_text or not correct_text:
        return None
    if not _NUM_RE.match(user_text.replace(" ", "")) or not _NUM_RE.match(correct_text.replace(" ", "")):
        return None
    try:
        user_num = float(user_text)
        correct_num = float(correct_text)
    except ValueError:
        return None
    tol = 1e-9 * max(1.0, abs(correct_num))
    return abs(user_num - correct_num) <= tol


def answers_match(user_raw, expected_html, *, subject: str = "") -> bool:
    from .answer_check import answers_equal

    if answers_equal(user_raw, expected_html, subject=subject):
        return True
    numeric = _numeric_equal(user_raw, expected_html)
    return bool(numeric)


def _clamp(value, max_points: int):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0
    number = min(max(0.0, number), float(max_points))
    if abs(number - round(number)) < 1e-9:
        return int(round(number))
    return round(number, 2)


def _status_from_points(points, max_points: int) -> str:
    if max_points > 0 and points >= max_points:
        return "correct"
    if points > 0:
        return "partial"
    return "incorrect"


def _lookup(mapping, task_id):
    if not isinstance(mapping, dict):
        return None, False
    key = str(task_id)
    if key in mapping:
        return mapping[key], True
    if task_id in mapping:
        return mapping[task_id], True
    return None, False


def _is_inf_partial(task, level, subject) -> bool:
    try:
        number = int(task.get("number"))
    except (TypeError, ValueError):
        return False
    return (
        str(subject or "").strip().lower() == "inf"
        and str(level or "").strip().lower() == "ege"
        and number in (26, 27)
    )


def score_variant_attempt(
    *,
    tasks: list[dict] | None,
    level: str = "",
    subject: str = "",
    answers: dict | None = None,
    scores: dict | None = None,
    checked: dict | None = None,
    attachment_ids: set | None = None,
) -> dict[str, Any]:
    """Статусы взаимоисключающие и в сумме дают число заданий."""
    list_tasks = list(tasks or [])
    answers = answers or {}
    scores = scores or {}
    checked = checked or {}
    attachment_ids = attachment_ids or set()
    rows = []
    earned = 0
    max_points = 0
    counts = {
        "correct": 0,
        "incorrect": 0,
        "partial": 0,
        "unanswered": 0,
        "pending": 0,
    }

    for task in list_tasks:
        if not isinstance(task, dict):
            continue
        part = 2 if logical_exam_part(task, level, subject) == 2 else 1
        maximum = task_max_points(task)
        raw_answer, _has_answer_key = _lookup(answers, task.get("id"))
        if isinstance(raw_answer, dict) and "text" in raw_answer:
            text = str(raw_answer.get("text") or "").strip()
        else:
            text = str(raw_answer or "").strip()
        task_id = str(task.get("id"))
        attached = task_id in attachment_ids or task.get("id") in attachment_ids
        answered = bool(text) or attached
        given, has_score = _lookup(scores, task.get("id"))
        if not has_score or given is None or given == "":
            explicit = None
        else:
            try:
                explicit = float(given)
            except (TypeError, ValueError):
                explicit = None
        flag, has_flag = _lookup(checked, task.get("id"))
        checked_flag = flag if has_flag and isinstance(flag, bool) else None
        expected = str(task.get("answer") or "")

        status = "unanswered"
        points = 0
        if part == 2:
            if explicit is None:
                status = "pending_review"
            else:
                points = _clamp(explicit, maximum)
                status = _status_from_points(points, maximum)
        elif not answered and explicit is None:
            status = "unanswered"
        elif _is_inf_partial(task, level, subject) and expected.strip():
            table_score = score_informatics_table(task.get("number"), text, expected)
            points = _clamp(0 if table_score is None else table_score, maximum)
            status = _status_from_points(points, maximum) if answered else "unanswered"
            if not answered:
                points = 0
        elif _is_inf_partial(task, level, subject) and explicit is not None:
            points = _clamp(explicit, maximum)
            status = _status_from_points(points, maximum) if answered else "unanswered"
            if not answered:
                points = 0
        elif expected.strip() and answered:
            ok = answers_match(text, expected, subject=subject)
            points = maximum if ok else 0
            status = "correct" if ok else "incorrect"
        elif checked_flag is True:
            points = maximum
            status = "correct"
        elif checked_flag is False:
            points = 0
            status = "incorrect" if answered else "unanswered"
        elif answered:
            status = "pending_review"
        else:
            status = "unanswered"

        counts[status if status != "pending_review" else "pending"] += 1
        earned += points
        max_points += maximum
        rows.append(
            {
                "id": task.get("id"),
                "number": task.get("number"),
                "part": part,
                "status": status,
                "points": points,
                "max_points": maximum,
            }
        )

    total = len(rows)
    checked_count = counts["correct"] + counts["incorrect"] + counts["partial"]
    if total == 0:
        review_status = "empty"
    elif counts["pending"]:
        review_status = "pending_review"
    else:
        review_status = "final"
    percentage = None
    if review_status == "final" and max_points > 0:
        percentage = round(earned * 100 / max_points, 2)

    return {
        "total_tasks": total,
        "correct_count": counts["correct"],
        "incorrect_count": counts["incorrect"],
        "partial_count": counts["partial"],
        "unanswered_count": counts["unanswered"],
        "pending_review_count": counts["pending"],
        "checked_count": checked_count,
        "earned_points": earned,
        "max_points": max_points,
        "percentage": percentage,
        "review_status": review_status,
        "preliminary": review_status == "pending_review",
        "tasks": rows,
    }


def public_task_snapshot(task: dict) -> dict:
    return {
        "id": task.get("id"),
        "number": task.get("number"),
        "max_score": task_max_points(task),
        "exam_part": task.get("exam_part"),
        "part": task.get("part"),
        "part_title": task.get("part_title") or "",
        "subdivision": task.get("subdivision") or "",
        "source": "variant_scoring",
    }


def grading_task_snapshot(task: dict) -> dict:
    """Критерии попытки: состав, максимум и эталон на момент фиксации."""
    row = public_task_snapshot(task)
    row["answer"] = str(task.get("answer") or "")
    return row


SUMMARY_FIELDS = (
    "total_tasks",
    "correct_count",
    "incorrect_count",
    "partial_count",
    "unanswered_count",
    "pending_review_count",
    "checked_count",
    "earned_points",
    "max_points",
    "percentage",
    "review_status",
)


def scoring_summary(scoring: dict | None) -> dict | None:
    if not isinstance(scoring, dict):
        return None
    return {key: scoring.get(key) for key in SUMMARY_FIELDS}


def redact_result_for_student(payload: dict | None):
    """Ученику не отдаём замороженные эталоны."""
    if not isinstance(payload, dict):
        return payload
    hidden = dict(payload)
    hidden.pop("grading_snapshot", None)
    scoring = hidden.get("scoring")
    if isinstance(scoring, dict):
        safe_scoring = dict(scoring)
        rows = safe_scoring.get("tasks")
        if isinstance(rows, list):
            safe_scoring["tasks"] = [
                {key: value for key, value in row.items() if key != "answer"}
                if isinstance(row, dict)
                else row
                for row in rows
            ]
        hidden["scoring"] = safe_scoring
    return hidden


def load_variant_tasks_for_scoring(variant_id: int) -> list[dict]:
    if not variant_id:
        return []
    from django.apps import apps

    VariantContent = apps.get_model("Generator", "VariantContent")
    contents = (
        VariantContent.objects.filter(variant_id=variant_id)
        .select_related("task", "task__task", "task__task__part")
        .order_by("order", "id")
    )
    rows = []
    for item in contents:
        task = item.task
        if task is None:
            continue
        task_list = getattr(task, "task", None)
        part = getattr(task_list, "part", None) if task_list is not None else None
        if task_list is not None and getattr(task_list, "max_score", None) is not None:
            max_score = task_list.max_score
        else:
            max_score = getattr(task, "max_score", None)
        rows.append(
            {
                "id": task.pk,
                "number": task_list.task_number if task_list is not None else item.order,
                "max_score": 1 if max_score is None else max_score,
                "part": task_list.part_id if task_list is not None else None,
                "part_title": getattr(part, "part_title", None) if part is not None else None,
                "exam_part": getattr(task, "exam_part", None),
                "subdivision": (getattr(task_list, "subdivision", None) or "") if task_list is not None else "",
                "answer": str(getattr(task, "answer", "") or ""),
            }
        )
    return rows


def _answers_from_payload(payload: dict, tasks: list[dict]) -> dict:
    by_id = payload.get("by_task_id") or payload.get("byTaskId") or {}
    by_num = payload.get("by_number") or payload.get("byNumber") or {}
    if not isinstance(by_id, dict):
        by_id = {}
    if not isinstance(by_num, dict):
        by_num = {}
    number_counts: dict[str, int] = {}
    for task in tasks:
        key = str(task.get("number"))
        number_counts[key] = number_counts.get(key, 0) + 1
    answers = {}
    for task in tasks:
        tid = task.get("id")
        text = ""
        raw, found = _lookup(by_id, tid)
        if found and raw is not None:
            text = raw.get("text") if isinstance(raw, dict) and "text" in raw else raw
        elif number_counts.get(str(task.get("number")), 0) <= 1:
            raw, found = _lookup(by_num, task.get("number"))
            if found and raw is not None:
                text = raw.get("text") if isinstance(raw, dict) and "text" in raw else raw
        answers[tid] = "" if text is None else str(text)
    return answers


def _attachment_ids(payload: dict) -> set:
    grouped = payload.get("task_attachments") or {}
    tasks = grouped.get("tasks") if isinstance(grouped, dict) else {}
    found = set()
    if isinstance(tasks, dict):
        for key, bucket in tasks.items():
            student = bucket.get("student") if isinstance(bucket, dict) else None
            if student:
                found.add(str(key))
    return found


def _grading_rows(rows: list | None) -> list[dict]:
    out = []
    for row in rows or []:
        if isinstance(row, dict) and row.get("id") is not None:
            out.append(dict(row))
    return out


def _snapshot_rows(rows: list | None) -> list[dict]:
    return [public_task_snapshot(row) for row in _grading_rows(rows)]


def _preserve_part1_from_scoring(scoring: dict | None, scores: dict, checked: dict) -> tuple[dict, dict]:
    """Повторная проверка не читает новый эталон банка, если критерии ещё не заморожены."""
    if not isinstance(scoring, dict):
        return scores, checked
    scores = dict(scores)
    checked = dict(checked)
    for row in scoring.get("tasks") or []:
        if not isinstance(row, dict) or int(row.get("part") or 1) != 1:
            continue
        key = str(row.get("id"))
        status = row.get("status")
        if status == "correct":
            checked[key] = True
        elif status == "incorrect":
            checked[key] = False
        elif status == "partial":
            scores.setdefault(key, row.get("points"))
        elif status in ("unanswered", "pending_review"):
            checked.pop(key, None)
    return scores, checked


def attach_variant_scoring(
    payload: dict | None,
    variant_id: int | None,
    *,
    level: str = "",
    subject: str = "",
    previous_snapshot: list | None = None,
    previous_grading: list | None = None,
    refresh_from_bank: bool = False,
) -> dict:
    """Пересчитать scoring.

    Состав и эталон берутся из снимка попытки. Текущий банк используется
    только при первой фиксации или при явном refresh_from_bank.
    """
    data = dict(payload or {})
    stored_scoring = data.get("scoring") if isinstance(data.get("scoring"), dict) else None
    data.pop("scoring", None)
    data.pop("tasks_snapshot", None)
    data.pop("grading_snapshot", None)
    if not variant_id:
        return data

    grading = _grading_rows(previous_grading)
    tasks: list[dict] = []
    snapshot: list[dict] = []
    preserve_part1 = False

    if refresh_from_bank:
        tasks = load_variant_tasks_for_scoring(int(variant_id))
        snapshot = [public_task_snapshot(task) for task in tasks]
        grading = [grading_task_snapshot(task) for task in tasks]
    elif grading:
        tasks = grading
        snapshot = _snapshot_rows(grading)
    elif isinstance(previous_snapshot, list) and previous_snapshot:
        snapshot = _snapshot_rows(previous_snapshot)
        tasks = [dict(row) for row in snapshot]
        preserve_part1 = True
    elif stored_scoring and isinstance(stored_scoring.get("tasks"), list) and stored_scoring["tasks"]:
        snapshot = []
        tasks = []
        for row in stored_scoring["tasks"]:
            if not isinstance(row, dict) or row.get("id") is None:
                continue
            item = {
                "id": row.get("id"),
                "number": row.get("number"),
                "max_score": row.get("max_points"),
                "exam_part": 2 if row.get("part") == 2 else 1,
                "part": row.get("part"),
                "answer": "",
            }
            tasks.append(item)
            snapshot.append(public_task_snapshot(item))
        preserve_part1 = True
    else:
        tasks = load_variant_tasks_for_scoring(int(variant_id))
        snapshot = [public_task_snapshot(task) for task in tasks]
        grading = [grading_task_snapshot(task) for task in tasks]

    if not tasks and not snapshot:
        return data

    if not level or not subject:
        from django.apps import apps

        Variant = apps.get_model("Generator", "Variant")
        variant = (
            Variant.objects.select_related("level", "var_subject")
            .filter(pk=int(variant_id))
            .first()
        )
        if variant is not None:
            level = level or str(getattr(getattr(variant, "level", None), "level", "") or "")
            subject = subject or str(
                getattr(getattr(variant, "var_subject", None), "subject_short", "") or ""
            )

    scores = data.get("scores") if isinstance(data.get("scores"), dict) else {}
    checked = data.get("checked") if isinstance(data.get("checked"), dict) else {}
    if preserve_part1:
        scores, checked = _preserve_part1_from_scoring(stored_scoring, scores, checked)

    scoring = score_variant_attempt(
        tasks=tasks,
        level=level,
        subject=subject,
        answers=_answers_from_payload(data, tasks),
        scores=scores,
        checked=checked,
        attachment_ids=_attachment_ids(data),
    )
    data["tasks_snapshot"] = snapshot
    if grading:
        data["grading_snapshot"] = grading
    data["scoring"] = scoring
    return data


def apply_bank_answer_to_attempt(
    payload: dict | None,
    task_id,
    new_answer: str,
    *,
    level: str = "",
    subject: str = "",
) -> dict | None:
    """Подменить эталон одного задания в снимке и пересчитать баллы.

    Состав попытки не меняется: новое задание варианта сюда не попадает,
    ручные баллы второй части остаются.
    """
    if not isinstance(payload, dict) or task_id is None:
        return None
    grading = payload.get("grading_snapshot")
    if not isinstance(grading, list) or not grading:
        return None
    key = str(task_id)
    fresh = str(new_answer or "")
    found = False
    changed = False
    updated_grading: list = []
    number = None
    for row in grading:
        if not isinstance(row, dict):
            updated_grading.append(row)
            continue
        row = dict(row)
        if str(row.get("id")) == key:
            found = True
            number = row.get("number")
            if str(row.get("answer") or "") != fresh:
                row["answer"] = fresh
                changed = True
        updated_grading.append(row)
    if not found or not changed:
        return None

    data = dict(payload)
    data["grading_snapshot"] = updated_grading
    scores = data.get("scores") if isinstance(data.get("scores"), dict) else {}
    checked = dict(data.get("checked") if isinstance(data.get("checked"), dict) else {})
    scoring = score_variant_attempt(
        tasks=updated_grading,
        level=level,
        subject=subject,
        answers=_answers_from_payload(data, updated_grading),
        scores=scores,
        checked=checked,
        attachment_ids=_attachment_ids(data),
    )
    target = next((row for row in scoring.get("tasks") or [] if str(row.get("id")) == key), None)
    if isinstance(target, dict) and int(target.get("part") or 1) == 1:
        keys = [key]
        if number is not None:
            num_key = str(number)
            same_number = sum(
                1
                for row in updated_grading
                if isinstance(row, dict) and str(row.get("number")) == num_key
            )
            if same_number == 1 and num_key in checked and num_key != key:
                keys.append(num_key)
        status = target.get("status")
        for item_key in keys:
            if status == "correct":
                checked[item_key] = True
            elif status == "incorrect":
                checked[item_key] = False
            else:
                checked.pop(item_key, None)
        data["checked"] = checked
    data["scoring"] = scoring
    return data
