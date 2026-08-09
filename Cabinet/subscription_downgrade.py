"""
Отложенное понижение тарифа (downgrade).

Правила:
- текущий оплаченный план действует до expires_at;
- pending хранится в SubscriptionPlanChange + зеркало scheduled_plan;
- платный pending активируется только после CONFIRMED оплаты / prepaid;
- иначе после окончания → Старт;
- данные не удаляются; лишние ученики/группы → archive.
"""

from __future__ import annotations

import logging
from decimal import Decimal
from typing import Optional

from django.contrib.auth.models import User
from django.db import transaction
from django.utils import timezone

from .subscription_access import PLAN_SLUG_TO_RANK

logger = logging.getLogger(__name__)

ACTIVE_CHANGE_STATUSES = ("pending", "prepaid")


def plan_rank(plan) -> int:
    if not plan:
        return 0
    slug = getattr(plan, "slug", "") or ""
    if slug in PLAN_SLUG_TO_RANK:
        return int(PLAN_SLUG_TO_RANK[slug])
    return int(getattr(plan, "content_access_rank", 0) or 0)


def is_downgrade(from_plan, to_plan) -> bool:
    return plan_rank(to_plan) < plan_rank(from_plan)


def is_upgrade(from_plan, to_plan) -> bool:
    return plan_rank(to_plan) > plan_rank(from_plan)


def is_free_plan(plan) -> bool:
    if not plan:
        return True
    if getattr(plan, "is_free", False) or plan.slug == "start":
        return True
    return Decimal(str(getattr(plan, "price_month", 0) or 0)) <= 0


def feature_loss_messages(from_plan, to_plan) -> list[str]:
    """Короткие пункты «что станет недоступно» для UI."""
    losses: list[str] = []
    if not from_plan or not to_plan:
        return losses

    def lim(val):
        return "без лимита" if val is None else str(val)

    if (from_plan.max_students or 0) > (to_plan.max_students or 0):
        losses.append(
            f"лимит учеников уменьшится с {from_plan.max_students} до {to_plan.max_students}"
        )
    if from_plan.max_groups != to_plan.max_groups:
        losses.append(
            f"лимит групп: {lim(from_plan.max_groups)} → {lim(to_plan.max_groups)}"
        )
    if from_plan.max_variants_monthly != to_plan.max_variants_monthly:
        losses.append(
            f"генератор: {lim(from_plan.max_variants_monthly)}/мес → "
            f"{lim(to_plan.max_variants_monthly)}/мес"
        )
    if from_plan.max_workbooks_monthly != to_plan.max_workbooks_monthly:
        losses.append(
            f"рабочие тетради: {lim(from_plan.max_workbooks_monthly)}/мес → "
            f"{lim(to_plan.max_workbooks_monthly)}/мес"
        )
    if from_plan.content_access_rank > to_plan.content_access_rank:
        losses.append("часть библиотеки и Premium-материалов станет недоступна для новых назначений")
    if from_plan.has_analytics and not to_plan.has_analytics:
        losses.append("расширенная аналитика станет недоступна")
    if from_plan.has_mass_actions and not to_plan.has_mass_actions:
        losses.append("массовые действия отключатся")
    if from_plan.has_simulators and not to_plan.has_simulators:
        losses.append("часть симуляторов станет недоступна")
    if from_plan.has_priority_support and not to_plan.has_priority_support:
        losses.append("приоритетная поддержка будет недоступна")
    if from_plan.has_extended_library and not to_plan.has_extended_library:
        losses.append("расширенная библиотека станет недоступна")
    if is_free_plan(to_plan):
        losses.extend(
            [
                "нет расписания",
                "нет журнала",
                "нет видеоконференций",
                "только бесплатные материалы",
            ]
        )
    # unique preserve order
    seen = set()
    out = []
    for item in losses:
        if item not in seen:
            seen.add(item)
            out.append(item)
    return out


