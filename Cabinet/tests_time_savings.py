"""r70: единый расчёт «сэкономленного времени» (кабинет + /pricing)."""

from datetime import datetime, time, timedelta

from django.contrib.auth.models import User
from django.test import SimpleTestCase, TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from Cabinet import time_savings
from Cabinet.availability_models import TeacherBooking
from Cabinet.choices import HomeworkStatus, HomeworkTaskType
from Cabinet.dashboard_engagement import build_engagement
from Cabinet.models import (
    EventReminderLog,
    Homework,
    HomeworkSubmission,
    HomeworkTask,
    Interactive,
    InteractiveAssignment,
    Profile,
    ScheduleEvent,
    Student,
)
from Cabinet.r50_tariffs import saved_time
from Generator.models import Level, Subject, Variant


def _at(day, hour=12):
    return timezone.make_aware(datetime(day.year, day.month, day.day, hour, 0))


def _teacher(username):
    user = User.objects.create_user(username=username, password="pass")
    user.profile.role = Profile.Role.TEACHER
    user.profile.save(update_fields=["role"])
    return user


class FormatAndFootnoteTests(SimpleTestCase):
    def test_rounding_is_always_down_and_small_values_are_hidden(self):
        self.assertEqual(time_savings.format_saved(0), "")
        self.assertEqual(time_savings.format_saved(9 * 60 + 59), "")
        self.assertEqual(time_savings.format_saved(10 * 60), "≈ 10 мин")
        self.assertEqual(time_savings.format_saved(49 * 60 + 59), "≈ 40 мин")
        self.assertEqual(time_savings.format_saved(59 * 60 + 59), "≈ 50 мин")
        self.assertEqual(time_savings.format_saved(60 * 60), "≈ 1 ч")
        self.assertEqual(time_savings.format_saved(16 * 3600 + 59 * 60), "≈ 16 ч")

    def test_rates_follow_the_agreed_method(self):
        rates = {c.key: c.seconds for c in time_savings.CATEGORIES}
        self.assertEqual(
            rates,
            {"variant": 600, "auto_checked_answer": 30, "reminder": 30, "booking": 120},
        )
        # Не логируются надёжно — не показываем и не оцениваем.
        for key in ("interactive", "worksheet", "ready_lesson", "journal_auto"):
            self.assertNotIn(key, rates)
            self.assertIn(key, time_savings.HIDDEN_CATEGORIES)

    def test_footnote_lists_only_shown_categories(self):
        note = time_savings.FOOTNOTE
        self.assertTrue(note.startswith("Это оценка, а не замер. Мы учитываем только то, что платформа сделала за Вас автоматически: "))
        self.assertIn("собранные варианты, автопроверку ответов, напоминания и бронирования.", note)
        self.assertIn(
            "вариант — 10 мин, проверка одного ответа — 30 сек, "
            "напоминание — 30 сек, бронирование — 2 мин.",
            note,
        )
        self.assertTrue(note.endswith("Вашу собственную работу в кабинете не считаем. Реальная экономия у каждого своя."))
        for hidden in ("интерактив", "рабочий лист", "готовый урок", "запись журнала", "листы", "журнал"):
            self.assertNotIn(hidden, note)
        self.assertNotIn("среднем времени", note)
        self.assertNotIn("По нашей оценке", note)

    def test_summary_parts_show_formula(self):
        summary = time_savings.summarize({"variant": 3, "auto_checked_answer": 5})
        self.assertEqual(summary["seconds"], 3 * 600 + 5 * 30)
        self.assertEqual(summary["label"], "≈ 30 мин")
        parts = {p["key"]: p for p in summary["parts"]}
        self.assertEqual(parts["variant"]["formula"], "3 × 10 мин")
        self.assertEqual(parts["variant"]["value"], "30 мин")
        self.assertEqual(parts["auto_checked_answer"]["formula"], "5 × 30 сек")
        self.assertEqual(parts["auto_checked_answer"]["value"], "2 мин")
        hidden = time_savings.summarize({"auto_checked_answer": 19})
        self.assertFalse(hidden["visible"])
        self.assertEqual(hidden["parts"], [])


