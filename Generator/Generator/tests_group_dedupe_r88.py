"""r88: api_tasks — одна карточка group на набор номеров (ЕГЭ инф. 19–21 дублировались по числу TaskGroup)."""
from django.test import TestCase

from Generator.models import Level, LinkedTaskGroup, Subject, Task, TaskGroup, TaskGroupMember, TaskList

H = {"HTTP_HOST": "itflux-academy.ru"}


class GroupDedupeR88Tests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.lv = Level.objects.create(level="ege", level_rus="ЕГЭ")
        cls.inf = Subject.objects.create(subject_short="inf", subject_name="Информатика")
        tls = {n: TaskList.objects.create(subject=cls.inf, level=cls.lv, task_number=n, task_title=f"Тема {n}",
                                          max_score=1, part=None) for n in (18, 19, 20, 21)}
        Task.objects.create(task=tls[18], task_template="<p>x</p>", is_active=True, scope="global")
        cls.group_ids = []
        for i in range(5):
            g = TaskGroup.objects.create(subject=cls.inf, level=cls.lv)
            cls.group_ids.append(g.id)
            for n in (19, 20, 21):
                t = Task.objects.create(task=tls[n], task_template=f"<p>{n}-{i}</p>", is_active=True, scope="global")
                TaskGroupMember.objects.create(task_group=g, task=t, task_number=n)

    def items(self):
        r = self.client.get("/api/ege/inf/", **H)
        self.assertEqual(r.status_code, 200)
        return r.json()["tasks"]

    def test_one_group_card_per_number_set(self):
        items = self.items()
        groups = [x for x in items if x["type"] == "group"]
        self.assertEqual(len(groups), 1)
        self.assertEqual(groups[0]["group_id"], min(self.group_ids))
        self.assertEqual(groups[0]["task_numbers"], [19, 20, 21])
        nums = [x.get("task_number") for x in items if x["type"] == "single"]
        self.assertEqual(nums, [18])

    def test_linked_group_suppresses_group_cards(self):
        LinkedTaskGroup.objects.create(subject=self.inf, level=self.lv, task_numbers=[19, 20, 21])
        items = self.items()
        self.assertEqual([x for x in items if x["type"] == "group"], [])
        self.assertEqual(len([x for x in items if x["type"] == "linked_group"]), 1)
