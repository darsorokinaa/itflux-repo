"""Тесты управленческого учёта оплат репетитора."""

from datetime import timedelta
from decimal import Decimal
from unittest.mock import patch

from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from Cabinet.billing_models import (
    BillingTransaction,
    BillingType,
    DeliveryStatus,
    EventBillingRecord,
    FinancialStatus,
    PackageStatus,
    PackageUnitType,
    TransactionType,
)
from Cabinet.billing_service import (
    BillingError,
    auto_finalize_after_lesson_complete,
    calculate_lesson_price,
    cancel_package,
    compute_account_balance,
    create_package,
    dashboard_summary,
    finalize_event_billing,
    get_or_create_billing_account,
    preview_finalize,
    register_payment,
    reverse_transaction,
    apply_cancel_billing,
    apply_no_show,
    serialize_account,
    unfinalize_event_billing,
    update_student_settings,
    update_teacher_settings,
)
from Cabinet.models import Profile, ScheduleEvent, Student, StudentGroup


class BillingTestBase(TestCase):
    def setUp(self):
        self.teacher = User.objects.create_user(
            username="bill_teacher", email="bt@test.ru", password="StrongPass123!"
        )
        self.teacher.profile.role = Profile.Role.TEACHER
        self.teacher.profile.save()

        self.other_teacher = User.objects.create_user(
            username="bill_other", email="bo@test.ru", password="StrongPass123!"
        )
        self.other_teacher.profile.role = Profile.Role.TEACHER
        self.other_teacher.profile.save()

        self.student_user = User.objects.create_user(
            username="bill_student", email="bs@test.ru", password="StrongPass123!"
        )
        self.student_user.profile.role = Profile.Role.STUDENT
        self.student_user.profile.save()

        self.student = Student.objects.create(
            teacher=self.teacher,
            user=self.student_user,
            first_name="Анна",
            last_name="Иванова",
            direction="oge",
        )
        self.account = get_or_create_billing_account(self.teacher, self.student)
        settings = self.account.settings
        settings.billing_type = BillingType.PER_LESSON
        settings.default_lesson_price = Decimal("1600.00")
        settings.save()

        self.client = APIClient()
        self.client.force_login(self.teacher)

    def _event(self, minutes=60, student="__default__", group=None, **kwargs):
        starts = timezone.now() - timedelta(hours=1)
        ends = starts + timedelta(minutes=minutes)
        student_obj = self.student if student == "__default__" else student
        return ScheduleEvent.objects.create(
            owner=self.teacher,
            title="Урок",
            starts_at=starts,
            ends_at=ends,
            student=student_obj,
            group=group,
            event_type=(
                ScheduleEvent.EventType.GROUP_LESSON
                if group is not None
                else ScheduleEvent.EventType.INDIVIDUAL_LESSON
            ),
            status=ScheduleEvent.Status.PLANNED,
            **kwargs,
        )


class PriceCalculationTests(BillingTestBase):
    def test_per_lesson_price(self):
        price = calculate_lesson_price(account=self.account, duration_minutes=60)
        self.assertEqual(price["amount"], Decimal("1600.00"))
        self.assertIn("индивидуальная цена", price["price_source_label"])

    def test_hourly_90_minutes(self):
        s = self.account.settings
        s.billing_type = BillingType.PER_HOUR
        s.hourly_rate = Decimal("1600.00")
        s.save()
        price = calculate_lesson_price(account=self.account, duration_minutes=90)
        self.assertEqual(price["amount"], Decimal("2400.00"))

    def test_30_minutes_hourly(self):
        s = self.account.settings
        s.billing_type = BillingType.PER_HOUR
        s.hourly_rate = Decimal("1600.00")
        s.save()
        price = calculate_lesson_price(account=self.account, duration_minutes=30)
        self.assertEqual(price["amount"], Decimal("800.00"))

    def test_individual_override(self):
        price = calculate_lesson_price(
            account=self.account, duration_minutes=60, override_amount=Decimal("999")
        )
        self.assertEqual(price["amount"], Decimal("999.00"))
        self.assertEqual(price["price_source"], "manual")

    def test_tariff_change_does_not_change_old_snapshot(self):
        event = self._event()
        records = finalize_event_billing(
            event=event,
            teacher=self.teacher,
            financial_action="charge",
            idempotency_key="t1",
        )
        charged = records[0].charged_amount
        s = self.account.settings
        s.default_lesson_price = Decimal("3000.00")
        s.save()
        records[0].refresh_from_db()
        self.assertEqual(records[0].charged_amount, charged)
        self.assertEqual(charged, Decimal("1600.00"))


