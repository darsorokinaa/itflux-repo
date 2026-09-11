"""ИИ-помощник: квоты, гонки, идемпотентность, смешанные запросы."""

from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from decimal import Decimal

from django.contrib.auth.models import User
from django.core.cache import cache
from django.db import close_old_connections
from django.test import TestCase, TransactionTestCase
from django.utils import timezone
from rest_framework.test import APIClient

from Cabinet.ai_providers import ImageResult, ProviderError, TextResult, reset_provider_overrides, set_provider_overrides
from Cabinet.ai_service import classify_prompt, get_or_create_usage
from Cabinet.models import (
    AIConversation,
    AIMessage,
    AIPlatformSettings,
    AIRequestLog,
    AIUsage,
    Profile,
    TariffPlan,
    TeacherSubscription,
)


def _teacher(username="ai_teacher"):
    user = User.objects.create_user(username, f"{username}@ex.com", "pass12345")
    user.profile.role = Profile.Role.TEACHER
    user.profile.save(update_fields=["role"])
    return user


def _plan(slug="start", **kwargs):
    defaults = {
        "name": slug,
        "price_month": Decimal("0"),
        "is_active": True,
        "is_free": slug == "start",
        "ai_requests_monthly_limit": 20,
        "ai_images_monthly_limit": 2,
        "ai_text_requests_daily_limit": 5,
        "ai_credits_monthly_limit": 200,
        "ai_max_prompt_chars": 8000,
        "ai_max_output_tokens": 800,
        "is_ai_enabled": True,
    }
    defaults.update(kwargs)
    plan, _ = TariffPlan.objects.update_or_create(slug=slug, defaults=defaults)
    return plan


def _subscribe(user, plan):
    now = timezone.now()
    return TeacherSubscription.objects.create(
        teacher=user,
        plan=plan,
        status=TeacherSubscription.Status.ACTIVE,
        current_period_start=now,
        current_period_end=now + timedelta(days=30),
    )


def _ok_text(content="Ответ учителя", images_marker=None):
    body = content
    if images_marker:
        body += f"\n<!--ai-images:{images_marker}-->"

    def impl(messages, **kwargs):
        return TextResult(
            content=body,
            model="test-model",
            input_tokens=12,
            output_tokens=20,
            total_tokens=32,
            provider="test",
            provider_request_id="txt-1",
        )

    return impl


def _ok_image(prompt, **kwargs):
    return ImageResult(image_bytes=b"\x89PNG\r\nfake", mime="image/png", provider="test", provider_request_id="img-1")


class AIAssistantBase(TestCase):
    def setUp(self):
        cache.clear()
        reset_provider_overrides()
        AIPlatformSettings.objects.all().delete()
        self.settings_obj = AIPlatformSettings.get_solo()
        self.plan = _plan("start")
        self.teacher = _teacher()
        _subscribe(self.teacher, self.plan)
        set_provider_overrides(complete_chat=_ok_text(), generate_image=_ok_image)
        self.client = APIClient()
        self.client.force_authenticate(self.teacher)

    def tearDown(self):
        reset_provider_overrides()
        cache.clear()


