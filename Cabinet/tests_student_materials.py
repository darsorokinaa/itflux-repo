"""Student materials library: lesson + homework attachments without duplicates."""

from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIClient

from Cabinet.choices import AssignmentStatus, HomeworkStatus, HomeworkTaskType, MaterialStatus
from Cabinet.models import (
    Homework,
    HomeworkTask,
    Lesson,
    LessonAssignment,
    LessonPlan,
    LessonPlanItem,
    Material,
    Profile,
    Student,
)
from Cabinet.student_release import assign_custom_homework


class StudentMaterialsLibraryTests(TestCase):
    def setUp(self):
        self.teacher = User.objects.create_user(username="mat_teacher", password="pass")
        self.teacher.profile.role = Profile.Role.TEACHER
        self.teacher.profile.save(update_fields=["role"])

        self.student_user = User.objects.create_user(username="mat_student", password="pass")
        self.student_user.profile.role = Profile.Role.STUDENT
        self.student_user.profile.save(update_fields=["role"])

        self.student = Student.objects.create(
            teacher=self.teacher,
            user=self.student_user,
            first_name="Аня",
            last_name="Ученица",
            status="active",
        )

        self.lesson_material = Material.objects.create(
            teacher=self.teacher,
            title="Конспект урока",
            material_type="methodic",
            status=MaterialStatus.PUBLISHED,
            external_url="https://example.com/lesson-notes",
        )
        self.hw_material = Material.objects.create(
            teacher=self.teacher,
            title="Файл к ДЗ",
            material_type="file",
            status=MaterialStatus.PUBLISHED,
            external_url="https://example.com/hw-file",
        )
        self.duplicate_material = Material.objects.create(
            teacher=self.teacher,
            title="Общий материал",
            material_type="link",
            status=MaterialStatus.PUBLISHED,
            external_url="https://example.com/shared",
        )

        self.client = APIClient()
        self.client.force_authenticate(user=self.student_user)

    def test_homework_and_lesson_materials_appear_without_duplicates(self):
        lesson = Lesson.objects.create(
            teacher=self.teacher,
            title="Урок 1",
            topic="Алгоритмы",
            status="published",
        )
        lesson.materials.add(self.lesson_material, self.duplicate_material)
        LessonAssignment.objects.create(
            teacher=self.teacher,
            student=self.student,
            lesson=lesson,
            status=AssignmentStatus.ASSIGNED,
        )

        plan = LessonPlan.objects.create(teacher=self.teacher, title="План")
        plan_item = LessonPlanItem.objects.create(plan=plan, title="Занятие 1", order=1)
        plan_item.homework_materials.add(self.hw_material, self.duplicate_material)

        homework = Homework.objects.create(
            teacher=self.teacher,
            student=self.student,
            title="ДЗ после урока",
            status=HomeworkStatus.ASSIGNED,
            lesson=lesson,
            lesson_plan_item=plan_item,
        )
        HomeworkTask.objects.create(
            homework=homework,
            task_type=HomeworkTaskType.EXTERNAL_LINK,
            title=self.hw_material.title,
            description=self.hw_material.external_url,
            order=0,
        )
        HomeworkTask.objects.create(
            homework=homework,
            task_type=HomeworkTaskType.EXTERNAL_LINK,
            title=self.duplicate_material.title,
            description=self.duplicate_material.external_url,
            order=1,
        )

        materials_resp = self.client.get("/api/cabinet/student/materials/")
        self.assertEqual(materials_resp.status_code, 200, materials_resp.content)
        items = materials_resp.json()["items"]
        ids = [row["id"] for row in items]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertIn(self.lesson_material.id, ids)
        self.assertIn(self.hw_material.id, ids)
        self.assertIn(self.duplicate_material.id, ids)
        self.assertEqual(ids.count(self.duplicate_material.id), 1)

        hw_row = next(row for row in items if row["id"] == self.hw_material.id)
        self.assertEqual(hw_row["source"], "homework")
        self.assertEqual(hw_row["homework_id"], homework.id)
        self.assertTrue(hw_row.get("teacher_name"))
        self.assertEqual(hw_row.get("teacher_id"), self.teacher.id)

        lesson_row = next(row for row in items if row["id"] == self.lesson_material.id)
        self.assertEqual(lesson_row["source"], "lesson")
        self.assertTrue(lesson_row.get("teacher_name"))

        dash = self.client.get("/api/cabinet/student/dashboard/")
        self.assertEqual(dash.status_code, 200, dash.content)
        recent_ids = {row["id"] for row in dash.json().get("recent_materials", [])}
        self.assertTrue(recent_ids & {self.lesson_material.id, self.hw_material.id, self.duplicate_material.id})

    def test_custom_homework_materials_appear_in_library(self):
        homework = assign_custom_homework(
            teacher=self.teacher,
            student=self.student,
            title="Доп. ДЗ",
            material_ids=[self.hw_material.id],
        )
        self.assertIsNotNone(homework)

        resp = self.client.get("/api/cabinet/student/materials/")
        self.assertEqual(resp.status_code, 200, resp.content)
        ids = [row["id"] for row in resp.json()["items"]]
        self.assertIn(self.hw_material.id, ids)

    def test_direct_published_material_appears_and_draft_does_not(self):
        from Cabinet.models import DirectMaterialAssignment

        DirectMaterialAssignment.objects.create(
            teacher=self.teacher,
            material=self.lesson_material,
            student=self.student,
        )
        draft = Material.objects.create(
            teacher=self.teacher,
            title="Черновик",
            material_type="file",
            status=MaterialStatus.DRAFT,
            external_url="https://example.com/draft",
        )
        DirectMaterialAssignment.objects.create(
            teacher=self.teacher,
            material=draft,
            student=self.student,
        )
        resp = self.client.get("/api/cabinet/student/materials/")
        self.assertEqual(resp.status_code, 200, resp.content)
        items = resp.json()["items"]
        ids = [row["id"] for row in items]
        self.assertIn(self.lesson_material.id, ids)
        self.assertNotIn(draft.id, ids)
        row = next(row for row in items if row["id"] == self.lesson_material.id)
        self.assertEqual(row["source"], "direct")
        self.assertTrue(row["direct"])
        self.assertEqual(row["teacher_id"], self.teacher.id)

    def test_interactive_assignment_appears_in_library(self):
        from Cabinet.models import Interactive, InteractiveAssignment

        interactive = Interactive.objects.create(
            teacher=self.teacher,
            title="Карточки: корни",
            interactive_type="flashcards",
            status="published",
        )
        assignment = InteractiveAssignment.objects.create(
            teacher=self.teacher,
            interactive=interactive,
            student=self.student,
        )
        resp = self.client.get("/api/cabinet/student/materials/")
        self.assertEqual(resp.status_code, 200, resp.content)
        items = resp.json()["items"]
        row = next((it for it in items if it.get("id") == f"interactive-{assignment.id}"), None)
        self.assertIsNotNone(row)
        self.assertEqual(row["type"], "interactive")
        self.assertEqual(row["type_label"], "Интерактив")
        self.assertEqual(row["source"], "interactive")
        self.assertEqual(row["interactive_url"], f"/cabinet/student/interactives/{assignment.id}/play")
        self.assertEqual(row["teacher_id"], self.teacher.id)

    def test_plan_material_removed_later_stays_in_student_library(self):
        from Cabinet.student_release import _sync_lesson_content

        lesson = Lesson.objects.create(
            teacher=self.teacher,
            title="Урок",
            topic="Корни",
            status="published",
        )
        lesson.materials.add(self.lesson_material)
        LessonAssignment.objects.create(
            teacher=self.teacher,
            student=self.student,
            lesson=lesson,
            status=AssignmentStatus.ASSIGNED,
        )
        plan = LessonPlan.objects.create(teacher=self.teacher, title="План")
        plan_item = LessonPlanItem.objects.create(
            plan=plan, title="Занятие", order=1, linked_lesson=lesson,
        )
        plan_item.materials.add(self.lesson_material)

        replacement = Material.objects.create(
            teacher=self.teacher,
            title="Новая презентация",
            material_type="presentation",
            status=MaterialStatus.PUBLISHED,
            external_url="https://example.com/new-slides",
        )
        plan_item.materials.set([replacement])
        _sync_lesson_content(lesson, plan_item)

        resp = self.client.get("/api/cabinet/student/materials/")
        self.assertEqual(resp.status_code, 200, resp.content)
        ids = [row["id"] for row in resp.json()["items"]]
        self.assertIn(self.lesson_material.id, ids)
        self.assertIn(replacement.id, ids)

    def test_lesson_material_subject_filter_uses_event_subject(self):
        from datetime import timedelta

        from django.utils import timezone

        from Cabinet.models import ScheduleEvent, StudentSubject

        ss_math = StudentSubject.objects.create(
            student=self.student, subject="math", title="Алгебра",
        )
        ss_inf = StudentSubject.objects.create(
            student=self.student, subject="inf", title="Информатика",
        )
        lesson = Lesson.objects.create(
            teacher=self.teacher, title="Урок математики", topic="Алгебра", status="published",
        )
        lesson.materials.add(self.lesson_material)
        LessonAssignment.objects.create(
            teacher=self.teacher, student=self.student, lesson=lesson, status=AssignmentStatus.ASSIGNED,
        )
        starts = timezone.now() - timedelta(hours=2)
        ScheduleEvent.objects.create(
            owner=self.teacher,
            title="Математика",
            starts_at=starts,
            ends_at=starts + timedelta(minutes=45),
            student=self.student,
            student_subject=ss_math,
            lesson=lesson,
            event_type=ScheduleEvent.EventType.INDIVIDUAL_LESSON,
        )
        math_resp = self.client.get(f"/api/cabinet/student/materials/?student_subject={ss_math.id}")
        inf_resp = self.client.get(f"/api/cabinet/student/materials/?student_subject={ss_inf.id}")
        self.assertEqual(math_resp.status_code, 200)
        self.assertEqual(inf_resp.status_code, 200)
        math_ids = [row["id"] for row in math_resp.json()["items"]]
        inf_ids = [row["id"] for row in inf_resp.json()["items"]]
        self.assertIn(self.lesson_material.id, math_ids)
        self.assertNotIn(self.lesson_material.id, inf_ids)

    def test_unknown_material_type_does_not_break_library(self):
        weird = Material.objects.create(
            teacher=self.teacher,
            title="Неизвестный тип",
            material_type="legacy_html",
            status=MaterialStatus.PUBLISHED,
            external_url="https://example.com/legacy",
        )
        from Cabinet.models import DirectMaterialAssignment

        DirectMaterialAssignment.objects.create(
            teacher=self.teacher, material=weird, student=self.student,
        )
        resp = self.client.get("/api/cabinet/student/materials/")
        self.assertEqual(resp.status_code, 200, resp.content)
        row = next(it for it in resp.json()["items"] if it["id"] == weird.id)
        self.assertEqual(row["type"], "legacy_html")
        self.assertTrue(row["title"])

    def test_two_variant_materials_are_not_merged(self):
        from Cabinet.models import DirectMaterialAssignment

        v1 = Material.objects.create(
            teacher=self.teacher,
            title="Вариант 1",
            material_type="task_set",
            status=MaterialStatus.PUBLISHED,
            external_url="https://example.com/variant/1",
        )
        v2 = Material.objects.create(
            teacher=self.teacher,
            title="Вариант 2",
            material_type="task_set",
            status=MaterialStatus.PUBLISHED,
            external_url="https://example.com/variant/2",
        )
        DirectMaterialAssignment.objects.create(teacher=self.teacher, material=v1, student=self.student)
        DirectMaterialAssignment.objects.create(teacher=self.teacher, material=v2, student=self.student)
        resp = self.client.get("/api/cabinet/student/materials/")
        ids = [row["id"] for row in resp.json()["items"]]
        self.assertIn(v1.id, ids)
        self.assertIn(v2.id, ids)
        self.assertEqual(ids.count(v1.id), 1)
        self.assertEqual(ids.count(v2.id), 1)

    def test_image_and_pdf_files_expose_preview(self):
        from django.core.files.base import ContentFile

        from Cabinet.models import DirectMaterialAssignment

        png = (
            b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
            b"\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\x0f\x00"
            b"\x00\x01\x01\x00\x05\x18\xd8N\x00\x00\x00\x00IEND\xaeB`\x82"
        )
        image = Material.objects.create(
            teacher=self.teacher,
            title="Схема",
            material_type="file",
            status=MaterialStatus.PUBLISHED,
        )
        image.file.save("schema.png", ContentFile(png), save=True)
        pdf = Material.objects.create(
            teacher=self.teacher,
            title="Конспект PDF",
            material_type="file",
            status=MaterialStatus.PUBLISHED,
        )
        pdf.file.save("notes.pdf", ContentFile(b"%PDF-1.4 test"), save=True)
        DirectMaterialAssignment.objects.create(
            teacher=self.teacher, material=image, student=self.student,
        )
        DirectMaterialAssignment.objects.create(
            teacher=self.teacher, material=pdf, student=self.student,
        )

        resp = self.client.get("/api/cabinet/student/materials/")
        self.assertEqual(resp.status_code, 200, resp.content)
        by_id = {row["id"]: row for row in resp.json()["items"]}
        image_row = by_id[image.id]
        pdf_row = by_id[pdf.id]
        self.assertEqual(image_row["preview_kind"], "image")
        self.assertTrue(image_row["is_image"])
        self.assertTrue(image_row["preview_url"])
        self.assertIn("/preview/", image_row["preview_url"])
        self.assertEqual(pdf_row["preview_kind"], "pdf")
        self.assertTrue(pdf_row["preview_url"])
        self.assertIn("/preview/", pdf_row["preview_url"])