class PaymentFlowTests(BillingTestBase):
    def test_full_payment(self):
        event = self._event()
        finalize_event_billing(
            event=event, teacher=self.teacher, financial_action="charge", idempotency_key="p1"
        )
        register_payment(
            teacher=self.teacher,
            student=self.student,
            amount=Decimal("1600"),
        )
        bal = compute_account_balance(self.account)
        self.assertEqual(bal["balance"], Decimal("0.00"))

    def test_partial_payment(self):
        event = self._event()
        finalize_event_billing(
            event=event, teacher=self.teacher, financial_action="charge", idempotency_key="p2"
        )
        register_payment(teacher=self.teacher, student=self.student, amount=Decimal("800"))
        bal = compute_account_balance(self.account)
        self.assertEqual(bal["debt"], Decimal("800.00"))

    def test_one_payment_several_lessons(self):
        e1 = self._event()
        e2 = self._event()
        r1 = finalize_event_billing(
            event=e1, teacher=self.teacher, financial_action="charge", idempotency_key="m1"
        )[0]
        r2 = finalize_event_billing(
            event=e2, teacher=self.teacher, financial_action="charge", idempotency_key="m2"
        )[0]
        register_payment(
            teacher=self.teacher,
            student=self.student,
            amount=Decimal("3200"),
            event_billing_ids=[str(r1.id), str(r2.id)],
        )
        r1.refresh_from_db()
        r2.refresh_from_db()
        self.assertEqual(r1.financial_status, FinancialStatus.PAID)
        self.assertEqual(r2.financial_status, FinancialStatus.PAID)

    def test_several_payments_one_lesson(self):
        event = self._event()
        r = finalize_event_billing(
            event=event, teacher=self.teacher, financial_action="charge", idempotency_key="s1"
        )[0]
        register_payment(
            teacher=self.teacher,
            student=self.student,
            amount=Decimal("600"),
            event_billing_ids=[r.id],
        )
        register_payment(
            teacher=self.teacher,
            student=self.student,
            amount=Decimal("1000"),
            event_billing_ids=[r.id],
        )
        r.refresh_from_db()
        self.assertEqual(r.paid_amount, Decimal("1600.00"))
        self.assertEqual(r.financial_status, FinancialStatus.PAID)

    def test_overpayment(self):
        event = self._event()
        finalize_event_billing(
            event=event, teacher=self.teacher, financial_action="charge", idempotency_key="o1"
        )
        register_payment(teacher=self.teacher, student=self.student, amount=Decimal("2000"))
        bal = compute_account_balance(self.account)
        self.assertEqual(bal["credit"], Decimal("400.00"))

    def test_refund_and_reverse(self):
        from Cabinet.billing_service import create_refund

        register_payment(teacher=self.teacher, student=self.student, amount=Decimal("1600"))
        tx = create_refund(
            teacher=self.teacher, student=self.student, amount=Decimal("500"), comment="return"
        )
        self.assertEqual(tx.transaction_type, TransactionType.REFUND)
        bal = compute_account_balance(self.account)
        self.assertEqual(bal["balance"], Decimal("1100.00"))

        from Cabinet.billing_models import BillingTransaction

        pay_tx = BillingTransaction.objects.filter(
            billing_account=self.account, transaction_type=TransactionType.PAYMENT
        ).first()
        reverse_transaction(teacher=self.teacher, tx=pay_tx, comment="ошибка")
        bal2 = compute_account_balance(self.account)
        # payment reversed (-1600) + refund 500 still counted as refund outflow
        self.assertEqual(bal2["paid"], Decimal("0.00"))

    def test_month_received_nets_reversals(self):
        register_payment(teacher=self.teacher, student=self.student, amount=Decimal("2000"))
        register_payment(teacher=self.teacher, student=self.student, amount=Decimal("1700"))
        pay_tx = (
            BillingTransaction.objects.filter(
                billing_account=self.account,
                transaction_type=TransactionType.PAYMENT,
                amount=Decimal("2000"),
                is_reversal=False,
            ).first()
        )
        reverse_transaction(teacher=self.teacher, tx=pay_tx, comment="Дубликат оплаты")
        summary = dashboard_summary(self.teacher)
        self.assertEqual(Decimal(summary["month_received"]), Decimal("1700.00"))
        self.assertEqual(Decimal(summary["today_received"]), Decimal("1700.00"))


