"""Тесты новой реферальной программы и промокодов."""

from datetime import timedelta
from decimal import Decimal

from django.contrib.auth.models import User
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from Cabinet.models import (
    Payment,
    Profile,
    PromoCode,
    PromoCodeUsage,
    ReferralLink,
    ReferralLinkRegistration,
    ReferralReward,
    TariffPlan,
    TeacherSubscription,
)
from Cabinet.payment_service import PaymentProviderService
from Cabinet.pricing_service import (
    REFERRAL_REFERRER_BONUS_DAYS,
    calculate_subscription_price,
    is_referral_discount_eligible,
)
from Cabinet.referral_service import ReferralError, ReferralService
from Cabinet.subscription_service import PromoCodeError, PromoCodeService


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


def _teacher(username, email=None):
    user = User.objects.create_user(username, email or f"{username}@test.ru", "pass")
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


def _register_via_service(email, code, username=None):
    """Регистрация без HTTP (обход rate-limit)."""
    uname = username or email.split("@")[0]
    user = User.objects.create_user(uname, email, "StrongPass123!")
    Profile.objects.filter(user=user).update(role=Profile.Role.TEACHER)
    TeacherSubscription.objects.get_or_create(
        teacher=user,
        defaults={
            "plan": TariffPlan.objects.get(slug="start"),
            "status": TeacherSubscription.Status.ACTIVE,
            "source": TeacherSubscription.Source.SELF,
        },
    )
    result = ReferralService.apply_on_registration(user, code)
    if not result:
        raise AssertionError(f"Referral not applied for {email}")
    return user


