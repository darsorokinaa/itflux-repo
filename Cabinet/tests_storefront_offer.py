"""Витрина: цена промокода, автоприменение, UTM в платеже и события."""

from datetime import datetime, timedelta
from decimal import Decimal
from unittest.mock import patch

from django.contrib.auth.models import User
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from Cabinet.acquisition import acquisition_payload
from Cabinet.models import Payment, Profile, PromoCode, TariffPlan, TeacherSubscription
from Cabinet.payment_service import PaymentProviderService
from Cabinet.storefront_models import StorefrontEvent, TeacherUiDismissal
from Cabinet.storefront_promo import preview_storefront_promo
from Cabinet.tutor_offer_banner import build_premium_trial_banner


def _plan(slug, name, price, *, public=True, free=False, cta="checkout"):
    plan, _ = TariffPlan.objects.update_or_create(
        slug=slug,
        defaults={
            "name": name,
            "price_month": Decimal(str(price)),
            "price_year": Decimal(str(price)) * 10,
            "is_active": True,
            "is_public": public,
            "is_free": free,
            "cta_type": cta,
            "sort_order": 1 if slug == "start" else 2,
        },
    )
    return plan


def _teacher(username="offer_teacher"):
    user = User.objects.create_user(username, f"{username}@test.ru", "pass")
    profile = user.profile
    profile.role = Profile.Role.TEACHER
    profile.save(update_fields=["role"])
    return user


def _promo(**kwargs):
    until = timezone.make_aware(datetime(2026, 11, 30, 23, 59, 59))
    defaults = {
        "code": "potok1110",
        "discount_type": PromoCode.DiscountType.PERCENT,
        "discount_value": Decimal(50),
        "first_payment_only": True,
        "billing_period": "month",
        "max_uses_per_user": 5,
        "is_active": True,
        "valid_until": until,
    }
    defaults.update(kwargs)
    return PromoCode.objects.create(**defaults)


class StorefrontPromoTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.start = _plan("start", "Старт", 0, free=True, cta="register")
        self.teacher_plan = _plan("teacher", "Репетитор", 990)
        self.pro = _plan("pro", "Профи", 1990)
        self.promo = _promo()
        self.promo.applicable_plans.set([self.teacher_plan, self.pro])

    def test_preview_uses_promo_terms_for_teacher_month(self):
        payload = preview_storefront_promo("")
        self.assertTrue(payload["valid"])
        self.assertEqual(payload["code"], "potok1110")
        self.assertIn("30 ноября 2026", payload["valid_until_label"])
        self.assertTrue(payload["first_payment_only"])
        teacher = payload["plans"]["teacher"]
        self.assertEqual(Decimal(teacher["final_price"]), Decimal("495.00"))
        self.assertEqual(Decimal(teacher["renewal_price"]), Decimal("990.00"))
        self.assertEqual(Decimal(teacher["base_price"]), Decimal("990.00"))
        self.assertTrue(teacher["promo_applied"])
        self.assertNotIn("год", payload["message"])

    def test_query_code_and_default_code_match(self):
        guest = self.client.get("/api/cabinet/pricing/promo-preview/")
        explicit = self.client.get("/api/cabinet/pricing/promo-preview/?code=potok1110")
        self.assertEqual(guest.status_code, 200)
        self.assertEqual(explicit.status_code, 200)
        self.assertEqual(guest.json()["plans"]["teacher"]["final_price"], "495.00")
        self.assertEqual(explicit.json()["plans"]["teacher"]["final_price"], "495.00")
        self.assertTrue(guest.json()["suggested"])
        self.assertFalse(explicit.json()["suggested"])

    def test_expired_and_year_codes_are_not_priced(self):
        self.promo.valid_until = timezone.now() - timedelta(days=1)
        self.promo.save(update_fields=["valid_until"])
        expired = preview_storefront_promo("potok1110")
        self.assertFalse(expired["valid"])
        self.assertEqual(expired["plans"], {})

        year = _promo(code="potok1110y", billing_period="year", discount_value=Decimal(40))
        year.applicable_plans.set([self.pro])
        payload = preview_storefront_promo("potok1110y")
        self.assertFalse(payload["valid"])
        self.assertEqual(payload["plans"], {})
        self.assertNotIn("16716", str(payload))

    @override_settings(DEBUG=True, PAYMENT_PROVIDER="mock")
    def test_logged_in_preview_matches_payment_price(self):
        user = _teacher()
        TeacherSubscription.objects.create(
            teacher=user,
            plan=self.start,
            status=TeacherSubscription.Status.ACTIVE,
            source=TeacherSubscription.Source.SELF,
        )
        self.client.force_authenticate(user=user)
        preview = self.client.get("/api/cabinet/pricing/promo-preview/?code=potok1110").json()
        self.assertEqual(preview["plans"]["teacher"]["final_price"], "495.00")
        result = PaymentProviderService.create_payment(
            teacher=user,
            plan=self.teacher_plan,
            billing_period="month",
            promo_code="potok1110",
            acquisition=acquisition_payload({
                "utm_source": "vk",
                "utm_medium": "social",
                "utm_campaign": "potok1110",
                "utm_content": "post608",
                "ref": "608",
                "email": "hidden@example.com",
            }),
        )
        payment = Payment.objects.get(pk=result["payment_id"])
        self.assertEqual(payment.final_amount, Decimal("495.00"))
        self.assertEqual(payment.metadata["acquisition"]["utm_source"], "vk")
        self.assertEqual(payment.metadata["acquisition"]["utm_content"], "post608")
        self.assertEqual(payment.metadata["acquisition"]["ref"], "608")
        self.assertNotIn("email", payment.metadata["acquisition"])
        self.assertTrue(
            StorefrontEvent.objects.filter(
                event_name=StorefrontEvent.Name.PAYMENT_CREATED,
                user=user,
            ).exists()
        )