class PackageTests(BillingTestBase):
    def test_package_lessons(self):
        s = self.account.settings
        s.billing_type = BillingType.PACKAGE_LESSONS
        s.save()
        pkg = create_package(
            teacher=self.teacher,
            student=self.student,
            title="8 занятий",
            unit_type=PackageUnitType.LESSON,
            total_units=Decimal("8"),
            purchase_amount=Decimal("12000"),
        )
        event = self._event(minutes=90)
        records = finalize_event_billing(
            event=event,
            teacher=self.teacher,
            financial_action="package",
            idempotency_key="pkg1",
        )
        pkg.refresh_from_db()
        self.assertEqual(pkg.remaining_units, Decimal("7.00"))
        self.assertEqual(records[0].financial_status, FinancialStatus.PAID_FROM_PACKAGE)

    def test_orphan_payment_reconciles_to_awaiting_package(self):
        """Оплата без package_id должна закрыть абонемент «ожидает оплаты»."""
        from Cabinet.billing_service import package_display_status, serialize_package

        pkg = create_package(
            teacher=self.teacher,
            student=self.student,
            title="2 занятия",
            unit_type=PackageUnitType.LESSON,
            total_units=Decimal("2"),
            purchase_amount=Decimal("3000"),
            create_payment_tx=False,
        )
        code, label = package_display_status(pkg)
        self.assertEqual(code, "awaiting_payment")

        register_payment(
            teacher=self.teacher,
            student=self.student,
            amount=Decimal("3000"),
            purpose="Оплата уроков",
        )
        data = serialize_package(pkg)
        self.assertEqual(Decimal(data["paid_amount"]), Decimal("3000.00"))
        self.assertNotEqual(data["display_status"], "awaiting_payment")
        self.assertTrue(data["is_paid"])

    def test_reconcile_existing_orphan_payment_on_serialize(self):
        from Cabinet.billing_models import StudentPayment, StudentPaymentStatus
        from Cabinet.billing_service import serialize_account

        pkg = create_package(
            teacher=self.teacher,
            student=self.student,
            title="2 занятия",
            unit_type=PackageUnitType.LESSON,
            total_units=Decimal("2"),
            purchase_amount=Decimal("3000"),
            create_payment_tx=False,
        )
        # Старая оплата без привязки к абонементу.
        StudentPayment.objects.create(
            billing_account=self.account,
            student=self.student,
            amount=Decimal("3000"),
            currency="RUB",
            paid_at=timezone.now(),
            purpose="Оплата",
            status=StudentPaymentStatus.CONFIRMED,
            package=None,
            created_by=self.teacher,
        )
        data = serialize_account(self.account)
        self.assertIsNotNone(data["package"])
        self.assertEqual(Decimal(data["package"]["paid_amount"]), Decimal("3000.00"))
        self.assertNotEqual(data["package"]["display_status"], "awaiting_payment")

    def test_create_package_switches_billing_type_and_preview(self):
        """Абонемент должен предлагать списание, даже если раньше был тариф «за урок»."""
        self.assertEqual(self.account.settings.billing_type, BillingType.PER_LESSON)
        pkg = create_package(
            teacher=self.teacher,
            student=self.student,
            title="8 занятий",
            unit_type=PackageUnitType.LESSON,
            total_units=Decimal("8"),
            purchase_amount=Decimal("12000"),
        )
        self.account.settings.refresh_from_db()
        self.assertEqual(self.account.settings.billing_type, BillingType.PACKAGE_LESSONS)
        event = self._event(minutes=60)
        preview = preview_finalize(event, self.teacher)
        self.assertEqual(preview[0]["suggested_action"], "package")
        self.assertEqual(preview[0]["package"]["id"], str(pkg.id))
        records = finalize_event_billing(
            event=event,
            teacher=self.teacher,
            financial_action="package",
            idempotency_key="pkg-switch",
        )
        pkg.refresh_from_db()
        self.assertEqual(pkg.remaining_units, Decimal("7.00"))
        self.assertEqual(records[0].financial_status, FinancialStatus.PAID_FROM_PACKAGE)

    def test_package_history_and_cancel(self):
        pkg = create_package(
            teacher=self.teacher,
            student=self.student,
            title="4 занятия",
            unit_type=PackageUnitType.LESSON,
            total_units=Decimal("4"),
            purchase_amount=Decimal("6000"),
        )
        event = self._event(minutes=60)
        finalize_event_billing(
            event=event,
            teacher=self.teacher,
            financial_action="package",
            idempotency_key="pkg-hist",
        )
        data = serialize_account(self.account, include_history=True)
        self.assertEqual(len(data["package_history"]), 1)
        self.assertEqual(data["package_history"][0]["transaction_type"], "package_consumption")
        cancel_package(self.teacher, pkg)
        pkg.refresh_from_db()
        self.assertEqual(pkg.status, PackageStatus.CANCELLED)
        self.account.settings.refresh_from_db()
        self.assertEqual(self.account.settings.billing_type, BillingType.PER_LESSON)

    def test_package_minutes(self):
        s = self.account.settings
        s.billing_type = BillingType.PACKAGE_MINUTES
        s.save()
        pkg = create_package(
            teacher=self.teacher,
            student=self.student,
            title="300 минут",
            unit_type=PackageUnitType.MINUTE,
            total_units=Decimal("300"),
            purchase_amount=Decimal("10000"),
        )
        event = self._event(minutes=90)
        finalize_event_billing(
            event=event,
            teacher=self.teacher,
            financial_action="package",
            actual_duration_minutes=90,
            idempotency_key="pkgm1",
        )
        pkg.refresh_from_db()
        self.assertEqual(pkg.remaining_units, Decimal("210.00"))

    def test_insufficient_package_blocked_when_negative_disallowed(self):
        from Cabinet.billing_service import get_or_create_teacher_settings, consume_package

        ts = get_or_create_teacher_settings(self.teacher)
        ts.allow_negative_balance = False
        ts.save()
        pkg = create_package(
            teacher=self.teacher,
            student=self.student,
            title="1 урок",
            unit_type=PackageUnitType.LESSON,
            total_units=Decimal("1"),
            purchase_amount=Decimal("1600"),
            create_payment_tx=False,
        )
        consume_package(
            package=pkg,
            units=Decimal("1"),
            account=self.account,
            student=self.student,
            created_by=self.teacher,
        )
        with self.assertRaises(BillingError):
            consume_package(
                package=pkg,
                units=Decimal("1"),
                account=self.account,
                student=self.student,
                created_by=self.teacher,
            )

    def test_no_double_consume_idempotent(self):
        s = self.account.settings
        s.billing_type = BillingType.PACKAGE_LESSONS
        s.save()
        pkg = create_package(
            teacher=self.teacher,
            student=self.student,
            title="4",
            unit_type=PackageUnitType.LESSON,
            total_units=Decimal("4"),
            purchase_amount=Decimal("6000"),
        )
        event = self._event()
        finalize_event_billing(
            event=event,
            teacher=self.teacher,
            financial_action="package",
            idempotency_key="idem-1",
        )
        with self.assertRaises(BillingError):
            finalize_event_billing(
                event=event,
                teacher=self.teacher,
                financial_action="package",
                idempotency_key="idem-2",
            )
        # same key should be idempotent no-op
        finalize_event_billing(
            event=event,
            teacher=self.teacher,
            financial_action="package",
            idempotency_key="idem-1",
        )
        pkg.refresh_from_db()
        self.assertEqual(pkg.remaining_units, Decimal("3.00"))

    def test_auto_debit_on_charge_action_without_tariff_switch(self):
        """Даже при financial_action=charge активный абонемент списывается, долг не создаётся."""
        pkg = create_package(
            teacher=self.teacher,
            student=self.student,
            title="8",
            unit_type=PackageUnitType.LESSON,
            total_units=Decimal("8"),
            purchase_amount=Decimal("8000"),
            create_payment_tx=False,
        )
        event = self._event()
        records = finalize_event_billing(
            event=event,
            teacher=self.teacher,
            financial_action="charge",
            idempotency_key="auto-pkg",
        )
        pkg.refresh_from_db()
        self.assertEqual(pkg.remaining_units, Decimal("7.00"))
        self.assertEqual(records[0].financial_status, FinancialStatus.PAID_FROM_PACKAGE)
        self.assertEqual(records[0].charged_amount, Decimal("0.00"))

    def test_no_package_creates_unpaid_debt(self):
        event = self._event()
        records = finalize_event_billing(
            event=event,
            teacher=self.teacher,
            financial_action="charge",
            idempotency_key="debt-1",
        )
        self.assertEqual(records[0].financial_status, FinancialStatus.AWAITING_PAYMENT)
        self.assertGreater(records[0].charged_amount, 0)
        data = serialize_account(self.account)
        self.assertEqual(data["unpaid_lessons_count"], 1)
        self.assertGreater(Decimal(data["unpaid_lessons_amount"]), 0)

    def test_unfinalize_returns_package_unit(self):
        pkg = create_package(
            teacher=self.teacher,
            student=self.student,
            title="4",
            unit_type=PackageUnitType.LESSON,
            total_units=Decimal("4"),
            purchase_amount=Decimal("4000"),
        )
        event = self._event()
        finalize_event_billing(
            event=event,
            teacher=self.teacher,
            financial_action="package",
            idempotency_key="uf-1",
        )
        pkg.refresh_from_db()
        self.assertEqual(pkg.remaining_units, Decimal("3.00"))
        unfinalize_event_billing(event=event, teacher=self.teacher)
        pkg.refresh_from_db()
        self.assertEqual(pkg.remaining_units, Decimal("4.00"))
        record = EventBillingRecord.objects.get(event=event, student=self.student)
        self.assertIsNone(record.finalized_at)
        self.assertEqual(record.financial_status, FinancialStatus.NOT_CHARGED)

    def test_auto_finalize_after_complete(self):
        pkg = create_package(
            teacher=self.teacher,
            student=self.student,
            title="4",
            unit_type=PackageUnitType.LESSON,
            total_units=Decimal("4"),
            purchase_amount=Decimal("4000"),
        )
        event = self._event()
        auto_finalize_after_lesson_complete(event=event, teacher=self.teacher)
        auto_finalize_after_lesson_complete(event=event, teacher=self.teacher)
        pkg.refresh_from_db()
        self.assertEqual(pkg.remaining_units, Decimal("3.00"))


