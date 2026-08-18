"""Read-only audit of student billing: charges, payments, cancellations, debt."""

from __future__ import annotations

import json
from decimal import Decimal
from pathlib import Path

from django.core.management.base import BaseCommand
from django.db.models import Count, Q, Sum

from Cabinet.billing_models import (
    BillingAccount,
    BillingTransaction,
    DeliveryStatus,
    EventBillingRecord,
    FinancialStatus,
    StudentPayment,
    StudentPaymentAllocation,
    StudentPaymentStatus,
    TransactionType,
)
from Cabinet.billing_service import (
    compute_account_balance,
    record_belongs_in_payment_list,
    record_due_amount,
    record_has_active_charge,
    record_is_debt,
    record_price_missing,
)
from Cabinet.models import ScheduleEvent


ZERO = Decimal("0.00")


class Command(BaseCommand):
    help = (
        "Аудит оплат учеников (только чтение, --dry-run по умолчанию). "
        "Пример: python manage.py audit_payments --dry-run --output=payments_audit.json"
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            default=True,
            help="Только отчёт, без исправлений (по умолчанию).",
        )
        parser.add_argument(
            "--apply",
            action="store_true",
            help="Зарезервировано. Исправления этим командам не выполняются.",
        )
        parser.add_argument("--output", type=str, default="", help="Путь к JSON-отчёту")
        parser.add_argument("--teacher-id", type=int, default=0, help="Ограничить учителем")

    def handle(self, *args, **options):
        if options.get("apply"):
            self.stdout.write(
                self.style.WARNING(
                    "Исправление данных этой командой не выполняется. "
                    "Сначала разберите отчёт. Для точечного ремонта есть repair_lesson_billing."
                )
            )
        report = self._build_report(teacher_id=options.get("teacher_id") or 0)
        self._print_summary(report)
        output = (options.get("output") or "").strip()
        if output:
            path = Path(output)
            path.write_text(
                json.dumps(report, ensure_ascii=False, indent=2, default=str),
                encoding="utf-8",
            )
            self.stdout.write(self.style.SUCCESS(f"Отчёт сохранён: {path}"))

    def _qs(self, model, teacher_id: int):
        qs = model.objects.all()
        if not teacher_id:
            return qs
        if model is BillingAccount:
            return qs.filter(teacher_id=teacher_id)
        if hasattr(model, "billing_account"):
            return qs.filter(billing_account__teacher_id=teacher_id)
        if model is ScheduleEvent:
            return qs.filter(owner_id=teacher_id)
        return qs

    def _build_report(self, *, teacher_id: int = 0) -> dict:
        accounts = self._qs(BillingAccount, teacher_id)
        records = self._qs(EventBillingRecord, teacher_id).select_related("event", "billing_account")
        txs = self._qs(BillingTransaction, teacher_id)
        payments = self._qs(StudentPayment, teacher_id)

        duplicate_charge_rows = list(
            txs.filter(
                transaction_type=TransactionType.CHARGE,
                is_reversal=False,
                event_billing_id__isnull=False,
            )
            .values("event_billing_id")
            .annotate(cnt=Count("id"))
            .filter(cnt__gt=1)
        )
        duplicate_active_charges = []
        for row in duplicate_charge_rows:
            charge_txs = list(
                BillingTransaction.objects.filter(
                    event_billing_id=row["event_billing_id"],
                    transaction_type=TransactionType.CHARGE,
                    is_reversal=False,
                )
            )
            reversed_ids = set(
                BillingTransaction.objects.filter(
                    reversed_transaction_id__in=[t.pk for t in charge_txs]
                ).values_list("reversed_transaction_id", flat=True)
            )
            active = [t for t in charge_txs if t.pk not in reversed_ids]
            if len(active) > 1:
                duplicate_active_charges.append(
                    {
                        "event_billing_id": str(row["event_billing_id"]),
                        "active_count": len(active),
                        "tx_ids": [str(t.id) for t in active],
                    }
                )

        cancelled_with_charges = []
        cancelled_in_debt = 0
        for rec in records.filter(
            Q(event__status=ScheduleEvent.Status.CANCELLED)
            | Q(
                delivery_status__in=(
                    DeliveryStatus.CANCELLED_BY_STUDENT,
                    DeliveryStatus.CANCELLED_BY_TEACHER,
                )
            )
        ):
            if record_has_active_charge(rec):
                cancelled_with_charges.append(str(rec.id))
            if record_is_debt(rec):
                cancelled_in_debt += 1

        moved_with_charges = []
        rescheduled_zero_rows = []
        for rec in records.filter(
            Q(event__status=ScheduleEvent.Status.MOVED)
            | Q(delivery_status=DeliveryStatus.RESCHEDULED)
        ):
            if record_has_active_charge(rec) or record_is_debt(rec):
                moved_with_charges.append(str(rec.id))
            if not record_belongs_in_payment_list(rec):
                rescheduled_zero_rows.append(str(rec.id))

        conducted = records.filter(
            Q(delivery_status__in=(DeliveryStatus.CONDUCTED, DeliveryStatus.NO_SHOW))
            | Q(event__status__in=(ScheduleEvent.Status.DONE, ScheduleEvent.Status.COMPLETED))
        )
        completed_without_charge = []
        zero_price_completed = []
        for rec in conducted.iterator():
            if rec.delivery_status not in (DeliveryStatus.CONDUCTED, DeliveryStatus.NO_SHOW):
                continue
            if rec.financial_status in (
                FinancialStatus.PAID_FROM_PACKAGE,
                FinancialStatus.NOT_BILLABLE,
                FinancialStatus.NEEDS_DECISION,
            ):
                if rec.financial_status == FinancialStatus.NEEDS_DECISION or record_price_missing(rec):
                    zero_price_completed.append(str(rec.id))
                continue
            if not record_has_active_charge(rec) and rec.financial_status != FinancialStatus.PAID:
                completed_without_charge.append(str(rec.id))
            if rec.charged_amount == 0 and rec.calculated_amount == 0 and not rec.is_free:
                zero_price_completed.append(str(rec.id))

        orphan_charges = txs.filter(
            transaction_type=TransactionType.CHARGE,
            is_reversal=False,
        ).filter(Q(event_billing__isnull=True) | Q(event__isnull=True)).count()

        unmatched_payments = 0
        for pay in payments.filter(status=StudentPaymentStatus.CONFIRMED, package__isnull=True):
            allocated = (
                StudentPaymentAllocation.objects.filter(payment=pay).aggregate(t=Sum("amount"))["t"]
                or 0
            )
            if Decimal(str(pay.amount)) - Decimal(str(allocated)) > Decimal("0.01"):
                unmatched_payments += 1

        inconsistent_totals = []
        negative_debt_as_credit = []
        stored_vs_computed = []
        for account in accounts.iterator():
            computed = compute_account_balance(account)
            rec_debt = ZERO
            rec_charged = ZERO
            rec_paid = ZERO
            for rec in EventBillingRecord.objects.filter(billing_account=account):
                rec_charged += Decimal(str(rec.charged_amount or 0))
                rec_paid += Decimal(str(rec.paid_amount or 0))
                rec_debt += record_due_amount(rec)
            ledger_debt = computed["debt"]
            if abs(rec_debt - ledger_debt) > Decimal("0.01") and computed["credit"] <= 0:
                inconsistent_totals.append(
                    {
                        "account_id": account.id,
                        "student_id": account.student_id,
                        "lesson_due": str(rec_debt),
                        "ledger_debt": str(ledger_debt),
                        "ledger_credit": str(computed["credit"]),
                    }
                )
            if computed["balance"] > 0:
                negative_debt_as_credit.append(
                    {
                        "account_id": account.id,
                        "student_id": account.student_id,
                        "credit": str(computed["credit"]),
                    }
                )
            stored_vs_computed.append(
                {
                    "account_id": account.id,
                    "computed_balance": str(computed["balance"]),
                    "computed_debt": str(computed["debt"]),
                    "computed_credit": str(computed["credit"]),
                    "lesson_due": str(rec_debt),
                }
            )

        return {
            "dry_run": True,
            "students_checked": accounts.count(),
            "charges_found": txs.filter(
                transaction_type=TransactionType.CHARGE, is_reversal=False
            ).count(),
            "duplicate_charge_rows": len(duplicate_charge_rows),
            "duplicate_active_charges": len(duplicate_active_charges),
            "duplicate_active_charge_details": duplicate_active_charges[:200],
            "cancelled_lessons_with_charges": len(cancelled_with_charges),
            "cancelled_in_debt": cancelled_in_debt,
            "rescheduled_old_events_with_charges": len(moved_with_charges),
            "rescheduled_zero_rows": len(rescheduled_zero_rows),
            "completed_lessons_without_charges": len(completed_without_charge),
            "zero_price_completed_lessons": len(set(zero_price_completed)),
            "inconsistent_payment_totals": len(inconsistent_totals),
            "inconsistent_payment_details": inconsistent_totals[:200],
            "unmatched_or_unallocated_payments": unmatched_payments,
            "orphan_financial_records": orphan_charges,
            "accounts_with_credit_not_debt": len(negative_debt_as_credit),
            "stored_vs_computed_sample": stored_vs_computed[:50],
            "needs_decision": records.filter(
                financial_status=FinancialStatus.NEEDS_DECISION
            ).count(),
            "confirmed_payments": payments.filter(status=StudentPaymentStatus.CONFIRMED).count(),
        }

    def _print_summary(self, report: dict):
        self.stdout.write("=== Аудит оплат (--dry-run) ===")
        keys = [
            "students_checked",
            "charges_found",
            "duplicate_active_charges",
            "cancelled_lessons_with_charges",
            "cancelled_in_debt",
            "rescheduled_old_events_with_charges",
            "rescheduled_zero_rows",
            "completed_lessons_without_charges",
            "zero_price_completed_lessons",
            "inconsistent_payment_totals",
            "unmatched_or_unallocated_payments",
            "orphan_financial_records",
            "accounts_with_credit_not_debt",
            "needs_decision",
            "confirmed_payments",
        ]
        for key in keys:
            self.stdout.write(f"  {key}: {report.get(key)}")
        self.stdout.write("Исправление не выполнялось. Данные не изменены.")
