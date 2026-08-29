from datetime import timedelta

from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone

from Cabinet.choices import NotificationChannel, ParticipantRole, ParticipantStatus, PlanItemStatus
from Cabinet.models import (
    Homework,
    Material,
    Notification,
    NotificationPreference,
    LessonPlan,
    LessonPlanEnrollment,
    LessonPlanItem,
    Profile,
    ScheduleEvent,
    ScheduleEventParticipant,
    Student,
    StudentGroup,
)
from Cabinet.notifications import NotificationService
from Cabinet.schedule_service import (
    cancel_event_with_scope,
    check_conflicts,
    create_series,
    create_single_event,
    move_event_with_scope,
)
from Cabinet.schedule_events import schedule_event_to_json
from Cabinet.schedule_series import generate_events_for_series
from Cabinet.plan_sync import PlanSyncService
from Cabinet.plan_schedule import (
    AUTO_MATERIALS_PLAN_DESCRIPTION,
    ensure_event_plan_item,
    resolve_plan_item_for_event,
)
from Cabinet.vk_notifications import VKNotificationService, vk_is_configured


class ScheduleServiceTests(TestCase):
    def setUp(self):
        self.teacher = User.objects.create_user(username="teacher1", password="pass")
        self.student_user = User.objects.create_user(username="student1", password="pass", email="s@test.ru")
        self.student = Student.objects.create(
            teacher=self.teacher,
            user=self.student_user,
            first_name="Иван",
            last_name="Тестов",
            status="active",
        )
        self.group = StudentGroup.objects.create(
            teacher=self.teacher,
            title="Группа 1",
            status="active",
        )
        self.group.students.add(self.student)
        self.starts = timezone.now().replace(hour=10, minute=0, second=0, microsecond=0) + timedelta(days=1)
        self.ends = self.starts + timedelta(minutes=45)

    def test_create_single_event_with_organizer(self):
        event = create_single_event(
            teacher=self.teacher,
            data={
                "title": "Урок 1",
                "starts_at": self.starts,
                "ends_at": self.ends,
                "event_type": "individual_lesson",
                "notify_participants": False,
            },
            student_ids=[self.student.pk],
            notify=False,
        )
        self.assertEqual(event.title, "Урок 1")
        organizer = event.participants.filter(role=ParticipantRole.ORGANIZER).first()
        self.assertIsNotNone(organizer)
        student_p = event.participants.filter(student=self.student).first()
        self.assertIsNotNone(student_p)

    def test_create_recurring_series(self):
        series, events = create_series(
            teacher=self.teacher,
            series_data={
                "title": "Серия",
                "event_type": "group_lesson",
                "timezone": "Europe/Moscow",
                "start_date": self.starts.date(),
                "start_time": self.starts.time(),
                "end_time": self.ends.time(),
                "recurrence_type": "custom_weekdays",
                "recurrence_weekdays": [1, 3],
                "recurrence_count": 4,
                "notify_participants": False,
            },
            group_id=self.group.pk,
            notify=False,
        )
        self.assertGreaterEqual(len(events), 2)
        self.assertEqual(events[0].series_id, series.pk)
        for ev in events:
            self.assertTrue(
                ev.participants.filter(role=ParticipantRole.STUDENT, student=self.student).exists()
            )

    def test_conflict_detection(self):
        create_single_event(
            teacher=self.teacher,
            data={
                "title": "Занято",
                "starts_at": self.starts,
                "ends_at": self.ends,
                "notify_participants": False,
            },
            student_ids=[self.student.pk],
            notify=False,
        )
        conflicts = check_conflicts(
            teacher=self.teacher,
            starts_at=self.starts,
            ends_at=self.ends,
            student_id=self.student.pk,
        )
        self.assertTrue(conflicts)

    def test_move_and_cancel_with_notifications(self):
        event = create_single_event(
            teacher=self.teacher,
            data={
                "title": "Перенос",
                "starts_at": self.starts,
                "ends_at": self.ends,
                "notify_participants": False,
            },
            student_ids=[self.student.pk],
            notify=False,
        )
        new_start = self.starts + timedelta(hours=2)
        new_end = self.ends + timedelta(hours=2)
        move_event_with_scope(
            event,
            starts_at=new_start,
            ends_at=new_end,
            changed_by=self.teacher,
            notify=True,
        )
        self.assertEqual(event.status, ScheduleEvent.Status.MOVED)
        self.assertTrue(
            Notification.objects.filter(
                recipient_user=self.student_user,
                channel=NotificationChannel.IN_APP,
            ).exists()
        )

        cancel_event_with_scope(event, changed_by=self.teacher, notify=True)
        event.refresh_from_db()
        self.assertEqual(event.status, ScheduleEvent.Status.CANCELLED)

    def test_cancel_series_scope(self):
        series, events = create_series(
            teacher=self.teacher,
            series_data={
                "title": "Серия отмена",
                "event_type": "group_lesson",
                "timezone": "Europe/Moscow",
                "start_date": self.starts.date(),
                "start_time": self.starts.time(),
                "end_time": self.ends.time(),
                "recurrence_type": "weekly",
                "recurrence_count": 3,
                "notify_participants": False,
            },
            group_id=self.group.pk,
            notify=False,
        )
        cancel_event_with_scope(events[0], changed_by=self.teacher, scope="series", notify=False)
        cancelled = ScheduleEvent.objects.filter(series=series, status=ScheduleEvent.Status.CANCELLED).count()
        self.assertEqual(cancelled, len(events))

    def test_cancel_series_sends_single_notification_per_recipient(self):
        student_user = User.objects.create_user(username="stu_cancel_series", password="pass")
        student = Student.objects.create(
            teacher=self.teacher,
            user=student_user,
            first_name="Monica",
            last_name="Geller",
        )
        series, events = create_series(
            teacher=self.teacher,
            series_data={
                "title": "Monica Geller",
                "event_type": "group_lesson",
                "timezone": "Europe/Moscow",
                "start_date": self.starts.date(),
                "start_time": self.starts.time(),
                "end_time": self.ends.time(),
                "recurrence_type": "weekly",
                "recurrence_count": 4,
                "notify_participants": False,
            },
            student_ids=[student.pk],
            notify=False,
        )
        self.assertGreaterEqual(len(events), 2)

        cancel_event_with_scope(events[0], changed_by=self.teacher, scope="series", notify=True)

        notes = list(
            Notification.objects.filter(
                recipient_user=student_user,
                channel=NotificationChannel.IN_APP,
                title="Занятия отменены",
            )
        )
        self.assertEqual(len(notes), 1)
        self.assertIn(str(len(events)), notes[0].message)

        teacher_notes = Notification.objects.filter(
            recipient_user=self.teacher,
            channel=NotificationChannel.IN_APP,
            title__icontains="отмен",
        ).count()
        self.assertEqual(teacher_notes, 0)

    def test_generate_events_no_duplicates(self):
        series, events = create_series(
            teacher=self.teacher,
            series_data={
                "title": "Генерация",
                "event_type": "group_lesson",
                "timezone": "Europe/Moscow",
                "start_date": self.starts.date(),
                "start_time": self.starts.time(),
                "end_time": self.ends.time(),
                "recurrence_type": "weekly",
                "recurrence_count": 5,
                "notify_participants": False,
            },
            notify=False,
        )
        before = ScheduleEvent.objects.filter(series=series).count()
        generate_events_for_series(series, self.starts.date(), self.starts.date() + timedelta(days=60))
        after = ScheduleEvent.objects.filter(series=series).count()
        self.assertEqual(before, after)

    def test_vk_not_configured_does_not_crash(self):
        event = create_single_event(
            teacher=self.teacher,
            data={
                "title": "VK test",
                "starts_at": self.starts,
                "ends_at": self.ends,
                "notify_participants": False,
            },
            student_ids=[self.student.pk],
            notify=False,
        )
        prefs, _ = NotificationPreference.objects.get_or_create(user=self.student_user)
        prefs.vk_enabled = True
        prefs.vk_user_id = "12345"
        prefs.save()
        p = event.participants.filter(student=self.student).first()
        p.vk_user_id = "12345"
        p.save()
        notes = NotificationService.notify_event_created(event)
        if not vk_is_configured():
            vk_notes = [n for n in notes if n.channel == NotificationChannel.VK]
            self.assertTrue(all(n.status in ("skipped", "failed", "pending") for n in vk_notes) or not vk_notes)

    def test_vk_formatters(self):
        event = ScheduleEvent(title="Алгебра", starts_at=self.starts, ends_at=self.ends)
        text = VKNotificationService.format_lesson_moved(event)
        self.assertIn("Алгебра", text)
        self.assertIn("перенесено", text)


class PlanScheduleMappingTests(TestCase):
    def setUp(self):
        self.teacher = User.objects.create_user(username="plan_map_teacher", password="pass")
        self.student_user = User.objects.create_user(username="plan_map_student", password="pass")
        self.student = Student.objects.create(
            teacher=self.teacher,
            user=self.student_user,
            first_name="Monica",
            last_name="Geller",
            status="active",
        )
        self.plan = LessonPlan.objects.create(
            teacher=self.teacher,
            title="ОГЭ логика",
            direction="oge",
            status="active",
        )
        self.item1 = LessonPlanItem.objects.create(
            plan=self.plan, order=1, title="Введение", topic="Логика",
        )
        self.item2 = LessonPlanItem.objects.create(
            plan=self.plan, order=2, title="Таблицы истинности", topic="Логика",
        )
        self.item3 = LessonPlanItem.objects.create(
            plan=self.plan, order=3, title="Задачи №14", topic="Задачи",
        )
        self.enrollment = LessonPlanEnrollment.objects.create(
            teacher=self.teacher,
            plan=self.plan,
            student=self.student,
            status="active",
        )
        base = timezone.now().replace(hour=15, minute=0, second=0, microsecond=0)
        self.event1 = create_single_event(
            teacher=self.teacher,
            data={
                "title": self.student.full_name,
                "starts_at": base + timedelta(days=1),
                "ends_at": base + timedelta(days=1, minutes=45),
                "event_type": "individual_lesson",
                "notify_participants": False,
            },
            student_ids=[self.student.pk],
            notify=False,
        )
        self.event2 = create_single_event(
            teacher=self.teacher,
            data={
                "title": self.student.full_name,
                "starts_at": base + timedelta(days=8),
                "ends_at": base + timedelta(days=8, minutes=45),
                "event_type": "individual_lesson",
                "notify_participants": False,
            },
            student_ids=[self.student.pk],
            notify=False,
        )

    def test_schedule_event_maps_plan_items_in_order(self):
        payload1 = schedule_event_to_json(self.event1)
        payload2 = schedule_event_to_json(self.event2)

        self.assertEqual(payload1["planItem"]["id"], self.item1.id)
        self.assertEqual(payload1["planLessonNumber"], 1)
        self.assertEqual(payload1["topic"], "Логика")

        self.assertEqual(payload2["planItem"]["id"], self.item2.id)
        self.assertEqual(payload2["planLessonNumber"], 2)
        self.assertEqual(payload2["planItem"]["title"], "Таблицы истинности")

    def test_cancel_shift_rebinds_future_lessons(self):
        """Отмена со сдвигом переносит тему на следующее занятие."""
        base = timezone.now().replace(hour=15, minute=0, second=0, microsecond=0)
        event3 = create_single_event(
            teacher=self.teacher,
            data={
                "title": self.student.full_name,
                "starts_at": base + timedelta(days=15),
                "ends_at": base + timedelta(days=15, minutes=45),
                "event_type": "individual_lesson",
                "notify_participants": False,
            },
            student_ids=[self.student.pk],
            notify=False,
        )
        self.assertEqual(event3.lesson_plan_item_id, self.item3.id)
        cancel_event_with_scope(
            self.event2,
            changed_by=self.teacher,
            notify=False,
            plan_cancel_action="shift",
        )
        event3.refresh_from_db()
        self.assertEqual(event3.lesson_plan_item_id, self.item2.id)
        self.assertEqual(event3.topic, (self.item2.topic or self.item2.title))
        next_item = PlanSyncService.get_next_plan_item(self.enrollment)
        self.assertEqual(next_item.id, self.item3.id)
        event4 = create_single_event(
            teacher=self.teacher,
            data={
                "title": self.student.full_name,
                "starts_at": base + timedelta(days=22),
                "ends_at": base + timedelta(days=22, minutes=45),
                "event_type": "individual_lesson",
                "notify_participants": False,
            },
            student_ids=[self.student.pk],
            notify=False,
        )
        self.assertEqual(event4.lesson_plan_item_id, self.item3.id)

    def test_cancel_skip_advances_plan_topic(self):
        base = timezone.now().replace(hour=15, minute=0, second=0, microsecond=0)
        event3 = create_single_event(
            teacher=self.teacher,
            data={
                "title": self.student.full_name,
                "starts_at": base + timedelta(days=15),
                "ends_at": base + timedelta(days=15, minutes=45),
                "event_type": "individual_lesson",
                "notify_participants": False,
            },
            student_ids=[self.student.pk],
            notify=False,
        )
        cancel_event_with_scope(
            self.event2,
            changed_by=self.teacher,
            notify=False,
            plan_cancel_action="skip",
        )
        self.item2.refresh_from_db()
        self.assertEqual(self.item2.status, "skipped")
        payload3 = schedule_event_to_json(event3)
        self.assertEqual(payload3["planItem"]["id"], self.item3.id)

    def test_ensure_linked_event_reuses_plan_item_for_materials(self):
        """Занятие с явной связью хранит материалы на пункте плана, а не в черновике."""
        display_item, _ = resolve_plan_item_for_event(self.event1)
        self.assertEqual(display_item.id, self.item1.id)

        ensured, _ = ensure_event_plan_item(self.event1, teacher=self.teacher)
        self.assertEqual(ensured.id, self.item1.id)

    def test_ensure_out_of_plan_materials_do_not_mutate_enrollment_plan(self):
        """Урок вне плана + материалы → отдельный черновик, слот плана не трогаем."""
        orphan = create_single_event(
            teacher=self.teacher,
            data={
                "title": self.student.full_name,
                "starts_at": timezone.now() + timedelta(days=21),
                "ends_at": timezone.now() + timedelta(days=21, minutes=45),
                "event_type": "individual_lesson",
                "notify_participants": False,
                "skip_plan": True,
            },
            student_ids=[self.student.pk],
            notify=False,
        )
        self.assertIsNone(orphan.lesson_plan_item_id)

        ensured, _ = ensure_event_plan_item(orphan, teacher=self.teacher)
        self.assertNotEqual(ensured.id, self.item1.id)
        self.assertEqual(ensured.plan.description, AUTO_MATERIALS_PLAN_DESCRIPTION)

        material = Material.objects.create(
            teacher=self.teacher,
            title="Внеплановый материал",
            material_type="lesson",
            status="ready",
        )
        ensured.materials.add(material)

        self.item1.refresh_from_db()
        self.assertFalse(self.item1.materials.filter(pk=material.pk).exists())
        self.assertTrue(ensured.materials.filter(pk=material.pk).exists())

        visible = LessonPlan.objects.filter(teacher=self.teacher).exclude(
            description=AUTO_MATERIALS_PLAN_DESCRIPTION,
        )
        self.assertFalse(visible.filter(pk=ensured.plan_id).exists())
        self.assertTrue(visible.filter(pk=self.plan.id).exists())


