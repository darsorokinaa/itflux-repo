"""r125: лимит «вариантов на одного ученика в календарный месяц» по тарифу.

Единица учёта — уникальный вариант, выданный ученику в календарном месяце (МСК).
Повторная выдача того же варианта тому же ученику в том же месяце бесплатна.
Учитываются: ДЗ с вариантом, решение по ссылке («Решать вариант»), показ на уроке.
"""

from __future__ import annotations

import contextvars
from contextlib import contextmanager
from zoneinfo import ZoneInfo

from django.db import IntegrityError, transaction
from django.utils import timezone

MSK = ZoneInfo("Europe/Moscow")
UPGRADE_URL = "/cabinet/upgrade"
LIMIT_CODE = "VARIANT_PER_STUDENT_LIMIT"
MONTHS_PREP = (
    "", "январе", "феврале", "марте", "апреле", "мае", "июне",
    "июле", "августе", "сентябре", "октябре", "ноябре", "декабре",
)

_ENFORCE = contextvars.ContextVar("variant_limit_enforce", default=False)


class VariantLimitExceeded(PermissionError):
    """403 с понятным текстом; наследник PermissionError — старые обработчики дают 403."""

    def __init__(self, message: str, *, limit: int, used: int, student_id=None, plan_slug: str = "", min_plan: str = ""):
        super().__init__(message)
        self.message = message
        self.limit = limit
        self.used = used
        self.student_id = student_id
        self.plan_slug = plan_slug
        self.min_plan = min_plan

    def to_dict(self) -> dict:
        return {
            "code": LIMIT_CODE,
            "detail": self.message,
            "error": self.message,
            "message": self.message,
            "upgrade_required": True,
            "upgrade_url": UPGRADE_URL,
            "limit": self.limit,
            "current": self.used,
            "remaining": max(0, self.limit - self.used),
            "student_id": self.student_id,
            "feature": "variants_per_student",
            "min_plan": self.min_plan,
            "recommended_plan": self.min_plan,
        }


def current_month(now=None) -> str:
    now = now or timezone.now()
    return now.astimezone(MSK).strftime("%Y-%m")


def plan_for(teacher):
    from .subscription_access import SubscriptionAccessService

    return SubscriptionAccessService.get_effective_plan(teacher)


def per_student_limit(teacher) -> int | None:
    plan = plan_for(teacher)
    return getattr(plan, "max_variants_per_student_monthly", None)


def _used_qs(teacher, student, month):
    from .models import VariantIssuance

    return VariantIssuance.objects.filter(teacher=teacher, student=student, month=month)


def quota(teacher, student, *, variant_id=None, month=None) -> dict:
    month = month or current_month()
    limit = per_student_limit(teacher)
    qs = _used_qs(teacher, student, month)
    used = qs.count()
    already = bool(variant_id) and qs.filter(variant_id=int(variant_id)).exists()
    return {
        "studentId": student.id,
        "limit": limit,
        "used": used,
        "remaining": None if limit is None else max(0, limit - used),
        "alreadyIssued": already,
        "canIssue": limit is None or already or used < limit,
        "month": month,
    }


def _student_name(student) -> str:
    name = (getattr(student, "full_name", "") or "").strip()
    if not name:
        name = f"{getattr(student, 'first_name', '')} {getattr(student, 'last_name', '')}".strip()
    return name or "ученик"


def _limit_error(teacher, student, limit, used, month) -> VariantLimitExceeded:
    from .subscription_access import next_plan_slug

    plan = plan_for(teacher)
    slug = getattr(plan, "slug", "") or "start"
    plan_name = getattr(plan, "name", "") or slug
    upgrade = next_plan_slug(slug)
    month_idx = int(month.split("-")[1])
    message = (
        f"Лимит тарифа «{plan_name}»: не больше {limit} вариантов одному ученику в месяц. "
        f"Ученику «{_student_name(student)}» в {MONTHS_PREP[month_idx]} уже выдано {used} из {limit}, "
        f"осталось 0. Тот же вариант можно выдать повторно без лимита. "
        f"Чтобы выдавать больше, перейдите на тариф выше: {UPGRADE_URL}"
    )
    return VariantLimitExceeded(message, limit=limit, used=used, student_id=student.id, plan_slug=slug, min_plan=upgrade)


