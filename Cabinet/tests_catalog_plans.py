from django.test import TestCase
from rest_framework.test import APIClient

from Cabinet.catalog_plans import (
    INF_EGE_PLAN,
    INF_OGE_PLAN,
    MATH_EGE_PLAN,
    MATH_OGE_PLAN,
    PHYS_OGE_PLAN,
    RUS_OGE_PLAN,
    sync_all_catalog_plans,
    sync_catalog_plan,
)
from Cabinet.catalog_plans.inf_ege import ITEMS as INF_EGE_ITEMS
from Cabinet.catalog_plans.inf_oge import ITEMS as INF_ITEMS
from Cabinet.catalog_plans.math_ege import ITEMS as MATH_EGE_ITEMS
from Cabinet.catalog_plans.math_oge import ITEMS as MATH_ITEMS
from Cabinet.catalog_plans.phys_oge import ITEMS as PHYS_ITEMS
from Cabinet.catalog_plans.rus_oge import ITEMS as RUS_ITEMS
from Cabinet.choices import PlanStatus
from Cabinet.models import LessonPlan, LessonPlanItem, Profile
from django.contrib.auth.models import User


class CatalogMathOgeSeedTests(TestCase):
    def test_spec_has_54_consecutive_lessons(self):
        self.assertEqual(len(MATH_ITEMS), 54)
        self.assertEqual([item["order"] for item in MATH_ITEMS], list(range(1, 55)))
        self.assertEqual(MATH_OGE_PLAN["subject"], "math")
        self.assertEqual(MATH_OGE_PLAN["direction"], "oge")

    def test_sync_creates_public_math_oge_plan(self):
        plan, _created = sync_catalog_plan(MATH_OGE_PLAN)
        self.assertTrue(plan.is_public)
        self.assertEqual(plan.status, PlanStatus.PUBLISHED)
        self.assertEqual(plan.title, "Математика — ОГЭ")
        self.assertEqual(plan.subject, "math")
        self.assertEqual(plan.direction, "oge")
        self.assertEqual(plan.grade, "9")
        self.assertEqual(plan.exam_type, "oge")
        self.assertEqual(plan.items.count(), 54)
        self.assertEqual(plan.lessons_count, 54)
        first = plan.items.get(order=1)
        self.assertEqual(first.topic, "Старт подготовки")
        self.assertEqual(first.subtopic, "Диагностика и структура ОГЭ")
        self.assertEqual(first.task_number, "1–25")
        last = plan.items.get(order=54)
        self.assertEqual(last.topic, "Работа над ошибками")

    def test_sync_is_idempotent(self):
        first, _ = sync_catalog_plan(MATH_OGE_PLAN)
        second, created_second = sync_catalog_plan(MATH_OGE_PLAN)
        self.assertFalse(created_second)
        self.assertEqual(first.pk, second.pk)
        self.assertEqual(LessonPlan.objects.filter(title="Математика — ОГЭ", is_public=True).count(), 1)
        self.assertEqual(LessonPlanItem.objects.filter(plan=first).count(), 54)

    def test_sync_all_and_catalog_api(self):
        teacher = User.objects.create_user(username="cat_math_t", password="pass")
        teacher.profile.role = Profile.Role.TEACHER
        teacher.profile.save(update_fields=["role"])
        results = sync_all_catalog_plans()
        self.assertEqual(len(results), 6)
        titles_synced = {plan.title for plan, _ in results}
        self.assertEqual(
            titles_synced,
            {
                "Математика — ОГЭ",
                "Математика — ЕГЭ (профиль)",
                "Физика — ОГЭ",
                "Информатика — ОГЭ",
                "Информатика — ЕГЭ",
                "Русский язык — ОГЭ",
            },
        )
        plan = next(item for item, _ in results if item.title == "Математика — ОГЭ")

        client = APIClient()
        client.force_login(teacher)
        catalog = client.get("/api/cabinet/lesson-plans/?catalog=true")
        self.assertEqual(catalog.status_code, 200)
        titles = [item["title"] for item in catalog.data]
        self.assertIn("Математика — ОГЭ", titles)
        self.assertIn("Физика — ОГЭ", titles)
        self.assertIn("Информатика — ОГЭ", titles)
        self.assertIn("Русский язык — ОГЭ", titles)
        self.assertIn("Математика — ЕГЭ (профиль)", titles)
        self.assertIn("Информатика — ЕГЭ", titles)
        row = next(item for item in catalog.data if item["title"] == "Математика — ОГЭ")
        self.assertTrue(row["is_public"])
        self.assertEqual(row["lessons_count"], 54)
        phys_row = next(item for item in catalog.data if item["title"] == "Физика — ОГЭ")
        self.assertTrue(phys_row["is_public"])
        self.assertEqual(phys_row["lessons_count"], 80)
        self.assertEqual(phys_row["subject"], "phys")
        inf_row = next(item for item in catalog.data if item["title"] == "Информатика — ОГЭ")
        self.assertTrue(inf_row["is_public"])
        self.assertEqual(inf_row["lessons_count"], 34)
        self.assertEqual(inf_row["subject"], "inf")
        rus_row = next(item for item in catalog.data if item["title"] == "Русский язык — ОГЭ")
        self.assertTrue(rus_row["is_public"])
        self.assertEqual(rus_row["lessons_count"], 28)
        self.assertEqual(rus_row["subject"], "rus")
        ege_row = next(item for item in catalog.data if item["title"] == "Математика — ЕГЭ (профиль)")
        self.assertTrue(ege_row["is_public"])
        self.assertEqual(ege_row["lessons_count"], 42)
        self.assertEqual(ege_row["subject"], "math")
        self.assertEqual(ege_row["direction"], "ege")
        inf_ege_row = next(item for item in catalog.data if item["title"] == "Информатика — ЕГЭ")
        self.assertTrue(inf_ege_row["is_public"])
        self.assertEqual(inf_ege_row["lessons_count"], 42)
        self.assertEqual(inf_ege_row["subject"], "inf")
        self.assertEqual(inf_ege_row["direction"], "ege")

        mine = client.get("/api/cabinet/lesson-plans/?mine=true")
        mine_ids = {item["id"] for item in mine.data}
        self.assertNotIn(plan.pk, mine_ids)

        copy = client.post(f"/api/cabinet/lesson-plans/{plan.pk}/copy/")
        self.assertEqual(copy.status_code, 201)
        self.assertFalse(copy.data["is_public"])
        self.assertEqual(copy.data["items_count"], 54)
        self.assertEqual(LessonPlan.objects.get(pk=copy.data["id"]).teacher_id, teacher.id)


