"""Персональный банк задач учителя: isolation, нумерация, смешанные варианты."""

from unittest.mock import patch

from django.contrib.auth.models import User
from django.db import transaction
from django.test import Client, TestCase, TransactionTestCase
from rest_framework.test import APIClient

from Cabinet.models import Profile, Student
from Generator.models import Level, Part, Subject, Task, TaskList, TeacherTaskBank, Variant, VariantContent
from Generator.teacher_task_bank import (
    allocate_task_number,
    format_task_public_code,
    get_or_create_teacher_bank,
    TEACHER_OWNED_TASK_NOTICE,
    TEACHER_OWNED_VARIANT_NOTICE,
)


def _make_teacher(username):
    user = User.objects.create_user(username=username, password="pass12345")
    user.profile.role = Profile.Role.TEACHER
    user.profile.save(update_fields=["role"])
    return user


def _make_student_user(username):
    user = User.objects.create_user(username=username, password="pass12345")
    user.profile.role = Profile.Role.STUDENT
    user.profile.save(update_fields=["role"])
    return user


class TeacherTaskBankBase(TestCase):
    def setUp(self):
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
        self.teacher_a = _make_teacher("teacher_a_bank")
        self.teacher_b = _make_teacher("teacher_b_bank")
        self.student_user = _make_student_user("student_bank")
        self.student = Student.objects.create(
            teacher=self.teacher_a,
            user=self.student_user,
            first_name="Иван",
            last_name="Учеников",
            status="active",
        )
        self.global_task = Task.objects.create(
            task=self.tl,
            task_template="<p>Глобальная задача</p>",
            answer="42",
            is_active=True,
        )
        self.api = APIClient()
        self.http = Client()

    def _create_owned(self, teacher, text="Моя задача", answer="1", **kwargs):
        self.api.force_authenticate(user=teacher)
        payload = {
            "task_list_id": self.tl.id,
            "task_template": f"<p>{text}</p>",
            "answer": answer,
            "status": "ready",
        }
        payload.update(kwargs)
        resp = self.api.post("/api/cabinet/my-tasks/", payload, format="json")
        self.assertEqual(resp.status_code, 201, resp.content)
        return resp.json()


