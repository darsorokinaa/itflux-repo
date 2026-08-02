"""Только чтение: аудит существующих финансовых данных."""

from __future__ import annotations

import csv
import json
from decimal import Decimal
from pathlib import Path

from django.core.management.base import BaseCommand
from django.db.models import Count, F, Q, Sum

from Cabinet.billing_models import (
    BillingTransaction,
    DeliveryStatus,
    EventBillingRecord,
    FinancialStatus,
    LessonPackage,
    PackageStatus,
    StudentPayment,
    StudentPaymentStatus,
    TransactionType,
)


class Command(BaseCommand):
    help = (
        "Аудит финансовых данных (только чтение). "
        "Пример: python manage.py audit_finance_data --output=finance_audit.json"
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--output",
            type=str,
            default="",
            help="Путь к JSON или CSV отчёту",
        )

    def handle(self, *args, **options):
        report = self._build_report()
        self._print_summary(report)
        output = (options.get("output") or "").strip()
        if output:
            path = Path(output)
            if path.suffix.lower() == ".csv":
                self._write_csv(path, report)
            else:
                path.write_text(
                    json.dumps(report, ensure_ascii=False, indent=2, default=str),
                    encoding="utf-8",
                )
            self.stdout.write(self.style.SUCCESS(f"Отчёт сохранён: {path}"))

    def _build_report(self) -> dict:
        packages = LessonPackage.objects.all()
        paid_packages = 0
        for pkg in packages.iterator():
            paid = (
                StudentPayment.objects.filter(
                    package=pkg, status=StudentPaymentStatus.CONFIRMED
                ).aggregate(t=Sum("amount"))["t"]
                or 0
            )
            purchase = pkg.purchase_amount or 0
            if purchase <= 0 or Decimal(str(paid)) >= Decimal(str(purchase)):
                paid_packages += 1

        conducted = EventBillingRecord.objects.filter(
            delivery_status__in=(DeliveryStatus.CONDUCTED, DeliveryStatus.NO_SHOW)
        )
        unpaid_conducted = conducted.filter(
            financial_status__in=(
                FinancialStatus.AWAITING_PAYMENT,
                FinancialStatus.PARTIALLY_PAID,
                FinancialStatus.NEEDS_DECISION,
            )
        )
        paid_lessons = conducted.filter(
            financial_status__in=(
                FinancialStatus.PAID,
                FinancialStatus.PAID_FROM_PACKAGE,
            )
        )
        linked_to_package = EventBillingRecord.objects.filter(package__isnull=False)

        negative_remaining = packages.filter(remaining_units__lt=0).count()
        remaining_gt_total = packages.filter(remaining_units__gt=F("total_units")).count()

        # Возможные двойные активные списания на один урок
        double_charge_candidates = []
        consumptions = (
            BillingTransaction.objects.filter(
                transaction_type=TransactionType.PACKAGE_CONSUMPTION,
                is_reversal=False,
                event_billing__isnull=False,
            )
            .values("event_billing_id")
            .annotate(cnt=Count("id"))
            .filter(cnt__gt=1)
        )
        for row in consumptions:
            ebid = row["event_billing_id"]
            txs = list(
                BillingTransaction.objects.filter(
                    event_billing_id=ebid,
                    transaction_type=TransactionType.PACKAGE_CONSUMPTION,
                    is_reversal=False,
                )
            )
            active = [
                t
                for t in txs
                if not BillingTransaction.objects.filter(reversed_transaction=t).exists()
            ]
            if len(active) > 1:
                double_charge_candidates.append(
                    {
                        "event_billing_id": str(ebid),
                        "active_consumptions": len(active),
                        "tx_ids": [str(t.id) for t in active],
                    }
                )

        ambiguous = []
        unambiguous = 0
        for pkg in packages.select_related("billing_account").iterator():
            used = Decimal(str(pkg.total_units)) - Decimal(str(pkg.remaining_units))
            consumed = (
                BillingTransaction.objects.filter(
                    package=pkg,
                    transaction_type=TransactionType.PACKAGE_CONSUMPTION,
                    is_reversal=False,
                ).aggregate(t=Sum("package_units"))["t"]
                or 0
            )
            returned = (
                BillingTransaction.objects.filter(
                    package=pkg,
                    transaction_type=TransactionType.PACKAGE_RETURN,
                    is_reversal=False,
                ).aggregate(t=Sum("package_units"))["t"]
                or 0
            )
            # Учитываем отмены списаний
            reversed_cons = (
                BillingTransaction.objects.filter(
                    package=pkg,
                    transaction_type=TransactionType.PACKAGE_CONSUMPTION,
                    is_reversal=True,
                ).aggregate(t=Sum("package_units"))["t"]
                or 0
            )
            net_from_ledger = Decimal(str(consumed)) + Decimal(str(reversed_cons)) - Decimal(
                str(returned)
            )
            # package_units в reversal отрицательные → Sum уже с минусом
            if abs(used - abs(net_from_ledger)) <= Decimal("0.01") or abs(
                used - Decimal(str(consumed))
            ) <= Decimal("0.01"):
                unambiguous += 1
            else:
                ambiguous.append(
                    {
                        "package_id": str(pkg.id),
                        "title": pkg.title,
                        "student_id": pkg.billing_account.student_id,
                        "total_units": str(pkg.total_units),
                        "remaining_units": str(pkg.remaining_units),
                        "used_units": str(used),
                        "consumption_sum": str(consumed),
                        "return_sum": str(returned),
                        "note": "Остаток не совпадает с суммой операций — не исправлять автоматически",
                    }
                )

        paid_linked = paid_lessons.filter(package__isnull=False).count()
        paid_unlinked = paid_lessons.filter(package__isnull=True).count()

        return {
            "packages_total": packages.count(),
            "packages_paid": paid_packages,
            "packages_active": packages.filter(status=PackageStatus.ACTIVE).count(),
            "conducted_lessons": conducted.count(),
            "paid_lessons": paid_lessons.count(),
            "unpaid_conducted_lessons": unpaid_conducted.count(),
            "lessons_linked_to_package": linked_to_package.count(),
            "packages_negative_remaining": negative_remaining,
            "packages_remaining_gt_total": remaining_gt_total,
            "possible_double_charges": len(double_charge_candidates),
            "double_charge_details": double_charge_candidates,
            "ambiguous_packages": len(ambiguous),
            "ambiguous_details": ambiguous[:200],
            "unambiguous_packages": unambiguous,
            "paid_lessons_with_package": paid_linked,
            "paid_lessons_without_package": paid_unlinked,
            "payments_confirmed": StudentPayment.objects.filter(
                status=StudentPaymentStatus.CONFIRMED
            ).count(),
            "transactions_total": BillingTransaction.objects.count(),
            "package_consumptions": BillingTransaction.objects.filter(
                transaction_type=TransactionType.PACKAGE_CONSUMPTION,
                is_reversal=False,
            ).count(),
            "manual_review_required": len(ambiguous) + len(double_charge_candidates),
        }

    def _print_summary(self, report: dict):
        self.stdout.write("=== Аудит финансов (read-only) ===")
        keys = [
            "packages_total",
            "packages_paid",
            "packages_active",
            "conducted_lessons",
            "paid_lessons",
            "unpaid_conducted_lessons",
            "lessons_linked_to_package",
            "packages_negative_remaining",
            "packages_remaining_gt_total",
            "possible_double_charges",
            "ambiguous_packages",
            "unambiguous_packages",
            "manual_review_required",
            "payments_confirmed",
            "transactions_total",
        ]
        for key in keys:
            self.stdout.write(f"  {key}: {report.get(key)}")

    def _write_csv(self, path: Path, report: dict):
        with path.open("w", newline="", encoding="utf-8") as fh:
            writer = csv.writer(fh)
            writer.writerow(["metric", "value"])
            for key, value in report.items():
                if isinstance(value, (list, dict)):
                    continue
                writer.writerow([key, value])
            writer.writerow([])
            writer.writerow(["ambiguous_package_id", "title", "remaining", "used", "note"])
            for row in report.get("ambiguous_details") or []:
                writer.writerow(
                    [
                        row.get("package_id"),
                        row.get("title"),
                        row.get("remaining_units"),
                        row.get("used_units"),
                        row.get("note"),
                    ]
                )
