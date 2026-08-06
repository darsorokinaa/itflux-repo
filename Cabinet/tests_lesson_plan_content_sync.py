from datetime import timedelta

from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from Cabinet.choices import (
    Direction,
    EnrollmentStatus,
    ExamType,
    LessonContentSource,
    PlanFormat,
    PlanStatus,
    PlanSubject,
    ScheduleMaterialSource,
)
from Cabinet.lesson_plan_content_sync import (
    LessonLearningPlanSyncService,
    LessonPlanSyncError,
    _guard_active,
    _set_guard,
)
from Cabinet.models import (
    LessonPlan,
    LessonPlanEnrollment,
    LessonPlanItem,
    Material,
    Profile,
    ScheduleEvent,
    ScheduleEventMaterial,
    Student,
    StudentGroup,
)
from Cabinet.schedule_service import create_single_event


def _make_teacher(username):
    user = User.objects.create_user(username=username, password="pass", email=f"{username}@test.ru")
    # Мутируем закешированный на user.profile объект напрямую, а не bulk .update() —
    # иначе значение роли на уже загруженном инстансе (что видит force_authenticate)
    # остаётся старым дефолтным, даже когда в БД оно уже верное.
    profile = user.profile
    profile.role = Profile.Role.TEACHER
    profile.save(update_fields=["role"])
    return user


def _make_student(teacher, *, username, first="Иван", last="Ученик"):
    user = User.objects.create_user(username=username, password="pass")
    profile = user.profile
    profile.role = Profile.Role.STUDENT
    profile.name = first
    profile.surname = last
    profile.save(update_fields=["role", "name", "surname"])
    return Student.objects.create(
        teacher=teacher, user=user, first_name=first, last_name=last, status="active",
    )