@override_settings(PAYMENTS_ENABLED=True, DEBUG=True, PAYMENT_PROVIDER="mock")
class ReferralProgramTests(TestCase):
    def setUp(self):
        self.start = _plan("start", "Старт", 0, 0)
        self.teacher_plan = _plan("teacher", "Учитель", 1990, 1)
        self.pro = _plan("pro", "Профи", 2990, 2)
        self.premium = _plan("premium", "Премиум", 3990, 3)
        self.referrer = _teacher("referrer_darya")
        self.link = ReferralLink.objects.create(
            code="DARYA14",
            owner=self.referrer,
            is_active=True,
            reward_months=0,
        )
        # Реферер на платном Профи
        sub = self.referrer.subscription
        sub.plan = self.pro
        sub.status = TeacherSubscription.Status.ACTIVE
        sub.source = TeacherSubscription.Source.PAYMENT
        sub.expires_at = timezone.now() + timedelta(days=30)
        sub.save()

    def _register_invitee(self, email="anna@test.ru", code="DARYA14"):
        return _register_via_service(email, code)

    def test_registration_creates_referral(self):
        user = self._register_invitee()
        reg = ReferralLinkRegistration.objects.get(user=user)
        self.assertEqual(reg.referral_link_id, self.link.pk)
        self.assertTrue(reg.invitee_discount_eligible)
        # Больше не выдаём бесплатные месяцы Профи
        self.assertEqual(user.subscription.plan.slug, "start")

    def test_registration_without_ref_no_referral(self):
        user = _teacher("plain", "plain@test.ru")
        self.assertFalse(ReferralLinkRegistration.objects.filter(user=user).exists())

    def test_self_referral_forbidden(self):
        with self.assertRaises(ReferralError):
            ReferralService.apply_on_registration(self.referrer, "DARYA14")

    def test_referral_cannot_be_rebound(self):
        user = self._register_invitee()
        other = ReferralLink.objects.create(code="OTHER", owner=self.referrer, is_active=True)
        with self.assertRaises(ReferralError):
            ReferralService.apply_on_registration(user, other.code)

    def test_invitee_has_50_percent(self):
        user = self._register_invitee()
        self.assertTrue(is_referral_discount_eligible(user))
        for plan, expected in (
            (self.teacher_plan, Decimal("995.00")),
            (self.pro, Decimal("1495.00")),
            (self.premium, Decimal("1995.00")),
        ):
            calc = calculate_subscription_price(user, plan, "month")
            self.assertEqual(calc["final_price"], expected)
            self.assertEqual(calc["applied_discount_source"], "referral")

    def _pay(self, user, plan, promo_code=None, event_suffix="1"):
        result = PaymentProviderService.create_payment(
            teacher=user,
            plan=plan,
            billing_period="month",
            promo_code=promo_code,
        )
        payment = Payment.objects.get(pk=result["payment_id"])
        PaymentProviderService.handle_webhook(
            {
                "payment_id": payment.pk,
                "status": "paid",
                "event_id": f"evt_{payment.pk}_{event_suffix}",
                "provider_payment_id": payment.provider_payment_id or f"mock_{payment.pk}",
            },
            provider_name="mock",
            skip_provider_parse=True,
        )
        payment.refresh_from_db()
        return payment

    def test_failed_payment_does_not_consume_discount(self):
        user = self._register_invitee()
        result = PaymentProviderService.create_payment(
            teacher=user, plan=self.pro, billing_period="month"
        )
        payment = Payment.objects.get(pk=result["payment_id"])
        PaymentProviderService.handle_webhook(
            {
                "payment_id": payment.pk,
                "status": "failed",
                "event_id": f"fail_{payment.pk}",
            },
            provider_name="mock",
            skip_provider_parse=True,
        )
        payment.refresh_from_db()
        self.assertEqual(payment.status, Payment.Status.FAILED)
        self.assertTrue(is_referral_discount_eligible(user))
        self.assertFalse(
            ReferralReward.objects.filter(referred_user=user).exists()
        )

    def test_canceled_payment_does_not_consume(self):
        user = self._register_invitee("cancel@test.ru")
        result = PaymentProviderService.create_payment(
            teacher=user, plan=self.pro, billing_period="month"
        )
        payment = Payment.objects.get(pk=result["payment_id"])
        PaymentProviderService.handle_webhook(
            {
                "payment_id": payment.pk,
                "status": "cancelled",
                "event_id": f"cancel_{payment.pk}",
            },
            provider_name="mock",
            skip_provider_parse=True,
        )
        self.assertTrue(is_referral_discount_eligible(user))

    def test_confirmed_consumes_and_rewards_referrer(self):
        user = self._register_invitee("ok@test.ru")
        before = self.referrer.subscription.expires_at
        payment = self._pay(user, self.pro)
        self.assertEqual(payment.status, Payment.Status.PAID)
        self.assertEqual(payment.final_amount, Decimal("1495.00"))
        user.referral_registration.refresh_from_db()
        self.assertFalse(user.referral_registration.invitee_discount_eligible)
        self.assertFalse(is_referral_discount_eligible(user))

        reward = ReferralReward.objects.get(referred_user=user)
        self.assertEqual(reward.reward_days, REFERRAL_REFERRER_BONUS_DAYS)
        self.assertEqual(reward.status, ReferralReward.Status.GRANTED)
        self.referrer.subscription.refresh_from_db()
        self.assertEqual(
            self.referrer.subscription.expires_at.date(),
            (before + timedelta(days=14)).date(),
        )
        self.assertEqual(self.referrer.subscription.plan.slug, "pro")

    def test_duplicate_webhook_no_extra_days(self):
        user = self._register_invitee("dup@test.ru")
        before = self.referrer.subscription.expires_at
        payment = self._pay(user, self.teacher_plan, event_suffix="a")
        for i in range(3):
            PaymentProviderService.handle_webhook(
                {
                    "payment_id": payment.pk,
                    "status": "paid",
                    "event_id": f"dup_{payment.pk}_{i}",
                },
                provider_name="mock",
                skip_provider_parse=True,
            )
        self.assertEqual(ReferralReward.objects.filter(referred_user=user).count(), 1)
        self.referrer.subscription.refresh_from_db()
        self.assertEqual(
            self.referrer.subscription.expires_at.date(),
            (before + timedelta(days=14)).date(),
        )

    def test_renewal_full_price(self):
        user = self._register_invitee("renew@test.ru")
        self._pay(user, self.pro, event_suffix="first")
        calc = calculate_subscription_price(user, self.pro, "month")
        self.assertEqual(calc["final_price"], Decimal("2990.00"))
        self.assertEqual(calc["applied_discount_source"], "none")

    def test_multiple_invitees_stack_days(self):
        a = self._register_invitee("a1@test.ru")
        b = self._register_invitee("b1@test.ru")
        before = self.referrer.subscription.expires_at
        self._pay(a, self.teacher_plan, event_suffix="a")
        self._pay(b, self.teacher_plan, event_suffix="b")
        self.referrer.subscription.refresh_from_db()
        self.assertEqual(
            self.referrer.subscription.expires_at.date(),
            (before + timedelta(days=28)).date(),
        )
        self.assertEqual(
            ReferralReward.objects.filter(referrer=self.referrer).count(),
            2,
        )

    def test_deferred_bonus_when_referrer_on_start(self):
        # Реферер на Старте
        sub = self.referrer.subscription
        sub.plan = self.start
        sub.source = TeacherSubscription.Source.SELF
        sub.expires_at = None
        sub.save()
        user = self._register_invitee("defer@test.ru")
        self._pay(user, self.pro)
        reward = ReferralReward.objects.get(referred_user=user)
        self.assertEqual(reward.status, ReferralReward.Status.AVAILABLE)

        # Покупает Профи — бонус применяется
        before_create = timezone.now()
        pay2 = PaymentProviderService.create_payment(
            teacher=self.referrer, plan=self.pro, billing_period="month"
        )
        payment = Payment.objects.get(pk=pay2["payment_id"])
        PaymentProviderService.handle_webhook(
            {
                "payment_id": payment.pk,
                "status": "paid",
                "event_id": f"refbuy_{payment.pk}",
            },
            provider_name="mock",
            skip_provider_parse=True,
        )
        reward.refresh_from_db()
        self.assertEqual(reward.status, ReferralReward.Status.GRANTED)
        self.referrer.subscription.refresh_from_db()
        # 1 месяц + 14 дней
        expected_min = before_create + timedelta(days=30)
        self.assertGreaterEqual(
            self.referrer.subscription.expires_at.date(),
            expected_min.date(),
        )

    def test_previous_payer_no_referral_discount(self):
        user = _teacher("oldpayer", "oldpayer@test.ru")
        Payment.objects.create(
            teacher=user,
            plan=self.pro,
            amount=Decimal("2990"),
            final_amount=Decimal("2990"),
            status=Payment.Status.PAID,
            provider="mock",
            billing_period="month",
        )
        ReferralLinkRegistration.objects.create(
            user=user,
            referral_link=self.link,
            invitee_discount_eligible=True,
            reward_months=0,
        )
        # eligibility helper смотрит на историю PAID
        self.assertFalse(is_referral_discount_eligible(user))


