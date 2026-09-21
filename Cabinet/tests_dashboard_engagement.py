"""Сводка дашборда: реальные числа, редкие карточки и пул фраз."""

from datetime import datetime, timedelta

from django.contrib.auth.models import User
from django.test import SimpleTestCase, TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from Cabinet.choices import HomeworkStatus, ReviewSourceType, ReviewStatus
from Cabinet.dashboard_engagement import (
    build_engagement,
    crossed_recently,
    auto_checked_task_count,
    format_approx_saved,
    saved_seconds,
    summary_line,
    tasks_from_payload,
    walk_streak,
)
from Cabinet.dashboard_notes import DAILY_NOTES, note_candidates
from Cabinet.journal_models import LessonJournal, StudentLessonRecord
from Cabinet.choices import MaterialType, ScheduleMaterialSource
from Cabinet.models import (
    Homework,
    HomeworkSubmission,
    Interactive,
    LessonPlan,
    LessonPlanItem,
    Material,
    Profile,
    ReviewItem,
    ScheduleEvent,
    ScheduleEventMaterial,
    Student,
)
from Cabinet.serializers import build_dashboard_payload


def _at(day, hour, minute=0):
    return timezone.make_aware(datetime(day.year, day.month, day.day, hour, minute))


def _teacher(username="pulse_teacher"):
    user = User.objects.create_user(username=username, password="pass")
    user.profile.role = Profile.Role.TEACHER
    user.profile.timezone = "Europe/Moscow"
    user.profile.save(update_fields=["role", "timezone"])
    return user


def _lesson(teacher, start, end, **kwargs):
    return ScheduleEvent.objects.create(
        owner=teacher,
        title=kwargs.pop("title", "Урок"),
        starts_at=start,
        ends_at=end,
        event_type=kwargs.pop("event_type", ScheduleEvent.EventType.INDIVIDUAL_LESSON),
        status=kwargs.pop("status", ScheduleEvent.Status.PLANNED),
        **kwargs,
    )


class EngagementMathTests(SimpleTestCase):
    def test_note_pool_is_large_and_unique(self):
        self.assertGreaterEqual(len(DAILY_NOTES), 365)
        self.assertEqual(len(DAILY_NOTES), len(set(DAILY_NOTES)))

    def test_note_is_stable_for_the_same_person_and_day(self):
        day = datetime(2026, 9, 21).date()
        self.assertEqual(note_candidates(7, day), note_candidates(7, day))
        self.assertNotEqual(note_candidates(7, day)[0]["id"], note_candidates(8, day)[0]["id"])
        self.assertNotEqual(
            note_candidates(7, day)[0]["id"],
            note_candidates(7, day + timedelta(days=1))[0]["id"],
        )

    def test_saved_time_uses_fixed_rates(self):
        seconds = saved_seconds(
            homework_submitted=5,
            task_auto_checked=120,
            ready_material_used=3,
            interactive_used=1,
            variant_generated=2,
        )
        self.assertEqual(seconds, 154 * 60)
        self.assertEqual(format_approx_saved(seconds), "≈ 2 ч 34 мин")
        self.assertEqual(format_approx_saved(0), "")
        self.assertEqual(saved_seconds(ready_lesson_used=0, homework_submitted=0), 0)
        self.assertEqual(auto_checked_task_count({"checked_count": 200}), 0)
        self.assertEqual(auto_checked_task_count({"checked": {"1": True, "2": False, "3": None}}), 2)

    def test_summary_uses_real_counts(self):
        self.assertEqual(
            summary_line(lessons=12, homeworks=6, tasks=184, materials=0),
            "12 уроков · 6 ДЗ · 184 задания",
        )

    def test_tasks_come_from_checked_answers(self):
        self.assertEqual(tasks_from_payload({"checked": {"1": True, "2": False}}), 2)
        self.assertEqual(tasks_from_payload({}), 0)
        self.assertEqual(tasks_from_payload(None), 0)

    def test_streak_skips_empty_days_and_breaks_on_a_miss(self):
        friday = datetime(2026, 9, 18).date()
        good = {friday - timedelta(days=offset) for offset in (0, 1, 2, 3, 4)}
        self.assertEqual(walk_streak(good, set(), friday), 5)
        monday = friday + timedelta(days=3)
        self.assertEqual(walk_streak(good | {monday}, set(), monday), 6)
        self.assertEqual(walk_streak(good, {friday - timedelta(days=2)}, friday), 2)

    def test_milestone_is_fresh_only_when_just_crossed(self):
        self.assertTrue(crossed_recently(100, 3, 100))
        self.assertFalse(crossed_recently(140, 5, 100))
        self.assertFalse(crossed_recently(90, 10, 100))


