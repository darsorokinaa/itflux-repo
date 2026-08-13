"""Акции (Promotion): eligibility, цена, лимиты, оплата, webhook, автопродление."""

from datetime import timedelta
from decimal import Decimal
from unittest.mock import patch

from django.contrib.auth.models import User
from django.core.exceptions import ValidationError
from django.test import Client, TestCase, override_settings
from django.utils import timezone

from rest_framework.test import APIClient

from Cabinet.models import (
    Payment,
    Profile,
    PromoCode,
    Promotion,
    PromotionRedemption,
    TariffPlan,
    TeacherSubscription,
)
from Cabinet.payment_service import PaymentProviderService
from Cabinet.pricing_service import calculate_subscription_price
from Cabinet.promotion_service import (
    PromotionError,
    compute_status,
    get_applicable_promotion,
    is_in_apply_window,
    is_in_display_window,
    reserve_redemption,
)
from Cabinet.subscription_service import PromoCodeError


def _plan(slug, name, price, rank=1):
    plan, _ = TariffPlan.objects.update_or_create(
        slug=slug,
        defaults={
            "name": name,
            "price_month": Decimal(str(price)),
            "price_year": Decimal(str(price)) * 10,
            "content_access_rank": rank,
            "is_active": True,
            "is_public": True,
            "is_free": price == 0,
            "cta_type": "register" if price == 0 else "checkout",
            "sort_order": rank,
        },
    )
    return plan


def _teacher(username):
    user = User.objects.create_user(username, f"{username}@test.ru", "pass")
    profile = Profile.objects.get(user=user)
    profile.role = Profile.Role.TEACHER
    profile.account_active = True
    profile.account_blocked = False
    profile.save()
    user.profile = profile
    TeacherSubscription.objects.update_or_create(
        teacher=user,
        defaults={
            "plan": TariffPlan.objects.get(slug="start"),
            "status": TeacherSubscription.Status.ACTIVE,
            "source": TeacherSubscription.Source.SELF,
            "expires_at": None,
        },
    )
    return user


def _offer(plan, **kwargs):
    now = timezone.now()
    defaults = {
        "code": kwargs.pop("code", f"offer-{plan.slug}-{plan.pk}"),
        "name": "Внутренняя акция",
        "title": "Профи по специальной цене",
        "short_description": "Короткий текст",
        "description": "Полное описание",
        "how_to_get": "Выберите тариф",
        "terms": "Один раз",
        "button_text": "Оформить за 1490 ₽",
        "plan": plan,
        "benefit_type": Promotion.BenefitType.FIXED_PRICE,
        "promo_price": Decimal("1490.00"),
        "starts_at": now - timedelta(days=1),
        "ends_at": now + timedelta(days=10),
        "is_active": True,
        "eligibility_type": Promotion.EligibilityType.ALL,
        "allow_promo_codes": False,
        "max_redemptions_per_user": 1,
        "priority": 10,
    }
    defaults.update(kwargs)
    return Promotion.objects.create(**defaults)


def _pay(user, plan, promo_code=None, event="paid-1", **kwargs):
    result = PaymentProviderService.create_payment(
        teacher=user,
        plan=plan,
        billing_period="month",
        promo_code=promo_code,
        **kwargs,
    )
    if result.get("granted") or result.get("status") == Payment.Status.PAID:
        return result, Payment.objects.get(pk=result["payment_id"])
    payment = Payment.objects.get(pk=result["payment_id"])
    PaymentProviderService.handle_webhook(
        {
            "payment_id": payment.pk,
            "status": "paid",
            "event_id": event,
        },
        provider_name="mock",
        skip_provider_parse=True,
    )
    payment.refresh_from_db()
    return result, payment


