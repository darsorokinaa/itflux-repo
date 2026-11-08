"""Хранение и проверка авторских ВПР. Пакеты в production не пишутся."""

import io
import json
import zipfile
from pathlib import Path

from django.contrib.auth.models import User
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import Client, TestCase

from Generator.models import Criteria, Level, Subject, Task, TaskList, Variant, VariantContent
from Generator.variant_scoring import score_variant_attempt
from Generator.vpr_answer_spec import (
    APPLY_READY_PACKS,
    numeric_max_score,
    score_vpr_spec,
    storage_from_item,
    storage_losses,
)
from Generator.vpr_pack_files import file_role


def _item(**extra):
    base = {
        "id": "ma7-b-01-01",
        "subject": "математика",
        "grade": 7,
        "number": 1,
        "author": "Цифровой поток",
        "condition": "Найдите \\(1+1\\).",
        "answer": "0,9375",
        "answer_format": "number",
        "answer_data": {"value": "0,9375"},
        "solution": "Сложение.",
        "criteria": [[1, "Дан верный ответ"], [0, "Нет"]],
        "max_score": 1,
        "svg": None,
        "svg_html": None,
        "solution_image": None,
        "files": None,
    }
    base.update(extra)
    return base


def _zip(items, *, pack="ma7", verify=b"", extra_files=None):
    blob = io.BytesIO()
    payload = {"pack": pack, "count": len(items), "items": items, "author": "Цифровой поток"}
    with zipfile.ZipFile(blob, "w") as archive:
        archive.writestr(f"packs/{pack}/{pack}_bank.json", json.dumps(payload, ensure_ascii=False))
        if verify:
            archive.writestr(f"packs/{pack}/verify_report.txt", verify)
        for name, data in (extra_files or {}).items():
            archive.writestr(name, data)
    return blob.getvalue()


