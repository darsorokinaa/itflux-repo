"""Лимиты «Мой банк задач»: Free / Teacher / Pro, copy quota, downgrade, isolation."""

from datetime import timedelta
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal

from django.contrib.auth.models import User
from django.db import close_old_connections
from django.test import TransactionTestCase
from django.utils import timezone
from rest_framework.test import APIClient

from Cabinet.models import TariffPlan, TeacherSubscription
from Cabinet.subscription_service import SubscriptionLimitService
from Cabinet.teacher_task_entitlements import (
    TEACHER_TASK_ATTACHMENTS_REQUIRED,
    TEACHER_TASK_COPY_LIMIT_REACHED,
    TEACHER_TASK_LIMIT_REACHED,
    count_teacher_task_copies_this_period,
    count_teacher_tasks,
)
from Cabinet.tests_teacher_task_bank import TeacherTaskBankBase, _make_teacher
from Generator.models import Task, TeacherTaskBank, Variant, VariantContent
from Generator.teacher_task_bank import get_or_create_teacher_bank


PLAN_SPECS = {
    "start": {
        "name": "Старт",
        "price_month": Decimal("0"),
        "is_free": True,
        "max_teacher_tasks": 20,
        "max_teacher_task_copies_monthly": 5,
        "max_teacher_task_collections": 2,
        "has_teacher_task_attachments": False,
        "has_teacher_task_bulk_import": False,
        "has_analytics": False,
    },
    "teacher": {
        "name": "Учитель",
        "price_month": Decimal("1990"),
        "is_free": False,
        "max_teacher_tasks": 500,
        "max_teacher_task_copies_monthly": None,
        "max_teacher_task_collections": 10,
        "has_teacher_task_attachments": True,
        "has_teacher_task_bulk_import": False,
        "has_analytics": False,
    },
    "pro": {
        "name": "Профи",
        "price_month": Decimal("2990"),
        "is_free": False,
        "max_teacher_tasks": 5000,
        "max_teacher_task_copies_monthly": None,
        "max_teacher_task_collections": None,
        "has_teacher_task_attachments": True,
        "has_teacher_task_bulk_import": True,
        "has_analytics": True,
    },
    "premium": {
        "name": "Премиум",
        "price_month": Decimal("3990"),
        "is_free": False,
        "max_teacher_tasks": None,
        "max_teacher_task_copies_monthly": None,
        "max_teacher_task_collections": None,
        "has_teacher_task_attachments": True,
        "has_teacher_task_bulk_import": True,
        "has_analytics": True,
    },
}


def ensure_bank_plans():
    plans = {}
    for slug, fields in PLAN_SPECS.items():
        defaults = {
            "is_active": True,
            "is_public": True,
            "content_access_rank": {"start": 0, "teacher": 1, "pro": 2, "premium": 3}[slug],
            **fields,
        }
        plans[slug], _ = TariffPlan.objects.update_or_create(slug=slug, defaults=defaults)
    return plans


def set_plan(user, plan, *, source=TeacherSubscription.Source.ADMIN, expires_at=None, status=None):
    sub = SubscriptionLimitService.get_or_create_subscription(user)
    sub.plan = plan
    sub.status = status or TeacherSubscription.Status.ACTIVE
    sub.source = source
    sub.expires_at = expires_at
    sub.save(update_fields=["plan", "status", "source", "expires_at"])
    return sub


