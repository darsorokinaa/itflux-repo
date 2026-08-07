"""Сервис учёта оплат репетитора: расчёты, журнал, абонементы."""

from __future__ import annotations

import csv
import io
import uuid
from datetime import datetime, timedelta
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Iterable, Optional

from django.contrib.auth.models import User
from django.db import transaction
from django.db.models import Q, Sum
from django.utils import timezone

from .billing_models import (
    BillingAccount,
    BillingAuditLog,
    BillingTransaction,
    BillingType,
    DeliveryStatus,
    EventBillingRecord,
    FinancialStatus,
    LateCancelRule,
    LessonPackage,
    MonthlyBillingPeriod,
    PackageBalanceCheckMode,
    PackageStatus,
    PackageUnitType,
    PaymentMethod,
    PaymentReminderLog,
    PriceSource,
    StudentBillingSettings,
    StudentPayment,
    StudentPaymentAllocation,
    StudentPaymentStatus,
    TeacherBillingSettings,
    TeacherPriceRule,
    TransactionType,
)
from .choices import StudentStatus
from .models import NotificationPreference, ScheduleEvent, Student, StudentGroup

ZERO = Decimal("0.00")
Q2 = Decimal("0.01")


class BillingError(Exception):
    def __init__(self, code: str, message: str, status: int = 400):
        self.code = code
        self.message = message
        self.status = status
        super().__init__(message)


def visible_billing_accounts(teacher: User):
    """Активные счета без учеников из архива — для оплат и сводок."""
    return BillingAccount.objects.filter(teacher=teacher, is_active=True).exclude(
        student__status=StudentStatus.ARCHIVED
    )


def D(value) -> Decimal:
    if value is None:
        return ZERO
    if isinstance(value, Decimal):
        return value.quantize(Q2, rounding=ROUND_HALF_UP)
    return Decimal(str(value)).quantize(Q2, rounding=ROUND_HALF_UP)


