"""Тесты отложенного понижения тарифа (pending plan change)."""

from __future__ import annotations

from datetime import timedelta
from decimal import Decimal

from django.contrib.auth.models import User
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from Cabinet.choices import GroupStatus, StudentStatus
from Cabinet.models import (
    Notification,
    Payment,
    Profile,
    Student,
    StudentGroup,
    SubscriptionPlanChange,
    TariffPlan,
    TeacherSubscription,
)
from Cabinet.payment_service import PaymentProviderService
from Cabinet.subscription_downgrade import DowngradeService
from Cabinet.subscription_notifications import notify_subscription_expiry_reminder


def _teacher(username: str = "dg_teacher") -> User:
    user = User.objects.create_user(username=username, email=f"{username}@ex.com", password="x")
    profile = Profile.objects.get(user=user)
    profile.role = Profile.Role.TEACHER
    profile.account_active = True
    profile.account_blocked = False
    profile.save()
    # User.post_save пересохраняет user.profile — кэш должен совпадать с БД.
    user.profile = profile
    return user


def _plan(slug: str, price: str, **extra) -> TariffPlan:
    defaults = {
        "name": {"start": "Старт", "teacher": "Учитель", "pro": "Профи", "premium": "Премиум"}.get(
            slug, slug.title()
        ),
        "price_month": Decimal(price),
        "price_year": Decimal(price) * 10,
        "currency": "RUB",
        "is_active": True,
        "is_public": True,
        "is_free": Decimal(price) == 0,
        "cta_type": TariffPlan.CtaType.CHECKOUT,
        "sort_order": 10,
        "max_students": {"start": 5, "teacher": 10, "pro": 20, "premium": 30}.get(slug, 5),
        "max_groups": {"start": 0, "teacher": 5, "pro": 10, "premium": None}.get(slug, 0),
        "max_storage_mb": {"start": 512, "teacher": 1024, "pro": 3072, "premium": 10240}.get(
            slug, 512
        ),
        "content_access_rank": {"start": 0, "teacher": 1, "pro": 2, "premium": 3}.get(slug, 0),
        "has_analytics": slug in ("pro", "premium"),
        "has_mass_actions": slug in ("pro", "premium"),
        "has_simulators": slug in ("pro", "premium"),
        "has_priority_support": slug == "premium",
        "has_extended_library": slug in ("teacher", "pro", "premium"),
    }
    defaults.update(extra)
    plan, _ = TariffPlan.objects.update_or_create(slug=slug, defaults=defaults)
    return plan


