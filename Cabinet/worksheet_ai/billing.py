"""Списание AI-токенов только на сервере: транзакция, идемпотентность, без отрицательного баланса."""

from __future__ import annotations

from django.db import IntegrityError, transaction
from django.utils import timezone

from .models import AITokenAccount, AITransaction


class BillingError(Exception):
    def __init__(self, code: str, message: str, status: int = 400, **extra):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status
        self.extra = extra

    def to_dict(self):
        return {"code": self.code, "message": self.message, **self.extra}


class InsufficientTokens(BillingError):
    def __init__(self, balance: int, required: int):
        super().__init__(
            "INSUFFICIENT_TOKENS",
            "Недостаточно AI-токенов для генерации.",
            402,
            balance=balance,
            required=required,
        )


def get_account(user) -> AITokenAccount:
    account, _ = AITokenAccount.objects.get_or_create(user=user)
    return account


def balance_of(user) -> int:
    return get_account(user).balance


def _existing(user, idempotency_key: str):
    if not idempotency_key:
        return None
    return AITransaction.objects.filter(user=user, idempotency_key=idempotency_key).first()


def apply_balance_change(
    user,
    amount: int,
    *,
    operation_type: str,
    idempotency_key: str,
    description: str = "",
    generation=None,
    direction: str,
    metadata: dict | None = None,
) -> AITransaction:
    if amount < 0:
        raise BillingError("BAD_AMOUNT", "Сумма операции не может быть отрицательной.")
    if not idempotency_key:
        raise BillingError("IDEMPOTENCY_REQUIRED", "Нужен ключ идемпотентности.")
    try:
        with transaction.atomic():
            existing = (
                AITransaction.objects.select_for_update()
                .filter(user=user, idempotency_key=idempotency_key)
                .first()
            )
            if existing:
                return existing
            account, _ = AITokenAccount.objects.select_for_update().get_or_create(user=user)
            before = account.balance
            if direction == "debit":
                if before < amount:
                    raise InsufficientTokens(before, amount)
                after = before - amount
            else:
                after = before + amount
            account.balance = after
            account.save(update_fields=["balance", "updated_at"])
            return AITransaction.objects.create(
                user=user,
                amount=amount,
                operation_type=operation_type,
                generation=generation,
                description=description[:255],
                balance_before=before,
                balance_after=after,
                status=AITransaction.Status.POSTED,
                idempotency_key=idempotency_key,
                metadata=metadata or {},
            )
    except IntegrityError:
        existing = _existing(user, idempotency_key)
        if existing:
            return existing
        raise


def debit(user, amount: int, **kwargs) -> AITransaction:
    return apply_balance_change(
        user,
        amount,
        operation_type=kwargs.pop("operation_type", AITransaction.Operation.DEBIT),
        direction="debit",
        **kwargs,
    )


def credit(user, amount: int, **kwargs) -> AITransaction:
    return apply_balance_change(
        user,
        amount,
        operation_type=kwargs.pop("operation_type", AITransaction.Operation.CREDIT),
        direction="credit",
        **kwargs,
    )


def refund(user, amount: int, **kwargs) -> AITransaction:
    if amount <= 0:
        account = get_account(user)
        return AITransaction(
            user=user,
            amount=0,
            operation_type=AITransaction.Operation.REFUND,
            balance_before=account.balance,
            balance_after=account.balance,
            status=AITransaction.Status.POSTED,
        )
    return apply_balance_change(
        user,
        amount,
        operation_type=AITransaction.Operation.REFUND,
        direction="credit",
        **kwargs,
    )


def worksheet_watermark_required(user) -> bool:
    """Бесплатный тариф и отсутствие подписки оставляют знак на листе. Платные тарифы — нет."""
    from Cabinet.models import TeacherSubscription

    sub = TeacherSubscription.objects.filter(teacher=user).select_related("plan").first()
    if sub and sub.is_valid() and sub.plan_id and not sub.plan.is_free:
        return False
    return True


def ensure_period_grant(user) -> AITokenAccount:
    """Один раз за календарный месяц начисляет AI-токены по тарифу. Повтор безопасен."""
    from Cabinet.models import TeacherSubscription

    from .pricing import get_pricing

    config = get_pricing()
    grants = config["monthly_grant_by_plan"]
    slug = "default"
    sub = TeacherSubscription.objects.filter(teacher=user).select_related("plan").first()
    if sub and sub.is_valid() and sub.plan_id:
        slug = sub.plan.slug or "default"
    amount = int(grants.get(slug, grants.get("default", 0)) or 0)
    if amount <= 0:
        return get_account(user)
    period = timezone.localdate().strftime("%Y-%m")
    prefix = f"subscription:{user.pk}:{period}"
    credit(
        user,
        amount,
        operation_type=AITransaction.Operation.SUBSCRIPTION_CREDIT,
        idempotency_key=prefix,
        description=f"AI-токены тарифа {slug} за {period}",
        metadata={"plan": slug, "period": period, "grant": amount},
    )
    credited = sum(
        AITransaction.objects.filter(
            user=user,
            operation_type=AITransaction.Operation.SUBSCRIPTION_CREDIT,
            status=AITransaction.Status.POSTED,
            idempotency_key__startswith=prefix,
        ).values_list("amount", flat=True)
    )
    if credited < amount:
        credit(
            user,
            amount - credited,
            operation_type=AITransaction.Operation.SUBSCRIPTION_CREDIT,
            idempotency_key=f"{prefix}:raise:{amount}",
            description=f"Добор AI-токенов тарифа {slug} за {period}",
            metadata={"plan": slug, "period": period, "grant": amount, "already": credited},
        )
    return get_account(user)
