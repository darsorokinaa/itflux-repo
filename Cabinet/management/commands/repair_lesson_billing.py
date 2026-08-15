"""Idempotent repair of incorrect lesson billing records. Default is dry-run."""

from __future__ import annotations

from django.core.management.base import BaseCommand
from django.db.models import Q

from Cabinet.billing_models import (
    DeliveryStatus,
    EventBillingRecord,
    FinancialStatus,
)
from Cabinet.billing_service import (
    PRICE_UNSPECIFIED_LABEL,
    mark_record_not_billable,
    record_has_active_charge,
    record_has_confirmed_payment,
    record_price_missing,
    sync_cancelled_event_billing,
)
from Cabinet.models import ScheduleEvent


class Command(BaseCommand):
    help = (
        "Исправляет явно некорректные финансовые записи уроков. "
        "По умолчанию только отчёт. Применить: --apply"
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--apply",
            action="store_true",
            help="Записать исправления. Без флага — только показать, что будет сделано.",
        )

    def handle(self, *args, **options):
        apply = bool(options.get("apply"))
        stats = {
            "cancelled_cleared": 0,
            "zero_awaiting_to_unspecified": 0,
            "skipped_with_payment": 0,
            "skipped_real_charge": 0,
        }

        cancelled_qs = EventBillingRecord.objects.filter(
            Q(event__status=ScheduleEvent.Status.CANCELLED)
            | Q(delivery_status__in=(
                DeliveryStatus.CANCELLED_BY_STUDENT,
                DeliveryStatus.CANCELLED_BY_TEACHER,
            ))
        ).select_related("event", "billing_account")

        for rec in cancelled_qs:
            if rec.delivery_status == DeliveryStatus.RESCHEDULED:
                continue
            if rec.financial_status == FinancialStatus.NOT_BILLABLE and not record_has_active_charge(rec):
                continue
            if record_has_confirmed_payment(rec):
                stats["skipped_with_payment"] += 1
                continue
            # Оплачиваемая отмена: есть начисление и delivery уже cancelled.
            if (
                rec.delivery_status in (
                    DeliveryStatus.CANCELLED_BY_STUDENT,
                    DeliveryStatus.CANCELLED_BY_TEACHER,
                )
                and rec.financial_status in (
                    FinancialStatus.AWAITING_PAYMENT,
                    FinancialStatus.PARTIALLY_PAID,
                )
                and rec.charged_amount
                and record_has_active_charge(rec)
            ):
                stats["skipped_real_charge"] += 1
                continue
            event_cancelled = rec.event_id and rec.event.status == ScheduleEvent.Status.CANCELLED
            looks_like_regular_cancel = event_cancelled and (
                rec.financial_status
                in (
                    FinancialStatus.AWAITING_PAYMENT,
                    FinancialStatus.NEEDS_DECISION,
                    FinancialStatus.NOT_CHARGED,
                    FinancialStatus.NOT_SPECIFIED,
                )
                or rec.delivery_status == DeliveryStatus.CONDUCTED
                or rec.charged_amount == 0
            )
            if not looks_like_regular_cancel:
                continue
            stats["cancelled_cleared"] += 1
            if apply:
                sync_cancelled_event_billing(
                    rec.event,
                    teacher=rec.event.owner,
                    comment="repair_lesson_billing: обычная отмена без долга",
                )

        zero_awaiting = EventBillingRecord.objects.filter(
            delivery_status__in=(DeliveryStatus.CONDUCTED, DeliveryStatus.NO_SHOW),
            financial_status=FinancialStatus.AWAITING_PAYMENT,
            charged_amount=0,
        ).select_related("event")
        for rec in zero_awaiting:
            if record_has_confirmed_payment(rec) or record_has_active_charge(rec):
                continue
            if rec.is_free and rec.price_source_label != PRICE_UNSPECIFIED_LABEL:
                if apply:
                    mark_record_not_billable(rec, delivery_status=rec.delivery_status)
                stats["zero_awaiting_to_unspecified"] += 1
                continue
            if record_price_missing(rec) or rec.price_source_label == PRICE_UNSPECIFIED_LABEL or not rec.price_source_label:
                stats["zero_awaiting_to_unspecified"] += 1
                if apply:
                    rec.financial_status = FinancialStatus.NEEDS_DECISION
                    rec.finalized_at = None
                    rec.price_source_label = PRICE_UNSPECIFIED_LABEL
                    rec.save(update_fields=[
                        "financial_status",
                        "finalized_at",
                        "price_source_label",
                        "updated_at",
                    ])

        mode = "APPLY" if apply else "DRY-RUN"
        self.stdout.write(f"=== repair_lesson_billing ({mode}) ===")
        for key, value in stats.items():
            self.stdout.write(f"  {key}: {value}")
        if not apply:
            self.stdout.write("Повтор с --apply запишет только эти безопасные исправления.")