class StorageAndScoreTests(TestCase):
    def test_fraction_root_and_decimal_comma_stay_exact(self):
        graded = score_vpr_spec(
            {"answer_format": "number_list", "answer_data": {"roots": ["8/3", "8"], "order": "ascending"}},
            "8/3; 8",
            max_score=1,
        )
        self.assertEqual(graded["status"], "correct")
        wrong = score_vpr_spec(
            {"answer_format": "number_or_fraction", "answer_data": {"value": "8/3"}},
            "2,666",
            max_score=1,
        )
        self.assertEqual(wrong["status"], "incorrect")
        radical = score_vpr_spec(
            {"answer_format": "number_or_radical", "answer_data": {"value": "4√7 - 2"}},
            "4√7-2",
            max_score=1,
        )
        self.assertEqual(radical["status"], "correct")
        comma = score_vpr_spec(
            {"answer_format": "number", "answer_data": {"value": "0,9375"}},
            "0.9375",
            max_score=1,
        )
        self.assertEqual(comma["status"], "correct")

    def test_pairs_require_both_and_set_ignores_order(self):
        spec = {"answer_format": "number_pairs", "answer_data": {"pairs": [["-7", "1"], ["-1", "7"]], "all_required": True}}
        one = score_vpr_spec(spec, "-7 и 1", max_score=1)
        both = score_vpr_spec(spec, "-1 и 7 или -7 и 1", max_score=1)
        self.assertEqual(one["status"], "incorrect")
        self.assertEqual(both["status"], "correct")
        choices = score_vpr_spec(
            {"answer_format": "multiple_choice_set", "answer_data": {"choices": ["2", "4"], "order": "any"}},
            "4, 2",
            max_score=1,
        )
        self.assertEqual(choices["status"], "correct")

    def test_two_parts_sum_and_interval_tolerance(self):
        spec = {
            "answer_format": "two_parts: number; number_or_list",
            "answer_data": {
                "2.1": {"value": "1661", "score": 1},
                "2.2": {"value": ["436", "138"], "score": 1},
            },
        }
        partial = score_vpr_spec(spec, "1) 1661; 2) 100", max_score=2)
        self.assertEqual(partial["points"], 1)
        self.assertEqual(partial["status"], "partial")
        interval = {
            "answer_format": "two_parts: list; interval",
            "answer_data": {
                "14.1": {"years": ["2015", "2016"], "all_required": True, "score": 1},
                "14.2": {
                    "interval": {"lo": "110", "hi": "150", "lo_included": True, "hi_included": True},
                    "exact_reading": "130",
                    "tolerance": "20",
                    "score": 1,
                },
            },
        }
        inside = score_vpr_spec(interval, "1) 2016, 2015; 2) 110", max_score=2)
        edge = score_vpr_spec(interval, "1) 2015; 2) 130", max_score=2)
        self.assertEqual(inside["points"], 2)
        self.assertEqual(edge["points"], 1)
        self.assertNotEqual(edge["points"], 2)

    def test_graphic_and_justification_stay_pending(self):
        graphic = score_vpr_spec(
            {"answer_format": "mark_point_on_line", "answer_data": {"accept": ["7", "7,5"], "x": [36, 5]}},
            "7,2",
            max_score=1,
        )
        self.assertEqual(graphic["status"], "pending_review")
        self.assertEqual(graphic["points"], 0)
        justified = score_vpr_spec(
            {"answer_format": "coordinate_pair", "answer_data": {"x": "-5", "y": "4", "text": "(-5; 4)"}},
            "(-5; 4)",
            max_score=2,
        )
        self.assertEqual(justified["status"], "pending_review")
        program = score_vpr_spec(
            {"answer_format": "any_of_programs", "answer_data": {"accepted": ["21212"]}},
            "21212",
            max_score=1,
        )
        self.assertEqual(program["status"], "pending_review")
        document = score_vpr_spec(
            {"answer_format": "document_file", "answer_data": {"checker": "tools/check14.py", "reference_score": 3}},
            "файл",
            max_score=3,
        )
        self.assertEqual(document["status"], "pending_review")
        self.assertNotEqual(document["points"], 3)

    def test_program_max_score_string_and_inline_svg_are_lossless(self):
        item = _item(
            id="inf8-b-12-01",
            subject="информатика",
            grade=8,
            number=12,
            answer_format="program_file",
            answer="эталон",
            answer_data={"12.1": {"max_score": 2}, "12.2": {"max_score": 4}, "checker": "tools/kumir_robot.py"},
            max_score="2 (12.1) / 4 (12.2), засчитывается бо́льшая",
            criteria=[[4, "12.2"], [2, "12.1"], [0, "нет"]],
            svg=None,
            condition='<p>Поле</p><svg xmlns="http://www.w3.org/2000/svg"></svg>',
            files=[{"name": "field.json", "path": "files/inf8-b-12-01/field.json", "role": "для учителя"}],
        )
        stored = storage_from_item(item)
        self.assertEqual(storage_losses(item, stored), [])
        self.assertEqual(stored["max_score"], 4)
        self.assertEqual(stored["answer_spec"]["max_score"], item["max_score"])
        self.assertIn("<svg", stored["task_template"])
        self.assertEqual(numeric_max_score(item), 4)
        self.assertEqual(file_role(item["files"][0]), "teacher")

    def test_old_task_without_spec_still_matches_the_string(self):
        summary = score_variant_attempt(
            tasks=[{"id": 1, "number": 1, "max_score": 1, "answer": "15", "part": 1}],
            answers={1: "15"},
            level="ege",
            subject="math",
        )
        self.assertEqual(summary["correct_count"], 1)
        self.assertEqual(summary["earned_points"], 1)

    def test_ready_set_is_the_five_basic_packs(self):
        self.assertEqual(APPLY_READY_PACKS, {"ma7", "ma8", "ma10", "inf7", "inf8"})


