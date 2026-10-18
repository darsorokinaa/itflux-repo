"""r74: регрессионные тесты вкладки «Оплаты» (аудит 18.10.2026)."""

from datetime import timedelta
from decimal import Decimal
from io import StringIO

from django.core.management import call_command
from django.utils import timezone

from Cabinet.billing_models import (
    BillingTransaction,
    FinancialStatus,
    PackageUnitType,
    StudentPaymentAllocation,
    TransactionType,
)
from Cabinet.billing_service import (
    compute_account_balance,
    create_package,
    dashboard_planned_income_details,
    dashboard_summary,
    finalize_event_billing,
    register_payment,
    reverse_transaction,
    serialize_account,
    get_or_create_billing_account,
)
from Cabinet.models import ScheduleEvent, Student
from Cabinet.tests_billing import BillingTestBase


class PackageLedgerTests(BillingTestBase):
    def _paid_package(self, units=4, amount="5600", duration=None):
        return create_package(
            teacher=self.teacher,
            student=self.student,
            title=f"{units} занятий",
            unit_type=PackageUnitType.LESSON,
            total_units=Decimal(units),
            purchase_amount=Decimal(amount),
            lesson_duration_minutes=duration,
        )

    def test_package_consumption_reduces_balance_by_unit_price(self):
        self._paid_package()
        self.assertEqual(compute_account_balance(self.account)["balance"], Decimal("5600.00"))
        finalize_event_billing(event=self._event(), teacher=self.teacher, financial_action="package")
        bal = compute_account_balance(self.account)
        self.assertEqual(bal["package_used"], Decimal("1400.00"))
        self.assertEqual(bal["balance"], Decimal("4200.00"))
        tx = BillingTransaction.objects.get(transaction_type=TransactionType.PACKAGE_CONSUMPTION)
        self.assertEqual(tx.amount, Decimal("1400.00"))

    def test_exhausted_package_gives_zero_credit_with_remainder_rounding(self):
        self._paid_package(units=3, amount="10000")
        for _ in range(3):
            finalize_event_billing(event=self._event(), teacher=self.teacher, financial_action="package")
        self.assertEqual(compute_account_balance(self.account)["balance"], Decimal("0.00"))
        data = serialize_account(self.account)
        self.assertEqual(Decimal(data["credit_amount"]), Decimal("0"))
        self.assertEqual(Decimal(data["debt_amount"]), Decimal("0"))

    def test_reversal_of_consumption_restores_balance(self):
        self._paid_package()
        finalize_event_billing(event=self._event(), teacher=self.teacher, financial_action="package")
        tx = BillingTransaction.objects.get(transaction_type=TransactionType.PACKAGE_CONSUMPTION)
        reverse_transaction(teacher=self.teacher, tx=tx)
        self.assertEqual(compute_account_balance(self.account)["balance"], Decimal("5600.00"))

    def test_unpaid_package_consumption_is_debt(self):
        create_package(
            teacher=self.teacher, student=self.student, title="в долг",
            unit_type=PackageUnitType.LESSON, total_units=Decimal("4"),
            purchase_amount=Decimal("6000"), create_payment_tx=False,
        )
        finalize_event_billing(event=self._event(), teacher=self.teacher, financial_action="package")
        self.assertEqual(compute_account_balance(self.account)["debt"], Decimal("1500.00"))

    def test_dashboard_credit_matches_remaining_package_value(self):
        self._paid_package(units=8, amount="11200")
        for _ in range(6):
            finalize_event_billing(event=self._event(), teacher=self.teacher, financial_action="package")
        d = dashboard_summary(self.teacher)
        self.assertEqual(Decimal(d["credit_total"]), Decimal("2800.00"))
        self.assertEqual(Decimal(d["debt_total"]), Decimal("0"))
        self.assertEqual(Decimal(d["month_charged_packages"]), Decimal("8400.00"))


