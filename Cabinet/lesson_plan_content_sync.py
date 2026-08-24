"""
LessonLearningPlanSyncService — двусторонняя синхронизация контента
ScheduleEvent ↔ LessonPlanItem.

Не путать с PlanSyncService (продвижение статусов при завершении урока).

Циклы предотвращаются флагом update_source и thread-local guard.
Сигналы на content-sync не используются — только явные вызовы.
"""

from __future__ import annotations

import logging
import threading
from typing import Any, Iterable, Optional

from django.db import transaction
from django.db.models import Max, Q
from django.utils import timezone

from .choices import (
    Direction,
    EnrollmentStatus,
    ExamType,
    LessonContentSource,
    PlanFormat,
    PlanItemStatus,
    PlanStatus,
    ScheduleMaterialSource,
)
from .models import (
    LessonPlan,
    LessonPlanEnrollment,
    LessonPlanItem,
    Material,
    ScheduleEvent,
    ScheduleEventMaterial,
    Student,
)
from .plan_schedule import (
    AUTO_MATERIALS_PLAN_DESCRIPTION,
    get_active_enrollment,
    plan_items_for_enrollment,
)

logger = logging.getLogger(__name__)

CONTENT_FIELDS = ("topic", "subtopic", "description", "goal", "homework_description")
SYNCABLE_FROM_PLAN = ("topic", "subtopic", "description", "goal", "homework_description")

_sync_guard = threading.local()


class LessonPlanSyncError(Exception):
    """Ошибка синхронизации с понятным текстом для API."""

    def __init__(self, message: str, *, code: str = "sync_error", status: int = 400, extra: dict | None = None):
        super().__init__(message)
        self.message = message
        self.code = code
        self.status = status
        self.extra = extra or {}


class LessonPlanSyncConflict(LessonPlanSyncError):
    def __init__(self, message: str, *, choices: list[dict], conflict_fields: list[str]):
        super().__init__(
            message,
            code="conflict",
            status=409,
            extra={"conflict": True, "choices": choices, "conflict_fields": conflict_fields},
        )


def _guard_active() -> bool:
    return bool(getattr(_sync_guard, "active", False))


def _set_guard(active: bool) -> None:
    _sync_guard.active = active