@override_settings(PAYMENTS_ENABLED=True, DEBUG=True, PAYMENT_PROVIDER="mock")
@patch("Cabinet.registration_promo.ensure_registration_promo", return_value=None)
class PromotionPricingTests(TestCase):
    def setUp(self):
        self.start = _plan("start", "Старт", 0, 0)
        self.teacher_plan = _plan("teacher", "Учитель", 1990, 1)
        self.pro = _plan("pro", "Профи", 2990, 2)
        self.user = _teacher("promo_user")

    def test_active_promotion_applies(self, _mock):
        _offer(self.pro)
        calc = calculate_subscription_price(self.user, self.pro, "month")
        self.assertEqual(calc["final_price"], Decimal("1490.00"))
        self.assertEqual(calc["applied_discount_source"], "promotion")
        self.assertEqual(calc["renewal_price"], Decimal("2990.00"))

    def test_future_promotion_not_applied(self, _mock):
        now = timezone.now()
        _offer(self.pro, starts_at=now + timedelta(days=2), ends_at=now + timedelta(days=5))
        calc = calculate_subscription_price(self.user, self.pro, "month")
        self.assertEqual(calc["final_price"], Decimal("2990.00"))
        self.assertEqual(calc["applied_discount_source"], "none")

    def test_ended_promotion_not_applied(self, _mock):
        now = timezone.now()
        _offer(self.pro, starts_at=now - timedelta(days=10), ends_at=now - timedelta(hours=1))
        calc = calculate_subscription_price(self.user, self.pro, "month")
        self.assertEqual(calc["applied_discount_source"], "none")

    def test_inactive_not_applied(self, _mock):
        _offer(self.pro, is_active=False)
        calc = calculate_subscription_price(self.user, self.pro, "month")
        self.assertEqual(calc["applied_discount_source"], "none")

    def test_other_plan_not_applied(self, _mock):
        _offer(self.pro)
        calc = calculate_subscription_price(self.user, self.teacher_plan, "month")
        self.assertEqual(calc["final_price"], Decimal("1990.00"))
        self.assertIsNone(get_applicable_promotion(self.user, self.teacher_plan))

    def test_new_users_only(self, _mock):
        _offer(self.pro, eligibility_type=Promotion.EligibilityType.NEW_USERS)
        calc = calculate_subscription_price(self.user, self.pro, "month")
        self.assertEqual(calc["applied_discount_source"], "promotion")
        Payment.objects.create(
            teacher=self.user,
            plan=self.pro,
            amount=Decimal("2990"),
            final_amount=Decimal("2990"),
            status=Payment.Status.PAID,
        )
        calc2 = calculate_subscription_price(self.user, self.pro, "month")
        self.assertEqual(calc2["applied_discount_source"], "none")

    def test_existing_users_only(self, _mock):
        _offer(self.pro, eligibility_type=Promotion.EligibilityType.EXISTING_USERS)
        calc = calculate_subscription_price(self.user, self.pro, "month")
        self.assertEqual(calc["applied_discount_source"], "none")
        Payment.objects.create(
            teacher=self.user,
            plan=self.pro,
            amount=Decimal("2990"),
            final_amount=Decimal("2990"),
            status=Payment.Status.PAID,
        )
        calc2 = calculate_subscription_price(self.user, self.pro, "month")
        self.assertEqual(calc2["applied_discount_source"], "promotion")

    def test_registration_window(self, _mock):
        now = timezone.now()
        _offer(
            self.pro,
            registered_from=now + timedelta(days=1),
            registered_until=now + timedelta(days=10),
        )
        calc = calculate_subscription_price(self.user, self.pro, "month")
        self.assertEqual(calc["applied_discount_source"], "none")

    def test_specific_users(self, _mock):
        other = _teacher("other_user")
        offer = _offer(self.pro, eligibility_type=Promotion.EligibilityType.SPECIFIC_USERS)
        offer.eligible_users.add(self.user)
        self.assertEqual(
            calculate_subscription_price(self.user, self.pro, "month")["applied_discount_source"],
            "promotion",
        )
        self.assertEqual(
            calculate_subscription_price(other, self.pro, "month")["applied_discount_source"],
            "none",
        )

    def test_frontend_price_ignored(self, _mock):
        _offer(self.pro)
        result = PaymentProviderService.create_payment(self.user, self.pro, "month")
        payment = Payment.objects.get(pk=result["payment_id"])
        self.assertEqual(payment.final_amount, Decimal("1490.00"))
        self.assertEqual(result["amount"], "1490.00")

    def test_stale_promotion_id_ignored(self, _mock):
        now = timezone.now()
        offer = _offer(self.pro, ends_at=now - timedelta(minutes=1), starts_at=now - timedelta(days=2))
        calc = calculate_subscription_price(
            self.user, self.pro, "month", requested_promotion_id=offer.pk
        )
        self.assertTrue(calc["promotion_request_ignored"])
        self.assertEqual(calc["final_price"], Decimal("2990.00"))

    def test_priority_wins(self, _mock):
        _offer(self.pro, code="low", promo_price=Decimal("1000"), priority=1)
        _offer(self.pro, code="high", promo_price=Decimal("1490"), priority=50)
        calc = calculate_subscription_price(self.user, self.pro, "month")
        self.assertEqual(calc["final_price"], Decimal("1490.00"))
        self.assertEqual(calc["promotion_title"], "Профи по специальной цене")
        winner = get_applicable_promotion(self.user, self.pro)
        self.assertEqual(winner.code, "high")

    def test_priority_tie_uses_lower_id(self, _mock):
        first = _offer(self.pro, code="first", promo_price=Decimal("1800"), priority=5)
        _offer(self.pro, code="second", promo_price=Decimal("1000"), priority=5)
        winner = get_applicable_promotion(self.user, self.pro)
        self.assertEqual(winner.pk, first.pk)

    def test_promo_code_forbidden(self, _mock):
        _offer(self.pro, allow_promo_codes=False)
        PromoCode.objects.create(
            code="SAVE50",
            discount_type=PromoCode.DiscountType.PERCENT,
            discount_value=Decimal("50"),
            is_active=True,
        )
        with self.assertRaises(PromoCodeError) as ctx:
            calculate_subscription_price(self.user, self.pro, "month", promo_code="SAVE50")
        self.assertEqual(ctx.exception.code, "PROMO_NOT_COMBINABLE")

    def test_promo_code_allowed_stacks_on_offer_price(self, _mock):
        _offer(self.pro, allow_promo_codes=True, promo_price=Decimal("1490"))
        PromoCode.objects.create(
            code="SAVE50",
            discount_type=PromoCode.DiscountType.PERCENT,
            discount_value=Decimal("50"),
            is_active=True,
        )
        calc = calculate_subscription_price(self.user, self.pro, "month", promo_code="SAVE50")
        self.assertEqual(calc["applied_discount_source"], "promotion")
        self.assertEqual(calc["final_price"], Decimal("745.00"))
        self.assertTrue(calc["stacked_promo"])

    def test_final_price_not_negative(self, _mock):
        _offer(self.pro, allow_promo_codes=True, promo_price=Decimal("100"))
        PromoCode.objects.create(
            code="HUGE",
            discount_type=PromoCode.DiscountType.FIXED,
            discount_value=Decimal("5000"),
            is_active=True,
        )
        calc = calculate_subscription_price(self.user, self.pro, "month", promo_code="HUGE")
        self.assertGreaterEqual(calc["final_price"], Decimal("0"))

    def test_without_promotion_standard_price(self, _mock):
        calc = calculate_subscription_price(self.user, self.pro, "month")
        self.assertEqual(calc["final_price"], Decimal("2990.00"))
        self.assertEqual(calc["applied_discount_source"], "none")

    def test_year_billing_skips_fixed_price_offer(self, _mock):
        _offer(self.pro)
        calc = calculate_subscription_price(self.user, self.pro, "year")
        self.assertEqual(calc["final_price"], Decimal("29900.00"))
        self.assertEqual(calc["applied_discount_source"], "none")

    def test_clean_rejects_bad_dates_and_price(self, _mock):
        now = timezone.now()
        offer = Promotion(
            code="bad",
            name="x",
            title="x",
            plan=self.pro,
            benefit_type=Promotion.BenefitType.FIXED_PRICE,
            promo_price=Decimal("5000"),
            starts_at=now,
            ends_at=now - timedelta(days=1),
        )
        with self.assertRaises(ValidationError):
            offer.full_clean()


