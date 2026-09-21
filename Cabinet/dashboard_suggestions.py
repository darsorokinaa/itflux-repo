"""Подбор готовых уроков и тренажёров «Интересное» для главной учителя."""

from __future__ import annotations

import re
from collections import Counter
from datetime import timedelta

from django.db.models import Q
from django.utils import timezone

from .choices import EnrollmentStatus, PlanItemStatus, StudentStatus, StudentSubjectStatus
from .plan_subjects import get_plan_subject_label

SUGGESTION_LIMIT = 6
_TOPIC_MIN_LEN = 4

_SUBJECT_NEEDLES = {
    "inf": ("информатик", "informatics", "программир"),
    "informatics": ("информатик", "informatics", "программир"),
    "math": ("математик", "алгебр", "геометр"),
    "math_base": ("математик", "базов"),
    "phys": ("физик",),
    "prog": ("программир", "python", "код"),
    "rus": ("русск",),
    "chem": ("хими",),
    "lit": ("литератур",),
    "history": ("истори",),
}

_DEFAULT_ACCENT = "#2563EB"


def _norm(value) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip().lower())


def _file_url(obj, field_name: str, request=None):
    file_field = getattr(obj, field_name, None)
    if not file_field:
        return None
    try:
        url = file_field.url
    except Exception:
        return None
    if request:
        try:
            return request.build_absolute_uri(url)
        except Exception:
            return url
    return url


def _tokenize_topic(value: str) -> set[str]:
    text = _norm(value)
    if len(text) < _TOPIC_MIN_LEN:
        return set()
    parts = {text}
    for token in re.split(r"[^\wа-яё]+", text, flags=re.IGNORECASE):
        if len(token) >= _TOPIC_MIN_LEN:
            parts.add(token)
    return parts


def _collect_teacher_profile(teacher) -> dict:
    from .models import LessonPlanEnrollment, LessonPlanItem, ScheduleEvent, Student, StudentSubject

    now = timezone.now()
    students = list(
        Student.objects.filter(teacher=teacher, status=StudentStatus.ACTIVE).only("id", "grade", "direction")
    )
    grades = Counter()
    directions = Counter()
    subject_codes = Counter()
    subject_labels = []
    topics = Counter()

    for student in students:
        if student.grade:
            grades[int(student.grade)] += 1
        if student.direction and student.direction not in {"other", ""}:
            directions[student.direction] += 1

    subjects = StudentSubject.objects.filter(
        student__teacher=teacher,
        student__status=StudentStatus.ACTIVE,
        status=StudentSubjectStatus.ACTIVE,
    ).select_related("student")
    for row in subjects:
        code = _norm(row.subject)
        if code:
            subject_codes[code] += 1
            label = (row.subject_label or "").strip()
            if label:
                subject_labels.append(label)
            extra = (row.title or row.level or "").strip()
            if extra:
                subject_labels.append(extra)
                for token in _tokenize_topic(extra):
                    topics[token] += 1
        if row.direction and row.direction not in {"other", ""}:
            directions[row.direction] += 1
        if row.student and row.student.grade:
            grades[int(row.student.grade)] += 1

    events = (
        ScheduleEvent.objects.filter(owner=teacher, starts_at__gte=now - timedelta(days=2))
        .exclude(status=ScheduleEvent.Status.CANCELLED)
        .exclude(event_type__in=[ScheduleEvent.EventType.PERSONAL, ScheduleEvent.EventType.BLOCKED])
        .select_related("student_subject", "student")
        .order_by("starts_at")[:16]
    )
    for event in events:
        for token in _tokenize_topic(event.topic) | _tokenize_topic(event.subtopic):
            topics[token] += 2
        linked = event.student_subject
        if linked and linked.subject:
            subject_codes[_norm(linked.subject)] += 2
        if event.student and event.student.grade:
            grades[int(event.student.grade)] += 1

    enrollments = (
        LessonPlanEnrollment.objects.filter(teacher=teacher, status=EnrollmentStatus.ACTIVE)
        .select_related("plan", "student", "student_subject")[:24]
    )
    plan_ids = [row.plan_id for row in enrollments if row.plan_id]
    if plan_ids:
        items = (
            LessonPlanItem.objects.filter(
                plan_id__in=plan_ids,
                status__in=[
                    PlanItemStatus.NOT_STARTED,
                    PlanItemStatus.PLANNED,
                    PlanItemStatus.REPEAT_NEEDED,
                ],
            )
            .order_by("plan_id", "order")
            .only("plan_id", "topic", "subtopic", "title")
        )
        seen_plans = set()
        for item in items:
            if item.plan_id in seen_plans:
                continue
            seen_plans.add(item.plan_id)
            for token in _tokenize_topic(item.topic) | _tokenize_topic(item.subtopic) | _tokenize_topic(item.title):
                topics[token] += 2

    unique_labels = []
    seen_labels = set()
    for label in subject_labels:
        key = _norm(label)
        if key and key not in seen_labels:
            seen_labels.add(key)
            unique_labels.append(label)

    return {
        "grades": grades,
        "directions": directions,
        "subject_codes": subject_codes,
        "subject_labels": unique_labels,
        "topics": topics,
        "has_students": bool(students),
    }


