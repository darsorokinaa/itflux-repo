"""Балл задачи важнее общего списка. Файлы ученика в банке, эталон учителя закрыт."""

import json
from io import StringIO

from django.contrib.auth.models import User
from django.core.files.base import ContentFile
from django.core.management import call_command
from django.test import Client, TestCase

from Generator.models import (
    Level,
    Subject,
    Task,
    TaskGroup,
    TaskGroupMember,
    TaskList,
    Variant,
    VariantContent,
    private_media_storage,
)
from Generator.variant_scoring import load_variant_tasks_for_scoring


def _store(key: str, payload: bytes) -> str:
    if private_media_storage.exists(key):
        private_media_storage.delete(key)
    private_media_storage.save(key, ContentFile(payload))
    return key


class BankScoreAndStudentFileTests(TestCase):
    def setUp(self):
        self.client = Client()
        self.math = Subject.objects.create(subject_short="math", subject_name="Математика")
        self.inf = Subject.objects.create(subject_short="inf", subject_name="Информатика")
        self.vpr = Level.objects.create(level="vpr", level_rus="ВПР")
        self.oge = Level.objects.create(level="oge", level_rus="ОГЭ")
        self.shared = TaskList.objects.create(
            subject=self.math, level=self.vpr, task_number=2, task_title="ВПР 7 №2",
            max_score=2, vpr_class=7, part=None,
        )
        student_key = _store("vpr_pack/score-test/14.TXT", b"student-text")
        teacher_key = _store("vpr_pack/score-test/ref14.docx", b"teacher-secret")
        self.advanced = Task.objects.create(
            task=self.shared,
            task_template='<p>Скачайте 14.TXT</p><a href="files/ref14.docx">эталон</a>',
            answer="7",
            author="Цифровой поток",
            max_score=1,
            vpr_class=7,
            vpr_basic=False,
            vpr_advanced=True,
            is_active=True,
            source_key="mcko_adv:ma7u-score-01",
            import_batch="mcko_adv_20261108",
            answer_spec={
                "answer_format": "number",
                "answer_data": {"value": "7"},
                "max_score_numeric": 1,
                "bank": "mcko_adv",
                "level": "углублённый",
                "files": [
                    {"name": "14.TXT", "role": "для ученика"},
                    {"name": "ref14.docx", "role": "для учителя"},
                ],
                "stored_files": [
                    {"name": "14.TXT", "role": "student", "storage": student_key},
                    {"name": "ref14.docx", "role": "teacher", "storage": teacher_key},
                ],
            },
        )
        self.oge_list = TaskList.objects.create(
            subject=self.math, level=self.oge, task_number=1, task_title="ОГЭ №1",
            max_score=3, part=None,
        )
        self.plain = Task.objects.create(
            task=self.oge_list,
            task_template="<p>ОГЭ без своего балла</p>",
            answer="4",
            max_score=1,
            is_active=True,
        )
        self.explicit = Task.objects.create(
            task=self.oge_list,
            task_template="<p>ОГЭ со своим баллом</p>",
            answer="4",
            max_score=4,
            is_active=True,
        )
        self.teacher = User.objects.create_user("teacher-score", password=None, is_staff=True)

    def test_bank_and_check_use_task_score_for_shared_vpr_list(self):
        bank = self.client.get(
            f"/api/vpr/math/task-bank/?grade=7&advanced=1&task_list_id={self.shared.id}&per_page=20"
        )
        self.assertEqual(bank.status_code, 200)
        row = bank.json()["tasks"][0]
        self.assertEqual(row["id"], self.advanced.pk)
        self.assertEqual(row["max_score"], 1)
        self.assertFalse(row["truth_table_enabled"])
        self.assertEqual(row["student_files"], [{
            "name": "14.TXT",
            "url": f"/api/tasks/{self.advanced.pk}/pack-file/?name=14.TXT",
        }])
        blob = json.dumps(row, ensure_ascii=False)
        self.assertNotIn("ref14.docx", blob)
        self.assertNotIn("teacher-secret", blob)
        self.assertNotIn("vpr_pack/", blob)
        self.assertNotIn("stored_files", blob)
        self.assertIn("14.TXT", row["text"])

        checked = self.client.post(
            f"/api/tasks/{self.advanced.pk}/check-answer/",
            data=json.dumps({"answer": "7"}),
            content_type="application/json",
        )
        self.assertEqual(checked.status_code, 200)
        body = checked.json()
        self.assertEqual(body["status"], "correct")
        self.assertEqual(body["points"], 1)
        self.assertEqual(body["max_points"], 1)
        self.assertTrue(body["correct"])

        variant = Variant.objects.create(var_subject=self.math, level=self.vpr, created_by="test")
        VariantContent.objects.create(variant=variant, task=self.advanced, order=1)
        shown = self.client.get(f"/api/vpr/math/variant/{variant.id}/").json()["tasks"][0]
        self.assertEqual(shown["max_score"], 1)
        self.assertEqual(shown["student_files"][0]["name"], "14.TXT")
        self.assertNotIn("ref14.docx", json.dumps(shown["student_files"]))
        scored = load_variant_tasks_for_scoring(variant.id)[0]
        self.assertEqual(scored["max_score"], 1)

    def test_non_vpr_without_own_score_keeps_list_score(self):
        bank = self.client.get("/api/oge/math/task-bank/?per_page=20")
        by_id = {row["id"]: row for row in bank.json()["tasks"]}
        self.assertEqual(by_id[self.plain.pk]["max_score"], 3)
        self.assertEqual(by_id[self.plain.pk]["student_files"], [])
        self.assertEqual(by_id[self.explicit.pk]["max_score"], 4)
        variant = Variant.objects.create(var_subject=self.math, level=self.oge, created_by="test")
        VariantContent.objects.create(variant=variant, task=self.plain, order=1)
        self.assertEqual(load_variant_tasks_for_scoring(variant.id)[0]["max_score"], 3)

    def test_anonymous_can_download_student_file_and_not_teacher_file(self):
        group = TaskGroup.objects.create(subject=self.inf, level=self.vpr)
        TaskGroupMember.objects.create(task_group=group, task=self.advanced, task_number=2)
        grouped = self.client.get(f"/api/vpr/inf/group-instances/?group_id={group.id}&grade=7&advanced=1")
        member = grouped.json()["instances"][0]["tasks"][0]
        self.assertEqual(member["max_score"], 1)
        self.assertEqual(member["student_files"][0]["name"], "14.TXT")
        self.assertNotIn("ref14.docx", json.dumps(member, ensure_ascii=False))

        student = self.client.get(f"/api/tasks/{self.advanced.pk}/pack-file/?name=14.TXT")
        self.assertEqual(student.status_code, 200)
        self.assertEqual(b"".join(student.streaming_content), b"student-text")
        leaked = self.client.get(f"/api/tasks/{self.advanced.pk}/pack-file/?name=ref14.docx")
        self.assertEqual(leaked.status_code, 403)
        self.client.force_login(self.teacher)
        allowed = self.client.get(f"/api/tasks/{self.advanced.pk}/pack-file/?name=ref14.docx")
        self.assertEqual(allowed.status_code, 200)
        self.assertEqual(b"".join(allowed.streaming_content), b"teacher-secret")
        self.client.logout()
        hidden = self.client.get(
            f"/api/vpr/math/task-bank/?grade=7&advanced=1&task_list_id={self.shared.id}&per_page=20"
        ).json()["tasks"][0]
        self.assertNotIn("teacher_files", hidden)
        self.assertNotIn("ref14.docx", json.dumps(hidden, ensure_ascii=False))