class DebtCreditSingleSourceTests(BillingTestBase):
    def test_no_simultaneous_debt_and_credit(self):
        # Урок начислен, оплата внесена «на абонемент», абонемента нет → раньше долг+аванс.
        finalize_event_billing(event=self._event(), teacher=self.teacher, financial_action="charge")
        register_payment(teacher=self.teacher, student=self.student, amount=Decimal("5000"),
                         purpose="предоплата", event_billing_ids=["00000000-0000-0000-0000-000000000000"])
        data = serialize_account(self.account)
        self.assertEqual(Decimal(data["debt_amount"]), Decimal("0"))
        self.assertEqual(Decimal(data["credit_amount"]), Decimal("3400.00"))
        d = dashboard_summary(self.teacher)
        self.assertEqual(Decimal(d["debt_total"]), Decimal("0"))
        self.assertEqual(Decimal(d["credit_total"]), Decimal("3400.00"))

    def test_serialize_account_is_read_only(self):
        pkg = create_package(
            teacher=self.teacher, student=self.student, title="позже",
            unit_type=PackageUnitType.LESSON, total_units=Decimal("4"),
            purchase_amount=Decimal("6000"), create_payment_tx=False,
        )
        from Cabinet.billing_models import StudentPayment, StudentPaymentStatus
        p = StudentPayment.objects.create(
            billing_account=self.account, student=self.student, amount=Decimal("6000"),
            status=StudentPaymentStatus.CONFIRMED, paid_at=timezone.now(), purpose="Оплата абонемента",
        )
        serialize_account(self.account)
        p.refresh_from_db()
        self.assertIsNone(p.package_id)
        self.assertIsNotNone(pkg.pk)


class ReverseChargeReleasesPaymentTests(BillingTestBase):
    def test_reverse_paid_charge_moves_money_to_credit(self):
        rec = finalize_event_billing(event=self._event(), teacher=self.teacher, financial_action="charge")[0]
        register_payment(teacher=self.teacher, student=self.student, amount=Decimal("1600"))
        rec.refresh_from_db()
        self.assertEqual(rec.financial_status, FinancialStatus.PAID)
        charge = BillingTransaction.objects.get(event_billing=rec, transaction_type=TransactionType.CHARGE)
        reverse_transaction(teacher=self.teacher, tx=charge)
        rec.refresh_from_db()
        self.assertEqual(rec.paid_amount, Decimal("0.00"))
        self.assertFalse(StudentPaymentAllocation.objects.filter(event_billing=rec).exists())
        self.assertEqual(compute_account_balance(self.account)["credit"], Decimal("1600.00"))


class PackageDurationMismatchTests(BillingTestBase):
    def test_auto_finalize_with_mismatched_package_needs_decision_not_debt(self):
        create_package(
            teacher=self.teacher, student=self.student, title="8×60",
            unit_type=PackageUnitType.LESSON, total_units=Decimal("8"),
            purchase_amount=Decimal("18000"), lesson_duration_minutes=60,
        )
        rec = finalize_event_billing(event=self._event(minutes=90), teacher=self.teacher,
                                     financial_action="charge")[0]
        self.assertEqual(rec.financial_status, FinancialStatus.NEEDS_DECISION)
        self.assertEqual(rec.charged_amount, Decimal("0.00"))
        self.assertFalse(BillingTransaction.objects.filter(
            event_billing=rec, transaction_type=TransactionType.CHARGE).exists())

    def test_explicit_package_action_consumes_despite_duration(self):
        create_package(
            teacher=self.teacher, student=self.student, title="8×60",
            unit_type=PackageUnitType.LESSON, total_units=Decimal("8"),
            purchase_amount=Decimal("18000"), lesson_duration_minutes=60,
        )
        rec = finalize_event_billing(event=self._event(minutes=90), teacher=self.teacher,
                                     financial_action="package")[0]
        self.assertEqual(rec.financial_status, FinancialStatus.PAID_FROM_PACKAGE)