class TeacherTaskBankIsolationTests(TeacherTaskBankBase):
    def test_owner_can_get_own_task(self):
        created = self._create_owned(self.teacher_a, text="A1")
        self.api.force_authenticate(user=self.teacher_a)
        resp = self.api.get(f"/api/cabinet/my-tasks/{created['id']}/")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["local_number"], 1)
        self.assertIn("answer", resp.json())

    def test_other_teacher_cannot_get_or_edit(self):
        created = self._create_owned(self.teacher_a, text="secret")
        self.api.force_authenticate(user=self.teacher_b)
        detail = self.api.get(f"/api/cabinet/my-tasks/{created['id']}/")
        self.assertEqual(detail.status_code, 404)
        patch = self.api.patch(
            f"/api/cabinet/my-tasks/{created['id']}/",
            {"task_template": "<p>hack</p>"},
            format="json",
        )
        self.assertEqual(patch.status_code, 404)
        delete = self.api.delete(f"/api/cabinet/my-tasks/{created['id']}/")
        self.assertEqual(delete.status_code, 404)
        search = self.api.get("/api/cabinet/my-tasks/?q=secret")
        self.assertEqual(search.status_code, 200)
        self.assertEqual(search.json()["total"], 0)

    def test_owner_teacher_in_post_is_ignored(self):
        self.api.force_authenticate(user=self.teacher_a)
        resp = self.api.post(
            "/api/cabinet/my-tasks/",
            {
                "task_list_id": self.tl.id,
                "task_template": "<p>x</p>",
                "owner_teacher": self.teacher_b.id,
                "scope": "global",
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 400)

    def test_student_cannot_edit(self):
        created = self._create_owned(self.teacher_a)
        self.api.force_authenticate(user=self.student_user)
        resp = self.api.get(f"/api/cabinet/my-tasks/{created['id']}/")
        self.assertEqual(resp.status_code, 403)
        edit = self.api.patch(
            f"/api/cabinet/my-tasks/{created['id']}/",
            {"answer": "leak"},
            format="json",
        )
        self.assertEqual(edit.status_code, 403)

    def test_public_bank_does_not_list_teacher_tasks(self):
        created = self._create_owned(self.teacher_a)
        resp = self.http.get("/api/oge/math/task-bank/?per_page=50")
        self.assertEqual(resp.status_code, 200)
        ids = [row["id"] for row in resp.json()["tasks"]]
        self.assertNotIn(created["id"], ids)
        self.assertIn(self.global_task.id, ids)

    def test_search_task_does_not_find_teacher_task(self):
        created = self._create_owned(self.teacher_a)
        resp = self.http.get(f"/api/search_task/?q={created['id']}")
        payload = resp.json()
        self.assertEqual(payload["tasks"], [])
        self.assertEqual(payload["notice"]["code"], "teacher_owned")
        self.assertEqual(payload["notice"]["message"], TEACHER_OWNED_TASK_NOTICE)
        self.assertNotIn("task_text", payload)
        self.assertNotIn("answer", payload)

    def test_owner_can_search_own_task_by_id(self):
        created = self._create_owned(self.teacher_a)
        self.http.force_login(self.teacher_a)
        resp = self.http.get(f"/api/search_task/?q={created['id']}")
        payload = resp.json()
        self.assertEqual(len(payload["tasks"]), 1)
        self.assertEqual(payload["tasks"][0]["id"], created["id"])
        self.assertTrue(payload["tasks"][0]["mine"])
        self.assertNotIn("notice", payload)

    def test_owner_can_search_own_task_by_public_code(self):
        created = self._create_owned(self.teacher_a)
        self.http.force_login(self.teacher_a)
        resp = self.http.get(f"/api/search_task/?q={created['public_code']}")
        payload = resp.json()
        self.assertEqual(len(payload["tasks"]), 1)
        self.assertEqual(payload["tasks"][0]["id"], created["id"])
        self.assertTrue(payload["tasks"][0]["mine"])

    def test_anonymous_search_by_public_code_is_hidden(self):
        created = self._create_owned(self.teacher_a)
        resp = self.http.get(f"/api/search_task/?q={created['public_code']}")
        payload = resp.json()
        self.assertEqual(payload["tasks"], [])
        self.assertEqual(payload["notice"]["code"], "teacher_owned")
        self.assertEqual(payload["notice"]["message"], TEACHER_OWNED_TASK_NOTICE)

    def test_other_teacher_search_gets_logged_in_notice(self):
        created = self._create_owned(self.teacher_a)
        self.http.force_login(self.teacher_b)
        resp = self.http.get(f"/api/search_task/?q={created['id']}")
        payload = resp.json()
        self.assertEqual(payload["tasks"], [])
        self.assertEqual(payload["notice"]["code"], "teacher_owned")
        self.assertEqual(payload["notice"]["bank_url"], "/tasks/my")
        self.assertNotEqual(payload["notice"]["message"], TEACHER_OWNED_TASK_NOTICE)

    def test_bank_search_finds_task_by_database_id(self):
        created = self._create_owned(self.teacher_a)
        self.api.force_authenticate(user=self.teacher_a)
        resp = self.api.get(f"/api/cabinet/my-tasks/?q={created['id']}")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["total"], 1)
        self.assertEqual(resp.json()["tasks"][0]["id"], created["id"])

    def test_search_variant_hides_teacher_owned_variant(self):
        created = self._create_owned(self.teacher_a)
        self.http.force_login(self.teacher_a)
        with patch("Cabinet.subscription_access.SubscriptionAccessService.enforce_variant_creation"):
            made = self.http.post(
                "/api/oge/math/variant-from-ids/",
                data={"task_ids": [created["id"]]},
                content_type="application/json",
            )
        self.assertEqual(made.status_code, 200, made.content)
        variant_id = made.json()["variant_id"]
        self.http.logout()
        hidden = self.http.get(f"/api/search_variant/?q={variant_id}")
        payload = hidden.json()
        self.assertIsNone(payload["variant"])
        self.assertEqual(payload["tasks"], [])
        self.assertEqual(payload["notice"]["message"], TEACHER_OWNED_VARIANT_NOTICE)
        self.http.force_login(self.teacher_a)
        own = self.http.get(f"/api/search_variant/?q={variant_id}")
        own_payload = own.json()
        self.assertEqual(own_payload["variant"]["id"], variant_id)
        self.assertEqual(len(own_payload["tasks"]), 1)

    def test_other_teacher_cannot_add_to_variant(self):
        created = self._create_owned(self.teacher_a)
        self.http.force_login(self.teacher_b)
        with patch("Cabinet.subscription_access.SubscriptionAccessService.enforce_variant_creation"):
            resp = self.http.post(
                "/api/oge/math/variant-from-ids/",
                data={"task_ids": [created["id"]]},
                content_type="application/json",
            )
        self.assertEqual(resp.status_code, 403)
        payload = resp.json()
        self.assertEqual(payload["code"], "teacher_owned")
        self.assertEqual(payload["error"], TEACHER_OWNED_TASK_NOTICE)