class LessonPlanItemMaterialsTests(TestCase):
    def setUp(self):
        self.teacher = User.objects.create_user(username="plan_teacher", password="pass")
        self.teacher.profile.role = Profile.Role.TEACHER
        self.teacher.profile.save()

        self.other_teacher = User.objects.create_user(username="plan_teacher2", password="pass")
        self.other_teacher.profile.role = Profile.Role.TEACHER
        self.other_teacher.profile.save()

        self.plan = LessonPlan.objects.create(
            teacher=self.teacher,
            title="Мой план",
            direction="oge",
            status="active",
        )
        self.public_plan = LessonPlan.objects.create(
            teacher=None,
            is_public=True,
            title="Публичный план",
            direction="oge",
            status="active",
        )
        self.item = LessonPlanItem.objects.create(
            plan=self.plan,
            order=1,
            title="Занятие 1",
        )
        self.public_item = LessonPlanItem.objects.create(
            plan=self.public_plan,
            order=1,
            title="Публичное занятие",
        )
        self.own_material = Material.objects.create(
            teacher=self.teacher,
            title="Урок из библиотеки",
            material_type="lesson",
            external_url="https://example.com/lessons/demo/view/",
            direction="oge",
        )
        self.own_file = Material.objects.create(
            teacher=self.teacher,
            title="Мой файл",
            material_type="file",
            direction="oge",
        )
        self.public_material = Material.objects.create(
            title="Платформенный материал",
            material_type="link",
            external_url="https://example.com/trainer",
            is_public=True,
        )
        self.foreign_material = Material.objects.create(
            teacher=self.other_teacher,
            title="Чужой материал",
            material_type="file",
        )

    def test_teacher_can_attach_own_and_public_materials(self):
        from rest_framework.test import APIClient

        client = APIClient()
        client.force_login(self.teacher)
        response = client.patch(
            f"/api/cabinet/lesson-plan-items/{self.item.pk}/",
            {"material_ids": [self.own_material.pk]},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.item.materials.count(), 1)

    def test_teacher_can_attach_homework_materials_and_interactives(self):
        from rest_framework.test import APIClient
        from Cabinet.models import Interactive

        interactive = Interactive.objects.create(
            teacher=self.teacher,
            title="Карточки",
            interactive_type="flashcards",
        )
        client = APIClient()
        client.force_login(self.teacher)
        response = client.patch(
            f"/api/cabinet/lesson-plan-items/{self.item.pk}/",
            {
                "homework_material_ids": [self.own_file.pk],
                "homework_interactive_ids": [interactive.pk],
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.item.homework_materials.count(), 1)
        self.assertEqual(self.item.homework_interactives.count(), 1)

    def test_teacher_can_attach_file_to_lesson_materials(self):
        from rest_framework.test import APIClient

        client = APIClient()
        client.force_login(self.teacher)
        response = client.patch(
            f"/api/cabinet/lesson-plan-items/{self.item.pk}/",
            {"material_ids": [self.own_file.pk]},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.item.materials.count(), 1)

    def test_teacher_cannot_edit_public_plan_item(self):
        from rest_framework.test import APIClient

        client = APIClient()
        client.force_login(self.teacher)
        response = client.patch(
            f"/api/cabinet/lesson-plan-items/{self.public_item.pk}/",
            {"material_ids": [self.own_material.pk]},
            format="json",
        )
        self.assertEqual(response.status_code, 403)

    def test_teacher_cannot_attach_foreign_material(self):
        from rest_framework.test import APIClient

        client = APIClient()
        client.force_login(self.teacher)
        response = client.patch(
            f"/api/cabinet/lesson-plan-items/{self.item.pk}/",
            {"material_ids": [self.foreign_material.pk]},
            format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_teacher_can_create_task_set_material(self):
        from rest_framework.test import APIClient

        client = APIClient()
        client.force_login(self.teacher)
        response = client.post(
            "/api/cabinet/materials/",
            {
                "title": "Вариант №1 · Информатика",
                "material_type": "task_set",
                "external_url": "http://127.0.0.1:8000/vpr/inf/variant/1",
                "direction": "other",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        self.assertIn("id", response.json())
        self.assertEqual(Material.objects.filter(teacher=self.teacher, material_type="task_set").count(), 1)


class LessonPlanCatalogTests(TestCase):
    def setUp(self):
        self.teacher = User.objects.create_user(username="catalog_teacher", password="pass")
        self.teacher.profile.role = Profile.Role.TEACHER
        self.teacher.profile.save()

        self.my_plan = LessonPlan.objects.create(
            teacher=self.teacher,
            title="Мой черновик",
            direction="oge",
            status="draft",
        )
        self.my_published = LessonPlan.objects.create(
            teacher=self.teacher,
            title="Мой опубликованный",
            direction="oge",
            status="published",
        )
        self.public_draft = LessonPlan.objects.create(
            teacher=None,
            is_public=True,
            title="Публичный черновик",
            direction="oge",
            status="draft",
        )
        self.public_plan = LessonPlan.objects.create(
            teacher=None,
            is_public=True,
            title="ОГЭ — готовый маршрут",
            direction="oge",
            status="published",
            lessons_count=1,
        )
        LessonPlanItem.objects.create(
            plan=self.public_plan,
            order=1,
            title="Логика",
            topic="Булева алгебра",
        )

    def test_catalog_lists_only_published_public_plans(self):
        from rest_framework.test import APIClient

        client = APIClient()
        client.force_login(self.teacher)
        response = client.get("/api/cabinet/lesson-plans/?catalog=true")
        self.assertEqual(response.status_code, 200)
        titles = [item["title"] for item in response.data]
        self.assertIn("ОГЭ — готовый маршрут", titles)
        self.assertNotIn("Публичный черновик", titles)
        self.assertNotIn("Мой черновик", titles)
        self.assertNotIn("Мой опубликованный", titles)
        for item in response.data:
            self.assertTrue(item["is_public"])
            self.assertEqual(item["status"], "published")

    def test_mine_lists_only_teacher_plans(self):
        from rest_framework.test import APIClient

        client = APIClient()
        client.force_login(self.teacher)
        response = client.get("/api/cabinet/lesson-plans/?mine=true")
        self.assertEqual(response.status_code, 200)
        titles = {item["title"] for item in response.data}
        self.assertEqual(titles, {"Мой черновик", "Мой опубликованный"})

    def test_mine_list_returns_completed_lesson_counts(self):
        from rest_framework.test import APIClient

        for order, title in enumerate(["Тема 1", "Тема 2", "Тема 3"], start=1):
            LessonPlanItem.objects.create(
                plan=self.my_plan,
                order=order,
                title=title,
                status=PlanItemStatus.COMPLETED if order <= 2 else PlanItemStatus.NOT_STARTED,
            )

        client = APIClient()
        client.force_login(self.teacher)
        response = client.get("/api/cabinet/lesson-plans/?mine=true")
        self.assertEqual(response.status_code, 200)
        row = next(item for item in response.data if item["id"] == self.my_plan.pk)
        self.assertEqual(row["items_count"], 3)
        self.assertEqual(row["completed_count"], 2)
        self.assertEqual(row["progress_percent"], 67)

    def test_completed_count_follows_lesson_dates_not_status_alone(self):
        from rest_framework.test import APIClient

        today = timezone.localdate()
        LessonPlanItem.objects.create(
            plan=self.my_plan,
            order=1,
            title="Прошедшая без статуса",
            scheduled_date=today - timedelta(days=7),
            status=PlanItemStatus.NOT_STARTED,
        )
        LessonPlanItem.objects.create(
            plan=self.my_plan,
            order=2,
            title="Будущая со статусом completed",
            scheduled_date=today + timedelta(days=7),
            status=PlanItemStatus.COMPLETED,
        )
        LessonPlanItem.objects.create(
            plan=self.my_plan,
            order=3,
            title="Без даты, completed",
            status=PlanItemStatus.COMPLETED,
        )

        client = APIClient()
        client.force_login(self.teacher)
        response = client.get("/api/cabinet/lesson-plans/?mine=true")
        self.assertEqual(response.status_code, 200)
        row = next(item for item in response.data if item["id"] == self.my_plan.pk)
        self.assertEqual(row["items_count"], 3)
        self.assertEqual(row["completed_count"], 2)
        self.assertEqual(row["progress_percent"], 67)

    def test_teacher_can_copy_public_plan(self):
        from rest_framework.test import APIClient

        client = APIClient()
        client.force_login(self.teacher)
        response = client.post(f"/api/cabinet/lesson-plans/{self.public_plan.pk}/copy/")
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["title"], "ОГЭ — готовый маршрут")
        self.assertFalse(response.data["is_public"])
        self.assertEqual(response.data["status"], "draft")
        copied = LessonPlan.objects.get(pk=response.data["id"])
        self.assertEqual(copied.teacher_id, self.teacher.id)
        self.assertEqual(copied.items.count(), 1)
        self.assertEqual(copied.items.first().title, "Логика")

    def test_teacher_can_duplicate_own_plan(self):
        from rest_framework.test import APIClient

        client = APIClient()
        client.force_login(self.teacher)
        response = client.post(f"/api/cabinet/lesson-plans/{self.my_plan.pk}/copy/")
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["title"], "Мой черновик (копия)")
        self.assertEqual(response.data["status"], "draft")
        copied = LessonPlan.objects.get(pk=response.data["id"])
        self.assertEqual(copied.teacher_id, self.teacher.id)
        self.assertNotEqual(copied.pk, self.my_plan.pk)

    def test_teacher_can_delete_own_plan(self):
        from rest_framework.test import APIClient

        client = APIClient()
        client.force_login(self.teacher)
        plan_id = self.my_plan.pk
        response = client.delete(f"/api/cabinet/lesson-plans/{plan_id}/")
        self.assertEqual(response.status_code, 204)
        self.assertFalse(LessonPlan.objects.filter(pk=plan_id).exists())

    def test_catalog_publisher_can_create_public_plan(self):
        from rest_framework.test import APIClient

        publisher = User.objects.create_user(
            username="catalog_publisher",
            email="dv_sorokina@mail.ru",
            password="pass",
        )
        publisher.profile.role = Profile.Role.TEACHER
        publisher.profile.save()

        client = APIClient()
        client.force_login(publisher)
        response = client.post(
            "/api/cabinet/lesson-plans/",
            {
                "title": "Общий шаблон",
                "direction": "oge",
                "subject": "informatics",
                "status": "draft",
                "is_public": True,
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        plan = LessonPlan.objects.get(pk=response.data["id"])
        self.assertEqual(plan.teacher_id, publisher.id)
        self.assertTrue(plan.is_public)
        self.assertEqual(plan.status, "published")

    def test_teacher_can_update_own_published_plan(self):
        from rest_framework.test import APIClient

        client = APIClient()
        client.force_login(self.teacher)
        response = client.patch(
            f"/api/cabinet/lesson-plans/{self.my_published.pk}/",
            {"title": "Обновлённый опубликованный"},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.my_published.refresh_from_db()
        self.assertEqual(self.my_published.title, "Обновлённый опубликованный")
        self.assertEqual(self.my_published.status, "published")

    def test_teacher_cannot_update_public_plan_without_publisher_rights(self):
        from rest_framework.test import APIClient

        client = APIClient()
        client.force_login(self.teacher)
        response = client.patch(
            f"/api/cabinet/lesson-plans/{self.public_plan.pk}/",
            {"title": "Попытка изменить шаблон"},
            format="json",
        )
        self.assertEqual(response.status_code, 403)

    def test_regular_teacher_cannot_create_public_plan(self):
        from rest_framework.test import APIClient

        client = APIClient()
        client.force_login(self.teacher)
        response = client.post(
            "/api/cabinet/lesson-plans/",
            {
                "title": "Чужой шаблон",
                "direction": "oge",
                "subject": "informatics",
                "is_public": True,
            },
            format="json",
        )
        self.assertEqual(response.status_code, 403)


class LessonPlanEnrollmentAttachTests(TestCase):
    def setUp(self):
        self.teacher = User.objects.create_user(username="enroll_teacher", password="pass")
        self.teacher.profile.role = Profile.Role.TEACHER
        self.teacher.profile.save()

        self.student = Student.objects.create(
            teacher=self.teacher,
            first_name="Анна",
            last_name="Тестова",
            status="active",
        )
        self.draft_plan = LessonPlan.objects.create(
            teacher=self.teacher,
            title="Черновик",
            direction="oge",
            status="draft",
        )
        self.published_plan = LessonPlan.objects.create(
            teacher=self.teacher,
            title="Опубликованный",
            direction="oge",
            status="published",
        )

    def test_cannot_enroll_draft_plan(self):
        from rest_framework.test import APIClient

        client = APIClient()
        client.force_login(self.teacher)
        response = client.post(
            f"/api/cabinet/lesson-plans/{self.draft_plan.pk}/enroll/",
            {"student": self.student.pk},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertFalse(
            LessonPlanEnrollment.objects.filter(plan=self.draft_plan, student=self.student).exists()
        )

    def test_can_enroll_published_plan(self):
        from rest_framework.test import APIClient

        client = APIClient()
        client.force_login(self.teacher)
        response = client.post(
            f"/api/cabinet/lesson-plans/{self.published_plan.pk}/enroll/",
            {"student": self.student.pk},
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        self.assertTrue(
            LessonPlanEnrollment.objects.filter(plan=self.published_plan, student=self.student).exists()
        )


class ScheduleEventUpdateApiTests(TestCase):
    def setUp(self):
        self.teacher = User.objects.create_user(username="schedule_edit_teacher", password="pass")
        self.teacher.profile.role = Profile.Role.TEACHER
        self.teacher.profile.save()
        self.starts = timezone.now().replace(hour=15, minute=0, second=0, microsecond=0) + timedelta(days=1)
        self.ends = self.starts + timedelta(minutes=45)
        self.series, self.events = create_series(
            teacher=self.teacher,
            series_data={
                "title": "Monica Geller",
                "event_type": "individual_lesson",
                "timezone": "Europe/Moscow",
                "start_date": self.starts.date(),
                "start_time": self.starts.time(),
                "end_time": self.ends.time(),
                "recurrence_type": "weekly",
                "recurrence_count": 2,
                "notify_participants": False,
            },
            notify=False,
        )
        self.event = self.events[0]

    def test_update_recurring_event_with_scope_single(self):
        from rest_framework.test import APIClient

        local_start = timezone.localtime(self.event.starts_at)
        local_end = timezone.localtime(self.event.ends_at)
        client = APIClient()
        client.force_login(self.teacher)
        response = client.patch(
            f"/api/cabinet/schedule/events/local-{self.event.pk}/",
            {
                "title": "Monica Geller",
                "starts_at": local_start.strftime("%Y-%m-%dT%H:%M:%S"),
                "ends_at": local_end.strftime("%Y-%m-%dT%H:%M:%S"),
                "telemost_url": "https://telemost.yandex.ru/j/test123",
                "scope": "single",
                "notify_participants": False,
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.event.refresh_from_db()
        self.assertEqual(self.event.telemost_url, "https://telemost.yandex.ru/j/test123")

    def test_reschedule_sends_single_moved_notification(self):
        from rest_framework.test import APIClient

        student_user = User.objects.create_user(username="stu_notify", password="pass")
        student = Student.objects.create(
            teacher=self.teacher,
            user=student_user,
            first_name="Monica",
            last_name="Geller",
        )
        ScheduleEventParticipant.objects.create(
            event=self.event,
            student=student,
            user=student_user,
            display_name=student.full_name,
            role=ParticipantRole.STUDENT,
            status=ParticipantStatus.ACCEPTED,
            notification_enabled=True,
        )
        self.event.student = student
        self.event.save(update_fields=["student"])

        new_start = self.event.starts_at + timedelta(hours=1)
        new_end = self.event.ends_at + timedelta(hours=1)
        client = APIClient()
        client.force_login(self.teacher)
        response = client.patch(
            f"/api/cabinet/schedule/events/local-{self.event.pk}/",
            {
                "title": "Monica Geller",
                "starts_at": new_start.strftime("%Y-%m-%dT%H:%M:%S"),
                "ends_at": new_end.strftime("%Y-%m-%dT%H:%M:%S"),
                "telemost_url": "https://telemost.yandex.ru/j/reschedule-once",
                "scope": "single",
                "notify_participants": True,
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        notes = list(
            Notification.objects.filter(
                recipient_user=student_user,
                channel=NotificationChannel.IN_APP,
            ).order_by("id")
        )
        self.assertEqual(len(notes), 1)
        self.assertEqual(notes[0].title, "Занятие перенесено")

    def test_series_scope_updates_link_on_all_events(self):
        from rest_framework.test import APIClient

        local_start = timezone.localtime(self.event.starts_at)
        local_end = timezone.localtime(self.event.ends_at)
        client = APIClient()
        client.force_login(self.teacher)
        response = client.patch(
            f"/api/cabinet/schedule/events/local-{self.event.pk}/",
            {
                "title": "Monica Geller",
                "starts_at": local_start.strftime("%Y-%m-%dT%H:%M:%S"),
                "ends_at": local_end.strftime("%Y-%m-%dT%H:%M:%S"),
                "telemost_url": "https://telemost.yandex.ru/j/series-all",
                "scope": "series",
                "notify_participants": False,
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        urls = set(
            ScheduleEvent.objects.filter(series=self.series)
            .exclude(status=ScheduleEvent.Status.CANCELLED)
            .values_list("telemost_url", flat=True)
        )
        self.assertEqual(urls, {"https://telemost.yandex.ru/j/series-all"})

    def test_following_scope_updates_only_current_and_future(self):
        from rest_framework.test import APIClient

        if len(self.events) < 2:
            self.skipTest("Need at least two events in series")
        second = self.events[1]
        local_start = timezone.localtime(second.starts_at)
        local_end = timezone.localtime(second.ends_at)
        client = APIClient()
        client.force_login(self.teacher)
        response = client.patch(
            f"/api/cabinet/schedule/events/local-{second.pk}/",
            {
                "title": "Monica Geller",
                "starts_at": local_start.strftime("%Y-%m-%dT%H:%M:%S"),
                "ends_at": local_end.strftime("%Y-%m-%dT%H:%M:%S"),
                "telemost_url": "https://telemost.yandex.ru/j/from-second",
                "scope": "following",
                "notify_participants": False,
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.events[0].refresh_from_db()
        second.refresh_from_db()
        self.assertNotEqual(self.events[0].telemost_url, "https://telemost.yandex.ru/j/from-second")
        self.assertEqual(second.telemost_url, "https://telemost.yandex.ru/j/from-second")

    def test_following_scope_moves_time_for_current_and_future(self):
        from rest_framework.test import APIClient

        if len(self.events) < 2:
            self.skipTest("Need at least two events in series")
        first = self.events[0]
        second = self.events[1]
        original_first_start = timezone.localtime(first.starts_at)
        original_second_start = timezone.localtime(second.starts_at)
        new_start = original_first_start + timedelta(hours=1)
        new_end = timezone.localtime(first.ends_at) + timedelta(hours=1)

        client = APIClient()
        client.force_login(self.teacher)
        response = client.patch(
            f"/api/cabinet/schedule/events/local-{first.pk}/",
            {
                "title": "Monica Geller",
                "starts_at": new_start.strftime("%Y-%m-%dT%H:%M:%S"),
                "ends_at": new_end.strftime("%Y-%m-%dT%H:%M:%S"),
                "scope": "following",
                "notify_participants": False,
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)

        first.refresh_from_db()
        second.refresh_from_db()
        self.assertEqual(
            timezone.localtime(first.starts_at).strftime("%H:%M"),
            new_start.strftime("%H:%M"),
        )
        self.assertEqual(
            timezone.localtime(second.starts_at).strftime("%H:%M"),
            (original_second_start + timedelta(hours=1)).strftime("%H:%M"),
        )
        self.series.refresh_from_db()
        self.assertEqual(self.series.start_time, new_start.time())

    def test_series_scope_moves_time_for_all_events(self):
        from rest_framework.test import APIClient

        if len(self.events) < 2:
            self.skipTest("Need at least two events in series")
        first = self.events[0]
        second = self.events[1]
        original_second_start = timezone.localtime(second.starts_at)
        new_start = timezone.localtime(first.starts_at) + timedelta(hours=1)
        new_end = timezone.localtime(first.ends_at) + timedelta(hours=1)

        client = APIClient()
        client.force_login(self.teacher)
        response = client.patch(
            f"/api/cabinet/schedule/events/local-{first.pk}/",
            {
                "title": "Monica Geller",
                "starts_at": new_start.strftime("%Y-%m-%dT%H:%M:%S"),
                "ends_at": new_end.strftime("%Y-%m-%dT%H:%M:%S"),
                "scope": "series",
                "notify_participants": False,
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)

        first.refresh_from_db()
        second.refresh_from_db()
        self.assertEqual(
            timezone.localtime(first.starts_at).strftime("%H:%M"),
            new_start.strftime("%H:%M"),
        )
        self.assertEqual(
            timezone.localtime(second.starts_at).strftime("%H:%M"),
            (original_second_start + timedelta(hours=1)).strftime("%H:%M"),
        )
        self.series.refresh_from_db()
        self.assertEqual(self.series.start_time, new_start.time())

    def test_orphan_series_scope_moves_matching_events(self):
        from rest_framework.test import APIClient

        orphan = self.events[0]
        orphan.series_id = None
        orphan.is_recurring_instance = True
        orphan.save(update_fields=["series", "is_recurring_instance"])
        second = self.events[1]
        second.series_id = None
        second.is_recurring_instance = True
        second.save(update_fields=["series", "is_recurring_instance"])

        local_start = timezone.localtime(orphan.starts_at) + timedelta(hours=1)
        local_end = timezone.localtime(orphan.ends_at) + timedelta(hours=1)
        second_original_start = timezone.localtime(second.starts_at)
        client = APIClient()
        client.force_login(self.teacher)
        response = client.patch(
            f"/api/cabinet/schedule/events/local-{orphan.pk}/",
            {
                "title": orphan.title,
                "starts_at": local_start.strftime("%Y-%m-%dT%H:%M:%S"),
                "ends_at": local_end.strftime("%Y-%m-%dT%H:%M:%S"),
                "scope": "series",
                "notify_participants": False,
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        orphan.refresh_from_db()
        second.refresh_from_db()
        self.assertEqual(
            timezone.localtime(orphan.starts_at).strftime("%H:%M"),
            local_start.strftime("%H:%M"),
        )
        self.assertEqual(
            timezone.localtime(second.starts_at).strftime("%H:%M"),
            (second_original_start + timedelta(hours=1)).strftime("%H:%M"),
        )

    def test_update_event_parses_iso_datetime_strings(self):
        event = create_single_event(
            teacher=self.teacher,
            data={
                "title": "Разовое",
                "starts_at": self.starts,
                "ends_at": self.ends,
                "notify_participants": False,
            },
            notify=False,
        )
        from Cabinet.schedule_service import update_event

        local_start = timezone.localtime(event.starts_at)
        local_end = timezone.localtime(event.ends_at)
        update_event(
            event,
            changed_by=self.teacher,
            data={
                "telemost_url": "https://telemost.yandex.ru/j/single",
                "starts_at": local_start.strftime("%Y-%m-%dT%H:%M:%S"),
                "ends_at": local_end.strftime("%Y-%m-%dT%H:%M:%S"),
                "notify_participants": False,
            },
            notify=False,
        )
        event.refresh_from_db()
        self.assertEqual(event.telemost_url, "https://telemost.yandex.ru/j/single")


class StudentReleaseTests(TestCase):
    def setUp(self):
        self.teacher = User.objects.create_user(username="release_teacher", password="pass")
        self.teacher.profile.role = Profile.Role.TEACHER
        self.teacher.profile.save()

        self.student_user = User.objects.create_user(username="release_student", password="pass")
        self.student_user.profile.role = Profile.Role.STUDENT
        self.student_user.profile.save()

        self.student = Student.objects.create(
            teacher=self.teacher,
            user=self.student_user,
            first_name="Аня",
            last_name="Ученик",
            status="active",
        )
        self.plan = LessonPlan.objects.create(
            teacher=self.teacher,
            title="ОГЭ",
            direction="oge",
            status="active",
        )
        self.plan_item = LessonPlanItem.objects.create(
            plan=self.plan,
            order=1,
            title="Логика",
            topic="Логика",
            homework_description="Решить задачи 1–3",
        )
        self.material = Material.objects.create(
            teacher=self.teacher,
            title="Презентация",
            material_type="link",
            external_url="https://example.com/slides",
            direction="oge",
        )
        self.plan_item.materials.add(self.material)
        self.enrollment = LessonPlanEnrollment.objects.create(
            teacher=self.teacher,
            plan=self.plan,
            student=self.student,
            status="active",
        )
        # Всегда в прошлом, иначе event_is_finished зависит от времени суток.
        self.starts = timezone.now() - timedelta(hours=5)
        self.ends = self.starts + timedelta(minutes=45)
        self.event = create_single_event(
            teacher=self.teacher,
            data={
                "title": self.student.full_name,
                "starts_at": self.starts,
                "ends_at": self.ends,
                "event_type": "individual_lesson",
                "notify_participants": False,
            },
            student_ids=[self.student.pk],
            notify=False,
        )

    def test_release_after_event_end_creates_lesson_and_homework(self):
        from Cabinet.models import Homework, LessonAssignment
        from Cabinet.student_release import StudentReleaseService

        released = StudentReleaseService.release_for_event(self.event)
        self.assertEqual(len(released), 1)

        assignment = LessonAssignment.objects.get(pk=released[0].pk)
        self.assertEqual(assignment.student_id, self.student.id)
        self.assertEqual(assignment.lesson.materials.count(), 1)

        homework = Homework.objects.filter(student=self.student, lesson_plan_item=self.plan_item).first()
        self.assertIsNotNone(homework)
        self.assertEqual(homework.status, "assigned")
        self.assertIsNone(homework.due_at)

    def test_homework_due_at_is_next_lesson_start(self):
        from Cabinet.models import Homework
        from Cabinet.student_release import StudentReleaseService

        next_starts = self.ends + timedelta(days=3)
        next_ends = next_starts + timedelta(minutes=45)
        create_single_event(
            teacher=self.teacher,
            data={
                "title": self.student.full_name,
                "starts_at": next_starts,
                "ends_at": next_ends,
                "event_type": "individual_lesson",
                "notify_participants": False,
            },
            student_ids=[self.student.pk],
            notify=False,
        )

        StudentReleaseService.release_for_event(self.event)
        homework = Homework.objects.filter(student=self.student, lesson_plan_item=self.plan_item).first()
        self.assertIsNotNone(homework)
        self.assertEqual(homework.due_at, next_starts)

    def test_homework_due_at_prefers_same_subject_next_lesson(self):
        from Cabinet.models import Homework, LessonPlan, LessonPlanItem
        from Cabinet.student_release import StudentReleaseService

        self.plan.subject = "informatics"
        self.plan.save(update_fields=["subject"])

        other_plan = LessonPlan.objects.create(
            teacher=self.teacher,
            title="Математика",
            direction="ege",
            subject="math",
            status="draft",
        )
        other_item = LessonPlanItem.objects.create(
            plan=other_plan,
            order=1,
            title="Алгебра",
            topic="Алгебра",
        )

        math_starts = self.ends + timedelta(days=2)
        math_event = create_single_event(
            teacher=self.teacher,
            data={
                "title": f"{self.student.full_name} math",
                "starts_at": math_starts,
                "ends_at": math_starts + timedelta(minutes=45),
                "event_type": "individual_lesson",
                "notify_participants": False,
            },
            student_ids=[self.student.pk],
            notify=False,
        )
        math_event.lesson_plan_item = other_item
        math_event.save(update_fields=["lesson_plan_item", "updated_at"])

        same_starts = self.ends + timedelta(days=5)
        same_event = create_single_event(
            teacher=self.teacher,
            data={
                "title": f"{self.student.full_name} inf",
                "starts_at": same_starts,
                "ends_at": same_starts + timedelta(minutes=45),
                "event_type": "individual_lesson",
                "notify_participants": False,
            },
            student_ids=[self.student.pk],
            notify=False,
        )
        same_event.lesson_plan_item = self.plan_item
        same_event.save(update_fields=["lesson_plan_item", "updated_at"])

        self.event.lesson_plan_item = self.plan_item
        self.event.save(update_fields=["lesson_plan_item", "updated_at"])

        StudentReleaseService.release_for_event(self.event)
        homework = Homework.objects.filter(student=self.student, lesson_plan_item=self.plan_item).first()
        self.assertIsNotNone(homework)
        self.assertEqual(homework.due_at, same_starts)

    def test_homework_options_suggests_next_lesson_due(self):
        from rest_framework.test import APIClient

        next_starts = self.ends + timedelta(days=4)
        create_single_event(
            teacher=self.teacher,
            data={
                "title": self.student.full_name,
                "starts_at": next_starts,
                "ends_at": next_starts + timedelta(minutes=45),
                "event_type": "individual_lesson",
                "notify_participants": False,
            },
            student_ids=[self.student.pk],
            notify=False,
        )

        client = APIClient()
        client.force_login(self.teacher)
        response = client.get(f"/api/cabinet/students/{self.student.pk}/homework-options/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data.get("suggested_due_at"), next_starts.isoformat())

    def test_student_api_syncs_finished_event_on_lessons_request(self):
        from rest_framework.test import APIClient
        from Cabinet.models import LessonAssignment

        client = APIClient()
        client.force_login(self.student_user)
        response = client.get("/api/cabinet/student/lessons/")
        self.assertEqual(response.status_code, 200)
        items = response.json()["items"]
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["materials_count"], 1)
        self.assertTrue(LessonAssignment.objects.filter(student=self.student).exists())

    def test_student_api_syncs_homework_on_assignments_request(self):
        from rest_framework.test import APIClient
        from Cabinet.models import Homework

        client = APIClient()
        client.force_login(self.student_user)
        response = client.get("/api/cabinet/student/assignments/")
        self.assertEqual(response.status_code, 200)
        items = response.json()["items"]
        self.assertEqual(len(items), 1)
        self.assertTrue(Homework.objects.filter(student=self.student).exists())

    def test_release_on_status_done(self):
        from Cabinet.models import LessonAssignment
        from Cabinet.student_release import StudentReleaseService

        self.event.status = ScheduleEvent.Status.DONE
        self.event.save(update_fields=["status", "updated_at"])
        StudentReleaseService.release_for_event(self.event)
        self.assertTrue(LessonAssignment.objects.filter(student=self.student).exists())

    def test_homework_options_lists_plan_items(self):
        from rest_framework.test import APIClient

        client = APIClient()
        client.force_login(self.teacher)
        response = client.get(f"/api/cabinet/students/{self.student.pk}/homework-options/")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["plan_id"], self.plan.pk)
        self.assertEqual(len(data["items"]), 1)
        self.assertEqual(data["items"][0]["title"], "Логика")
        self.assertFalse(data["items"][0]["assigned"])

    def test_teacher_can_assign_homework_manually(self):
        from rest_framework.test import APIClient
        from Cabinet.models import Homework, HomeworkSubmission, ReviewItem

        client = APIClient()
        client.force_login(self.teacher)
        response = client.post(
            f"/api/cabinet/students/{self.student.pk}/assign-homework/",
            {"plan_item_id": self.plan_item.pk},
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        homework = Homework.objects.filter(student=self.student, lesson_plan_item=self.plan_item).first()
        self.assertIsNotNone(homework)
        self.assertEqual(homework.status, "assigned")
        self.assertEqual(homework.tasks.count(), 0)
        self.assertEqual(homework.description, "Решить задачи 1–3")

        options = client.get(f"/api/cabinet/students/{self.student.pk}/homework-options/").json()
        self.assertTrue(options["items"][0]["assigned"])

        submission = HomeworkSubmission.objects.get(homework=homework, student=self.student)
        self.assertTrue(
            ReviewItem.objects.filter(source_type="homework", source_id=submission.pk).exists()
        )

    def test_teacher_can_assign_custom_homework(self):
        from rest_framework.test import APIClient
        from Cabinet.models import Homework, HomeworkSubmission, ReviewItem

        client = APIClient()
        client.force_login(self.teacher)
        response = client.post(
            f"/api/cabinet/students/{self.student.pk}/assign-homework/",
            {
                "title": "Дополнительный вариант",
                "description": "Решите задачи 1–5",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        homework = Homework.objects.filter(
            student=self.student,
            title="Дополнительный вариант",
            lesson_plan_item__isnull=True,
        ).first()
        self.assertIsNotNone(homework)
        self.assertEqual(homework.status, "assigned")
        self.assertEqual(homework.tasks.count(), 0)
        self.assertEqual(homework.description, "Решите задачи 1–5")

        submission = HomeworkSubmission.objects.get(homework=homework, student=self.student)
        self.assertIsNone(submission.submitted_at)
        review = ReviewItem.objects.filter(source_type="homework", source_id=submission.pk).first()
        self.assertIsNotNone(review)
        self.assertEqual(review.status, "pending")

        # Дополнительное ДЗ видно в списке проверки сразу после выдачи.
        review_list = client.get("/api/cabinet/review/")
        self.assertEqual(review_list.status_code, 200)
        payload = review_list.json()
        rows = payload if isinstance(payload, list) else payload.get("results", [])
        ids = [row["id"] for row in rows]
        self.assertIn(review.pk, ids)

        # У ученика пустая submission не должна выглядеть как «сдано / на проверке».
        student_client = APIClient()
        student_client.force_login(self.student_user)
        student_detail = student_client.get(
            f"/api/cabinet/student/assignments/{homework.pk}/"
        )
        self.assertEqual(student_detail.status_code, 200)
        self.assertEqual(student_detail.json()["status"], "new")


class HomeworkSubmissionApiTests(TestCase):
    def setUp(self):
        from django.conf import settings

        self._prev_secret = getattr(settings, "LESSON_SECRET", "")
        settings.LESSON_SECRET = "test-lesson-secret"

        self.teacher = User.objects.create_user(username="hw_teacher", password="pass")
        self.teacher.profile.role = Profile.Role.TEACHER
        self.teacher.profile.save()

        self.student_user = User.objects.create_user(username="hw_student", password="pass")
        self.student_user.profile.role = Profile.Role.STUDENT
        self.student_user.profile.save()

        self.student = Student.objects.create(
            teacher=self.teacher,
            user=self.student_user,
            first_name="Петя",
            last_name="Ученик",
            status="active",
        )
        self.homework = Homework.objects.create(
            teacher=self.teacher,
            student=self.student,
            title="ДЗ: Вариант",
            description="Решите вариант",
            status="assigned",
        )
        from Cabinet.models import HomeworkTask, ReviewItem

        self.HomeworkTask = HomeworkTask
        self.ReviewItem = ReviewItem
        self.HomeworkTask.objects.create(
            homework=self.homework,
            task_type="generated_task",
            title="Вариант №1",
            description="http://127.0.0.1:8000/vpr/inf/variant/1",
            order=0,
        )

    def tearDown(self):
        from django.conf import settings

        settings.LESSON_SECRET = self._prev_secret

    def test_student_assignment_detail_includes_variant_open_url(self):
        from rest_framework.test import APIClient

        client = APIClient()
        client.force_login(self.student_user)
        response = client.get(f"/api/cabinet/student/assignments/{self.homework.pk}/")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(data["has_variant"])
        self.assertIn("cabinet_assignment=", data["tasks"][0]["open_url"])
        self.assertIn("lesson_token=", data["tasks"][0]["open_url"])

    def test_student_assignment_detail_deduplicates_variant_tasks(self):
        from rest_framework.test import APIClient

        self.HomeworkTask.objects.create(
            homework=self.homework,
            task_type="external_link",
            title="Вариант №1 · дубликат",
            description="http://127.0.0.1:8000/vpr/inf/variant/1",
            order=1,
        )
        client = APIClient()
        client.force_login(self.student_user)
        response = client.get(f"/api/cabinet/student/assignments/{self.homework.pk}/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()["tasks"]), 1)

    def test_variant_open_url_uses_spa_route(self):
        from Cabinet.homework_api import build_variant_open_url, normalize_variant_spa_url

        normalized = normalize_variant_spa_url("http://127.0.0.1:8000/oge/inf/variant/69")
        self.assertEqual(normalized, "/oge/inf/variant/69")
        url = build_variant_open_url(
            base_url="http://127.0.0.1:8000/oge/inf/variant/69",
            homework_id=5,
            token="abc",
        )
        self.assertTrue(url.startswith("/oge/inf/variant/69?"))
        self.assertIn("cabinet_assignment=5", url)
        self.assertIn("homework_mode=1", url)
        self.assertIn("lesson_token=abc", url)

    def test_student_assignment_detail_includes_file_url(self):
        from rest_framework.test import APIClient

        hw = Homework.objects.create(
            teacher=self.teacher,
            student=self.student,
            title="ДЗ: Файлы",
            status="assigned",
        )
        self.HomeworkTask.objects.create(
            homework=hw,
            task_type="file",
            title="Презентация.pdf",
            description="https://example.com/demo.pdf",
            order=0,
        )

        client = APIClient()
        client.force_login(self.student_user)
        response = client.get(f"/api/cabinet/student/assignments/{hw.pk}/")
        self.assertEqual(response.status_code, 200)
        task = response.json()["tasks"][0]
        self.assertTrue(task.get("open_url"))
        self.assertTrue(task["open_url"].startswith("https://example.com/"))

    def test_homework_assignment_submit_stores_result_for_teacher(self):
        from rest_framework.test import APIClient
        from Cabinet.models import HomeworkSubmission
        from Cabinet.homework_api import issue_homework_token

        token = issue_homework_token(homework_id=self.homework.pk, student_user_id=self.student_user.pk)
        client = APIClient()
        result = {
            "by_task_id": {"1": "42"},
            "checked": {"1": True},
            "scores": {"1": 1},
        }
        response = client.post(
            f"/api/homework/assignment/{self.homework.pk}/submit/?token={token}",
            {"result": result},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        submission = HomeworkSubmission.objects.get(homework=self.homework, student=self.student)
        self.assertEqual(submission.result_payload["by_task_id"]["1"], "42")
        self.assertTrue(self.ReviewItem.objects.filter(source_type="homework", source_id=submission.pk).exists())

    def test_homework_upload_answer_stores_attachment(self):
        from django.core.files.uploadedfile import SimpleUploadedFile
        from rest_framework.test import APIClient
        from Cabinet.models import HomeworkSubmission

        client = APIClient()
        client.force_login(self.student_user)
        upload = SimpleUploadedFile("solution.png", b"png-bytes", content_type="image/png")
        response = client.post(
            f"/api/homework/assignment/{self.homework.pk}/upload-answer/",
            {"file": upload, "task_number": "16", "task_id": "42"},
            format="multipart",
        )
        self.assertEqual(response.status_code, 200, response.content)
        data = response.json()
        self.assertTrue(data.get("ok"))
        self.assertIn("url", data)
        submission = HomeworkSubmission.objects.get(homework=self.homework, student=self.student)
        attachments = submission.result_payload["attachments_by_task_id"]["42"]
        self.assertEqual(len(attachments), 1)
        self.assertEqual(attachments[0]["filename"], "solution.png")

    def test_homework_upload_answer_stores_multiple_files(self):
        from django.core.files.uploadedfile import SimpleUploadedFile
        from rest_framework.test import APIClient
        from Cabinet.models import HomeworkSubmission

        client = APIClient()
        client.force_login(self.student_user)
        file_a = SimpleUploadedFile("page1.pdf", b"pdf-one", content_type="application/pdf")
        file_b = SimpleUploadedFile("page2.pdf", b"pdf-two", content_type="application/pdf")
        response = client.post(
            f"/api/homework/assignment/{self.homework.pk}/upload-answer/",
            {"file": [file_a, file_b], "task_number": "16", "task_id": "42"},
            format="multipart",
        )
        self.assertEqual(response.status_code, 200, response.content)
        data = response.json()
        self.assertTrue(data.get("ok"))
        self.assertEqual(len(data.get("attachments") or []), 2)
        submission = HomeworkSubmission.objects.get(homework=self.homework, student=self.student)
        attachments = submission.result_payload["attachments_by_task_id"]["42"]
        self.assertEqual(len(attachments), 2)
        self.assertEqual(attachments[0]["filename"], "page1.pdf")
        self.assertEqual(attachments[1]["filename"], "page2.pdf")

    def test_homework_delete_answer_removes_attachment(self):
        from django.core.files.uploadedfile import SimpleUploadedFile
        from rest_framework.test import APIClient
        from Cabinet.models import HomeworkSubmission

        from urllib.parse import quote

        client = APIClient()
        client.force_login(self.student_user)
        upload = SimpleUploadedFile("solution.png", b"png-bytes", content_type="image/png")
        response = client.post(
            f"/api/homework/assignment/{self.homework.pk}/upload-answer/",
            {"file": upload, "task_number": "16", "task_id": "42"},
            format="multipart",
        )
        self.assertEqual(response.status_code, 200, response.content)
        file_url = response.json()["url"]
        submission = HomeworkSubmission.objects.get(homework=self.homework, student=self.student)
        self.assertIn("42", submission.result_payload["attachments_by_task_id"])

        delete_response = client.delete(
            f"/api/homework/assignment/{self.homework.pk}/upload-answer/"
            f"?url={quote(file_url, safe='')}&task_number=16&task_id=42"
        )
        self.assertEqual(delete_response.status_code, 200, delete_response.content)
        submission.refresh_from_db()
        self.assertNotIn("42", submission.result_payload.get("attachments_by_task_id", {}))

    def test_homework_delete_answer_blocked_after_submit(self):
        from django.core.files.uploadedfile import SimpleUploadedFile
        from django.utils import timezone
        from rest_framework.test import APIClient
        from Cabinet.models import HomeworkSubmission

        client = APIClient()
        client.force_login(self.student_user)
        upload = SimpleUploadedFile("solution.png", b"png-bytes", content_type="image/png")
        response = client.post(
            f"/api/homework/assignment/{self.homework.pk}/upload-answer/",
            {"file": upload, "task_number": "16", "task_id": "42"},
            format="multipart",
        )
        file_url = response.json()["url"]
        submission = HomeworkSubmission.objects.get(homework=self.homework, student=self.student)
        submission.submitted_at = timezone.now()
        submission.save(update_fields=["submitted_at"])

        delete_response = client.delete(
            f"/api/homework/assignment/{self.homework.pk}/upload-answer/"
            f"?url={file_url}&task_number=16&task_id=42"
        )
        self.assertEqual(delete_response.status_code, 403, delete_response.content)

    def test_homework_save_draft_preserves_attachments(self):
        from django.core.files.uploadedfile import SimpleUploadedFile
        from rest_framework.test import APIClient
        from Cabinet.models import HomeworkSubmission

        client = APIClient()
        client.force_login(self.student_user)
        upload = SimpleUploadedFile("solution.pdf", b"pdf", content_type="application/pdf")
        client.post(
            f"/api/homework/assignment/{self.homework.pk}/upload-answer/",
            {"file": upload, "task_number": "16", "task_id": "99"},
            format="multipart",
        )
        response = client.post(
            f"/api/homework/assignment/{self.homework.pk}/save-draft/",
            {"result": {"by_task_id": {"1": "answer"}}},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        submission = HomeworkSubmission.objects.get(homework=self.homework, student=self.student)
        self.assertEqual(submission.result_payload["by_task_id"]["1"], "answer")
        self.assertIn("99", submission.result_payload["attachments_by_task_id"])

    def test_homework_save_draft_merges_existing_answers(self):
        from rest_framework.test import APIClient
        from Cabinet.models import HomeworkSubmission

        client = APIClient()
        client.force_login(self.student_user)
        first = client.post(
            f"/api/homework/assignment/{self.homework.pk}/save-draft/",
            {
                "result": {
                    "by_task_id": {"101": "first", "102": "second"},
                    "checked": {"101": True},
                }
            },
            format="json",
        )
        self.assertEqual(first.status_code, 200, first.content)
        response = client.post(
            f"/api/homework/assignment/{self.homework.pk}/save-draft/",
            {
                "result": {
                    "by_task_id": {"103": "third"},
                    "checked": {"103": True},
                }
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        submission = HomeworkSubmission.objects.get(homework=self.homework, student=self.student)
        self.assertEqual(submission.result_payload["by_task_id"]["101"], "first")
        self.assertEqual(submission.result_payload["by_task_id"]["102"], "second")
        self.assertEqual(submission.result_payload["by_task_id"]["103"], "third")
        self.assertTrue(submission.result_payload["checked"]["101"])
        self.assertTrue(submission.result_payload["checked"]["103"])

    def test_student_can_submit_text_and_file(self):
        from django.core.files.uploadedfile import SimpleUploadedFile
        from rest_framework.test import APIClient
        from Cabinet.models import HomeworkSubmission

        hw = Homework.objects.create(
            teacher=self.teacher,
            student=self.student,
            title="ДЗ: Файл",
            status="assigned",
        )
        client = APIClient()
        client.force_login(self.student_user)
        upload = SimpleUploadedFile("answer.pdf", b"pdf-content", content_type="application/pdf")
        response = client.post(
            f"/api/cabinet/student/assignments/{hw.pk}/",
            {"answer_text": "Готово", "attached_file": upload},
            format="multipart",
        )
        self.assertEqual(response.status_code, 200, response.content)
        submission = HomeworkSubmission.objects.get(homework=hw, student=self.student)
        self.assertEqual(submission.answer_text, "Готово")
        self.assertTrue(submission.attached_file.name.endswith(".pdf"))
        self.assertTrue(response.data.get("attached_file_url") or response.data.get("attached_file_name"))
        self.assertIn("/attached-file/", response.data.get("attached_file_url") or "")

        download = client.get(f"/api/cabinet/student/assignments/{hw.pk}/attached-file/")
        self.assertEqual(download.status_code, 200, getattr(download, "content", b"")[:200])
        self.assertEqual(b"".join(download.streaming_content), b"pdf-content")

    def test_student_submit_file_survives_zero_quota(self):
        """Сдача файла не должна зависеть от квоты «Мои файлы»."""
        from django.core.files.uploadedfile import SimpleUploadedFile
        from rest_framework.test import APIClient
        from Cabinet.files_models import UserStorageQuota
        from Cabinet.models import HomeworkSubmission

        UserStorageQuota.objects.update_or_create(
            user=self.student_user,
            defaults={"quota_bytes": 0},
        )
        hw = Homework.objects.create(
            teacher=self.teacher,
            student=self.student,
            title="ДЗ: Квота 0",
            status="assigned",
        )
        client = APIClient()
        client.force_login(self.student_user)
        upload = SimpleUploadedFile("answer.pdf", b"pdf-content", content_type="application/pdf")
        response = client.post(
            f"/api/cabinet/student/assignments/{hw.pk}/",
            {"answer_text": "Готово", "attached_file": upload},
            format="multipart",
        )
        self.assertEqual(response.status_code, 200, response.content)
        submission = HomeworkSubmission.objects.get(homework=hw, student=self.student)
        self.assertTrue(bool(submission.attached_file))
        self.assertIn("cabinet/homework/", submission.attached_file.name)
        self.assertIn("/attached-file/", response.data.get("attached_file_url") or "")

        teacher_client = APIClient()
        teacher_client.force_login(self.teacher)
        teacher_dl = teacher_client.get(
            f"/api/cabinet/homework/submissions/{submission.pk}/attached-file/"
        )
        self.assertEqual(teacher_dl.status_code, 200)
        self.assertEqual(b"".join(teacher_dl.streaming_content), b"pdf-content")

    def test_student_can_append_missing_file_after_submit(self):
        from django.core.files.uploadedfile import SimpleUploadedFile
        from django.utils import timezone
        from rest_framework.test import APIClient
        from Cabinet.models import HomeworkSubmission

        hw = Homework.objects.create(
            teacher=self.teacher,
            student=self.student,
            title="ДЗ: Дослать файл",
            status="assigned",
        )
        HomeworkSubmission.objects.create(
            homework=hw,
            student=self.student,
            status="submitted",
            answer_text="Только текст",
            submitted_at=timezone.now(),
        )
        client = APIClient()
        client.force_login(self.student_user)
        upload = SimpleUploadedFile("late.pdf", b"pdf-content", content_type="application/pdf")
        response = client.post(
            f"/api/cabinet/student/assignments/{hw.pk}/",
            {"answer_text": "", "attached_file": upload},
            format="multipart",
        )
        self.assertEqual(response.status_code, 200, response.content)
        submission = HomeworkSubmission.objects.get(homework=hw, student=self.student)
        self.assertEqual(submission.answer_text, "Только текст")
        self.assertTrue(submission.attached_file.name.endswith(".pdf"))

    def test_student_can_submit_multiple_files(self):
        from django.core.files.uploadedfile import SimpleUploadedFile
        from rest_framework.test import APIClient
        from Cabinet.models import HomeworkSubmission, HomeworkSubmissionAttachment

        hw = Homework.objects.create(
            teacher=self.teacher,
            student=self.student,
            title="ДЗ: Несколько файлов",
            status="assigned",
        )
        client = APIClient()
        client.force_login(self.student_user)
        file_a = SimpleUploadedFile("page1.pdf", b"pdf-one", content_type="application/pdf")
        file_b = SimpleUploadedFile("page2.pdf", b"pdf-two", content_type="application/pdf")
        file_c = SimpleUploadedFile("photo.jpg", b"\xff\xd8\xffjpeg", content_type="image/jpeg")
        response = client.post(
            f"/api/cabinet/student/assignments/{hw.pk}/",
            {"answer_text": "Готово", "attached_file": [file_a, file_b, file_c]},
            format="multipart",
        )
        self.assertEqual(response.status_code, 200, response.content)
        submission = HomeworkSubmission.objects.get(homework=hw, student=self.student)
        extras = list(HomeworkSubmissionAttachment.objects.filter(submission=submission).order_by("id"))
        self.assertTrue(submission.attached_file.name.endswith(".pdf"))
        self.assertEqual(len(extras), 2)
        attached_files = response.data.get("attached_files") or []
        self.assertEqual(len(attached_files), 3)
        self.assertTrue(all(item.get("url") and item.get("name") for item in attached_files))

        detail = client.get(f"/api/cabinet/student/assignments/{hw.pk}/")
        self.assertEqual(detail.status_code, 200)
        self.assertEqual(len(detail.data.get("attached_files") or []), 3)

        first = client.get(f"/api/cabinet/student/assignments/{hw.pk}/attached-file/")
        self.assertEqual(first.status_code, 200)
        self.assertEqual(b"".join(first.streaming_content), b"pdf-one")

        extra_url = attached_files[1]["url"]
        extra = client.get(extra_url)
        self.assertEqual(extra.status_code, 200, extra_url)
        self.assertEqual(b"".join(extra.streaming_content), b"pdf-two")

        teacher_client = APIClient()
        teacher_client.force_login(self.teacher)
        teacher_extra = teacher_client.get(
            f"/api/cabinet/homework/submissions/{submission.pk}/attached-files/{extras[0].pk}/"
        )
        self.assertEqual(teacher_extra.status_code, 200)
        self.assertEqual(b"".join(teacher_extra.streaming_content), b"pdf-two")

    def test_student_cannot_add_more_files_after_submit_with_files(self):
        from django.core.files.uploadedfile import SimpleUploadedFile
        from rest_framework.test import APIClient
        from Cabinet.models import HomeworkSubmission

        hw = Homework.objects.create(
            teacher=self.teacher,
            student=self.student,
            title="ДЗ: Уже сдано",
            status="assigned",
        )
        client = APIClient()
        client.force_login(self.student_user)
        first = SimpleUploadedFile("one.pdf", b"pdf-one", content_type="application/pdf")
        submit = client.post(
            f"/api/cabinet/student/assignments/{hw.pk}/",
            {"answer_text": "Готово", "attached_file": first},
            format="multipart",
        )
        self.assertEqual(submit.status_code, 200, submit.content)
        extra = SimpleUploadedFile("two.pdf", b"pdf-two", content_type="application/pdf")
        again = client.post(
            f"/api/cabinet/student/assignments/{hw.pk}/",
            {"answer_text": "", "attached_file": extra},
            format="multipart",
        )
        self.assertEqual(again.status_code, 403)
        submission = HomeworkSubmission.objects.get(homework=hw, student=self.student)
        self.assertEqual(submission.file_attachments.count(), 0)

    def test_student_retry_same_text_is_idempotent(self):
        from rest_framework.test import APIClient
        from Cabinet.models import HomeworkSubmission

        hw = Homework.objects.create(
            teacher=self.teacher,
            student=self.student,
            title="ДЗ: Текст",
            status="assigned",
        )
        client = APIClient()
        client.force_login(self.student_user)
        first = client.post(
            f"/api/cabinet/student/assignments/{hw.pk}/",
            {"answer_text": "Ответ один"},
            format="multipart",
        )
        self.assertEqual(first.status_code, 200, first.content)
        second = client.post(
            f"/api/cabinet/student/assignments/{hw.pk}/",
            {"answer_text": "Ответ один"},
            format="multipart",
        )
        self.assertEqual(second.status_code, 200, second.content)
        self.assertTrue(second.json().get("already_submitted"))
        self.assertEqual(
            HomeworkSubmission.objects.filter(homework=hw, student=self.student).count(),
            1,
        )
        submission = HomeworkSubmission.objects.get(homework=hw, student=self.student)
        self.assertEqual(submission.answer_text, "Ответ один")

    def test_student_new_text_updates_same_submission(self):
        from rest_framework.test import APIClient
        from Cabinet.models import HomeworkSubmission

        hw = Homework.objects.create(
            teacher=self.teacher,
            student=self.student,
            title="ДЗ: Текст 2",
            status="assigned",
        )
        client = APIClient()
        client.force_login(self.student_user)
        first = client.post(
            f"/api/cabinet/student/assignments/{hw.pk}/",
            {"answer_text": "Старый"},
            format="multipart",
        )
        self.assertEqual(first.status_code, 200, first.content)
        second = client.post(
            f"/api/cabinet/student/assignments/{hw.pk}/",
            {"answer_text": "Новый ответ после сбоя сети"},
            format="multipart",
        )
        self.assertEqual(second.status_code, 200, second.content)
        self.assertFalse(second.json().get("already_submitted"))
        self.assertEqual(
            HomeworkSubmission.objects.filter(homework=hw, student=self.student).count(),
            1,
        )
        submission = HomeworkSubmission.objects.get(homework=hw, student=self.student)
        self.assertEqual(submission.answer_text, "Новый ответ после сбоя сети")


class ReviewApiTests(TestCase):
    def setUp(self):
        self.teacher = User.objects.create_user(username="review_teacher", password="pass")
        self.teacher.profile.role = Profile.Role.TEACHER
        self.teacher.profile.save()

        self.student_user = User.objects.create_user(username="review_student", password="pass")
        self.student_user.profile.role = Profile.Role.STUDENT
        self.student_user.profile.save()

        self.student = Student.objects.create(
            teacher=self.teacher,
            user=self.student_user,
            first_name="Маша",
            last_name="Ученик",
            status="active",
        )
        self.homework = Homework.objects.create(
            teacher=self.teacher,
            student=self.student,
            title="ДЗ: Вариант",
            status="assigned",
        )
        from Cabinet.models import HomeworkSubmission, HomeworkTask, ReviewItem

        HomeworkTask.objects.create(
            homework=self.homework,
            task_type="generated_task",
            title="Вариант №1",
            description="http://127.0.0.1:8000/oge/inf/variant/1",
            order=0,
        )
        self.submission = HomeworkSubmission.objects.create(
            homework=self.homework,
            student=self.student,
            status="submitted",
            result_payload={
                "by_task_id": {"10": "42", "20": "развернутый ответ"},
                "checked": {"10": True},
                "scores": {"20": 2},
                "attachments_by_task_id": {
                    "20": [{"url": "/media/test.pdf", "filename": "test.pdf"}]
                },
            },
        )
        self.review_item = ReviewItem.objects.create(
            teacher=self.teacher,
            student=self.student,
            source_type="homework",
            source_id=self.submission.pk,
            title=f"{self.homework.title} — {self.student.full_name}",
            status="pending",
        )

    def test_nav_counts_returns_students_and_ready_reviews(self):
        from rest_framework.test import APIClient

        self.submission.submitted_at = timezone.now()
        self.submission.save(update_fields=["submitted_at"])

        client = APIClient()
        client.force_login(self.teacher)
        response = client.get("/api/cabinet/nav-counts/")
        self.assertEqual(response.status_code, 200, response.content)
        data = response.json()
        self.assertEqual(data["students_count"], 1)
        self.assertEqual(data["reviews_count"], 1)

        self.review_item.status = "checked"
        self.review_item.save(update_fields=["status"])
        response = client.get("/api/cabinet/nav-counts/")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["reviews_count"], 0)

    def test_teacher_can_fetch_review_detail_with_homework_context(self):
        from rest_framework.test import APIClient

        client = APIClient()
        client.force_login(self.teacher)
        response = client.get(f"/api/cabinet/review/{self.review_item.pk}/")
        self.assertEqual(response.status_code, 200, response.content)
        data = response.json()
        self.assertTrue(data["homework_review"]["has_variant"])
        self.assertEqual(data["homework_review"]["variant_id"], 1)
        self.assertEqual(data["homework_submission"]["result_payload"]["by_task_id"]["10"], "42")
        self.assertGreaterEqual(data["homework_review"]["tasks_count"], 1)
        self.assertTrue(
            any(t.get("title") == "Вариант №1" for t in data["homework_review"]["tasks"])
        )

    def test_teacher_can_add_homework_task_and_student_is_notified(self):
        from rest_framework.test import APIClient
        from Cabinet.models import HomeworkTask, Notification

        client = APIClient()
        client.force_login(self.teacher)
        before = Notification.objects.filter(
            recipient_user=self.student_user,
            payload__type="homework_updated",
        ).count()
        response = client.post(
            f"/api/cabinet/homework/{self.homework.pk}/tasks/",
            {
                "text": "Решите ещё №12",
                "text_title": "Дополнительная задача",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        data = response.json()
        self.assertIn("Дополнительная задача", data.get("added_titles") or [])
        self.assertGreaterEqual(data.get("notified_students") or 0, 1)
        self.assertTrue(
            HomeworkTask.objects.filter(
                homework=self.homework, title="Дополнительная задача"
            ).exists()
        )
        after = Notification.objects.filter(
            recipient_user=self.student_user,
            channel="in_app",
            payload__type="homework_updated",
        ).count()
        self.assertEqual(after, before + 1)

    def test_cannot_add_homework_task_when_checked(self):
        from rest_framework.test import APIClient
        from Cabinet.choices import SubmissionStatus

        self.submission.status = SubmissionStatus.CHECKED
        self.submission.save(update_fields=["status"])
        self.review_item.status = "checked"
        self.review_item.save(update_fields=["status"])

        client = APIClient()
        client.force_login(self.teacher)
        response = client.post(
            f"/api/cabinet/homework/{self.homework.pk}/tasks/",
            {"text": "Поздно", "text_title": "Нельзя"},
            format="json",
        )
        self.assertEqual(response.status_code, 400, response.content)

    def test_teacher_can_check_homework_review(self):
        from rest_framework.test import APIClient
        from Cabinet.models import HomeworkSubmission

        client = APIClient()
        client.force_login(self.teacher)
        response = client.post(
            f"/api/cabinet/review/{self.review_item.pk}/check/",
            {
                "teacher_comment": "Хорошо",
                "checked": {"10": True},
                "scores": {"20": 3},
                "comments_by_task_id": {"20": "Добавьте пояснение"},
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.review_item.refresh_from_db()
        self.assertEqual(self.review_item.status, "checked")
        submission = HomeworkSubmission.objects.get(pk=self.submission.pk)
        self.assertEqual(submission.status, "checked")
        self.assertEqual(submission.teacher_comment, "Хорошо")
        self.assertEqual(submission.result_payload["scores"]["20"], 3.0)
        self.assertEqual(submission.result_payload["comments_by_task_id"]["20"], "Добавьте пояснение")

    def test_teacher_can_check_simple_homework_with_manual_stats(self):
        from rest_framework.test import APIClient
        from Cabinet.models import Homework, HomeworkSubmission, ReviewItem

        hw = Homework.objects.create(
            teacher=self.teacher,
            student=self.student,
            title="ДЗ: файл",
            status="assigned",
        )
        submission = HomeworkSubmission.objects.create(
            homework=hw,
            student=self.student,
            status="submitted",
            answer_text="Готово",
            submitted_at=timezone.now(),
        )
        review = ReviewItem.objects.create(
            teacher=self.teacher,
            student=self.student,
            source_type="homework",
            source_id=submission.pk,
            title=f"{hw.title} — {self.student.full_name}",
            status="pending",
        )
        client = APIClient()
        client.force_login(self.teacher)
        response = client.post(
            f"/api/cabinet/review/{review.pk}/check/",
            {
                "teacher_comment": "Молодец, разбери ошибки в №3",
                "manual_stats": {
                    "total": 10,
                    "correct": 7,
                    "incorrect": 2,
                    "unsolved": 1,
                },
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        submission.refresh_from_db()
        self.assertEqual(submission.status, "checked")
        self.assertEqual(submission.teacher_comment, "Молодец, разбери ошибки в №3")
        self.assertEqual(submission.result_payload["manual_stats"]["correct"], 7)
        self.assertEqual(float(submission.score), 70.0)

    def test_student_cannot_edit_checked_homework(self):
        from rest_framework.test import APIClient
        from Cabinet.models import HomeworkSubmission

        self.submission.status = "checked"
        self.submission.submitted_at = timezone.now()
        self.submission.save(update_fields=["status", "submitted_at"])

        client = APIClient()
        client.force_login(self.student_user)

        save_response = client.post(
            f"/api/homework/assignment/{self.homework.pk}/save-draft/",
            {"result": {"by_task_id": {"10": "changed"}}},
            format="json",
        )
        self.assertEqual(save_response.status_code, 403, save_response.content)

        submit_response = client.post(
            f"/api/homework/assignment/{self.homework.pk}/submit/",
            {"result": {"by_task_id": {"10": "changed"}}},
            format="json",
        )
        self.assertEqual(submit_response.status_code, 403, submit_response.content)

        submission = HomeworkSubmission.objects.get(pk=self.submission.pk)
        self.assertEqual(submission.result_payload["by_task_id"]["10"], "42")

    def test_teacher_can_return_homework_review(self):
        from rest_framework.test import APIClient
        from Cabinet.models import HomeworkSubmission

        client = APIClient()
        client.force_login(self.teacher)
        response = client.post(
            f"/api/cabinet/review/{self.review_item.pk}/return/",
            {"teacher_comment": "Нужна доработка"},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        submission = HomeworkSubmission.objects.get(pk=self.submission.pk)
        self.assertEqual(submission.status, "returned")
        self.assertEqual(submission.teacher_comment, "Нужна доработка")

    def test_teacher_can_upload_review_feedback_file(self):
        from django.core.files.uploadedfile import SimpleUploadedFile
        from rest_framework.test import APIClient
        from Cabinet.models import HomeworkSubmission

        client = APIClient()
        client.force_login(self.teacher)
        upload = SimpleUploadedFile("errors.pdf", b"%PDF-1.4 test", content_type="application/pdf")
        response = client.post(
            f"/api/cabinet/review/{self.review_item.pk}/upload-feedback/",
            {"task_number": "20", "task_id": "20", "file": upload},
            format="multipart",
        )
        self.assertEqual(response.status_code, 200, response.content)
        data = response.json()
        self.assertTrue(data.get("ok"))
        self.assertIn("url", data)

        submission = HomeworkSubmission.objects.get(pk=self.submission.pk)
        attachments = submission.result_payload["teacher_attachments_by_task_id"]["20"]
        self.assertEqual(len(attachments), 1)
        self.assertEqual(attachments[0]["filename"], "errors.pdf")

        from urllib.parse import quote

        delete_url = (
            f"/api/cabinet/review/{self.review_item.pk}/upload-feedback/"
            f"?url={quote(attachments[0]['url'])}&task_number=20&task_id=20"
        )
        delete_response = client.delete(delete_url)
        self.assertEqual(delete_response.status_code, 200, delete_response.content)
        submission.refresh_from_db()
        self.assertNotIn("20", submission.result_payload.get("teacher_attachments_by_task_id", {}))

    def test_teacher_can_upload_multiple_review_feedback_files(self):
        from django.core.files.uploadedfile import SimpleUploadedFile
        from rest_framework.test import APIClient
        from Cabinet.models import HomeworkSubmission

        client = APIClient()
        client.force_login(self.teacher)
        file_a = SimpleUploadedFile("note1.pdf", b"%PDF-1.4 a", content_type="application/pdf")
        file_b = SimpleUploadedFile("note2.pdf", b"%PDF-1.4 b", content_type="application/pdf")
        response = client.post(
            f"/api/cabinet/review/{self.review_item.pk}/upload-feedback/",
            {"task_number": "20", "task_id": "20", "file": [file_a, file_b]},
            format="multipart",
        )
        self.assertEqual(response.status_code, 200, response.content)
        data = response.json()
        self.assertEqual(len(data.get("attachments") or []), 2)
        submission = HomeworkSubmission.objects.get(pk=self.submission.pk)
        attachments = submission.result_payload["teacher_attachments_by_task_id"]["20"]
        self.assertEqual(len(attachments), 2)

    def test_teacher_can_attach_multiple_files_to_review_comment(self):
        from urllib.parse import quote

        from django.core.files.uploadedfile import SimpleUploadedFile
        from rest_framework.test import APIClient
        from Cabinet.models import HomeworkSubmission

        client = APIClient()
        client.force_login(self.teacher)
        file_a = SimpleUploadedFile("comment1.pdf", b"%PDF-1.4 a", content_type="application/pdf")
        file_b = SimpleUploadedFile("photo.png", b"\x89PNG\r\n\x1a\n", content_type="image/png")
        response = client.post(
            f"/api/cabinet/review/{self.review_item.pk}/upload-feedback/",
            {"file": [file_a, file_b]},
            format="multipart",
        )
        self.assertEqual(response.status_code, 200, response.content)
        data = response.json()
        self.assertEqual(len(data.get("attachments") or []), 2)

        submission = HomeworkSubmission.objects.get(pk=self.submission.pk)
        attachments = submission.result_payload["teacher_comment_attachments"]
        self.assertEqual(len(attachments), 2)
        self.assertEqual(
            {item["filename"] for item in attachments},
            {"comment1.pdf", "photo.png"},
        )
        self.assertNotIn("teacher_attachments_by_task_id", submission.result_payload)

        delete_url = (
            f"/api/cabinet/review/{self.review_item.pk}/upload-feedback/"
            f"?url={quote(attachments[0]['url'])}"
        )
        delete_response = client.delete(delete_url)
        self.assertEqual(delete_response.status_code, 200, delete_response.content)
        submission.refresh_from_db()
        remaining = submission.result_payload.get("teacher_comment_attachments") or []
        self.assertEqual(len(remaining), 1)
        self.assertEqual(remaining[0]["filename"], attachments[1]["filename"])


class ReferralLinkTests(TestCase):
    def setUp(self):
        from decimal import Decimal
        from Cabinet.models import ReferralLink, TariffPlan

        self.start_plan, _ = TariffPlan.objects.get_or_create(
            slug="start",
            defaults={
                "name": "Старт",
                "price_month": Decimal("0"),
                "is_free": True,
                "sort_order": 0,
            },
        )
        self.pro_plan, _ = TariffPlan.objects.get_or_create(
            slug="pro",
            defaults={
                "name": "Профи",
                "price_month": Decimal("2990"),
                "max_students": 60,
                "sort_order": 2,
            },
        )
        self.owner = User.objects.create_user("ref_owner", "owner@test.ru", "pass")
        Profile.objects.filter(user=self.owner).update(role=Profile.Role.TEACHER)
        self.referral = ReferralLink.objects.create(
            code="PARTNER3M",
            title="Партнёрская ссылка",
            owner=self.owner,
            reward_plan=self.pro_plan,
            reward_months=0,
        )

    def test_referral_preview(self):
        from django.test import Client

        client = Client()
        response = client.get("/api/cabinet/referral/PARTNER3M/preview/")
        self.assertEqual(response.status_code, 200, response.content)
        data = response.json()
        self.assertTrue(data["valid"])
        self.assertEqual(data["invitee_discount_percent"], 50)
        self.assertEqual(data["referrer_bonus_days"], 14)

    def test_teacher_registration_applies_referral_bonus(self):
        from Cabinet.models import ReferralLinkRegistration, TeacherSubscription
        from Cabinet.referral_service import ReferralService

        user = User.objects.create_user("ref_teacher", "ref_teacher@test.ru", "StrongPass123!")
        Profile.objects.filter(user=user).update(role=Profile.Role.TEACHER)
        TeacherSubscription.objects.get_or_create(
            teacher=user,
            defaults={"plan": self.start_plan, "status": "active"},
        )
        result = ReferralService.apply_on_registration(user, "PARTNER3M")
        self.assertIsNotNone(result)
        self.assertEqual(result["invitee_discount_percent"], 50)

        reg = ReferralLinkRegistration.objects.get(user=user)
        self.assertTrue(reg.invitee_discount_eligible)
        sub = TeacherSubscription.objects.get(teacher=user)
        self.assertNotEqual(sub.source, "referral")

        self.referral.refresh_from_db()
        self.assertEqual(self.referral.registrations_count, 1)

    def test_referral_code_forces_teacher_registration(self):
        from django.test import Client
        from unittest.mock import patch
        from Cabinet.models import ReferralLinkRegistration

        client = Client()
        with patch("Cabinet.views.rate_limit_check", return_value=True):
            response = client.post(
                "/api/cabinet/register/",
                data={
                    "email": "ref_student@test.ru",
                    "password": "StrongPass123!",
                    "password_confirm": "StrongPass123!",
                    "role": "student",
                    "referral_code": "PARTNER3M",
                },
                content_type="application/json",
            )
        self.assertEqual(response.status_code, 201, response.content)
        data = response.json()
        self.assertEqual(data["user"]["role"], "teacher")
        self.assertTrue(data.get("referral_applied"))
        self.assertEqual(ReferralLinkRegistration.objects.count(), 1)
        self.referral.refresh_from_db()
        self.assertEqual(self.referral.registrations_count, 1)


class SecurityHardeningTests(TestCase):
    def setUp(self):
        from decimal import Decimal
        from Cabinet.models import ReferralLink, Student, TariffPlan

        self.teacher = User.objects.create_user(username="sec_teacher", password="pass")
        self.teacher.profile.role = Profile.Role.TEACHER
        self.teacher.profile.save(update_fields=["role"])
        self.pro_plan, _ = TariffPlan.objects.get_or_create(
            slug="pro",
            defaults={"name": "Профи", "price_month": Decimal("1990"), "sort_order": 2},
        )
        ReferralLink.objects.create(code="SEC3M", reward_plan=self.pro_plan, reward_months=3)
        Student.objects.create(
            teacher=self.teacher,
            first_name="Legacy",
            last_name="Pupil",
            email="legacy@test.ru",
            user=None,
        )

    def test_student_cannot_access_roster_by_email_only(self):
        from django.test import Client
        from Cabinet.student_api import resolve_roster_students

        attacker = User.objects.create_user(
            username="attacker",
            password="StrongPass123!",
            email="legacy@test.ru",
        )
        attacker.profile.role = "student"
        attacker.profile.save(update_fields=["role"])
        self.assertEqual(resolve_roster_students(attacker).count(), 0)

    def test_invitation_links_existing_student_card(self):
        from django.test import Client
        from Cabinet.invitations import create_student_invitation

        invitation = create_student_invitation(
            self.teacher,
            email="legacy@test.ru",
            direction="ege",
        )
        client = Client()
        response = client.post(
            "/api/cabinet/register/",
            data={
                "email": "legacy@test.ru",
                "password": "StrongPass123!",
                "password_confirm": "StrongPass123!",
                "role": "student",
                "invite_token": invitation.token,
            },
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        from Cabinet.models import Student
        student = Student.objects.get(email="legacy@test.ru", teacher=self.teacher)
        self.assertIsNotNone(student.user_id)

    def test_auth_rate_limit_returns_429(self):
        from django.core.cache import cache
        from django.test import Client

        cache.clear()
        client = Client()
        for i in range(11):
            response = client.post(
                "/api/cabinet/login/",
                data={"login": f"user{i}@test.ru", "password": "wrong"},
                content_type="application/json",
            )
        self.assertEqual(response.status_code, 429)

    def test_upload_rejects_executable_extension(self):
        from django.core.files.uploadedfile import SimpleUploadedFile
        from django.test import Client
        from Cabinet.models import Homework, Student
        from Cabinet.upload_validation import UploadValidationError, validate_uploaded_file

        with self.assertRaises(UploadValidationError):
            validate_uploaded_file(
                SimpleUploadedFile("virus.exe", b"MZ", content_type="application/octet-stream")
            )

    def test_teacher_can_upload_interactive_image_file(self):
        from django.core.files.uploadedfile import SimpleUploadedFile
        from rest_framework.test import APIClient

        client = APIClient()
        client.force_login(self.teacher)
        upload = SimpleUploadedFile("card.png", b"png-bytes", content_type="image/png")

        response = client.post(
            "/api/cabinet/interactives/upload-image/",
            {"file": upload},
            format="multipart",
        )
        self.assertEqual(response.status_code, 201, response.content)
        payload = response.json()
        self.assertTrue(payload.get("ok"))
        self.assertTrue(str(payload.get("url") or "").startswith("/media/"))
        self.assertEqual(payload.get("filename"), "card.png")

    def test_interactive_image_upload_rejects_non_image_file(self):
        from django.core.files.uploadedfile import SimpleUploadedFile
        from rest_framework.test import APIClient

        client = APIClient()
        client.force_login(self.teacher)
        upload = SimpleUploadedFile("card.pdf", b"pdf-bytes", content_type="application/pdf")

        response = client.post(
            "/api/cabinet/interactives/upload-image/",
            {"file": upload},
            format="multipart",
        )
        self.assertEqual(response.status_code, 400, response.content)
        payload = response.json()
        self.assertEqual(payload.get("code"), "IMAGE_TYPE_NOT_ALLOWED")

    def test_interactive_create_ignores_unknown_appearance_slugs(self):
        from Cabinet.models import Interactive
        from rest_framework.test import APIClient

        client = APIClient()
        client.force_login(self.teacher)
        response = client.post(
            "/api/cabinet/interactives/",
            data={
                "title": "",
                "interactive_type": "flashcards",
                "direction": "other",
                "exam_type": "none",
                "status": "draft",
                "background_slug": "light-gray",
                "card_style_slug": "classic",
                "sound_pack_slug": "soft",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        interactive = Interactive.objects.filter(teacher=self.teacher).order_by("-id").first()
        self.assertIsNotNone(interactive)
        self.assertEqual(interactive.title, "Без названия")
        self.assertIsNone(interactive.background_id)
        self.assertIsNone(interactive.card_style_id)
        self.assertIsNone(interactive.sound_pack_id)

    def test_invitation_preview_masks_email(self):
        from Cabinet.invitations import create_student_invitation, invitation_preview_payload

        invitation = create_student_invitation(self.teacher, email="student@example.com")
        payload = invitation_preview_payload(invitation)
        self.assertIn("*", payload["email_hint"])
        self.assertNotEqual(payload["email_hint"], "student@example.com")

    def test_teacher_students_page_apis(self):
        from rest_framework.test import APIClient
        from Cabinet.invitations import create_student_invitation
        from Cabinet.models import Student

        create_student_invitation(
            self.teacher,
            first_name="Анна",
            last_name="Иванова",
            direction="oge",
        )
        client = APIClient()
        client.force_authenticate(user=self.teacher)

        for path in (
            "/api/cabinet/students/?status=active",
            "/api/cabinet/groups/?status=active",
            "/api/cabinet/invitations/?status=pending",
            "/api/cabinet/invitations/?status=accepted",
        ):
            response = client.get(path)
            self.assertEqual(response.status_code, 200, (path, response.content))

        students = client.get("/api/cabinet/students/?status=active").json()
        self.assertTrue(any(s.get("first_name") == "Анна" for s in students))
        self.assertEqual(
            Student.objects.filter(teacher=self.teacher, first_name="Анна", user__isnull=True).count(),
            1,
        )

    def test_teacher_can_delete_invitation_with_pre_profile(self):
        from rest_framework.test import APIClient
        from Cabinet.invitations import create_student_invitation
        from Cabinet.models import Student, StudentInvitation

        invitation = create_student_invitation(
            self.teacher,
            first_name="Петр",
            last_name="Сидоров",
        )
        pre_id = invitation.pre_student_id
        self.assertIsNotNone(pre_id)

        client = APIClient()
        client.force_authenticate(user=self.teacher)
        response = client.delete(f"/api/cabinet/invitations/{invitation.pk}/")
        self.assertEqual(response.status_code, 204, response.content)
        self.assertFalse(StudentInvitation.objects.filter(pk=invitation.pk).exists())
        self.assertFalse(Student.objects.filter(pk=pre_id).exists())


class PlatformVariantHomeworkSubmitChainTests(TestCase):
    """
    Цепочка: учитель выдаёт вариант платформы → ученик сохраняет/отправляет →
    работа появляется у выдавшего учителя.
    """

    def setUp(self):
        from django.conf import settings

        self._prev_secret = getattr(settings, "LESSON_SECRET", "")
        settings.LESSON_SECRET = "test-lesson-secret"

        self.teacher = User.objects.create_user(username="pv_teacher", password="pass")
        self.teacher.profile.role = Profile.Role.TEACHER
        self.teacher.profile.save()

        self.other_teacher = User.objects.create_user(username="pv_other", password="pass")
        self.other_teacher.profile.role = Profile.Role.TEACHER
        self.other_teacher.profile.save()

        self.platform_admin = User.objects.create_user(username="pv_admin", password="pass")
        self.platform_admin.profile.role = Profile.Role.TEACHER
        self.platform_admin.profile.save()

        self.student_user = User.objects.create_user(username="pv_student", password="pass")
        self.student_user.profile.role = Profile.Role.STUDENT
        self.student_user.profile.save()

        self.student = Student.objects.create(
            teacher=self.teacher,
            user=self.student_user,
            first_name="Аня",
            last_name="Ученица",
            status="active",
        )
        # У второго учителя тот же аккаунт ученика — другой предмет/ростер.
        self.student_other_teacher = Student.objects.create(
            teacher=self.other_teacher,
            user=self.student_user,
            first_name="Аня",
            last_name="Ученица",
            status="active",
        )

        from Cabinet.models import StudentSubject

        self.subject_inf = StudentSubject.objects.create(
            student=self.student,
            subject="inf",
            title="ЕГЭ информатика",
            direction="ege",
        )
        self.subject_math = StudentSubject.objects.create(
            student=self.student,
            subject="math",
            title="ЕГЭ математика",
            direction="ege",
        )

        self.platform_variant = Material.objects.create(
            owner=self.platform_admin,
            title="Вариант №500 платформы",
            material_type="task_set",
            external_url="https://itflux-academy.ru/ege/inf/variant/500",
            is_public=True,
            direction="ege",
        )

    def tearDown(self):
        from django.conf import settings

        settings.LESSON_SECRET = self._prev_secret

    def _assign_platform_variant(self, *, teacher=None, student=None, student_subject=None):
        from rest_framework.test import APIClient

        teacher = teacher or self.teacher
        student = student or self.student
        client = APIClient()
        client.force_login(teacher)
        payload = {
            "title": "ДЗ: вариант платформы",
            "description": "Решите вариант",
            "material_ids": [self.platform_variant.pk],
        }
        if student_subject is not None:
            payload["student_subject_id"] = student_subject.pk
        response = client.post(
            f"/api/cabinet/students/{student.pk}/assign-homework/",
            payload,
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        homework = Homework.objects.filter(
            teacher=teacher,
            student=student,
            title="ДЗ: вариант платформы",
        ).order_by("-id").first()
        self.assertIsNotNone(homework)
        return homework

    def _teacher_reviews_count(self, teacher):
        from rest_framework.test import APIClient

        client = APIClient()
        client.force_login(teacher)
        response = client.get("/api/cabinet/nav-counts/")
        self.assertEqual(response.status_code, 200, response.content)
        return int(response.json().get("reviews_count") or 0)

    def _submit_variant(self, homework, *, result=None, student_user=None):
        from rest_framework.test import APIClient
        from Cabinet.homework_api import issue_homework_token

        student_user = student_user or self.student_user
        token = issue_homework_token(
            homework_id=homework.pk,
            student_user_id=student_user.pk,
        )
        client = APIClient()
        body = {
            "result": result
            or {
                "by_task_id": {"1": "42", "2": "развёрнутый"},
                "checked": {"1": True},
                "scores": {},
            }
        }
        response = client.post(
            f"/api/homework/assignment/{homework.pk}/submit/?token={token}",
            body,
            format="json",
        )
        return response

    def test_assign_platform_variant_creates_generated_task(self):
        from Cabinet.models import HomeworkTask

        homework = self._assign_platform_variant()
        task = HomeworkTask.objects.filter(homework=homework).order_by("order").last()
        self.assertEqual(task.task_type, "generated_task")
        self.assertIn("/variant/500", task.description)
        self.assertEqual(homework.teacher_id, self.teacher.pk)

    def test_draft_does_not_count_as_submitted_for_teacher(self):
        from rest_framework.test import APIClient
        from Cabinet.models import HomeworkSubmission

        homework = self._assign_platform_variant()
        before = self._teacher_reviews_count(self.teacher)

        client = APIClient()
        client.force_login(self.student_user)
        draft = client.post(
            f"/api/homework/assignment/{homework.pk}/save-draft/",
            {"result": {"by_task_id": {"1": "7"}, "checked": {"1": True}}},
            format="json",
        )
        self.assertEqual(draft.status_code, 200, draft.content)
        self.assertEqual(draft.json().get("status"), "sent")

        submission = HomeworkSubmission.objects.get(homework=homework, student=self.student)
        self.assertIsNone(submission.submitted_at)
        self.assertTrue(submission.result_payload)

        detail = client.get(f"/api/cabinet/student/assignments/{homework.pk}/")
        self.assertEqual(detail.status_code, 200)
        self.assertEqual(detail.json()["status"], "new")
        self.assertFalse(detail.json()["variant_submitted"])

        self.assertEqual(self._teacher_reviews_count(self.teacher), before)

    def test_submit_sets_submitted_at_and_appears_in_teacher_queue(self):
        from Cabinet.models import HomeworkSubmission, ReviewItem

        homework = self._assign_platform_variant()
        before = self._teacher_reviews_count(self.teacher)

        response = self._submit_variant(homework)
        self.assertEqual(response.status_code, 200, response.content)
        data = response.json()
        self.assertTrue(data.get("ok"))
        self.assertEqual(data.get("status"), "submitted")
        self.assertTrue(data.get("submitted_at"))

        submission = HomeworkSubmission.objects.get(homework=homework, student=self.student)
        self.assertIsNotNone(submission.submitted_at)
        self.assertEqual(submission.status, "submitted")
        self.assertEqual(submission.result_payload["by_task_id"]["1"], "42")

        review = ReviewItem.objects.filter(
            teacher=self.teacher,
            source_type="homework",
            source_id=submission.pk,
            status="pending",
        ).first()
        self.assertIsNotNone(review)
        self.assertEqual(self._teacher_reviews_count(self.teacher), before + 1)

        from rest_framework.test import APIClient

        teacher_client = APIClient()
        teacher_client.force_login(self.teacher)
        dash = teacher_client.get("/api/cabinet/dashboard/")
        self.assertEqual(dash.status_code, 200)
        pending_ids = [row["id"] for row in dash.json().get("pending_reviews", [])]
        self.assertIn(review.pk, pending_ids)

        review_list = teacher_client.get("/api/cabinet/review/")
        self.assertEqual(review_list.status_code, 200)
        rows = review_list.json()
        if isinstance(rows, dict):
            rows = rows.get("results", [])
        self.assertIn(review.pk, [row["id"] for row in rows])
        row = next(r for r in rows if r["id"] == review.pk)
        self.assertTrue(row["homework_submission"]["submitted_at"])
        self.assertTrue(row["homework_review"]["has_variant"])

    def test_auto_checked_variant_stays_in_history_after_teacher_check(self):
        from rest_framework.test import APIClient
        from Cabinet.models import HomeworkSubmission, ReviewItem

        homework = self._assign_platform_variant()
        self._submit_variant(homework)
        submission = HomeworkSubmission.objects.get(homework=homework, student=self.student)
        review = ReviewItem.objects.get(source_type="homework", source_id=submission.pk)

        client = APIClient()
        client.force_login(self.teacher)
        checked = client.post(
            f"/api/cabinet/review/{review.pk}/check/",
            {"teacher_comment": "Автопроверка ок", "checked": {"1": True}, "scores": {}},
            format="json",
        )
        self.assertEqual(checked.status_code, 200, checked.content)
        review.refresh_from_db()
        submission.refresh_from_db()
        self.assertEqual(review.status, "checked")
        self.assertEqual(submission.status, "checked")

        review_list = client.get("/api/cabinet/review/?status=checked")
        rows = review_list.json()
        if isinstance(rows, dict):
            rows = rows.get("results", [])
        self.assertIn(review.pk, [row["id"] for row in rows])
        self.assertEqual(self._teacher_reviews_count(self.teacher), 0)

    def test_other_teacher_cannot_see_submission(self):
        from rest_framework.test import APIClient
        from Cabinet.models import HomeworkSubmission, ReviewItem

        homework = self._assign_platform_variant()
        self._submit_variant(homework)
        submission = HomeworkSubmission.objects.get(homework=homework, student=self.student)
        review = ReviewItem.objects.get(source_type="homework", source_id=submission.pk)

        other = APIClient()
        other.force_login(self.other_teacher)
        self.assertEqual(self._teacher_reviews_count(self.other_teacher), 0)
        detail = other.get(f"/api/cabinet/review/{review.pk}/")
        self.assertIn(detail.status_code, (403, 404))

    def test_resubmit_same_payload_is_idempotent(self):
        from Cabinet.models import HomeworkSubmission, ReviewItem

        homework = self._assign_platform_variant()
        first = self._submit_variant(homework)
        self.assertEqual(first.status_code, 200, first.content)
        second = self._submit_variant(homework)
        self.assertEqual(second.status_code, 200, second.content)
        self.assertTrue(second.json().get("already_submitted"))

        self.assertEqual(
            HomeworkSubmission.objects.filter(homework=homework, student=self.student).count(),
            1,
        )
        self.assertEqual(
            ReviewItem.objects.filter(
                teacher=self.teacher,
                source_type="homework",
                source_id=HomeworkSubmission.objects.get(
                    homework=homework, student=self.student
                ).pk,
            ).count(),
            1,
        )
        submission = HomeworkSubmission.objects.get(homework=homework, student=self.student)
        self.assertEqual(submission.result_payload["by_task_id"]["1"], "42")

    def test_resubmit_new_payload_updates_same_row(self):
        from Cabinet.models import HomeworkSubmission, ReviewItem

        homework = self._assign_platform_variant()
        first = self._submit_variant(homework)
        self.assertEqual(first.status_code, 200, first.content)
        second = self._submit_variant(
            homework,
            result={"by_task_id": {"1": "99"}, "checked": {"1": False}},
        )
        self.assertEqual(second.status_code, 200, second.content)
        self.assertFalse(second.json().get("already_submitted"))
        self.assertEqual(
            HomeworkSubmission.objects.filter(homework=homework, student=self.student).count(),
            1,
        )
        self.assertEqual(
            ReviewItem.objects.filter(
                teacher=self.teacher,
                source_type="homework",
                source_id=HomeworkSubmission.objects.get(
                    homework=homework, student=self.student
                ).pk,
            ).count(),
            1,
        )
        submission = HomeworkSubmission.objects.get(homework=homework, student=self.student)
        self.assertEqual(submission.result_payload["by_task_id"]["1"], "99")

    def test_submit_binds_correct_subject_among_several(self):
        homework = self._assign_platform_variant(student_subject=self.subject_math)
        self.assertEqual(homework.student_subject_id, self.subject_math.pk)
        response = self._submit_variant(homework)
        self.assertEqual(response.status_code, 200, response.content)
        homework.refresh_from_db()
        self.assertEqual(homework.student_subject_id, self.subject_math.pk)
        self.assertEqual(homework.teacher_id, self.teacher.pk)

    def test_platform_author_is_not_used_as_teacher(self):
        from Cabinet.models import ReviewItem, HomeworkSubmission

        homework = self._assign_platform_variant()
        self.assertNotEqual(homework.teacher_id, self.platform_admin.pk)
        self._submit_variant(homework)
        submission = HomeworkSubmission.objects.get(homework=homework, student=self.student)
        review = ReviewItem.objects.get(source_type="homework", source_id=submission.pk)
        self.assertEqual(review.teacher_id, self.teacher.pk)
        self.assertNotEqual(review.teacher_id, self.platform_admin.pk)

    def test_student_detail_requires_real_submit_for_variant_submitted_flag(self):
        from rest_framework.test import APIClient

        homework = self._assign_platform_variant()
        client = APIClient()
        client.force_login(self.student_user)
        client.post(
            f"/api/homework/assignment/{homework.pk}/save-draft/",
            {"result": {"by_task_id": {"1": "1"}, "checked": {"1": True}}},
            format="json",
        )
        before = client.get(f"/api/cabinet/student/assignments/{homework.pk}/").json()
        self.assertFalse(before["variant_submitted"])
        self.assertEqual(before["status"], "new")

        self._submit_variant(homework)
        after = client.get(f"/api/cabinet/student/assignments/{homework.pk}/").json()
        self.assertTrue(after["variant_submitted"])
        self.assertEqual(after["status"], "submitted")


class HomeworkSubmissionBackfillTests(TestCase):
    def setUp(self):
        self.teacher = User.objects.create_user(username="bf_teacher", password="pass")
        self.teacher.profile.role = Profile.Role.TEACHER
        self.teacher.profile.save()
        self.student = Student.objects.create(
            teacher=self.teacher,
            first_name="Бэкап",
            last_name="Ученик",
            status="active",
        )

    def test_backfill_marks_draft_with_answers_as_submitted(self):
        from Cabinet.homework_backfill import backfill_unsubmitted_homework_with_answers
        from Cabinet.models import HomeworkSubmission, HomeworkTask, ReviewItem

        homework = Homework.objects.create(
            teacher=self.teacher,
            student=self.student,
            title="ДЗ вариант",
            status="assigned",
        )
        HomeworkTask.objects.create(
            homework=homework,
            task_type="generated_task",
            title="Вариант",
            description="/ege/inf/variant/900",
            order=0,
        )
        submission = HomeworkSubmission.objects.create(
            homework=homework,
            student=self.student,
            status="submitted",
            result_payload={"by_task_id": {"1": "42"}, "checked": {"1": True}},
        )
        self.assertIsNone(submission.submitted_at)

        stats = backfill_unsubmitted_homework_with_answers(dry_run=False)
        self.assertGreaterEqual(stats["submitted_at_set"], 1)
        submission.refresh_from_db()
        self.assertIsNotNone(submission.submitted_at)
        self.assertTrue(
            ReviewItem.objects.filter(
                teacher=self.teacher,
                source_type="homework",
                source_id=submission.pk,
            ).exists()
        )

    def test_backfill_skips_empty_placeholder(self):
        from Cabinet.homework_backfill import backfill_unsubmitted_homework_with_answers
        from Cabinet.models import HomeworkSubmission

        homework = Homework.objects.create(
            teacher=self.teacher,
            student=self.student,
            title="Пустое ДЗ",
            status="assigned",
        )
        submission = HomeworkSubmission.objects.create(
            homework=homework,
            student=self.student,
            status="submitted",
            result_payload={},
        )
        stats = backfill_unsubmitted_homework_with_answers(dry_run=False)
        submission.refresh_from_db()
        self.assertIsNone(submission.submitted_at)
        self.assertNotIn(submission.pk, stats["ids"])

    def test_live_with_answers_skipped_by_backfill_and_teacher_queue(self):
        from rest_framework.test import APIClient
        from Cabinet.homework_backfill import backfill_unsubmitted_homework_with_answers
        from Cabinet.models import HomeworkSubmission, HomeworkTask, ReviewItem

        homework = Homework.objects.create(
            teacher=self.teacher,
            student=self.student,
            title="Вариант на уроке",
            description="live-meeting:1:variant:901\nПоказан на уроке",
            status="assigned",
        )
        HomeworkTask.objects.create(
            homework=homework,
            task_type="generated_task",
            title="Вариант",
            description="/ege/inf/variant/901",
            order=0,
        )
        submission = HomeworkSubmission.objects.create(
            homework=homework,
            student=self.student,
            status="submitted",
            result_payload={"by_task_id": {"1": "1"}, "checked": {"1": True}},
            score=50,
        )

        client = APIClient()
        client.force_login(self.teacher)
        before = client.get("/api/cabinet/nav-counts/").json()["reviews_count"]
        stats = backfill_unsubmitted_homework_with_answers(dry_run=False)
        self.assertGreaterEqual(stats["skipped_live"], 1)
        submission.refresh_from_db()
        self.assertIsNone(submission.submitted_at)
        self.assertFalse(
            ReviewItem.objects.filter(source_type="homework", source_id=submission.pk).exists()
        )
        after = client.get("/api/cabinet/nav-counts/").json()["reviews_count"]
        self.assertEqual(after, before)