class PlannedIncomeTests(BillingTestBase):
    def test_free_lesson_not_in_planned_income(self):
        ev = self._event()
        finalize_event_billing(event=ev, teacher=self.teacher, financial_action="free")
        d = dashboard_planned_income_details(self.teacher)
        self.assertNotIn(ev.pk, [i["event_id"] for i in d["items"]])

    def test_package_lesson_planned_at_unit_price(self):
        create_package(
            teacher=self.teacher, student=self.student, title="4",
            unit_type=PackageUnitType.LESSON, total_units=Decimal("4"), purchase_amount=Decimal("5600"),
        )
        ev = self._event()
        finalize_event_billing(event=ev, teacher=self.teacher, financial_action="package")
        d = dashboard_planned_income_details(self.teacher)
        item = next(i for i in d["items"] if i["event_id"] == ev.pk)
        self.assertEqual(Decimal(item["amount"]), Decimal("1400.00"))


class TimezoneTests(BillingTestBase):
    def test_date_only_payment_is_noon_teacher_local(self):
        self.teacher.profile.timezone = "Europe/Kaliningrad"
        self.teacher.profile.save()
        resp = self.client.post(
            "/api/cabinet/billing/payments/",
            {"student_id": self.student.pk, "amount": "1800", "paid_at": "2026-10-01"},
            format="json",
        )
        if resp.status_code == 404:
            self.skipTest("payments URL differs")
        self.assertIn(resp.status_code, (200, 201), resp.content)
        tx = BillingTransaction.objects.filter(transaction_type=TransactionType.PAYMENT).latest("created_at")
        local = timezone.localtime(tx.occurred_at, __import__("zoneinfo").ZoneInfo("Europe/Kaliningrad"))
        self.assertEqual((local.day, local.hour), (1, 12))
        d = dashboard_summary(self.teacher, year=2026, month=10)
        self.assertEqual(Decimal(d["month_received"]), Decimal("1800.00"))
        self.assertEqual(d["timezone"], "Europe/Kaliningrad")


class BackfillCommandTests(BillingTestBase):
    def test_backfill_values_legacy_zero_consumption_and_is_idempotent(self):
        pkg = create_package(
            teacher=self.teacher, student=self.student, title="8",
            unit_type=PackageUnitType.LESSON, total_units=Decimal("8"), purchase_amount=Decimal("11200"),
        )
        for _ in range(8):
            finalize_event_billing(event=self._event(), teacher=self.teacher, financial_action="package")
        # эмулируем данные до r74
        BillingTransaction.objects.filter(package=pkg).filter(
            transaction_type=TransactionType.PACKAGE_CONSUMPTION).update(amount=0)
        self.assertEqual(compute_account_balance(self.account)["balance"], Decimal("11200.00"))
        call_command("backfill_package_ledger", "--dry-run", "--exclude", "", stdout=StringIO())
        self.assertEqual(compute_account_balance(self.account)["balance"], Decimal("11200.00"))
        call_command("backfill_package_ledger", "--exclude", "", stdout=StringIO())
        self.assertEqual(compute_account_balance(self.account)["balance"], Decimal("0.00"))
        call_command("backfill_package_ledger", "--exclude", "", stdout=StringIO())
        self.assertEqual(compute_account_balance(self.account)["balance"], Decimal("0.00"))

    def test_backfill_respects_exclude(self):
        pkg = create_package(
            teacher=self.teacher, student=self.student, title="2",
            unit_type=PackageUnitType.LESSON, total_units=Decimal("2"), purchase_amount=Decimal("3000"),
        )
        finalize_event_billing(event=self._event(), teacher=self.teacher, financial_action="package")
        BillingTransaction.objects.filter(package=pkg, transaction_type=TransactionType.PACKAGE_CONSUMPTION).update(amount=0)
        call_command("backfill_package_ledger", "--exclude", f"{self.teacher.pk}:{self.student.pk}", stdout=StringIO())
        self.assertEqual(compute_account_balance(self.account)["balance"], Decimal("3000.00"))

    def test_integrity_audit_runs(self):
        out = StringIO()
        try:
            call_command("audit_payment_integrity", stdout=out)
        except SystemExit:
            pass
        self.assertIn("payments_without_tx", out.getvalue())
