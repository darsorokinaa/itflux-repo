"""
Безопасный перенос legacy-финансов в журнал операций.

По умолчанию — dry-run (ничего не пишет).
Реальное применение: python manage.py migrate_legacy_finances --apply

КРИТИЧНО:
- не меняет remaining_units абонементов;
- не повторно списывает уже оплаченные уроки;
- создаёт только однозначные исторические операции с is_legacy=True;
- идемпотентен через migration_key.
"""

from __future__ import annotations

import json
import uuid
from decimal import Decimal
from pathlib import Path

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from Cabinet.billing_models import (
    BillingTransaction,
    EventBillingRecord,
    FinancialStatus,
    LessonPackage,
    TransactionType,
)


ZERO = Decimal("0.00")


class Command(BaseCommand):
    help = (
        "Перенос legacy-связей урок↔абонемент в BillingTransaction без изменения остатков. "
        "По умолчанию dry-run."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--apply",
            action="store_true",
            help="Реально записать исторические операции (требует --i-have-backup)",
        )
        parser.add_argument(
            "--i-have-backup",
            action="store_true",
            help="Подтверждение, что сделана резервная копия БД",
        )
        parser.add_argument(
            "--output",
            type=str,
            default="",
            help="Путь к JSON-отчёту",
        )
        parser.add_argument(
            "--batch-id",
            type=str,
            default="",
            help="Идентификатор запуска миграции",
        )

    def handle(self, *args, **options):
        apply = bool(options["apply"])
        if apply and not options["i_have_backup"]:
            self.stderr.write(
                self.style.ERROR(
                    "Отказ: для --apply укажите --i-have-backup после создания "
                    "резервной копии (pg_dump)."
                )
            )
            raise SystemExit(2)

        batch_id = (options.get("batch_id") or "").strip() or str(uuid.uuid4())
        report = {
            "mode": "apply" if apply else "dry-run",
            "migration_batch_id": batch_id,
            "created": [],
            "skipped": [],
            "conflicts": [],
            "would_create": 0,
            "created_count": 0,
            "skipped_count": 0,
        }

        # 1) Уроки PAID_FROM_PACKAGE со связью package — историческое списание
        qs = EventBillingRecord.objects.filter(
            financial_status=FinancialStatus.PAID_FROM_PACKAGE,
            package__isnull=False,
        ).select_related("billing_account", "student", "package", "event")

        for record in qs.iterator():
            key = f"legacy:EventBillingRecord:{record.id}:package_consumption"
            existing = BillingTransaction.objects.filter(migration_key=key).first()
            if existing:
                report["skipped"].append(
                    {"migration_key": key, "reason": "already_migrated"}
                )
                report["skipped_count"] += 1
                continue

            # Уже есть «живое» списание — не дублируем
            live = BillingTransaction.objects.filter(
                event_billing=record,
                transaction_type=TransactionType.PACKAGE_CONSUMPTION,
                is_reversal=False,
                is_legacy=False,
            ).exists()
            if live:
                report["skipped"].append(
                    {
                        "migration_key": key,
                        "reason": "live_consumption_exists",
                        "event_billing_id": str(record.id),
                    }
                )
                report["skipped_count"] += 1
                continue

            units = Decimal(str(record.package_units or 0))
            if units <= 0:
                units = Decimal("1.00")

            payload = {
                "migration_key": key,
                "event_billing_id": str(record.id),
                "package_id": str(record.package_id),
                "units": str(units),
                "remaining_unchanged": True,
            }
            report["would_create"] += 1
            if not apply:
                report["created"].append({**payload, "dry_run": True})
                continue

            with transaction.atomic():
                BillingTransaction.objects.create(
                    billing_account=record.billing_account,
                    student=record.student,
                    event=record.event,
                    event_billing=record,
                    package=record.package,
                    transaction_type=TransactionType.PACKAGE_CONSUMPTION,
                    amount=ZERO,
                    package_units=units,
                    currency=record.currency or record.billing_account.currency,
                    occurred_at=record.finalized_at or record.updated_at or timezone.now(),
                    comment="Историческое списание (миграция legacy, остаток не изменён)",
                    metadata={
                        "source": "legacy_migration",
                        "remaining_snapshot": str(record.package.remaining_units),
                    },
                    created_by=None,
                    is_legacy=True,
                    legacy_source_model="EventBillingRecord",
                    legacy_source_id=str(record.id),
                    migration_key=key,
                    migration_batch_id=batch_id,
                )
            report["created"].append(payload)
            report["created_count"] += 1

        # 2) Оплаченные уроки без package — legacy_payment маркер в metadata (без денег/остатков)
        paid_cash = EventBillingRecord.objects.filter(
            financial_status=FinancialStatus.PAID,
            package__isnull=True,
        ).select_related("billing_account", "student", "event")

        for record in paid_cash.iterator():
            key = f"legacy:EventBillingRecord:{record.id}:legacy_payment"
            if BillingTransaction.objects.filter(migration_key=key).exists():
                report["skipped"].append(
                    {"migration_key": key, "reason": "already_migrated"}
                )
                report["skipped_count"] += 1
                continue
            # Уже есть payment allocation / charge — не создаём фиктивную оплату
            has_money_tx = BillingTransaction.objects.filter(
                event_billing=record,
                transaction_type__in=(
                    TransactionType.PAYMENT,
                    TransactionType.CHARGE,
                ),
                is_reversal=False,
            ).exists()
            if has_money_tx:
                report["skipped"].append(
                    {
                        "migration_key": key,
                        "reason": "money_tx_exists",
                        "event_billing_id": str(record.id),
                    }
                )
                report["skipped_count"] += 1
                continue

            payload = {
                "migration_key": key,
                "event_billing_id": str(record.id),
                "type": "legacy_payment_marker",
            }
            report["would_create"] += 1
            if not apply:
                report["created"].append({**payload, "dry_run": True})
                continue

            with transaction.atomic():
                BillingTransaction.objects.create(
                    billing_account=record.billing_account,
                    student=record.student,
                    event=record.event,
                    event_billing=record,
                    transaction_type=TransactionType.PAYMENT,
                    amount=Decimal(str(record.paid_amount or record.charged_amount or 0)),
                    package_units=ZERO,
                    currency=record.currency or record.billing_account.currency,
                    occurred_at=record.finalized_at or record.updated_at or timezone.now(),
                    comment="Оплачено по старой системе (миграция, баланс не пересчитан)",
                    metadata={
                        "source": "legacy_migration",
                        "payment_method": "legacy_payment",
                    },
                    created_by=None,
                    is_legacy=True,
                    legacy_source_model="EventBillingRecord",
                    legacy_source_id=str(record.id),
                    migration_key=key,
                    migration_batch_id=batch_id,
                )
            report["created"].append(payload)
            report["created_count"] += 1

        # 3) Абонементы с расхождением — только в conflicts, без автоисправления
        for pkg in LessonPackage.objects.select_related("billing_account").iterator():
            used = Decimal(str(pkg.total_units)) - Decimal(str(pkg.remaining_units))
            consumed = BillingTransaction.objects.filter(
                package=pkg,
                transaction_type=TransactionType.PACKAGE_CONSUMPTION,
                is_reversal=False,
            )
            # Исключаем legacy из «ожидаемого» сравнения с осторожностью —
            # фиксируем расхождение для ручной проверки
            live_sum = sum(
                (Decimal(str(t.package_units)) for t in consumed if not t.is_legacy),
                ZERO,
            )
            legacy_sum = sum(
                (Decimal(str(t.package_units)) for t in consumed if t.is_legacy),
                ZERO,
            )
            if abs(used - live_sum) > Decimal("0.01") and abs(used - (live_sum + legacy_sum)) > Decimal(
                "0.01"
            ):
                report["conflicts"].append(
                    {
                        "package_id": str(pkg.id),
                        "remaining_units": str(pkg.remaining_units),
                        "used_units": str(used),
                        "live_consumption": str(live_sum),
                        "legacy_consumption": str(legacy_sum),
                        "action": "keep_remaining_units_unchanged",
                    }
                )

        output = (options.get("output") or "").strip()
        if output:
            Path(output).write_text(
                json.dumps(report, ensure_ascii=False, indent=2, default=str),
                encoding="utf-8",
            )
            self.stdout.write(self.style.SUCCESS(f"Отчёт: {output}"))

        self.stdout.write(
            f"mode={report['mode']} batch={batch_id} "
            f"would_create={report['would_create']} created={report['created_count']} "
            f"skipped={report['skipped_count']} conflicts={len(report['conflicts'])}"
        )
        if not apply:
            self.stdout.write(
                self.style.WARNING(
                    "Dry-run завершён. Для применения: "
                    "python manage.py migrate_legacy_finances --apply --i-have-backup"
                )
            )