class TeacherTaskBankLimitsTests(TeacherTaskBankBase):
    def setUp(self):
        super().setUp()
        self.plans = ensure_bank_plans()
        set_plan(self.teacher_a, self.plans["start"])
        set_plan(self.teacher_b, self.plans["start"])

    def _fill(self, teacher, count, *, start_at=1, source=None, status=Task.Status.READY):
        get_or_create_teacher_bank(teacher)
        Task.objects.bulk_create(
            [
                Task(
                    task=self.tl,
                    quick_level=self.level,
                    task_template=f"<p>Задача {i}</p>",
                    answer="1",
                    is_active=status == Task.Status.READY,
                    scope=Task.Scope.TEACHER,
                    owner_teacher=teacher,
                    local_number=i,
                    status=status,
                    source_task=source,
                )
                for i in range(start_at, start_at + count)
            ]
        )
        bank = TeacherTaskBank.objects.get(teacher=teacher)
        bank.next_task_number = max(bank.next_task_number or 1, start_at + count)
        bank.save(update_fields=["next_task_number"])

    def _create(self, teacher, **kwargs):
        self.api.force_authenticate(user=teacher)
        payload = {
            "task_list_id": self.tl.id,
            "task_template": "<p>Новая</p>",
            "answer": "1",
            "status": "ready",
        }
        payload.update(kwargs)
        return self.api.post("/api/cabinet/my-tasks/", payload, format="json")

    def _copy(self, teacher, source_id=None):
        self.api.force_authenticate(user=teacher)
        return self.api.post(
            "/api/cabinet/my-tasks/copy-from-global/",
            {"task_id": source_id or self.global_task.id},
            format="json",
        )

    def _duplicate(self, teacher, task_id):
        self.api.force_authenticate(user=teacher)
        return self.api.post(f"/api/cabinet/my-tasks/{task_id}/duplicate/", format="json")

    def test_free_create_allowed_until_20(self):
        self.assertEqual(self._create(self.teacher_a).status_code, 201)
        self._fill(self.teacher_a, 18, start_at=2)
        nineteenth = self._create(self.teacher_a, task_template="<p>19</p>")
        self.assertEqual(nineteenth.status_code, 201, nineteenth.content)
        self.assertEqual(count_teacher_tasks(self.teacher_a), 20)
        blocked = self._create(self.teacher_a, task_template="<p>21</p>")
        self.assertEqual(blocked.status_code, 403)
        body = blocked.json()
        self.assertEqual(body["code"], TEACHER_TASK_LIMIT_REACHED)
        self.assertEqual(body["current"], 20)
        self.assertEqual(body["limit"], 20)
        self.assertTrue(body["upgrade_required"])
        self.assertIn("20", body["message"])

    def test_free_edit_allowed_when_full(self):
        created = self._create_owned(self.teacher_a)
        self._fill(self.teacher_a, 19, start_at=2)
        self.api.force_authenticate(user=self.teacher_a)
        resp = self.api.patch(
            f"/api/cabinet/my-tasks/{created['id']}/",
            {"task_template": "<p>Исправлено</p>", "answer": "9"},
            format="json",
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        task = Task.objects.get(pk=created["id"])
        self.assertIn("Исправлено", task.task_template)

    def test_free_duplicate_denied_when_full(self):
        created = self._create_owned(self.teacher_a)
        self._fill(self.teacher_a, 19, start_at=2)
        resp = self._duplicate(self.teacher_a, created["id"])
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(resp.json()["code"], TEACHER_TASK_LIMIT_REACHED)

    def test_free_copy_denied_when_task_limit_full_even_if_copy_quota_left(self):
        self._fill(self.teacher_a, 20)
        self.assertEqual(count_teacher_task_copies_this_period(self.teacher_a), 0)
        resp = self._copy(self.teacher_a)
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(resp.json()["code"], TEACHER_TASK_LIMIT_REACHED)

    def test_free_copy_quota_five_per_month(self):
        for i in range(5):
            extra = Task.objects.create(
                task=self.tl,
                task_template=f"<p>G{i}</p>",
                answer="1",
                is_active=True,
            )
            resp = self._copy(self.teacher_a, extra.id)
            self.assertEqual(resp.status_code, 201, resp.content)
        blocked = self._copy(self.teacher_a)
        self.assertEqual(blocked.status_code, 403)
        self.assertEqual(blocked.json()["code"], TEACHER_TASK_COPY_LIMIT_REACHED)
        still_create = self._create(self.teacher_a, task_template="<p>ручная</p>")
        self.assertEqual(still_create.status_code, 201, still_create.content)
        self.assertEqual(count_teacher_task_copies_this_period(self.teacher_a), 5)

    def test_duplicate_does_not_consume_copy_quota(self):
        created = self._create_owned(self.teacher_a)
        dup = self._duplicate(self.teacher_a, created["id"])
        self.assertEqual(dup.status_code, 201, dup.content)
        self.assertEqual(count_teacher_task_copies_this_period(self.teacher_a), 0)

    def test_archive_does_not_free_slot(self):
        created = self._create_owned(self.teacher_a)
        self._fill(self.teacher_a, 19, start_at=2)
        self.api.force_authenticate(user=self.teacher_a)
        archived = self.api.post(f"/api/cabinet/my-tasks/{created['id']}/archive/")
        self.assertEqual(archived.status_code, 200, archived.content)
        blocked = self._create(self.teacher_a)
        self.assertEqual(blocked.status_code, 403)
        self.assertEqual(count_teacher_tasks(self.teacher_a), 20)

    def test_list_returns_capabilities_for_free(self):
        self._fill(self.teacher_a, 12)
        self.api.force_authenticate(user=self.teacher_a)
        resp = self.api.get("/api/cabinet/my-tasks/")
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(body["plan_slug"], "start")
        self.assertEqual(body["usage"]["tasks"], 12)
        self.assertEqual(body["usage"]["task_limit"], 20)
        self.assertEqual(body["usage"]["copy_limit"], 5)
        self.assertTrue(body["capabilities"]["create_task"])
        self.assertFalse(body["capabilities"]["attach_files"])
        self.assertFalse(body["capabilities"]["bulk_import"])
        self.assertFalse(body["capabilities"]["advanced_analytics"])

    def test_attachments_denied_on_start(self):
        from django.core.files.uploadedfile import SimpleUploadedFile

        created = self._create_owned(self.teacher_a)
        self.api.force_authenticate(user=self.teacher_a)
        pdf = SimpleUploadedFile("grafik.pdf", b"%PDF-1.4 test", content_type="application/pdf")
        resp = self.api.post(
            f"/api/cabinet/my-tasks/{created['id']}/attachments/",
            {"file": pdf},
            format="multipart",
        )
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(resp.json()["code"], TEACHER_TASK_ATTACHMENTS_REQUIRED)

    def test_teacher_limit_500(self):
        set_plan(self.teacher_a, self.plans["teacher"])
        self._fill(self.teacher_a, 499)
        allowed = self._create(self.teacher_a)
        self.assertEqual(allowed.status_code, 201, allowed.content)
        blocked = self._create(self.teacher_a, task_template="<p>501</p>")
        self.assertEqual(blocked.status_code, 403)
        self.assertEqual(blocked.json()["limit"], 500)
        self.assertEqual(blocked.json()["current"], 500)

    def test_pro_high_limit_allows_create(self):
        set_plan(self.teacher_a, self.plans["pro"])
        self._fill(self.teacher_a, 20)
        resp = self._create(self.teacher_a)
        self.assertEqual(resp.status_code, 201, resp.content)
        self.api.force_authenticate(user=self.teacher_a)
        meta = self.api.get("/api/cabinet/my-tasks/meta/").json()
        self.assertEqual(meta["usage"]["task_limit"], 5000)
        self.assertIsNone(meta["usage"]["copy_limit"])
        self.assertTrue(meta["capabilities"]["bulk_import"])
        self.assertTrue(meta["capabilities"]["advanced_analytics"])

    def test_premium_unlimited_create(self):
        set_plan(self.teacher_a, self.plans["premium"])
        self._fill(self.teacher_a, 25)
        resp = self._create(self.teacher_a)
        self.assertEqual(resp.status_code, 201, resp.content)
        self.api.force_authenticate(user=self.teacher_a)
        meta = self.api.get("/api/cabinet/my-tasks/meta/").json()
        self.assertIsNone(meta["usage"]["task_limit"])
        self.assertTrue(meta["capabilities"]["create_task"])

    def test_downgrade_keeps_data_blocks_create(self):
        set_plan(self.teacher_a, self.plans["teacher"])
        first = self._create_owned(self.teacher_a, text="Сохранить")
        self._fill(self.teacher_a, 99, start_at=2)
        variant = Variant.objects.create(var_subject=self.subject, level=self.level, created_by="test")
        VariantContent.objects.create(variant=variant, task_id=first["id"], order=1)
        set_plan(self.teacher_a, self.plans["start"])

        self.api.force_authenticate(user=self.teacher_a)
        listing = self.api.get("/api/cabinet/my-tasks/?per_page=50")
        self.assertEqual(listing.status_code, 200)
        self.assertEqual(listing.json()["counts"]["all"], 100)
        self.assertEqual(count_teacher_tasks(self.teacher_a), 100)
        self.assertFalse(listing.json()["capabilities"]["create_task"])
        self.assertGreater(listing.json()["usage"]["tasks"], listing.json()["usage"]["task_limit"])

        detail = self.api.get(f"/api/cabinet/my-tasks/{first['id']}/")
        self.assertEqual(detail.status_code, 200)
        patched = self.api.patch(
            f"/api/cabinet/my-tasks/{first['id']}/",
            {"task_template": "<p>Правка после понижения</p>"},
            format="json",
        )
        self.assertEqual(patched.status_code, 200, patched.content)
        self.assertEqual(self._create(self.teacher_a).status_code, 403)
        self.assertEqual(self._duplicate(self.teacher_a, first["id"]).status_code, 403)
        self.assertEqual(self._copy(self.teacher_a).status_code, 403)
        self.assertEqual(count_teacher_tasks(self.teacher_a), 100)
        self.assertTrue(VariantContent.objects.filter(variant=variant, task_id=first["id"]).exists())

        body = self._create(self.teacher_a).json()
        self.assertIn("сохранены", body["message"].lower())

    def test_expired_paid_plan_uses_start_limits(self):
        set_plan(
            self.teacher_a,
            self.plans["teacher"],
            source=TeacherSubscription.Source.PAYMENT,
            expires_at=timezone.now() - timedelta(days=1),
            status=TeacherSubscription.Status.ACTIVE,
        )
        self._fill(self.teacher_a, 21)
        resp = self._create(self.teacher_a)
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(resp.json()["limit"], 20)

    def test_isolation_holds_on_premium(self):
        set_plan(self.teacher_a, self.plans["premium"])
        set_plan(self.teacher_b, self.plans["premium"])
        owned = self._create_owned(self.teacher_a)
        self.api.force_authenticate(user=self.teacher_b)
        self.assertEqual(self.api.get(f"/api/cabinet/my-tasks/{owned['id']}/").status_code, 404)
        self.assertEqual(self._duplicate(self.teacher_b, owned["id"]).status_code, 404)
        patch = self.api.patch(
            f"/api/cabinet/my-tasks/{owned['id']}/",
            {"task_template": "<p>чужое</p>"},
            format="json",
        )
        self.assertEqual(patch.status_code, 404)


class TeacherTaskLimitRaceTests(TransactionTestCase):
    def setUp(self):
        from Generator.models import Level, Part, Subject, TaskList

        self.subject = Subject.objects.create(subject_short="math", subject_name="Математика")
        self.level = Level.objects.create(level="oge", level_rus="ОГЭ")
        self.part = Part.objects.create(part_title="Часть 1")
        self.tl = TaskList.objects.create(
            subject=self.subject,
            level=self.level,
            part=self.part,
            task_number=8,
            task_title="Квадратные уравнения",
            max_score=1,
        )
        self.plans = ensure_bank_plans()
        self.teacher = _make_teacher("teacher_race_bank")
        set_plan(self.teacher, self.plans["start"])
        get_or_create_teacher_bank(self.teacher)
        Task.objects.bulk_create(
            [
                Task(
                    task=self.tl,
                    quick_level=self.level,
                    task_template=f"<p>r{i}</p>",
                    answer="1",
                    is_active=True,
                    scope=Task.Scope.TEACHER,
                    owner_teacher=self.teacher,
                    local_number=i,
                    status=Task.Status.READY,
                )
                for i in range(1, 20)
            ]
        )
        bank = TeacherTaskBank.objects.get(teacher=self.teacher)
        bank.next_task_number = 20
        bank.save(update_fields=["next_task_number"])

    def test_parallel_create_cannot_exceed_free_limit(self):
        user_id = self.teacher.pk
        tl_id = self.tl.id

        def worker(tag):
            close_old_connections()
            client = APIClient()
            user = User.objects.get(pk=user_id)
            client.force_authenticate(user=user)
            response = client.post(
                "/api/cabinet/my-tasks/",
                {
                    "task_list_id": tl_id,
                    "task_template": f"<p>race {tag}</p>",
                    "answer": "1",
                    "status": "ready",
                },
                format="json",
            )
            close_old_connections()
            return response.status_code

        with ThreadPoolExecutor(max_workers=2) as pool:
            codes = list(pool.map(worker, ("a", "b")))
        self.assertEqual(sorted(codes), [201, 403])
        self.assertEqual(count_teacher_tasks(self.teacher), 20)