def _subject_needles(codes) -> list[str]:
    needles = []
    seen = set()
    for code in codes:
        code_n = _norm(code)
        if not code_n:
            continue
        candidates = [code_n, _norm(get_plan_subject_label(code_n))]
        candidates.extend(_SUBJECT_NEEDLES.get(code_n, ()))
        for item in candidates:
            if item and item not in seen:
                seen.add(item)
                needles.append(item)
    return needles


def _haystack(*parts) -> str:
    return " ".join(_norm(part) for part in parts if part)


def _subject_hit(haystack: str, needles: list[str]) -> bool:
    if not haystack or not needles:
        return False
    return any(needle in haystack for needle in needles)


def _topic_hit(haystack: str, topics: Counter) -> str:
    if not haystack or not topics:
        return ""
    for topic, _count in topics.most_common(12):
        if topic and topic in haystack:
            return topic
    return ""


def _grade_hit(lesson_grade, grades: Counter) -> bool:
    if lesson_grade is None or not grades:
        return False
    try:
        return int(lesson_grade) in grades
    except (TypeError, ValueError):
        return False


def _exam_hit(exam_type: str, directions: Counter) -> bool:
    exam = _norm(exam_type)
    return bool(exam) and exam in directions


def _reason(*, topic="", grade=None, subject="", kind="lesson") -> str:
    if topic:
        return f"Тема: {topic}"
    if grade and subject:
        return f"Для {grade} класса · {subject}"
    if grade:
        return f"Для {grade} класса"
    if subject:
        return f"По предмету «{subject}»"
    if kind == "interesting":
        return "Тренажёр из раздела «Интересное»"
    return "Готовый урок из каталога"


def _is_available(user, obj) -> bool:
    from .subscription_access import SubscriptionAccessService

    gate = SubscriptionAccessService.serialize_access_gate(user, obj)
    return bool(gate.get("allowed") or gate.get("can_view"))


def _serialize_lesson(lesson, *, request, available: bool, reason: str, score: int) -> dict:
    cover = _file_url(lesson, "cover_image", request) or _file_url(lesson, "card_background_image", request)
    subject = (lesson.subject or "").strip()
    topic = (lesson.topic or lesson.subtopic or "").strip()
    return {
        "kind": "lesson",
        "kind_label": "Готовый урок",
        "id": lesson.id,
        "slug": lesson.slug,
        "title": lesson.title,
        "description": (lesson.short_description or "").strip(),
        "cover_url": cover,
        "accent_color": (lesson.card_background_color or "").strip() or _DEFAULT_ACCENT,
        "subject": subject,
        "grade": lesson.grade,
        "topic": topic,
        "tag": lesson.exam_type.upper() if lesson.exam_type else (f"{lesson.grade} класс" if lesson.grade else "Урок"),
        "available": available,
        "reason": reason,
        "preview_href": f"/lessons?preview={lesson.slug}",
        "score": score,
    }


def _serialize_interesting(item, *, request, available: bool, reason: str, score: int) -> dict:
    tag = (item.tag or "").strip() or "Тренажёр"
    return {
        "kind": "interesting",
        "kind_label": tag,
        "id": item.id,
        "slug": item.slug,
        "title": item.title,
        "description": (item.short_description or "").strip(),
        "cover_url": _file_url(item, "cover_image", request),
        "accent_color": (item.accent_color or "").strip() or _DEFAULT_ACCENT,
        "subject": "",
        "grade": None,
        "topic": "",
        "tag": tag,
        "available": available,
        "reason": reason,
        "preview_href": f"/interesting?preview={item.slug}",
        "score": score,
    }


def _score_lesson(lesson, profile) -> tuple[int, str]:
    hay = _haystack(lesson.subject, lesson.title, lesson.topic, lesson.subtopic, lesson.short_description)
    needles = _subject_needles(profile["subject_codes"])
    subject_ok = _subject_hit(hay, needles)
    grade_ok = _grade_hit(lesson.grade, profile["grades"])
    exam_ok = _exam_hit(lesson.exam_type, profile["directions"])
    topic = _topic_hit(hay, profile["topics"])
    score = 0
    if subject_ok:
        score += 40
    if grade_ok:
        score += 25
    if exam_ok:
        score += 15
    if topic:
        score += 30
    if not profile["has_students"]:
        score += int(getattr(lesson, "views_count", 0) or 0) // 20
    if score <= 0 and profile["has_students"]:
        return 0, ""
    if score <= 0:
        score = 1 + int(getattr(lesson, "views_count", 0) or 0) // 50
    subject_label = (lesson.subject or "").strip() or (
        profile["subject_labels"][0] if profile["subject_labels"] else ""
    )
    reason = _reason(
        topic=topic.title() if topic and topic.islower() else topic,
        grade=lesson.grade if grade_ok else None,
        subject=subject_label if subject_ok or grade_ok else "",
        kind="lesson",
    )
    return score, reason