class DowngradeService:
    @staticmethod
    def get_active_change(subscription):
        from .models import SubscriptionPlanChange

        return (
            SubscriptionPlanChange.objects.select_related("from_plan", "to_plan", "payment")
            .filter(
                subscription=subscription,
                status__in=[
                    SubscriptionPlanChange.Status.PENDING,
                    SubscriptionPlanChange.Status.PREPAID,
                ],
            )
            .order_by("-requested_at")
            .first()
        )

    @staticmethod
    def sync_subscription_mirror(subscription, change=None):
        """Зеркалит pending/prepaid в scheduled_* полях подписки."""
        from .models import SubscriptionPlanChange

        change = change or DowngradeService.get_active_change(subscription)
        update_fields = ["updated_at"]
        if change and change.status in (
            SubscriptionPlanChange.Status.PENDING,
            SubscriptionPlanChange.Status.PREPAID,
        ):
            subscription.scheduled_plan = change.to_plan
            subscription.scheduled_change_at = change.effective_at
            update_fields += ["scheduled_plan", "scheduled_change_at"]
        else:
            if subscription.scheduled_plan_id or subscription.scheduled_change_at:
                subscription.scheduled_plan = None
                subscription.scheduled_change_at = None
                update_fields += ["scheduled_plan", "scheduled_change_at"]
        subscription.save(update_fields=update_fields)
        return subscription

    @staticmethod
    def sync_effective_at_to_expires(subscription) -> Optional[object]:
        """После +14 referral / продления — сдвинуть plan_change_at = expires_at."""
        from .models import SubscriptionPlanChange

        change = DowngradeService.get_active_change(subscription)
        if not change or not subscription.expires_at:
            return change
        if change.effective_at != subscription.expires_at:
            change.effective_at = subscription.expires_at
            change.save(update_fields=["effective_at", "updated_at"])
            DowngradeService.sync_subscription_mirror(subscription, change)
            logger.info(
                "plan_change_effective_shifted change=%s to %s",
                change.pk,
                subscription.expires_at.isoformat(),
            )
        return change

    @staticmethod
    def effective_next_plan(subscription):
        """Тариф следующего периода (для charge / reminders / UI)."""
        change = DowngradeService.get_active_change(subscription)
        if change:
            return change.to_plan
        return subscription.plan

    @staticmethod
    def preview(teacher: User, target_plan) -> dict:
        from .models import Student, StudentGroup
        from .choices import GroupStatus, StudentStatus
        from .pricing_service import base_plan_price
        from .subscription_service import SubscriptionLimitService

        sub = SubscriptionLimitService.get_or_create_subscription(teacher, apply_promo=False)
        current = sub.plan
        usage = SubscriptionLimitService.get_usage(teacher)
        students_over = max(0, usage["students"] - int(target_plan.max_students or 0))
        groups_limit = target_plan.max_groups
        groups_over = 0
        if groups_limit is not None:
            groups_over = max(0, usage["groups"] - int(groups_limit))

        storage_used = DowngradeService._storage_used_mb(teacher)
        storage_limit = int(getattr(target_plan, "max_storage_mb", 0) or 0)
        storage_over = storage_used > storage_limit > 0

        effective_at = sub.expires_at
        can_schedule = bool(
            sub.is_valid()
            and sub.expires_at
            and sub.expires_at > timezone.now()
            and is_downgrade(current, target_plan)
        )

        students = list(
            Student.objects.filter(teacher=teacher, status=StudentStatus.ACTIVE)
            .order_by("-updated_at", "id")
            .values("id", "first_name", "last_name")
        )
        groups = list(
            StudentGroup.objects.filter(teacher=teacher, status=GroupStatus.ACTIVE)
            .order_by("-updated_at", "id")
            .values("id", "title")
        )
        for g in groups:
            g["name"] = g.pop("title", "") or f"Группа #{g['id']}"

        price = base_plan_price(target_plan, sub.billing_period or "month")
        return {
            "can_schedule": can_schedule,
            "is_downgrade": is_downgrade(current, target_plan),
            "is_to_start": is_free_plan(target_plan),
            "from_plan": {"slug": current.slug, "name": current.name},
            "to_plan": {
                "slug": target_plan.slug,
                "name": target_plan.name,
                "price_month": str(target_plan.price_month),
            },
            "effective_at": effective_at.isoformat() if effective_at else None,
            "losses": feature_loss_messages(current, target_plan),
            "limits": {
                "students": {
                    "current": usage["students"],
                    "limit": target_plan.max_students,
                    "over": students_over,
                    "needs_selection": students_over > 0,
                    "candidates": students,
                },
                "groups": {
                    "current": usage["groups"],
                    "limit": groups_limit,
                    "over": groups_over,
                    "needs_selection": groups_over > 0,
                    "candidates": groups,
                },
                "storage": {
                    "used_mb": storage_used,
                    "limit_mb": storage_limit,
                    "over": storage_over,
                },
            },
            "next_price": str(price) if not is_free_plan(target_plan) else "0",
            "message": DowngradeService._preview_message(
                current, target_plan, effective_at, price
            ),
        }

    @staticmethod
    def _preview_message(current, target, effective_at, price) -> str:
        when = (
            timezone.localtime(effective_at).strftime("%d.%m.%Y")
            if effective_at
            else "окончания текущего периода"
        )
        if is_free_plan(target):
            return (
                f"До {when} вы продолжите пользоваться тарифом «{current.name}». "
                f"После этого будет активирован бесплатный тариф «{target.name}»."
            )
        return (
            f"До {when} вы продолжите пользоваться тарифом «{current.name}». "
            f"С {when} будет активирован тариф «{target.name}» "
            f"за {price} ₽/мес (при оплате / автопродлении)."
        )

    @staticmethod
    def _storage_used_mb(teacher: User) -> int:
        """Использованный объём «Мои файлы» в МБ (без удаления при превышении)."""
        try:
            from .files_services import calc_usage_bytes

            return int(calc_usage_bytes(teacher) / (1024 * 1024))
        except Exception:
            return 0

    @staticmethod
    @transaction.atomic
    def schedule(
        teacher: User,
        target_plan,
        *,
        student_ids: list | None = None,
        group_ids: list | None = None,
        reason: str = "downgrade",
    ) -> dict:
        from .models import SubscriptionPlanChange, TariffPlan
        from .subscription_service import SubscriptionLimitService

        sub = (
            SubscriptionLimitService.get_or_create_subscription(teacher, apply_promo=False)
        )
        sub = type(sub).objects.select_for_update().select_related("plan").get(pk=sub.pk)
        now = timezone.now()

        if not sub.expires_at or sub.expires_at <= now or not sub.is_valid():
            raise ValueError(
                "Нет активного оплаченного периода — понижение оформляется как смена тарифа "
                "после окончания текущего, а не мгновенно."
            )
        if not is_downgrade(sub.plan, target_plan):
            raise ValueError("Целевой тариф не является понижением относительно текущего.")

        preview = DowngradeService.preview(teacher, target_plan)
        students_need = preview["limits"]["students"]["needs_selection"]
        groups_need = preview["limits"]["groups"]["needs_selection"]
        keep_students = [int(x) for x in (student_ids or [])]
        keep_groups = [int(x) for x in (group_ids or [])]

        if students_need:
            limit = int(target_plan.max_students or 0)
            if len(keep_students) != limit:
                # Разрешаем сохранить запрос без выбора — fallback при apply.
                # Но если передали неполный список — ошибка.
                if student_ids is not None and len(keep_students) != limit:
                    raise ValueError(
                        f"Выберите ровно {limit} учеников, которые останутся активными."
                    )
        if groups_need and target_plan.max_groups is not None:
            limit_g = int(target_plan.max_groups)
            if group_ids is not None and len(keep_groups) != limit_g:
                raise ValueError(
                    f"Выберите ровно {limit_g} групп, которые останутся активными."
                )

        # Отменить предыдущий pending (история сохраняется).
        previous = DowngradeService.get_active_change(sub)
        if previous:
            previous.status = SubscriptionPlanChange.Status.SUPERSEDED
            previous.canceled_at = now
            previous.save(update_fields=["status", "canceled_at", "updated_at"])

        reason_val = (
            SubscriptionPlanChange.Reason.CANCEL_TO_START
            if is_free_plan(target_plan)
            else SubscriptionPlanChange.Reason.DOWNGRADE
        )
        if previous:
            reason_val = SubscriptionPlanChange.Reason.REPLACE

        change = SubscriptionPlanChange.objects.create(
            teacher=teacher,
            subscription=sub,
            from_plan=sub.plan,
            to_plan=target_plan,
            status=SubscriptionPlanChange.Status.PENDING,
            reason=reason_val,
            effective_at=sub.expires_at,
            selected_student_ids=keep_students,
            selected_group_ids=keep_groups,
            metadata={"preview_losses": preview["losses"]},
        )

        if is_free_plan(target_plan):
            sub.auto_renew = False
            sub.cancelled_at = sub.cancelled_at or now
            sub.save(update_fields=["auto_renew", "cancelled_at", "updated_at"])

        DowngradeService.sync_subscription_mirror(sub, change)
        logger.info(
            "plan_change_scheduled teacher=%s %s→%s at %s",
            teacher.pk,
            sub.plan.slug,
            target_plan.slug,
            change.effective_at.isoformat(),
        )
        return {
            "ok": True,
            "change_id": change.pk,
            "effective_at": change.effective_at.isoformat(),
            "to_plan": target_plan.slug,
            "auto_renew": sub.auto_renew,
            "preview": preview,
        }

    @staticmethod
    @transaction.atomic
    def cancel(teacher: User) -> dict:
        from .models import SubscriptionPlanChange
        from .subscription_service import SubscriptionLimitService

        sub = SubscriptionLimitService.get_or_create_subscription(teacher, apply_promo=False)
        sub = type(sub).objects.select_for_update().select_related("plan").get(pk=sub.pk)
        change = DowngradeService.get_active_change(sub)
        if not change:
            return {"ok": True, "message": "Отложенный переход не запланирован."}
        now = timezone.now()
        change.status = SubscriptionPlanChange.Status.CANCELED
        change.canceled_at = now
        change.save(update_fields=["status", "canceled_at", "updated_at"])
        # prepaid сбрасываем — деньги уже на Payment, поддержка разберёт отдельно;
        # тариф остаётся текущим до expires_at.
        if sub.prepaid_until:
            sub.prepaid_until = None
            sub.save(update_fields=["prepaid_until", "updated_at"])
        DowngradeService.sync_subscription_mirror(sub, None)
        logger.info("plan_change_canceled change=%s teacher=%s", change.pk, teacher.pk)
        return {"ok": True, "message": "Переход отменён. Текущий тариф сохранён."}

    @staticmethod
    def payload_for_subscription(sub) -> dict | None:
        from .pricing_service import base_plan_price

        change = DowngradeService.get_active_change(sub)
        if not change:
            return None
        to_plan = change.to_plan
        price = (
            "0"
            if is_free_plan(to_plan)
            else str(base_plan_price(to_plan, sub.billing_period or "month"))
        )
        return {
            "change_id": change.pk,
            "status": change.status,
            "from_plan_slug": change.from_plan.slug,
            "from_plan_name": change.from_plan.name,
            "to_plan_slug": to_plan.slug,
            "to_plan_name": to_plan.name,
            "effective_at": change.effective_at.isoformat() if change.effective_at else None,
            "is_to_start": is_free_plan(to_plan),
            "next_price": price,
            "prepaid": change.status == "prepaid",
            "losses": feature_loss_messages(change.from_plan, to_plan),
            "selected_student_ids": change.selected_student_ids or [],
            "selected_group_ids": change.selected_group_ids or [],
        }

    @staticmethod
    @transaction.atomic
    def mark_prepaid(subscription, payment, plan) -> object:
        """Ранняя оплата будущего тарифа: план не меняем до expires_at."""
        from .models import SubscriptionPlanChange
        from .payment_service import add_months

        now = timezone.now()
        change = DowngradeService.get_active_change(subscription)
        if not change or change.to_plan_id != plan.pk:
            # Создаём/заменяем pending на оплаченный план.
            if change:
                change.status = SubscriptionPlanChange.Status.SUPERSEDED
                change.canceled_at = now
                change.save(update_fields=["status", "canceled_at", "updated_at"])
            change = SubscriptionPlanChange.objects.create(
                teacher=subscription.teacher,
                subscription=subscription,
                from_plan=subscription.plan,
                to_plan=plan,
                status=SubscriptionPlanChange.Status.PREPAID,
                reason=SubscriptionPlanChange.Reason.DOWNGRADE,
                effective_at=subscription.expires_at or now,
                payment=payment,
            )
        else:
            change.status = SubscriptionPlanChange.Status.PREPAID
            change.payment = payment
            change.effective_at = subscription.expires_at or change.effective_at
            change.save(
                update_fields=["status", "payment", "effective_at", "updated_at"]
            )

        months = 12 if payment.billing_period == "year" else 1
        base = subscription.expires_at if subscription.expires_at and subscription.expires_at > now else now
        subscription.prepaid_until = add_months(base, months)
        subscription.auto_renew = bool(subscription.auto_renew)
        subscription.save(update_fields=["prepaid_until", "auto_renew", "updated_at"])
        DowngradeService.sync_subscription_mirror(subscription, change)
        logger.info(
            "plan_change_prepaid change=%s payment=%s until=%s",
            change.pk,
            payment.pk,
            subscription.prepaid_until.isoformat() if subscription.prepaid_until else None,
        )
        return change

    @staticmethod
    @transaction.atomic
    def apply_due_changes(*, limit: int = 200) -> dict:
        """Обработка наступивших pending/prepaid (вызывается из scheduler)."""
        from .models import SubscriptionPlanChange, TariffPlan, TeacherSubscription
        from .subscription_access import SubscriptionAccessService

        now = timezone.now()
        start_plan = SubscriptionAccessService.get_start_plan()
        qs = (
            SubscriptionPlanChange.objects.select_related(
                "subscription", "subscription__plan", "to_plan", "from_plan", "teacher"
            )
            .filter(
                status__in=[
                    SubscriptionPlanChange.Status.PENDING,
                    SubscriptionPlanChange.Status.PREPAID,
                ],
                effective_at__lte=now,
            )
            .order_by("effective_at")[:limit]
        )

        applied = skipped = failed = 0
        for change in qs:
            sub = TeacherSubscription.objects.select_for_update().select_related("plan").get(
                pk=change.subscription_id
            )
            # Ещё действует текущий период — ждём.
            if sub.expires_at and sub.expires_at > now:
                # effective_at устарел относительно expires_at (после бонуса) — сдвинем.
                if change.effective_at < sub.expires_at:
                    change.effective_at = sub.expires_at
                    change.save(update_fields=["effective_at", "updated_at"])
                    DowngradeService.sync_subscription_mirror(sub, change)
                skipped += 1
                continue

            try:
                if change.status == SubscriptionPlanChange.Status.PREPAID:
                    DowngradeService._apply_prepaid(sub, change)
                    applied += 1
                elif is_free_plan(change.to_plan):
                    DowngradeService._apply_to_start(sub, change, start_plan)
                    applied += 1
                else:
                    # PENDING paid plan без предоплаты / без успешного renew → Старт.
                    # Recurrent обрабатывается отдельно и помечает PREPAID/APPLIED.
                    DowngradeService._apply_to_start(sub, change, start_plan)
                    applied += 1
                    logger.info(
                        "plan_change_unpaid_to_start change=%s teacher=%s",
                        change.pk,
                        sub.teacher_id,
                    )
            except Exception:
                logger.exception("plan_change_apply_failed change=%s", change.pk)
                failed += 1

        return {"applied": applied, "skipped": skipped, "failed": failed}

    @staticmethod
    def _apply_prepaid(sub, change):
        now = timezone.now()
        sub.plan = change.to_plan
        sub.status = type(sub).Status.ACTIVE
        sub.source = type(sub).Source.PAYMENT
        if sub.prepaid_until and sub.prepaid_until > now:
            sub.expires_at = sub.prepaid_until
            sub.current_period_end = sub.prepaid_until
        sub.current_period_start = now
        sub.prepaid_until = None
        sub.cancelled_at = None
        sub.save(
            update_fields=[
                "plan",
                "status",
                "source",
                "expires_at",
                "current_period_start",
                "current_period_end",
                "prepaid_until",
                "cancelled_at",
                "updated_at",
            ]
        )
        DowngradeService._enforce_limits_after_plan(sub, change)
        change.status = type(change).Status.APPLIED
        change.applied_at = now
        change.save(update_fields=["status", "applied_at", "updated_at"])
        DowngradeService.sync_subscription_mirror(sub, None)
        logger.info(
            "subscription_plan_applied prepaid change=%s plan=%s",
            change.pk,
            sub.plan.slug,
        )

    @staticmethod
    def _apply_to_start(sub, change, start_plan):
        now = timezone.now()
        sub.plan = start_plan
        sub.status = type(sub).Status.EXPIRED
        sub.auto_renew = False
        sub.prepaid_until = None
        sub.save(
            update_fields=["plan", "status", "auto_renew", "prepaid_until", "updated_at"]
        )
        DowngradeService._enforce_limits_after_plan(sub, change)
        change.status = type(change).Status.APPLIED
        change.applied_at = now
        change.metadata = {
            **(change.metadata or {}),
            "resolved_as": "start",
            "requested_to": change.to_plan.slug,
        }
        change.save(update_fields=["status", "applied_at", "metadata", "updated_at"])
        DowngradeService.sync_subscription_mirror(sub, None)

    @staticmethod
    def _enforce_limits_after_plan(sub, change):
        """Архивирует лишних учеников/групп без удаления данных."""
        from .choices import GroupStatus, StudentStatus
        from .models import Student, StudentGroup

        plan = sub.plan
        teacher = sub.teacher
        keep_students = set(int(x) for x in (change.selected_student_ids or []))
        keep_groups = set(int(x) for x in (change.selected_group_ids or []))

        active_students = list(
            Student.objects.filter(teacher=teacher, status=StudentStatus.ACTIVE).order_by(
                "-updated_at", "id"
            )
        )
        limit_s = int(plan.max_students or 0)
        if limit_s and len(active_students) > limit_s:
            if not keep_students:
                keep_students = {s.pk for s in active_students[:limit_s]}
            archived = []
            for s in active_students:
                if s.pk not in keep_students:
                    s.status = StudentStatus.ARCHIVED
                    s.save(update_fields=["status", "updated_at"])
                    archived.append(s.pk)
            if archived:
                logger.info(
                    "downgrade_archived_students teacher=%s ids=%s",
                    teacher.pk,
                    archived,
                )
                DowngradeService._notify_archive_result(
                    teacher, kind="students", archived_ids=archived, plan_name=plan.name
                )

        if plan.max_groups is not None:
            active_groups = list(
                StudentGroup.objects.filter(
                    teacher=teacher, status=GroupStatus.ACTIVE
                ).order_by("-updated_at", "id")
            )
            limit_g = int(plan.max_groups)
            if len(active_groups) > limit_g:
                if not keep_groups:
                    keep_groups = {g.pk for g in active_groups[:limit_g]}
                archived_g = []
                for g in active_groups:
                    if g.pk not in keep_groups:
                        g.status = GroupStatus.ARCHIVED
                        g.save(update_fields=["status", "updated_at"])
                        archived_g.append(g.pk)
                if archived_g:
                    logger.info(
                        "downgrade_archived_groups teacher=%s ids=%s",
                        teacher.pk,
                        archived_g,
                    )
                    DowngradeService._notify_archive_result(
                        teacher, kind="groups", archived_ids=archived_g, plan_name=plan.name
                    )

    @staticmethod
    def _notify_archive_result(teacher, *, kind: str, archived_ids: list, plan_name: str):
        try:
            from .subscription_notifications import _dispatch_or_create

            label = "учеников" if kind == "students" else "групп"
            _dispatch_or_create(
                user=teacher,
                event_key=f"downgrade_archive:{kind}:{teacher.pk}:{timezone.now().date().isoformat()}",
                event_type="subscription_downgrade_archive",
                title=f"Архивация {label} после смены тарифа",
                message=(
                    f"После перехода на «{plan_name}» в архив переведено "
                    f"{len(archived_ids)} {label}. Данные сохранены."
                ),
                payload={
                    "kind": kind,
                    "archived_ids": archived_ids,
                    "link": "/cabinet/upgrade",
                },
            )
        except Exception:
            logger.exception("downgrade archive notify failed")
