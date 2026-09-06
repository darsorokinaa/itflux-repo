"""Лимиты «Мой банк задач» — поверх существующей тарифной системы.

Не отдельный биллинг: план берётся из SubscriptionLimitService.get_current_plan
(trial / promo / admin / оплата / истечение → Старт).
"""

from __future__ import annotations

from django.contrib.auth.models import User

from .subscription_access import AccessDenied, PLAN_SLUG_TO_RANK, next_plan_slug
from .subscription_service import SubscriptionLimitService

TEACHER_TASK_LIMIT_REACHED = "TEACHER_TASK_LIMIT_REACHED"
TEACHER_TASK_COPY_LIMIT_REACHED = "TEACHER_TASK_COPY_LIMIT_REACHED"
TEACHER_TASK_ATTACHMENTS_REQUIRED = "TEACHER_TASK_ATTACHMENTS_REQUIRED"

FEATURE_TASKS = "teacher_tasks"
FEATURE_COPIES = "teacher_task_copies"
FEATURE_ATTACHMENTS = "teacher_task_attachments"


def _plan_display_name(slug: str, fallback: str) -> str:
    from .models import TariffPlan

    plan = TariffPlan.objects.filter(slug=slug).only("name").first()
    name = (getattr(plan, "name", None) or "").strip()
    return name or fallback


def _teacher_plan_name() -> str:
    return _plan_display_name("teacher", "Учитель")


def upgrade_plan_for_task_bank(plan_slug: str) -> str:
    slug = plan_slug or "start"
    if PLAN_SLUG_TO_RANK.get(slug, 0) < 1:
        return "teacher"
    return next_plan_slug(slug)


def count_teacher_tasks(teacher: User) -> int:
    from Generator.models import Task

    return Task.objects.filter(scope=Task.Scope.TEACHER, owner_teacher=teacher).count()


def count_teacher_task_copies_this_period(teacher: User) -> int:
    from Generator.models import Task

    period_start, period_end = SubscriptionLimitService.get_current_period()
    return Task.objects.filter(
        scope=Task.Scope.TEACHER,
        owner_teacher=teacher,
        source_task__scope=Task.Scope.GLOBAL,
        added_at__date__gte=period_start,
        added_at__date__lt=period_end,
    ).count()


def teacher_task_bank_bytes(user) -> int:
    """Объём файлов банка задач — часть общего storage, не отдельный счётчик."""
    from django.core.files.storage import default_storage
    from django.db.models import Sum

    from Generator.models import Task, TaskAttachment

    total = 0
    att = (
        TaskAttachment.objects.filter(task__owner_teacher=user, task__scope="teacher")
        .aggregate(total=Sum("size"))
        .get("total")
    )
    total += int(att or 0)
    for path in (
        Task.objects.filter(owner_teacher=user, scope="teacher")
        .exclude(files="")
        .values_list("files", flat=True)
    ):
        if not path:
            continue
        try:
            total += int(default_storage.size(path) or 0)
        except Exception:
            continue
    prefix = f"tasks/teacher_{getattr(user, 'pk', '')}/"
    try:
        _dirs, files = default_storage.listdir(prefix)
    except Exception:
        files = []
    for name in files or []:
        try:
            total += int(default_storage.size(f"{prefix}{name}") or 0)
        except Exception:
            continue
    return total


def snapshot(teacher: User) -> dict:
    plan = SubscriptionLimitService.get_current_plan(teacher)
    used = count_teacher_tasks(teacher)
    copies_used = count_teacher_task_copies_this_period(teacher)
    task_limit = getattr(plan, "max_teacher_tasks", 20)
    copy_limit = getattr(plan, "max_teacher_task_copies_monthly", 5)
    attach = bool(getattr(plan, "has_teacher_task_attachments", False))
    can_create = task_limit is None or used < int(task_limit)
    can_copy = can_create and (copy_limit is None or copies_used < int(copy_limit))
    return {
        "plan_slug": plan.slug,
        "plan_name": plan.name,
        "usage": {
            "tasks": used,
            "task_limit": task_limit,
            "copies_this_period": copies_used,
            "copy_limit": copy_limit,
        },
        "capabilities": {
            "create_task": can_create,
            "duplicate_task": can_create,
            "copy_from_global": can_copy,
            "attach_files": attach,
            "bulk_import": bool(getattr(plan, "has_teacher_task_bulk_import", False)),
            "advanced_analytics": bool(getattr(plan, "has_analytics", False)),
            "collections_limit": getattr(plan, "max_teacher_task_collections", 2),
        },
    }


def _lock_teacher(teacher: User) -> None:
    User.objects.select_for_update().get(pk=teacher.pk)


def lock_teacher_for_bank(teacher: User) -> None:
    """Вызывать внутри transaction.atomic вместе с create/copy."""
    _lock_teacher(teacher)


def enforce_teacher_task_create(teacher: User) -> None:
    plan = SubscriptionLimitService.get_current_plan(teacher)
    limit = getattr(plan, "max_teacher_tasks", 20)
    used = count_teacher_tasks(teacher)
    if limit is None or used < int(limit):
        return
    min_plan = upgrade_plan_for_task_bank(plan.slug)
    if used > int(limit):
        message = (
            f"В вашем банке {used} задач. Текущий тариф позволяет хранить до {limit} новых задач. "
            "Ваши существующие материалы сохранены, но создание новых задач временно недоступно."
        )
    else:
        message = f"Вы использовали все {limit} мест в личном банке задач."
    raise AccessDenied(
        TEACHER_TASK_LIMIT_REACHED,
        message,
        feature=FEATURE_TASKS,
        min_plan=min_plan,
        limit=int(limit),
        current=used,
    )


def enforce_teacher_task_copy(teacher: User) -> None:
    enforce_teacher_task_create(teacher)
    plan = SubscriptionLimitService.get_current_plan(teacher)
    limit = getattr(plan, "max_teacher_task_copies_monthly", 5)
    used = count_teacher_task_copies_this_period(teacher)
    if limit is None or used < int(limit):
        return
    teacher_name = _teacher_plan_name()
    raise AccessDenied(
        TEACHER_TASK_COPY_LIMIT_REACHED,
        f"В этом месяце вы уже скопировали {limit} задач из общего банка. "
        f"Создавать собственные задачи вручную можно, пока не достигнут общий лимит банка. "
        f"На тарифе «{teacher_name}» копирование из общего банка без месячного ограничения.",
        feature=FEATURE_COPIES,
        min_plan="teacher",
        limit=int(limit),
        current=used,
    )


def enforce_teacher_task_attachments(teacher: User) -> None:
    plan = SubscriptionLimitService.get_current_plan(teacher)
    if getattr(plan, "has_teacher_task_attachments", False):
        return
    teacher_name = _teacher_plan_name()
    raise AccessDenied(
        TEACHER_TASK_ATTACHMENTS_REQUIRED,
        f"Прикрепление файлов доступно на тарифе «{teacher_name}».",
        feature=FEATURE_ATTACHMENTS,
        min_plan="teacher",
    )


def enforce_teacher_task_storage(teacher: User, additional_bytes: int) -> None:
    from .files_services import assert_quota_allows

    assert_quota_allows(teacher, additional_bytes)


def lock_and_enforce_create(teacher: User) -> None:
    _lock_teacher(teacher)
    enforce_teacher_task_create(teacher)


def lock_and_enforce_copy(teacher: User) -> None:
    _lock_teacher(teacher)
    enforce_teacher_task_copy(teacher)