class TeacherTaskNumberingTests(TeacherTaskBankBase):
    def test_local_numbers_are_per_teacher_and_not_reused(self):
        a1 = self._create_owned(self.teacher_a, text="a1")
        a2 = self._create_owned(self.teacher_a, text="a2")
        a3 = self._create_owned(self.teacher_a, text="a3")
        b1 = self._create_owned(self.teacher_b, text="b1")
        b2 = self._create_owned(self.teacher_b, text="b2")
        self.assertEqual([a1["local_number"], a2["local_number"], a3["local_number"]], [1, 2, 3])
        self.assertEqual([b1["local_number"], b2["local_number"]], [1, 2])
        bank_a = TeacherTaskBank.objects.get(teacher=self.teacher_a)
        bank_b = TeacherTaskBank.objects.get(teacher=self.teacher_b)
        self.assertNotEqual(bank_a.public_code, bank_b.public_code)
        self.assertEqual(a1["public_code"], format_task_public_code(bank_a.public_code, 1))
        self.api.force_authenticate(user=self.teacher_a)
        self.api.delete(f"/api/cabinet/my-tasks/{a2['id']}/")
        a4 = self._create_owned(self.teacher_a, text="a4")
        self.assertEqual(a4["local_number"], 4)
        self.assertEqual(a4["public_code"], format_task_public_code(bank_a.public_code, 4))
        self.api.force_authenticate(user=self.teacher_a)
        found = self.api.get(f"/api/cabinet/my-tasks/?q={a4['public_code']}")
        self.assertEqual(found.status_code, 200)
        self.assertEqual(found.json()["total"], 1)
        self.assertEqual(found.json()["tasks"][0]["id"], a4["id"])
        foreign_code = format_task_public_code(bank_b.public_code, 1)
        miss = self.api.get(f"/api/cabinet/my-tasks/?q={foreign_code}")
        self.assertEqual(miss.json()["total"], 0)

    def test_copy_from_global_creates_independent_copy(self):
        self.api.force_authenticate(user=self.teacher_a)
        resp = self.api.post(
            "/api/cabinet/my-tasks/copy-from-global/",
            {"task_id": self.global_task.id},
            format="json",
        )
        self.assertEqual(resp.status_code, 201, resp.content)
        copy = resp.json()
        self.assertEqual(copy["source_task_id"], self.global_task.id)
        self.assertEqual(copy["scope"], "teacher")
        self.assertEqual(copy["author"], "teacher_a_bank")
        Task.objects.filter(pk=copy["id"]).update(task_template="<p>changed by teacher</p>")
        self.global_task.refresh_from_db()
        self.assertEqual(self.global_task.task_template, "<p>Глобальная задача</p>")

    def test_used_task_cannot_be_deleted(self):
        created = self._create_owned(self.teacher_a)
        task = Task.objects.get(pk=created["id"])
        variant = Variant.objects.create(var_subject=self.subject, level=self.level, created_by="test")
        VariantContent.objects.create(variant=variant, task=task, order=1)
        self.api.force_authenticate(user=self.teacher_a)
        resp = self.api.delete(f"/api/cabinet/my-tasks/{task.id}/")
        self.assertEqual(resp.status_code, 409)
        archive = self.api.post(f"/api/cabinet/my-tasks/{task.id}/archive/")
        self.assertEqual(archive.status_code, 200)
        task.refresh_from_db()
        self.assertEqual(task.status, Task.Status.ARCHIVED)
        self.assertFalse(task.is_active)