def _score_interesting(item, profile) -> tuple[int, str]:
    hay = _haystack(item.title, item.short_description, item.tag)
    needles = _subject_needles(profile["subject_codes"])
    for label in profile["subject_labels"]:
        key = _norm(label)
        if key and key not in needles:
            needles.append(key)
    for exam in profile["directions"]:
        exam_n = _norm(exam)
        if exam_n and exam_n not in needles:
            needles.append(exam_n)
        if exam_n == "oge":
            needles.append("огэ")
        if exam_n == "ege":
            needles.append("егэ")
    subject_ok = _subject_hit(hay, needles)
    topic = _topic_hit(hay, profile["topics"])
    score = 0
    if subject_ok:
        score += 28
    if topic:
        score += 32
    tag = _norm(item.tag)
    if "интерактив" in tag or "тренаж" in tag:
        score += 8
    if not profile["has_students"]:
        score += max(1, 6 - int(getattr(item, "sort_order", 0) or 0))
    if score <= 0 and profile["has_students"] and not needles and not profile["topics"]:
        score = 4
    if score <= 0 and profile["has_students"]:
        return 0, ""
    if score <= 0:
        score = 1
    subject_label = profile["subject_labels"][0] if profile["subject_labels"] else ""
    reason = _reason(topic=topic, subject=subject_label if subject_ok else "", kind="interesting")
    return score, reason


def build_suggested_materials(teacher, request=None, *, limit: int = SUGGESTION_LIMIT) -> list[dict]:
    from Generator.models import InterestingItem
    from Generator.models import Lesson as CatalogLesson

    profile = _collect_teacher_profile(teacher)
    lessons = list(
        CatalogLesson.objects.filter(status=CatalogLesson.Status.PUBLISHED)
        .exclude(Q(access_level=CatalogLesson.AccessLevel.PRIVATE))
        .order_by("-views_count", "-updated_at", "id")[:80]
    )
    interesting = list(
        InterestingItem.objects.filter(status=InterestingItem.Status.PUBLISHED)
        .order_by("sort_order", "-views_count", "-updated_at")[:40]
    )

    scored = []
    for lesson in lessons:
        score, reason = _score_lesson(lesson, profile)
        if score <= 0:
            continue
        available = _is_available(teacher, lesson)
        if available:
            score += 8
        scored.append(
            _serialize_lesson(lesson, request=request, available=available, reason=reason, score=score)
        )
    for item in interesting:
        score, reason = _score_interesting(item, profile)
        if score <= 0:
            continue
        available = _is_available(teacher, item)
        if available:
            score += 8
        scored.append(
            _serialize_interesting(item, request=request, available=available, reason=reason, score=score)
        )

    if len(scored) < 3:
        seen_ids = {(row["kind"], row["id"]) for row in scored}
        for lesson in lessons:
            if ("lesson", lesson.id) in seen_ids:
                continue
            available = _is_available(teacher, lesson)
            scored.append(
                _serialize_lesson(
                    lesson,
                    request=request,
                    available=available,
                    reason=_reason(subject=(lesson.subject or "").strip(), kind="lesson"),
                    score=1 + (8 if available else 0),
                )
            )
            if len(scored) >= limit * 2:
                break
        for item in interesting:
            if ("interesting", item.id) in seen_ids:
                continue
            available = _is_available(teacher, item)
            scored.append(
                _serialize_interesting(
                    item,
                    request=request,
                    available=available,
                    reason=_reason(kind="interesting"),
                    score=1 + (8 if available else 0),
                )
            )
            if len(scored) >= limit * 3:
                break

    scored.sort(key=lambda row: (-row["score"], 0 if row["kind"] == "interesting" else 1, row["title"]))
    picked = []
    seen = set()
    interesting_count = 0
    lesson_count = 0
    for row in scored:
        key = (row["kind"], row["id"])
        if key in seen:
            continue
        if row["kind"] == "interesting" and interesting_count >= 3:
            continue
        if row["kind"] == "lesson" and lesson_count >= 4:
            continue
        seen.add(key)
        if row["kind"] == "interesting":
            interesting_count += 1
        else:
            lesson_count += 1
        picked.append(row)
        if len(picked) >= limit:
            break

    for row in picked:
        row.pop("score", None)
    return picked
