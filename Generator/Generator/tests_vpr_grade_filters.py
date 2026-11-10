"""ВПР: класс в фильтрах есть только если в нём есть активное публичное задание."""

from django.contrib.auth.models import User
from django.test import Client, TestCase

from Generator.models import Level, SubTopic, Subject, Task, TaskList


def _task(task_list, *, active=True, grade=None, basic=True, scope="global", owner=None, local_number=None):
    return Task.objects.create(
        task=task_list,
        task_template="<p>задание</p>",
        answer="1",
        is_active=active,
        scope=scope,
        owner_teacher=owner,
        local_number=local_number,
        vpr_class=grade,
        vpr_basic=basic,
        vpr_advanced=not basic,
    )


class VprGradeFilterTests(TestCase):
    def setUp(self):
        self.client = Client()
        self.vpr = Level.objects.create(level="vpr", level_rus="ВПР")
        self.inf = Subject.objects.create(subject_short="inf", subject_name="Информатика")
        self.math = Subject.objects.create(subject_short="math", subject_name="Математика")

        # Старые пустые номера информатики без класса — их не удаляем.
        self.empty_inf = []
        for number in (1, 2):
            row = TaskList.objects.create(
                subject=self.inf,
                level=self.vpr,
                task_number=number,
                task_title=f"старый пустой №{number}",
                vpr_class=None,
                part=None,
            )
            self.empty_inf.append(row)
        SubTopic.objects.create(task_list=self.empty_inf[0], title="Пустая подтема", order=1)

        self.inf7 = TaskList.objects.create(
            subject=self.inf, level=self.vpr, task_number=1, task_title="ВПР 7 №1",
            vpr_class=7, part=None,
        )
        self.inf8 = TaskList.objects.create(
            subject=self.inf, level=self.vpr, task_number=1, task_title="ВПР 8 №1",
            vpr_class=8, part=None,
        )
        _task(self.inf7, grade=7)
        _task(self.inf8, grade=8)

        self.math7 = TaskList.objects.create(
            subject=self.math, level=self.vpr, task_number=1, task_title="ВПР 7 №1",
            vpr_class=7, part=None,
        )
        self.math10 = TaskList.objects.create(
            subject=self.math, level=self.vpr, task_number=1, task_title="ВПР 10 №1",
            vpr_class=10, part=None,
        )
        self.math10_empty = TaskList.objects.create(
            subject=self.math, level=self.vpr, task_number=2, task_title="ВПР 10 №2",
            vpr_class=10, part=None,
        )
        _task(self.math7, grade=7)
        _task(self.math10, grade=10)

    def test_inf_grade_10_hidden_and_math_grade_10_unchanged(self):
        hidden = self.client.get("/api/vpr/inf/task-bank-filters/?grade=10&advanced=0")
        self.assertEqual(hidden.status_code, 200)
        self.assertIn("no-store", hidden["Cache-Control"])
        body = hidden.json()
        self.assertEqual(body["grades"], [7, 8])
        self.assertNotIn(10, body["grades"])
        self.assertEqual(body["task_numbers"], [])
        self.assertEqual(body["subtopics"], [])

        inf7 = self.client.get("/api/vpr/inf/task-bank-filters/?grade=7&advanced=0").json()
        self.assertEqual(inf7["grades"], [7, 8])
        self.assertEqual(
            [(row["task_list_id"], row["vpr_class"], row["task_count"]) for row in inf7["task_numbers"]],
            [(self.inf7.id, 7, 1)],
        )

        math = self.client.get("/api/vpr/math/task-bank-filters/?grade=10&advanced=0")
        self.assertEqual(math.status_code, 200)
        math_body = math.json()
        self.assertEqual(math_body["grades"], [7, 10])
        self.assertEqual(
            [(row["task_list_id"], row["task_number"], row["vpr_class"], row["task_count"], row["task_title"])
             for row in math_body["task_numbers"]],
            [
                (self.math10.id, 1, 10, 1, "ВПР 10 №1"),
                (self.math10_empty.id, 2, 10, 0, "ВПР 10 №2"),
            ],
        )

        tasks = self.client.get("/api/vpr/inf/tasks/?grade=10&advanced=0")
        self.assertEqual(tasks.status_code, 200)
        self.assertIn("no-store", tasks["Cache-Control"])
        payload = tasks.json()
        self.assertEqual(payload["tasks"], [])
        self.assertEqual(payload["grades"], [7, 8])

        open_page = self.client.get("/api/vpr/inf/tasks/?advanced=0").json()
        shown_ids = [item["id"] for item in open_page["tasks"]]
        self.assertIn(self.inf7.id, shown_ids)
        self.assertIn(self.inf8.id, shown_ids)
        self.assertFalse(any(item in shown_ids for item in (self.empty_inf[0].id, self.empty_inf[1].id)))

        subtopics = self.client.get("/api/vpr/inf/subtopics/?grade=10&advanced=0")
        self.assertEqual(subtopics.status_code, 200)
        self.assertEqual(subtopics.json()["subtopics_by_task"], [])

        for row in self.empty_inf:
            row.refresh_from_db()
            self.assertIsNone(row.vpr_class)
        self.assertEqual(
            list(TaskList.objects.filter(subject=self.inf, vpr_class__isnull=True).values_list("id", flat=True)),
            [row.id for row in self.empty_inf],
        )

    def test_grade_appears_once_it_has_an_active_public_task(self):
        before = self.client.get("/api/vpr/inf/task-bank-filters/?grade=10&advanced=0").json()
        self.assertNotIn(10, before["grades"])
        self.assertEqual(before["task_numbers"], [])

        _task(self.empty_inf[0], active=False, grade=10)
        teacher = User.objects.create_user("inf-teacher", password="x")
        _task(
            self.empty_inf[0],
            grade=10,
            scope="teacher",
            owner=teacher,
            local_number=1,
        )
        still = self.client.get("/api/vpr/inf/task-bank-filters/?grade=10&advanced=0").json()
        self.assertEqual(still["grades"], [7, 8])
        self.assertEqual(still["task_numbers"], [])

        _task(self.empty_inf[0], grade=10)
        shown = self.client.get("/api/vpr/inf/task-bank-filters/?grade=10&advanced=0").json()
        self.assertEqual(shown["grades"], [7, 8, 10])
        self.assertEqual(
            [(row["task_list_id"], row["task_count"]) for row in shown["task_numbers"]],
            [(self.empty_inf[0].id, 1)],
        )
        self.assertNotIn(self.empty_inf[1].id, [row["task_list_id"] for row in shown["task_numbers"]])
        self.empty_inf[0].refresh_from_db()
        self.empty_inf[1].refresh_from_db()
        self.assertIsNone(self.empty_inf[0].vpr_class)
        self.assertIsNone(self.empty_inf[1].vpr_class)

        math = self.client.get("/api/vpr/math/task-bank-filters/?grade=10&advanced=0").json()
        self.assertIn(10, math["grades"])
        self.assertEqual(math["task_numbers"][0]["task_list_id"], self.math10.id)
        self.assertEqual(math["task_numbers"][0]["task_count"], 1)