class TeacherTaskMixedVariantTests(TeacherTaskBankBase):
    def test_mixed_variant_roundtrip_and_student_answers_hidden(self):
        t1 = self._create_owned(self.teacher_a, text="TA", answer="own-a")
        t2 = self._create_owned(self.teacher_a, text="TB", answer="own-b")
        global_b = Task.objects.create(
            task=self.tl,
            task_template="<p>Глобальная B</p>",
            answer="gb",
            is_active=True,
        )
        self.http.force_login(self.teacher_a)
        with patch("Cabinet.subscription_access.SubscriptionAccessService.enforce_variant_creation"):
            resp = self.http.post(
                "/api/oge/math/variant-from-ids/",
                data={
                    "task_ids": [self.global_task.id, t1["id"], global_b.id, t2["id"]],
                },
                content_type="application/json",
            )
        self.assertEqual(resp.status_code, 200, resp.content)
        variant_id = resp.json()["variant_id"]
        variant = Variant.objects.get(pk=variant_id)
        self.assertEqual(variant.owner_teacher_id, self.teacher_a.id)
        self.assertEqual(variant.local_number, 1)
        orders = list(
            VariantContent.objects.filter(variant=variant).order_by("order").values_list("task_id", flat=True)
        )
        self.assertEqual(orders, [self.global_task.id, t1["id"], global_b.id, t2["id"]])

        teacher_json = self.http.get(f"/api/oge/math/variant/{variant_id}/").json()
        self.assertEqual(len(teacher_json["tasks"]), 4)
        self.assertTrue(any(row.get("answer") for row in teacher_json["tasks"]))

        self.http.logout()
        self.http.force_login(self.student_user)
        student_json = self.http.get(f"/api/oge/math/variant/{variant_id}/?role=student").json()
        self.assertEqual(len(student_json["tasks"]), 4)
        for row in student_json["tasks"]:
            self.assertEqual(row.get("answer") or "", "")
            self.assertNotIn("public_code", row)
        check = self.http.post(
            f"/api/variant/{variant_id}/check-answer/",
            data={"task_id": t1["id"], "answer": "own-a"},
            content_type="application/json",
        )
        self.assertEqual(check.status_code, 200)
        self.assertTrue(check.json()["correct"])

    def test_generator_source_does_not_leak_other_teacher_tasks(self):
        created = self._create_owned(self.teacher_a, text="secret-mine")
        self.http.force_login(self.teacher_b)
        mine = self.http.get("/api/oge/math/task-bank/?source=mine&per_page=50")
        self.assertEqual(mine.status_code, 200)
        mine_ids = [row["id"] for row in mine.json()["tasks"]]
        self.assertNotIn(created["id"], mine_ids)
        both = self.http.get("/api/oge/math/task-bank/?source=all&per_page=50")
        both_ids = [row["id"] for row in both.json()["tasks"]]
        self.assertNotIn(created["id"], both_ids)
        self.assertIn(self.global_task.id, both_ids)
        self.http.force_login(self.teacher_a)
        own = self.http.get("/api/oge/math/task-bank/?source=mine&per_page=50")
        own_ids = [row["id"] for row in own.json()["tasks"]]
        self.assertIn(created["id"], own_ids)

    def test_unassigned_student_does_not_see_teacher_bank(self):
        created = self._create_owned(self.teacher_a)
        other_student = _make_student_user("other_student_bank")
        self.api.force_authenticate(user=other_student)
        resp = self.api.get(f"/api/cabinet/my-tasks/{created['id']}/")
        self.assertEqual(resp.status_code, 403)