class CancelNoShowTests(BillingTestBase):
    def test_late_cancel_with_charge(self):
        event = self._event()
        records = apply_cancel_billing(
            event=event,
            teacher=self.teacher,
            cancelled_by="student",
            financial_action="charge",
            idempotency_key="c1",
        )
        self.assertEqual(records[0].delivery_status, DeliveryStatus.CANCELLED_BY_STUDENT)
        self.assertEqual(records[0].charged_amount, Decimal("1600.00"))

    def test_cancel_without_charge(self):
        event = self._event()
        records = apply_cancel_billing(
            event=event,
            teacher=self.teacher,
            cancelled_by="student",
            financial_action="skip",
            idempotency_key="c2",
        )
        self.assertEqual(records[0].financial_status, FinancialStatus.NOT_BILLABLE)

    def test_teacher_cancel_return_package(self):
        s = self.account.settings
        s.billing_type = BillingType.PACKAGE_LESSONS
        s.save()
        pkg = create_package(
            teacher=self.teacher,
            student=self.student,
            title="4",
            unit_type=PackageUnitType.LESSON,
            total_units=Decimal("4"),
            purchase_amount=Decimal("6000"),
        )
        event = self._event()
        finalize_event_billing(
            event=event,
            teacher=self.teacher,
            financial_action="package",
            idempotency_key="ret1",
        )
        pkg.refresh_from_db()
        self.assertEqual(pkg.remaining_units, Decimal("3.00"))
        # Simulate return via cancel
        record = EventBillingRecord.objects.get(event=event)
        apply_cancel_billing(
            event=event,
            teacher=self.teacher,
            cancelled_by="teacher",
            financial_action="return_package",
            idempotency_key="ret2",
        )
        pkg.refresh_from_db()
        # return_package path returns units if package_units set
        record.refresh_from_db()
        self.assertEqual(pkg.remaining_units, Decimal("4.00"))

    def test_no_show(self):
        event = self._event()
        records = apply_no_show(
            event=event,
            teacher=self.teacher,
            financial_action="charge",
            idempotency_key="ns1",
        )
        self.assertEqual(records[0].delivery_status, DeliveryStatus.NO_SHOW)

    def test_reschedule_no_finance(self):
        event = self._event()
        records = finalize_event_billing(
            event=event,
            teacher=self.teacher,
            delivery_status=DeliveryStatus.RESCHEDULED,
            financial_action="skip",
            idempotency_key="rs1",
        )
        self.assertEqual(records[0].financial_status, FinancialStatus.NOT_BILLABLE)
        event.refresh_from_db()
        self.assertEqual(event.status, ScheduleEvent.Status.MOVED)