@override_settings(
    PAYMENT_PROVIDER="tbank",
    TBANK_TERMINAL_KEY="TestKey",
    TBANK_PASSWORD="TestPass",
    LK_PUBLIC_URL="https://example.com",
    DEBUG=True,
)
class TBankAcquisitionDataTests(TestCase):
    def test_init_data_includes_utm(self):
        user = _teacher("tb_offer")
        start = _plan("start", "Старт", 0, free=True, cta="register")
        plan = _plan("teacher", "Репетитор", 990)
        TeacherSubscription.objects.create(
            teacher=user,
            plan=start,
            status=TeacherSubscription.Status.ACTIVE,
            source=TeacherSubscription.Source.SELF,
        )
        with patch("Cabinet.tbank_payment.requests.post") as mock_post:
            mock_post.return_value.json.return_value = {
                "Success": True,
                "PaymentId": "9100",
                "PaymentURL": "https://securepay.tinkoff.ru/html/payForm/?id=9100",
                "Status": "NEW",
            }
            PaymentProviderService.create_payment(
                teacher=user,
                plan=plan,
                billing_period="month",
                acquisition={
                    "utm_source": "telegram",
                    "utm_medium": "social",
                    "utm_campaign": "potok1110",
                    "utm_content": "608",
                    "ref": "608",
                },
            )
        body = mock_post.call_args.kwargs.get("json") or mock_post.call_args[1]["json"]
        data = body["DATA"]
        self.assertEqual(data["utm_source"], "telegram")
        self.assertEqual(data["utm_campaign"], "potok1110")
        self.assertEqual(data["utm_content"], "608")
        self.assertEqual(data["ref"], "608")
        self.assertEqual(data["Email"], user.email)


