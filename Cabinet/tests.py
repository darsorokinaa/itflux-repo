from datetime import timedelta

from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone

from Cabinet.choices import NotificationChannel, ParticipantRole, ParticipantStatus
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

    def test_cancel_shift_moves_plan_topic_to_next_lesson(self):
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
            plan_cancel_action="shift",
        )
        payload3 = schedule_event_to_json(event3)
        self.assertEqual(payload3["planItem"]["id"], self.item2.id)

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

    def test_ensure_out_of_plan_materials_do_not_mutate_enrollment_plan(self):
        """Урок вне плана + материалы → отдельный черновик, слот плана не трогаем."""
        display_item, _ = resolve_plan_item_for_event(self.event1)
        self.assertEqual(display_item.id, self.item1.id)

        ensured, _ = ensure_event_plan_item(self.event1, teacher=self.teacher)
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

        # Служебные черновики скрыты из списка планов
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
            title="Публичный черновик",
            direction="oge",
            status="draft",
        )
        self.public_plan = LessonPlan.objects.create(
            teacher=None,
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
        self.assertEqual(titles, ["ОГЭ — готовый маршрут"])

    def test_mine_lists_only_teacher_plans(self):
        from rest_framework.test import APIClient

        client = APIClient()
        client.force_login(self.teacher)
        response = client.get("/api/cabinet/lesson-plans/?mine=true")
        self.assertEqual(response.status_code, 200)
        titles = {item["title"] for item in response.data}
        self.assertEqual(titles, {"Мой черновик", "Мой опубликованный"})

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
                "status": "draft",
                "is_public": True,
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        plan = LessonPlan.objects.get(pk=response.data["id"])
        self.assertIsNone(plan.teacher_id)
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
        from Cabinet.models import Homework

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
        self.assertEqual(homework.tasks.count(), 1)

        options = client.get(f"/api/cabinet/students/{self.student.pk}/homework-options/").json()
        self.assertTrue(options["items"][0]["assigned"])

    def test_teacher_can_assign_custom_homework(self):
        from rest_framework.test import APIClient
        from Cabinet.models import Homework

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
        self.assertEqual(homework.tasks.count(), 1)


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
            description="/media/cabinet/materials/demo.pdf",
            order=0,
        )

        client = APIClient()
        client.force_login(self.student_user)
        response = client.get(f"/api/cabinet/student/assignments/{hw.pk}/")
        self.assertEqual(response.status_code, 200)
        task = response.json()["tasks"][0]
        self.assertTrue(task.get("open_url"))
        self.assertTrue(task["open_url"].startswith("/media/"))

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


class ReferralLinkTests(TestCase):
    def setUp(self):
        from decimal import Decimal
        from Cabinet.models import ReferralLink, TariffPlan

        self.pro_plan, _ = TariffPlan.objects.get_or_create(
            slug="pro",
            defaults={
                "name": "Профи",
                "price_month": Decimal("1990"),
                "max_students": 60,
                "sort_order": 2,
            },
        )
        self.referral = ReferralLink.objects.create(
            code="PARTNER3M",
            title="Партнёрская ссылка",
            reward_plan=self.pro_plan,
            reward_months=3,
        )

    def test_referral_preview(self):
        from django.test import Client

        client = Client()
        response = client.get("/api/cabinet/referral/PARTNER3M/preview/")
        self.assertEqual(response.status_code, 200, response.content)
        data = response.json()
        self.assertTrue(data["valid"])
        self.assertEqual(data["reward_months"], 3)
        self.assertEqual(data["reward_plan"]["slug"], "pro")

    def test_teacher_registration_applies_referral_bonus(self):
        from django.test import Client
        from Cabinet.models import TeacherSubscription

        client = Client()
        response = client.post(
            "/api/cabinet/register/",
            data={
                "email": "ref_teacher@test.ru",
                "password": "StrongPass123!",
                "password_confirm": "StrongPass123!",
                "role": "teacher",
                "referral_code": "PARTNER3M",
            },
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        data = response.json()
        self.assertTrue(data.get("referral_applied"))
        self.assertEqual(data["referral_reward"]["plan_slug"], "pro")
        self.assertEqual(data["referral_reward"]["reward_months"], 3)

        user_id = data["user"]["id"]
        from django.contrib.auth.models import User
        user = User.objects.get(pk=user_id)
        sub = TeacherSubscription.objects.get(teacher=user)
        self.assertEqual(sub.plan.slug, "pro")
        self.assertEqual(sub.status, "trial")
        self.assertIsNotNone(sub.expires_at)

        self.referral.refresh_from_db()
        self.assertEqual(self.referral.registrations_count, 1)

    def test_referral_code_forces_teacher_registration(self):
        from django.test import Client
        from Cabinet.models import ReferralLinkRegistration

        client = Client()
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
