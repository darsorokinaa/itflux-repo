"""
PlanSyncService — синхронизация плана уроков с проведёнными занятиями.

Вызывается автоматически (сигнал) когда ScheduleEvent переходит
в статус done/completed. Также можно вызвать вручную.

Логика:
  1. Урок завершён (ScheduleEvent.status = done/completed).
  2. Находим LessonPlanItem, связанный с этим событием через
     scheduled_event FK (если есть).
  3. Если нет прямой связи — ищем текущий активный пункт в плане
     через LessonPlanEnrollment для ученика/группы этого события.
  4. Помечаем пункт выполненным (COMPLETED).
  5. Следующий по порядку пункт переводим в PLANNED.
  6. Если план завершён — enrollment → COMPLETED.
"""

import logging
from typing import Optional

from django.db import transaction
from django.utils import timezone

from .choices import EnrollmentStatus, PlanItemStatus

logger = logging.getLogger(__name__)


class PlanSyncService:

    COMPLETED_STATUSES = {"done", "completed"}

    # ── Публичный интерфейс ────────────────────────────────────────────────

    @classmethod
    def on_event_completed(cls, event) -> list:
        """
        Вызывается после того как ScheduleEvent отмечен done/completed.
        Возвращает список LessonPlanItem которые были продвинуты.
        """
        if event.status not in cls.COMPLETED_STATUSES:
            return []

        advanced = []

        # Путь 1: прямая связь через LessonPlanItem.scheduled_event
        linked_items = list(
            event.plan_items.select_related("plan").all()
        )
        for item in linked_items:
            result = cls._complete_item_and_advance(item, event)
            if result:
                advanced.extend(result)

        # Путь 2: нет прямой связи — ищем по ученику/группе
        if not linked_items:
            advanced.extend(cls._sync_by_participants(event))

        return advanced

    @classmethod
    def sync_enrollment(cls, enrollment) -> Optional[object]:
        """
        Вручную продвигает текущий пункт плана как выполненный.
        Возвращает следующий активный пункт или None если план завершён.
        """
        current = cls.get_current_item(enrollment)
        if not current:
            return None
        return cls._advance(enrollment, current)

    @classmethod
    def get_current_item(cls, enrollment):
        """Текущий активный пункт плана (первый не выполненный по порядку)."""
        return enrollment.plan.items.exclude(
            status__in=[PlanItemStatus.COMPLETED, PlanItemStatus.SKIPPED]
        ).order_by("order").first()

    @classmethod
    def get_next_item(cls, enrollment, after_order: int):
        """Следующий пункт после указанного порядкового номера."""
        return enrollment.plan.items.filter(
            order__gt=after_order
        ).exclude(
            status__in=[PlanItemStatus.COMPLETED, PlanItemStatus.SKIPPED]
        ).order_by("order").first()

    @classmethod
    def get_enrollment_progress(cls, enrollment) -> dict:
        """Возвращает прогресс: сколько пунктов выполнено из всех."""
        items = enrollment.plan.items.all()
        total = items.count()
        completed = items.filter(status=PlanItemStatus.COMPLETED).count()
        current = cls.get_current_item(enrollment)
        return {
            "total": total,
            "completed": completed,
            "remaining": total - completed,
            "percent": round(completed * 100 / total) if total else 0,
            "current_item": {
                "id": current.pk,
                "title": current.title,
                "order": current.order,
                "topic": current.topic,
            } if current else None,
            "is_finished": completed >= total and total > 0,
        }

    # ── Внутренняя логика ──────────────────────────────────────────────────

    @classmethod
    @transaction.atomic
    def _complete_item_and_advance(cls, item, event=None) -> list:
        """Помечает пункт плана выполненным и продвигает план."""
        if item.status == PlanItemStatus.COMPLETED:
            return []

        item.status = PlanItemStatus.COMPLETED
        item.completed_at = timezone.now()
        update_fields = ["status", "completed_at"]
        if event and not item.scheduled_event_id:
            item.scheduled_event = event
            update_fields.append("scheduled_event")
        item.save(update_fields=update_fields)
        logger.info("Plan item #%s completed (event=%s)", item.pk, event and event.pk)

        # Ищем enrollments для этого плана, продвигаем каждый
        advanced = [item]
        from .models import LessonPlanEnrollment
        enrollments = LessonPlanEnrollment.objects.filter(
            plan=item.plan
        ).exclude(status__in=[EnrollmentStatus.COMPLETED, EnrollmentStatus.CANCELLED])

        for enrollment in enrollments:
            next_item = cls._advance(enrollment, item)
            if next_item:
                advanced.append(next_item)

        return advanced

    @classmethod
    def _sync_by_participants(cls, event) -> list:
        """Ищет enrollments по участникам события и продвигает текущий пункт."""
        from .models import LessonPlanEnrollment
        from django.db.models import Q

        qs = LessonPlanEnrollment.objects.filter(
            teacher=event.owner
        ).exclude(
            status__in=[EnrollmentStatus.COMPLETED, EnrollmentStatus.CANCELLED]
        ).select_related("plan")

        if event.student_id:
            qs = qs.filter(student=event.student_id)
        elif event.group_id:
            qs = qs.filter(group=event.group_id)
        else:
            return []

        advanced = []
        for enrollment in qs:
            current = cls.get_current_item(enrollment)
            if not current:
                continue

            current.status = PlanItemStatus.COMPLETED
            current.completed_at = timezone.now()
            current.save(update_fields=["status", "completed_at"])
            logger.info(
                "Plan item #%s completed via participant sync (enrollment=%s)",
                current.pk, enrollment.pk,
            )
            advanced.append(current)

            next_item = cls._advance(enrollment, current)
            if next_item:
                advanced.append(next_item)

        return advanced

    @classmethod
    @transaction.atomic
    def _advance(cls, enrollment, completed_item) -> Optional[object]:
        """
        Ищет следующий пункт и переводит его в PLANNED.
        Если план исчерпан — закрывает enrollment.
        """
        next_item = cls.get_next_item(enrollment, completed_item.order)

        if next_item:
            if next_item.status == PlanItemStatus.NOT_STARTED:
                next_item.status = PlanItemStatus.PLANNED
                next_item.save(update_fields=["status"])
                logger.info("Plan item #%s → PLANNED (enrollment=%s)", next_item.pk, enrollment.pk)
            return next_item
        else:
            # Все пункты выполнены — завершаем enrollment
            enrollment.status = EnrollmentStatus.COMPLETED
            enrollment.save(update_fields=["status", "updated_at"])
            logger.info("Enrollment #%s completed — all items done", enrollment.pk)
            return None
