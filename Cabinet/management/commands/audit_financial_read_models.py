"""Read-only: расхождения финансовых read-model (дашборд / карточка / SoT)."""

from __future__ import annotations

import json
from decimal import Decimal
from pathlib import Path

from django.core.management.base import BaseCommand
from django.utils import timezone

from Cabinet.billing_models import EventBillingRecord
from Cabinet.billing_service import (
    dashboard_summary,
    event_billing_badge,
    get_lesson_financial_state,
    record_is_debt,
    serialize_account,
    serialize_event_billing,
)


class Command(BaseCommand):
    help = (
        "Сравнение канонического billing state с дашбордом и карточкой ученика. Только чтение. "
        "python manage.py audit_financial_read_models [--output=finance-read.json] [--limit=300]"
    )

    def add_arguments(self, parser):
        parser.add_argument("--output", type=str, default="", help="Путь к JSON-отчёту")
        parser.add_argument("--limit", type=int, default=300)

    def handle(self, *args, **options):
        report = self._build_report(limit=int(options.get("limit") or 300))
        self._print_summary(report)
        output = (options.get("output") or "").strip()
        if output:
            path = Path(output)
            path.write_text(
                json.dumps(report, ensure_ascii=False, indent=2, default=str),
                encoding="utf-8",
            )
            self.stdout.write(self.style.SUCCESS(f"Отчёт сохранён: {path}"))

    def _build_report(self, *, limit: int) -> dict:
        mismatches = []
        records = (
            EventBillingRecord.objects.select_related("event", "student", "billing_account")
            .order_by("-id")[:limit]
        )
        account_cache = {}
        dash_cache = {}
        for rec in records:
            sot = record_is_debt(rec)
            serialized = serialize_event_billing(rec)
            state = get_lesson_financial_state(rec)
            badges = event_billing_badge(rec.event, student_ids=[rec.student_id])
            badge_debt = badges[0]["is_debt"] if badges else False
            account = account_cache.get(rec.billing_account_id)
            if account is None:
                account = serialize_account(rec.billing_account)
                account_cache[rec.billing_account_id] = account
            unpaid_ids = {item.get("id") for item in account.get("unpaid_lessons") or []}
            account_lists_as_unpaid = str(rec.id) in unpaid_ids
            teacher_id = rec.billing_account.teacher_id
            dash = dash_cache.get(teacher_id)
            if dash is None:
                dash = dashboard_summary(rec.billing_account.teacher)
                dash_cache[teacher_id] = dash
            issues = []
            if serialized["is_debt"] != sot:
                issues.append("serialize_event_billing.is_debt")
            if state["is_debt"] != sot:
                issues.append("get_lesson_financial_state.is_debt")
            if badge_debt != sot:
                issues.append("event_billing_badge.is_debt")
            if sot and Decimal(str(account.get("debt_amount") or 0)) <= 0:
                issues.append("serialize_account.debt_amount")
            if sot and not account_lists_as_unpaid and Decimal(str(serialized.get("due_amount") or 0)) > 0:
                issues.append("serialize_account.unpaid_lessons")
            if issues:
                mismatches.append(
                    {
                        "record_id": str(rec.id),
                        "event_id": rec.event_id,
                        "student_id": rec.student_id,
                        "delivery_status": rec.delivery_status,
                        "financial_status": rec.financial_status,
                        "sot_is_debt": sot,
                        "state_code": state.get("state_code"),
                        "issues": issues,
                    }
                )
        scanned = min(limit, EventBillingRecord.objects.count())
        return {
            "generated_at": timezone.now().isoformat(),
            "scanned": scanned,
            "mismatch_count": len(mismatches),
            "mismatches": mismatches[:100],
        }

    def _print_summary(self, report: dict) -> None:
        self.stdout.write(f"scanned={report['scanned']}")
        self.stdout.write(f"mismatches={report['mismatch_count']}")
        if report["mismatch_count"]:
            self.stdout.write(self.style.WARNING("Есть расхождения read-model — см. JSON."))
        else:
            self.stdout.write(self.style.SUCCESS("Дашборд/карточка/бейдж совпадают с record_is_debt()."))
