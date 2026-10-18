"""r74: проверки целостности оплат (только чтение).

  python manage.py audit_payment_integrity [--teacher ID] [--json]

Проверяет:
  * confirmed StudentPayment ⇔ ровно одна активная (неотменённая) денежная операция;
  * EventBillingRecord.paid_amount = Σ привязок подтверждённых оплат;
  * на одном уроке одновременно активны денежное начисление и списание абонемента;
  * списания/возвраты абонемента с нулевой суммой при цене абонемента > 0
    (ожидают backfill_package_ledger).
Код выхода 1, если есть нарушения (кроме ожидающих backfill).
"""

import json

from django.core.management.base import BaseCommand
from django.db import connection, transaction
from django.db.models import Exists, OuterRef, Sum

from Cabinet.billing_models import (
    BillingTransaction,
    EventBillingRecord,
    StudentPayment,
    StudentPaymentAllocation,
    StudentPaymentStatus,
    TransactionType,
)

MONEY_IN = (TransactionType.PAYMENT, TransactionType.PACKAGE_PURCHASE)


def _active(qs):
    return qs.filter(is_reversal=False).exclude(
        Exists(BillingTransaction.objects.filter(reversed_transaction_id=OuterRef("pk")))
    )


def run_checks(teacher_id=None) -> dict:
    pay_qs = StudentPayment.objects.filter(status=StudentPaymentStatus.CONFIRMED)
    tx_qs = BillingTransaction.objects.all()
    rec_qs = EventBillingRecord.objects.all()
    if teacher_id:
        pay_qs = pay_qs.filter(billing_account__teacher_id=teacher_id)
        tx_qs = tx_qs.filter(billing_account__teacher_id=teacher_id)
        rec_qs = rec_qs.filter(billing_account__teacher_id=teacher_id)

    payments_without_tx = []
    payments_multi_tx = []
    active_by_payment = {}
    for row in _active(tx_qs.filter(transaction_type__in=MONEY_IN, student_payment__isnull=False)).values(
        "student_payment_id"
    ):
        key = row["student_payment_id"]
        active_by_payment[key] = active_by_payment.get(key, 0) + 1
    for p in pay_qs.select_related("billing_account"):
        n = active_by_payment.get(p.pk, 0)
        row = {
            "payment_id": str(p.pk),
            "teacher_id": p.billing_account.teacher_id,
            "student_id": p.student_id,
            "amount": str(p.amount),
            "paid_at": p.paid_at.isoformat() if p.paid_at else None,
        }
        if n == 0:
            payments_without_tx.append(row)
        elif n > 1:
            payments_multi_tx.append({**row, "active_tx": n})

    alloc = {
        r["event_billing_id"]: r["t"]
        for r in StudentPaymentAllocation.objects.filter(
            payment__status=StudentPaymentStatus.CONFIRMED
        ).values("event_billing_id").annotate(t=Sum("amount"))
    }
    paid_mismatch = []
    for rec in rec_qs.select_related("billing_account").only(
        "id", "paid_amount", "charged_amount", "student_id", "billing_account__teacher_id"
    ):
        a = alloc.get(rec.pk) or 0
        if (rec.paid_amount or 0) != a:
            paid_mismatch.append({
                "record_id": str(rec.pk),
                "teacher_id": rec.billing_account.teacher_id,
                "student_id": rec.student_id,
                "paid_amount": str(rec.paid_amount),
                "allocated": str(a),
            })

    charge_ids = set(_active(tx_qs.filter(transaction_type=TransactionType.CHARGE, amount__gt=0))
                     .values_list("event_billing_id", flat=True))
    cons_ids = set(_active(tx_qs.filter(transaction_type=TransactionType.PACKAGE_CONSUMPTION))
                   .values_list("event_billing_id", flat=True))
    both = sorted(str(x) for x in (charge_ids & cons_ids) if x)

    zero_pkg = _active(tx_qs.filter(
        transaction_type__in=(TransactionType.PACKAGE_CONSUMPTION, TransactionType.PACKAGE_RETURN),
        amount=0,
        package__purchase_amount__gt=0,
        package_units__gt=0,
    )).count()

    return {
        "payments_without_tx": payments_without_tx,
        "payments_multi_tx": payments_multi_tx,
        "paid_amount_mismatch": paid_mismatch,
        "charge_and_package_on_same_lesson": both,
        "zero_valued_package_ops_pending_backfill": zero_pkg,
    }


class Command(BaseCommand):
    help = "Проверки целостности оплат (только чтение)"

    def add_arguments(self, parser):
        parser.add_argument("--teacher", type=int)
        parser.add_argument("--json", action="store_true")

    def handle(self, *args, **opts):
        with transaction.atomic():
            if connection.vendor == "postgresql":
                with connection.cursor() as cur:
                    cur.execute("SET TRANSACTION READ ONLY")
            result = run_checks(opts.get("teacher"))
            transaction.set_rollback(True)
        if opts.get("json"):
            self.stdout.write(json.dumps(result, ensure_ascii=False, indent=2))
        else:
            for key, value in result.items():
                n = value if isinstance(value, int) else len(value)
                self.stdout.write(f"{key}: {n}")
                if isinstance(value, list):
                    for row in value[:50]:
                        self.stdout.write(f"   {row}")
        bad = sum(len(v) for k, v in result.items() if isinstance(v, list))
        if bad:
            raise SystemExit(1)