class AcquisitionRegistrationTests(TestCase):
    def setUp(self):
        self.client = APIClient()

    def test_register_keeps_utm_touch(self):
        resp = self.client.post(
            "/api/cabinet/register/",
            {
                "email": "utm-teacher@example.com",
                "password": "ComplexPass123!",
                "password_confirm": "ComplexPass123!",
                "name": "Анна",
                "role": "teacher",
                "utm_source": "vk",
                "utm_medium": "social",
                "utm_campaign": "potok1110",
                "utm_content": "post608",
                "source_ref": "608",
                "referrer": "https://vk.com/wall1",
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 201, resp.content)
        user = User.objects.get(email="utm-teacher@example.com")
        self.assertEqual(user.profile.acquisition_source, "social")
        self.assertEqual(user.profile.acquisition_touch["utm_source"], "vk")
        self.assertEqual(user.profile.acquisition_touch["utm_content"], "post608")
        self.assertEqual(user.profile.acquisition_touch["ref"], "608")
        self.assertNotIn("referrer", user.profile.acquisition_touch)
        self.assertNotIn("vk.com", str(user.profile.acquisition_touch))


class StorefrontEventTests(TestCase):
    def setUp(self):
        self.client = APIClient()

    def test_guest_event_has_no_personal_fields(self):
        resp = self.client.post(
            "/api/cabinet/pricing/events/",
            {
                "event_name": "pricing_view",
                "metadata": {"email": "a@b.c", "plan_slug": "teacher", "name": "Анна"},
                "idempotency_key": "pricing-view-test-1",
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 201, resp.content)
        event = StorefrontEvent.objects.get(pk=resp.json()["id"])
        self.assertIsNone(event.user_id)
        self.assertEqual(event.metadata, {"plan_slug": "teacher"})
        self.assertNotIn("email", str(event.metadata))
        again = self.client.post(
            "/api/cabinet/pricing/events/",
            {"event_name": "pricing_view", "idempotency_key": "pricing-view-test-1"},
            format="json",
        )
        self.assertEqual(again.status_code, 200)
        self.assertEqual(StorefrontEvent.objects.count(), 1)

    def test_client_cannot_record_payment_created(self):
        resp = self.client.post(
            "/api/cabinet/pricing/events/",
            {"event_name": "payment_created"},
            format="json",
        )
        self.assertEqual(resp.status_code, 403)
        self.assertFalse(StorefrontEvent.objects.exists())

    def test_tariff_click_stores_user_id_only(self):
        user = _teacher("click_teacher")
        self.client.force_authenticate(user=user)
        resp = self.client.post(
            "/api/cabinet/pricing/events/",
            {
                "event_name": "tariff_click",
                "metadata": {"plan_slug": "teacher", "phone": "+79990000000"},
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 201, resp.content)
        event = StorefrontEvent.objects.get(user=user, event_name="tariff_click")
        self.assertEqual(event.metadata, {"plan_slug": "teacher"})
        self.assertEqual(event.user_id, user.pk)


class PremiumTrialBannerTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.start = _plan("start", "Старт", 0, free=True, cta="register")
        self.premium = _plan("premium", "Премиум", 3990, public=False)
        self.teacher_plan = _plan("teacher", "Репетитор", 990)
        self.user = _teacher("trial_teacher")

    def _sub(self, **kwargs):
        defaults = {
            "teacher": self.user,
            "plan": self.premium,
            "status": TeacherSubscription.Status.TRIAL,
            "source": TeacherSubscription.Source.LAUNCH_PROMO,
            "expires_at": timezone.make_aware(datetime(2026, 11, 14, 12, 0, 0)),
        }
        defaults.update(kwargs)
        return TeacherSubscription.objects.create(**defaults)

    def test_active_trial_copy(self):
        self._sub()
        banner = build_premium_trial_banner(self.user)
        self.assertEqual(banner["variant"], "active")
        self.assertEqual(banner["cta_href"], "/pricing?promo=potok1110")
        self.assertEqual(banner["cta_label"], "Выбрать „Репетитор“")
        self.assertEqual(
            banner["text"],
            "Пробный „Премиум“ заканчивается 14 ноября. "
            "Чтобы ученики, ДЗ и материалы остались под рукой без ограничений „Старта“, "
            "переходите на „Репетитор“: первый месяц 495 ₽ по коду potok1110, дальше 990 ₽ в месяц. "
            "Акция до 30 ноября.",
        )

    def test_expired_trial_copy(self):
        self._sub(
            plan=self.start,
            status=TeacherSubscription.Status.EXPIRED,
            expires_at=timezone.now() - timedelta(days=1),
        )
        banner = build_premium_trial_banner(self.user)
        self.assertEqual(banner["variant"], "expired")
        self.assertTrue(banner["text"].startswith("Пробный „Премиум“ закончился, всё созданное сохранилось."))
        self.assertIn("первый месяц 495 ₽ по коду potok1110", banner["text"])

    def test_hidden_for_paid_tariff_new_teacher_and_after_deadline(self):
        paid = _teacher("paid_teacher")
        TeacherSubscription.objects.create(
            teacher=paid,
            plan=self.teacher_plan,
            status=TeacherSubscription.Status.ACTIVE,
            source=TeacherSubscription.Source.PAYMENT,
            expires_at=timezone.now() + timedelta(days=20),
        )
        self.assertIsNone(build_premium_trial_banner(paid))

        fresh = _teacher("fresh_teacher")
        TeacherSubscription.objects.create(
            teacher=fresh,
            plan=self.start,
            status=TeacherSubscription.Status.ACTIVE,
            source=TeacherSubscription.Source.SELF,
        )
        self.assertIsNone(build_premium_trial_banner(fresh))

        self._sub()
        later = timezone.make_aware(datetime(2026, 12, 1, 0, 0, 1))
        self.assertIsNone(build_premium_trial_banner(self.user, now=later))

    def test_dismiss_hides_banner_for_that_user_only(self):
        self._sub()
        other = _teacher("other_trial")
        TeacherSubscription.objects.create(
            teacher=other,
            plan=self.premium,
            status=TeacherSubscription.Status.TRIAL,
            source=TeacherSubscription.Source.LAUNCH_PROMO,
            expires_at=timezone.now() + timedelta(days=3),
        )
        self.client.force_authenticate(user=self.user)
        shown = self.client.get("/api/cabinet/tutor-offer/")
        self.assertEqual(shown.status_code, 200)
        self.assertEqual(shown.json()["banner"]["variant"], "active")
        dismissed = self.client.post(
            "/api/cabinet/ui-notice/dismiss/",
            {"key": TeacherUiDismissal.PREMIUM_TRIAL_TUTOR_OFFER},
            format="json",
        )
        self.assertEqual(dismissed.status_code, 200)
        hidden = self.client.get("/api/cabinet/tutor-offer/")
        self.assertIsNone(hidden.json()["banner"])
        self.assertIsNotNone(build_premium_trial_banner(other))