@override_settings(PAYMENTS_ENABLED=True, DEBUG=True, PAYMENT_PROVIDER="mock")
@patch("Cabinet.registration_promo.ensure_registration_promo", return_value=None)
class PromotionPaymentTests(TestCase):
    def setUp(self):
        self.start = _plan("start", "Старт", 0, 0)
        self.pro = _plan("pro", "Профи", 2990, 2)
        self.user = _teacher("pay_user")

    def test_payment_uses_backend_price(self, _mock):
        _offer(self.pro)
        _, payment = _pay(self.user, self.pro)
        self.assertEqual(payment.final_amount, Decimal("1490.00"))
        self.assertEqual(payment.amount, Decimal("2990.00"))
        self.assertEqual(payment.promotion_discount_amount, Decimal("1500.00"))
        self.assertIsNotNone(payment.promotion_id)

    def test_per_user_limit(self, _mock):
        _offer(self.pro, max_redemptions_per_user=1)
        _pay(self.user, self.pro, event="u1")
        calc = calculate_subscription_price(self.user, self.pro, "month")
        self.assertEqual(calc["applied_discount_source"], "none")
        result = PaymentProviderService.create_payment(self.user, self.pro, "month")
        payment = Payment.objects.get(pk=result["payment_id"])
        self.assertEqual(payment.final_amount, Decimal("2990.00"))
        self.assertIsNone(payment.promotion_id)

    def test_global_max_redemptions(self, _mock):
        _offer(self.pro, max_redemptions=1)
        _pay(self.user, self.pro, event="g1")
        other = _teacher("second")
        calc = calculate_subscription_price(other, self.pro, "month")
        self.assertEqual(calc["applied_discount_source"], "none")

    def test_reserved_counts_toward_limit(self, _mock):
        offer = _offer(self.pro, max_redemptions=1)
        result = PaymentProviderService.create_payment(self.user, self.pro, "month")
        other = _teacher("racer")
        result2 = PaymentProviderService.create_payment(other, self.pro, "month")
        second = Payment.objects.get(pk=result2["payment_id"])
        self.assertIsNone(second.promotion_id)
        self.assertEqual(second.final_amount, Decimal("2990.00"))
        first = Payment.objects.get(pk=result["payment_id"])
        self.assertEqual(first.final_amount, Decimal("1490.00"))
        self.assertEqual(
            offer.redemptions.filter(status=PromotionRedemption.Status.RESERVED).count(),
            1,
        )

        extra = _teacher("race_lock")
        p1 = Payment.objects.get(pk=result["payment_id"])
        p2 = Payment.objects.create(
            teacher=extra,
            plan=self.pro,
            amount=Decimal("2990"),
            final_amount=Decimal("1490"),
            promotion=offer,
            status=Payment.Status.PENDING,
        )
        with self.assertRaises(PromotionError) as ctx:
            reserve_redemption(
                offer,
                extra,
                p2,
                original_price=Decimal("2990"),
                final_price=Decimal("1490"),
            )
        self.assertEqual(ctx.exception.code, "PROMOTION_LIMIT")
        self.assertEqual(p1.final_amount, Decimal("1490.00"))

    def test_webhook_does_not_recalculate(self, _mock):
        offer = _offer(self.pro, promo_price=Decimal("1490"))
        result = PaymentProviderService.create_payment(self.user, self.pro, "month")
        payment = Payment.objects.get(pk=result["payment_id"])
        offer.promo_price = Decimal("100.00")
        offer.ends_at = timezone.now() - timedelta(minutes=1)
        offer.save()
        PaymentProviderService.handle_webhook(
            {
                "payment_id": payment.pk,
                "status": "paid",
                "event_id": "late-wh",
            },
            provider_name="mock",
            skip_provider_parse=True,
        )
        payment.refresh_from_db()
        self.assertEqual(payment.final_amount, Decimal("1490.00"))
        self.assertEqual(payment.status, Payment.Status.PAID)
        redemption = PromotionRedemption.objects.get(payment=payment)
        self.assertEqual(redemption.status, PromotionRedemption.Status.APPLIED)
        self.assertEqual(redemption.final_price, Decimal("1490.00"))

    def test_admin_price_change_does_not_mutate_payment(self, _mock):
        offer = _offer(self.pro)
        result = PaymentProviderService.create_payment(self.user, self.pro, "month")
        payment_id = result["payment_id"]
        offer.promo_price = Decimal("500.00")
        offer.save()
        payment = Payment.objects.get(pk=payment_id)
        self.assertEqual(payment.final_amount, Decimal("1490.00"))

    def test_deactivate_does_not_break_old_payment(self, _mock):
        offer = _offer(self.pro)
        _, payment = _pay(self.user, self.pro, event="old")
        offer.is_active = False
        offer.save()
        payment.refresh_from_db()
        self.assertEqual(payment.final_amount, Decimal("1490.00"))
        self.assertEqual(payment.status, Payment.Status.PAID)

    def test_zero_price_grant_no_bank(self, _mock):
        _offer(
            self.pro,
            benefit_type=Promotion.BenefitType.FREE_PERIOD,
            promo_price=None,
            free_months=3,
        )
        result, payment = _pay(self.user, self.pro)
        self.assertTrue(result.get("granted"))
        self.assertEqual(payment.provider, "internal")
        self.assertEqual(payment.status, Payment.Status.PAID)
        self.assertEqual(payment.final_amount, Decimal("0.00"))
        sub = TeacherSubscription.objects.get(teacher=self.user)
        self.assertEqual(sub.plan_id, self.pro.pk)
        self.assertEqual(sub.source, TeacherSubscription.Source.PROMOTION)
        self.assertGreater(sub.expires_at, timezone.now() + timedelta(days=60))

    def test_api_shows_renewal_price(self, _mock):
        _offer(self.pro)
        client = APIClient()
        client.force_login(self.user)
        response = client.get("/api/cabinet/subscription/plans/")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        pro = next(p for p in payload["plans"] if p["slug"] == "pro")
        self.assertIsNotNone(pro["promotion"])
        self.assertEqual(pro["promotion"]["pricing"]["current"], "1490.00")
        self.assertEqual(pro["promotion"]["pricing"]["renewal"], "2990.00")
        self.assertTrue(pro["promotion"]["can_redeem"])

    def test_timezone_boundary(self, _mock):
        now = timezone.now()
        _offer(self.pro, starts_at=now - timedelta(seconds=1), ends_at=now)
        calc = calculate_subscription_price(self.user, self.pro, "month")
        self.assertEqual(calc["applied_discount_source"], "none")

    def test_auto_renew_uses_full_price(self, _mock):
        _offer(self.pro)
        _, payment = _pay(self.user, self.pro, event="first")
        sub = TeacherSubscription.objects.get(teacher=self.user)
        sub.auto_renew = True
        sub.tbank_rebill_id = "rebill-test"
        sub.save(update_fields=["auto_renew", "tbank_rebill_id"])
        PaymentProviderService.create_recurrent_payment(sub)
        recurrent = Payment.objects.filter(is_recurrent=True, teacher=self.user).first()
        self.assertIsNotNone(recurrent)
        self.assertEqual(recurrent.final_amount, Decimal("2990.00"))
        self.assertIsNone(recurrent.promotion_id)