class CatalogPhysOgeSeedTests(TestCase):
    def test_spec_has_80_consecutive_lessons(self):
        self.assertEqual(len(PHYS_ITEMS), 80)
        self.assertEqual([item["order"] for item in PHYS_ITEMS], list(range(1, 81)))
        self.assertEqual(PHYS_OGE_PLAN["subject"], "phys")
        self.assertEqual(PHYS_OGE_PLAN["direction"], "oge")
        self.assertEqual(PHYS_ITEMS[60]["subtopic"], "Полное выполнение №17 без подсказок")

    def test_sync_creates_public_phys_oge_plan(self):
        plan, _created = sync_catalog_plan(PHYS_OGE_PLAN)
        self.assertTrue(plan.is_public)
        self.assertEqual(plan.status, PlanStatus.PUBLISHED)
        self.assertEqual(plan.title, "Физика — ОГЭ")
        self.assertEqual(plan.subject, "phys")
        self.assertEqual(plan.grade, "9")
        self.assertEqual(plan.items.count(), 80)
        self.assertEqual(plan.lessons_count, 80)
        first = plan.items.get(order=1)
        self.assertEqual(first.topic, "Введение в ОГЭ")
        self.assertEqual(first.task_number, "1–22")
        lesson_61 = plan.items.get(order=61)
        self.assertEqual(lesson_61.topic, "Экспериментальная задача")
        last = plan.items.get(order=80)
        self.assertEqual(last.topic, "Финальная подготовка")

    def test_sync_is_idempotent(self):
        first, _ = sync_catalog_plan(PHYS_OGE_PLAN)
        second, created_second = sync_catalog_plan(PHYS_OGE_PLAN)
        self.assertFalse(created_second)
        self.assertEqual(first.pk, second.pk)
        self.assertEqual(LessonPlan.objects.filter(title="Физика — ОГЭ", is_public=True).count(), 1)
        self.assertEqual(LessonPlanItem.objects.filter(plan=first).count(), 80)