class LessonPlanContentSyncServiceTests(TestCase):
    """Service-level coverage for LessonLearningPlanSyncService (spec §13, scenarios 1-15)."""

    def setUp(self):
        self.teacher = _make_teacher("lp_teacher")
        self.student = _make_student(self.teacher, username="lp_student")
        self.plan = LessonPlan.objects.create(
            teacher=self.teacher,
            title="Курс ОГЭ информатика",
            direction=Direction.OGE,
            subject=PlanSubject.INFORMATICS,
            exam_type=ExamType.OGE,
            status=PlanStatus.PUBLISHED,
        )
        self.enrollment = LessonPlanEnrollment.objects.create(
            teacher=self.teacher,
            plan=self.plan,
            student=self.student,
            format=PlanFormat.INDIVIDUAL,
            status=EnrollmentStatus.ACTIVE,
        )
        self.item1 = LessonPlanItem.objects.create(plan=self.plan, order=1, title="Тема 1", topic="Множества")
        self.item2 = LessonPlanItem.objects.create(plan=self.plan, order=2, title="Тема 2", topic="Графы")

    def _make_event(self, *, starts_at=None, student=None, group=None, event_type="individual_lesson"):
        starts = starts_at or (timezone.now() + timedelta(days=1))
        return create_single_event(
            teacher=self.teacher,
            data={
                "title": "Урок",
                "starts_at": starts,
                "ends_at": starts + timedelta(minutes=45),
                "event_type": event_type,
                "format": "online",
                "notify_participants": False,
            },
            student_ids=[student.pk] if student else None,
            group_id=group.pk if group else None,
            notify=False,
        )

    # 1. Создание нового пункта плана из карточки урока.
    def test_create_plan_item_from_lesson(self):
        event = self._make_event(student=self.student)
        event.topic = "Новая тема с урока"
        event.save(update_fields=["topic"])
        before = self.plan.items.count()

        result = LessonLearningPlanSyncService.create_plan_item_from_lesson(
            event, teacher=self.teacher,
        )
        self.assertTrue(result["ok"])
        self.assertEqual(self.plan.items.count(), before + 1)
        event.refresh_from_db()
        self.assertIsNotNone(event.lesson_plan_item_id)
        self.assertEqual(event.lesson_plan_item.topic, "Новая тема с урока")

    # 2. Связывание урока с существующим пунктом плана.
    def test_link_existing_plan_item(self):
        event = self._make_event(student=self.student)
        LessonLearningPlanSyncService.link_plan_item(event, self.item1, teacher=self.teacher)

        event.refresh_from_db()
        self.item1.refresh_from_db()
        self.assertEqual(event.lesson_plan_item_id, self.item1.id)
        self.assertEqual(self.item1.scheduled_event_id, event.id)
        self.assertEqual(event.topic, "Множества")
        self.assertEqual(event.content_source, LessonContentSource.PLAN)

    # 3. Повторное сохранение не создаёт дубликаты.
    def test_repeat_save_no_duplicates(self):
        event = self._make_event(student=self.student)
        LessonLearningPlanSyncService.link_plan_item(event, self.item1, teacher=self.teacher)
        items_count = self.plan.items.count()

        LessonLearningPlanSyncService.sync_lesson_to_plan(
            event, teacher=self.teacher, mode="update_linked",
        )
        LessonLearningPlanSyncService.sync_lesson_to_plan(
            event, teacher=self.teacher, mode="update_linked",
        )
        self.assertEqual(self.plan.items.count(), items_count)

    # 4. Изменение темы урока с обновлением плана.
    def test_edit_topic_updates_plan(self):
        event = self._make_event(student=self.student)
        LessonLearningPlanSyncService.link_plan_item(event, self.item1, teacher=self.teacher)

        LessonLearningPlanSyncService.apply_lesson_edit(
            event, {"topic": "Обновлённая тема"}, teacher=self.teacher, sync_action="lesson_and_plan",
        )
        event.refresh_from_db()
        self.item1.refresh_from_db()
        self.assertEqual(event.topic, "Обновлённая тема")
        self.assertEqual(self.item1.topic, "Обновлённая тема")

    # 5. Изменение темы только в конкретном уроке.
    def test_edit_topic_lesson_only(self):
        event = self._make_event(student=self.student)
        LessonLearningPlanSyncService.link_plan_item(event, self.item1, teacher=self.teacher)

        LessonLearningPlanSyncService.apply_lesson_edit(
            event, {"topic": "Только в уроке"}, teacher=self.teacher, sync_action="lesson_only",
        )
        event.refresh_from_db()
        self.item1.refresh_from_db()
        self.assertEqual(event.topic, "Только в уроке")
        self.assertEqual(self.item1.topic, "Множества")
        self.assertIn("topic", event.manual_override_fields)
        self.assertEqual(event.content_source, LessonContentSource.MIXED)

    # 5b. Без enrollment тема всё равно сохраняется в карточке (soft-fail плана).
    def test_edit_topic_without_enrollment_keeps_lesson(self):
        other = _make_student(self.teacher, username="lp_no_plan", first="Пётр", last="БезПлана")
        event = self._make_event(student=other)
        result = LessonLearningPlanSyncService.apply_lesson_edit(
            event,
            {"topic": "Тема только в карточке"},
            teacher=self.teacher,
            sync_action="lesson_and_plan",
        )
        event.refresh_from_db()
        self.assertEqual(event.topic, "Тема только в карточке")
        self.assertIn("topic", event.manual_override_fields)
        self.assertFalse((result.get("plan") or {}).get("plan_updated", True))
        self.assertEqual((result.get("plan") or {}).get("plan_error"), "no_enrollment")

    # 6. Изменение пункта плана обновляет будущий урок.
    def test_plan_item_edit_propagates_to_future_lesson(self):
        event = self._make_event(student=self.student)
        LessonLearningPlanSyncService.link_plan_item(event, self.item1, teacher=self.teacher)

        self.item1.topic = "Тема изменена в плане"
        self.item1.save(update_fields=["topic", "updated_at"])
        result = LessonLearningPlanSyncService.sync_plan_item_to_lessons(self.item1, teacher=self.teacher)

        self.assertIn(event.pk, result["updated_event_ids"])
        event.refresh_from_db()
        self.assertEqual(event.topic, "Тема изменена в плане")

    # 7. Проведённый урок не обновляется.
    def test_done_lesson_not_updated(self):
        event = self._make_event(student=self.student)
        LessonLearningPlanSyncService.link_plan_item(event, self.item1, teacher=self.teacher)
        event.status = ScheduleEvent.Status.DONE
        event.save(update_fields=["status"])

        self.item1.topic = "Новая тема"
        self.item1.save(update_fields=["topic", "updated_at"])
        result = LessonLearningPlanSyncService.sync_plan_item_to_lessons(self.item1, teacher=self.teacher)

        self.assertNotIn(event.pk, result["updated_event_ids"])
        event.refresh_from_db()
        self.assertEqual(event.topic, "Множества")

    # 8. Отменённый урок не обновляется.
    def test_cancelled_lesson_not_updated(self):
        event = self._make_event(student=self.student)
        LessonLearningPlanSyncService.link_plan_item(event, self.item1, teacher=self.teacher)
        event.status = ScheduleEvent.Status.CANCELLED
        event.save(update_fields=["status"])

        self.item1.topic = "Новая тема"
        self.item1.save(update_fields=["topic", "updated_at"])
        result = LessonLearningPlanSyncService.sync_plan_item_to_lessons(self.item1, teacher=self.teacher)

        self.assertNotIn(event.pk, result["updated_event_ids"])

    # 9. Ручные материалы урока не удаляются при синхронизации.
    def test_manual_materials_not_deleted_on_sync(self):
        event = self._make_event(student=self.student)
        LessonLearningPlanSyncService.link_plan_item(event, self.item1, teacher=self.teacher)
        manual_material = Material.objects.create(teacher=self.teacher, title="Свой файл к уроку")
        LessonLearningPlanSyncService.attach_material(
            event, teacher=self.teacher, material_id=manual_material.id,
            source=ScheduleMaterialSource.LESSON_MANUAL,
        )

        LessonLearningPlanSyncService.sync_plan_item_to_lessons(self.item1, teacher=self.teacher)

        self.assertTrue(
            ScheduleEventMaterial.objects.filter(
                event=event, material=manual_material, source=ScheduleMaterialSource.LESSON_MANUAL,
            ).exists()
        )

    # 10. Материалы из плана не дублируются.
    def test_plan_materials_not_duplicated(self):
        event = self._make_event(student=self.student)
        plan_material = Material.objects.create(teacher=self.teacher, title="Материал плана")
        self.item1.materials.add(plan_material)
        LessonLearningPlanSyncService.link_plan_item(event, self.item1, teacher=self.teacher)

        LessonLearningPlanSyncService.sync_plan_item_to_lessons(self.item1, teacher=self.teacher)
        LessonLearningPlanSyncService.sync_plan_item_to_lessons(self.item1, teacher=self.teacher)

        self.assertEqual(
            ScheduleEventMaterial.objects.filter(
                event=event, material=plan_material, source=ScheduleMaterialSource.LEARNING_PLAN,
            ).count(),
            1,
        )

    # 11. Отключённая синхронизация защищает урок от изменений.
    def test_disabled_sync_protects_lesson(self):
        event = self._make_event(student=self.student)
        LessonLearningPlanSyncService.link_plan_item(event, self.item1, teacher=self.teacher)
        LessonLearningPlanSyncService.set_plan_sync_enabled(event, teacher=self.teacher, enabled=False)

        self.item1.topic = "Новая тема"
        self.item1.save(update_fields=["topic", "updated_at"])
        result = LessonLearningPlanSyncService.sync_plan_item_to_lessons(self.item1, teacher=self.teacher)

        self.assertNotIn(event.pk, result["updated_event_ids"])
        event.refresh_from_db()
        self.assertEqual(event.topic, "Множества")

    # 12. Перестановка тем обновляет будущие уроки в правильном порядке.
    def test_reorder_updates_future_lessons_in_order(self):
        now = timezone.now()
        event1 = self._make_event(student=self.student, starts_at=now + timedelta(days=1))
        event2 = self._make_event(student=self.student, starts_at=now + timedelta(days=2))

        # Меняем порядок пунктов местами.
        self.item1.order, self.item2.order = 2, 1
        self.item1.save(update_fields=["order"])
        self.item2.save(update_fields=["order"])

        result = LessonLearningPlanSyncService.reorder_future_lessons_from_plan(
            self.enrollment, teacher=self.teacher,
        )
        self.assertIsNone(result["warning"])
        event1.refresh_from_db()
        event2.refresh_from_db()
        self.assertEqual(event1.topic, "Графы")
        self.assertEqual(event2.topic, "Множества")

    # 13. Нельзя связать урок с планом другого ученика.
    def test_cannot_link_to_other_students_plan(self):
        other_student = _make_student(self.teacher, username="lp_other_student", first="Пётр", last="Другой")
        other_plan = LessonPlan.objects.create(
            teacher=self.teacher, title="Другой план", direction=Direction.EGE,
            subject=PlanSubject.MATH, exam_type=ExamType.EGE, status=PlanStatus.PUBLISHED,
        )
        LessonPlanEnrollment.objects.create(
            teacher=self.teacher, plan=other_plan, student=other_student,
            format=PlanFormat.INDIVIDUAL, status=EnrollmentStatus.ACTIVE,
        )
        other_item = LessonPlanItem.objects.create(plan=other_plan, order=1, title="Чужая тема")

        event = self._make_event(student=self.student)
        with self.assertRaises(LessonPlanSyncError) as ctx:
            LessonLearningPlanSyncService.link_plan_item(event, other_item, teacher=self.teacher)
        self.assertEqual(ctx.exception.code, "alien_plan")

    # 14. Групповой урок не изменяет все планы без подтверждения.
    def test_group_lesson_requires_explicit_confirmation(self):
        group = StudentGroup.objects.create(teacher=self.teacher, title="Группа", status="active")
        group.students.add(self.student)
        event = self._make_event(group=group, event_type="group_lesson")

        with self.assertRaises(LessonPlanSyncError) as ctx:
            LessonLearningPlanSyncService.create_plan_item_from_lesson(event, teacher=self.teacher)
        self.assertEqual(ctx.exception.code, "group_confirm_required")

    # 15. Синхронизация не вызывает бесконечные повторные обновления (guard).
    def test_sync_guard_prevents_reentrancy(self):
        event = self._make_event(student=self.student)
        LessonLearningPlanSyncService.link_plan_item(event, self.item1, teacher=self.teacher)

        self.assertFalse(_guard_active())
        _set_guard(True)
        try:
            result = LessonLearningPlanSyncService.sync_plan_item_to_lessons(self.item1, teacher=self.teacher)
        finally:
            _set_guard(False)
        self.assertTrue(result.get("skipped"))
        self.assertFalse(_guard_active())

    def test_plan_item_title_equal_to_audience_not_copied_as_topic(self):
        """Legacy пункты с title=имя ученика не должны отравлять topic урока."""
        event = self._make_event(student=self.student)
        event.title = "Александр Федоров"
        event.audience = "Александр Федоров"
        event.topic = ""
        event.save(update_fields=["title", "audience", "topic"])
        poisoned = LessonPlanItem.objects.create(
            plan=self.plan,
            order=3,
            title="Александр Федоров",
            topic="",
        )
        LessonLearningPlanSyncService.link_plan_item(event, poisoned, teacher=self.teacher)
        event.refresh_from_db()
        self.assertEqual(event.topic, "")

    def test_detach_material_removes_plan_link_keeps_library(self):
        event = self._make_event(student=self.student)
        LessonLearningPlanSyncService.link_plan_item(event, self.item1, teacher=self.teacher)
        material = Material.objects.create(teacher=self.teacher, title="Файл к уроку")
        LessonLearningPlanSyncService.attach_material(
            event, teacher=self.teacher, material_id=material.id,
            source=ScheduleMaterialSource.LESSON_MANUAL,
        )
        self.assertTrue(self.item1.materials.filter(pk=material.id).exists())

        LessonLearningPlanSyncService.detach_material(
            event, teacher=self.teacher, material_id=material.id,
        )
        self.assertFalse(self.item1.materials.filter(pk=material.id).exists())
        self.assertTrue(Material.objects.filter(pk=material.id).exists())
        self.assertFalse(
            ScheduleEventMaterial.objects.filter(event=event, material=material).exists()
        )