@override_settings(PAYMENTS_ENABLED=True, DEBUG=True, PAYMENT_PROVIDER="mock")
@patch("Cabinet.registration_promo.ensure_registration_promo", return_value=None)
class PromotionCurrentPlanEligibilityTests(TestCase):
    def setUp(self):
        self.start = _plan("start", "Старт", 0, 0)
        self.pro = _plan("pro", "Профи", 2990, 2)
        self.user = _teacher("elig")

    def test_current_free_plan(self, _mock):
        _offer(self.pro, eligibility_type=Promotion.EligibilityType.CURRENT_FREE_PLAN)
        calc = calculate_subscription_price(self.user, self.pro, "month")
        self.assertEqual(calc["applied_discount_source"], "promotion")

    def test_current_paid_users(self, _mock):
        _offer(self.pro, eligibility_type=Promotion.EligibilityType.CURRENT_PAID_USERS)
        calc = calculate_subscription_price(self.user, self.pro, "month")
        self.assertEqual(calc["applied_discount_source"], "none")
        sub = self.user.subscription
        sub.plan = self.pro
        sub.status = TeacherSubscription.Status.ACTIVE
        sub.expires_at = timezone.now() + timedelta(days=20)
        sub.save()
        calc2 = calculate_subscription_price(self.user, self.pro, "month")
        self.assertEqual(calc2["applied_discount_source"], "promotion")


class PromotionStatusTests(TestCase):
    def test_compute_status_without_dates(self):
        promo = Promotion(is_active=True, starts_at=None, ends_at=None)
        self.assertEqual(compute_status(promo), "scheduled")
        self.assertFalse(is_in_apply_window(promo))
        self.assertFalse(is_in_display_window(promo))

        promo.is_active = False
        self.assertEqual(compute_status(promo), "disabled")

    def test_admin_add_page_renders_without_dates(self):
        admin_user = User.objects.create_superuser("promo_admin", "admin@test.ru", "pass")
        client = Client()
        client.force_login(admin_user)
        response = client.get("/admin/Cabinet/promotion/add/")
        self.assertEqual(response.status_code, 200)