class GroupAndMonthlyTests(BillingTestBase):
    def test_group_different_prices(self):
        s2 = Student.objects.create(
            teacher=self.teacher, first_name="Иван", last_name="Петров"
        )
        s3 = Student.objects.create(
            teacher=self.teacher, first_name="Мария", last_name="Сидорова"
        )
        group = StudentGroup.objects.create(teacher=self.teacher, title="Группа")
        group.students.add(self.student, s2, s3)

        a2 = get_or_create_billing_account(self.teacher, s2)
        a2.settings.default_lesson_price = Decimal("900")
        a2.settings.save()
        a3 = get_or_create_billing_account(self.teacher, s3)
        a3.settings.default_lesson_price = Decimal("0")
        a3.settings.save()

        # package for Anna
        self.account.settings.billing_type = BillingType.PACKAGE_LESSONS
        self.account.settings.save()
        create_package(
            teacher=self.teacher,
            student=self.student,
            title="пакет",
            unit_type=PackageUnitType.LESSON,
            total_units=Decimal("4"),
            purchase_amount=Decimal("5000"),
        )

        event = self._event(student=None, group=group)

        finalize_event_billing(
            event=event,
            teacher=self.teacher,
            student=self.student,
            financial_action="package",
            idempotency_key="g1",
        )
        finalize_event_billing(
            event=event,
            teacher=self.teacher,
            student=s2,
            financial_action="charge",
            idempotency_key="g2",
        )
        finalize_event_billing(
            event=event,
            teacher=self.teacher,
            student=s3,
            financial_action="free",
            idempotency_key="g3",
        )
        statuses = {
            r.student_id: r.financial_status
            for r in EventBillingRecord.objects.filter(event=event)
        }
        self.assertEqual(statuses[self.student.id], FinancialStatus.PAID_FROM_PACKAGE)
        self.assertEqual(statuses[s2.id], FinancialStatus.AWAITING_PAYMENT)
        self.assertEqual(statuses[s3.id], FinancialStatus.NOT_BILLABLE)

    def test_monthly_fixed(self):
        s = self.account.settings
        s.billing_type = BillingType.MONTHLY_FIXED
        s.monthly_fee = Decimal("8000")
        s.monthly_includes_all_lessons = True
        s.save()
        event = self._event()
        records = finalize_event_billing(
            event=event,
            teacher=self.teacher,
            financial_action="charge",
            idempotency_key="mon1",
        )
        self.assertEqual(records[0].price_source, "monthly")
        bal = compute_account_balance(self.account)
        self.assertEqual(bal["charged"], Decimal("8000.00"))


