"""
Единый срез использования тарифа.

Счётчики и лимиты совпадают с проверками SubscriptionLimitService /
SubscriptionAccessService / files_services: одно и то же used/limit
для запрета действия и для блока «Использование тарифа» в ЛК.
"""

from __future__ import annotations

from typing import Any, Optional

from django.contrib.auth.models import User

NEAR_LIMIT_RATIO = 0.8


def _item(
    *,
    key: str,
    label: str,
    used,
    limit,
    period: str,
    unit: str = "",
) -> dict[str, Any]:
    unlimited = limit is None
    exhausted = False
    percent = None
    if unlimited:
        percent = None
        exhausted = False
    elif limit == 0:
        percent = 100 if used else 0
        exhausted = True
    else:
        try:
            used_n = float(used)
            limit_n = float(limit)
        except (TypeError, ValueError):
            used_n, limit_n = 0.0, 0.0
        percent = int(min(100, round((used_n / limit_n) * 100))) if limit_n else 0
        exhausted = used_n >= limit_n
    near_limit = (not unlimited) and (not exhausted) and percent is not None and percent >= int(NEAR_LIMIT_RATIO * 100)
    payload = {
        "key": key,
        "label": label,
        "used": used,
        "limit": limit,
        "period": period,
        "unlimited": unlimited,
        "percent": percent,
        "exhausted": exhausted,
        "near_limit": near_limit,
    }
    if unit:
        payload["unit"] = unit
    return payload


def count_students(teacher: User) -> int:
    from .choices import StudentStatus
    from .models import Student

    return Student.objects.filter(teacher=teacher).exclude(status=StudentStatus.ARCHIVED).count()


def count_groups(teacher: User) -> int:
    from .choices import GroupStatus
    from .models import StudentGroup

    return StudentGroup.objects.filter(teacher=teacher).exclude(status=GroupStatus.ARCHIVED).count()


def count_lessons(teacher: User) -> int:
    from .choices import LessonStatus
    from .models import Lesson

    return Lesson.objects.filter(teacher=teacher).exclude(status=LessonStatus.ARCHIVED).count()


def monthly_usage(teacher: User):
    from .subscription_access import SubscriptionAccessService

    return SubscriptionAccessService.get_teacher_monthly_usage(teacher)


def count_ai_requests(teacher: User) -> int:
    from .subscription_service import SubscriptionLimitService

    return int(SubscriptionLimitService.get_ai_usage(teacher).used_requests or 0)


def count_storage_bytes(teacher: User) -> int:
    try:
        from .files_services import calc_usage_bytes

        return int(calc_usage_bytes(teacher) or 0)
    except Exception:
        return 0


def count_teacher_tasks(teacher: User) -> int:
    from .teacher_task_entitlements import count_teacher_tasks as _count

    return _count(teacher)


def count_teacher_task_copies(teacher: User) -> int:
    from .teacher_task_entitlements import count_teacher_task_copies_this_period

    return count_teacher_task_copies_this_period(teacher)