class LessonPlanContentSyncApiTests(TestCase):
    """Проверка, что обычный PATCH карточки урока идёт через сервис синхронизации."""

    def setUp(self):
        self.teacher = _make_teacher("lp_api_teacher")
        self.student = _make_student(self.teacher, username="lp_api_student")
        self.plan = LessonPlan.objects.create(
            teacher=self.teacher, title="План API", direction=Direction.OGE,
            subject=PlanSubject.INFORMATICS, exam_type=ExamType.OGE, status=PlanStatus.PUBLISHED,
        )
        LessonPlanEnrollment.objects.create(
            teacher=self.teacher, plan=self.plan, student=self.student,
            format=PlanFormat.INDIVIDUAL, status=EnrollmentStatus.ACTIVE,
        )
        self.item = LessonPlanItem.objects.create(plan=self.plan, order=1, title="Тема 1", topic="Множества")
        starts = timezone.now() + timedelta(days=1)
        self.event = create_single_event(
            teacher=self.teacher,
            data={
                "title": "Урок",
                "starts_at": starts,
                "ends_at": starts + timedelta(minutes=45),
                "event_type": "individual_lesson",
                "format": "online",
                "notify_participants": False,
            },
            student_ids=[self.student.pk],
            notify=False,
        )
        LessonLearningPlanSyncService.link_plan_item(self.event, self.item, teacher=self.teacher)
        self.client = APIClient()
        self.client.force_authenticate(self.teacher)

    def test_content_endpoint_conflict_then_resolve(self):
        """Конфликт темы ловится на /content/, а не на обычном PATCH времени/ссылки."""
        url = f"/api/cabinet/schedule/{self.event.pk}/content/"
        res = self.client.post(url, {"topic": "Конфликтная тема"}, format="json")
        self.assertEqual(res.status_code, 409, res.content)
        self.assertTrue(res.data.get("conflict"))

        res2 = self.client.post(
            url,
            {"topic": "Конфликтная тема", "resolve_conflict": "lesson_and_plan"},
            format="json",
        )
        self.assertEqual(res2.status_code, 200, res2.content)
        self.item.refresh_from_db()
        self.assertEqual(self.item.topic, "Конфликтная тема")

    def test_patch_non_content_field_unaffected(self):
        url = f"/api/cabinet/schedule/{self.event.pk}/"
        res = self.client.patch(url, {"location": "Кабинет 5"}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.event.refresh_from_db()
        self.assertEqual(self.event.location, "Кабинет 5")
        self.assertEqual(self.event.topic, "Множества")
