"""Staff mini-admin on «Все задачи»: PATCH ответа, TaskList и группы."""

from django.contrib.auth.models import User
from django.test import Client, TestCase

from Generator.models import Level, Part, Subject, SubTopic, Task, TaskGroup, TaskGroupMember, TaskList
from Generator.task_tag_access import can_edit_bank_tasks


class CanEditBankTasksTests(TestCase):
    def test_anonymous_denied(self):
        self.assertFalse(can_edit_bank_tasks(None))

    def test_regular_user_denied(self):
        user = User.objects.create_user("plain", password="pass12345")
        self.assertFalse(can_edit_bank_tasks(user))

    def test_staff_allowed(self):
        user = User.objects.create_user("staffer", password="pass12345", is_staff=True)
        self.assertTrue(can_edit_bank_tasks(user))

    def test_superuser_allowed(self):
        user = User.objects.create_superuser("root", "root@example.com", "pass12345")
        self.assertTrue(can_edit_bank_tasks(user))

    def test_superuser_without_staff_flag_allowed(self):
        user = User.objects.create_user(
            "super_only", password="pass12345", is_superuser=True, is_staff=False
        )
        self.assertTrue(can_edit_bank_tasks(user))


class TaskStaffPanelApiTests(TestCase):
    def setUp(self):
        self.client = Client()
        self.subject = Subject.objects.create(subject_short="math", subject_name="Математика")
        self.level = Level.objects.create(level="oge", level_rus="ОГЭ")
        self.part = Part.objects.create(part_title="Часть 1")
        self.tl1 = TaskList.objects.create(
            subject=self.subject,
            level=self.level,
            part=self.part,
            task_number=1,
            task_title="Планиметрия",
            max_score=1,
        )
        self.tl2 = TaskList.objects.create(
            subject=self.subject,
            level=self.level,
            part=self.part,
            task_number=2,
            task_title="Векторы",
            max_score=1,
        )
        self.task = Task.objects.create(
            task=self.tl1,
            task_template="<p>Чему равен угол?</p>",
            answer="",
            is_active=True,
        )
        self.staff = User.objects.create_user("staff_panel", password="pass12345", is_staff=True)
        self.plain = User.objects.create_user("plain_panel", password="pass12345")
        self.superuser = User.objects.create_superuser(
            "super_panel", "super_panel@example.com", "pass12345"
        )

    def _url(self, task_id=None):
        return f"/api/tasks/{task_id or self.task.id}/staff/"

    def test_anonymous_forbidden(self):
        resp = self.client.patch(
            self._url(),
            data={"answer": "90"},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 403)

    def test_non_staff_forbidden(self):
        self.client.force_login(self.plain)
        resp = self.client.patch(
            self._url(),
            data={"answer": "90"},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 403)
        self.task.refresh_from_db()
        self.assertEqual(self.task.answer, "")

    def test_staff_saves_answer(self):
        self.client.force_login(self.staff)
        resp = self.client.patch(
            self._url(),
            data={"answer": "90°"},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        data = resp.json()
        self.assertEqual(data["answer"], "90°")
        self.assertEqual(data["task_list_id"], self.tl1.id)
        self.assertIsNone(data["group_id"])
        self.task.refresh_from_db()
        self.assertEqual(self.task.answer, "90°")
        self.assertEqual(self.task.created_by, "staff_panel")
        self.assertEqual(data["created_by"], "staff_panel")

    def test_staff_changes_task_list(self):
        self.client.force_login(self.staff)
        resp = self.client.patch(
            self._url(),
            data={"task_list_id": self.tl2.id},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        data = resp.json()
        self.assertEqual(data["task_list_id"], self.tl2.id)
        self.assertEqual(data["task_number"], 2)
        self.assertEqual(data["task_title"], "Векторы")
        self.task.refresh_from_db()
        self.assertEqual(self.task.task_id, self.tl2.id)

    def test_staff_assigns_and_clears_group(self):
        group = TaskGroup.objects.create(subject=self.subject, level=self.level)
        self.client.force_login(self.staff)
        resp = self.client.patch(
            self._url(),
            data={"group_id": group.id},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.json()["group_id"], group.id)
        self.assertTrue(
            TaskGroupMember.objects.filter(task=self.task, task_group=group, task_number=1).exists()
        )
        self.task.refresh_from_db()
        self.assertEqual(self.task.created_by, "staff_panel")

        resp = self.client.patch(
            self._url(),
            data={"group_id": None},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertIsNone(resp.json()["group_id"])
        self.assertFalse(TaskGroupMember.objects.filter(task=self.task).exists())

    def test_staff_creates_new_group_for_subject(self):
        self.client.force_login(self.staff)
        resp = self.client.patch(
            self._url(),
            data={"create_group": True},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        group_id = resp.json()["group_id"]
        self.assertIsNotNone(group_id)
        group = TaskGroup.objects.get(pk=group_id)
        self.assertEqual(group.subject_id, self.subject.id)
        self.assertEqual(group.level_id, self.level.id)
        self.assertTrue(
            TaskGroupMember.objects.filter(
                task=self.task, task_group=group, task_number=1
            ).exists()
        )

    def test_staff_adds_to_existing_group_other_number(self):
        group = TaskGroup.objects.create(subject=self.subject, level=self.level)
        other = Task.objects.create(
            task=self.tl2,
            task_template="<p>векторы</p>",
            answer="",
            is_active=True,
        )
        TaskGroupMember.objects.create(task_group=group, task=other, task_number=2)
        self.client.force_login(self.staff)
        resp = self.client.patch(
            self._url(),
            data={"group_id": group.id},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.json()["group_id"], group.id)
        self.assertTrue(
            TaskGroupMember.objects.filter(task=self.task, task_group=group, task_number=1).exists()
        )
        self.assertTrue(
            TaskGroupMember.objects.filter(task=other, task_group=group, task_number=2).exists()
        )

    def test_staff_lists_groups_for_subject(self):
        group = TaskGroup.objects.create(subject=self.subject, level=self.level)
        TaskGroupMember.objects.create(task_group=group, task=self.task, task_number=1)
        other_level = Level.objects.create(level="ege", level_rus="ЕГЭ")
        TaskGroup.objects.create(subject=self.subject, level=other_level)

        self.client.force_login(self.staff)
        resp = self.client.get("/api/oge/math/staff-groups/")
        self.assertEqual(resp.status_code, 200, resp.content)
        ids = [row["id"] for row in resp.json().get("groups") or []]
        self.assertIn(group.id, ids)
        found = next(row for row in resp.json()["groups"] if row["id"] == group.id)
        self.assertEqual(found["task_numbers"], [1])

        self.client.force_login(self.plain)
        resp = self.client.get("/api/oge/math/staff-groups/")
        self.assertEqual(resp.status_code, 403)

    def test_staff_creates_empty_group(self):
        self.client.force_login(self.staff)
        resp = self.client.post(
            "/api/oge/math/staff-groups/",
            data={},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 201, resp.content)
        group_id = resp.json()["id"]
        group = TaskGroup.objects.get(pk=group_id)
        self.assertEqual(group.subject_id, self.subject.id)
        self.assertEqual(group.level_id, self.level.id)
        self.assertEqual(group.taskgroupmember_set.count(), 0)
        self.assertEqual(resp.json()["member_count"], 0)

        listed = self.client.get("/api/oge/math/staff-groups/")
        ids = [row["id"] for row in listed.json().get("groups") or []]
        self.assertIn(group_id, ids)

    def test_staff_creates_and_lists_subtopics(self):
        self.client.force_login(self.staff)
        resp = self.client.post(
            "/api/oge/math/staff-subtopics/",
            data={"title": "Треугольники", "task_list_id": self.tl1.id},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 201, resp.content)
        payload = resp.json()
        self.assertEqual(payload["title"], "Треугольники")
        self.assertEqual(payload["task_list_id"], self.tl1.id)
        self.assertEqual(payload["task_number"], 1)
        self.assertTrue(SubTopic.objects.filter(pk=payload["id"], task_list=self.tl1).exists())
        self.assertEqual(payload["task_count"], 0)

        listed = self.client.get("/api/oge/math/staff-subtopics/")
        self.assertEqual(listed.status_code, 200)
        titles = [row["title"] for row in listed.json().get("subtopics") or []]
        self.assertIn("Треугольники", titles)
        found = next(row for row in listed.json()["subtopics"] if row["id"] == payload["id"])
        self.assertEqual(found["task_count"], 0)

        again = self.client.post(
            "/api/oge/math/staff-subtopics/",
            data={"title": "треугольники", "task_list_id": self.tl1.id},
            content_type="application/json",
        )
        self.assertEqual(again.status_code, 200)
        self.assertEqual(again.json()["id"], payload["id"])

        self.client.force_login(self.plain)
        resp = self.client.get("/api/oge/math/staff-subtopics/")
        self.assertEqual(resp.status_code, 403)

    def test_staff_creates_subtopic_from_task_list_title(self):
        self.client.force_login(self.staff)
        resp = self.client.post(
            "/api/oge/math/staff-subtopics/",
            data={"from_task": True, "task_list_id": self.tl1.id},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 201, resp.content)
        payload = resp.json()
        self.assertEqual(payload["title"], "Планиметрия")
        self.assertEqual(payload["task_list_id"], self.tl1.id)
        self.assertTrue(
            SubTopic.objects.filter(pk=payload["id"], task_list=self.tl1, title="Планиметрия").exists()
        )

        again = self.client.post(
            "/api/oge/math/staff-subtopics/",
            data={"from_task": True, "task_list_id": self.tl1.id},
            content_type="application/json",
        )
        self.assertEqual(again.status_code, 200)
        self.assertEqual(again.json()["id"], payload["id"])

        patch = self.client.patch(
            self._url(),
            data={"from_task": True},
            content_type="application/json",
        )
        self.assertEqual(patch.status_code, 200, patch.content)
        self.assertEqual(patch.json()["subtopic_id"], payload["id"])
        self.assertEqual(patch.json()["subtopic"], "Планиметрия")
        self.task.refresh_from_db()
        self.assertEqual(self.task.subtopic_id, payload["id"])

    def test_staff_renames_task_list(self):
        self.client.force_login(self.staff)
        url = f"/api/oge/math/staff-task-lists/{self.tl1.id}/"
        resp = self.client.patch(
            url,
            data={"task_title": "Планиметрия: углы"},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.json()["task_list_id"], self.tl1.id)
        self.assertEqual(resp.json()["task_title"], "Планиметрия: углы")
        self.tl1.refresh_from_db()
        self.assertEqual(self.tl1.task_title, "Планиметрия: углы")

        self.client.force_login(self.plain)
        resp = self.client.patch(
            url,
            data={"task_title": "хак"},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 403)
        self.tl1.refresh_from_db()
        self.assertEqual(self.tl1.task_title, "Планиметрия: углы")

    def test_group_number_conflict(self):
        group = TaskGroup.objects.create(subject=self.subject, level=self.level)
        other = Task.objects.create(
            task=self.tl1,
            task_template="<p>другое</p>",
            answer="1",
            is_active=True,
        )
        TaskGroupMember.objects.create(task_group=group, task=other, task_number=1)
        self.client.force_login(self.staff)
        resp = self.client.patch(
            self._url(),
            data={"group_id": group.id},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 400)
        self.assertIn("уже есть", resp.json()["error"])

    def test_bank_includes_group_id(self):
        group = TaskGroup.objects.create(subject=self.subject, level=self.level)
        TaskGroupMember.objects.create(task_group=group, task=self.task, task_number=1)
        resp = self.client.get(
            f"/api/oge/math/task-bank/?task_list_id={self.tl1.id}&per_page=20"
        )
        self.assertEqual(resp.status_code, 200)
        rows = resp.json().get("tasks") or []
        found = next((row for row in rows if row["id"] == self.task.id), None)
        self.assertIsNotNone(found)
        self.assertEqual(found["group_id"], group.id)

    def test_me_exposes_staff_flag(self):
        self.client.force_login(self.staff)
        resp = self.client.get("/api/cabinet/me/")
        self.assertEqual(resp.status_code, 200)
        user = resp.json().get("user") or {}
        self.assertTrue(user.get("is_staff"))
        self.assertTrue(user.get("can_edit_bank_tasks"))

        self.client.force_login(self.plain)
        resp = self.client.get("/api/cabinet/me/")
        user = resp.json().get("user") or {}
        self.assertFalse(user.get("is_staff"))
        self.assertFalse(user.get("is_superuser"))
        self.assertFalse(user.get("can_edit_bank_tasks"))

    def test_me_exposes_superuser_flag(self):
        self.client.force_login(self.superuser)
        resp = self.client.get("/api/cabinet/me/")
        self.assertEqual(resp.status_code, 200)
        user = resp.json().get("user") or {}
        self.assertTrue(user.get("is_superuser"))
        self.assertTrue(user.get("can_edit_bank_tasks"))

    def test_superuser_saves_answer(self):
        self.client.force_login(self.superuser)
        resp = self.client.patch(
            self._url(),
            data={"answer": "180"},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.json()["answer"], "180")
        self.task.refresh_from_db()
        self.assertEqual(self.task.answer, "180")
        self.assertEqual(self.task.created_by, "super_panel")

    def test_staff_sets_and_clears_subtopic(self):
        st = SubTopic.objects.create(task_list=self.tl1, title="Треугольники", order=1)
        self.client.force_login(self.staff)
        resp = self.client.patch(
            self._url(),
            data={"subtopic_id": st.id},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.json()["subtopic_id"], st.id)
        self.assertEqual(resp.json()["subtopic"], "Треугольники")
        self.task.refresh_from_db()
        self.assertEqual(self.task.subtopic_id, st.id)
        self.assertEqual(self.task.created_by, "staff_panel")

        resp = self.client.patch(
            self._url(),
            data={"subtopic_id": None},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertIsNone(resp.json()["subtopic_id"])
        self.task.refresh_from_db()
        self.assertIsNone(self.task.subtopic_id)

    def test_staff_creates_subtopic(self):
        self.client.force_login(self.staff)
        resp = self.client.patch(
            self._url(),
            data={"create_subtopic": "Окружность"},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.json()["subtopic"], "Окружность")
        st_id = resp.json()["subtopic_id"]
        self.assertTrue(SubTopic.objects.filter(pk=st_id, task_list=self.tl1, title="Окружность").exists())

    def test_subtopic_wrong_task_list_rejected(self):
        st = SubTopic.objects.create(task_list=self.tl2, title="Векторы тема", order=1)
        self.client.force_login(self.staff)
        resp = self.client.patch(
            self._url(),
            data={"subtopic_id": st.id},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 400)