def check(teacher, students, variant_id, *, month=None) -> None:
    """Бросает VariantLimitExceeded, если хоть одному ученику выдать вариант нельзя."""
    if not variant_id:
        return
    month = month or current_month()
    limit = per_student_limit(teacher)
    if limit is None:
        return
    for student in students:
        if student is None:
            continue
        q = _used_qs(teacher, student, month)
        if q.filter(variant_id=int(variant_id)).exists():
            continue
        used = q.count()
        if used >= limit:
            raise _limit_error(teacher, student, limit, used, month)


def record(teacher, students, variant_id, *, source: str, month=None) -> None:
    from .models import VariantIssuance

    if not variant_id:
        return
    month = month or current_month()
    for student in students:
        if student is None:
            continue
        try:
            with transaction.atomic():
                VariantIssuance.objects.get_or_create(
                    teacher=teacher,
                    student=student,
                    variant_id=int(variant_id),
                    month=month,
                    defaults={"source": source},
                )
        except IntegrityError:
            pass


def check_and_record(teacher, students, variant_id, *, source: str) -> None:
    month = current_month()
    with transaction.atomic():
        # Сериализуем выдачу по учителю — иначе две параллельные выдачи обходят лимит.
        from django.contrib.auth.models import User

        User.objects.select_for_update().filter(pk=teacher.pk).first()
        check(teacher, students, variant_id, month=month)
        record(teacher, students, variant_id, source=source, month=month)


def homework_recipients(homework) -> list:
    if homework.student_id:
        return [homework.student]
    if homework.group_id:
        return list(homework.group.students.filter(status="active"))
    return []


def is_enforcing() -> bool:
    return _ENFORCE.get()


@contextmanager
def enforce_variant_limits():
    """Ручная выдача ДЗ учителем: превышение лимита отменяет всю операцию (atomic)."""
    token = _ENFORCE.set(True)
    try:
        with transaction.atomic():
            yield
    finally:
        _ENFORCE.reset(token)


def homework_task_variant_id(task) -> int | None:
    from .homework_api import extract_variant_id, is_live_meeting_homework

    homework = getattr(task, "homework", None)
    if homework is None or is_live_meeting_homework(homework):
        return None
    if not getattr(task, "is_active", True):
        return None
    return extract_variant_id(task.description or "")


def on_homework_task_pre_save(task) -> None:
    if not is_enforcing():
        return
    variant_id = homework_task_variant_id(task)
    if not variant_id:
        return
    homework = task.homework
    check(homework.teacher, homework_recipients(homework), variant_id)


def on_homework_task_post_save(task) -> None:
    variant_id = homework_task_variant_id(task)
    if not variant_id:
        return
    homework = task.homework
    try:
        record(homework.teacher, homework_recipients(homework), variant_id, source="homework")
    except Exception:  # учёт не должен ломать выдачу ДЗ
        import logging

        logging.getLogger("cabinet.variant_limit").exception("record issuance failed task=%s", task.pk)


def precheck_homework_copy(teacher, source_homework, students) -> None:
    from .homework_api import extract_variant_id

    ids = []
    for task in source_homework.tasks.filter(is_active=True):
        vid = extract_variant_id(task.description or "")
        if vid and vid not in ids:
            ids.append(vid)
    if not ids:
        return
    month = current_month()
    limit = per_student_limit(teacher)
    if limit is None:
        return
    for student in students:
        q = _used_qs(teacher, student, month)
        have = set(q.values_list("variant_id", flat=True))
        new = [v for v in ids if v not in have]
        if new and len(have) + len(new) > limit:
            raise _limit_error(teacher, student, limit, len(have), month)