class TimeSavingsDataTests(TestCase):
    def setUp(self):
        self.teacher = _teacher("ts_teacher")
        self.student = Student.objects.create(teacher=self.teacher, first_name="Аня", status="active")
        self.subject = Subject.objects.create(subject_short="inf", subject_name="Информатика")
        self.level = Level.objects.create(level="ege", level_rus="ЕГЭ")
        self.now = _at(datetime(2026, 10, 17).date(), 15)
        self.today = self.now.date()
        self.this_month = datetime(2026, 10, 5).date()
        self.last_month = datetime(2026, 9, 10).date()

    def _variant(self, **kwargs):
        return Variant.objects.create(var_subject=self.subject, level=self.level, owner_teacher=self.teacher, **kwargs)

    def _assign_variant(self, variant, day, status=HomeworkStatus.ASSIGNED, student=True):
        homework = Homework.objects.create(
            teacher=self.teacher,
            student=self.student if student else None,
            title=f"Вариант {variant.pk}",
            status=status,
        )
        Homework.objects.filter(pk=homework.pk).update(created_at=_at(day))
        HomeworkTask.objects.create(
            homework=homework,
            task_type=HomeworkTaskType.GENERATED_TASK,
            title="Вариант",
            description=f"https://itflux.ru/ege/inf/variant/{variant.pk}",
        )
        return homework

    def test_real_variant_row_counts_once_and_only_when_assigned(self):
        assigned = self._variant()
        self._variant()  # сгенерирован, но не выдан — 0
        draft_only = self._variant()
        self._assign_variant(assigned, self.last_month)
        self._assign_variant(assigned, self.this_month)  # повтор того же варианта — 0
        self._assign_variant(draft_only, self.this_month, status=HomeworkStatus.DRAFT)
        HomeworkTask.objects.create(
            homework=Homework.objects.create(teacher=self.teacher, student=self.student, title="битая ссылка"),
            task_type=HomeworkTaskType.GENERATED_TASK,
            title="Удалённый вариант",
            description="/ege/inf/variant/999999",
        )

        units = time_savings.collect_units(self.teacher)
        self.assertEqual(units["variant"], [(self.last_month, 1)])
        month = time_savings.count_units(units, start=self.today.replace(day=1))
        self.assertEqual(month["variant"], 0)  # первая выдача была в сентябре
        self.assertEqual(time_savings.count_units(units)["variant"], 1)

    def test_engagement_board_counts_variants_with_real_rows(self):
        """Регресс: раньше импорт Generator.Generator.models падал, и варианты всегда были 0."""
        for _ in range(2):
            self._assign_variant(self._variant(), self.this_month)
        payload = build_engagement(self.teacher, now=self.now)
        time_block = payload["board"]["time"]
        self.assertEqual(time_block["value"], "≈ 20 мин")
        self.assertEqual(time_block["scope"], "сэкономлено в октябре")
        parts = {p["key"]: p for p in time_block["parts"]}
        self.assertEqual(parts["variant"]["formula"], "2 × 10 мин")
        self.assertEqual(time_block["note"], time_savings.FOOTNOTE)

    def test_auto_checked_answers_without_flat_bonus(self):
        homework = Homework.objects.create(teacher=self.teacher, student=self.student, title="ДЗ", status=HomeworkStatus.ASSIGNED)
        HomeworkSubmission.objects.create(
            homework=homework,
            student=self.student,
            submitted_at=_at(self.this_month),
            status="checked",
            result_payload={"checked": {str(i): i % 2 == 0 for i in range(30)}},
        )
        manual = Homework.objects.create(teacher=self.teacher, student=self.student, title="Сочинение", status=HomeworkStatus.ASSIGNED)
        HomeworkSubmission.objects.create(
            homework=manual,
            student=self.student,
            submitted_at=_at(self.this_month),
            status="checked",
            result_payload={"checked_count": 12},  # ручная проверка — 0
        )
        counts = time_savings.count_units(time_savings.collect_units(self.teacher))
        self.assertEqual(counts["auto_checked_answer"], 30)
        self.assertEqual(time_savings.summarize(counts)["label"], "≈ 10 мин")

    def test_interactive_not_counted_reminder_booking(self):
        interactive = Interactive.objects.create(teacher=self.teacher, title="Квиз", interactive_type="quiz")
        InteractiveAssignment.objects.create(teacher=self.teacher, interactive=interactive, student=self.student)
        InteractiveAssignment.objects.create(teacher=self.teacher, interactive=interactive, student=self.student)
        event = ScheduleEvent.objects.create(
            owner=self.teacher,
            title="Урок",
            starts_at=self.now - timedelta(days=1),
            ends_at=self.now - timedelta(days=1) + timedelta(hours=1),
            event_type=ScheduleEvent.EventType.INDIVIDUAL_LESSON,
        )
        student_user = User.objects.create_user(username="ts_student", password="pass")
        EventReminderLog.objects.create(event=event, recipient=student_user, reminder_minutes=1440)
        EventReminderLog.objects.create(event=event, recipient=student_user, reminder_minutes=60)  # та же пара — 0
        EventReminderLog.objects.create(event=event, recipient=self.teacher, reminder_minutes=60)  # себе — 0
        booking_kwargs = dict(
            teacher=self.teacher, student=self.student, weekday=1,
            start_time=time(10, 0), end_time=time(11, 0), first_date=self.today,
        )
        TeacherBooking.objects.create(**booking_kwargs)
        TeacherBooking.objects.create(status=TeacherBooking.Status.CANCELLED, **booking_kwargs)

        counts = time_savings.count_units(time_savings.collect_units(self.teacher))
        self.assertNotIn("interactive", counts)  # r70: интерактивы не считаем совсем
        self.assertEqual(counts["reminder"], 1)
        self.assertEqual(counts["booking"], 1)

    def test_pricing_uses_the_same_function_all_time(self):
        for day in (self.last_month, self.this_month):
            self._assign_variant(self._variant(), day)
        data = saved_time(self.teacher)
        self.assertTrue(data["visible"])
        self.assertEqual(data["label"], "≈ 20 мин")
        self.assertEqual(data["scope"], "за всё время")
        self.assertEqual(data["footnote"], time_savings.FOOTNOTE)

        board = build_engagement(self.teacher, now=self.now)["board"]["time"]
        self.assertEqual(board["value"], "≈ 10 мин")  # месяц
        self.assertEqual(board["all_time"], {"label": "≈ 20 мин", "scope": "за всё время"})

        client = APIClient()
        client.force_authenticate(user=self.teacher)
        payload = client.get("/api/cabinet/r50/pricing-me/").json()
        self.assertEqual(payload["saved"]["label"], data["label"])
        self.assertEqual(payload["saved"]["footnote"], board["note"])

    def test_under_ten_minutes_hides_everything(self):
        self.assertIsNone(build_engagement(self.teacher, now=self.now)["board"]["time"])
        self.assertFalse(saved_time(self.teacher)["visible"])
        client = APIClient()
        client.force_authenticate(user=self.teacher)
        self.assertIsNone(client.get("/api/cabinet/r50/pricing-me/").json()["saved"])

    def test_guest_gets_nothing_personal(self):
        payload = APIClient().get("/api/cabinet/r50/pricing-me/").json()
        self.assertFalse(payload["authenticated"])
        self.assertNotIn("saved", payload)

    def test_excluded_test_account(self):
        self._assign_variant(self._variant(), self.this_month)
        with override_settings(TIME_SAVINGS_EXCLUDED_TEACHER_IDS=[self.teacher.pk]):
            self.assertEqual(time_savings.count_units(time_savings.collect_units(self.teacher))["variant"], 0)

    def test_previous_week_card_uses_the_same_function(self):
        # Прошлая неделя относительно 17.10.2026 (сб): 05.10–11.10.
        prev_day = datetime(2026, 10, 7).date()
        ScheduleEvent.objects.create(
            owner=self.teacher,
            title="Урок",
            starts_at=_at(prev_day, 10),
            ends_at=_at(prev_day, 11),
            event_type=ScheduleEvent.EventType.INDIVIDUAL_LESSON,
        )
        self._assign_variant(self._variant(), prev_day)
        self._assign_variant(self._variant(), prev_day)
        payload = build_engagement(self.teacher, now=self.now)
        week = next(card for card in payload["cards"] if card["kind"] == "week")
        self.assertEqual(week["lines"][-1], "≈ 20 мин сэкономлено")