class StudentMaterialsAclTests(TestCase):
    def setUp(self):
        from django.core.files.base import ContentFile

        self.teacher = User.objects.create_user(username="acl_teacher", password="pass")
        self.teacher.profile.role = Profile.Role.TEACHER
        self.teacher.profile.save(update_fields=["role"])

        self.student_user = User.objects.create_user(username="acl_student", password="pass")
        self.student_user.profile.role = Profile.Role.STUDENT
        self.student_user.profile.save(update_fields=["role"])
        self.student = Student.objects.create(
            teacher=self.teacher,
            user=self.student_user,
            first_name="Маша",
            last_name="Ученица",
            status="active",
        )

        self.other_user = User.objects.create_user(username="acl_other", password="pass")
        self.other_user.profile.role = Profile.Role.STUDENT
        self.other_user.profile.save(update_fields=["role"])
        self.other_student = Student.objects.create(
            teacher=self.teacher,
            user=self.other_user,
            first_name="Петя",
            last_name="Другой",
            status="active",
        )

        self.file_material = Material.objects.create(
            teacher=self.teacher,
            title="PDF конспект",
            material_type="file",
            status=MaterialStatus.PUBLISHED,
        )
        self.file_material.file.save("notes.txt", ContentFile(b"secret-notes"), save=True)

        self.client = APIClient()

    def test_group_direct_assignment_lists_and_allows_download(self):
        from Cabinet.models import DirectMaterialAssignment, StudentGroup

        group = StudentGroup.objects.create(teacher=self.teacher, title="Группа А")
        group.students.add(self.student)
        DirectMaterialAssignment.objects.create(
            teacher=self.teacher,
            material=self.file_material,
            group=group,
        )
        self.client.force_authenticate(user=self.student_user)
        listed = self.client.get("/api/cabinet/student/materials/")
        self.assertEqual(listed.status_code, 200)
        ids = [row["id"] for row in listed.json()["items"]]
        self.assertIn(self.file_material.id, ids)
        download = self.client.get(f"/api/cabinet/student/materials/{self.file_material.id}/file/")
        self.assertEqual(download.status_code, 200)
        self.assertEqual(b"".join(download.streaming_content), b"secret-notes")

    def test_other_student_cannot_list_or_download_material(self):
        from Cabinet.models import DirectMaterialAssignment

        DirectMaterialAssignment.objects.create(
            teacher=self.teacher,
            material=self.file_material,
            student=self.student,
        )
        self.client.force_authenticate(user=self.other_user)
        listed = self.client.get("/api/cabinet/student/materials/")
        self.assertEqual(listed.status_code, 200)
        ids = [row["id"] for row in listed.json()["items"]]
        self.assertNotIn(self.file_material.id, ids)
        download = self.client.get(f"/api/cabinet/student/materials/{self.file_material.id}/file/")
        self.assertIn(download.status_code, (403, 404))

    def test_other_teacher_same_subject_cannot_download_via_spoofed_ids(self):
        from Cabinet.models import DirectMaterialAssignment, StudentSubject

        other_teacher = User.objects.create_user(username="acl_teacher2", password="pass")
        other_teacher.profile.role = Profile.Role.TEACHER
        other_teacher.profile.save(update_fields=["role"])
        other_teacher_student_user = User.objects.create_user(username="acl_s2", password="pass")
        other_teacher_student_user.profile.role = Profile.Role.STUDENT
        other_teacher_student_user.profile.save(update_fields=["role"])
        other_roster = Student.objects.create(
            teacher=other_teacher,
            user=other_teacher_student_user,
            first_name="Маша",
            last_name="Другая",
            status="active",
        )
        StudentSubject.objects.create(student=self.student, subject="math", title="Алгебра")
        StudentSubject.objects.create(student=other_roster, subject="math", title="Алгебра")
        DirectMaterialAssignment.objects.create(
            teacher=self.teacher,
            material=self.file_material,
            student=self.student,
        )
        self.client.force_authenticate(user=other_teacher_student_user)
        listed = self.client.get("/api/cabinet/student/materials/")
        ids = [row["id"] for row in listed.json()["items"]]
        self.assertNotIn(self.file_material.id, ids)
        download = self.client.get(f"/api/cabinet/student/materials/{self.file_material.id}/file/")
        self.assertIn(download.status_code, (403, 404))

        self.client.force_authenticate(user=other_teacher)
        teacher_download = self.client.get(f"/api/cabinet/materials/{self.file_material.id}/file/")
        self.assertIn(teacher_download.status_code, (403, 404))

    def test_student_cannot_spoof_another_student_id_via_query(self):
        from Cabinet.models import DirectMaterialAssignment

        DirectMaterialAssignment.objects.create(
            teacher=self.teacher,
            material=self.file_material,
            student=self.student,
        )
        self.client.force_authenticate(user=self.other_user)
        resp = self.client.get(
            f"/api/cabinet/student/materials/?student_id={self.student.id}"
        )
        self.assertEqual(resp.status_code, 200)
        ids = [row["id"] for row in resp.json()["items"]]
        self.assertNotIn(self.file_material.id, ids)