class CatalogInfOgeSeedTests(TestCase):
    def test_spec_has_34_consecutive_lessons(self):
        self.assertEqual(len(INF_ITEMS), 34)
        self.assertEqual([item["order"] for item in INF_ITEMS], list(range(1, 35)))
        self.assertEqual(INF_OGE_PLAN["subject"], "inf")
        self.assertEqual(INF_OGE_PLAN["direction"], "oge")
        self.assertEqual(INF_ITEMS[20]["task_number"], "13.1")
        self.assertEqual(INF_ITEMS[21]["task_number"], "13.2")

    def test_sync_creates_public_inf_oge_plan(self):
        plan, _created = sync_catalog_plan(INF_OGE_PLAN)
        self.assertTrue(plan.is_public)
        self.assertEqual(plan.status, PlanStatus.PUBLISHED)
        self.assertEqual(plan.title, "Информатика — ОГЭ")
        self.assertEqual(plan.subject, "inf")
        self.assertEqual(plan.grade, "9")
        self.assertEqual(plan.items.count(), 34)
        self.assertEqual(plan.lessons_count, 34)
        first = plan.items.get(order=1)
        self.assertEqual(first.topic, "Подготовка к ОГЭ")
        self.assertEqual(first.task_number, "1–16")
        robot = plan.items.get(order=28)
        self.assertEqual(robot.topic, "Исполнитель Робот")
        last = plan.items.get(order=34)
        self.assertEqual(last.topic, "Работа над ошибками")

    def test_sync_is_idempotent(self):
        first, _ = sync_catalog_plan(INF_OGE_PLAN)
        second, created_second = sync_catalog_plan(INF_OGE_PLAN)
        self.assertFalse(created_second)
        self.assertEqual(first.pk, second.pk)
        self.assertEqual(LessonPlan.objects.filter(title="Информатика — ОГЭ", is_public=True).count(), 1)
        self.assertEqual(LessonPlanItem.objects.filter(plan=first).count(), 34)


class CatalogRusOgeSeedTests(TestCase):
    def test_spec_has_28_consecutive_lessons(self):
        self.assertEqual(len(RUS_ITEMS), 28)
        self.assertEqual([item["order"] for item in RUS_ITEMS], list(range(1, 29)))
        self.assertEqual(RUS_OGE_PLAN["subject"], "rus")
        self.assertEqual(RUS_OGE_PLAN["direction"], "oge")
        self.assertEqual(RUS_ITEMS[21]["task_number"], "13.1")
        self.assertEqual(RUS_ITEMS[23]["task_number"], "13.3")

    def test_sync_creates_public_rus_oge_plan(self):
        plan, _created = sync_catalog_plan(RUS_OGE_PLAN)
        self.assertTrue(plan.is_public)
        self.assertEqual(plan.status, PlanStatus.PUBLISHED)
        self.assertEqual(plan.title, "Русский язык — ОГЭ")
        self.assertEqual(plan.subject, "rus")
        self.assertEqual(plan.grade, "9")
        self.assertEqual(plan.items.count(), 28)
        self.assertEqual(plan.lessons_count, 28)
        first = plan.items.get(order=1)
        self.assertEqual(first.topic, "Старт подготовки")
        self.assertEqual(first.task_number, "1–13")
        essay = plan.items.get(order=21)
        self.assertEqual(essay.topic, "Сочинение ОГЭ")
        last = plan.items.get(order=28)
        self.assertEqual(last.topic, "Работа над ошибками")

    def test_sync_is_idempotent(self):
        first, _ = sync_catalog_plan(RUS_OGE_PLAN)
        second, created_second = sync_catalog_plan(RUS_OGE_PLAN)
        self.assertFalse(created_second)
        self.assertEqual(first.pk, second.pk)
        self.assertEqual(LessonPlan.objects.filter(title="Русский язык — ОГЭ", is_public=True).count(), 1)
        self.assertEqual(LessonPlanItem.objects.filter(plan=first).count(), 28)