class TariffUsageService:
    """Структурированное использование ресурсов текущего тарифа."""

    @staticmethod
    def collect_counts(teacher: User) -> dict[str, int]:
        """Сырые счётчики — те же, что используют can_*/raise_if_*/enforce_*."""
        monthly = monthly_usage(teacher)
        return {
            "students": count_students(teacher),
            "groups": count_groups(teacher),
            "lessons": count_lessons(teacher),
            "interactives": int(monthly.interactives_created or 0),
            "variants": int(monthly.variants_created or 0),
            "workbooks": int(monthly.workbooks_created or 0),
            "ai_requests": count_ai_requests(teacher),
            "storage_bytes": count_storage_bytes(teacher),
            "teacher_tasks": count_teacher_tasks(teacher),
            "teacher_task_copies": count_teacher_task_copies(teacher),
        }

    @staticmethod
    def _storage_item(teacher: User, counts: dict[str, int]) -> dict[str, Any]:
        try:
            from .files_services import get_quota_info

            info = get_quota_info(teacher)
        except Exception:
            info = {
                "used_bytes": int(counts.get("storage_bytes") or 0),
                "limit_bytes": 0,
            }
        used_bytes = int(info.get("used_bytes") or counts.get("storage_bytes") or 0)
        limit_bytes = int(info.get("limit_bytes") or 0)
        used_mb = _bytes_to_mb(used_bytes)
        limit_mb = round(limit_bytes / (1024 * 1024), 1) if limit_bytes else None
        if limit_mb is not None and limit_mb == int(limit_mb):
            limit_mb = int(limit_mb)
        item = _item(
            key="storage",
            label="Хранилище",
            used=used_mb,
            limit=limit_mb if limit_bytes else None,
            period="current",
            unit="MB",
        )
        if limit_bytes:
            percent = int(min(100, round((used_bytes / limit_bytes) * 100)))
            exhausted = used_bytes >= limit_bytes
            item["percent"] = percent
            item["exhausted"] = exhausted
            item["near_limit"] = (not exhausted) and percent >= int(NEAR_LIMIT_RATIO * 100)
        return item

    @staticmethod
    def get_tariff_usage(teacher: User) -> dict[str, Any]:
        from .subscription_service import SubscriptionLimitService

        plan = SubscriptionLimitService.get_current_plan(teacher)
        counts = TariffUsageService.collect_counts(teacher)
        period_start, period_end = SubscriptionLimitService.get_current_period()
        items = [
            _item(
                key="variant_generations",
                label="Генерация вариантов",
                used=counts["variants"],
                limit=plan.max_variants_monthly,
                period="month",
            ),
            _item(
                key="workbooks",
                label="Рабочие тетради",
                used=counts["workbooks"],
                limit=plan.max_workbooks_monthly,
                period="month",
            ),
            _item(
                key="students",
                label="Ученики",
                used=counts["students"],
                limit=plan.max_students,
                period="current",
            ),
            _item(
                key="groups",
                label="Группы",
                used=counts["groups"],
                limit=plan.max_groups,
                period="current",
            ),
            _item(
                key="interactives",
                label="Интерактивы",
                used=counts["interactives"],
                limit=plan.max_interactives,
                period="month",
            ),
            TariffUsageService._storage_item(teacher, counts),
            _item(
                key="teacher_tasks",
                label="Банк задач",
                used=counts["teacher_tasks"],
                limit=getattr(plan, "max_teacher_tasks", 20),
                period="current",
            ),
            _item(
                key="teacher_task_copies",
                label="Копии из общего банка",
                used=counts["teacher_task_copies"],
                limit=getattr(plan, "max_teacher_task_copies_monthly", 5),
                period="month",
            ),
        ]
        return {
            "tariff": {
                "code": plan.slug,
                "name": plan.name,
            },
            "period_start": period_start.isoformat(),
            "period_end": period_end.isoformat(),
            "usage": items,
            "counts": counts,
            "plan": plan,
        }

    @staticmethod
    def get_item(teacher: User, key: str) -> Optional[dict[str, Any]]:
        payload = TariffUsageService.get_tariff_usage(teacher)
        for item in payload["usage"]:
            if item["key"] == key:
                return item
        return None

    @staticmethod
    def is_within_limit(teacher: User, key: str) -> bool:
        item = TariffUsageService.get_item(teacher, key)
        if item is None:
            return True
        if item["unlimited"]:
            return True
        return not item["exhausted"]

    @staticmethod
    def usage_dict(payload: dict[str, Any]) -> dict[str, Any]:
        """Плоский usage для существующего фронтенда (useSubscription)."""
        counts = payload["counts"]
        storage = next((i for i in payload["usage"] if i["key"] == "storage"), None)
        return {
            "students": counts["students"],
            "groups": counts["groups"],
            "lessons": counts["lessons"],
            "interactives": counts["interactives"],
            "variants": counts["variants"],
            "workbooks": counts["workbooks"],
            "ai_requests": counts["ai_requests"],
            "storage_mb": storage["used"] if storage else 0,
            "teacher_tasks": counts.get("teacher_tasks", 0),
            "teacher_task_copies": counts.get("teacher_task_copies", 0),
        }

    @staticmethod
    def limits_dict(plan) -> dict[str, Any]:
        return {
            "students": plan.max_students,
            "groups": plan.max_groups,
            "lessons": plan.max_lessons,
            "interactives": plan.max_interactives,
            "variants_monthly": plan.max_variants_monthly,
            "workbooks_monthly": plan.max_workbooks_monthly,
            "storage_mb": plan.max_storage_mb,
            "ai_requests": plan.ai_requests_monthly_limit,
            "teacher_tasks": getattr(plan, "max_teacher_tasks", 20),
            "teacher_task_copies_monthly": getattr(plan, "max_teacher_task_copies_monthly", 5),
            "teacher_task_collections": getattr(plan, "max_teacher_task_collections", 2),
        }


def _bytes_to_mb(used_bytes: int):
    if not used_bytes:
        return 0
    mb = used_bytes / (1024 * 1024)
    rounded = round(mb, 1)
    if rounded == 0:
        return 0.1
    if rounded == int(rounded):
        return int(rounded)
    return rounded
