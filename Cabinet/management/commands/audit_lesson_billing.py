"""Read-only audit of lesson charges, cancellations, moves and debt."""

from __future__ import annotations

import json
from pathlib import Path

from django.core.management.base import BaseCommand
from django.db.models import Count, Q

from Cabinet.billing_models import (
    BillingTransaction,
    DeliveryStatus,
    EventBillingRecord,
    FinancialStatus,
    PriceSource,
    StudentPaymentAllocation,
    StudentPaymentStatus,
    TransactionType,
)
from Cabinet.billing_service import (
    PRICE_UNSPECIFIED_LABEL,
    record_has_active_charge,
    record_is_debt,
    record_price_missing,
)
from Cabinet.models import ScheduleEvent


class Command(BaseCommand):
    help = (
        "Аудит начислений и задолженности по урокам (только чтение). "
        "Пример: python manage.py audit_lesson_billing --output=lesson_billing_audit.json"
    )

    def add_arguments(self, parser):
        parser.add_argument("--output", type=str, default="", help="Путь к JSON-отчёту")

    def handle(self, *args, **options):
        report = self._build_report()
        self._print_summary(report)
        output = (options.get("output") or "").strip()
        if output:
            path = Path(output)
            path.write_text(
                json.dumps(report, ensure_ascii=False, indent=2, default=str),
                encoding="utf-8",
            )
            self.stdout.write(self.style.SUCCESS(f"Отчёт сохранён: {path}"))

    def _build_report(self) -> dict:
        cancelled_events = ScheduleEvent.objects.filter(status=ScheduleEvent.Status.CANCELLED)
        moved_events = ScheduleEvent.objects.filter(status=ScheduleEvent.Status.MOVED)
        conducted_statuses = (ScheduleEvent.Status.DONE, ScheduleEvent.Status.COMPLETED)

        cancelled_in_debt = 0
        cancelled_with_finance = 0
        for rec in EventBillingRecord.objects.filter(
            Q(event__status=ScheduleEvent.Status.CANCELLED)
            | Q(delivery_status__in=(
                DeliveryStatus.CANCELLED_BY_STUDENT,
                DeliveryStatus.CANCELLED_BY_TEACHER,
            ))
        ).select_related("event"):
            if rec.finalized_at or rec.charged_amount or rec.paid_amount or rec.package_id:
                cancelled_with_finance += 1
            if record_is_debt(rec):
                cancelled_in_debt += 1

        moved_in_debt = 0
        moved_with_finance = 0
        for rec in EventBillingRecord.objects.filter(
            Q(event__status=ScheduleEvent.Status.MOVED)
            | Q(delivery_status=DeliveryStatus.RESCHEDULED)
        ).select_related("event"):
            if rec.finalized_at or rec.charged_amount or rec.paid_amount:
                moved_with_finance += 1
            if record_is_debt(rec):
                moved_in_debt += 1

        conducted = EventBillingRecord.objects.filter(
            Q(delivery_status__in=(DeliveryStatus.CONDUCTED, DeliveryStatus.NO_SHOW))
            | Q(event__status__in=conducted_statuses)
        )
        conducted_zero = conducted.filter(charged_amount=0, calculated_amount=0).count()
        conducted_unspecified = 0
        conducted_no_charge = 0
        debt_from_zero = 0
        conducted_before_price = 0
        for rec in conducted.iterator():
            if record_price_missing(rec) or rec.price_source_label == PRICE_UNSPECIFIED_LABEL:
                conducted_unspecified += 1
            if rec.delivery_status in (DeliveryStatus.CONDUCTED, DeliveryStatus.NO_SHOW):
                if not record_has_active_charge(rec) and rec.financial_status not in (
                    FinancialStatus.PAID_FROM_PACKAGE,
                    FinancialStatus.NOT_BILLABLE,
                    FinancialStatus.PAID,
                ):
                    conducted_no_charge += 1
            if rec.financial_status == FinancialStatus.AWAITING_PAYMENT and rec.charged_amount == 0:
                debt_from_zero += 1
            if (
                rec.delivery_status == DeliveryStatus.CONDUCTED
                and rec.price_source_label == PRICE_UNSPECIFIED_LABEL
            ):
                conducted_before_price += 1

        multi_charges = list(
            BillingTransaction.objects.filter(
                transaction_type=TransactionType.CHARGE,
                is_reversal=False,
                event_billing__isnull=False,
            )
            .values("event_billing_id")
            .annotate(cnt=Count("id"))
            .filter(cnt__gt=1)
        )
        multi_charge_active = 0
        for row in multi_charges:
            txs = list(
                BillingTransaction.objects.filter(
                    event_billing_id=row["event_billing_id"],
                    transaction_type=TransactionType.CHARGE,
                    is_reversal=False,
                )
            )
            active = [
                tx
                for tx in txs
                if not BillingTransaction.objects.filter(reversed_transaction=tx).exists()
            ]
            if len(active) > 1:
                multi_charge_active += 1

        orphan_charges = BillingTransaction.objects.filter(
            transaction_type=TransactionType.CHARGE,
            is_reversal=False,
        ).filter(Q(event_billing__isnull=True) | Q(event__isnull=True)).count()

        orphan_allocations = StudentPaymentAllocation.objects.filter(
            Q(event_billing__isnull=True)
            | Q(payment__status=StudentPaymentStatus.CANCELLED)
        ).count()

        return {
            "cancelled_events": cancelled_events.count(),
            "cancelled_in_debt": cancelled_in_debt,
            "cancelled_or_moved_with_finance": cancelled_with_finance,
            "moved_events": moved_events.count(),
            "moved_in_debt": moved_in_debt,
            "moved_with_finance": moved_with_finance,
            "conducted_price_zero": conducted_zero,
            "conducted_price_unspecified": conducted_unspecified,
            "conducted_without_charge": conducted_no_charge,
            "events_with_multiple_charge_rows": len(multi_charges),
            "events_with_multiple_active_charges": multi_charge_active,
            "debt_from_zero_price": debt_from_zero,
            "conducted_before_student_price": conducted_before_price,
            "cancelled_with_finance_records": cancelled_with_finance,
            "orphan_charges": orphan_charges,
            "orphaned_or_cancelled_allocations": orphan_allocations,
            "awaiting_zero_amount": EventBillingRecord.objects.filter(
                financial_status=FinancialStatus.AWAITING_PAYMENT,
                charged_amount=0,
            ).count(),
            "needs_decision": EventBillingRecord.objects.filter(
                financial_status=FinancialStatus.NEEDS_DECISION,
            ).count(),
            "teacher_default_unspecified": EventBillingRecord.objects.filter(
                price_source=PriceSource.TEACHER_DEFAULT,
                price_source_label=PRICE_UNSPECIFIED_LABEL,
            ).count(),
        }

    def _print_summary(self, report: dict):
        self.stdout.write("=== Аудит начислений уроков (read-only) ===")
        for key, value in report.items():
            self.stdout.write(f"  {key}: {value}")