@override_settings(PAYMENT_PROVIDER="mock", DEBUG=True, PAYMENTS_ENABLED=True)
class DowngradeScheduleTests(TestCase):
    def setUp(self):
        self.teacher = _teacher()
        self.start = _plan("start", "0")
        self.teacher_plan = _plan("teacher", "1490")
        self.pro = _plan("pro", "2990")
        self.premium = _plan("premium", "3990")
        self.expires = timezone.now() + timedelta(days=16)
        self.sub = TeacherSubscription.objects.create(
            teacher=self.teacher,
            plan=self.premium,
            status=TeacherSubscription.Status.ACTIVE,
            expires_at=self.expires,
            auto_renew=True,
            tbank_rebill_id="rebill-dg-1",
            tbank_customer_key="teacher_dg",
            billing_period="month",
            source=TeacherSubscription.Source.PAYMENT,
        )
        self.client = APIClient()
        self.client.force_login(self.teacher)

    def test_premium_to_pro_not_applied_immediately(self):
        result = DowngradeService.schedule(self.teacher, self.pro)
        self.assertTrue(result["ok"])
        self.sub.refresh_from_db()
        self.assertEqual(self.sub.plan_id, self.premium.pk)
        self.assertEqual(self.sub.scheduled_plan_id, self.pro.pk)
        self.assertEqual(self.sub.scheduled_change_at, self.expires)
        change = DowngradeService.get_active_change(self.sub)
        self.assertEqual(change.status, SubscriptionPlanChange.Status.PENDING)
        self.assertEqual(change.to_plan_id, self.pro.pk)

    def test_start_disables_auto_renew(self):
        DowngradeService.schedule(self.teacher, self.start)
        self.sub.refresh_from_db()
        self.assertFalse(self.sub.auto_renew)
        self.assertEqual(self.sub.plan_id, self.premium.pk)
        change = DowngradeService.get_active_change(self.sub)
        self.assertTrue(change.to_plan.is_free or change.to_plan.slug == "start")

    def test_cancel_pending_clears_mirror(self):
        DowngradeService.schedule(self.teacher, self.pro)
        DowngradeService.cancel(self.teacher)
        self.sub.refresh_from_db()
        self.assertIsNone(self.sub.scheduled_plan_id)
        self.assertIsNone(DowngradeService.get_active_change(self.sub))
        self.assertEqual(
            SubscriptionPlanChange.objects.filter(
                subscription=self.sub, status=SubscriptionPlanChange.Status.CANCELED
            ).count(),
            1,
        )

    def test_cancel_prepaid_rejected(self):
        DowngradeService.schedule(self.teacher, self.pro)
        payment = Payment.objects.create(
            teacher=self.teacher,
            plan=self.pro,
            amount=Decimal("2990"),
            final_amount=Decimal("2990"),
            currency="RUB",
            status=Payment.Status.PAID,
            billing_period="month",
            provider="mock",
        )
        DowngradeService.mark_prepaid(self.sub, payment, self.pro)
        with self.assertRaises(ValueError):
            DowngradeService.cancel(self.teacher)
        self.sub.refresh_from_db()
        self.assertEqual(self.sub.plan_id, self.premium.pk)
        self.assertIsNotNone(self.sub.prepaid_until)
        self.assertEqual(
            DowngradeService.get_active_change(self.sub).status,
            SubscriptionPlanChange.Status.PREPAID,
        )

    def test_replace_pending_keeps_single_active(self):
        DowngradeService.schedule(self.teacher, self.pro)
        DowngradeService.schedule(self.teacher, self.teacher_plan)
        active = list(
            SubscriptionPlanChange.objects.filter(
                subscription=self.sub,
                status__in=[
                    SubscriptionPlanChange.Status.PENDING,
                    SubscriptionPlanChange.Status.PREPAID,
                ],
            )
        )
        self.assertEqual(len(active), 1)
        self.assertEqual(active[0].to_plan_id, self.teacher_plan.pk)
        self.assertEqual(
            SubscriptionPlanChange.objects.filter(
                subscription=self.sub, status=SubscriptionPlanChange.Status.SUPERSEDED
            ).count(),
            1,
        )

    def test_api_change_plan_returns_preview_without_confirm(self):
        resp = self.client.post(
            "/api/cabinet/subscription/change-plan/",
            {"plan_slug": "pro", "billing_period": "month"},
            format="json",
        )
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.data.get("requires_downgrade_confirm"))
        self.sub.refresh_from_db()
        self.assertEqual(self.sub.plan_id, self.premium.pk)
        self.assertIsNone(self.sub.scheduled_plan_id)

    def test_api_confirm_schedules_downgrade(self):
        resp = self.client.post(
            "/api/cabinet/subscription/change-plan/",
            {"plan_slug": "pro", "billing_period": "month", "confirm": True},
            format="json",
        )
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.data.get("scheduled"))
        self.sub.refresh_from_db()
        self.assertEqual(self.sub.scheduled_plan.slug, "pro")

    def test_cancel_pending_api(self):
        DowngradeService.schedule(self.teacher, self.pro)
        resp = self.client.post(
            "/api/cabinet/subscription/cancel-pending-plan/",
            {},
            format="json",
        )
        self.assertEqual(resp.status_code, 200)
        self.sub.refresh_from_db()
        self.assertIsNone(self.sub.scheduled_plan_id)

    def test_referral_days_shift_effective_at(self):
        DowngradeService.schedule(self.teacher, self.pro)
        new_end = self.expires + timedelta(days=14)
        self.sub.expires_at = new_end
        self.sub.save(update_fields=["expires_at", "updated_at"])
        DowngradeService.sync_effective_at_to_expires(self.sub)
        change = DowngradeService.get_active_change(self.sub)
        self.assertEqual(change.effective_at, new_end)
        self.sub.refresh_from_db()
        self.assertEqual(self.sub.scheduled_change_at, new_end)

    def test_unpaid_pending_becomes_start_not_free_pro(self):
        DowngradeService.schedule(self.teacher, self.pro)
        self.sub.auto_renew = False
        self.sub.expires_at = timezone.now() - timedelta(minutes=1)
        self.sub.save(update_fields=["auto_renew", "expires_at", "updated_at"])
        DowngradeService.sync_effective_at_to_expires(self.sub)
        change = DowngradeService.get_active_change(self.sub)
        change.effective_at = timezone.now() - timedelta(minutes=1)
        change.save(update_fields=["effective_at", "updated_at"])

        stats = DowngradeService.apply_due_changes()
        self.assertGreaterEqual(stats["applied"], 1)
        self.sub.refresh_from_db()
        self.assertEqual(self.sub.plan.slug, "start")
        change.refresh_from_db()
        self.assertEqual(change.status, SubscriptionPlanChange.Status.APPLIED)
        # повторный прогон не дублирует
        stats2 = DowngradeService.apply_due_changes()
        self.assertEqual(stats2["applied"], 0)

    def test_recurrent_uses_pending_plan_price(self):
        DowngradeService.schedule(self.teacher, self.pro)
        self.sub.expires_at = timezone.now() + timedelta(hours=1)
        self.sub.save(update_fields=["expires_at", "updated_at"])
        result = PaymentProviderService.create_recurrent_payment(self.sub)
        self.assertTrue(result["ok"])
        payment = result["payment"]
        self.assertEqual(payment.final_amount, Decimal("2990.00"))
        self.assertEqual(payment.plan_id, self.pro.pk)
        self.sub.refresh_from_db()
        self.assertEqual(self.sub.plan_id, self.premium.pk)
        self.assertIsNotNone(self.sub.prepaid_until)
        self.assertGreater(self.sub.prepaid_until, self.sub.expires_at)

    def test_archive_students_fallback_by_updated_at(self):
        self.sub.plan = self.pro
        self.sub.save(update_fields=["plan", "updated_at"])
        students = []
        for i in range(12):
            s = Student.objects.create(
                teacher=self.teacher,
                first_name=f"S{i}",
                last_name="Test",
                status=StudentStatus.ACTIVE,
            )
            # стабильный порядок: более новые updated_at остаются
            Student.objects.filter(pk=s.pk).update(
                updated_at=timezone.now() - timedelta(days=12 - i)
            )
            students.append(s)
        keep = [s.pk for s in students[-10:]]
        change = SubscriptionPlanChange.objects.create(
            teacher=self.teacher,
            subscription=self.sub,
            from_plan=self.pro,
            to_plan=self.teacher_plan,
            status=SubscriptionPlanChange.Status.PENDING,
            reason=SubscriptionPlanChange.Reason.DOWNGRADE,
            effective_at=timezone.now() - timedelta(minutes=1),
            selected_student_ids=[],
        )
        self.sub.plan = self.teacher_plan
        self.sub.expires_at = timezone.now() - timedelta(minutes=1)
        self.sub.save(update_fields=["plan", "expires_at", "updated_at"])
        DowngradeService._enforce_limits_after_plan(self.sub, change)
        active = Student.objects.filter(
            teacher=self.teacher, status=StudentStatus.ACTIVE
        ).count()
        archived = Student.objects.filter(
            teacher=self.teacher, status=StudentStatus.ARCHIVED
        ).count()
        self.assertEqual(active, 10)
        self.assertEqual(archived, 2)
        # данные не удалены
        self.assertEqual(Student.objects.filter(teacher=self.teacher).count(), 12)

    def test_selected_students_respected(self):
        self.sub.plan = self.pro
        self.sub.save(update_fields=["plan", "updated_at"])
        created = [
            Student.objects.create(
                teacher=self.teacher, first_name=f"A{i}", last_name="X", status=StudentStatus.ACTIVE
            )
            for i in range(12)
        ]
        keep_ids = [created[0].pk, created[1].pk] + [c.pk for c in created[2:10]]
        change = SubscriptionPlanChange.objects.create(
            teacher=self.teacher,
            subscription=self.sub,
            from_plan=self.pro,
            to_plan=self.teacher_plan,
            status=SubscriptionPlanChange.Status.PENDING,
            reason=SubscriptionPlanChange.Reason.DOWNGRADE,
            effective_at=timezone.now(),
            selected_student_ids=keep_ids[:10],
        )
        self.sub.plan = self.teacher_plan
        self.sub.save(update_fields=["plan", "updated_at"])
        DowngradeService._enforce_limits_after_plan(self.sub, change)
        active_ids = set(
            Student.objects.filter(
                teacher=self.teacher, status=StudentStatus.ACTIVE
            ).values_list("id", flat=True)
        )
        self.assertEqual(active_ids, set(keep_ids[:10]))

    def test_groups_archived_not_deleted(self):
        groups = [
            StudentGroup.objects.create(teacher=self.teacher, title=f"G{i}")
            for i in range(8)
        ]
        change = SubscriptionPlanChange.objects.create(
            teacher=self.teacher,
            subscription=self.sub,
            from_plan=self.pro,
            to_plan=self.teacher_plan,
            status=SubscriptionPlanChange.Status.PENDING,
            reason=SubscriptionPlanChange.Reason.DOWNGRADE,
            effective_at=timezone.now(),
            selected_group_ids=[groups[0].pk, groups[1].pk, groups[2].pk, groups[3].pk, groups[4].pk],
        )
        self.sub.plan = self.teacher_plan
        self.sub.save(update_fields=["plan", "updated_at"])
        DowngradeService._enforce_limits_after_plan(self.sub, change)
        self.assertEqual(StudentGroup.objects.filter(teacher=self.teacher).count(), 8)
        self.assertEqual(
            StudentGroup.objects.filter(
                teacher=self.teacher, status=GroupStatus.ACTIVE
            ).count(),
            5,
        )
        self.assertEqual(
            StudentGroup.objects.filter(
                teacher=self.teacher, status=GroupStatus.ARCHIVED
            ).count(),
            3,
        )

    def test_reminder_uses_pending_plan_amount(self):
        from datetime import datetime, time as time_cls
        from Cabinet.subscription_lifecycle import _local_day_bounds

        DowngradeService.schedule(self.teacher, self.pro)
        now = timezone.localtime(timezone.now())
        target = (now + timedelta(days=7)).date()
        tz = timezone.get_current_timezone()
        self.sub.expires_at = timezone.make_aware(datetime.combine(target, time_cls(12, 0)), tz)
        self.sub.save(update_fields=["expires_at", "updated_at"])
        DowngradeService.sync_effective_at_to_expires(self.sub)
        start, end = _local_day_bounds(7)
        created = notify_subscription_expiry_reminder(
            days_ahead=7, window_start=start, window_end=end
        )
        self.assertGreaterEqual(created, 1)
        n = Notification.objects.filter(
            recipient_user=self.teacher, event_type="subscription_expiry_7_days"
        ).latest("created_at")
        self.assertIn("Профи", n.message)
        compact = n.message.replace("\xa0", " ").replace(" ", "")
        self.assertIn("2990", compact)
        self.assertNotIn("3990", compact)

    def test_canceled_downgrade_not_in_reminder(self):
        from datetime import datetime, time as time_cls
        from Cabinet.subscription_lifecycle import _local_day_bounds

        DowngradeService.schedule(self.teacher, self.pro)
        DowngradeService.cancel(self.teacher)
        now = timezone.localtime(timezone.now())
        target = (now + timedelta(days=7)).date()
        tz = timezone.get_current_timezone()
        self.sub.expires_at = timezone.make_aware(datetime.combine(target, time_cls(12, 0)), tz)
        self.sub.save(update_fields=["expires_at", "updated_at"])
        start, end = _local_day_bounds(7)
        notify_subscription_expiry_reminder(days_ahead=7, window_start=start, window_end=end)
        n = Notification.objects.filter(
            recipient_user=self.teacher, event_type="subscription_expiry_7_days"
        ).latest("created_at")
        self.assertIn("Премиум", n.message)
        self.assertNotIn("сменится на", n.message.lower())

    def test_prepaid_starts_after_current_period(self):
        DowngradeService.schedule(self.teacher, self.pro)
        payment = Payment.objects.create(
            teacher=self.teacher,
            plan=self.pro,
            amount=Decimal("2990"),
            final_amount=Decimal("2990"),
            currency="RUB",
            status=Payment.Status.PAID,
            billing_period="month",
            provider="mock",
        )
        DowngradeService.mark_prepaid(self.sub, payment, self.pro)
        self.sub.refresh_from_db()
        self.assertEqual(self.sub.plan_id, self.premium.pk)
        self.assertIsNotNone(self.sub.prepaid_until)
        self.assertGreater(self.sub.prepaid_until, self.sub.expires_at)

        self.sub.expires_at = timezone.now() - timedelta(minutes=1)
        self.sub.save(update_fields=["expires_at", "updated_at"])
        change = DowngradeService.get_active_change(self.sub)
        change.effective_at = timezone.now() - timedelta(minutes=1)
        change.save(update_fields=["effective_at"])
        DowngradeService.apply_due_changes()
        self.sub.refresh_from_db()
        self.assertEqual(self.sub.plan_id, self.pro.pk)
        self.assertGreater(self.sub.expires_at, timezone.now())

    def test_failed_renewal_does_not_grant_paid_pending(self):
        DowngradeService.schedule(self.teacher, self.pro)
        self.sub.auto_renew = True
        self.sub.tbank_rebill_id = ""
        self.sub.expires_at = timezone.now() - timedelta(minutes=1)
        self.sub.save(update_fields=["auto_renew", "tbank_rebill_id", "expires_at", "updated_at"])
        change = DowngradeService.get_active_change(self.sub)
        change.effective_at = timezone.now() - timedelta(minutes=1)
        change.save(update_fields=["effective_at"])
        # без успешного charge apply_due → start
        DowngradeService.apply_due_changes()
        self.sub.refresh_from_db()
        self.assertEqual(self.sub.plan.slug, "start")


@override_settings(PAYMENT_PROVIDER="mock", DEBUG=True, PAYMENTS_ENABLED=True)
class DowngradeQuotaTests(TestCase):
    def setUp(self):
        self.teacher = _teacher("quota_t")
        self.premium = _plan("premium", "3990")
        self.pro = _plan("pro", "2990")
        self.sub = TeacherSubscription.objects.create(
            teacher=self.teacher,
            plan=self.premium,
            status=TeacherSubscription.Status.ACTIVE,
            expires_at=timezone.now() + timedelta(days=10),
            auto_renew=True,
            billing_period="month",
            source=TeacherSubscription.Source.PAYMENT,
        )

    def test_quota_follows_plan_storage_limit(self):
        from Cabinet.files_services import get_quota_bytes

        self.assertEqual(get_quota_bytes(self.teacher), 10240 * 1024 * 1024)
        self.sub.plan = self.pro
        self.sub.save(update_fields=["plan", "updated_at"])
        self.assertEqual(get_quota_bytes(self.teacher), 3072 * 1024 * 1024)
