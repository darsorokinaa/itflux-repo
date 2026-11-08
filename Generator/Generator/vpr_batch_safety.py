"""Можно ли удалить партию. После активации или выдачи — только выключение."""

from django.db.models import Q

from .models import Task, TaskAttachment, TaskGroupMember, VariantContent

_ACTIVATED_PREFIX = "vpr-activated:"


def activated_marker(batch: str) -> str:
    return f"{_ACTIVATED_PREFIX}{batch}"[:100]


def was_activated(row) -> bool:
    return str(getattr(row, "created_by", "") or "").startswith(_ACTIVATED_PREFIX)


def assert_rollback_allowed(batch: str, rows_qs) -> None:
    if not rows_qs.exists():
        raise RuntimeError(f"партия {batch!r} не найдена")
    if _activated(rows_qs):
        raise RuntimeError(_deactivate_only(batch, "уже активировалась"))
    usage = _usage_reasons(list(rows_qs.values_list("pk", flat=True)))
    if usage:
        raise RuntimeError(_deactivate_only(batch, f"уже используется ({', '.join(usage)})"))


def _deactivate_only(batch: str, why: str) -> str:
    return f"партия {batch!r} {why}: удаление запрещено, доступно только --deactivate-batch"


def _activated(rows_qs) -> bool:
    return rows_qs.filter(
        Q(is_active=True) | Q(status=Task.Status.READY) | Q(created_by__startswith=_ACTIVATED_PREFIX)
    ).exists()


def _usage_reasons(ids: list[int]) -> list[str]:
    if not ids:
        return []
    reasons = []
    _add_reason(reasons, "варианты", VariantContent.objects.filter(task_id__in=ids))
    _add_reason(reasons, "группы", TaskGroupMember.objects.filter(task_id__in=ids))
    _add_reason(reasons, "вложения", TaskAttachment.objects.filter(task_id__in=ids))
    _add_reason(reasons, "копии", Task.objects.filter(source_task_id__in=ids))
    _add_cabinet_reasons(reasons, ids)
    return reasons


def _add_reason(reasons: list[str], label: str, queryset) -> None:
    if queryset.exists():
        reasons.append(label)


def _add_cabinet_reasons(reasons: list[str], ids: list[int]) -> None:
    from django.apps import apps

    if not apps.is_installed("Cabinet"):
        return
    homework = apps.get_model("Cabinet", "HomeworkTask")
    _add_reason(reasons, "домашние задания", homework.objects.filter(task_id__in=[str(item) for item in ids]))
    history = apps.get_model("Cabinet", "StudentTaskHistory")
    _add_reason(reasons, "история выдачи", history.objects.filter(generator_task_id__in=ids))