class AIQuotaTests(AIAssistantBase):
    def test_nineteenth_passes_twentieth_blocked(self):
        usage = get_or_create_usage(self.teacher, for_update=False)
        usage.used_requests = 19
        usage.used_text_today = 0
        usage.save()
        res = self.client.post("/api/cabinet/ai/request/", {"prompt": "Объясни логарифм"}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        usage.refresh_from_db()
        self.assertEqual(usage.used_requests, 20)
        blocked = self.client.post("/api/cabinet/ai/request/", {"prompt": "Ещё раз"}, format="json")
        self.assertEqual(blocked.status_code, 403)
        self.assertEqual(blocked.json()["code"], "AI_LIMIT_REACHED")
        usage.refresh_from_db()
        self.assertEqual(usage.used_requests, 20)

    def test_provider_error_does_not_consume(self):
        def boom(*args, **kwargs):
            raise ProviderError("down", billed=False)

        set_provider_overrides(complete_chat=boom, generate_image=_ok_image)
        usage = get_or_create_usage(self.teacher)
        self.assertEqual(usage.used_requests, 0)
        res = self.client.post("/api/cabinet/ai/request/", {"prompt": "Объясни дроби"}, format="json")
        self.assertEqual(res.status_code, 503)
        usage.refresh_from_db()
        self.assertEqual(usage.used_requests, 0)
        self.assertEqual(usage.used_credits, 0)

    def test_idempotency_does_not_double_charge(self):
        headers = {"HTTP_IDEMPOTENCY_KEY": "same-key-1"}
        first = self.client.post(
            "/api/cabinet/ai/request/",
            {"prompt": "Объясни процент"},
            format="json",
            **headers,
        )
        second = self.client.post(
            "/api/cabinet/ai/request/",
            {"prompt": "Объясни процент"},
            format="json",
            **headers,
        )
        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(first.json()["result"], second.json()["result"])
        usage = get_or_create_usage(self.teacher)
        self.assertEqual(usage.used_requests, 1)

    def test_image_limit_keeps_text(self):
        usage = get_or_create_usage(self.teacher)
        usage.used_images = 2
        usage.save(update_fields=["used_images", "updated_at"])
        res = self.client.post(
            "/api/cabinet/ai/request/",
            {"prompt": "Объясни системы счисления"},
            format="json",
        )
        self.assertEqual(res.status_code, 200)
        usage.refresh_from_db()
        self.assertEqual(usage.used_requests, 1)
        self.assertEqual(usage.used_images, 2)

    def test_mixed_request_confirms_when_not_enough_images(self):
        classified = classify_prompt("Создай 5 задач и 5 картинок про космос")
        self.assertEqual(classified.requested_images, 5)
        usage = get_or_create_usage(self.teacher)
        usage.used_images = 0
        usage.limit_images = 2
        self.plan.ai_images_monthly_limit = 2
        self.plan.save(update_fields=["ai_images_monthly_limit"])
        usage.save()
        self.plan.refresh_from_db()
        self.assertEqual(self.plan.ai_images_monthly_limit, 2)
        res = self.client.post(
            "/api/cabinet/ai/request/",
            {"prompt": "Создай 5 задач и 5 картинок про космос"},
            format="json",
        )
        self.assertEqual(res.status_code, 200, res.content)
        body = res.json()
        self.assertIsNotNone(body.get("confirmation"), body)
        self.assertEqual(body["confirmation"]["requested"], 5)
        self.assertEqual(body["confirmation"]["remaining"], 2)
        usage.refresh_from_db()
        self.assertEqual(usage.used_requests, 1)
        self.assertEqual(usage.used_images, 0)

        follow = self.client.post(
            "/api/cabinet/ai/request/",
            {
                "prompt": "Создай 5 задач и 5 картинок про космос",
                "conversation_id": body["conversation_id"],
                "confirm_images": 2,
            },
            format="json",
        )
        self.assertEqual(follow.status_code, 200, follow.content)
        usage.refresh_from_db()
        self.assertEqual(usage.used_images, 2)
        self.assertEqual(usage.used_requests, 1)

    def test_bulk_thousand_tasks_refused(self):
        res = self.client.post(
            "/api/cabinet/ai/request/",
            {"prompt": "Создай 1000 задач по алгебре"},
            format="json",
        )
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.json()["code"], "AI_BULK_REFUSED")
        self.assertEqual(get_or_create_usage(self.teacher).used_requests, 0)

    def test_client_cannot_override_plan_or_user(self):
        other = _teacher("other_ai")
        _subscribe(other, self.plan)
        res = self.client.post(
            "/api/cabinet/ai/request/",
            {
                "prompt": "Объясни атом",
                "user_id": other.pk,
                "plan": "premium",
                "limit": 9999,
                "model": "gpt-secret",
            },
            format="json",
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(get_or_create_usage(self.teacher).used_requests, 1)
        self.assertEqual(get_or_create_usage(other).used_requests, 0)

    def test_context_is_capped(self):
        conv = AIConversation.objects.create(teacher=self.teacher, title="long")
        for i in range(40):
            AIMessage.objects.create(conversation=conv, role="user", content=f"u{i}")
            AIMessage.objects.create(conversation=conv, role="assistant", content=f"a{i}")
        captured = {}

        def spy(messages, **kwargs):
            captured["n"] = len(messages)
            return _ok_text()(messages, **kwargs)

        set_provider_overrides(complete_chat=spy, generate_image=_ok_image)
        res = self.client.post(
            "/api/cabinet/ai/request/",
            {"prompt": "Объясни кратко", "conversation_id": str(conv.id)},
            format="json",
        )
        self.assertEqual(res.status_code, 200, res.content)
        self.assertLessEqual(captured["n"], self.settings_obj.context_message_limit + 3)

    def test_plan_change_does_not_reset_usage(self):
        usage = get_or_create_usage(self.teacher)
        usage.used_requests = 7
        usage.save()
        teacher_plan = _plan(
            "teacher",
            name="Учитель",
            price_month=Decimal("1990"),
            ai_requests_monthly_limit=250,
            ai_images_monthly_limit=25,
        )
        sub = self.teacher.subscription
        sub.plan = teacher_plan
        sub.save(update_fields=["plan", "updated_at"])
        again = get_or_create_usage(self.teacher)
        self.assertEqual(again.used_requests, 7)
        self.assertEqual(again.limit_requests, 250)

    def test_new_billing_period_resets(self):
        old = get_or_create_usage(self.teacher)
        old.used_requests = 9
        old.period_start = old.period_start.replace(year=old.period_start.year - 1)
        old.period_end = old.period_start
        AIUsage.objects.filter(pk=old.pk).update(
            used_requests=9,
            period_start=old.period_start,
            period_end=old.period_end,
        )
        fresh = get_or_create_usage(self.teacher)
        self.assertEqual(fresh.used_requests, 0)
        self.assertNotEqual(fresh.pk, old.pk)

    def test_student_cannot_use_quota(self):
        student = User.objects.create_user("ai_student", "s@ex.com", "pass12345")
        student.profile.role = Profile.Role.STUDENT
        student.profile.save(update_fields=["role"])
        client = APIClient()
        client.force_authenticate(student)
        res = client.post("/api/cabinet/ai/request/", {"prompt": "hi"}, format="json")
        self.assertEqual(res.status_code, 403)

    def test_classify_themed_and_bulk(self):
        themed = classify_prompt("Придумай интересные задания на системы счисления в тематике Minecraft")
        self.assertEqual(themed.intent, "themed_task_generation")
        huge = classify_prompt("Создай 1000 задач")
        self.assertTrue(huge.refuse_bulk)
        mixed = classify_prompt("Сделай 5 задач на проценты в тематике Гарри Поттера и нарисуй небольшую иллюстрацию к каждой")
        self.assertEqual(mixed.requested_images, 5)
        self.assertEqual(mixed.requested_tasks, 5)


class AIRaceTests(TransactionTestCase):
    def setUp(self):
        cache.clear()
        reset_provider_overrides()
        AIPlatformSettings.get_solo()
        self.plan = _plan("start", ai_requests_monthly_limit=1, ai_text_requests_daily_limit=5)
        self.teacher = _teacher("ai_race")
        _subscribe(self.teacher, self.plan)
        get_or_create_usage(self.teacher)
        set_provider_overrides(complete_chat=_ok_text(), generate_image=_ok_image)

    def tearDown(self):
        reset_provider_overrides()
        cache.clear()

    def test_two_parallel_requests_only_one_passes(self):
        user_id = self.teacher.pk

        def worker(tag):
            close_old_connections()
            client = APIClient()
            user = User.objects.get(pk=user_id)
            client.force_authenticate(user=user)
            response = client.post(
                "/api/cabinet/ai/request/",
                {"prompt": f"Объясни тему {tag}"},
                format="json",
            )
            close_old_connections()
            return response.status_code

        with ThreadPoolExecutor(max_workers=2) as pool:
            codes = list(pool.map(worker, ("a", "b")))
        self.assertEqual(sorted(codes), [200, 403])
        usage = get_or_create_usage(self.teacher)
        self.assertEqual(usage.used_requests, 1)