class Inf7uAdvancedCommandTests(TestCase):
    def setUp(self):
        self.inf = Subject.objects.create(subject_short="inf", subject_name="Информатика")
        self.math = Subject.objects.create(subject_short="math", subject_name="Математика")
        self.vpr = Level.objects.create(level="vpr", level_rus="ВПР")
        self.inf_list = TaskList.objects.create(
            subject=self.inf, level=self.vpr, task_number=3,
            task_title="7 класс №3, авторский набор, не официальная ВПР",
            max_score=1, vpr_class=7, part=None,
        )
        self.math_list = TaskList.objects.create(
            subject=self.math, level=self.vpr, task_number=3, task_title="ВПР 7 №3",
            max_score=1, vpr_class=7, part=None,
        )
        label = "авторский набор, по материалам МЦКО"
        self.target = Task.objects.create(
            task=self.inf_list,
            task_template="условие",
            answer="1",
            author=label,
            max_score=1,
            vpr_class=7,
            vpr_basic=True,
            vpr_advanced=False,
            is_active=True,
            source_key="mcko_adv:inf7u-u-03-01",
            import_batch="mcko_adv_20261108",
            answer_spec={"level": label, "bank": "mcko_adv"},
        )
        self.math_row = Task.objects.create(
            task=self.math_list,
            task_template="математика",
            answer="2",
            max_score=1,
            vpr_class=7,
            vpr_basic=False,
            vpr_advanced=True,
            is_active=True,
            source_key="mcko_adv:ma7u-u-03-01",
            import_batch="mcko_adv_20261108",
        )
        self.other_batch = Task.objects.create(
            task=self.inf_list,
            task_template="база",
            answer="3",
            max_score=1,
            vpr_class=7,
            vpr_basic=True,
            vpr_advanced=False,
            is_active=True,
            source_key="inf7-b-03-01",
            import_batch="r159-vpr1580-final",
        )
        self.variant = Variant.objects.create(var_subject=self.inf, level=self.vpr, created_by="test")
        self.link = VariantContent.objects.create(variant=self.variant, task=self.target, order=1)

    def _run(self, apply=False):
        out = StringIO()
        args = ["--apply"] if apply else []
        call_command("vpr_set_inf7u_advanced", *args, stdout=out)
        return json.loads(out.getvalue())

    def test_dry_run_then_apply_is_idempotent_and_leaves_ids(self):
        planned = self._run()
        self.target.refresh_from_db()
        self.assertFalse(planned["applied"])
        self.assertEqual(planned["matched"], 1)
        self.assertEqual(planned["changed"], 1)
        self.assertEqual(planned["deleted_tasks"], 0)
        self.assertTrue(self.target.vpr_basic)
        self.assertFalse(self.target.vpr_advanced)

        applied = self._run(apply=True)
        self.target.refresh_from_db()
        self.math_row.refresh_from_db()
        self.other_batch.refresh_from_db()
        self.link.refresh_from_db()
        self.assertTrue(applied["applied"])
        self.assertEqual(applied["changed"], 1)
        self.assertTrue(self.target.vpr_advanced)
        self.assertFalse(self.target.vpr_basic)
        self.assertEqual(self.target.author, "авторский набор, по материалам МЦКО")
        self.assertEqual(self.target.answer_spec["level"], "авторский набор, по материалам МЦКО")
        self.assertNotIn("МЦКО-2026", self.target.task.task_title)
        self.assertEqual(self.target.pk, self.link.task_id)
        self.assertTrue(self.math_row.vpr_advanced)
        self.assertTrue(self.other_batch.vpr_basic)
        self.assertFalse(self.other_batch.vpr_advanced)

        second = self._run(apply=True)
        self.assertEqual(second["changed"], 0)
        self.assertEqual(second["already"], 1)
        self.assertEqual(second["matched"], 1)
        self.assertTrue(Task.objects.filter(pk=self.target.pk).exists())
        self.assertTrue(VariantContent.objects.filter(pk=self.link.pk, task_id=self.target.pk).exists())