@override_settings(PAYMENTS_ENABLED=True, DEBUG=True, PAYMENT_PROVIDER="mock")
class PromoCodeTests(TestCase):
    def setUp(self):
        self.start = _plan("start", "Старт", 0, 0)
        self.pro = _plan("pro", "Профи", 2990, 2)
        self.teacher_plan = _plan("teacher", "Учитель", 1990, 1)
        self.user = _teacher("promo_user")

    def test_percentage_promo(self):
        promo = PromoCode.objects.create(
            code="SUMMER20",
            discount_type=PromoCode.DiscountType.PERCENT,
            discount_value=Decimal("20"),
            is_active=True,
        )
        info = PromoCodeService.calculate_discount(promo, Decimal("2990"))
        self.assertEqual(Decimal(info["final_amount"]), Decimal("2392.00"))

    def test_fixed_promo_not_negative(self):
        promo = PromoCode.objects.create(
            code="BIG5000",
            discount_type=PromoCode.DiscountType.FIXED,
            discount_value=Decimal("5000"),
            is_active=True,
        )
        info = PromoCodeService.calculate_discount(promo, Decimal("1990"))
        self.assertEqual(Decimal(info["final_amount"]), Decimal("0.00"))

    def test_expired_promo(self):
        PromoCode.objects.create(
            code="OLD",
            discount_type=PromoCode.DiscountType.PERCENT,
            discount_value=Decimal("10"),
            is_active=True,
            valid_until=timezone.now() - timedelta(days=1),
        )
        with self.assertRaises(PromoCodeError) as ctx:
            PromoCodeService.validate(self.user, "OLD", "pro")
        self.assertIn("истёк", ctx.exception.message.lower())

    def test_not_started_promo(self):
        PromoCode.objects.create(
            code="FUTURE",
            discount_type=PromoCode.DiscountType.PERCENT,
            discount_value=Decimal("10"),
            is_active=True,
            valid_from=timezone.now() + timedelta(days=2),
        )
        with self.assertRaises(PromoCodeError) as ctx:
            PromoCodeService.validate(self.user, "FUTURE", "pro")
        self.assertIn("недоступен", ctx.exception.message.lower())

    def test_inactive_invalid_wrong_plan(self):
        PromoCode.objects.create(
            code="OFF", discount_type="percent", discount_value=10, is_active=False
        )
        with self.assertRaises(PromoCodeError):
            PromoCodeService.validate(self.user, "OFF", "pro")
        with self.assertRaises(PromoCodeError):
            PromoCodeService.validate(self.user, "NOPE", "pro")
        promo = PromoCode.objects.create(
            code="TEACHERONLY",
            discount_type="percent",
            discount_value=10,
            is_active=True,
        )
        promo.applicable_plans.add(self.teacher_plan)
        with self.assertRaises(PromoCodeError) as ctx:
            PromoCodeService.validate(self.user, "TEACHERONLY", "pro")
        self.assertIn("тарифа", ctx.exception.message.lower())

    def test_usage_limits_and_confirm(self):
        promo = PromoCode.objects.create(
            code="ONCE",
            discount_type="percent",
            discount_value=10,
            is_active=True,
            max_uses=1,
            max_uses_per_user=1,
        )
        result = PaymentProviderService.create_payment(
            teacher=self.user, plan=self.pro, billing_period="month", promo_code="ONCE"
        )
        payment = Payment.objects.get(pk=result["payment_id"])
        self.assertEqual(promo.uses_count, 0)
        self.assertTrue(
            PromoCodeUsage.objects.filter(
                payment=payment, status=PromoCodeUsage.Status.RESERVED
            ).exists()
        )
        PaymentProviderService.handle_webhook(
            {
                "payment_id": payment.pk,
                "status": "failed",
                "event_id": f"pf_{payment.pk}",
            },
            provider_name="mock",
            skip_provider_parse=True,
        )
        promo.refresh_from_db()
        self.assertEqual(promo.uses_count, 0)

        result2 = PaymentProviderService.create_payment(
            teacher=self.user, plan=self.pro, billing_period="month", promo_code="ONCE"
        )
        payment2 = Payment.objects.get(pk=result2["payment_id"])
        PaymentProviderService.handle_webhook(
            {
                "payment_id": payment2.pk,
                "status": "paid",
                "event_id": f"ok_{payment2.pk}",
            },
            provider_name="mock",
            skip_provider_parse=True,
        )
        promo.refresh_from_db()
        self.assertEqual(promo.uses_count, 1)
        # повторный webhook
        PaymentProviderService.handle_webhook(
            {
                "payment_id": payment2.pk,
                "status": "paid",
                "event_id": f"ok2_{payment2.pk}",
            },
            provider_name="mock",
            skip_provider_parse=True,
        )
        promo.refresh_from_db()
        self.assertEqual(promo.uses_count, 1)
        self.assertEqual(
            PromoCodeUsage.objects.filter(
                payment=payment2, status=PromoCodeUsage.Status.APPLIED
            ).count(),
            1,
        )

    def test_percent_promo_keeps_bonus_days(self):
        PromoCode.objects.create(
            code="1SEPTEMBER",
            discount_type=PromoCode.DiscountType.PERCENT,
            discount_value=Decimal("30"),
            bonus_days=14,
            is_active=True,
        )
        calc = calculate_subscription_price(
            self.user, self.pro, "month", promo_code="1SEPTEMBER"
        )
        self.assertEqual(calc["final_price"], Decimal("2093.00"))
        self.assertEqual(calc["bonus_days"], 14)
        self.assertIn("14", calc["message"] or "")

    def test_apply_promo_api_prices_all_paid_plans(self):
        profile = Profile.objects.get(user=self.user)
        profile.role = Profile.Role.TEACHER
        profile.account_active = True
        profile.account_blocked = False
        profile.save()
        _plan("premium", "Премиум", 3990, 3)
        PromoCode.objects.create(
            code="1SEPTEMBER",
            discount_type=PromoCode.DiscountType.PERCENT,
            discount_value=Decimal("30"),
            bonus_days=14,
            is_active=True,
        )
        client = APIClient()
        client.force_login(self.user)
        response = client.post(
            "/api/cabinet/subscription/apply-promo/",
            {"code": "1SEPTEMBER", "plan_slug": "pro", "billing_period": "month"},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        data = response.json()
        self.assertTrue(data["valid"])
        self.assertEqual(data["bonus_days"], 14)
        by_plan = data["by_plan"]
        self.assertEqual(by_plan["teacher"]["final_amount"], "1393.00")
        self.assertEqual(by_plan["pro"]["final_amount"], "2093.00")
        self.assertEqual(by_plan["premium"]["final_amount"], "2793.00")
        self.assertEqual(by_plan["teacher"]["bonus_days"], 14)
        self.assertEqual(by_plan["premium"]["bonus_days"], 14)
        self.assertNotIn("start", by_plan)

    def test_apply_promo_api_skips_inapplicable_plan(self):
        profile = Profile.objects.get(user=self.user)
        profile.role = Profile.Role.TEACHER
        profile.account_active = True
        profile.account_blocked = False
        profile.save()
        promo = PromoCode.objects.create(
            code="TEACHER30",
            discount_type=PromoCode.DiscountType.PERCENT,
            discount_value=Decimal("30"),
            bonus_days=7,
            is_active=True,
        )
        promo.applicable_plans.add(self.teacher_plan)
        client = APIClient()
        client.force_login(self.user)
        response = client.post(
            "/api/cabinet/subscription/apply-promo/",
            {"code": "TEACHER30", "billing_period": "month"},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        data = response.json()
        self.assertTrue(data["by_plan"]["teacher"]["valid"])
        self.assertFalse(data["by_plan"]["pro"]["valid"])
        self.assertEqual(data["by_plan"]["pro"]["code"], "PROMO_NOT_APPLICABLE")


@override_settings(PAYMENTS_ENABLED=True, DEBUG=True, PAYMENT_PROVIDER="mock")
class ReferralPlusPromoTests(TestCase):
    def setUp(self):
        self.start = _plan("start", "Старт", 0, 0)
        self.pro = _plan("pro", "Профи", 2990, 2)
        self.referrer = _teacher("ref_combo")
        sub = self.referrer.subscription
        sub.plan = self.pro
        sub.source = TeacherSubscription.Source.PAYMENT
        sub.expires_at = timezone.now() + timedelta(days=20)
        sub.save()
        self.link = ReferralLink.objects.create(
            code="COMBO", owner=self.referrer, is_active=True
        )
        self.invitee = _register_via_service("combo@test.ru", "COMBO")

    def test_best_of_referral_vs_promo20(self):
        PromoCode.objects.create(
            code="P20", discount_type="percent", discount_value=20, is_active=True
        )
        calc = calculate_subscription_price(
            self.invitee, self.pro, "month", promo_code="P20"
        )
        self.assertEqual(calc["applied_discount_source"], "referral")
        self.assertEqual(calc["final_price"], Decimal("1495.00"))

    def test_best_of_promo60_wins(self):
        PromoCode.objects.create(
            code="P60", discount_type="percent", discount_value=60, is_active=True
        )
        calc = calculate_subscription_price(
            self.invitee, self.pro, "month", promo_code="P60"
        )
        self.assertEqual(calc["applied_discount_source"], "promo")
        self.assertEqual(calc["final_price"], Decimal("1196.00"))

        result = PaymentProviderService.create_payment(
            teacher=self.invitee,
            plan=self.pro,
            billing_period="month",
            promo_code="P60",
        )
        payment = Payment.objects.get(pk=result["payment_id"])
        self.assertEqual(payment.final_amount, Decimal("1196.00"))
        PaymentProviderService.handle_webhook(
            {
                "payment_id": payment.pk,
                "status": "paid",
                "event_id": f"combo_{payment.pk}",
            },
            provider_name="mock",
            skip_provider_parse=True,
        )
        self.invitee.referral_registration.refresh_from_db()
        self.assertFalse(self.invitee.referral_registration.invitee_discount_eligible)
        reward = ReferralReward.objects.get(referred_user=self.invitee)
        self.assertEqual(reward.status, ReferralReward.Status.GRANTED)