def D_units(value) -> Decimal:
    if value is None:
        return Decimal("0.00")
    if isinstance(value, Decimal):
        return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def event_duration_minutes(event: ScheduleEvent) -> int:
    if not event.starts_at or not event.ends_at:
        return 60
    delta = event.ends_at - event.starts_at
    minutes = int(delta.total_seconds() // 60)
    return max(minutes, 1)


def get_or_create_teacher_settings(teacher: User) -> TeacherBillingSettings:
    settings_obj, _ = TeacherBillingSettings.objects.get_or_create(teacher=teacher)
    return settings_obj


def get_or_create_billing_account(teacher: User, student: Student) -> BillingAccount:
    if student.teacher_id != teacher.id:
        raise BillingError("FORBIDDEN", "Ученик принадлежит другому учителю", 403)
    # Для архивных учеников разрешаем только чтение уже существующего счёта
    # (иначе плановый доход в dashboard и карточка ученика падают с 500).
    if student.status == StudentStatus.ARCHIVED:
        existing = BillingAccount.objects.filter(teacher=teacher, student=student).first()
        if existing is not None:
            if not hasattr(existing, "settings"):
                StudentBillingSettings.objects.get_or_create(billing_account=existing)
            return existing
        raise BillingError("ARCHIVED", "Ученик в архиве — оплаты недоступны", 400)
    teacher_settings = get_or_create_teacher_settings(teacher)
    account, created = BillingAccount.objects.get_or_create(
        teacher=teacher,
        student=student,
        defaults={
            "currency": teacher_settings.currency,
            "payer_name": (student.parent_contact or "").strip()[:255],
        },
    )
    if created or not hasattr(account, "settings"):
        StudentBillingSettings.objects.get_or_create(
            billing_account=account,
            defaults={
                "billing_type": teacher_settings.default_billing_type,
                "default_lesson_duration_minutes": teacher_settings.default_lesson_duration_minutes,
                "default_lesson_price": teacher_settings.default_lesson_price,
                "hourly_rate": teacher_settings.hourly_rate,
            },
        )
    return account


def audit(
    *,
    teacher: User,
    actor: Optional[User],
    action: str,
    billing_account: Optional[BillingAccount] = None,
    entity_type: str = "",
    entity_id: str = "",
    old_value: Optional[dict] = None,
    new_value: Optional[dict] = None,
    reason: str = "",
    related_transaction: Optional[BillingTransaction] = None,
):
    BillingAuditLog.objects.create(
        teacher=teacher,
        actor=actor,
        action=action,
        billing_account=billing_account,
        entity_type=entity_type,
        entity_id=str(entity_id or ""),
        old_value=old_value or {},
        new_value=new_value or {},
        reason=reason,
        related_transaction=related_transaction,
    )


def _append_tx(
    *,
    billing_account: BillingAccount,
    student: Student,
    transaction_type: str,
    amount: Decimal = ZERO,
    package_units: Decimal = ZERO,
    currency: str = "RUB",
    occurred_at=None,
    comment: str = "",
    created_by: Optional[User] = None,
    event: Optional[ScheduleEvent] = None,
    event_billing: Optional[EventBillingRecord] = None,
    package: Optional[LessonPackage] = None,
    student_payment: Optional[StudentPayment] = None,
    metadata: Optional[dict] = None,
    reversed_transaction: Optional[BillingTransaction] = None,
    is_reversal: bool = False,
) -> BillingTransaction:
    return BillingTransaction.objects.create(
        billing_account=billing_account,
        student=student,
        transaction_type=transaction_type,
        amount=D(amount),
        package_units=D_units(package_units),
        currency=currency or billing_account.currency or "RUB",
        occurred_at=occurred_at or timezone.now(),
        comment=comment or "",
        created_by=created_by,
        event=event,
        event_billing=event_billing,
        package=package,
        student_payment=student_payment,
        metadata=metadata or {},
        reversed_transaction=reversed_transaction,
        is_reversal=is_reversal,
    )


def compute_account_balance(account: BillingAccount) -> dict:
    """Баланс > 0 — переплата/аванс; < 0 — задолженность."""
    qs = BillingTransaction.objects.filter(billing_account=account)
    payments = ZERO
    charges = ZERO
    refunds = ZERO
    adjustments = ZERO
    for row in qs.values("transaction_type").annotate(total=Sum("amount")):
        t = row["transaction_type"]
        total = D(row["total"] or 0)
        if t in (TransactionType.PAYMENT, TransactionType.PACKAGE_PURCHASE):
            payments += total
        elif t in (TransactionType.CHARGE, TransactionType.WRITE_OFF):
            charges += total
        elif t == TransactionType.REFUND:
            refunds += total
        elif t in (TransactionType.ADJUSTMENT, TransactionType.DISCOUNT):
            adjustments += total
    balance = payments - charges - refunds + adjustments
    return {
        "paid": payments,
        "charged": charges,
        "refunded": refunds,
        "adjustments": adjustments,
        "balance": D(balance),
        "debt": D(abs(balance)) if balance < 0 else ZERO,
        "credit": D(balance) if balance > 0 else ZERO,
        "currency": account.currency,
    }


def _match_price_rule(
    teacher: User,
    *,
    direction: str,
    is_group: bool,
    duration: int,
) -> Optional[TeacherPriceRule]:
    audience = (
        TeacherPriceRule.Audience.GROUP if is_group else TeacherPriceRule.Audience.INDIVIDUAL
    )
    rules = list(
        TeacherPriceRule.objects.filter(teacher=teacher, is_active=True).order_by(
            "-duration_minutes"
        )
    )
    candidates = []
    for rule in rules:
        if rule.direction and rule.direction != direction:
            continue
        if rule.audience not in (TeacherPriceRule.Audience.ANY, audience):
            continue
        if rule.duration_minutes and rule.duration_minutes != duration:
            continue
        candidates.append(rule)
    return candidates[0] if candidates else None


def calculate_lesson_price(
    *,
    account: BillingAccount,
    duration_minutes: int,
    direction: str = "",
    is_group: bool = False,
    override_amount: Optional[Decimal] = None,
    is_free: bool = False,
    is_trial: bool = False,
    ignore_package_type: bool = False,
) -> dict:
    settings = account.settings
    teacher_settings = get_or_create_teacher_settings(account.teacher)

    if is_free or is_trial:
        return {
            "amount": ZERO,
            "rate": ZERO,
            "billing_type": settings.billing_type,
            "price_source": PriceSource.FREE_TRIAL,
            "price_source_label": "Бесплатный / пробный урок",
            "currency": account.currency,
            "duration_minutes": duration_minutes,
        }

    if override_amount is not None:
        amount = D(override_amount)
        return {
            "amount": amount,
            "rate": amount,
            "billing_type": BillingType.MANUAL,
            "price_source": PriceSource.MANUAL,
            "price_source_label": "Цена изменена вручную",
            "currency": account.currency,
            "duration_minutes": duration_minutes,
        }

    billing_type = settings.billing_type

    if billing_type == BillingType.MONTHLY_FIXED:
        return {
            "amount": ZERO,
            "rate": D(settings.monthly_fee or 0),
            "billing_type": billing_type,
            "price_source": PriceSource.MONTHLY,
            "price_source_label": "Включено в месячный тариф",
            "currency": account.currency,
            "duration_minutes": duration_minutes,
        }

    if (
        not ignore_package_type
        and billing_type in (BillingType.PACKAGE_LESSONS, BillingType.PACKAGE_MINUTES)
    ):
        return {
            "amount": ZERO,
            "rate": ZERO,
            "billing_type": billing_type,
            "price_source": PriceSource.PACKAGE,
            "price_source_label": "Оплата из абонемента",
            "currency": account.currency,
            "duration_minutes": duration_minutes,
        }

    # После исчерпания абонемента считаем как «за урок».
    if ignore_package_type and billing_type in (
        BillingType.PACKAGE_LESSONS,
        BillingType.PACKAGE_MINUTES,
    ):
        billing_type = BillingType.PER_LESSON

    # Subject-specific
    subject_prices = settings.subject_prices or {}
    if direction and direction in subject_prices:
        base = D(subject_prices[direction])
        if billing_type == BillingType.PER_HOUR:
            amount = D(base * Decimal(duration_minutes) / Decimal(60))
            label = f"{amount} {account.currency} — {duration_minutes} мин по ставке {base} {account.currency}/час (предмет)"
            return {
                "amount": amount,
                "rate": base,
                "billing_type": billing_type,
                "price_source": PriceSource.STUDENT_SUBJECT,
                "price_source_label": label,
                "currency": account.currency,
                "duration_minutes": duration_minutes,
            }
        label = f"{base} {account.currency} — цена ученика по предмету"
        return {
            "amount": base,
            "rate": base,
            "billing_type": billing_type,
            "price_source": PriceSource.STUDENT_SUBJECT,
            "price_source_label": label,
            "currency": account.currency,
            "duration_minutes": duration_minutes,
        }

    if is_group and settings.group_lesson_price is not None:
        amount = D(settings.group_lesson_price)
        return {
            "amount": amount,
            "rate": amount,
            "billing_type": billing_type,
            "price_source": PriceSource.GROUP,
            "price_source_label": f"{amount} {account.currency} — цена группы",
            "currency": account.currency,
            "duration_minutes": duration_minutes,
        }

    if billing_type == BillingType.PER_MINUTE and settings.per_minute_rate is not None:
        rate = D(settings.per_minute_rate)
        amount = D(rate * duration_minutes)
        return {
            "amount": amount,
            "rate": rate,
            "billing_type": billing_type,
            "price_source": PriceSource.STUDENT_DEFAULT,
            "price_source_label": (
                f"{amount} {account.currency} — {duration_minutes} мин × {rate} {account.currency}/мин"
            ),
            "currency": account.currency,
            "duration_minutes": duration_minutes,
        }

    if billing_type == BillingType.PER_HOUR:
        rate = D(settings.hourly_rate or teacher_settings.hourly_rate or 0)
        amount = D(rate * Decimal(duration_minutes) / Decimal(60))
        return {
            "amount": amount,
            "rate": rate,
            "billing_type": billing_type,
            "price_source": (
                PriceSource.STUDENT_DEFAULT if settings.hourly_rate else PriceSource.TEACHER_DEFAULT
            ),
            "price_source_label": (
                f"{amount} {account.currency} — {duration_minutes} минут по ставке "
                f"{rate} {account.currency}/час"
            ),
            "currency": account.currency,
            "duration_minutes": duration_minutes,
        }

    if settings.default_lesson_price is not None:
        amount = D(settings.default_lesson_price)
        return {
            "amount": amount,
            "rate": amount,
            "billing_type": billing_type or BillingType.PER_LESSON,
            "price_source": PriceSource.STUDENT_DEFAULT,
            "price_source_label": f"{amount} {account.currency} — индивидуальная цена ученика",
            "currency": account.currency,
            "duration_minutes": duration_minutes,
        }

    rule = _match_price_rule(
        account.teacher,
        direction=direction,
        is_group=is_group,
        duration=duration_minutes,
    )
    if rule:
        amount = D(rule.price)
        return {
            "amount": amount,
            "rate": amount,
            "billing_type": BillingType.PER_LESSON,
            "price_source": PriceSource.SERVICE_RULE,
            "price_source_label": f"{amount} {account.currency} — цена услуги / типа занятия",
            "currency": account.currency,
            "duration_minutes": duration_minutes,
        }

    amount = D(teacher_settings.default_lesson_price or 0)
    if amount > 0:
        return {
            "amount": amount,
            "rate": amount,
            "billing_type": BillingType.PER_LESSON,
            "price_source": PriceSource.TEACHER_DEFAULT,
            "price_source_label": f"{amount} {account.currency} — общая цена учителя",
            "currency": account.currency,
            "duration_minutes": duration_minutes,
        }

    # Последний абонемент: стоимость одного занятия как запасной источник цены.
    last_unit = last_package_unit_price(account)
    if last_unit and last_unit > 0:
        return {
            "amount": last_unit,
            "rate": last_unit,
            "billing_type": BillingType.PER_LESSON,
            "price_source": PriceSource.PACKAGE,
            "price_source_label": (
                f"{last_unit} {account.currency} — по стоимости занятия из последнего абонемента"
            ),
            "currency": account.currency,
            "duration_minutes": duration_minutes,
        }

    return {
        "amount": ZERO,
        "rate": ZERO,
        "billing_type": BillingType.PER_LESSON,
        "price_source": PriceSource.TEACHER_DEFAULT,
        "price_source_label": "Стоимость не указана",
        "currency": account.currency,
        "duration_minutes": duration_minutes,
    }


def last_package_unit_price(account: BillingAccount) -> Optional[Decimal]:
    pkg = (
        LessonPackage.objects.filter(billing_account=account)
        .exclude(purchase_amount=0)
        .exclude(total_units=0)
        .order_by("-created_at")
        .first()
    )
    if not pkg or D_units(pkg.total_units) <= 0:
        return None
    return (D(pkg.purchase_amount) / D_units(pkg.total_units)).quantize(Decimal("0.01"))


def package_units_for_lesson(
    *,
    settings: StudentBillingSettings,
    package: LessonPackage,
    duration_minutes: int,
) -> Decimal:
    if package.unit_type == PackageUnitType.MINUTE:
        return D_units(duration_minutes)
    coeffs = settings.duration_lesson_coefficients or {}
    key = str(duration_minutes)
    if key in coeffs:
        return D_units(coeffs[key])
    return D_units(1)


def active_package_for_account(
    account: BillingAccount,
    *,
    unit_type: Optional[str] = None,
    prefer_auto_use: bool = True,
) -> Optional[LessonPackage]:
    today = timezone.localdate()
    qs = LessonPackage.objects.filter(
        billing_account=account,
        status=PackageStatus.ACTIVE,
    ).filter(Q(expires_at__isnull=True) | Q(expires_at__gte=today))
    if unit_type:
        qs = qs.filter(unit_type=unit_type)
    if prefer_auto_use:
        qs = qs.filter(auto_use=True)
    qs = qs.filter(remaining_units__gt=0).order_by("expires_at", "created_at")
    return qs.first()


def package_confirmed_paid_amount(package: LessonPackage) -> Decimal:
    """Сколько подтверждённых оплат привязано к абонементу."""
    paid = (
        StudentPayment.objects.filter(
            package=package,
            status=StudentPaymentStatus.CONFIRMED,
        ).aggregate(t=Sum("amount"))["t"]
        or ZERO
    )
    return D(paid)


def package_amount_due(package: LessonPackage) -> Decimal:
    purchase = D(package.purchase_amount or 0)
    if purchase <= 0:
        return ZERO
    due = purchase - package_confirmed_paid_amount(package)
    return due if due > 0 else ZERO


def awaiting_payment_packages(account: BillingAccount) -> list[LessonPackage]:
    """Активные абонементы, по которым ещё не закрыта стоимость."""
    today = timezone.localdate()
    packages = list(
        LessonPackage.objects.filter(
            billing_account=account,
            status__in=(PackageStatus.ACTIVE, PackageStatus.FROZEN),
        )
        .filter(Q(expires_at__isnull=True) | Q(expires_at__gte=today))
        .filter(purchase_amount__gt=0)
        .order_by("created_at")
    )
    return [pkg for pkg in packages if package_amount_due(pkg) > 0]


def _payment_unallocated_amount(payment: StudentPayment) -> Decimal:
    allocated = payment.allocations.aggregate(t=Sum("amount"))["t"] or ZERO
    free = D(payment.amount) - D(allocated) - D(payment.refunded_amount or 0)
    return free if free > 0 else ZERO


def link_payment_to_package(payment: StudentPayment, package: LessonPackage) -> None:
    """Привязать оплату (и связанные проводки) к абонементу."""
    if payment.package_id and payment.package_id != package.id:
        return
    if payment.package_id != package.id:
        payment.package = package
        payment.save(update_fields=["package", "updated_at"])
    BillingTransaction.objects.filter(
        student_payment=payment,
        is_reversal=False,
    ).update(
        package=package,
        transaction_type=TransactionType.PACKAGE_PURCHASE,
    )


def reconcile_package_payments(account: BillingAccount) -> None:
    """
    Привязать «висящие» оплаты к абонементам, ожидающим оплаты.

    Типичный случай: абонемент создали с «оплатить позже», а оплату внесли
    без выбора абонемента — в операциях +N ₽, а статус всё ещё «Ожидает оплаты».
    """
    awaiting = awaiting_payment_packages(account)
    if not awaiting:
        return

    orphans = (
        StudentPayment.objects.filter(
            billing_account=account,
            package__isnull=True,
            status=StudentPaymentStatus.CONFIRMED,
        )
        .prefetch_related("allocations")
        .order_by("paid_at", "created_at")
    )

    for payment in orphans:
        free = _payment_unallocated_amount(payment)
        if free <= 0:
            continue
        purpose = (payment.purpose or "").lower()
        prefers_package = "абонемент" in purpose

        candidates = [
            pkg for pkg in awaiting_payment_packages(account) if package_amount_due(pkg) > 0
        ]
        if not candidates:
            break

        target = None
        if prefers_package and len(candidates) == 1:
            target = candidates[0]
        else:
            exact = [pkg for pkg in candidates if package_amount_due(pkg) == free]
            if len(exact) == 1:
                target = exact[0]
            elif len(candidates) == 1 and not payment.allocations.exists():
                # Одна незакрытая подписка и оплата без привязки к урокам.
                target = candidates[0]

        if target is None:
            continue
        link_payment_to_package(payment, target)


def billing_type_for_package_unit(unit_type: str) -> str:
    if unit_type == PackageUnitType.MINUTE:
        return BillingType.PACKAGE_MINUTES
    return BillingType.PACKAGE_LESSONS


def resolve_usable_package(
    account: BillingAccount,
    *,
    package_id: Optional[str] = None,
    settings: Optional[StudentBillingSettings] = None,
) -> Optional[LessonPackage]:
    """Активный абонемент для списания: явный id, иначе по типу счёта, иначе любой auto_use."""
    if package_id:
        package = LessonPackage.objects.filter(pk=package_id, billing_account=account).first()
        if package and package.status == PackageStatus.ACTIVE and package.remaining_units > 0:
            return package
    settings = settings or account.settings
    preferred = None
    if settings.billing_type == BillingType.PACKAGE_MINUTES:
        preferred = PackageUnitType.MINUTE
    elif settings.billing_type == BillingType.PACKAGE_LESSONS:
        preferred = PackageUnitType.LESSON
    if preferred:
        package = active_package_for_account(account, unit_type=preferred)
        if package:
            return package
    # Есть абонемент, даже если тип оплаты ещё «за урок» — списываем из него.
    return active_package_for_account(account, unit_type=None)


def sync_account_billing_type_for_package(account: BillingAccount, package: LessonPackage) -> None:
    """При продаже абонемента переключаем ученика на оплату из пакета."""
    settings = account.settings
    desired = billing_type_for_package_unit(package.unit_type)
    if settings.billing_type == desired:
        return
    settings.billing_type = desired
    settings.save(update_fields=["billing_type", "updated_at"])


def check_package_for_planning(
    teacher: User,
    student: Student,
    duration_minutes: int,
) -> dict:
    account = get_or_create_billing_account(teacher, student)
    teacher_settings = get_or_create_teacher_settings(teacher)
    settings = account.settings
    mode = teacher_settings.package_balance_check
    result = {
        "ok": True,
        "mode": mode,
        "warning": "",
        "block": False,
        "package": None,
        "remaining_units": None,
        "needed_units": None,
        "billing_type": settings.billing_type,
        "price_preview": calculate_lesson_price(
            account=account,
            duration_minutes=duration_minutes,
            direction=student.direction or "",
        ),
    }
    if settings.billing_type not in (
        BillingType.PACKAGE_LESSONS,
        BillingType.PACKAGE_MINUTES,
    ):
        return result

    unit_type = (
        PackageUnitType.LESSON
        if settings.billing_type == BillingType.PACKAGE_LESSONS
        else PackageUnitType.MINUTE
    )
    package = active_package_for_account(account, unit_type=unit_type)
    if not package:
        result["warning"] = "Нет активного абонемента. Можно запланировать урок и оформить оплату позже."
        if mode == PackageBalanceCheckMode.BLOCK:
            result["ok"] = False
            result["block"] = True
        return result

    needed = package_units_for_lesson(
        settings=settings, package=package, duration_minutes=duration_minutes
    )
    result["package"] = {
        "id": str(package.id),
        "title": package.title,
        "remaining_units": str(package.remaining_units),
        "unit_type": package.unit_type,
        "expires_at": package.expires_at.isoformat() if package.expires_at else None,
    }
    result["remaining_units"] = str(package.remaining_units)
    result["needed_units"] = str(needed)
    if package.remaining_units < needed:
        result["warning"] = (
            "Абонемента не хватит на это занятие. Можно запланировать урок и оформить оплату позже."
        )
        if mode == PackageBalanceCheckMode.BLOCK:
            result["ok"] = False
            result["block"] = True
    return result


def ensure_event_billing_records(event: ScheduleEvent) -> list[EventBillingRecord]:
    teacher = event.owner
    students: list[Student] = []
    if event.group_id:
        students = list(event.group.students.exclude(status=StudentStatus.ARCHIVED))
        if event.student_id and event.student not in students:
            students.append(event.student)
    elif event.student_id:
        students = [event.student]
    else:
        participants = event.participants.filter(student__isnull=False).exclude(status="removed")
        students = [p.student for p in participants if p.student_id]

    students = [s for s in students if s and s.status != StudentStatus.ARCHIVED]

    duration = event_duration_minutes(event)
    is_group = bool(event.group_id) or event.event_type in (
        ScheduleEvent.EventType.GROUP,
        ScheduleEvent.EventType.GROUP_LESSON,
        "group",
        "group_lesson",
    )
    records = []
    for student in students:
        account = get_or_create_billing_account(teacher, student)
        record, created = EventBillingRecord.objects.get_or_create(
            event=event,
            student=student,
            defaults={
                "billing_account": account,
                "planned_duration_minutes": duration,
                "currency": account.currency,
                "financial_status": FinancialStatus.NOT_SPECIFIED,
                "delivery_status": DeliveryStatus.PLANNED,
            },
        )
        if created or record.financial_status == FinancialStatus.NOT_SPECIFIED:
            price = calculate_lesson_price(
                account=account,
                duration_minutes=duration,
                direction=getattr(student, "direction", "") or "",
                is_group=is_group,
            )
            record.billing_type = price["billing_type"]
            record.rate = price["rate"]
            record.calculated_amount = price["amount"]
            record.price_source = price["price_source"]
            record.price_source_label = price["price_source_label"]
            record.planned_duration_minutes = duration
            record.currency = price["currency"]
            if record.financial_status == FinancialStatus.NOT_SPECIFIED:
                if price["price_source"] == PriceSource.PACKAGE:
                    record.financial_status = FinancialStatus.NOT_CHARGED
                elif price["amount"] == ZERO and price["price_source"] in (
                    PriceSource.FREE_TRIAL,
                    PriceSource.MONTHLY,
                ):
                    record.financial_status = (
                        FinancialStatus.NOT_BILLABLE
                        if price["price_source"] == PriceSource.FREE_TRIAL
                        else FinancialStatus.NOT_CHARGED
                    )
                else:
                    record.financial_status = FinancialStatus.NOT_CHARGED
            record.save()
        records.append(record)
    return records


@transaction.atomic
def consume_package(
    *,
    package: LessonPackage,
    units: Decimal,
    account: BillingAccount,
    student: Student,
    created_by: Optional[User],
    event: Optional[ScheduleEvent] = None,
    event_billing: Optional[EventBillingRecord] = None,
    comment: str = "",
) -> BillingTransaction:
    locked = LessonPackage.objects.select_for_update().get(pk=package.pk)
    if locked.status != PackageStatus.ACTIVE:
        raise BillingError("PACKAGE_INACTIVE", "Абонемент неактивен")
    units = D_units(units)
    if units <= 0:
        raise BillingError("INVALID_UNITS", "Количество единиц должно быть больше 0")
    teacher_settings = get_or_create_teacher_settings(account.teacher)
    if locked.remaining_units < units and not teacher_settings.allow_negative_balance:
        raise BillingError("INSUFFICIENT_PACKAGE", "Недостаточно единиц абонемента")
    locked.remaining_units = D_units(locked.remaining_units - units)
    if locked.remaining_units <= 0:
        locked.remaining_units = ZERO
        locked.status = PackageStatus.EXHAUSTED
    locked.save(update_fields=["remaining_units", "status", "updated_at"])
    tx = _append_tx(
        billing_account=account,
        student=student,
        transaction_type=TransactionType.PACKAGE_CONSUMPTION,
        package_units=units,
        currency=account.currency,
        created_by=created_by,
        event=event,
        event_billing=event_billing,
        package=locked,
        comment=comment or "Списание абонемента",
    )
    try:
        teacher_settings = get_or_create_teacher_settings(account.teacher)
        threshold = (
            getattr(account.settings, "low_balance_threshold_lessons", None)
            or teacher_settings.low_balance_threshold_lessons
            or 2
        )
        if locked.unit_type == "lesson" and locked.remaining_units <= threshold:
            from .teacher_notifications import notify_teacher_package_low

            notify_teacher_package_low(
                teacher=account.teacher,
                student=student,
                remaining=locked.remaining_units,
                unit_label="занятий",
            )
            try:
                from .student_notifications import (
                    notify_student_package_ended,
                    notify_student_package_low,
                )

                if locked.remaining_units <= 0:
                    notify_student_package_ended(teacher=account.teacher, student=student)
                else:
                    notify_student_package_low(
                        teacher=account.teacher,
                        student=student,
                        remaining=locked.remaining_units,
                        unit_label="занятий",
                    )
            except Exception:
                pass
        min_threshold = (
            getattr(account.settings, "low_balance_threshold_minutes", None)
            or teacher_settings.low_balance_threshold_minutes
            or 120
        )
        if locked.unit_type == "minute" and locked.remaining_units <= min_threshold:
            from .teacher_notifications import notify_teacher_package_low

            notify_teacher_package_low(
                teacher=account.teacher,
                student=student,
                remaining=locked.remaining_units,
                unit_label="минут",
            )
            try:
                from .student_notifications import (
                    notify_student_package_ended,
                    notify_student_package_low,
                )

                if locked.remaining_units <= 0:
                    notify_student_package_ended(teacher=account.teacher, student=student)
                else:
                    notify_student_package_low(
                        teacher=account.teacher,
                        student=student,
                        remaining=locked.remaining_units,
                        unit_label="минут",
                    )
            except Exception:
                pass
    except Exception:
        pass
    return tx


@transaction.atomic
def return_package_units(
    *,
    package: LessonPackage,
    units: Decimal,
    account: BillingAccount,
    student: Student,
    created_by: Optional[User],
    event: Optional[ScheduleEvent] = None,
    event_billing: Optional[EventBillingRecord] = None,
    comment: str = "",
) -> BillingTransaction:
    locked = LessonPackage.objects.select_for_update().get(pk=package.pk)
    units = D_units(units)
    locked.remaining_units = D_units(locked.remaining_units + units)
    if locked.status == PackageStatus.EXHAUSTED and locked.remaining_units > 0:
        locked.status = PackageStatus.ACTIVE
    locked.save(update_fields=["remaining_units", "status", "updated_at"])
    return _append_tx(
        billing_account=account,
        student=student,
        transaction_type=TransactionType.PACKAGE_RETURN,
        package_units=units,
        currency=account.currency,
        created_by=created_by,
        event=event,
        event_billing=event_billing,
        package=locked,
        comment=comment or "Возврат единиц абонемента",
    )


UNPAID_FINANCIAL_STATUSES = (
    FinancialStatus.AWAITING_PAYMENT,
    FinancialStatus.PARTIALLY_PAID,
    FinancialStatus.NEEDS_DECISION,
)

CHARGEABLE_DELIVERY_STATUSES = (
    DeliveryStatus.CONDUCTED,
    DeliveryStatus.NO_SHOW,
)


def unpaid_reason_for_record(record: EventBillingRecord) -> str:
    """Понятная причина, почему урок ещё не списан/не оплачен."""
    if record.financial_status == FinancialStatus.PAID_FROM_PACKAGE:
        return ""
    if record.financial_status == FinancialStatus.PAID:
        return ""
    if record.delivery_status not in CHARGEABLE_DELIVERY_STATUSES:
        return "Урок не проведён"
    if record.financial_status == FinancialStatus.NEEDS_DECISION:
        return "Требует финансового оформления"
    if record.package_id and D_units(record.package_units) > 0:
        return "Списание отменено или не завершено"
    if D(record.paid_amount or 0) > 0 and D(record.paid_amount) < D(record.charged_amount or 0):
        return "Оплачен частично"
    package = active_package_for_account(record.billing_account)
    if not package:
        return "На момент проведения не было активного абонемента"
    if D_units(package.remaining_units) <= 0:
        return "В абонементе закончились занятия"
    return "Ожидает списания из абонемента или оплаты"


def get_unpaid_completed_lessons(
    account: BillingAccount,
    *,
    order_oldest_first: bool = True,
) -> list[EventBillingRecord]:
    """Проведённые (или no-show) уроки, ожидающие оплаты/списания."""
    qs = (
        EventBillingRecord.objects.select_related("event", "student", "billing_account", "package")
        .filter(
            billing_account=account,
            delivery_status__in=CHARGEABLE_DELIVERY_STATUSES,
            financial_status__in=UNPAID_FINANCIAL_STATUSES,
        )
    )
    if order_oldest_first:
        qs = qs.order_by("event__starts_at", "created_at")
    else:
        qs = qs.order_by("-event__starts_at", "-created_at")
    return list(qs)


def find_available_packages_for_charge(
    account: BillingAccount,
    *,
    allow_unpaid_package: bool = True,
) -> list[LessonPackage]:
    """Абонементы, из которых можно вручную списать занятия (в т.ч. задним числом)."""
    today = timezone.localdate()
    qs = (
        LessonPackage.objects.filter(
            billing_account=account,
            status__in=(PackageStatus.ACTIVE, PackageStatus.FROZEN),
        )
        .filter(remaining_units__gt=0)
        .order_by("expires_at", "created_at")
    )
    result = []
    for pkg in qs:
        # Замороженный — только с явным выбором; в списке показываем active в первую очередь
        if pkg.status == PackageStatus.FROZEN:
            continue
        # Истёкший по дате: для ручного погашения задолженности всё равно доступен
        # (учитель подтверждает явно). Для автосписка оставляем и истёкшие с остатком.
        if not allow_unpaid_package and package_amount_due(pkg) > 0:
            continue
        result.append(pkg)
    # Если активных нет — предложим истёкшие с остатком (ручное погашение долга)
    if not result:
        expired = LessonPackage.objects.filter(
            billing_account=account,
            status__in=(PackageStatus.ACTIVE, PackageStatus.EXPIRED, PackageStatus.EXHAUSTED),
            remaining_units__gt=0,
        ).order_by("-created_at")
        result = list(expired)
    _ = today  # reserved for future strict auto-period checks
    return result


def _active_package_consumption_for_record(record: EventBillingRecord) -> Optional[BillingTransaction]:
    """Активное (не отменённое) списание занятия по уроку."""
    consumptions = BillingTransaction.objects.filter(
        event_billing=record,
        transaction_type=TransactionType.PACKAGE_CONSUMPTION,
        is_reversal=False,
        is_legacy=False,
    ).order_by("-created_at")
    for tx in consumptions:
        if BillingTransaction.objects.filter(reversed_transaction=tx).exists():
            continue
        if D_units(tx.package_units) > 0:
            return tx
    return None


def _clear_money_charge_for_package_settle(
    *,
    teacher: User,
    record: EventBillingRecord,
    comment: str = "",
) -> Decimal:
    """
    Сторнировать денежное начисление по уроку перед списанием из абонемента.
    Не трогает delivery_status и finalized_at. Возвращает сумму снятого charge.
    """
    cleared = ZERO
    # Уже есть денежные allocation — нельзя конвертировать в абонемент молча
    has_payment = StudentPaymentAllocation.objects.filter(
        event_billing=record,
        payment__status=StudentPaymentStatus.CONFIRMED,
    ).exists()
    if has_payment or D(record.paid_amount or 0) > 0:
        raise BillingError(
            "HAS_PAYMENT",
            "По уроку уже есть денежная оплата. Сначала отмените оплату.",
        )

    charge_txs = list(
        BillingTransaction.objects.select_for_update().filter(
            event_billing=record,
            transaction_type=TransactionType.CHARGE,
            is_reversal=False,
        )
    )
    for tx in charge_txs:
        if BillingTransaction.objects.filter(reversed_transaction=tx).exists():
            continue
        # Сторно без смены финансового статуса через reverse_transaction —
        # статус выставит charge_lesson_from_package.
        reverse_amount = D(-tx.amount)
        _append_tx(
            billing_account=tx.billing_account,
            student=tx.student,
            transaction_type=TransactionType.CHARGE,
            amount=reverse_amount,
            currency=tx.currency,
            created_by=teacher,
            event=tx.event,
            event_billing=record,
            comment=comment or "Сторно начисления перед списанием из абонемента",
            reversed_transaction=tx,
            is_reversal=True,
            metadata={"reverses": str(tx.id), "reason": "package_settle"},
        )
        cleared = D(cleared + tx.amount)
        record.charged_amount = D(max(ZERO, D(record.charged_amount or 0) - tx.amount))

    if D(record.charged_amount or 0) > 0 and cleared <= 0:
        # Начисление без tx (редкий legacy) — обнуляем снимок
        cleared = D(record.charged_amount)
        record.charged_amount = ZERO
    elif D(record.charged_amount or 0) > 0:
        record.charged_amount = ZERO
    return cleared


def preview_charge_lessons_from_package(
    *,
    teacher: User,
    account: BillingAccount,
    package: LessonPackage,
    event_billing_ids: Optional[list] = None,
    select_earliest: bool = False,
) -> dict:
    """Превью массового списания: сколько спишется и какой будет остаток."""
    if account.teacher_id != teacher.id:
        raise BillingError("FORBIDDEN", "Нет доступа", 403)
    if package.billing_account_id != account.id:
        raise BillingError("PACKAGE_MISMATCH", "Абонемент не принадлежит этому ученику")
    if package.status in (PackageStatus.CANCELLED,):
        raise BillingError("PACKAGE_UNAVAILABLE", "Абонемент отменён или недоступен")

    unpaid = get_unpaid_completed_lessons(account, order_oldest_first=True)
    if event_billing_ids:
        id_set = {str(i) for i in event_billing_ids}
        unpaid = [r for r in unpaid if str(r.id) in id_set]
    settings = account.settings
    remaining = D_units(package.remaining_units)
    selected = []
    units_needed_total = ZERO
    warnings = []

    package_paid_at = None
    first_payment = (
        StudentPayment.objects.filter(
            package=package, status=StudentPaymentStatus.CONFIRMED
        )
        .order_by("paid_at")
        .first()
    )
    if first_payment:
        package_paid_at = first_payment.paid_at

    for record in unpaid:
        if select_earliest and remaining - units_needed_total <= 0:
            break
        duration = (
            record.actual_duration_minutes
            if settings.use_actual_duration_for_package and record.actual_duration_minutes
            else (record.planned_duration_minutes or event_duration_minutes(record.event))
        )
        units = package_units_for_lesson(
            settings=settings, package=package, duration_minutes=duration
        )
        if units_needed_total + units > remaining:
            if select_earliest:
                break
            warnings.append(
                {
                    "event_billing_id": str(record.id),
                    "message": "В абонементе недостаточно занятий",
                }
            )
            continue
        before_payment = False
        if package_paid_at and record.event_id and record.event.starts_at:
            if record.event.starts_at < package_paid_at:
                before_payment = True
        selected.append(
            {
                "event_billing_id": str(record.id),
                "event_id": record.event_id,
                "event_title": record.event.title if record.event_id else "",
                "event_starts_at": (
                    record.event.starts_at.isoformat() if record.event_id and record.event.starts_at else None
                ),
                "units": str(units),
                "due_amount": str(
                    max(ZERO, D(record.charged_amount or 0) - D(record.paid_amount or 0))
                ),
                "before_package_payment": before_payment,
                "unpaid_reason": unpaid_reason_for_record(record),
            }
        )
        units_needed_total = D_units(units_needed_total + units)
        if select_earliest and event_billing_ids is None:
            # select_earliest без явных id — набираем пока хватает остатка
            pass

    remaining_after = D_units(remaining - units_needed_total)
    return {
        "package_id": str(package.id),
        "package_title": package.title,
        "remaining_before": str(remaining),
        "units_to_charge": str(units_needed_total),
        "lessons_count": len(selected),
        "remaining_after": str(remaining_after),
        "message": (
            f"Будет списано: {len(selected)} занятий. "
            f"Остаток после списания: {remaining_after} "
            f"{'мин' if package.unit_type == PackageUnitType.MINUTE else 'занятий'}."
        ),
        "items": selected,
        "warnings": warnings,
        "package_paid_at": package_paid_at.isoformat() if package_paid_at else None,
    }


@transaction.atomic
def charge_lesson_from_package(
    *,
    teacher: User,
    event_billing: EventBillingRecord,
    package: Optional[LessonPackage] = None,
    package_id: Optional[str] = None,
    comment: str = "",
    idempotency_key: str = "",
) -> dict:
    """
    Списать одно проведённое неоплаченное занятие из абонемента.
    Дата урока может быть раньше даты оплаты абонемента — это погашение долга.
    """
    record = EventBillingRecord.objects.select_for_update().get(pk=event_billing.pk)
    record = EventBillingRecord.objects.select_related(
        "billing_account", "event", "student", "package"
    ).get(pk=record.pk)
    account = record.billing_account
    if account.teacher_id != teacher.id:
        raise BillingError("FORBIDDEN", "Нет доступа", 403)

    if idempotency_key:
        existing = BillingTransaction.objects.filter(
            event_billing=record,
            transaction_type=TransactionType.PACKAGE_CONSUMPTION,
            is_reversal=False,
            metadata__idempotency_key=idempotency_key,
        ).first()
        if existing and not BillingTransaction.objects.filter(reversed_transaction=existing).exists():
            record.refresh_from_db()
            pkg = existing.package
            remaining = pkg.remaining_units if pkg else ZERO
            return {
                "record": record,
                "transaction": existing,
                "package": pkg,
                "idempotent": True,
                "message": "Операция уже была выполнена",
                "remaining_units": remaining,
                "before_package_payment": bool(
                    (existing.metadata or {}).get("before_package_payment")
                ),
            }

    if record.delivery_status not in CHARGEABLE_DELIVERY_STATUSES:
        raise BillingError(
            "NOT_CONDUCTED",
            "Нельзя списать отменённый или непроведённый урок",
        )

    if record.financial_status in (
        FinancialStatus.PAID,
        FinancialStatus.PAID_FROM_PACKAGE,
        FinancialStatus.NOT_BILLABLE,
    ):
        raise BillingError("ALREADY_PAID", "Этот урок уже оплачен")

    if record.financial_status not in UNPAID_FINANCIAL_STATUSES:
        raise BillingError(
            "NOT_AWAITING",
            "Урок не ожидает оплаты",
        )

    active_consumption = _active_package_consumption_for_record(record)
    if active_consumption:
        raise BillingError("ALREADY_CHARGED", "Этот урок уже оплачен")

    if package_id and not package:
        package = LessonPackage.objects.filter(pk=package_id, billing_account=account).first()
        if not package:
            foreign = LessonPackage.objects.filter(pk=package_id).first()
            if foreign:
                raise BillingError("PACKAGE_MISMATCH", "Абонемент не принадлежит этому ученику")
            raise BillingError("NO_PACKAGE", "Абонемент не найден")
    if not package:
        package = resolve_usable_package(account) or (
            find_available_packages_for_charge(account)[:1] or [None]
        )[0]
    if not package:
        raise BillingError("NO_PACKAGE", "Нет доступного абонемента для списания")
    if package.billing_account_id != account.id:
        raise BillingError("PACKAGE_MISMATCH", "Абонемент не принадлежит этому ученику")
    if package.status == PackageStatus.CANCELLED:
        raise BillingError("PACKAGE_UNAVAILABLE", "Абонемент отменён или недоступен")

    settings = account.settings
    duration = (
        record.actual_duration_minutes
        if settings.use_actual_duration_for_package and record.actual_duration_minutes
        else (record.planned_duration_minutes or event_duration_minutes(record.event))
    )
    units = package_units_for_lesson(
        settings=settings, package=package, duration_minutes=duration
    )

    locked = LessonPackage.objects.select_for_update().get(pk=package.pk)
    if locked.status == PackageStatus.CANCELLED:
        raise BillingError("PACKAGE_UNAVAILABLE", "Абонемент отменён или недоступен")
    if D_units(locked.remaining_units) < units:
        raise BillingError("INSUFFICIENT_PACKAGE", "В абонементе недостаточно занятий")

    before_payment = False
    first_payment = (
        StudentPayment.objects.filter(
            package=locked, status=StudentPaymentStatus.CONFIRMED
        )
        .order_by("paid_at")
        .first()
    )
    if first_payment and record.event_id and record.event.starts_at:
        if record.event.starts_at < first_payment.paid_at:
            before_payment = True

    cleared_charge = _clear_money_charge_for_package_settle(
        teacher=teacher,
        record=record,
        comment=comment,
    )

    settle_comment = comment or "Списание из абонемента (погашение задолженности)"
    if before_payment and not comment:
        settle_comment = (
            "Списание из абонемента: погашение задолженности "
            "(урок прошёл до оплаты абонемента)"
        )

    tx = consume_package(
        package=locked,
        units=units,
        account=account,
        student=record.student,
        created_by=teacher,
        event=record.event,
        event_billing=record,
        comment=settle_comment,
    )
    meta = {
        "manual_settle": True,
        "before_package_payment": before_payment,
        "cleared_charge_amount": str(cleared_charge),
    }
    if idempotency_key:
        meta["idempotency_key"] = idempotency_key
    BillingTransaction.objects.filter(pk=tx.pk).update(metadata=meta)
    tx.refresh_from_db()

    locked.refresh_from_db()
    record.package = locked
    record.package_units = units
    record.charged_amount = ZERO
    record.paid_amount = ZERO
    record.calculated_amount = ZERO
    record.billing_type = billing_type_for_package_unit(locked.unit_type)
    record.price_source = PriceSource.PACKAGE
    record.price_source_label = (
        f"Списано {units} "
        f"{'мин' if locked.unit_type == PackageUnitType.MINUTE else 'ур.'}; "
        f"остаток {locked.remaining_units}"
    )
    record.financial_status = FinancialStatus.PAID_FROM_PACKAGE
    if not record.finalized_at:
        record.finalized_at = timezone.now()
    if comment:
        record.comment = comment
    record.save()

    audit(
        teacher=teacher,
        actor=teacher,
        action="package_settle",
        billing_account=account,
        entity_type="EventBillingRecord",
        entity_id=str(record.id),
        new_value={
            "package_id": str(locked.id),
            "units": str(units),
            "remaining": str(locked.remaining_units),
            "before_package_payment": before_payment,
        },
        related_transaction=tx,
        reason=settle_comment,
    )

    unit_label = "занятий" if locked.unit_type != PackageUnitType.MINUTE else "минут"
    message = f"Урок списан из абонемента. Осталось {locked.remaining_units} {unit_label}"
    return {
        "record": record,
        "transaction": tx,
        "package": locked,
        "idempotent": False,
        "before_package_payment": before_payment,
        "message": message,
        "remaining_units": locked.remaining_units,
    }


@transaction.atomic
def charge_multiple_lessons_from_package(
    *,
    teacher: User,
    account: BillingAccount,
    package: LessonPackage,
    event_billing_ids: Optional[list] = None,
    select_earliest: bool = False,
    comment: str = "",
    idempotency_key: str = "",
) -> dict:
    """Массовое списание неоплаченных уроков из абонемента (без отрицательного остатка)."""
    if account.teacher_id != teacher.id:
        raise BillingError("FORBIDDEN", "Нет доступа", 403)
    if package.billing_account_id != account.id:
        raise BillingError("PACKAGE_MISMATCH", "Абонемент не принадлежит этому ученику")

    preview = preview_charge_lessons_from_package(
        teacher=teacher,
        account=account,
        package=package,
        event_billing_ids=event_billing_ids,
        select_earliest=select_earliest or not event_billing_ids,
    )
    if preview["lessons_count"] <= 0:
        raise BillingError("NOTHING_TO_CHARGE", "Нет уроков для списания")

    # Если передали больше, чем хватает остатка — без select_earliest ошибка
    if event_billing_ids and not select_earliest:
        requested = len({str(i) for i in event_billing_ids})
        if requested > preview["lessons_count"] and preview["warnings"]:
            raise BillingError(
                "INSUFFICIENT_PACKAGE",
                "В абонементе недостаточно занятий",
            )

    results = []
    last_pkg = package
    for item in preview["items"]:
        record = EventBillingRecord.objects.get(pk=item["event_billing_id"])
        key = ""
        if idempotency_key:
            key = f"{idempotency_key}:{record.id}"
        row = charge_lesson_from_package(
            teacher=teacher,
            event_billing=record,
            package_id=str(package.id),
            comment=comment,
            idempotency_key=key,
        )
        results.append(row)
        last_pkg = row["package"]

    n = len(results)
    unit_label = "занятий" if last_pkg.unit_type != PackageUnitType.MINUTE else "минут"
    if n == 1:
        message = results[0]["message"]
    else:
        message = (
            f"{n} урока списаны из абонемента. "
            f"Осталось {last_pkg.remaining_units} {unit_label}"
        )
    return {
        "charged_count": n,
        "remaining_units": last_pkg.remaining_units,
        "package": last_pkg,
        "results": results,
        "message": message,
        "preview": preview,
    }


@transaction.atomic
def refund_lesson_package_charge(
    *,
    teacher: User,
    event_billing: EventBillingRecord,
    comment: str = "",
) -> dict:
    """
    Отменить списание занятия из абонемента: вернуть единицу, урок → «Ожидает оплаты».
    Первоначальная операция не удаляется.
    """
    record = EventBillingRecord.objects.select_for_update().get(pk=event_billing.pk)
    record = EventBillingRecord.objects.select_related(
        "billing_account", "event", "package"
    ).get(pk=record.pk)
    if record.billing_account.teacher_id != teacher.id:
        raise BillingError("FORBIDDEN", "Нет доступа", 403)

    tx = _active_package_consumption_for_record(record)
    if not tx:
        raise BillingError("NO_CONSUMPTION", "Активное списание по уроку не найдено")

    cleared_meta = (tx.metadata or {}).get("cleared_charge_amount") or "0"
    try:
        restored_charge = D(cleared_meta)
    except Exception:
        restored_charge = ZERO

    rev = reverse_transaction(
        teacher=teacher,
        tx=tx,
        comment=comment or "Отмена списания из абонемента",
        restore_awaiting_payment=True,
        restore_charge_amount=restored_charge,
    )
    record.refresh_from_db()
    return {
        "record": record,
        "reversal": rev,
        "message": "Списание отменено. Занятие возвращено в абонемент",
    }


@transaction.atomic
def mark_lesson_as_paid_manually(
    *,
    teacher: User,
    event_billing: EventBillingRecord,
    amount: Decimal,
    paid_at=None,
    method: str = "",
    comment: str = "",
) -> StudentPayment:
    """Ручная оплата отдельного урока без списания из абонемента."""
    record = EventBillingRecord.objects.select_for_update().get(pk=event_billing.pk)
    record = EventBillingRecord.objects.select_related(
        "billing_account", "student"
    ).get(pk=record.pk)
    account = record.billing_account
    if account.teacher_id != teacher.id:
        raise BillingError("FORBIDDEN", "Нет доступа", 403)
    if record.delivery_status not in CHARGEABLE_DELIVERY_STATUSES:
        raise BillingError(
            "NOT_CONDUCTED",
            "Нельзя списать отменённый или непроведённый урок",
        )
    if record.financial_status in (
        FinancialStatus.PAID,
        FinancialStatus.PAID_FROM_PACKAGE,
    ):
        raise BillingError("ALREADY_PAID", "Этот урок уже оплачен")
    if _active_package_consumption_for_record(record):
        raise BillingError("ALREADY_CHARGED", "Этот урок уже оплачен из абонемента")

    amount = D(amount)
    if amount <= 0:
        due = D(record.charged_amount or 0) - D(record.paid_amount or 0)
        amount = due if due > 0 else D(record.calculated_amount or 0)
    if amount <= 0:
        raise BillingError("INVALID_AMOUNT", "Укажите сумму оплаты")

    # Если урок ещё без начисления — зафиксируем charged_amount
    if D(record.charged_amount or 0) <= 0:
        record.charged_amount = amount
        record.calculated_amount = amount
        record.financial_status = FinancialStatus.AWAITING_PAYMENT
        if not record.finalized_at:
            record.finalized_at = timezone.now()
        record.save(
            update_fields=[
                "charged_amount",
                "calculated_amount",
                "financial_status",
                "finalized_at",
                "updated_at",
            ]
        )

    payment = register_payment(
        teacher=teacher,
        student=record.student,
        amount=amount,
        paid_at=paid_at,
        method=method or "",
        purpose="Оплата урока",
        comment=comment or "Ручная оплата урока",
        event_billing_ids=[str(record.id)],
    )
    record.refresh_from_db()
    return payment


def _refresh_financial_status(record: EventBillingRecord):
    if record.financial_status in (
        FinancialStatus.NOT_BILLABLE,
        FinancialStatus.REFUNDED,
        FinancialStatus.NOT_SPECIFIED,
    ):
        return
    if record.package_id and record.package_units > 0 and D(record.charged_amount) == ZERO:
        record.financial_status = FinancialStatus.PAID_FROM_PACKAGE
    elif D(record.charged_amount) <= ZERO and not record.is_free:
        if record.financial_status == FinancialStatus.NEEDS_DECISION:
            return
        record.financial_status = FinancialStatus.NOT_CHARGED
    elif D(record.paid_amount) <= ZERO:
        record.financial_status = FinancialStatus.AWAITING_PAYMENT
    elif D(record.paid_amount) + Q2 / 2 < D(record.charged_amount):
        record.financial_status = FinancialStatus.PARTIALLY_PAID
    else:
        record.financial_status = FinancialStatus.PAID
    record.save(update_fields=["financial_status", "updated_at"])


def _payment_unallocated_amount(payment: StudentPayment) -> Decimal:
    allocated = payment.allocations.aggregate(t=Sum("amount"))["t"] or ZERO
    left = D(payment.amount) - D(allocated) - D(payment.refunded_amount or 0)
    return left if left > 0 else ZERO


def _allocate_payment_to_record(
    *,
    payment: StudentPayment,
    record: EventBillingRecord,
    amount: Decimal,
) -> Decimal:
    """Привязать часть оплаты учителя к уроку. Урок оплачен только так или из абонемента."""
    amount = D(amount)
    if amount <= 0:
        return ZERO
    due = D(record.charged_amount or 0) - D(record.paid_amount or 0)
    if due <= 0:
        return ZERO
    alloc = min(due, amount)
    existing = StudentPaymentAllocation.objects.filter(
        payment=payment, event_billing=record
    ).first()
    if existing:
        existing.amount = D(existing.amount) + alloc
        existing.save(update_fields=["amount"])
    else:
        StudentPaymentAllocation.objects.create(
            payment=payment, event_billing=record, amount=alloc
        )
    record.paid_amount = D(record.paid_amount or 0) + alloc
    record.save(update_fields=["paid_amount", "updated_at"])
    _refresh_financial_status(record)
    return alloc


def allocate_available_payments_to_record(record: EventBillingRecord) -> Decimal:
    """Закрыть долг по уроку нераспределёнными оплатами учителя (FIFO)."""
    if record.financial_status in (
        FinancialStatus.PAID,
        FinancialStatus.PAID_FROM_PACKAGE,
        FinancialStatus.NOT_BILLABLE,
        FinancialStatus.REFUNDED,
    ):
        return ZERO
    due = D(record.charged_amount or 0) - D(record.paid_amount or 0)
    if due <= 0:
        return ZERO
    applied = ZERO
    payments = (
        StudentPayment.objects.filter(
            billing_account_id=record.billing_account_id,
            status=StudentPaymentStatus.CONFIRMED,
            package__isnull=True,
        )
        .prefetch_related("allocations")
        .order_by("paid_at", "created_at")
    )
    for payment in payments:
        if due <= 0:
            break
        left = _payment_unallocated_amount(payment)
        if left <= 0:
            continue
        used = _allocate_payment_to_record(payment=payment, record=record, amount=min(left, due))
        applied = D(applied + used)
        due = D(due - used)
        record.refresh_from_db()
    return applied


def allocate_payment_to_unpaid_lessons(
    *,
    account: BillingAccount,
    payment: StudentPayment,
    event_billing_ids: Optional[list] = None,
) -> Decimal:
    """Распределить оплату по неоплаченным проведённым урокам."""
    remaining = _payment_unallocated_amount(payment)
    if remaining <= 0:
        return ZERO
    if event_billing_ids:
        found = {
            str(r.pk): r
            for r in EventBillingRecord.objects.select_for_update().filter(
                billing_account=account,
                pk__in=event_billing_ids,
            )
        }
        records = [found[str(i)] for i in event_billing_ids if str(i) in found]
    else:
        records = list(
            EventBillingRecord.objects.select_for_update()
            .filter(
                billing_account=account,
                delivery_status__in=(DeliveryStatus.CONDUCTED, DeliveryStatus.NO_SHOW),
                financial_status__in=(
                    FinancialStatus.AWAITING_PAYMENT,
                    FinancialStatus.PARTIALLY_PAID,
                ),
            )
            .order_by("event__starts_at", "created_at")
        )
    applied = ZERO
    for record in records:
        if remaining <= 0:
            break
        used = _allocate_payment_to_record(payment=payment, record=record, amount=remaining)
        remaining = D(remaining - used)
        applied = D(applied + used)
    return applied


@transaction.atomic
def finalize_event_billing(
    *,
    event: ScheduleEvent,
    teacher: User,
    student: Optional[Student] = None,
    delivery_status: str = DeliveryStatus.CONDUCTED,
    actual_duration_minutes: Optional[int] = None,
    financial_action: str = "charge",
    # charge | package | free | skip | defer | custom
    amount: Optional[Decimal] = None,
    package_id: Optional[str] = None,
    comment: str = "",
    idempotency_key: str = "",
    discount_amount: Decimal = ZERO,
    charge_percent: Optional[Decimal] = None,
) -> list[EventBillingRecord]:
    if event.owner_id != teacher.id:
        raise BillingError("FORBIDDEN", "Нет доступа", 403)

    records = ensure_event_billing_records(event)
    if student:
        records = [r for r in records if r.student_id == student.id]
    if not records:
        raise BillingError("NO_STUDENTS", "Нет учеников для финансового оформления")

    results = []
    for record in records:
        if idempotency_key:
            existing_key = f"{idempotency_key}:{record.student_id}"
            if (
                record.idempotency_key == existing_key
                and record.finalized_at
                and record.financial_status
                not in (FinancialStatus.NEEDS_DECISION, FinancialStatus.NOT_SPECIFIED, FinancialStatus.NOT_CHARGED)
            ):
                results.append(record)
                continue
            # Already charged with same key
            if BillingTransaction.objects.filter(
                event_billing=record,
                metadata__idempotency_key=existing_key,
                is_reversal=False,
            ).exclude(transaction_type=TransactionType.PAYMENT).exists():
                results.append(record)
                continue
        else:
            existing_key = ""

        if (
            record.finalized_at
            and record.financial_status
            in (
                FinancialStatus.PAID,
                FinancialStatus.PAID_FROM_PACKAGE,
                FinancialStatus.AWAITING_PAYMENT,
                FinancialStatus.PARTIALLY_PAID,
                FinancialStatus.NOT_BILLABLE,
            )
            and financial_action != "defer"
        ):
            # Prevent silent double finalize — allow only if explicitly re-processing needs_decision
            if record.financial_status != FinancialStatus.NEEDS_DECISION:
                raise BillingError(
                    "ALREADY_FINALIZED",
                    "Урок уже оформлен финансово. Отмените операцию для исправления.",
                )

        account = record.billing_account
        settings = account.settings
        planned = record.planned_duration_minutes or event_duration_minutes(event)
        actual = actual_duration_minutes if actual_duration_minutes is not None else planned
        record.delivery_status = delivery_status
        record.actual_duration_minutes = actual
        record.comment = comment or record.comment
        if existing_key:
            record.idempotency_key = existing_key

        if financial_action == "defer":
            record.financial_status = FinancialStatus.NEEDS_DECISION
            record.save()
            results.append(record)
            continue

        if financial_action == "skip":
            record.financial_status = FinancialStatus.NOT_BILLABLE
            record.charged_amount = ZERO
            record.is_free = True
            record.finalized_at = timezone.now()
            record.save()
            results.append(record)
            continue

        if financial_action == "free":
            record.is_free = True
            record.is_trial = True
            record.calculated_amount = ZERO
            record.charged_amount = ZERO
            record.financial_status = FinancialStatus.NOT_BILLABLE
            record.price_source = PriceSource.FREE_TRIAL
            record.price_source_label = "Бесплатный / пробный урок"
            record.finalized_at = timezone.now()
            record.save()
            results.append(record)
            continue

        duration_for_calc = actual
        is_group = bool(event.group_id)

        package = resolve_usable_package(
            account, package_id=package_id, settings=settings
        )
        # Списание из абонемента: явный action=package или авто при любом charge, если пакет есть.
        auto_package_charge = (
            financial_action == "charge"
            and amount is None
            and package is not None
        )
        if financial_action == "package" or auto_package_charge:
            if not package:
                # Нет абонемента — урок станет неоплаченным денежным начислением.
                financial_action = "charge"
            else:
                use_duration = (
                    actual
                    if settings.use_actual_duration_for_package
                    else planned
                )
                # Если у абонемента задана длительность — списываем только при совпадении.
                if (
                    package.lesson_duration_minutes
                    and int(package.lesson_duration_minutes) > 0
                    and int(use_duration or 0) > 0
                    and int(package.lesson_duration_minutes) != int(use_duration)
                ):
                    financial_action = "charge"
                else:
                    units = package_units_for_lesson(
                        settings=settings, package=package, duration_minutes=use_duration
                    )
                    consume_package(
                        package=package,
                        units=units,
                        account=account,
                        student=record.student,
                        created_by=teacher,
                        event=event,
                        event_billing=record,
                        comment=comment,
                    )
                    if existing_key:
                        BillingTransaction.objects.filter(
                            event_billing=record,
                            transaction_type=TransactionType.PACKAGE_CONSUMPTION,
                        ).order_by("-created_at").update(
                            metadata={"idempotency_key": existing_key}
                        )
                    package.refresh_from_db()
                    record.package = package
                    record.package_units = units
                    record.billing_type = billing_type_for_package_unit(package.unit_type)
                    record.price_source = PriceSource.PACKAGE
                    record.price_source_label = (
                        f"Списано {units} "
                        f"{'мин' if package.unit_type == PackageUnitType.MINUTE else 'ур.'}; "
                        f"остаток {package.remaining_units}"
                    )
                    # Списание занятия ≠ денежный доход: долг по уроку не создаём.
                    record.calculated_amount = ZERO
                    record.charged_amount = ZERO
                    record.paid_amount = ZERO
                    record.financial_status = FinancialStatus.PAID_FROM_PACKAGE
                    record.finalized_at = timezone.now()
                    record.save()
                    results.append(record)
                    continue

        # Money charge
        if amount is not None:
            price = calculate_lesson_price(
                account=account,
                duration_minutes=duration_for_calc,
                direction=getattr(record.student, "direction", "") or "",
                is_group=is_group,
                override_amount=D(amount),
            )
            record.manual_override = True
        else:
            price = calculate_lesson_price(
                account=account,
                duration_minutes=duration_for_calc,
                direction=getattr(record.student, "direction", "") or "",
                is_group=is_group,
                ignore_package_type=True,
            )

        calc_amount = D(price["amount"])
        if charge_percent is not None:
            calc_amount = D(calc_amount * D(charge_percent) / Decimal("100"))
        calc_amount = D(calc_amount - D(discount_amount))
        if calc_amount < 0:
            calc_amount = ZERO

        # Monthly: included lessons — no separate charge
        if settings.billing_type == BillingType.MONTHLY_FIXED and amount is None:
            period = ensure_monthly_period(account, event.starts_at)
            max_lessons = settings.monthly_max_lessons
            if settings.monthly_includes_all_lessons or (
                max_lessons is None or period.lessons_conducted < max_lessons
            ):
                period.lessons_conducted += 1
                period.save(update_fields=["lessons_conducted"])
                record.calculated_amount = ZERO
                record.charged_amount = ZERO
                record.billing_type = BillingType.MONTHLY_FIXED
                record.price_source = PriceSource.MONTHLY
                record.price_source_label = (
                    f"Включено в месячный тариф ({period.month:02d}.{period.year})"
                )
                record.financial_status = FinancialStatus.NOT_BILLABLE
                record.finalized_at = timezone.now()
                record.save()
                results.append(record)
                continue
            # Extra lesson
            extra = D(settings.monthly_extra_lesson_price or 0)
            calc_amount = extra
            price["price_source"] = PriceSource.MANUAL
            price["price_source_label"] = "Урок сверх лимита месячного тарифа"

        record.rate = price["rate"]
        record.calculated_amount = calc_amount
        record.charged_amount = calc_amount
        record.billing_type = price["billing_type"]
        record.price_source = price["price_source"]
        record.price_source_label = price["price_source_label"]
        record.discount_amount = D(discount_amount)
        record.currency = account.currency

        if calc_amount > 0:
            tx = _append_tx(
                billing_account=account,
                student=record.student,
                transaction_type=TransactionType.CHARGE,
                amount=calc_amount,
                currency=account.currency,
                created_by=teacher,
                event=event,
                event_billing=record,
                comment=comment or "Начисление за урок",
                metadata={"idempotency_key": existing_key} if existing_key else {},
            )
            audit(
                teacher=teacher,
                actor=teacher,
                action="charge",
                billing_account=account,
                entity_type="EventBillingRecord",
                entity_id=str(record.id),
                new_value={"amount": str(calc_amount)},
                related_transaction=tx,
            )

        # Настройки цены / начисление ≠ оплата. Урок оплачен только из абонемента
        # или после распределения реальной оплаты учителя.
        record.finalized_at = timezone.now()
        if calc_amount <= 0:
            record.financial_status = FinancialStatus.AWAITING_PAYMENT
            record.price_source_label = record.price_source_label or "Стоимость не указана"
            record.save()
        else:
            record.financial_status = FinancialStatus.AWAITING_PAYMENT
            record.save()
            allocate_available_payments_to_record(record)

        if record.financial_status == FinancialStatus.AWAITING_PAYMENT and calc_amount > 0:
            try:
                from .teacher_notifications import notify_teacher_unpaid_lesson
                when_label = ""
                if event.starts_at:
                    when_label = timezone.localtime(event.starts_at).strftime("%d.%m, %H:%M")
                notify_teacher_unpaid_lesson(
                    teacher=teacher,
                    student=record.student,
                    when_label=when_label,
                )
                from .student_notifications import notify_student_unpaid_lesson

                notify_student_unpaid_lesson(
                    teacher=teacher,
                    student=record.student,
                    when_label=when_label,
                )
            except Exception:
                pass

        results.append(record)

    if event.status not in (ScheduleEvent.Status.DONE, ScheduleEvent.Status.COMPLETED):
        if delivery_status == DeliveryStatus.CONDUCTED:
            event.status = ScheduleEvent.Status.COMPLETED
            event.save(update_fields=["status", "updated_at"])
        elif delivery_status in (
            DeliveryStatus.CANCELLED_BY_STUDENT,
            DeliveryStatus.CANCELLED_BY_TEACHER,
        ):
            event.status = ScheduleEvent.Status.CANCELLED
            event.save(update_fields=["status", "updated_at"])
        elif delivery_status == DeliveryStatus.RESCHEDULED:
            event.status = ScheduleEvent.Status.MOVED
            event.save(update_fields=["status", "updated_at"])

    return results


@transaction.atomic
def unfinalize_event_billing(
    *,
    event: ScheduleEvent,
    teacher: User,
    comment: str = "",
    reset_event_status: bool = True,
) -> list[EventBillingRecord]:
    """Отмена финансового оформления урока: вернуть занятие в абонемент / снять долг.

    Реальные денежные оплаты (StudentPayment) не удаляются — только сторно
    автоматических списаний/начислений, если оплат по уроку ещё нет.
    """
    if event.owner_id != teacher.id:
        raise BillingError("FORBIDDEN", "Нет доступа", 403)

    records = list(
        EventBillingRecord.objects.select_for_update()
        .filter(event=event, billing_account__teacher=teacher)
    )
    results = []
    for record in records:
        record = EventBillingRecord.objects.select_related(
            "billing_account", "package", "student"
        ).get(pk=record.pk)
        if not record.finalized_at and record.financial_status in (
            FinancialStatus.NOT_SPECIFIED,
            FinancialStatus.NOT_CHARGED,
        ):
            results.append(record)
            continue

        # Уже есть реальные оплаты по уроку — не трогаем без явного подтверждения.
        has_payment = StudentPaymentAllocation.objects.filter(
            event_billing=record,
            payment__status=StudentPaymentStatus.CONFIRMED,
        ).exists()
        if has_payment or D(record.paid_amount) > 0:
            raise BillingError(
                "HAS_PAYMENT",
                "По уроку уже есть оплата. Отмените оплату отдельно, затем статус урока.",
            )

        txs = list(
            BillingTransaction.objects.select_for_update()
            .filter(event_billing=record, is_reversal=False)
            .exclude(transaction_type=TransactionType.PAYMENT)
        )
        for tx in txs:
            if BillingTransaction.objects.filter(reversed_transaction=tx).exists():
                continue
            if tx.transaction_type in (
                TransactionType.PACKAGE_CONSUMPTION,
                TransactionType.CHARGE,
                TransactionType.PACKAGE_RETURN,
            ):
                reverse_transaction(
                    teacher=teacher,
                    tx=tx,
                    comment=comment or "Отмена завершения урока",
                )

        record.package = None
        record.package_units = ZERO
        record.charged_amount = ZERO
        record.paid_amount = ZERO
        record.calculated_amount = ZERO
        record.discount_amount = ZERO
        record.financial_status = FinancialStatus.NOT_CHARGED
        record.delivery_status = DeliveryStatus.PLANNED
        record.finalized_at = None
        record.idempotency_key = ""
        record.price_source_label = ""
        record.save()
        results.append(record)

    if reset_event_status and event.status in (
        ScheduleEvent.Status.COMPLETED,
        ScheduleEvent.Status.DONE,
        ScheduleEvent.Status.CANCELLED,
        ScheduleEvent.Status.MOVED,
    ):
        event.status = ScheduleEvent.Status.PLANNED
        event.save(update_fields=["status", "updated_at"])

    return results


def auto_finalize_after_lesson_complete(
    *,
    event: ScheduleEvent,
    teacher: User,
    delivery_status: str = DeliveryStatus.CONDUCTED,
) -> list[EventBillingRecord]:
    """Автосписание после завершения урока (журнал / complete). Без UI-кнопки."""
    results = []
    records = ensure_event_billing_records(event)
    for record in records:
        if record.finalized_at and record.financial_status in (
            FinancialStatus.PAID,
            FinancialStatus.PAID_FROM_PACKAGE,
            FinancialStatus.AWAITING_PAYMENT,
            FinancialStatus.PARTIALLY_PAID,
            FinancialStatus.NOT_BILLABLE,
        ):
            results.append(record)
            continue
        package = resolve_usable_package(record.billing_account)
        action = "package" if package else "charge"
        try:
            rows = finalize_event_billing(
                event=event,
                teacher=teacher,
                student=record.student,
                delivery_status=delivery_status,
                financial_action=action,
                idempotency_key=f"auto-complete-{event.id}-{record.student_id}",
            )
            results.extend(rows)
        except BillingError as exc:
            if getattr(exc, "code", None) == "ALREADY_FINALIZED":
                results.append(record)
                continue
            raise
    return results


def ensure_monthly_period(account: BillingAccount, when) -> MonthlyBillingPeriod:
    if timezone.is_aware(when):
        local = timezone.localtime(when)
    else:
        local = when
    year, month = local.year, local.month
    settings = account.settings
    period, created = MonthlyBillingPeriod.objects.get_or_create(
        billing_account=account,
        year=year,
        month=month,
        defaults={
            "amount": D(settings.monthly_fee or 0),
            "currency": account.currency,
        },
    )
    if created and period.amount > 0:
        tx = _append_tx(
            billing_account=account,
            student=account.student,
            transaction_type=TransactionType.CHARGE,
            amount=period.amount,
            currency=account.currency,
            comment=f"Месячная оплата {month:02d}.{year}",
            metadata={"monthly_period_id": str(period.id)},
        )
        period.transaction = tx
        period.charged_at = timezone.now()
        period.save(update_fields=["transaction", "charged_at"])
    return period


@transaction.atomic
def register_payment(
    *,
    teacher: User,
    student: Student,
    amount: Decimal,
    paid_at=None,
    method: str = "",
    purpose: str = "",
    comment: str = "",
    package_payload: Optional[dict] = None,
    event_billing_ids: Optional[list] = None,
    status: str = StudentPaymentStatus.CONFIRMED,
) -> StudentPayment:
    account = get_or_create_billing_account(teacher, student)
    amount = D(amount)
    if amount <= 0:
        raise BillingError("INVALID_AMOUNT", "Сумма должна быть больше 0")

    package = None
    package_id = None
    if isinstance(package_payload, dict):
        package_id = package_payload.get("package_id") or package_payload.get("id")
    if package_id:
        package = LessonPackage.objects.filter(
            pk=package_id, billing_account=account
        ).first()
        if not package:
            raise BillingError("NO_PACKAGE", "Абонемент не найден")
    elif package_payload:
        package = create_package(
            teacher=teacher,
            student=student,
            title=package_payload.get("title") or "Абонемент",
            unit_type=package_payload["unit_type"],
            total_units=D_units(package_payload["total_units"]),
            purchase_amount=amount,
            starts_at=package_payload.get("starts_at"),
            expires_at=package_payload.get("expires_at"),
            auto_use=package_payload.get("auto_use", True),
            created_by=teacher,
            create_payment_tx=False,
        )
    elif not event_billing_ids:
        # Оплата без выбранных уроков — привязываем к незакрытому абонементу.
        awaiting = awaiting_payment_packages(account)
        purpose_l = (purpose or "").lower()
        if "абонемент" in purpose_l and len(awaiting) >= 1:
            exact = [pkg for pkg in awaiting if package_amount_due(pkg) == amount]
            package = exact[0] if len(exact) == 1 else awaiting[0]
        elif len(awaiting) == 1:
            package = awaiting[0]
        else:
            exact = [pkg for pkg in awaiting if package_amount_due(pkg) == amount]
            if len(exact) == 1:
                package = exact[0]

    payment = StudentPayment.objects.create(
        billing_account=account,
        student=student,
        amount=amount,
        currency=account.currency,
        paid_at=paid_at or timezone.now(),
        method=method or "",
        purpose=purpose or "",
        comment=comment or "",
        status=status,
        package=package,
        created_by=teacher,
    )

    tx_type = (
        TransactionType.PACKAGE_PURCHASE if package else TransactionType.PAYMENT
    )
    tx = _append_tx(
        billing_account=account,
        student=student,
        transaction_type=tx_type,
        amount=amount,
        currency=account.currency,
        occurred_at=payment.paid_at,
        created_by=teacher,
        student_payment=payment,
        package=package,
        comment=comment or purpose or "Оплата",
    )

    # Оплата учителя закрывает уроки только через allocation, не «по балансу».
    if not package:
        allocate_payment_to_unpaid_lessons(
            account=account,
            payment=payment,
            event_billing_ids=event_billing_ids,
        )

    audit(
        teacher=teacher,
        actor=teacher,
        action="payment",
        billing_account=account,
        entity_type="StudentPayment",
        entity_id=str(payment.id),
        new_value={"amount": str(amount)},
        related_transaction=tx,
        reason=purpose,
    )

    # Notify teacher if prefs allow
    try:
        from .billing_notifications import notify_payment_received

        notify_payment_received(teacher, payment)
    except Exception:
        pass

    return payment


@transaction.atomic
def create_package(
    *,
    teacher: User,
    student: Student,
    title: str,
    unit_type: str,
    total_units: Decimal,
    purchase_amount: Decimal = ZERO,
    starts_at=None,
    expires_at=None,
    auto_use: bool = True,
    created_by: Optional[User] = None,
    create_payment_tx: bool = True,
    bonus_units: Decimal = ZERO,
    notes: str = "",
    lesson_duration_minutes: Optional[int] = None,
) -> LessonPackage:
    account = get_or_create_billing_account(teacher, student)
    total = D_units(total_units) + D_units(bonus_units)
    if total <= 0:
        raise BillingError("INVALID_UNITS", "Количество единиц должно быть больше 0")
    if starts_at and expires_at and expires_at < starts_at:
        raise BillingError("INVALID_DATES", "Дата окончания не может быть раньше даты начала")
    package = LessonPackage.objects.create(
        billing_account=account,
        title=title or "Абонемент",
        unit_type=unit_type,
        total_units=total,
        remaining_units=total,
        purchase_amount=D(purchase_amount),
        lesson_duration_minutes=lesson_duration_minutes or None,
        starts_at=starts_at,
        expires_at=expires_at,
        status=PackageStatus.ACTIVE,
        auto_use=auto_use,
        notes=(notes or "").strip(),
    )
    sync_account_billing_type_for_package(account, package)
    if create_payment_tx and D(purchase_amount) > 0:
        payment = StudentPayment.objects.create(
            billing_account=account,
            student=student,
            amount=D(purchase_amount),
            currency=account.currency,
            paid_at=timezone.now(),
            purpose=f"Абонемент: {package.title}",
            status=StudentPaymentStatus.CONFIRMED,
            package=package,
            created_by=created_by or teacher,
        )
        _append_tx(
            billing_account=account,
            student=student,
            transaction_type=TransactionType.PACKAGE_PURCHASE,
            amount=D(purchase_amount),
            currency=account.currency,
            created_by=created_by or teacher,
            package=package,
            student_payment=payment,
            comment=f"Покупка абонемента: {package.title}",
        )
    audit(
        teacher=teacher,
        actor=created_by or teacher,
        action="package_create",
        billing_account=account,
        entity_type="LessonPackage",
        entity_id=str(package.id),
        new_value={
            "total_units": str(total),
            "unit_type": unit_type,
            "purchase_amount": str(purchase_amount),
        },
    )
    return package


@transaction.atomic
def create_package_and_cover_past(
    *,
    teacher: User,
    student: Student,
    cover_past_unpaid: bool = False,
    event_billing_ids: Optional[list] = None,
    created_by: Optional[User] = None,
    **package_kwargs,
) -> dict:
    """
    Создать абонемент и опционально задним числом покрыть неоплаченные уроки.
    cover_past_unpaid=True без event_billing_ids → select_earliest по остатку.
    """
    package = create_package(
        teacher=teacher,
        student=student,
        created_by=created_by or teacher,
        **package_kwargs,
    )
    covered = None
    if cover_past_unpaid:
        account = package.billing_account
        try:
            covered = charge_multiple_lessons_from_package(
                teacher=teacher,
                account=account,
                package=package,
                event_billing_ids=event_billing_ids,
                select_earliest=not bool(event_billing_ids),
                comment="Покрытие прошлых уроков новым абонементом",
            )
        except BillingError as exc:
            if exc.code == "NOTHING_TO_CHARGE":
                covered = {
                    "charged_count": 0,
                    "remaining_units": package.remaining_units,
                    "package": package,
                    "results": [],
                    "message": "Неоплаченных уроков для покрытия нет",
                }
            else:
                raise
        package.refresh_from_db()
    return {
        "package": package,
        "covered": covered,
        "covered_count": (covered or {}).get("charged_count") or 0,
    }


@transaction.atomic
def reverse_transaction(
    *,
    teacher: User,
    tx: BillingTransaction,
    comment: str = "",
    restore_awaiting_payment: bool = False,
    restore_charge_amount: Optional[Decimal] = None,
) -> BillingTransaction:
    if tx.billing_account.teacher_id != teacher.id:
        raise BillingError("FORBIDDEN", "Нет доступа", 403)
    if tx.is_reversal:
        raise BillingError("ALREADY_REVERSAL", "Нельзя отменить отмену")
    if BillingTransaction.objects.filter(reversed_transaction=tx).exists():
        raise BillingError("ALREADY_REVERSED", "Операция уже была выполнена")

    # Reverse package units
    if tx.package_id and tx.package_units:
        locked = LessonPackage.objects.select_for_update().get(pk=tx.package_id)
        if tx.transaction_type == TransactionType.PACKAGE_CONSUMPTION:
            locked.remaining_units = D_units(locked.remaining_units + tx.package_units)
            if locked.status == PackageStatus.EXHAUSTED and locked.remaining_units > 0:
                locked.status = PackageStatus.ACTIVE
            locked.save(update_fields=["remaining_units", "status", "updated_at"])
        elif tx.transaction_type == TransactionType.PACKAGE_RETURN:
            locked.remaining_units = D_units(locked.remaining_units - tx.package_units)
            locked.save(update_fields=["remaining_units", "updated_at"])

    reverse_amount = tx.amount
    # For charges, reversal is negative charge effect via adjustment of opposite sign in journal:
    # We store reversal with negated amount for money types.
    if tx.transaction_type in (
        TransactionType.PAYMENT,
        TransactionType.PACKAGE_PURCHASE,
        TransactionType.CHARGE,
        TransactionType.REFUND,
        TransactionType.ADJUSTMENT,
        TransactionType.DISCOUNT,
        TransactionType.WRITE_OFF,
    ):
        reverse_amount = D(-tx.amount)

    rev = _append_tx(
        billing_account=tx.billing_account,
        student=tx.student,
        transaction_type=tx.transaction_type,
        amount=reverse_amount,
        package_units=D_units(-tx.package_units) if tx.package_units else ZERO,
        currency=tx.currency,
        created_by=teacher,
        event=tx.event,
        event_billing=tx.event_billing,
        package=tx.package,
        student_payment=tx.student_payment,
        comment=comment or f"Отмена операции {tx.id}",
        reversed_transaction=tx,
        is_reversal=True,
        metadata={"reverses": str(tx.id)},
    )
    if tx.event_billing_id:
        record = EventBillingRecord.objects.select_for_update().get(pk=tx.event_billing_id)
        if tx.transaction_type == TransactionType.CHARGE:
            record.charged_amount = D(max(ZERO, record.charged_amount - tx.amount))
        if tx.transaction_type == TransactionType.PACKAGE_CONSUMPTION:
            record.package_units = ZERO
            record.package = None
            if restore_awaiting_payment:
                restored = D(restore_charge_amount or 0)
                if restored > 0:
                    record.charged_amount = restored
                    record.calculated_amount = restored
                    _append_tx(
                        billing_account=record.billing_account,
                        student=record.student,
                        transaction_type=TransactionType.CHARGE,
                        amount=restored,
                        currency=record.currency or record.billing_account.currency,
                        created_by=teacher,
                        event=record.event,
                        event_billing=record,
                        comment=comment or "Восстановление начисления после отмены списания",
                        metadata={"restored_after_package_refund": str(tx.id)},
                    )
                record.financial_status = FinancialStatus.AWAITING_PAYMENT
                record.price_source = PriceSource.MANUAL if restored > 0 else record.price_source
                record.price_source_label = (
                    "Ожидает оплаты (списание из абонемента отменено)"
                )
                record.finalized_at = record.finalized_at or timezone.now()
                record.save()
            else:
                record.finalized_at = None
                record.financial_status = FinancialStatus.NEEDS_DECISION
                record.save()
        else:
            record.finalized_at = None
            record.financial_status = FinancialStatus.NEEDS_DECISION
            record.save()
    audit(
        teacher=teacher,
        actor=teacher,
        action="reverse",
        billing_account=tx.billing_account,
        entity_type="BillingTransaction",
        entity_id=str(tx.id),
        related_transaction=rev,
        reason=comment,
    )
    return rev


@transaction.atomic
def create_refund(
    *,
    teacher: User,
    student: Student,
    amount: Decimal,
    comment: str = "",
    payment_id: Optional[str] = None,
) -> BillingTransaction:
    account = get_or_create_billing_account(teacher, student)
    amount = D(amount)
    if amount <= 0:
        raise BillingError("INVALID_AMOUNT", "Сумма возврата должна быть больше 0")
    payment = None
    if payment_id:
        payment = StudentPayment.objects.filter(pk=payment_id, billing_account=account).first()
        if payment:
            payment.refunded_amount = D(payment.refunded_amount + amount)
            if payment.refunded_amount >= payment.amount:
                payment.status = StudentPaymentStatus.REFUNDED
            else:
                payment.status = StudentPaymentStatus.PARTIALLY_REFUNDED
            payment.save(update_fields=["refunded_amount", "status", "updated_at"])
    return _append_tx(
        billing_account=account,
        student=student,
        transaction_type=TransactionType.REFUND,
        amount=amount,
        currency=account.currency,
        created_by=teacher,
        student_payment=payment,
        comment=comment or "Возврат",
    )


@transaction.atomic
def create_adjustment(
    *,
    teacher: User,
    student: Student,
    amount: Decimal,
    comment: str = "",
) -> BillingTransaction:
    """amount > 0 увеличивает баланс (кредит), < 0 уменьшает."""
    account = get_or_create_billing_account(teacher, student)
    return _append_tx(
        billing_account=account,
        student=student,
        transaction_type=TransactionType.ADJUSTMENT,
        amount=D(amount),
        currency=account.currency,
        created_by=teacher,
        comment=comment or "Ручная корректировка",
    )


@transaction.atomic
def adjust_package(
    *,
    teacher: User,
    package: LessonPackage,
    units_delta: Decimal,
    comment: str = "",
) -> LessonPackage:
    if package.billing_account.teacher_id != teacher.id:
        raise BillingError("FORBIDDEN", "Нет доступа", 403)
    locked = LessonPackage.objects.select_for_update().get(pk=package.pk)
    delta = D_units(units_delta)
    locked.remaining_units = D_units(locked.remaining_units + delta)
    locked.total_units = D_units(locked.total_units + max(delta, ZERO))
    if locked.remaining_units <= 0:
        locked.remaining_units = ZERO
        locked.status = PackageStatus.EXHAUSTED
    elif locked.status == PackageStatus.EXHAUSTED:
        locked.status = PackageStatus.ACTIVE
    locked.save()
    tx_type = (
        TransactionType.PACKAGE_RETURN if delta > 0 else TransactionType.PACKAGE_CONSUMPTION
    )
    _append_tx(
        billing_account=locked.billing_account,
        student=locked.billing_account.student,
        transaction_type=tx_type,
        package_units=abs(delta),
        currency=locked.billing_account.currency,
        created_by=teacher,
        package=locked,
        comment=comment or "Корректировка абонемента",
    )
    return locked


def freeze_package(teacher: User, package: LessonPackage) -> LessonPackage:
    if package.billing_account.teacher_id != teacher.id:
        raise BillingError("FORBIDDEN", "Нет доступа", 403)
    package.status = PackageStatus.FROZEN
    package.save(update_fields=["status", "updated_at"])
    return package


def unfreeze_package(teacher: User, package: LessonPackage) -> LessonPackage:
    if package.billing_account.teacher_id != teacher.id:
        raise BillingError("FORBIDDEN", "Нет доступа", 403)
    if package.remaining_units <= 0:
        package.status = PackageStatus.EXHAUSTED
    else:
        package.status = PackageStatus.ACTIVE
    package.save(update_fields=["status", "updated_at"])
    return package


def extend_package(
    teacher: User, package: LessonPackage, expires_at, comment: str = ""
) -> LessonPackage:
    if package.billing_account.teacher_id != teacher.id:
        raise BillingError("FORBIDDEN", "Нет доступа", 403)
    old = package.expires_at.isoformat() if package.expires_at else None
    package.expires_at = expires_at
    if package.status == PackageStatus.EXPIRED and package.remaining_units > 0:
        package.status = PackageStatus.ACTIVE
    package.save(update_fields=["expires_at", "status", "updated_at"])
    audit(
        teacher=teacher,
        actor=teacher,
        action="package_extend",
        billing_account=package.billing_account,
        entity_type="LessonPackage",
        entity_id=str(package.id),
        old_value={"expires_at": old},
        new_value={"expires_at": expires_at.isoformat() if expires_at else None},
        reason=comment,
    )
    return package


@transaction.atomic
def cancel_package(
    teacher: User, package: LessonPackage, comment: str = ""
) -> LessonPackage:
    """Удалить (отменить) абонемент: больше не используется для списаний."""
    if package.billing_account.teacher_id != teacher.id:
        raise BillingError("FORBIDDEN", "Нет доступа", 403)
    if package.status == PackageStatus.CANCELLED:
        return package
    old_status = package.status
    package.status = PackageStatus.CANCELLED
    package.save(update_fields=["status", "updated_at"])
    account = package.billing_account
    if not active_package_for_account(account):
        settings = account.settings
        if settings.billing_type in (
            BillingType.PACKAGE_LESSONS,
            BillingType.PACKAGE_MINUTES,
        ):
            settings.billing_type = BillingType.PER_LESSON
            settings.save(update_fields=["billing_type", "updated_at"])
    audit(
        teacher=teacher,
        actor=teacher,
        action="package_cancel",
        billing_account=account,
        entity_type="LessonPackage",
        entity_id=str(package.id),
        old_value={"status": old_status},
        new_value={"status": PackageStatus.CANCELLED},
        reason=comment,
    )
    return package


def preview_finalize(event: ScheduleEvent, teacher: User, student: Optional[Student] = None) -> list[dict]:
    records = ensure_event_billing_records(event)
    if student:
        records = [r for r in records if r.student_id == student.id]
    out = []
    for record in records:
        account = record.billing_account
        settings = account.settings
        duration = record.actual_duration_minutes or record.planned_duration_minutes
        price = calculate_lesson_price(
            account=account,
            duration_minutes=duration,
            direction=getattr(record.student, "direction", "") or "",
            is_group=bool(event.group_id),
        )
        package = resolve_usable_package(account, settings=settings)
        units = None
        remaining_after = None
        if package:
            units = package_units_for_lesson(
                settings=settings, package=package, duration_minutes=duration
            )
            remaining_after = D_units(package.remaining_units - units)
        use_package = bool(package)
        out.append(
            {
                "record_id": str(record.id),
                "student_id": record.student_id,
                "student_name": record.student.full_name,
                "duration_minutes": duration,
                "planned_duration_minutes": record.planned_duration_minutes,
                "amount": str(price["amount"]),
                "currency": price["currency"],
                "price_source": price["price_source"],
                "price_source_label": price["price_source_label"],
                "billing_type": settings.billing_type,
                "financial_status": record.financial_status,
                "suggested_action": "package" if use_package else "charge",
                "package": (
                    {
                        "id": str(package.id),
                        "title": package.title,
                        "remaining_units": str(package.remaining_units),
                        "unit_type": package.unit_type,
                        "units_to_consume": str(units),
                        "remaining_after": str(remaining_after),
                    }
                    if package
                    else None
                ),
            }
        )
    return out


_SCHEME_LABELS = {
    BillingType.PER_LESSON: "Разово за урок",
    BillingType.PER_MINUTE: "За минуту",
    BillingType.PER_HOUR: "Почасовая",
    BillingType.PACKAGE_LESSONS: "Абонемент",
    BillingType.PACKAGE_MINUTES: "Абонемент (минуты)",
    BillingType.MONTHLY_FIXED: "Фикс за месяц",
    BillingType.MANUAL: "Вручную",
}


def _scheme_label(settings, package=None) -> str:
    if package and settings.billing_type in (
        BillingType.PACKAGE_LESSONS,
        BillingType.PACKAGE_MINUTES,
        BillingType.PER_LESSON,
        BillingType.MANUAL,
    ):
        if settings.billing_type in (BillingType.PACKAGE_LESSONS, BillingType.PACKAGE_MINUTES):
            return _SCHEME_LABELS.get(settings.billing_type, "Абонемент")
        return "Абонемент / разово"
    return _SCHEME_LABELS.get(settings.billing_type, settings.get_billing_type_display())


def build_account_ui_meta(
    *,
    has_tariff: bool,
    needs_decision: bool,
    unpaid_count: int,
    unpaid_amount: Decimal,
    balance: dict,
    package,
    settings,
    credit: Decimal,
) -> dict:
    """Статус и ближайшие действия для UI списка/карточки ученика."""
    debt = D(unpaid_amount) if unpaid_amount > 0 else D(balance.get("debt") or 0)
    low_pkg = False
    if package:
        thr_l = D_units(settings.low_balance_threshold_lessons or 2)
        thr_m = D_units(settings.low_balance_threshold_minutes or 120)
        if package.unit_type == PackageUnitType.LESSON and package.remaining_units <= thr_l:
            low_pkg = True
        elif package.unit_type == PackageUnitType.MINUTE and package.remaining_units <= thr_m:
            low_pkg = True

    suggested: list[str] = []

    if not has_tariff and unpaid_count <= 0 and debt <= 0:
        return {
            "status_kind": "not_configured",
            "status_mod": "muted",
            "headline": "Не настроено",
            "detail": "Условия оплаты не заданы",
            "primary_action": "setup",
            "primary_label": "Настроить условия",
            "suggested_actions": ["setup", "payment", "package"],
        }

    if needs_decision or (not has_tariff and unpaid_count > 0):
        return {
            "status_kind": "needs_decision",
            "status_mod": "warn",
            "headline": "Есть проведённые уроки без схемы оплаты",
            "detail": f"Неоплаченных уроков: {unpaid_count}" if unpaid_count else "Требуется оформление",
            "primary_action": "setup",
            "primary_label": "Настроить условия",
            "suggested_actions": ["setup", "payment", "package", "open"],
        }

    if debt > 0 or unpaid_count > 0:
        money = f"{debt:,.0f}".replace(",", "\u00a0") if debt == int(debt) else str(debt)
        if unpaid_count:
            mod10, mod100 = unpaid_count % 10, unpaid_count % 100
            if mod10 == 1 and mod100 != 11:
                lessons_word = f"{unpaid_count} урок"
            elif 2 <= mod10 <= 4 and not (12 <= mod100 <= 14):
                lessons_word = f"{unpaid_count} урока"
            else:
                lessons_word = f"{unpaid_count} уроков"
            headline = f"Долг {money} ₽ · {lessons_word}"
        else:
            headline = f"Долг {money} ₽"
        suggested = ["payment"]
        if package and D_units(package.remaining_units) > 0:
            suggested.append("charge_package")
        suggested.extend(["package", "open"])
        return {
            "status_kind": "debt",
            "status_mod": "alert",
            "headline": headline,
            "detail": "Есть проведённые неоплаченные уроки",
            "primary_action": "payment",
            "primary_label": "Добавить оплату",
            "suggested_actions": suggested,
        }

    if low_pkg and package:
        rem = package.remaining_units
        return {
            "status_kind": "ending",
            "status_mod": "warn",
            "headline": f"Абонемент заканчивается · осталось {rem}",
            "detail": "Стоит продлить или создать новый",
            "primary_action": "package",
            "primary_label": "Продлить абонемент",
            "suggested_actions": ["package", "payment", "open"],
        }

    if package:
        rem = package.remaining_units
        unit = "занятий" if package.unit_type != PackageUnitType.MINUTE else "мин"
        return {
            "status_kind": "package_ok",
            "status_mod": "ok",
            "headline": f"Осталось {rem} {unit}",
            "detail": "Активный абонемент",
            "primary_action": "open",
            "primary_label": "Открыть",
            "suggested_actions": ["open", "payment", "package"],
        }

    if credit > 0:
        money = f"{credit:,.0f}".replace(",", " ") if credit == int(credit) else f"{credit}"
        return {
            "status_kind": "prepaid",
            "status_mod": "ok",
            "headline": f"Разовая оплата: урок оплачен заранее",
            "detail": f"Аванс {money} ₽",
            "primary_action": "open",
            "primary_label": "Открыть",
            "suggested_actions": ["open", "payment", "package"],
        }

    if has_tariff:
        return {
            "status_kind": "configured",
            "status_mod": "muted",
            "headline": "Условия заданы",
            "detail": "Долгов нет",
            "primary_action": "open",
            "primary_label": "Открыть",
            "suggested_actions": ["open", "payment", "package"],
        }

    return {
        "status_kind": "ok",
        "status_mod": "ok",
        "headline": "Всё оплачено",
        "detail": "",
        "primary_action": "open",
        "primary_label": "Открыть",
        "suggested_actions": ["open", "payment"],
    }


def serialize_account(account: BillingAccount, *, include_history: bool = False) -> dict:
    reconcile_package_payments(account)
    settings = account.settings
    balance = compute_account_balance(account)
    package = active_package_for_account(account)
    package_data = (
        serialize_package(package, include_history=False, reconcile=False)
        if package
        else None
    )
    next_event = (
        ScheduleEvent.objects.filter(
            owner=account.teacher,
            starts_at__gte=timezone.now(),
            status=ScheduleEvent.Status.PLANNED,
        )
        .filter(Q(student=account.student) | Q(group__students=account.student))
        .order_by("starts_at")
        .first()
    )
    has_tariff = bool(
        package
        or settings.default_lesson_price is not None
        or settings.hourly_rate is not None
        or settings.per_minute_rate is not None
        or settings.monthly_fee is not None
    )
    unpaid_qs = EventBillingRecord.objects.filter(
        billing_account=account,
        delivery_status__in=(DeliveryStatus.CONDUCTED, DeliveryStatus.NO_SHOW),
        financial_status__in=(
            FinancialStatus.AWAITING_PAYMENT,
            FinancialStatus.PARTIALLY_PAID,
            FinancialStatus.NEEDS_DECISION,
        ),
    ).select_related("event")
    unpaid_count = unpaid_qs.count()
    unpaid_amount = ZERO
    unpaid_items = []
    for rec in unpaid_qs.order_by("-event__starts_at")[:50]:
        due = D(rec.charged_amount or 0) - D(rec.paid_amount or 0)
        if due <= 0:
            due = D(rec.calculated_amount or 0) if rec.financial_status == FinancialStatus.NEEDS_DECISION else ZERO
        unpaid_amount += due
        unpaid_items.append({
            **serialize_event_billing(rec),
            "due_amount": str(due),
            "price_missing": due <= 0 and D(rec.charged_amount or 0) <= 0,
            "unpaid_reason": unpaid_reason_for_record(rec),
            "can_charge_from_package": True,
        })

    available_packages = [
        {
            "id": str(p.id),
            "title": p.title,
            "remaining_units": str(p.remaining_units),
            "total_units": str(p.total_units),
            "unit_type": p.unit_type,
            "is_paid": package_amount_due(p) <= 0,
            "paid_amount": str(package_confirmed_paid_amount(p)),
            "purchase_amount": str(p.purchase_amount),
            "starts_at": p.starts_at.isoformat() if p.starts_at else None,
            "expires_at": p.expires_at.isoformat() if p.expires_at else None,
            "status": p.status,
            "display_status": package_display_status(p)[0],
            "display_status_label": package_display_status(p)[1],
            "created_at": p.created_at.isoformat() if p.created_at else None,
        }
        for p in find_available_packages_for_charge(account)
    ]

    used_units_total = ZERO
    remaining_units_total = ZERO
    for pkg in LessonPackage.objects.filter(
        billing_account=account,
        status__in=(PackageStatus.ACTIVE, PackageStatus.FROZEN, PackageStatus.EXHAUSTED),
    ):
        used_units_total += D_units(pkg.total_units - pkg.remaining_units)
        if pkg.status == PackageStatus.ACTIVE:
            remaining_units_total += D_units(pkg.remaining_units)

    last_payment = (
        StudentPayment.objects.filter(
            billing_account=account,
            status=StudentPaymentStatus.CONFIRMED,
        )
        .order_by("-paid_at")
        .first()
    )

    needs = EventBillingRecord.objects.filter(
        billing_account=account,
        financial_status=FinancialStatus.NEEDS_DECISION,
    ).exists()
    # Настройки тарифа ≠ «всё оплачено». Оплаченность — по урокам/абонементу.
    if not has_tariff:
        status_label = "оплата не настроена"
    elif needs:
        status_label = "требуется оформление"
    elif unpaid_count > 0 or unpaid_amount > 0 or balance["debt"] > 0:
        status_label = "есть задолженность"
    elif package and (
        (
            package.unit_type == PackageUnitType.LESSON
            and package.remaining_units
            <= D_units(settings.low_balance_threshold_lessons or 2)
        )
        or (
            package.unit_type == PackageUnitType.MINUTE
            and package.remaining_units
            <= D_units(settings.low_balance_threshold_minutes or 120)
        )
    ):
        status_label = "заканчивается абонемент"
    elif package or EventBillingRecord.objects.filter(
        billing_account=account,
        financial_status__in=(
            FinancialStatus.PAID,
            FinancialStatus.PAID_FROM_PACKAGE,
        ),
    ).exists():
        status_label = "всё оплачено"
    else:
        status_label = "условия заданы"

    credit = D(balance.get("credit") or 0)
    ui = build_account_ui_meta(
        has_tariff=has_tariff,
        needs_decision=needs,
        unpaid_count=unpaid_count,
        unpaid_amount=D(unpaid_amount),
        balance=balance,
        package=package,
        settings=settings,
        credit=credit,
    )
    scheme_label = _scheme_label(settings, package)

    packages_qs = LessonPackage.objects.filter(
        billing_account=account,
    ).exclude(status=PackageStatus.CANCELLED).order_by("-created_at")[:20]
    packages_list = [
        serialize_package(p, include_history=False, reconcile=False) for p in packages_qs
    ]

    data = {
        "id": account.id,
        "student_id": account.student_id,
        "student_name": account.student.full_name,
        "payer_name": account.payer_name,
        "payer_phone": account.payer_phone,
        "payer_email": account.payer_email,
        "payer_user_id": account.payer_user_id,
        "currency": account.currency,
        "notes": account.notes,
        "is_active": account.is_active,
        "student_billing_notifications": account.student_billing_notifications,
        "billing_type": settings.billing_type,
        "scheme_label": scheme_label,
        "status_kind": ui["status_kind"],
        "status_mod": ui["status_mod"],
        "headline": ui["headline"],
        "status_detail": ui["detail"],
        "primary_action": ui["primary_action"],
        "primary_label": ui["primary_label"],
        "suggested_actions": ui["suggested_actions"],
        "debt_amount": str(D(unpaid_amount) if unpaid_amount > 0 else balance["debt"]),
        "credit_amount": str(credit),
        "packages": packages_list,
        "packages_summary": {
            "active_count": sum(1 for p in packages_list if p.get("status") == PackageStatus.ACTIVE),
            "ending_count": sum(1 for p in packages_list if p.get("display_status") == "ending"),
        },
        "default_lesson_price": (
            str(settings.default_lesson_price) if settings.default_lesson_price is not None else None
        ),
        "hourly_rate": str(settings.hourly_rate) if settings.hourly_rate is not None else None,
        "per_minute_rate": (
            str(settings.per_minute_rate) if settings.per_minute_rate is not None else None
        ),
        "monthly_fee": str(settings.monthly_fee) if settings.monthly_fee is not None else None,
        "settings": {
            "billing_type": settings.billing_type,
            "default_lesson_duration_minutes": settings.default_lesson_duration_minutes,
            "default_lesson_price": (
                str(settings.default_lesson_price)
                if settings.default_lesson_price is not None
                else None
            ),
            "hourly_rate": str(settings.hourly_rate) if settings.hourly_rate is not None else None,
            "per_minute_rate": (
                str(settings.per_minute_rate) if settings.per_minute_rate is not None else None
            ),
            "monthly_fee": str(settings.monthly_fee) if settings.monthly_fee is not None else None,
            "monthly_charge_day": settings.monthly_charge_day,
            "monthly_includes_all_lessons": settings.monthly_includes_all_lessons,
            "monthly_max_lessons": settings.monthly_max_lessons,
            "monthly_extra_lesson_price": (
                str(settings.monthly_extra_lesson_price)
                if settings.monthly_extra_lesson_price is not None
                else None
            ),
            "subject_prices": settings.subject_prices,
            "group_lesson_price": (
                str(settings.group_lesson_price)
                if settings.group_lesson_price is not None
                else None
            ),
            "duration_lesson_coefficients": settings.duration_lesson_coefficients,
            "charge_late_cancellation": settings.charge_late_cancellation,
            "charge_no_show": settings.charge_no_show,
            "low_balance_threshold_lessons": settings.low_balance_threshold_lessons,
            "low_balance_threshold_minutes": settings.low_balance_threshold_minutes,
            "use_actual_duration_for_package": settings.use_actual_duration_for_package,
        },
        "balance": {k: str(v) if isinstance(v, Decimal) else v for k, v in balance.items()},
        "package": (
            {
                k: package_data[k] for k in (
                    "id", "title", "unit_type", "remaining_units", "total_units",
                    "purchase_amount", "paid_amount", "unit_price", "is_paid",
                    "expires_at", "starts_at", "status", "display_status",
                    "display_status_label", "lesson_duration_minutes",
                )
            }
            if package_data
            else None
        ),
        "next_lesson_at": next_event.starts_at.isoformat() if next_event else None,
        "status_label": status_label,
        "unpaid_lessons_count": unpaid_count,
        "unpaid_lessons_amount": str(D(unpaid_amount)),
        "unpaid_lessons": unpaid_items,
        "available_packages": available_packages,
        "summary": {
            "available_units": str(remaining_units_total),
            "used_units": str(used_units_total),
            "unpaid_completed_lessons": unpaid_count,
            "debt_amount": str(D(unpaid_amount) if unpaid_amount > 0 else balance["debt"]),
            "active_packages_count": len(available_packages),
            "last_payment_at": (
                last_payment.paid_at.isoformat() if last_payment and last_payment.paid_at else None
            ),
            "last_payment_amount": str(last_payment.amount) if last_payment else None,
        },
    }
    if include_history:
        from django.db.models import Exists, OuterRef

        reversed_exists = Exists(
            BillingTransaction.objects.filter(reversed_transaction_id=OuterRef("pk"))
        )
        txs = (
            BillingTransaction.objects.filter(billing_account=account, is_reversal=False)
            .select_related("student", "created_by", "package", "event")
            .annotate(_is_reversed=reversed_exists)
            .order_by("-occurred_at")[:50]
        )
        data["recent_transactions"] = [serialize_transaction(t) for t in txs]
        if package:
            data["package_history"] = [
                serialize_transaction(t)
                for t in txs
                if t.package_id == package.id
                and t.transaction_type
                in (
                    TransactionType.PACKAGE_CONSUMPTION,
                    TransactionType.PACKAGE_RETURN,
                )
            ]
        else:
            data["package_history"] = []
    return data


def serialize_transaction(tx: BillingTransaction) -> dict:
    is_reversed = getattr(tx, "_is_reversed", None)
    if is_reversed is None:
        is_reversed = tx.reversals.exists()
    unit_type = ""
    if tx.package_id and getattr(tx, "package", None):
        unit_type = tx.package.unit_type or ""
    event_starts = None
    event_title = ""
    if tx.event_id and getattr(tx, "event", None):
        event_title = tx.event.title or ""
        if tx.event.starts_at:
            event_starts = tx.event.starts_at.isoformat()
    return {
        "id": str(tx.id),
        "billing_account_id": tx.billing_account_id,
        "student_id": tx.student_id,
        "student_name": tx.student.full_name if tx.student_id else "",
        "event_id": tx.event_id,
        "event_title": event_title,
        "event_starts_at": event_starts,
        "package_id": str(tx.package_id) if tx.package_id else None,
        "unit_type": unit_type,
        "transaction_type": tx.transaction_type,
        "transaction_type_label": tx.get_transaction_type_display(),
        "amount": str(tx.amount),
        "package_units": str(tx.package_units),
        "currency": tx.currency,
        "occurred_at": tx.occurred_at.isoformat() if tx.occurred_at else None,
        "comment": tx.comment,
        "created_by_id": tx.created_by_id,
        "created_by_name": (
            tx.created_by.get_full_name() or tx.created_by.username
            if tx.created_by_id
            else ""
        ),
        "is_reversal": tx.is_reversal,
        "is_reversed": bool(is_reversed),
        "reversed_transaction_id": (
            str(tx.reversed_transaction_id) if tx.reversed_transaction_id else None
        ),
        "is_legacy": bool(getattr(tx, "is_legacy", False)),
        "metadata": tx.metadata or {},
        "created_at": tx.created_at.isoformat() if tx.created_at else None,
    }


def package_display_status(package: LessonPackage) -> tuple[str, str]:
    """Return (code, label) for tutor-facing package status."""
    today = timezone.localdate()
    paid = package_confirmed_paid_amount(package)
    purchase = D(package.purchase_amount or 0)
    if package.status == PackageStatus.CANCELLED:
        return "cancelled", "Отменён"
    if package.status == PackageStatus.EXPIRED or (
        package.expires_at and package.expires_at < today
    ):
        return "expired", "Истёк"
    if package.status == PackageStatus.EXHAUSTED or D_units(package.remaining_units) <= 0:
        return "completed", "Завершён"
    if purchase > 0 and D(paid) <= 0:
        return "awaiting_payment", "Ожидает оплаты"
    if purchase > 0 and D(paid) < purchase:
        return "partially_paid", "Оплачен частично"
    if package.status == PackageStatus.FROZEN:
        return "frozen", "Заморожен"
    thr = 2 if package.unit_type == PackageUnitType.LESSON else 120
    if D_units(package.remaining_units) <= thr:
        return "ending", "Заканчивается"
    return "active", "Активен"


def serialize_package(
    package: LessonPackage,
    *,
    include_history: bool = True,
    reconcile: bool = True,
) -> dict:
    if reconcile:
        reconcile_package_payments(package.billing_account)
        package.refresh_from_db()
    used = D_units(package.total_units - package.remaining_units)
    paid = package_confirmed_paid_amount(package)
    display_code, display_label = package_display_status(package)
    per_unit = ZERO
    if D_units(package.total_units) > 0 and D(package.purchase_amount) > 0:
        per_unit = (D(package.purchase_amount) / D_units(package.total_units)).quantize(Decimal("0.01"))
    data = {
        "id": str(package.id),
        "billing_account_id": package.billing_account_id,
        "student_id": package.billing_account.student_id,
        "student_name": package.billing_account.student.full_name,
        "title": package.title,
        "unit_type": package.unit_type,
        "total_units": str(package.total_units),
        "remaining_units": str(package.remaining_units),
        "used_units": str(used),
        "purchase_amount": str(package.purchase_amount),
        "paid_amount": str(D(paid)),
        "unit_price": str(per_unit),
        "is_paid": D(paid) >= D(package.purchase_amount or 0) if D(package.purchase_amount or 0) > 0 else True,
        "starts_at": package.starts_at.isoformat() if package.starts_at else None,
        "expires_at": package.expires_at.isoformat() if package.expires_at else None,
        "status": package.status,
        "status_label": package.get_status_display(),
        "display_status": display_code,
        "display_status_label": display_label,
        "lesson_duration_minutes": package.lesson_duration_minutes,
        "auto_use": package.auto_use,
        "notes": package.notes,
        "created_at": package.created_at.isoformat() if package.created_at else None,
    }
    if include_history:
        txs = (
            BillingTransaction.objects.filter(
                package=package,
                transaction_type__in=(
                    TransactionType.PACKAGE_CONSUMPTION,
                    TransactionType.PACKAGE_RETURN,
                ),
                is_reversal=False,
            )
            .select_related("student", "created_by", "package", "event")
            .order_by("-occurred_at")[:30]
        )
        data["history"] = [serialize_transaction(t) for t in txs]
    return data


def serialize_event_billing(record: EventBillingRecord) -> dict:
    due = D(record.charged_amount or 0) - D(record.paid_amount or 0)
    if due < 0:
        due = ZERO
    return {
        "id": str(record.id),
        "event_id": record.event_id,
        "student_id": record.student_id,
        "student_name": record.student.full_name,
        "delivery_status": record.delivery_status,
        "financial_status": record.financial_status,
        "financial_status_label": (
            "Не оплачен (в долг)"
            if record.financial_status == FinancialStatus.AWAITING_PAYMENT
            else (
                "Частично оплачен"
                if record.financial_status == FinancialStatus.PARTIALLY_PAID
                else record.get_financial_status_display()
            )
        ),
        "billing_type": record.billing_type,
        "planned_duration_minutes": record.planned_duration_minutes,
        "actual_duration_minutes": record.actual_duration_minutes,
        "duration_minutes": record.actual_duration_minutes or record.planned_duration_minutes,
        "rate": str(record.rate),
        "calculated_amount": str(record.calculated_amount),
        "charged_amount": str(record.charged_amount),
        "paid_amount": str(record.paid_amount),
        "due_amount": str(due),
        "price_missing": due <= 0 and D(record.charged_amount or 0) <= 0
        and record.financial_status == FinancialStatus.AWAITING_PAYMENT,
        "currency": record.currency,
        "price_source": record.price_source,
        "price_source_label": record.price_source_label,
        "package_id": str(record.package_id) if record.package_id else None,
        "package_units": str(record.package_units),
        "is_free": record.is_free,
        "manual_override": record.manual_override,
        "comment": record.comment,
        "event_title": record.event.title if record.event_id else "",
        "event_starts_at": (
            record.event.starts_at.isoformat() if record.event_id else None
        ),
        "unpaid_reason": unpaid_reason_for_record(record),
        "can_charge_from_package": record.financial_status in UNPAID_FINANCIAL_STATUSES
        and record.delivery_status in CHARGEABLE_DELIVERY_STATUSES,
    }


def _month_bounds(year=None, month=None):
    """Return (month_start, month_end, label) in teacher-local timezone."""
    now = timezone.localtime()
    y = int(year) if year else now.year
    m = int(month) if month else now.month
    month_start = now.replace(year=y, month=m, day=1, hour=0, minute=0, second=0, microsecond=0)
    if m == 12:
        month_end = month_start.replace(year=y + 1, month=1)
    else:
        month_end = month_start.replace(month=m + 1)
    months_ru = (
        "", "январе", "феврале", "марте", "апреле", "мае", "июне",
        "июле", "августе", "сентябре", "октябре", "ноябре", "декабре",
    )
    label = months_ru[m] if 1 <= m <= 12 else ""
    return month_start, month_end, label


def _estimate_event_student_price_detail(teacher, event, student) -> tuple[Decimal, str]:
    """Return (amount, source_label) for planned-income breakdown."""
    record = EventBillingRecord.objects.filter(event=event, student=student).first()
    if record:
        amt = D(record.charged_amount or 0) or D(record.calculated_amount or 0)
        if amt > 0:
            label = (record.price_source_label or "").strip() or "По расчёту урока"
            return amt, label
    account = get_or_create_billing_account(teacher, student)
    package = active_package_for_account(account)
    if package and D_units(package.total_units) > 0 and D(package.purchase_amount) > 0:
        unit = (D(package.purchase_amount) / D_units(package.total_units)).quantize(Decimal("0.01"))
        return unit, f"Абонемент «{package.title}»"
    try:
        priced = calculate_lesson_price(
            account=account,
            duration_minutes=event_duration_minutes(event),
            is_group=bool(event.group_id),
            direction=getattr(student, "direction", "") or "",
        )
        amt = D(priced.get("amount") or 0)
        if amt > 0:
            return amt, priced.get("price_source_label") or "Тариф ученика"
    except Exception:
        pass
    settings = account.settings
    if settings.default_lesson_price is not None:
        return D(settings.default_lesson_price), "Цена за урок"
    return ZERO, "Нет тарифа"


def _estimate_event_student_price(teacher, event, student) -> Decimal:
    """Unit price for planned-income: billing record → package unit → tariff."""
    amount, _source = _estimate_event_student_price_detail(teacher, event, student)
    return amount


def _month_schedule_events(teacher: User, month_start, month_end):
    return (
        ScheduleEvent.objects.filter(
            owner=teacher,
            starts_at__gte=month_start,
            starts_at__lt=month_end,
        )
        .exclude(status=ScheduleEvent.Status.CANCELLED)
        .prefetch_related("group__students")
        .select_related("student")
        .order_by("starts_at")
    )


def _event_billable_students(event) -> list:
    if event.student_id:
        student = event.student
        if student and student.status != StudentStatus.ARCHIVED:
            return [student]
        return []
    if event.group_id:
        return list(event.group.students.exclude(status=StudentStatus.ARCHIVED))
    return []


def dashboard_planned_income_details(teacher: User, *, year=None, month=None) -> dict:
    """Breakdown of planned income by lesson × student for the month."""
    month_start, month_end, month_label = _month_bounds(year, month)
    teacher_settings = get_or_create_teacher_settings(teacher)
    items = []
    total = ZERO
    by_student: dict[int, dict] = {}

    for event in _month_schedule_events(teacher, month_start, month_end):
        for student in _event_billable_students(event):
            amount, source = _estimate_event_student_price_detail(teacher, event, student)
            if amount <= 0:
                continue
            total += amount
            student_name = student.full_name if hasattr(student, "full_name") else str(student)
            items.append(
                {
                    "event_id": event.pk,
                    "starts_at": event.starts_at.isoformat() if event.starts_at else None,
                    "student_id": student.pk,
                    "student_name": student_name,
                    "title": event.title or event.topic or "Урок",
                    "amount": str(D(amount)),
                    "source_label": source,
                }
            )
            bucket = by_student.setdefault(
                student.pk,
                {"student_id": student.pk, "student_name": student_name, "amount": ZERO, "lessons": 0},
            )
            bucket["amount"] += amount
            bucket["lessons"] += 1

    by_student_rows = sorted(
        (
            {
                "student_id": row["student_id"],
                "student_name": row["student_name"],
                "amount": str(D(row["amount"])),
                "lessons": row["lessons"],
            }
            for row in by_student.values()
        ),
        key=lambda r: Decimal(r["amount"]),
        reverse=True,
    )

    return {
        "currency": teacher_settings.currency,
        "year": month_start.year,
        "month": month_start.month,
        "month_label": month_label,
        "total": str(D(total)),
        "lessons_count": len(items),
        "items": items,
        "by_student": by_student_rows,
    }


def dashboard_received_details(teacher: User, *, year=None, month=None) -> dict:
    """Payments and package purchases in the month (incl. reversals with negative amounts)."""
    month_start, month_end, month_label = _month_bounds(year, month)
    teacher_settings = get_or_create_teacher_settings(teacher)
    txs = list(
        BillingTransaction.objects.filter(
            billing_account__teacher=teacher,
            transaction_type__in=(TransactionType.PAYMENT, TransactionType.PACKAGE_PURCHASE),
            occurred_at__gte=month_start,
            occurred_at__lt=month_end,
        )
        .select_related("student", "package", "event", "created_by")
        .order_by("-occurred_at")
    )
    items = [serialize_transaction(tx) for tx in txs]
    total = sum((D(tx.amount) for tx in txs), ZERO)
    by_student: dict[int, dict] = {}
    for tx in txs:
        if not tx.student_id:
            continue
        name = tx.student.full_name if tx.student_id else ""
        bucket = by_student.setdefault(
            tx.student_id,
            {"student_id": tx.student_id, "student_name": name, "amount": ZERO, "count": 0},
        )
        bucket["amount"] += D(tx.amount)
        bucket["count"] += 1

    by_student_rows = sorted(
        (
            {
                "student_id": row["student_id"],
                "student_name": row["student_name"],
                "amount": str(D(row["amount"])),
                "count": row["count"],
            }
            for row in by_student.values()
        ),
        key=lambda r: Decimal(r["amount"]),
        reverse=True,
    )

    return {
        "currency": teacher_settings.currency,
        "year": month_start.year,
        "month": month_start.month,
        "month_label": month_label,
        "total": str(D(total)),
        "payments_count": len(items),
        "items": items,
        "by_student": by_student_rows,
    }


def dashboard_summary(teacher: User, *, year=None, month=None) -> dict:
    accounts = visible_billing_accounts(teacher)
    month_start, month_end, month_label = _month_bounds(year, month)
    day_start = timezone.localtime().replace(hour=0, minute=0, second=0, microsecond=0)
    archived_student = Q(student__status=StudentStatus.ARCHIVED) | Q(
        billing_account__student__status=StudentStatus.ARCHIVED
    )

    # Фактический доход — по дате поступления денег (не по дате урока).
    month_paid = BillingTransaction.objects.filter(
        billing_account__teacher=teacher,
        transaction_type__in=(TransactionType.PAYMENT, TransactionType.PACKAGE_PURCHASE),
        occurred_at__gte=month_start,
        occurred_at__lt=month_end,
    ).aggregate(t=Sum("amount"))["t"] or ZERO

    month_charged = BillingTransaction.objects.filter(
        billing_account__teacher=teacher,
        transaction_type=TransactionType.CHARGE,
        occurred_at__gte=month_start,
        occurred_at__lt=month_end,
    ).aggregate(t=Sum("amount"))["t"] or ZERO

    today_paid = BillingTransaction.objects.filter(
        billing_account__teacher=teacher,
        transaction_type__in=(TransactionType.PAYMENT, TransactionType.PACKAGE_PURCHASE),
        occurred_at__gte=day_start,
    ).aggregate(t=Sum("amount"))["t"] or ZERO

    debt_total = ZERO
    for acc in accounts:
        bal = compute_account_balance(acc)
        debt_total += bal["debt"]

    awaiting = EventBillingRecord.objects.filter(
        billing_account__teacher=teacher,
        financial_status__in=(
            FinancialStatus.AWAITING_PAYMENT,
            FinancialStatus.PARTIALLY_PAID,
        ),
    ).exclude(archived_student)
    awaiting_count = awaiting.count()
    awaiting_sum = awaiting.aggregate(t=Sum("charged_amount"))["t"] or ZERO
    awaiting_paid = awaiting.aggregate(t=Sum("paid_amount"))["t"] or ZERO
    expected = D(awaiting_sum) - D(awaiting_paid)

    # Неоплаченные проведённые уроки
    unpaid_qs = EventBillingRecord.objects.filter(
        billing_account__teacher=teacher,
        delivery_status=DeliveryStatus.CONDUCTED,
        financial_status__in=(
            FinancialStatus.AWAITING_PAYMENT,
            FinancialStatus.PARTIALLY_PAID,
            FinancialStatus.NEEDS_DECISION,
        ),
    ).exclude(archived_student)
    unpaid_count = unpaid_qs.count()
    unpaid_charged = unpaid_qs.aggregate(t=Sum("charged_amount"))["t"] or ZERO
    unpaid_paid = unpaid_qs.aggregate(t=Sum("paid_amount"))["t"] or ZERO
    unpaid_amount = D(unpaid_charged) - D(unpaid_paid)
    # needs_decision without charged_amount — estimate from calculated
    for rec in unpaid_qs.filter(financial_status=FinancialStatus.NEEDS_DECISION):
        due = D(rec.charged_amount or 0) - D(rec.paid_amount or 0)
        if due <= 0:
            unpaid_amount += D(rec.calculated_amount or 0)

    needs_decision = EventBillingRecord.objects.filter(
        billing_account__teacher=teacher,
        financial_status=FinancialStatus.NEEDS_DECISION,
    ).exclude(archived_student).count()

    low_packages = 0
    teacher_settings = get_or_create_teacher_settings(teacher)
    for pkg in LessonPackage.objects.filter(
        billing_account__teacher=teacher, status=PackageStatus.ACTIVE
    ).exclude(billing_account__student__status=StudentStatus.ARCHIVED):
        thr_l = teacher_settings.low_balance_threshold_lessons or 2
        thr_m = teacher_settings.low_balance_threshold_minutes or 120
        if pkg.unit_type == PackageUnitType.LESSON and pkg.remaining_units <= thr_l:
            low_packages += 1
        elif pkg.unit_type == PackageUnitType.MINUTE and pkg.remaining_units <= thr_m:
            low_packages += 1

    conducted = EventBillingRecord.objects.filter(
        billing_account__teacher=teacher,
        delivery_status=DeliveryStatus.CONDUCTED,
        finalized_at__gte=month_start,
        finalized_at__lt=month_end,
    ).count()

    # Плановый доход — стоимость запланированных и проведённых уроков месяца (без отменённых).
    planned_income = ZERO
    for event in _month_schedule_events(teacher, month_start, month_end):
        for student in _event_billable_students(event):
            try:
                planned_income += _estimate_event_student_price(teacher, event, student)
            except BillingError:
                continue

    return {
        "currency": teacher_settings.currency,
        "year": month_start.year,
        "month": month_start.month,
        "month_label": month_label,
        "planned_income": str(D(planned_income)),
        "month_received": str(D(month_paid)),
        "month_charged": str(D(month_charged)),
        "unpaid_lessons_count": unpaid_count,
        "unpaid_lessons_amount": str(D(unpaid_amount) if unpaid_amount > 0 else ZERO),
        "debt_total": str(D(debt_total)),
        "expected_incoming": str(D(expected)),
        "conducted_billable_lessons": conducted,
        "low_packages": low_packages,
        "active_packages": LessonPackage.objects.filter(
            billing_account__teacher=teacher, status=PackageStatus.ACTIVE
        ).exclude(billing_account__student__status=StudentStatus.ARCHIVED).count(),
        "ending_packages": low_packages,
        "needs_decision": needs_decision,
        "awaiting_payment_count": awaiting_count,
        "expected_amount": str(D(expected)),
        "today_received": str(D(today_paid)),
    }


def reports(
    teacher: User,
    *,
    date_from=None,
    date_to=None,
) -> dict:
    qs = BillingTransaction.objects.filter(billing_account__teacher=teacher)
    if date_from:
        qs = qs.filter(occurred_at__gte=date_from)
    if date_to:
        qs = qs.filter(occurred_at__lte=date_to)

    received = qs.filter(
        transaction_type__in=(TransactionType.PAYMENT, TransactionType.PACKAGE_PURCHASE)
    ).aggregate(t=Sum("amount"))["t"] or ZERO
    charged = qs.filter(transaction_type=TransactionType.CHARGE).aggregate(t=Sum("amount"))[
        "t"
    ] or ZERO
    refunds = qs.filter(transaction_type=TransactionType.REFUND).aggregate(t=Sum("amount"))[
        "t"
    ] or ZERO
    discounts = qs.filter(transaction_type=TransactionType.DISCOUNT).aggregate(
        t=Sum("amount")
    )["t"] or ZERO
    package_units = qs.filter(
        transaction_type=TransactionType.PACKAGE_CONSUMPTION
    ).aggregate(t=Sum("package_units"))["t"] or ZERO

    by_student = []
    for row in (
        qs.filter(transaction_type__in=(TransactionType.PAYMENT, TransactionType.PACKAGE_PURCHASE))
        .values("student_id", "student__first_name", "student__last_name")
        .annotate(total=Sum("amount"))
        .order_by("-total")
    ):
        by_student.append(
            {
                "student_id": row["student_id"],
                "student_name": f"{row['student__first_name']} {row['student__last_name'] or ''}".strip(),
                "received": str(D(row["total"] or 0)),
            }
        )

    records = EventBillingRecord.objects.filter(
        billing_account__teacher=teacher,
        delivery_status=DeliveryStatus.CONDUCTED,
    )
    if date_from:
        records = records.filter(finalized_at__gte=date_from)
    if date_to:
        records = records.filter(finalized_at__lte=date_to)
    conducted_count = records.count()
    avg_lesson = ZERO
    avg_hour = ZERO
    if conducted_count:
        total_charged = records.aggregate(t=Sum("charged_amount"))["t"] or ZERO
        avg_lesson = D(D(total_charged) / conducted_count)
        total_minutes = sum(
            (r.actual_duration_minutes or r.planned_duration_minutes or 60) for r in records
        )
        if total_minutes:
            avg_hour = D(D(total_charged) * 60 / Decimal(total_minutes))

    # Forecast from planned unpaid
    planned = EventBillingRecord.objects.filter(
        billing_account__teacher=teacher,
        delivery_status=DeliveryStatus.PLANNED,
        event__starts_at__gte=timezone.now(),
    )
    forecast = planned.aggregate(t=Sum("calculated_amount"))["t"] or ZERO

    debt = ZERO
    for acc in visible_billing_accounts(teacher):
        debt += compute_account_balance(acc)["debt"]

    return {
        "received": str(D(received)),
        "charged": str(D(charged)),
        "expected": str(D(forecast)),
        "debt": str(D(debt)),
        "refunds": str(D(refunds)),
        "discounts": str(D(discounts)),
        "by_student": by_student,
        "conducted_lessons": conducted_count,
        "avg_lesson_price": str(avg_lesson),
        "avg_hour_price": str(avg_hour),
        "package_units_used": str(D_units(package_units)),
        "forecast_planned": str(D(forecast)),
    }


def export_transactions_csv(teacher: User, *, date_from=None, date_to=None) -> str:
    qs = BillingTransaction.objects.filter(billing_account__teacher=teacher)
    if date_from:
        qs = qs.filter(occurred_at__gte=date_from)
    if date_to:
        qs = qs.filter(occurred_at__lte=date_to)
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(
        ["Дата", "Ученик", "Тип", "Сумма", "Единицы", "Валюта", "Комментарий", "Автор"]
    )
    for tx in qs.order_by("-occurred_at"):
        writer.writerow(
            [
                tx.occurred_at.isoformat() if tx.occurred_at else "",
                tx.student.full_name if tx.student_id else "",
                tx.get_transaction_type_display(),
                str(tx.amount),
                str(tx.package_units),
                tx.currency,
                tx.comment,
                (
                    tx.created_by.get_full_name() or tx.created_by.username
                    if tx.created_by_id
                    else ""
                ),
            ]
        )
    return buf.getvalue()


def export_transactions_xlsx(teacher: User, *, date_from=None, date_to=None) -> bytes:
    from openpyxl import Workbook

    qs = BillingTransaction.objects.filter(billing_account__teacher=teacher)
    if date_from:
        qs = qs.filter(occurred_at__gte=date_from)
    if date_to:
        qs = qs.filter(occurred_at__lte=date_to)
    wb = Workbook()
    ws = wb.active
    ws.title = "Операции"
    ws.append(
        ["Дата", "Ученик", "Тип", "Сумма", "Единицы", "Валюта", "Комментарий", "Автор"]
    )
    for tx in qs.order_by("-occurred_at"):
        ws.append(
            [
                tx.occurred_at.isoformat() if tx.occurred_at else "",
                tx.student.full_name if tx.student_id else "",
                tx.get_transaction_type_display(),
                float(tx.amount),
                float(tx.package_units),
                tx.currency,
                tx.comment,
                (
                    tx.created_by.get_full_name() or tx.created_by.username
                    if tx.created_by_id
                    else ""
                ),
            ]
        )
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()


def unresolved_lessons(teacher: User) -> list[dict]:
    qs = EventBillingRecord.objects.filter(
        billing_account__teacher=teacher,
        financial_status__in=(
            FinancialStatus.NOT_SPECIFIED,
            FinancialStatus.NOT_CHARGED,
            FinancialStatus.AWAITING_PAYMENT,
            FinancialStatus.PARTIALLY_PAID,
            FinancialStatus.NEEDS_DECISION,
        ),
    ).exclude(
        student__status=StudentStatus.ARCHIVED,
    ).select_related("event", "student", "billing_account").order_by("-event__starts_at")
    # Prefer conducted / past
    return [serialize_event_billing(r) for r in qs[:200]]


def serialize_teacher_settings(settings: TeacherBillingSettings) -> dict:
    return {
        "currency": settings.currency,
        "default_billing_type": settings.default_billing_type,
        "default_lesson_duration_minutes": settings.default_lesson_duration_minutes,
        "default_lesson_price": (
            str(settings.default_lesson_price)
            if settings.default_lesson_price is not None
            else None
        ),
        "hourly_rate": str(settings.hourly_rate) if settings.hourly_rate is not None else None,
        "late_cancel_rule": settings.late_cancel_rule,
        "late_cancel_hours": settings.late_cancel_hours,
        "late_cancel_percent": str(settings.late_cancel_percent),
        "no_show_charge": settings.no_show_charge,
        "teacher_cancel_return_package": settings.teacher_cancel_return_package,
        "auto_charge_after_lesson": settings.auto_charge_after_lesson,
        "auto_use_package": settings.auto_use_package,
        "allow_negative_balance": settings.allow_negative_balance,
        "warn_low_balance": settings.warn_low_balance,
        "low_balance_threshold_lessons": settings.low_balance_threshold_lessons,
        "low_balance_threshold_minutes": settings.low_balance_threshold_minutes,
        "package_balance_check": settings.package_balance_check,
        "show_billing_to_student": settings.show_billing_to_student,
        "allow_student_history": settings.allow_student_history,
        "show_billing_to_parent": bool(getattr(settings, "show_billing_to_parent", False)),
        "digest_weekday": settings.digest_weekday,
        "reminder_cooldown_hours": settings.reminder_cooldown_hours,
        "reminder_template": settings.reminder_template,
    }


def _parse_optional_decimal(val):
    """Convert API/form values to Decimal or None (empty string clears the field)."""
    if val is None or val == "":
        return None
    return D(val)


def _parse_optional_int(val):
    if val is None or val == "":
        return None
    return int(val)


def update_teacher_settings(teacher: User, data: dict) -> TeacherBillingSettings:
    settings = get_or_create_teacher_settings(teacher)
    fields = [
        "currency",
        "default_billing_type",
        "default_lesson_duration_minutes",
        "default_lesson_price",
        "hourly_rate",
        "late_cancel_rule",
        "late_cancel_hours",
        "late_cancel_percent",
        "no_show_charge",
        "teacher_cancel_return_package",
        "auto_charge_after_lesson",
        "auto_use_package",
        "allow_negative_balance",
        "warn_low_balance",
        "low_balance_threshold_lessons",
        "low_balance_threshold_minutes",
        "package_balance_check",
        "show_billing_to_student",
        "allow_student_history",
        "show_billing_to_parent",
        "digest_weekday",
        "reminder_cooldown_hours",
        "reminder_template",
    ]
    nullable_decimals = {"default_lesson_price", "hourly_rate"}
    nullable_ints = {
        "low_balance_threshold_lessons",
        "low_balance_threshold_minutes",
    }
    for key in fields:
        if key in data:
            val = data[key]
            if key in nullable_decimals:
                val = _parse_optional_decimal(val)
            elif key == "late_cancel_percent":
                if val is None or val == "":
                    continue
                val = D(val)
            elif key in nullable_ints:
                val = _parse_optional_int(val)
            setattr(settings, key, val)
    settings.save()
    return settings


def update_student_settings(
    teacher: User, account: BillingAccount, data: dict
) -> StudentBillingSettings:
    if account.teacher_id != teacher.id:
        raise BillingError("FORBIDDEN", "Нет доступа", 403)
    settings = account.settings
    old = {"billing_type": settings.billing_type}
    fields = [
        "billing_type",
        "default_lesson_duration_minutes",
        "default_lesson_price",
        "hourly_rate",
        "per_minute_rate",
        "monthly_fee",
        "monthly_charge_day",
        "monthly_includes_all_lessons",
        "monthly_max_lessons",
        "monthly_charge_no_shows",
        "monthly_rollover_unused",
        "monthly_extra_lesson_price",
        "subject_prices",
        "group_lesson_price",
        "duration_lesson_coefficients",
        "charge_late_cancellation",
        "charge_no_show",
        "low_balance_threshold_minutes",
        "low_balance_threshold_lessons",
        "use_actual_duration_for_package",
    ]
    decimal_fields = {
        "default_lesson_price",
        "hourly_rate",
        "per_minute_rate",
        "monthly_fee",
        "monthly_extra_lesson_price",
        "group_lesson_price",
    }
    nullable_ints = {
        "monthly_max_lessons",
        "low_balance_threshold_minutes",
        "low_balance_threshold_lessons",
    }
    for key in fields:
        if key in data:
            val = data[key]
            if key in decimal_fields:
                val = _parse_optional_decimal(val)
            elif key in nullable_ints:
                val = _parse_optional_int(val)
            setattr(settings, key, val)
    settings.save()
    for key in ("payer_name", "payer_phone", "payer_email", "notes", "currency", "student_billing_notifications"):
        if key in data:
            setattr(account, key, data[key])
    if "payer_user_id" in data:
        account.payer_user_id = data["payer_user_id"] or None
    account.save()
    audit(
        teacher=teacher,
        actor=teacher,
        action="settings_update",
        billing_account=account,
        entity_type="StudentBillingSettings",
        entity_id=str(settings.pk),
        old_value=old,
        new_value={"billing_type": settings.billing_type},
    )
    return settings


def build_reminder_text(account: BillingAccount, template: str = "") -> dict:
    awaiting = EventBillingRecord.objects.filter(
        billing_account=account,
        financial_status__in=(
            FinancialStatus.AWAITING_PAYMENT,
            FinancialStatus.PARTIALLY_PAID,
        ),
    ).select_related("event").order_by("event__starts_at")
    lines = []
    total = ZERO
    for r in awaiting[:20]:
        due = D(r.charged_amount - r.paid_amount)
        if due <= 0:
            continue
        total += due
        date_label = (
            r.event.starts_at.strftime("%d.%m.%Y") if r.event_id else "—"
        )
        lines.append(f"{date_label} — {due} {r.currency}")
    details = "\n".join(lines) if lines else "Нет неоплаченных занятий"
    from Generator.telegram_utils import escape_telegram_html

    teacher_settings = get_or_create_teacher_settings(account.teacher)
    tpl = template or teacher_settings.reminder_template
    text = tpl.format(
        amount=total,
        currency=account.currency,
        details=details,
        student=escape_telegram_html(account.student.full_name),
    )
    return {"text": text, "amount": total, "details": details, "lessons_count": len(lines)}


def send_payment_reminder(
    *,
    teacher: User,
    account: BillingAccount,
    message: str = "",
    channel: str = "telegram",
) -> PaymentReminderLog:
    if account.teacher_id != teacher.id:
        raise BillingError("FORBIDDEN", "Нет доступа", 403)
    teacher_settings = get_or_create_teacher_settings(teacher)
    cooldown = timedelta(hours=teacher_settings.reminder_cooldown_hours or 48)
    last = (
        PaymentReminderLog.objects.filter(billing_account=account)
        .order_by("-created_at")
        .first()
    )
    if last and timezone.now() - last.created_at < cooldown:
        raise BillingError(
            "REMINDER_COOLDOWN",
            f"Повторное напоминание можно отправить через {teacher_settings.reminder_cooldown_hours} ч.",
        )
    built = build_reminder_text(account, message or teacher_settings.reminder_template)
    text = message or built["text"]

    from .billing_notifications import send_billing_message_to_student

    send_billing_message_to_student(account, text)

    return PaymentReminderLog.objects.create(
        billing_account=account,
        sent_by=teacher,
        channel=channel,
        message=text,
        amount=built["amount"],
    )


def student_billing_view(student_user: User) -> list[dict]:
    """Read-only биллинг для ученика (если учитель разрешил)."""
    rosters = Student.objects.filter(user=student_user)
    result = []
    for student in rosters:
        accounts = BillingAccount.objects.filter(student=student, is_active=True)
        for account in accounts:
            teacher_settings = get_or_create_teacher_settings(account.teacher)
            if not teacher_settings.show_billing_to_student:
                continue
            data = serialize_account(
                account, include_history=teacher_settings.allow_student_history
            )
            # Hide teacher income aggregates
            data.pop("notes", None)
            result.append(data)
    return result


def event_billing_badge(event: ScheduleEvent, student_ids=None) -> list[dict]:
    records = EventBillingRecord.objects.filter(event=event).select_related(
        "student", "package"
    )
    if student_ids is not None:
        records = records.filter(student_id__in=list(student_ids))
    if not records.exists():
        return []
    badges = []
    for r in records:
        due = D(r.charged_amount) - D(r.paid_amount)
        display_amount = D(r.charged_amount) if D(r.charged_amount) > 0 else D(r.calculated_amount or 0)
        is_package = (
            r.price_source == PriceSource.PACKAGE
            or (r.price_source_label or "").lower().find("абонемент") >= 0
        )
        label = r.get_financial_status_display()
        if r.financial_status == FinancialStatus.PAID:
            label = "Оплачено"
        elif r.financial_status == FinancialStatus.PAID_FROM_PACKAGE:
            if r.package_id:
                rem = r.package.remaining_units
                unit = "мин" if r.package.unit_type == PackageUnitType.MINUTE else "зан."
                label = f"Абонемент: осталось {rem} {unit}"
            else:
                label = "Оплачено из абонемента"
        elif r.financial_status == FinancialStatus.AWAITING_PAYMENT:
            label = f"Не оплачен · {due} ₽" if due > 0 else "Не оплачен"
        elif r.financial_status == FinancialStatus.PARTIALLY_PAID:
            label = f"Частично оплачен · долг {due} ₽" if due > 0 else "Частично оплачен"
        elif r.financial_status == FinancialStatus.NOT_CHARGED:
            label = "Абонемент (ещё не списан)" if is_package else "Не начислен"
        elif r.financial_status in (
            FinancialStatus.NEEDS_DECISION,
            FinancialStatus.NOT_SPECIFIED,
        ):
            label = "Абонемент — требует оформления" if is_package else "Требует оформления"
        elif r.financial_status == FinancialStatus.NOT_BILLABLE:
            label = "Не оплачивается"
        badges.append(
            {
                "record_id": str(r.id),
                "student_id": r.student_id,
                "student_name": r.student.full_name,
                "financial_status": r.financial_status,
                "label": label,
                "amount": str(due if due > 0 else display_amount),
                "currency": r.currency,
                "price_source_label": r.price_source_label,
            }
        )
    return badges


def apply_cancel_billing(
    *,
    event: ScheduleEvent,
    teacher: User,
    cancelled_by: str,
    financial_action: str,
    amount: Optional[Decimal] = None,
    charge_percent: Optional[Decimal] = None,
    comment: str = "",
    idempotency_key: str = "",
) -> list[EventBillingRecord]:
    """
    cancelled_by: student|teacher
    financial_action: charge|package|skip|defer|custom|return_package
    """
    teacher_settings = get_or_create_teacher_settings(teacher)
    delivery = (
        DeliveryStatus.CANCELLED_BY_STUDENT
        if cancelled_by == "student"
        else DeliveryStatus.CANCELLED_BY_TEACHER
    )

    if cancelled_by == "teacher" and financial_action == "return_package":
        records = ensure_event_billing_records(event)
        results = []
        for record in records:
            if record.package_id and record.package_units > 0:
                return_package_units(
                    package=record.package,
                    units=record.package_units,
                    account=record.billing_account,
                    student=record.student,
                    created_by=teacher,
                    event=event,
                    event_billing=record,
                    comment=comment or "Возврат при отмене учителем",
                )
                record.package_units = ZERO
                record.financial_status = FinancialStatus.NOT_BILLABLE
                record.delivery_status = delivery
                record.finalized_at = timezone.now()
                record.save()
            else:
                results.extend(
                    finalize_event_billing(
                        event=event,
                        teacher=teacher,
                        student=record.student,
                        delivery_status=delivery,
                        financial_action="skip",
                        comment=comment,
                        idempotency_key=idempotency_key,
                    )
                )
                continue
            results.append(record)
        event.status = ScheduleEvent.Status.CANCELLED
        event.save(update_fields=["status", "updated_at"])
        return results

    if financial_action == "skip":
        return finalize_event_billing(
            event=event,
            teacher=teacher,
            delivery_status=delivery,
            financial_action="skip",
            comment=comment,
            idempotency_key=idempotency_key,
        )

    if cancelled_by == "student":
        # late cancel percent from teacher settings if custom not provided
        if financial_action == "charge" and teacher_settings.late_cancel_rule == LateCancelRule.PERCENT:
            charge_percent = charge_percent or teacher_settings.late_cancel_percent
        if teacher_settings.late_cancel_rule == LateCancelRule.NO_CHARGE and financial_action == "charge":
            financial_action = "skip"

    return finalize_event_billing(
        event=event,
        teacher=teacher,
        delivery_status=delivery,
        financial_action=financial_action,
        amount=amount,
        charge_percent=charge_percent,
        comment=comment,
        idempotency_key=idempotency_key,
    )


def apply_no_show(
    *,
    event: ScheduleEvent,
    teacher: User,
    financial_action: str = "charge",
    amount: Optional[Decimal] = None,
    comment: str = "",
    idempotency_key: str = "",
) -> list[EventBillingRecord]:
    return finalize_event_billing(
        event=event,
        teacher=teacher,
        delivery_status=DeliveryStatus.NO_SHOW,
        financial_action=financial_action,
        amount=amount,
        comment=comment,
        idempotency_key=idempotency_key,
    )


def legacy_backfill_preview(teacher: User, date_from, date_to) -> dict:
    events = ScheduleEvent.objects.filter(
        owner=teacher,
        starts_at__gte=date_from,
        starts_at__lte=date_to,
        status__in=(
            ScheduleEvent.Status.DONE,
            ScheduleEvent.Status.COMPLETED,
        ),
    )
    items = []
    total = ZERO
    for event in events:
        records = ensure_event_billing_records(event)
        for r in records:
            if r.financial_status != FinancialStatus.NOT_SPECIFIED:
                continue
            items.append(serialize_event_billing(r))
            total += D(r.calculated_amount)
    return {
        "count": len(items),
        "total_amount": str(D(total)),
        "items": items[:100],
    }


@transaction.atomic
def legacy_backfill_apply(
    teacher: User, record_ids: list, financial_action: str = "charge"
) -> int:
    count = 0
    for rid in record_ids:
        record = EventBillingRecord.objects.filter(
            pk=rid, billing_account__teacher=teacher
        ).select_related("event").first()
        if not record:
            continue
        if record.financial_status != FinancialStatus.NOT_SPECIFIED:
            continue
        finalize_event_billing(
            event=record.event,
            teacher=teacher,
            student=record.student,
            delivery_status=DeliveryStatus.CONDUCTED,
            financial_action=financial_action,
            idempotency_key=f"backfill:{rid}",
        )
        count += 1
    return count