class EngagementDataTests(TestCase):
    def setUp(self):
        self.teacher = _teacher()
        self.student = Student.objects.create(
            teacher=self.teacher,
            first_name="Мария",
            last_name="Иванова",
            status="active",
        )
        self.now = _at(datetime(2026, 9, 18).date(), 20)
        self.today = self.now.date()

    def _ended(self, day, hour=10, **kwargs):
        return _lesson(self.teacher, _at(day, hour), _at(day, hour + 1), **kwargs)

    def test_week_stats_use_conducted_lessons_checks_and_answers(self):
        monday = self.today - timedelta(days=4)
        personal = self._ended(monday, event_type=ScheduleEvent.EventType.PERSONAL)
        lesson = self._ended(monday)
        self._ended(monday + timedelta(days=1))
        self._ended(monday + timedelta(days=2), status=ScheduleEvent.Status.CANCELLED)
        material = Material.objects.create(teacher=self.teacher, title="Карточки")
        ScheduleEventMaterial.objects.create(event=lesson, material=material)

        homework = Homework.objects.create(
            teacher=self.teacher,
            student=self.student,
            title="Дроби",
            status=HomeworkStatus.ASSIGNED,
            due_at=self.now + timedelta(days=1),
        )
        submission = HomeworkSubmission.objects.create(
            homework=homework,
            student=self.student,
            submitted_at=self.now - timedelta(days=1),
            status="checked",
            result_payload={"checked": {"1": True, "2": False, "3": True, "4": True}},
        )
        ReviewItem.objects.create(
            teacher=self.teacher,
            student=self.student,
            source_type=ReviewSourceType.HOMEWORK,
            source_id=submission.id,
            title="Дроби",
            status=ReviewStatus.CHECKED,
            checked_at=self.now - timedelta(days=1),
        )
        self.assertIsNotNone(personal.id)

        payload = build_engagement(self.teacher, now=self.now)
        stats = payload["stats"]
        self.assertEqual(stats["period"], "week")
        self.assertEqual(stats["label"], "На этой неделе")
        self.assertEqual(stats["lessons"], 2)
        self.assertEqual(stats["homeworks_checked"], 1)
        self.assertEqual(stats["tasks_solved"], 4)
        self.assertEqual(stats["materials_used"], 1)
        self.assertEqual(stats["summary"], "2 урока · 1 ДЗ · 4 задания · 1 материал")
        self.assertEqual(stats["saved_label"], "≈ 4 мин")
        parts = {part["label"]: part for part in payload["board"]["time"]["parts"]}
        self.assertEqual(parts["ДЗ"]["formula"], "1 × 2 мин")
        self.assertEqual(parts["ДЗ"]["value"], "2 мин")
        self.assertEqual(parts["Автопроверка"]["formula"], "4 × 30 сек")
        self.assertEqual(parts["Автопроверка"]["value"], "2 мин")
        self.assertNotIn("Готовые материалы", parts)
        self.assertEqual(payload["board"]["time"]["value"], "≈ 4 мин")
        self.assertEqual(payload["board"]["time"]["total"]["value"], "4 мин")
        self.assertIn("Фактическое время может отличаться", payload["board"]["time"]["note"])
        self.assertTrue(any(item["id"] == "homework_on_time" for item in payload["streaks"]))

    def test_ready_content_uses_separate_rates_and_lessons_do_not(self):
        day = self.today - timedelta(days=1)
        for hour in range(8):
            self._ended(day, hour=hour)
        own = Material.objects.create(teacher=self.teacher, title="Свой файл", is_public=False)
        bank = Material.objects.create(teacher=None, title="Карточки из банка", is_public=True)
        second = Material.objects.create(teacher=None, title="Ещё карточки", is_public=True)
        first = self._ended(day, hour=16)
        second_lesson = self._ended(day, hour=18)
        ScheduleEventMaterial.objects.create(event=first, material=own)
        ScheduleEventMaterial.objects.create(event=first, material=bank)
        ScheduleEventMaterial.objects.create(event=second_lesson, material=second)
        interactive = Interactive.objects.create(
            teacher=self.teacher,
            title="Викторина",
            interactive_type="quiz",
        )
        ScheduleEventMaterial.objects.create(event=second_lesson, interactive=interactive)

        payload = build_engagement(self.teacher, now=self.now)
        parts = {part["label"]: part for part in payload["board"]["time"]["parts"]}
        self.assertEqual(parts["Готовые материалы"]["count"], 2)
        self.assertEqual(parts["Готовые материалы"]["formula"], "2 × 12 мин")
        self.assertEqual(parts["Готовые материалы"]["value"], "24 мин")
        self.assertEqual(parts["Интерактив"]["formula"], "1 × 22 мин")
        self.assertEqual(payload["board"]["time"]["value"], "≈ 46 мин")
        self.assertEqual(payload["stats"]["lessons"], 10)

    def test_catalog_lesson_is_not_also_counted_as_its_materials(self):
        day = self.today - timedelta(days=1)
        plan = LessonPlan.objects.create(title="Каталог", is_public=True, status="published")
        item = LessonPlanItem.objects.create(plan=plan, title="Графики", order=1)
        event = self._ended(day, lesson_plan_item=item)
        bank = Material.objects.create(teacher=None, title="Теория", is_public=True)
        extra = Material.objects.create(teacher=None, title="Отдельная карточка", is_public=True)
        ScheduleEventMaterial.objects.create(
            event=event,
            material=bank,
            source=ScheduleMaterialSource.LEARNING_PLAN,
        )
        ScheduleEventMaterial.objects.create(
            event=event,
            material=extra,
            source=ScheduleMaterialSource.LESSON_MANUAL,
        )
        lesson_file = Material.objects.create(
            teacher=None,
            title="Готовый урок",
            is_public=True,
            material_type=MaterialType.LESSON,
        )
        other = self._ended(day, hour=14)
        ScheduleEventMaterial.objects.create(event=other, material=lesson_file)

        payload = build_engagement(self.teacher, now=self.now)
        parts = {part["label"]: part for part in payload["board"]["time"]["parts"]}
        self.assertEqual(parts["Готовый урок"]["count"], 2)
        self.assertEqual(parts["Готовый урок"]["formula"], "2 × 30 мин")
        self.assertEqual(parts["Готовые материалы"]["count"], 1)
        self.assertEqual(parts["Готовые материалы"]["value"], "12 мин")
        self.assertEqual(payload["board"]["time"]["total"]["value"], "1 ч 12 мин")

    def test_cancelled_day_breaks_planned_streak_not_teaching_streak(self):
        monday = self.today - timedelta(days=4)
        for offset in (0, 1, 3, 4):
            self._ended(monday + timedelta(days=offset))
        self._ended(monday + timedelta(days=2))
        self._ended(monday + timedelta(days=2), hour=12, status=ScheduleEvent.Status.CANCELLED)
        payload = build_engagement(self.teacher, now=self.now)
        labels = [item["label"] for item in payload["streaks"]]
        self.assertTrue(any("учебн" in label for label in labels))
        self.assertFalse(any("запланированные" in label for label in labels))

    def test_empty_week_falls_back_to_the_month(self):
        self._ended(datetime(2026, 9, 2).date())
        payload = build_engagement(self.teacher, now=self.now)
        self.assertEqual(payload["stats"]["period"], "month")
        self.assertEqual(payload["stats"]["lessons"], 1)
        self.assertEqual(payload["stats"]["label"], "В этом месяце")

    def test_quiet_day_offers_one_note_and_a_single_recommendation(self):
        sunday = _at(datetime(2026, 9, 20).date(), 12)
        self._ended(datetime(2026, 8, 20).date())
        for offset, hour in ((0, 10), (1, 10), (2, 10)):
            day = datetime(2026, 9, 15).date() + timedelta(days=offset)
            event = self._ended(day, hour=hour)
            journal = LessonJournal.objects.create(
                schedule_event=event,
                teacher=self.teacher,
                student=self.student,
                lesson_date=day,
                actual_topic="Вероятность",
            )
            StudentLessonRecord.objects.create(
                journal=journal,
                student=self.student,
                requires_attention=True,
            )
        payload = build_engagement(self.teacher, now=sunday)
        kinds = [card["kind"] for card in payload["cards"]]
        self.assertEqual(kinds[0], "recommendation")
        self.assertIn("Мария", payload["cards"][0]["title"])
        self.assertIn("Вероятность", payload["cards"][0]["title"])
        self.assertEqual(payload["cards"][0]["action"]["label"], "Подобрать задания")
        self.assertEqual(kinds.count("recommendation"), 1)
        self.assertIn("note", kinds)

    def test_previous_week_summary_names_the_busiest_day_or_a_topic(self):
        thursday = datetime(2026, 9, 10).date()
        monday = datetime(2026, 9, 7).date()
        busy = self._ended(thursday, hour=10)
        self._ended(thursday, hour=12)
        self._ended(monday, hour=10)
        journal = LessonJournal.objects.create(
            schedule_event=busy,
            teacher=self.teacher,
            student=self.student,
            lesson_date=thursday,
            actual_topic="Системы счисления",
        )
        StudentLessonRecord.objects.create(
            journal=journal,
            student=self.student,
            variant_result={"checked_count": 5, "correct_count": 1},
        )
        payload = build_engagement(self.teacher, now=self.now)
        week = next(card for card in payload["cards"] if card["kind"] == "week")
        self.assertEqual(week["title"], "Ваша неделя")
        self.assertTrue(any(line.startswith("3 ") for line in week["lines"]))
        self.assertIn("Системы счисления", week["fact"])

    def test_hundredth_lesson_is_a_rare_easter_egg(self):
        end = self.now - timedelta(hours=1)
        ScheduleEvent.objects.bulk_create([
            ScheduleEvent(
                owner=self.teacher,
                title=f"Урок {index}",
                starts_at=end - timedelta(minutes=40 + index),
                ends_at=end - timedelta(minutes=index),
                event_type=ScheduleEvent.EventType.INDIVIDUAL_LESSON,
                status=ScheduleEvent.Status.DONE,
            )
            for index in range(100)
        ])
        payload = build_engagement(self.teacher, now=self.now)
        self.assertEqual(payload["cards"][0]["id"], "easter-lesson-100")
        self.assertTrue(payload["cards"][0]["celebrate"])
        self.assertNotIn("ach-lessons-100", [card["id"] for card in payload["cards"]])

    def test_quiet_empty_day_has_a_note_and_no_invented_numbers(self):
        payload = build_engagement(self.teacher, now=self.now)
        self.assertTrue(payload["stats"]["empty"])
        self.assertEqual(payload["stats"]["summary"], "Пока без уроков и проверок")
        self.assertEqual(payload["stats"]["lessons"], 0)
        self.assertGreaterEqual(payload["note_pool_size"], 365)
        self.assertEqual(payload["cards"][-1]["kind"], "note")
        self.assertEqual(len(payload["board"]["week"]["metrics"]), 4)
        self.assertEqual(payload["board"]["week"]["percent"], 0)
        self.assertNotIn("quest", payload["board"])
        self.assertGreaterEqual(len(payload["cards"][-1]["candidates"]), 8)

    def test_dashboard_payload_includes_engagement(self):
        payload = build_dashboard_payload(self.teacher)
        self.assertIn("stats", payload["engagement"])
        self.assertIn("cards", payload["engagement"])

    def test_dashboard_api_returns_engagement(self):
        client = APIClient()
        client.force_authenticate(user=self.teacher)
        response = client.get("/api/cabinet/dashboard/")
        self.assertEqual(response.status_code, 200)
        self.assertIn("stats", response.json()["engagement"])