class TeacherStudentMaterialsViewTests(TestCase):
    def setUp(self):
        from django.core.files.base import ContentFile

        from Cabinet.models import DirectMaterialAssignment

        self.teacher = User.objects.create_user(username="tmat_teacher", password="pass")
        self.teacher.profile.role = Profile.Role.TEACHER
        self.teacher.profile.save(update_fields=["role"])

        self.other_teacher = User.objects.create_user(username="tmat_teacher2", password="pass")
        self.other_teacher.profile.role = Profile.Role.TEACHER
        self.other_teacher.profile.save(update_fields=["role"])

        self.student_user = User.objects.create_user(username="tmat_student", password="pass")
        self.student_user.profile.role = Profile.Role.STUDENT
        self.student_user.profile.save(update_fields=["role"])
        self.student = Student.objects.create(
            teacher=self.teacher,
            user=self.student_user,
            first_name="Аня",
            last_name="Ученица",
            status="active",
        )
        self.other_roster = Student.objects.create(
            teacher=self.other_teacher,
            user=self.student_user,
            first_name="Аня",
            last_name="Ученица",
            status="active",
        )

        self.material = Material.objects.create(
            teacher=self.teacher,
            title="Схема",
            material_type="file",
            status=MaterialStatus.PUBLISHED,
        )
        png = (
            b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
            b"\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\x0f\x00"
            b"\x00\x01\x01\x00\x05\x18\xd8N\x00\x00\x00\x00IEND\xaeB`\x82"
        )
        self.material.file.save("schema.png", ContentFile(png), save=True)

        self.foreign_material = Material.objects.create(
            teacher=self.other_teacher,
            title="Чужой файл",
            material_type="file",
            status=MaterialStatus.PUBLISHED,
            external_url="https://example.com/other",
        )

        self.assignment = DirectMaterialAssignment.objects.create(
            teacher=self.teacher,
            material=self.material,
            student=self.student,
        )
        DirectMaterialAssignment.objects.create(
            teacher=self.other_teacher,
            material=self.foreign_material,
            student=self.other_roster,
        )

        self.client = APIClient()

    def test_teacher_sees_own_student_materials_with_preview_and_revoke(self):
        self.client.force_authenticate(user=self.teacher)
        resp = self.client.get(f"/api/cabinet/students/{self.student.id}/materials/")
        self.assertEqual(resp.status_code, 200, resp.content)
        items = resp.json()["items"]
        ids = [row["id"] for row in items]
        self.assertIn(self.material.id, ids)
        self.assertNotIn(self.foreign_material.id, ids)
        row = next(item for item in items if item["id"] == self.material.id)
        self.assertEqual(row["direct_assignment_id"], self.assignment.id)
        self.assertTrue(row["can_revoke"])
        self.assertEqual(row["preview_kind"], "image")
        self.assertTrue(row["preview_url"])
        self.assertNotIn("/student/", row["preview_url"])
        self.assertIn("/preview/", row["preview_url"])

    def test_other_teacher_cannot_read_foreign_student_materials(self):
        self.client.force_authenticate(user=self.other_teacher)
        resp = self.client.get(f"/api/cabinet/students/{self.student.id}/materials/")
        self.assertEqual(resp.status_code, 404)

    def test_student_cannot_use_teacher_materials_endpoint(self):
        self.client.force_authenticate(user=self.student_user)
        resp = self.client.get(f"/api/cabinet/students/{self.student.id}/materials/")
        self.assertIn(resp.status_code, (403, 404))

    def test_teacher_revoke_hides_direct_assignment(self):
        self.client.force_authenticate(user=self.teacher)
        delete = self.client.delete(f"/api/cabinet/direct-materials/{self.assignment.id}/")
        self.assertEqual(delete.status_code, 204)
        listed = self.client.get(f"/api/cabinet/students/{self.student.id}/materials/")
        ids = [row["id"] for row in listed.json()["items"]]
        self.assertNotIn(self.material.id, ids)

    def test_teacher_can_create_folder_move_and_delete_without_losing_material(self):
        self.client.force_authenticate(user=self.teacher)
        created = self.client.post(
            f"/api/cabinet/students/{self.student.id}/material-folders/",
            {"name": "Алгебра"},
            format="json",
        )
        self.assertEqual(created.status_code, 201, created.content)
        folder_id = created.json()["id"]
        moved = self.client.post(
            f"/api/cabinet/students/{self.student.id}/material-placements/",
            {"keys": [str(self.material.id)], "folder_id": folder_id},
            format="json",
        )
        self.assertEqual(moved.status_code, 200, moved.content)
        listed = self.client.get(f"/api/cabinet/students/{self.student.id}/materials/")
        row = next(item for item in listed.json()["items"] if item["id"] == self.material.id)
        self.assertEqual(row["folder_id"], folder_id)
        self.assertEqual(row["folder_name"], "Алгебра")
        deleted = self.client.delete(
            f"/api/cabinet/students/{self.student.id}/material-folders/{folder_id}/",
        )
        self.assertEqual(deleted.status_code, 204)
        listed = self.client.get(f"/api/cabinet/students/{self.student.id}/materials/")
        row = next(item for item in listed.json()["items"] if item["id"] == self.material.id)
        self.assertIsNone(row["folder_id"])
        ids = [item["id"] for item in listed.json()["items"]]
        self.assertIn(self.material.id, ids)

    def test_other_teacher_cannot_move_into_foreign_folder(self):
        self.client.force_authenticate(user=self.teacher)
        created = self.client.post(
            f"/api/cabinet/students/{self.student.id}/material-folders/",
            {"name": "Личное"},
            format="json",
        )
        folder_id = created.json()["id"]
        self.client.force_authenticate(user=self.other_teacher)
        resp = self.client.post(
            f"/api/cabinet/students/{self.student.id}/material-placements/",
            {"keys": [str(self.material.id)], "folder_id": folder_id},
            format="json",
        )
        self.assertEqual(resp.status_code, 404)