class CatalogMathEgeSeedTests(TestCase):
    def test_spec_has_42_consecutive_lessons(self):
        self.assertEqual(len(MATH_EGE_ITEMS), 42)
        self.assertEqual([item["order"] for item in MATH_EGE_ITEMS], list(range(1, 43)))
        self.assertEqual(MATH_EGE_PLAN["subject"], "math")
        self.assertEqual(MATH_EGE_PLAN["direction"], "ege")
        self.assertEqual(MATH_EGE_ITEMS[20]["task_number"], "13")
        self.assertEqual(MATH_EGE_ITEMS[37]["topic"], "Числа")

    def test_sync_creates_public_math_ege_plan(self):
        plan, _created = sync_catalog_plan(MATH_EGE_PLAN)
        self.assertTrue(plan.is_public)
        self.assertEqual(plan.status, PlanStatus.PUBLISHED)
        self.assertEqual(plan.title, "Математика — ЕГЭ (профиль)")
        self.assertEqual(plan.subject, "math")
        self.assertEqual(plan.direction, "ege")
        self.assertEqual(plan.exam_type, "ege")
        self.assertEqual(plan.grade, "10–11")
        self.assertEqual(plan.items.count(), 42)
        self.assertEqual(plan.lessons_count, 42)
        first = plan.items.get(order=1)
        self.assertEqual(first.topic, "Старт подготовки")
        self.assertEqual(first.task_number, "1–19")
        finance = plan.items.get(order=26)
        self.assertEqual(finance.topic, "Финансовая математика")
        last = plan.items.get(order=42)
        self.assertEqual(last.topic, "Работа над ошибками")

    def test_sync_is_idempotent(self):
        first, _ = sync_catalog_plan(MATH_EGE_PLAN)
        second, created_second = sync_catalog_plan(MATH_EGE_PLAN)
        self.assertFalse(created_second)
        self.assertEqual(first.pk, second.pk)
        self.assertEqual(
            LessonPlan.objects.filter(title="Математика — ЕГЭ (профиль)", is_public=True).count(),
            1,
        )
        self.assertEqual(LessonPlanItem.objects.filter(plan=first).count(), 42)


class CatalogInfEgeSeedTests(TestCase):
    def test_spec_has_42_consecutive_lessons(self):
        self.assertEqual(len(INF_EGE_ITEMS), 42)
        self.assertEqual([item["order"] for item in INF_EGE_ITEMS], list(range(1, 43)))
        self.assertEqual(INF_EGE_PLAN["subject"], "inf")
        self.assertEqual(INF_EGE_PLAN["direction"], "ege")
        self.assertEqual(INF_EGE_ITEMS[11]["task_number"], "12")
        self.assertEqual(INF_EGE_ITEMS[11]["subtopic"], "Машина Тьюринга: устройство и команды")
        self.assertEqual(INF_EGE_ITEMS[37]["topic"], "Анализ данных")

    def test_sync_creates_public_inf_ege_plan(self):
        plan, _created = sync_catalog_plan(INF_EGE_PLAN)
        self.assertTrue(plan.is_public)
        self.assertEqual(plan.status, PlanStatus.PUBLISHED)
        self.assertEqual(plan.title, "Информатика — ЕГЭ")
        self.assertEqual(plan.subject, "inf")
        self.assertEqual(plan.direction, "ege")
        self.assertEqual(plan.exam_type, "ege")
        self.assertEqual(plan.grade, "10–11")
        self.assertEqual(plan.items.count(), 42)
        self.assertEqual(plan.lessons_count, 42)
        first = plan.items.get(order=1)
        self.assertEqual(first.topic, "Подготовка к ЕГЭ")
        self.assertEqual(first.task_number, "1–27")
        turing = plan.items.get(order=12)
        self.assertEqual(turing.topic, "Алгоритмические исполнители")
        last = plan.items.get(order=42)
        self.assertEqual(last.topic, "Итоговое повторение")
        self.assertEqual(last.subtopic, "Работа над ошибками")

    def test_sync_is_idempotent(self):
        first, _ = sync_catalog_plan(INF_EGE_PLAN)
        second, created_second = sync_catalog_plan(INF_EGE_PLAN)
        self.assertFalse(created_second)
        self.assertEqual(first.pk, second.pk)
        self.assertEqual(LessonPlan.objects.filter(title="Информатика — ЕГЭ", is_public=True).count(), 1)
        self.assertEqual(LessonPlanItem.objects.filter(plan=first).count(), 42)