class TeacherTaskExamPartAndAttachmentsTests(TeacherTaskBankBase):
    def test_create_infers_exam_part_from_task_list_part_title(self):
        created = self._create_owned(self.teacher_a)
        self.assertEqual(created["exam_part"], 1)

    def test_explicit_exam_part_and_list_filter(self):
        first = self._create_owned(self.teacher_a, text="part1", exam_part=1)
        second = self._create_owned(self.teacher_a, text="part2", exam_part=2)
        none = self._create_owned(self.teacher_a, text="none", exam_part=None)
        self.assertIsNone(none["exam_part"])
        self.api.force_authenticate(user=self.teacher_a)
        only_second = self.api.get("/api/cabinet/my-tasks/?exam_part=2")
        self.assertEqual(only_second.status_code, 200)
        ids = [row["id"] for row in only_second.json()["tasks"]]
        self.assertIn(second["id"], ids)
        self.assertNotIn(first["id"], ids)
        self.assertNotIn(none["id"], ids)

    def test_catalog_suggests_exam_part_from_part_title(self):
        self.api.force_authenticate(user=self.teacher_a)
        resp = self.api.get("/api/cabinet/my-tasks/catalog/?subject=math&level=oge")
        self.assertEqual(resp.status_code, 200)
        numbers = resp.json()["task_numbers"]
        self.assertEqual(numbers[0]["suggested_exam_part"], 1)

    def test_attachment_owner_isolation_and_validation(self):
        from decimal import Decimal
        from django.core.files.uploadedfile import SimpleUploadedFile

        from Cabinet.models import TariffPlan, TeacherSubscription
        from Cabinet.subscription_service import SubscriptionLimitService

        teacher_plan, _ = TariffPlan.objects.update_or_create(
            slug="teacher",
            defaults={
                "name": "Учитель",
                "price_month": Decimal("1990"),
                "is_active": True,
                "has_teacher_task_attachments": True,
                "max_teacher_tasks": 500,
                "max_teacher_task_copies_monthly": None,
            },
        )
        sub = SubscriptionLimitService.get_or_create_subscription(self.teacher_a)
        sub.plan = teacher_plan
        sub.status = TeacherSubscription.Status.ACTIVE
        sub.save(update_fields=["plan", "status"])

        created = self._create_owned(self.teacher_a)
        self.api.force_authenticate(user=self.teacher_a)
        pdf = SimpleUploadedFile("grafik.pdf", b"%PDF-1.4 test", content_type="application/pdf")
        uploaded = self.api.post(
            f"/api/cabinet/my-tasks/{created['id']}/attachments/",
            {"file": pdf},
            format="multipart",
        )
        self.assertEqual(uploaded.status_code, 201, uploaded.content)
        att_id = uploaded.json()["id"]
        own = self.api.get(f"/api/cabinet/my-tasks/{created['id']}/attachments/{att_id}/")
        self.assertEqual(own.status_code, 200)

        self.api.force_authenticate(user=self.teacher_b)
        foreign = self.api.get(f"/api/cabinet/my-tasks/{created['id']}/attachments/{att_id}/")
        self.assertEqual(foreign.status_code, 404)
        foreign_del = self.api.delete(f"/api/cabinet/my-tasks/{created['id']}/attachments/{att_id}/")
        self.assertEqual(foreign_del.status_code, 404)

        self.api.force_authenticate(user=self.teacher_a)
        blocked = self.api.post(
            f"/api/cabinet/my-tasks/{created['id']}/attachments/",
            {"file": SimpleUploadedFile("bad.exe", b"MZ", content_type="application/octet-stream")},
            format="multipart",
        )
        self.assertEqual(blocked.status_code, 400)

    def test_image_upload_is_teacher_only(self):
        from django.core.files.uploadedfile import SimpleUploadedFile

        png = SimpleUploadedFile(
            "fig.png",
            b"\x89PNG\r\n\x1a\n" + b"0" * 24,
            content_type="image/png",
        )
        self.api.force_authenticate(user=self.teacher_a)
        resp = self.api.post("/api/cabinet/my-tasks/upload-image/", {"upload": png}, format="multipart")
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertIn("/media/", resp.json()["url"])
        self.assertIn(f"teacher_{self.teacher_a.pk}", resp.json()["url"])

        self.api.force_authenticate(user=self.student_user)
        denied = self.api.post(
            "/api/cabinet/my-tasks/upload-image/",
            {"upload": SimpleUploadedFile("fig2.png", b"\x89PNG\r\n\x1a\n" + b"1" * 24, content_type="image/png")},
            format="multipart",
        )
        self.assertEqual(denied.status_code, 403)


class TeacherTaskNumberingConcurrencyTests(TransactionTestCase):
    def setUp(self):
        self.teacher = _make_teacher("teacher_conc")

    def test_allocate_task_number_is_monotonic(self):
        numbers = []
        for _ in range(5):
            with transaction.atomic():
                n, _bank = allocate_task_number(self.teacher)
                numbers.append(n)
        self.assertEqual(numbers, [1, 2, 3, 4, 5])
        bank = get_or_create_teacher_bank(self.teacher)
        self.assertEqual(bank.next_task_number, 6)
        self.assertEqual(len(bank.public_code), 5)
        self.assertTrue(set(bank.public_code).isdisjoint(set("O01I")))