class ImportAndDownloadTests(TestCase):
    def setUp(self):
        self.client = Client()
        self.subject = Subject.objects.create(subject_short="math", subject_name="Математика")
        Subject.objects.create(subject_short="inf", subject_name="Информатика")
        self.level = Level.objects.create(level="vpr", level_rus="ВПР")
        self.teacher = User.objects.create_user("teacher", password="x", is_staff=True)
        self.pupil = User.objects.create_user("pupil", password="x")

    def _write(self, payload, name):
        path = Path(self._tmpdir()) / name
        path.write_bytes(payload)
        return str(path)

    def _tmpdir(self):
        import tempfile
        if not hasattr(self, "_root"):
            self._root = tempfile.mkdtemp()
        return self._root

    def test_dry_run_does_not_write_and_apply_is_inactive(self):
        item = _item(files=[{"name": "catalog.txt", "path": "files/ma7-b-01-01/catalog.txt", "role": "для ученика"}])
        secret = _item(
            id="inf7-b-14-01",
            subject="информатика",
            grade=7,
            number=14,
            answer_format="document_file",
            answer="эталон",
            answer_data={"checker": "tools/check14.py", "reference": "ref14.docx"},
            max_score=3,
            criteria=[[3, "верно"], [0, "нет"]],
            files=[
                {"name": "14.TXT", "path": "files/inf7-b-14-01/14.TXT", "role": "для ученика"},
                {"name": "ref14.docx", "path": "files/inf7-b-14-01/ref14.docx", "role": "для учителя"},
            ],
        )
        # Два архива: математика и информатика, скрипт в архиве не исполняется.
        script = "open('/tmp/vpr-import-should-not-run','w').write('x')\n"
        math_zip = self._write(_zip([item], extra_files={"files/ma7-b-01-01/catalog.txt": b"stim"}), "ma7.zip")
        inf_zip = self._write(
            _zip(
                [secret],
                pack="inf7",
                extra_files={
                    "files/inf7-b-14-01/14.TXT": b"text",
                    "files/inf7-b-14-01/ref14.docx": b"secret-key",
                    "packs/inf7/tools/check14.py": script.encode(),
                },
            ),
            "inf7.zip",
        )
        call_command("vpr_import_pack", math_zip, inf_zip)
        self.assertEqual(Task.objects.count(), 0)
        call_command("vpr_import_pack", math_zip, inf_zip, "--apply", "--batch", "test-batch")
        self.assertFalse(Path("/tmp/vpr-import-should-not-run").exists())
        rows = list(Task.objects.order_by("source_key"))
        self.assertEqual(len(rows), 2)
        self.assertTrue(all(not row.is_active for row in rows))
        self.assertTrue(all(row.vpr_advanced is False and row.truth_table_enabled is False for row in rows))
        doc = Task.objects.get(source_key="inf7-b-14-01")
        self.assertEqual(doc.max_score, 3)
        self.assertEqual(doc.answer_spec["stored_files"][1]["role"], "teacher")
        self.assertNotIn("/media/", doc.answer_spec["stored_files"][1]["storage"])
        self.assertTrue(Criteria.objects.filter(task_number=doc.task, criteria_score=3).exists())
        self.assertFalse(Criteria.objects.filter(task_number__vpr_class__isnull=True, task_number__task_number=14).exists())

        self.client.login(username="pupil", password="x")
        denied = self.client.get("/api/tasks/%s/pack-file/?name=ref14.docx" % doc.pk)
        self.assertEqual(denied.status_code, 404)
        self.client.logout()
        anon = self.client.get("/api/tasks/%s/pack-file/?name=ref14.docx" % doc.pk)
        self.assertEqual(anon.status_code, 404)
        self.client.login(username="teacher", password="x")
        allowed = self.client.get("/api/tasks/%s/pack-file/?name=ref14.docx" % doc.pk)
        self.assertEqual(allowed.status_code, 200)
        self.assertIn("attachment", allowed["Content-Disposition"])
        self.assertNotIn("/media/", allowed.get("Content-Location", ""))
        body = b"".join(allowed.streaming_content)
        self.assertEqual(body, b"secret-key")

        doc.is_active = True
        doc.save(update_fields=["is_active"])
        self.client.logout()
        student_file = self.client.get("/api/tasks/%s/pack-file/?name=14.TXT" % doc.pk)
        self.assertEqual(student_file.status_code, 200)
        leaked = self.client.get("/api/tasks/%s/pack-file/?name=ref14.docx" % doc.pk)
        self.assertEqual(leaked.status_code, 403)

    def test_obsolete_inf8_v1_is_not_apply_ready(self):
        item = _item(id="inf8-b-12-01", subject="информатика", grade=8, number=12, answer_format="program_file", max_score=4)
        path = self._write(
            _zip(
                [item],
                pack="inf8",
                verify="[OK] «рисунок» в условии ⇒ рисунок есть — ['inf8-b-12-01']\n",
            ),
            "inf8-v1.zip",
        )
        with self.assertRaises(CommandError):
            call_command("vpr_import_pack", path, "--apply", "--batch", "nope")
        self.assertEqual(Task.objects.count(), 0)

    def test_criteria_api_uses_the_requested_list_only(self):
        seven = TaskList.objects.create(
            subject=self.subject, level=self.level, task_number=2, task_title="7", max_score=2, vpr_class=7, part=None,
        )
        eight = TaskList.objects.create(
            subject=self.subject, level=self.level, task_number=2, task_title="8", max_score=1, vpr_class=8, part=None,
        )
        Criteria.objects.create(task_number=seven, criteria_text="две части", criteria_score=1)
        Criteria.objects.create(task_number=eight, criteria_text="один балл", criteria_score=1)
        response = self.client.get(f"/api/vpr/math/criteria/?task_list_id={seven.id}&task_number=2")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["max_score"], 2)
        texts = " ".join(row["criteria_text"] for row in payload["criteria"])
        self.assertIn("две части", texts)
        self.assertNotIn("один балл", texts)

    def test_variant_hides_teacher_files_and_shows_solution_to_staff(self):
        task_list = TaskList.objects.create(
            subject=self.subject, level=self.level, task_number=6, task_title="рисунок", max_score=1, vpr_class=7, part=None,
        )
        task = Task.objects.create(
            task=task_list,
            task_template='<svg xmlns="http://www.w3.org/2000/svg"></svg><a href="files/ref14.docx">x</a>',
            answer="точка",
            solution="эталон рисунка",
            author="Цифровой поток",
            max_score=1,
            vpr_class=7,
            vpr_basic=True,
            is_active=True,
            answer_spec={
                "answer_format": "mark_point_on_line",
                "answer_data": {"accept": ["7", "7,5"]},
                "files": [{"name": "ref14.docx", "role": "для учителя"}],
                "max_score": 1,
            },
        )
        variant = Variant.objects.create(var_subject=self.subject, level=self.level, created_by="test")
        VariantContent.objects.create(variant=variant, task=task, order=1)
        anon = self.client.get(f"/api/vpr/math/variant/{variant.id}/?role=student")
        self.assertEqual(anon.status_code, 200)
        shown = anon.json()["tasks"][0]
        self.assertNotIn("ref14.docx", shown["text"])
        self.assertEqual(shown["answer"], "")
        self.assertEqual(shown["solution"], "")
        self.assertNotIn("teacher_files", shown)
        self.assertEqual(shown["answer_check"]["mode"], "manual")
        from Cabinet.models import Profile

        profile = Profile.objects.get(user=self.teacher)
        profile.role = Profile.Role.TEACHER
        profile.save(update_fields=["role"])
        self.client.login(username="teacher", password="x")
        staff = self.client.get(f"/api/vpr/math/variant/{variant.id}/")
        body = staff.json()["tasks"][0]
        self.assertIn("эталон", body["solution"])
        self.assertEqual(body["teacher_files"][0]["name"], "ref14.docx")
        self.assertNotIn("storage", json.dumps(body["teacher_files"]))