class ApiPermissionTests(BillingTestBase):
    def test_student_cannot_create_payment(self):
        c = APIClient()
        c.force_login(self.student_user)
        resp = c.post(
            "/api/cabinet/billing/payments/",
            {"student_id": self.student.id, "amount": "100"},
            format="json",
        )
        self.assertIn(resp.status_code, (403, 401))

    def test_other_teacher_forbidden(self):
        c = APIClient()
        c.force_login(self.other_teacher)
        resp = c.get(f"/api/cabinet/billing/accounts/{self.account.id}/")
        self.assertEqual(resp.status_code, 404)

    def test_dashboard_ok(self):
        resp = self.client.get("/api/cabinet/billing/dashboard/")
        self.assertEqual(resp.status_code, 200)
        self.assertIn("month_received", resp.json())

    def test_create_payment_api(self):
        resp = self.client.post(
            "/api/cabinet/billing/payments/",
            {"student_id": self.student.id, "amount": "1600", "method": "transfer"},
            format="json",
        )
        self.assertEqual(resp.status_code, 201, resp.content)

    def test_create_package_api(self):
        resp = self.client.post(
            "/api/cabinet/billing/packages/",
            {
                "student_id": self.student.id,
                "title": "8 уроков",
                "unit_type": "lesson",
                "total_units": "8",
                "purchase_amount": "12000",
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 201, resp.content)

    def test_finalize_api_idempotent(self):
        event = self._event()
        payload = {
            "financial_action": "charge",
            "idempotency_key": "api-idem",
            "delivery_status": "conducted",
        }
        r1 = self.client.post(
            f"/api/cabinet/billing/events/{event.id}/finalize/", payload, format="json"
        )
        self.assertEqual(r1.status_code, 200, r1.content)
        r2 = self.client.post(
            f"/api/cabinet/billing/events/{event.id}/finalize/", payload, format="json"
        )
        self.assertEqual(r2.status_code, 200, r2.content)
        from Cabinet.billing_models import BillingTransaction

        charges = BillingTransaction.objects.filter(
            event=event, transaction_type=TransactionType.CHARGE, is_reversal=False
        ).count()
        self.assertEqual(charges, 1)

    @patch("Cabinet.billing_notifications.send_telegram_message", create=True)
    def test_telegram_reminder_no_new_invite_link(self, _mock):
        event = self._event()
        r = finalize_event_billing(
            event=event, teacher=self.teacher, financial_action="charge", idempotency_key="tg1"
        )[0]
        preview = self.client.post(
            "/api/cabinet/billing/reminders/preview/",
            {"account_id": self.account.id},
            format="json",
        )
        self.assertEqual(preview.status_code, 200)
        text = preview.json()["text"]
        self.assertNotIn("/invite/", text)
        self.assertIn("3200", text) if False else None  # amount depends
        self.assertIn(str(r.charged_amount).split(".")[0], text.replace(" ", ""))


class BillingSettingsEmptyValueTests(BillingTestBase):
    def test_student_settings_empty_decimals_clear_fields(self):
        update_student_settings(
            self.teacher,
            self.account,
            {
                "default_lesson_price": "",
                "hourly_rate": "",
                "billing_type": BillingType.PER_HOUR,
            },
        )
        self.account.settings.refresh_from_db()
        self.assertIsNone(self.account.settings.default_lesson_price)
        self.assertIsNone(self.account.settings.hourly_rate)
        self.assertEqual(self.account.settings.billing_type, BillingType.PER_HOUR)

    def test_student_settings_api_accepts_empty_price(self):
        resp = self.client.patch(
            f"/api/cabinet/billing/accounts/{self.account.id}/settings/",
            {"default_lesson_price": "", "hourly_rate": ""},
            format="json",
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        self.account.settings.refresh_from_db()
        self.assertIsNone(self.account.settings.default_lesson_price)
        self.assertIsNone(self.account.settings.hourly_rate)

    def test_teacher_settings_empty_decimals_clear_fields(self):
        update_teacher_settings(
            self.teacher,
            {"default_lesson_price": "", "hourly_rate": "2500"},
        )
        from Cabinet.billing_service import get_or_create_teacher_settings

        settings = get_or_create_teacher_settings(self.teacher)
        self.assertIsNone(settings.default_lesson_price)
        self.assertEqual(settings.hourly_rate, Decimal("2500.00"))


class ArchivedStudentBillingTests(BillingTestBase):
    def test_archived_student_hidden_from_accounts_list(self):
        resp = self.client.get("/api/cabinet/billing/accounts/")
        self.assertEqual(resp.status_code, 200)
        ids = {row["student_id"] for row in resp.json()}
        self.assertIn(self.student.id, ids)

        archive = self.client.patch(f"/api/cabinet/students/{self.student.id}/archive/")
        self.assertEqual(archive.status_code, 200, archive.content)

        self.account.refresh_from_db()
        self.assertFalse(self.account.is_active)

        resp = self.client.get("/api/cabinet/billing/accounts/")
        self.assertEqual(resp.status_code, 200)
        ids = {row["student_id"] for row in resp.json()}
        self.assertNotIn(self.student.id, ids)

    def test_cannot_create_billing_for_archived_student(self):
        # Существующий счёт архивного ученика можно прочитать.
        self.student.status = "archived"
        self.student.save(update_fields=["status", "updated_at"])
        existing = get_or_create_billing_account(self.teacher, self.student)
        self.assertEqual(existing.pk, self.account.pk)

        # Новый счёт для архивного ученика без истории создать нельзя.
        other = Student.objects.create(
            teacher=self.teacher,
            first_name="Arch",
            last_name="Ived",
            status="archived",
        )
        with self.assertRaises(BillingError):
            get_or_create_billing_account(self.teacher, other)

    def test_dashboard_ok_with_archived_student_events(self):
        """Плановый доход не должен ронять dashboard из‑за архивных учеников."""
        event = ScheduleEvent.objects.create(
            owner=self.teacher,
            student=self.student,
            title="Урок с архивным",
            starts_at=timezone.now(),
            ends_at=timezone.now() + timedelta(hours=1),
            event_type=ScheduleEvent.EventType.INDIVIDUAL,
            status=ScheduleEvent.Status.PLANNED,
        )
        self.student.status = "archived"
        self.student.save(update_fields=["status", "updated_at"])
        data = dashboard_summary(self.teacher)
        self.assertIn("planned_income", data)
        self.assertEqual(event.student_id, self.student.id)
