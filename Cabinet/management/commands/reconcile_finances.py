"""Сверка финансовых данных после миграции. Критические расхождения → exit code 1."""

from __future__ import annotations

import json
from decimal import Decimal
from pathlib import Path

from django.core.management.base import BaseCommand
from django.db.models import Sum

from Cabinet.billing_models import (
    BillingTransaction,
    DeliveryStatus,
    EventBillingRecord,
    FinancialStatus,
    LessonPackage,
    StudentPayment,
    StudentPaymentStatus,
    TransactionType,
)


class Command(BaseCommand):
    help = "Сверка финансов: остатки, оплаты, двойные списания. Пример: reconcile_finances --output=reconcile.json"

    def add_arguments(self, parser):
        parser.add_argument("--output", type=str, default="")
        parser.add_argument(
            "--snapshot-before",
            type=str,
            default="",
            help="JSON-снимок audit_finance_data до миграции для сравнения",
        )

    def handle(self, *args, **options):
        critical = []
        warnings = []
        manual = []

        packages_count = LessonPackage.objects.count()
        payments_sum = (
            StudentPayment.objects.filter(status=StudentPaymentStatus.CONFIRMED).aggregate(
                t=Sum("amount")
            )["t"]
            or 0
        )
        payments_count = StudentPayment.objects.filter(
            status=StudentPaymentStatus.CONFIRMED
        ).count()

        negative = list(
            LessonPackage.objects.filter(remaining_units__lt=0).values(
                "id", "remaining_units", "total_units"
            )[:100]
        )
        if negative:
            critical.append({"type": "negative_remaining", "items": negative})

        # Двойные активные списания
        doubles = []
        for record in EventBillingRecord.objects.filter(
            financial_status=FinancialStatus.PAID_FROM_PACKAGE
        ).iterator():
            txs = list(
                BillingTransaction.objects.filter(
                    event_billing=record,
                    transaction_type=TransactionType.PACKAGE_CONSUMPTION,
                    is_reversal=False,
                )
            )
            active = [
                t
                for t in txs
                if not t.is_legacy
                and not BillingTransaction.objects.filter(reversed_transaction=t).exists()
            ]
            if len(active) > 1:
                doubles.append({"event_billing_id": str(record.id), "count": len(active)})
        if doubles:
            critical.append({"type": "double_consumptions", "items": doubles})

        # Оплаченные уроки не должны «потерять» статус
        paid = EventBillingRecord.objects.filter(
            delivery_status__in=(DeliveryStatus.CONDUCTED, DeliveryStatus.NO_SHOW),
            financial_status__in=(FinancialStatus.PAID, FinancialStatus.PAID_FROM_PACKAGE),
        ).count()

        unpaid = EventBillingRecord.objects.filter(
            delivery_status__in=(DeliveryStatus.CONDUCTED, DeliveryStatus.NO_SHOW),
            financial_status__in=(
                FinancialStatus.AWAITING_PAYMENT,
                FinancialStatus.PARTIALLY_PAID,
                FinancialStatus.NEEDS_DECISION,
            ),
        ).count()

        for pkg in LessonPackage.objects.iterator():
            used = Decimal(str(pkg.total_units)) - Decimal(str(pkg.remaining_units))
            live = (
                BillingTransaction.objects.filter(
                    package=pkg,
                    transaction_type=TransactionType.PACKAGE_CONSUMPTION,
                    is_reversal=False,
                    is_legacy=False,
                ).aggregate(t=Sum("package_units"))["t"]
                or 0
            )
            if abs(used - Decimal(str(live))) > Decimal("0.01"):
                # С учётом legacy может сходиться — иначе manual
                legacy = (
                    BillingTransaction.objects.filter(
                        package=pkg,
                        transaction_type=TransactionType.PACKAGE_CONSUMPTION,
                        is_reversal=False,
                        is_legacy=True,
                    ).aggregate(t=Sum("package_units"))["t"]
                    or 0
                )
                if abs(used - (Decimal(str(live)) + Decimal(str(legacy)))) > Decimal("0.01"):
                    manual.append(
                        {
                            "package_id": str(pkg.id),
                            "remaining_units": str(pkg.remaining_units),
                            "used": str(used),
                            "live_consumption": str(live),
                            "legacy_consumption": str(legacy),
                            "note": "Остаток сохранён; требуется ручная проверка",
                        }
                    )

        before = {}
        snapshot_path = (options.get("snapshot_before") or "").strip()
        if snapshot_path:
            before = json.loads(Path(snapshot_path).read_text(encoding="utf-8"))
            if before.get("packages_total") != packages_count:
                critical.append(
                    {
                        "type": "packages_count_mismatch",
                        "before": before.get("packages_total"),
                        "after": packages_count,
                    }
                )
            if before.get("payments_confirmed") != payments_count:
                critical.append(
                    {
                        "type": "payments_count_mismatch",
                        "before": before.get("payments_confirmed"),
                        "after": payments_count,
                    }
                )

        report = {
            "packages_total": packages_count,
            "payments_confirmed": payments_count,
            "payments_amount_sum": str(payments_sum),
            "paid_conducted_lessons": paid,
            "unpaid_conducted_lessons": unpaid,
            "critical": critical,
            "warnings": warnings,
            "manual_review": manual,
            "ok": len(critical) == 0,
            "before_snapshot": before or None,
        }

        output = (options.get("output") or "").strip()
        if output:
            Path(output).write_text(
                json.dumps(report, ensure_ascii=False, indent=2, default=str),
                encoding="utf-8",
            )
            self.stdout.write(self.style.SUCCESS(f"Отчёт: {output}"))

        self.stdout.write(
            f"packages={packages_count} payments={payments_count} "
            f"paid_lessons={paid} unpaid={unpaid} "
            f"critical={len(critical)} manual={len(manual)}"
        )
        if critical:
            self.stderr.write(self.style.ERROR("Критические расхождения обнаружены"))
            raise SystemExit(1)
        self.stdout.write(self.style.SUCCESS("Сверка пройдена без критических ошибок"))