class LessonLearningPlanSyncService:
    TERMINAL_STATUSES = {
        ScheduleEvent.Status.DONE,
        ScheduleEvent.Status.COMPLETED,
        ScheduleEvent.Status.CANCELLED,
    }

    # ── Публичный интерфейс ───────────────────────────────────────────────

    @classmethod
    def _is_auto_materials_item(cls, item: LessonPlanItem | None) -> bool:
        return bool(
            item
            and item.plan_id
            and (item.plan.description or "") == AUTO_MATERIALS_PLAN_DESCRIPTION
        )

    @classmethod
    def _linked_real_plan_item(cls, event: ScheduleEvent) -> LessonPlanItem | None:
        item = event.lesson_plan_item
        if item is None or cls._is_auto_materials_item(item):
            return None
        return item

    @classmethod
    @transaction.atomic
    def attach_event_to_student_plan(cls, event: ScheduleEvent, *, teacher) -> ScheduleEvent:
        """После создания занятия привязать следующий свободный пункт плана.

        Не создаёт новый план и не добавляет пункты: если свободных тем нет,
        занятие остаётся без PlanItem (план завершён, а не «начат сначала»).
        """
        if not event.student_id and not event.group_id:
            return event
        if cls._linked_real_plan_item(event) is not None:
            return event

        from .plan_schedule import get_active_enrollment
        from .plan_sync import PlanSyncService

        enrollment = get_active_enrollment(event)
        if enrollment is not None:
            PlanSyncService.realign_enrollment_topics(enrollment)
            event.refresh_from_db()
        else:
            PlanSyncService.link_next_plan_item(event)
            event.refresh_from_db()
        linked = cls._linked_real_plan_item(event)
        if linked is not None and event.plan_sync_enabled:
            cls._copy_item_fields_to_event(
                event, linked, force_fields=CONTENT_FIELDS,
            )
            cls._sync_plan_materials_onto_event(event, linked)
            event.content_source = LessonContentSource.PLAN
            event.plan_synced_at = timezone.now()
            event.save(update_fields=[
                *CONTENT_FIELDS, "content_source", "plan_synced_at", "updated_at",
            ])
            cls._sync_journal_topic(event)
        else:
            logger.info(
                "plan exhausted or missing, event=%s left without plan item",
                event.pk,
            )
        return event

    @classmethod
    @transaction.atomic
    def link_plan_item(cls, event: ScheduleEvent, item: LessonPlanItem, *, teacher) -> ScheduleEvent:
        cls._assert_teacher_owns_event(event, teacher)
        cls._assert_teacher_owns_item(item, teacher)
        cls._assert_item_belongs_to_event_audience(event, item, teacher)

        event.lesson_plan_item = item
        if item.scheduled_event_id in (None, event.pk):
            item.scheduled_event = event
            item.save(update_fields=["scheduled_event", "updated_at"])
        # Черновик-заглушка "Материалы: ..." из ensure_event_plan_item (см.
        # plan_schedule.ensure_event_plan_item) мог раньше указывать на это же
        # событие через scheduled_event — снимаем эту связь при появлении
        # настоящей, иначе resolve_plan_item_for_event видит >1 совпадение и
        # уходит в неоднозначный slot-резолвинг вместо явной FK-связи. Пункты
        # других участников группового урока (свой, легитимный item на event)
        # не трогаем.
        LessonPlanItem.objects.filter(
            scheduled_event=event,
            plan__description=AUTO_MATERIALS_PLAN_DESCRIPTION,
        ).exclude(pk=item.pk).update(scheduled_event=None, updated_at=timezone.now())

        event.content_source = LessonContentSource.PLAN
        event.plan_sync_enabled = True
        update_fields = ["lesson_plan_item", "content_source", "plan_sync_enabled", "updated_at"]

        if event.plan_sync_enabled:
            cls._copy_item_fields_to_event(event, item, force_fields=CONTENT_FIELDS)
            update_fields.extend(list(CONTENT_FIELDS))
            cls._sync_plan_materials_onto_event(event, item)
            event.plan_synced_at = timezone.now()
            update_fields.append("plan_synced_at")

        event.save(update_fields=list(dict.fromkeys(update_fields)))
        cls._sync_journal_topic(event)
        return event

    @classmethod
    @transaction.atomic
    def create_plan_item_from_lesson(
        cls,
        event: ScheduleEvent,
        *,
        teacher,
        student_ids: Optional[list[int]] = None,
        confirm_all_students: bool = False,
        title: str = "",
    ) -> dict:
        cls._assert_teacher_owns_event(event, teacher)
        targets = cls._resolve_sync_targets(
            event,
            teacher=teacher,
            student_ids=student_ids,
            confirm_all_students=confirm_all_students,
        )
        created_items = []
        for enrollment in targets:
            item = cls._create_item_on_enrollment(event, enrollment, title=title)
            created_items.append(item)
            # Линкуем событие к первому созданному пункту (индивидуальный кейс).
            if event.student_id and enrollment.student_id == event.student_id:
                cls.link_plan_item(event, item, teacher=teacher)
            elif not event.student_id and not event.group_id:
                cls.link_plan_item(event, item, teacher=teacher)

        if len(targets) == 1 and not event.lesson_plan_item_id:
            cls.link_plan_item(event, created_items[0], teacher=teacher)

        # Для индивидуального — уже слинковано; для группы линкуем к пункту первого выбранного.
        if event.group_id and created_items and not event.lesson_plan_item_id:
            cls.link_plan_item(event, created_items[0], teacher=teacher)

        return {
            "ok": True,
            "items": [{"id": i.pk, "plan_id": i.plan_id, "title": i.title, "order": i.order} for i in created_items],
            "event_id": event.pk,
        }

    @classmethod
    @transaction.atomic
    def sync_lesson_to_plan(
        cls,
        event: ScheduleEvent,
        *,
        teacher,
        mode: str = "update_linked",
        student_ids: Optional[list[int]] = None,
        confirm_all_students: bool = False,
        title: str = "",
        material_ids: Optional[list[int]] = None,
    ) -> dict:
        """
        mode:
          - update_linked — обновить связанный пункт (или создать, если нет)
          - create_item — всегда создать новый пункт
          - lesson_only — ничего не писать в план
        """
        if _guard_active():
            return {"ok": True, "skipped": True, "reason": "guard"}

        cls._assert_teacher_owns_event(event, teacher)
        mode = (mode or "update_linked").strip()

        if mode == "lesson_only":
            event.content_source = (
                LessonContentSource.MIXED
                if event.lesson_plan_item_id
                else LessonContentSource.MANUAL
            )
            event.save(update_fields=["content_source", "updated_at"])
            return {"ok": True, "mode": mode, "plan_updated": False}

        _set_guard(True)
        try:
            if mode == "create_item" or (
                mode == "update_linked" and cls._linked_real_plan_item(event) is None
            ):
                result = cls.create_plan_item_from_lesson(
                    event,
                    teacher=teacher,
                    student_ids=student_ids,
                    confirm_all_students=confirm_all_students,
                    title=title,
                )
                event.refresh_from_db()
                item = event.lesson_plan_item
            else:
                item = event.lesson_plan_item
                if item is None:
                    raise LessonPlanSyncError("Урок не связан с пунктом плана.", code="no_plan_item")
                cls._assert_teacher_owns_item(item, teacher)
                items_to_update = [item]
                # Групповой урок: у каждого участника свой пункт плана (свой enrollment),
                # созданный ранее для этого же события (scheduled_event=event) —
                # иначе правка темы долетает только до первого/связанного ученика,
                # а остальные пункты плана группы остаются со старой темой.
                if event.group_id:
                    cls._resolve_sync_targets(
                        event,
                        teacher=teacher,
                        student_ids=student_ids,
                        confirm_all_students=confirm_all_students,
                    )
                    linked_ids = {i.pk for i in items_to_update}
                    for other_item in event.plan_items.select_related("plan").all():
                        if other_item.pk not in linked_ids:
                            items_to_update.append(other_item)
                            linked_ids.add(other_item.pk)
                for target_item in items_to_update:
                    cls._copy_event_fields_to_item(
                        event, target_item, topic=(title or "").strip() or None,
                    )
                result = {
                    "ok": True,
                    "items": [{"id": i.pk, "plan_id": i.plan_id} for i in items_to_update],
                }

            if item is not None:
                cls._push_event_materials_to_plan(event, item, material_ids=material_ids)
                item.scheduled_event = event
                item.save(update_fields=["scheduled_event", "updated_at"])
                event.content_source = LessonContentSource.PLAN
                event.plan_synced_at = timezone.now()
                event.save(update_fields=["content_source", "plan_synced_at", "updated_at"])
                cls._sync_journal_topic(event)

            return {**result, "mode": mode, "plan_updated": True}
        finally:
            _set_guard(False)

    @classmethod
    @transaction.atomic
    def sync_plan_item_to_lessons(
        cls,
        item: LessonPlanItem,
        *,
        teacher=None,
        update_source: str = "plan",
    ) -> dict:
        if _guard_active() and update_source == "plan":
            return {"ok": True, "skipped": True, "updated_event_ids": []}

        if teacher is not None:
            cls._assert_teacher_owns_item(item, teacher)

        _set_guard(True)
        try:
            qs = ScheduleEvent.objects.filter(
                Q(lesson_plan_item=item) | Q(plan_items=item),
            ).exclude(
                status__in=cls.TERMINAL_STATUSES,
            ).filter(
                plan_sync_enabled=True,
            ).distinct()

            if teacher is not None:
                qs = qs.filter(owner=teacher)

            updated_ids = []
            for event in qs.select_related("lesson_plan_item"):
                cls._copy_item_fields_to_event(event, item)
                cls._sync_plan_materials_onto_event(event, item)
                event.plan_synced_at = timezone.now()
                if event.content_source == LessonContentSource.MANUAL:
                    event.content_source = LessonContentSource.PLAN
                # Не затираем lesson_plan_item если уже стоит
                if event.lesson_plan_item_id != item.id:
                    event.lesson_plan_item = item
                event.save()
                cls._sync_journal_topic(event)
                updated_ids.append(event.pk)

            return {"ok": True, "updated_event_ids": updated_ids, "count": len(updated_ids)}
        finally:
            _set_guard(False)

    @classmethod
    @transaction.atomic
    def reorder_future_lessons_from_plan(
        cls,
        enrollment: LessonPlanEnrollment,
        *,
        teacher=None,
    ) -> dict:
        if teacher is not None and enrollment.teacher_id != getattr(teacher, "id", teacher):
            raise LessonPlanSyncError("Нет доступа к назначению плана.", status=403, code="forbidden")

        if _guard_active():
            return {"ok": True, "skipped": True, "updated_event_ids": [], "warning": None}

        _set_guard(True)
        try:
            from .plan_sync import PlanSyncService

            result = PlanSyncService.realign_enrollment_topics(enrollment)
            remaining_items = [
                item for item in plan_items_for_enrollment(enrollment)
                if item.status not in (PlanItemStatus.COMPLETED, PlanItemStatus.SKIPPED)
            ]
            return {
                "ok": True,
                "updated_event_ids": result.get("updated_event_ids") or [],
                "warning": None,
                "future_events": result.get("future_events", 0),
                "plan_items": len(remaining_items),
            }
        finally:
            _set_guard(False)

    @classmethod
    @transaction.atomic
    def apply_lesson_edit(
        cls,
        event: ScheduleEvent,
        data: dict,
        *,
        teacher,
        sync_action: str = "lesson_only",
        resolve_conflict: str | None = None,
        student_ids: Optional[list[int]] = None,
        confirm_all_students: bool = False,
    ) -> dict:
        """
        sync_action: lesson_only | lesson_and_plan | disable_sync
        resolve_conflict: lesson_only | lesson_and_plan | restore_from_plan
        """
        cls._assert_teacher_owns_event(event, teacher)
        raw_action = (sync_action or "").strip()
        sync_action = raw_action or "ask"
        resolve_conflict = (resolve_conflict or "").strip() or None

        content_updates = {k: data[k] for k in CONTENT_FIELDS if k in data}
        linked = cls._linked_real_plan_item(event)

        if linked and event.plan_sync_enabled and content_updates and not resolve_conflict:
            conflicts = cls._detect_conflicts(event, linked, content_updates)
            if conflicts and sync_action not in ("lesson_only", "lesson_and_plan", "disable_sync"):
                raise LessonPlanSyncConflict(
                    "Тема этого урока отличается от темы в плане обучения. Что нужно обновить?",
                    conflict_fields=conflicts,
                    choices=[
                        {"id": "lesson_only", "label": "Только карточку урока"},
                        {"id": "lesson_and_plan", "label": "Карточку урока и план"},
                        {"id": "restore_from_plan", "label": "Восстановить данные из плана"},
                    ],
                )
        if sync_action == "ask":
            sync_action = "lesson_only"

        if resolve_conflict == "restore_from_plan":
            if not linked:
                raise LessonPlanSyncError("Нет связанного пункта плана.")
            cls._copy_item_fields_to_event(event, linked, force_fields=CONTENT_FIELDS)
            cls._sync_plan_materials_onto_event(event, linked)
            event.manual_override_fields = []
            event.plan_sync_enabled = True
            event.content_source = LessonContentSource.PLAN
            event.plan_synced_at = timezone.now()
            event.save()
            cls._sync_journal_topic(event)
            return {"ok": True, "action": "restore_from_plan", "event_id": event.pk}

        # Применить правки к уроку. content-поля не nullable в модели — явный
        # null означает "очистить", а не "оставить как было".
        update_fields = []
        for field, value in content_updates.items():
            setattr(event, field, value if value is not None else "")
            update_fields.append(field)

        if sync_action == "disable_sync":
            event.plan_sync_enabled = False
            update_fields.append("plan_sync_enabled")
            overrides = list(event.manual_override_fields or [])
            for field in content_updates:
                if field not in overrides:
                    overrides.append(field)
            event.manual_override_fields = overrides
            update_fields.append("manual_override_fields")
            event.content_source = LessonContentSource.MANUAL
            update_fields.append("content_source")

        elif sync_action == "lesson_only":
            overrides = list(event.manual_override_fields or [])
            for field in content_updates:
                if field not in overrides:
                    overrides.append(field)
            event.manual_override_fields = overrides
            update_fields.append("manual_override_fields")
            if event.lesson_plan_item_id:
                event.content_source = LessonContentSource.MIXED
            else:
                event.content_source = LessonContentSource.MANUAL
            update_fields.append("content_source")

        elif sync_action == "lesson_and_plan":
            # убрать overrides для изменённых полей
            overrides = [f for f in (event.manual_override_fields or []) if f not in content_updates]
            event.manual_override_fields = overrides
            update_fields.append("manual_override_fields")
            event.plan_sync_enabled = True
            update_fields.append("plan_sync_enabled")

        if update_fields:
            event.save(update_fields=list(dict.fromkeys(update_fields + ["updated_at"])))
            cls._sync_journal_topic(event)

        plan_result = None
        if sync_action == "lesson_and_plan" or resolve_conflict == "lesson_and_plan":
            try:
                plan_result = cls.sync_lesson_to_plan(
                    event,
                    teacher=teacher,
                    mode="update_linked" if cls._linked_real_plan_item(event) else "create_item",
                    student_ids=student_ids,
                    confirm_all_students=confirm_all_students,
                )
            except LessonPlanSyncError as exc:
                # Тема/описание уже записаны в урок — не откатываем из‑за отсутствия
                # enrollment / служебного черновика (как в journal_service).
                soft_codes = {
                    "no_enrollment",
                    "draft_plan",
                    "group_confirm_required",
                    "alien_plan",
                    "public_plan",
                    "no_targets",
                }
                if getattr(exc, "code", None) not in soft_codes:
                    raise
                overrides = list(event.manual_override_fields or [])
                for field in content_updates:
                    if field not in overrides:
                        overrides.append(field)
                event.manual_override_fields = overrides
                if event.lesson_plan_item_id:
                    event.content_source = LessonContentSource.MIXED
                else:
                    event.content_source = LessonContentSource.MANUAL
                event.save(update_fields=[
                    "manual_override_fields", "content_source", "updated_at",
                ])
                plan_result = {
                    "ok": False,
                    "plan_updated": False,
                    "plan_error": exc.code,
                    "plan_message": exc.message,
                }

        return {
            "ok": True,
            "action": sync_action,
            "event_id": event.pk,
            "plan": plan_result,
        }

    @classmethod
    @transaction.atomic
    def set_plan_sync_enabled(cls, event: ScheduleEvent, *, teacher, enabled: bool) -> ScheduleEvent:
        cls._assert_teacher_owns_event(event, teacher)
        event.plan_sync_enabled = bool(enabled)
        if enabled:
            # при включении можно сразу подтянуть план
            if event.lesson_plan_item_id and event.lesson_plan_item:
                cls._copy_item_fields_to_event(
                    event, event.lesson_plan_item, force_fields=CONTENT_FIELDS,
                )
                cls._sync_plan_materials_onto_event(event, event.lesson_plan_item)
                event.manual_override_fields = []
                event.content_source = LessonContentSource.PLAN
                event.plan_synced_at = timezone.now()
                event.save()
                cls._sync_journal_topic(event)
            else:
                event.save(update_fields=["plan_sync_enabled", "updated_at"])
        else:
            event.save(update_fields=["plan_sync_enabled", "updated_at"])
        return event

    @classmethod
    @transaction.atomic
    def attach_material(
        cls,
        event: ScheduleEvent,
        *,
        teacher,
        material_id: int | None = None,
        interactive_id: int | None = None,
        source: str = ScheduleMaterialSource.LESSON_MANUAL,
        order: int | None = None,
    ) -> ScheduleEventMaterial:
        cls._assert_teacher_owns_event(event, teacher)
        source = source or ScheduleMaterialSource.LESSON_MANUAL
        if source not in ScheduleMaterialSource.values:
            raise LessonPlanSyncError("Некорректный источник материала.")
        if bool(material_id) == bool(interactive_id):
            raise LessonPlanSyncError("Укажите material_id или interactive_id.")

        if order is None:
            current_max = event.event_materials.aggregate(m=Max("order")).get("m") or 0
            order = current_max + 1

        lookup = {"event": event, "source": source}
        defaults = {"order": order}
        if material_id:
            material = Material.objects.filter(pk=material_id).first()
            if not material:
                raise LessonPlanSyncError("Материал не найден.", status=404)
            lookup["material_id"] = material_id
            lookup["interactive"] = None
        else:
            lookup["interactive_id"] = interactive_id
            lookup["material"] = None

        link, created = ScheduleEventMaterial.objects.get_or_create(**lookup, defaults=defaults)
        if not created and link.order != order:
            link.order = order
            link.save(update_fields=["order", "updated_at"])

        # Двусторонняя связь: материал урока ↔ пункт плана (без дубля объекта).
        item = event.lesson_plan_item
        if item is not None:
            if material_id:
                item.materials.add(material_id)
            if interactive_id:
                item.attached_interactives.add(interactive_id)

        if source == ScheduleMaterialSource.LESSON_MANUAL and event.content_source == LessonContentSource.PLAN:
            event.content_source = LessonContentSource.MIXED
            event.save(update_fields=["content_source", "updated_at"])

        return link

    @classmethod
    @transaction.atomic
    def detach_material(
        cls,
        event: ScheduleEvent,
        *,
        teacher,
        material_id: int | None = None,
        interactive_id: int | None = None,
        source: str | None = None,
    ) -> int:
        cls._assert_teacher_owns_event(event, teacher)
        qs = event.event_materials.all()
        if material_id:
            qs = qs.filter(material_id=material_id)
        if interactive_id:
            qs = qs.filter(interactive_id=interactive_id)
        if source:
            qs = qs.filter(source=source)
        deleted, _ = qs.delete()

        # Убираем связь и из пункта плана — сам материал в библиотеке остаётся.
        item = event.lesson_plan_item
        if item is not None:
            if material_id:
                item.materials.remove(material_id)
            if interactive_id:
                item.attached_interactives.remove(interactive_id)

        return deleted

    # ── Внутренние хелперы ────────────────────────────────────────────────

    @classmethod
    def _sync_journal_topic(cls, event: ScheduleEvent) -> None:
        """Подтягивает актуальную тему карточки/плана в ещё не финализированный
        журнал (см. journal_service.sync_planned_topic_from_event). Без этого
        journal.planned_topic остаётся "замороженным" на моменте создания записи
        и расходится с темой в календаре/плане после последующих правок."""
        try:
            from .journal_service import sync_planned_topic_from_event

            sync_planned_topic_from_event(event)
        except Exception:
            logger.exception("Не удалось синхронизировать тему в журнал для события %s", event.pk)

    @classmethod
    def _assert_teacher_owns_event(cls, event, teacher):
        if event.owner_id != getattr(teacher, "id", teacher):
            raise LessonPlanSyncError("Нет доступа к уроку.", status=403, code="forbidden")

    @classmethod
    def _assert_teacher_owns_item(cls, item: LessonPlanItem, teacher):
        plan = item.plan
        if plan.teacher_id is None:
            raise LessonPlanSyncError(
                "Публичный план нельзя изменять. Сделайте копию.",
                status=403,
                code="public_plan",
            )
        if plan.teacher_id != getattr(teacher, "id", teacher):
            raise LessonPlanSyncError("Нет доступа к пункту плана.", status=403, code="forbidden")

    @classmethod
    def _assert_item_belongs_to_event_audience(cls, event, item: LessonPlanItem, teacher):
        """Нельзя связать урок с планом другого ученика."""
        enrollments = LessonPlanEnrollment.objects.filter(
            plan=item.plan,
            teacher=teacher,
        ).exclude(status__in=[EnrollmentStatus.COMPLETED, EnrollmentStatus.CANCELLED])

        if not enrollments.exists():
            # План учителя без enrollment — разрешаем (черновик / подготовка)
            if item.plan.teacher_id == getattr(teacher, "id", teacher):
                return
            raise LessonPlanSyncError("Пункт плана не назначен этому уроку.", code="alien_plan")

        if event.student_id:
            if enrollments.filter(student_id=event.student_id).exists():
                return
            logger.warning(
                "ScheduleEvent has plan_item from another student event=%s item=%s event_student=%s",
                event.pk, item.pk, event.student_id,
            )
            raise LessonPlanSyncError(
                "Нельзя связать урок с планом другого ученика.",
                status=403,
                code="alien_plan",
            )

        if event.group_id:
            if enrollments.filter(group_id=event.group_id).exists():
                return
            # также допускаем планы участников группы
            student_ids = list(
                event.participants.exclude(student__isnull=True).values_list("student_id", flat=True)
            )
            if student_ids and enrollments.filter(student_id__in=student_ids).exists():
                return
            logger.warning(
                "ScheduleEvent has plan_item from another group event=%s item=%s event_group=%s",
                event.pk, item.pk, event.group_id,
            )
            raise LessonPlanSyncError(
                "Пункт плана не относится к группе этого урока.",
                status=403,
                code="alien_plan",
            )

    @classmethod
    def _resolve_sync_targets(
        cls,
        event: ScheduleEvent,
        *,
        teacher,
        student_ids: Optional[list[int]],
        confirm_all_students: bool,
    ) -> list[LessonPlanEnrollment]:
        is_group = bool(event.group_id) or (
            event.event_type in (
                ScheduleEvent.EventType.GROUP,
                ScheduleEvent.EventType.GROUP_LESSON,
            )
            and not event.student_id
        )

        if is_group:
            if not confirm_all_students and not student_ids:
                raise LessonPlanSyncError(
                    "Для группового урока укажите student_ids или confirm_all_students=true.",
                    code="group_confirm_required",
                )
            participant_ids = list(
                event.participants.exclude(student__isnull=True).values_list("student_id", flat=True)
            )
            if event.group_id and event.group_id:
                from .models import StudentGroup
                group = StudentGroup.objects.filter(pk=event.group_id, teacher=teacher).first()
                if group:
                    participant_ids = list(set(participant_ids) | set(
                        group.students.values_list("id", flat=True)
                    ))

            if confirm_all_students:
                chosen = participant_ids
            else:
                chosen = [int(x) for x in student_ids or []]
                alien = [sid for sid in chosen if sid not in participant_ids]
                if alien:
                    raise LessonPlanSyncError(
                        "Среди student_ids есть ученики, не участвующие в уроке.",
                        code="alien_students",
                    )

            if not chosen:
                # Иначе синхронизация «успешно» завершается без единого созданного
                # пункта плана — тема остаётся только в карточке урока молча.
                raise LessonPlanSyncError(
                    "В группе нет учеников для синхронизации с планом.",
                    code="no_targets",
                )

            enrollments = []
            for sid in chosen:
                enrollment = LessonPlanEnrollment.objects.filter(
                    teacher=teacher,
                    student_id=sid,
                ).exclude(
                    status__in=[EnrollmentStatus.COMPLETED, EnrollmentStatus.CANCELLED],
                ).select_related("plan").order_by("-created_at").first()
                if enrollment is None:
                    enrollment = cls._auto_create_enrollment(event, teacher=teacher, student_id=sid)
                if enrollment is None:
                    raise LessonPlanSyncError(
                        f"У ученика #{sid} нет активного плана обучения.",
                        code="no_enrollment",
                    )
                # предметная фильтрация
                if event.student_subject_id:
                    subject_enr = LessonPlanEnrollment.objects.filter(
                        teacher=teacher,
                        student_id=sid,
                        student_subject_id=event.student_subject_id,
                    ).exclude(
                        status__in=[EnrollmentStatus.COMPLETED, EnrollmentStatus.CANCELLED],
                    ).select_related("plan").order_by("-created_at").first()
                    if subject_enr:
                        enrollment = subject_enr
                enrollments.append(enrollment)
            return enrollments

        # Индивидуальный
        enrollment = get_active_enrollment(event)
        if enrollment is None:
            # Можно создать пункт только если есть хоть какой-то план ученика
            if event.student_id:
                enrollment = LessonPlanEnrollment.objects.filter(
                    teacher=teacher,
                    student_id=event.student_id,
                ).exclude(
                    status__in=[EnrollmentStatus.COMPLETED, EnrollmentStatus.CANCELLED],
                ).select_related("plan").order_by("-created_at").first()
        if enrollment is None and event.student_id:
            # У ученика вообще нет плана обучения — не блокируем добавление темы
            # из карточки урока, а заводим план автоматически по предмету занятия.
            enrollment = cls._auto_create_enrollment(event, teacher=teacher, student_id=event.student_id)
        if enrollment is None:
            raise LessonPlanSyncError(
                "У ученика нет активного плана обучения. Назначьте план или сохраните данные только в уроке.",
                code="no_enrollment",
            )
        return [enrollment]

    @classmethod
    def _auto_create_enrollment(
        cls, event: ScheduleEvent, *, teacher, student_id: int,
    ) -> Optional[LessonPlanEnrollment]:
        """Возвращает существующее назначение или создаёт одно, если его нет.

        Не создаёт второй активный план по тому же ученику+предмету.
        Завершённый план при явном добавлении темы из карточки урока
        открывается снова — это не «начать сначала», а продолжить тот же план.
        """
        from .plan_subjects import get_plan_subject_label

        student = Student.objects.filter(pk=student_id, teacher=teacher).first()
        if student is None:
            return None

        student_subject = event.student_subject if event.student_subject_id else None
        qs = LessonPlanEnrollment.objects.select_for_update().filter(
            teacher=teacher,
            student_id=student_id,
        ).exclude(status=EnrollmentStatus.CANCELLED)
        if student_subject is not None:
            subject_qs = qs.filter(student_subject_id=student_subject.id)
            qs = subject_qs if subject_qs.exists() else qs.filter(student_subject_id=student_subject.id)
        else:
            qs = qs.filter(student_subject__isnull=True)

        existing = qs.select_related("plan").order_by("-created_at").first()
        if existing is not None:
            if existing.status == EnrollmentStatus.COMPLETED:
                existing.status = EnrollmentStatus.ACTIVE
                existing.save(update_fields=["status", "updated_at"])
                logger.info(
                    "reopened completed enrollment=%s student=%s for explicit plan item create",
                    existing.pk,
                    student_id,
                )
            return existing

        cancelled_qs = LessonPlanEnrollment.objects.select_for_update().filter(
            teacher=teacher,
            student_id=student_id,
            status=EnrollmentStatus.CANCELLED,
        )
        if student_subject is not None:
            cancelled_qs = cancelled_qs.filter(student_subject_id=student_subject.id)
        else:
            cancelled_qs = cancelled_qs.filter(student_subject__isnull=True)
        cancelled = cancelled_qs.select_related("plan").order_by("-created_at").first()
        if cancelled is not None:
            cancelled.status = EnrollmentStatus.ACTIVE
            cancelled.save(update_fields=["status", "updated_at"])
            logger.info(
                "reopened cancelled enrollment=%s student=%s instead of creating a new plan",
                cancelled.pk,
                student_id,
            )
            return cancelled

        if student_subject is not None:
            subject_code = (student_subject.subject or "").strip() or "other"
            direction_code = student_subject.direction or Direction.OTHER
            subject_label = (
                (student_subject.title or "").strip()
                or get_plan_subject_label(subject_code)
                or subject_code
            )
        else:
            subject_code = "other"
            direction_code = Direction.OTHER
            subject_label = "Общий"

        plan_title = f"План: {student.full_name} — {subject_label}".strip()[:255]
        plan = (
            LessonPlan.objects.filter(teacher=teacher, title=plan_title)
            .exclude(status=PlanStatus.ARCHIVED)
            .exclude(description=AUTO_MATERIALS_PLAN_DESCRIPTION)
            .order_by("id")
            .first()
        )
        if plan is None:
            plan = LessonPlan.objects.create(
                teacher=teacher,
                title=plan_title,
                direction=direction_code,
                subject=subject_code,
                exam_type=ExamType.NONE,
                status=PlanStatus.PUBLISHED,
                lessons_count=0,
            )
        enrollment = LessonPlanEnrollment.objects.create(
            teacher=teacher,
            plan=plan,
            student=student,
            student_subject=student_subject,
            format=PlanFormat.INDIVIDUAL,
            status=EnrollmentStatus.ACTIVE,
        )
        logger.info(
            "created enrollment=%s plan=%s student=%s subject=%s",
            enrollment.pk,
            plan.pk,
            student_id,
            getattr(student_subject, "id", None),
        )
        return enrollment

    @classmethod
    def _create_item_on_enrollment(
        cls,
        event: ScheduleEvent,
        enrollment: LessonPlanEnrollment,
        *,
        title: str = "",
    ) -> LessonPlanItem:
        plan = enrollment.plan
        if plan.teacher_id is None:
            raise LessonPlanSyncError(
                "Публичный план нельзя изменять. Сделайте копию.",
                code="public_plan",
            )
        if plan.description == AUTO_MATERIALS_PLAN_DESCRIPTION:
            raise LessonPlanSyncError(
                "Нельзя добавлять пункты в служебный черновик материалов.",
                code="draft_plan",
            )
        max_order = plan.items.aggregate(m=Max("order")).get("m") or 0
        topic = (event.topic or "").strip()
        # Не используем event.title (= имя ученика/группы) как название пункта.
        audience_names = {
            (event.title or "").strip().lower(),
            (event.audience or "").strip().lower(),
        }
        raw_title = (title or topic or "").strip()
        if raw_title.lower() in audience_names:
            raw_title = ""
        item_title = (raw_title or topic or f"Урок {max_order + 1}").strip()[:255]
        item = LessonPlanItem.objects.create(
            plan=plan,
            order=max_order + 1,
            title=item_title or f"Урок {max_order + 1}",
            topic=topic[:500],
            subtopic=(event.subtopic or "")[:255],
            goal=event.goal or "",
            description=event.description or "",
            homework_description=event.homework_description or "",
            scheduled_event=event,
            status=PlanItemStatus.PLANNED,
        )
        plan.lessons_count = plan.items.count()
        plan.save(update_fields=["lessons_count", "updated_at"])
        return item

    @classmethod
    def _overrides(cls, event: ScheduleEvent) -> set[str]:
        raw = event.manual_override_fields or []
        if isinstance(raw, dict):
            return {k for k, v in raw.items() if v}
        return set(raw)

    @classmethod
    def _copy_item_fields_to_event(
        cls,
        event: ScheduleEvent,
        item: LessonPlanItem,
        *,
        force_fields: Iterable[str] | None = None,
    ) -> None:
        overrides = cls._overrides(event)
        fields = list(force_fields) if force_fields is not None else list(SYNCABLE_FROM_PLAN)
        # item.title часто = имя ученика (legacy ensure_event_plan_item) —
        # не копируем его в topic, иначе в карточке «Александр» вместо темы.
        topic_candidate = (item.topic or "").strip()
        if not topic_candidate:
            title_candidate = (item.title or "").strip()
            audience_names = {
                (event.title or "").strip().lower(),
                (event.audience or "").strip().lower(),
            }
            if title_candidate and title_candidate.lower() not in audience_names:
                topic_candidate = title_candidate
        mapping = {
            "topic": topic_candidate[:500],
            "subtopic": (item.subtopic or "")[:255],
            "description": item.description or "",
            "goal": item.goal or "",
            "homework_description": item.homework_description or "",
        }
        for field in fields:
            if force_fields is None and field in overrides:
                continue
            if field in mapping:
                setattr(event, field, mapping[field])

    @classmethod
    def _copy_event_fields_to_item(
        cls,
        event: ScheduleEvent,
        item: LessonPlanItem,
        *,
        topic: Optional[str] = None,
    ) -> None:
        old_topic = (item.topic or "").strip()
        old_title = (item.title or "").strip()
        incoming = (topic or event.topic or "").strip()
        if incoming:
            item.topic = incoming[:500]
        item.subtopic = (event.subtopic or "")[:255]
        item.description = event.description or ""
        item.goal = event.goal or ""
        item.homework_description = event.homework_description or ""
        title_source = (topic or "").strip() or incoming
        audience_titles = {
            (event.title or "").strip(),
            (event.audience or "").strip(),
            "Урок",
        }
        title_is_placeholder = (
            not old_title
            or old_title in audience_titles
            or old_title.startswith("Материалы:")
            or old_title == old_topic
            or not old_topic
        )
        if title_source and title_is_placeholder:
            item.title = title_source[:255]
        item.save(update_fields=[
            "topic", "subtopic", "description", "goal",
            "homework_description", "title", "updated_at",
        ])

    @classmethod
    def _sync_plan_materials_onto_event(cls, event: ScheduleEvent, item: LessonPlanItem) -> None:
        """Обновляет только materials с source=learning_plan; lesson_manual не трогает."""
        plan_material_ids = set(item.materials.values_list("id", flat=True))
        existing = {
            link.material_id: link
            for link in event.event_materials.filter(
                source=ScheduleMaterialSource.LEARNING_PLAN,
                material__isnull=False,
            )
        }
        # удалить plan-материалы, которых больше нет в пункте
        for mid, link in list(existing.items()):
            if mid not in plan_material_ids:
                link.delete()

        order = 0
        for mid in item.materials.values_list("id", flat=True):
            order += 1
            if mid in existing:
                link = existing[mid]
                if link.order != order:
                    link.order = order
                    link.save(update_fields=["order", "updated_at"])
            else:
                ScheduleEventMaterial.objects.get_or_create(
                    event=event,
                    material_id=mid,
                    source=ScheduleMaterialSource.LEARNING_PLAN,
                    defaults={"order": order},
                )

        # Интерактивы из плана
        plan_interactive_ids = set(item.attached_interactives.values_list("id", flat=True))
        existing_i = {
            link.interactive_id: link
            for link in event.event_materials.filter(
                source=ScheduleMaterialSource.LEARNING_PLAN,
                interactive__isnull=False,
            )
        }
        for iid, link in list(existing_i.items()):
            if iid not in plan_interactive_ids:
                link.delete()
        order = 0
        for iid in item.attached_interactives.values_list("id", flat=True):
            order += 1
            if iid in existing_i:
                link = existing_i[iid]
                if link.order != order:
                    link.order = order
                    link.save(update_fields=["order", "updated_at"])
            else:
                ScheduleEventMaterial.objects.get_or_create(
                    event=event,
                    interactive_id=iid,
                    source=ScheduleMaterialSource.LEARNING_PLAN,
                    defaults={"order": order},
                )

    @classmethod
    def _push_event_materials_to_plan(
        cls,
        event: ScheduleEvent,
        item: LessonPlanItem,
        *,
        material_ids: Optional[list[int]] = None,
    ) -> None:
        """Добавляет в пункт плана материалы урока (без дублей). Ручные остаются на уроке."""
        if material_ids is not None:
            ids = list(material_ids)
        else:
            ids = list(
                event.event_materials.filter(
                    material__isnull=False,
                    source__in=[
                        ScheduleMaterialSource.LESSON_MANUAL,
                        ScheduleMaterialSource.LEARNING_PLAN,
                    ],
                ).values_list("material_id", flat=True)
            )
            # также материалы, уже висящие на пункте через старый M2M ensure path
            ids.extend(list(item.materials.values_list("id", flat=True)))

        ids = list(dict.fromkeys(ids))
        if ids:
            item.materials.add(*ids)
            # пометить их на событии как learning_plan (не удаляя lesson_manual копии)
            for order, mid in enumerate(ids, start=1):
                ScheduleEventMaterial.objects.get_or_create(
                    event=event,
                    material_id=mid,
                    source=ScheduleMaterialSource.LEARNING_PLAN,
                    defaults={"order": order},
                )

    @classmethod
    def _detect_conflicts(
        cls,
        event: ScheduleEvent,
        item: LessonPlanItem,
        updates: dict,
    ) -> list[str]:
        conflicts = []
        plan_topic = (item.topic or "").strip()
        if not plan_topic:
            title_candidate = (item.title or "").strip()
            if title_candidate.lower() not in {
                (event.title or "").strip().lower(),
                (event.audience or "").strip().lower(),
            }:
                plan_topic = title_candidate
        plan_values = {
            "topic": plan_topic,
            "subtopic": (item.subtopic or "").strip(),
            "description": (item.description or "").strip(),
            "goal": (item.goal or "").strip(),
            "homework_description": (item.homework_description or "").strip(),
        }
        for field, new_val in updates.items():
            if field not in plan_values:
                continue
            new_s = (new_val or "").strip() if isinstance(new_val, str) else new_val
            plan_s = plan_values[field]
            # Покажем выбор, если новое значение расходится с планом
            if new_s != plan_s and (plan_s or field == "topic"):
                conflicts.append(field)
        return conflicts

    @classmethod
    def event_materials_payload(cls, event: ScheduleEvent) -> dict[str, list]:
        links = list(
            event.event_materials.select_related("material", "interactive").order_by("order", "id")
        )

        def serialize(link: ScheduleEventMaterial) -> dict:
            if link.material_id and link.material:
                m = link.material
                return {
                    "id": m.id,
                    "title": m.title,
                    "materialType": m.material_type,
                    "source": link.source,
                    "linkId": link.id,
                    "kind": "material",
                }
            if link.interactive_id and link.interactive:
                i = link.interactive
                return {
                    "id": i.id,
                    "title": getattr(i, "title", "") or str(i),
                    "source": link.source,
                    "linkId": link.id,
                    "kind": "interactive",
                }
            return {"id": None, "source": link.source, "linkId": link.id}

        plan_mats = [serialize(l) for l in links if l.source == ScheduleMaterialSource.LEARNING_PLAN]
        manual_mats = [serialize(l) for l in links if l.source == ScheduleMaterialSource.LESSON_MANUAL]
        hw_mats = [serialize(l) for l in links if l.source == ScheduleMaterialSource.HOMEWORK]
        return {
            "planMaterials": plan_mats,
            "manualMaterials": manual_mats,
            "homeworkMaterials": hw_mats,
            "allMaterials": [serialize(l) for l in links],
        }

    @classmethod
    def sync_meta_payload(cls, event: ScheduleEvent, plan_item: LessonPlanItem | None = None) -> dict[str, Any]:
        item = plan_item or event.lesson_plan_item
        plan = item.plan if item else None
        materials = cls.event_materials_payload(event)
        return {
            "planSyncEnabled": bool(event.plan_sync_enabled),
            "contentSource": event.content_source,
            "manualOverrideFields": list(event.manual_override_fields or []),
            "planSyncedAt": event.plan_synced_at.isoformat() if event.plan_synced_at else None,
            "linkedPlanId": plan.id if plan else None,
            "linkedPlanTitle": plan.title if plan else None,
            "linkedPlanItemId": item.id if item else event.lesson_plan_item_id,
            "isAutoMaterialsPlan": bool(
                plan and plan.description == AUTO_MATERIALS_PLAN_DESCRIPTION
            ),
            **materials,
        }
