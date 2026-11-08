"""Авторские задания по спецификации МЦКО. Не смешиваются с базовым ВПР."""

import json
import zipfile
from io import BytesIO
from pathlib import Path

from django.contrib.auth.models import User
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import Client, TestCase

from Generator.models import Criteria, Level, Subject, Task, TaskList, Variant, VariantContent
from Generator.vpr_answer_spec import score_vpr_spec

UPLOADS = Path("/home/ubuntu/.cursor/projects/agent-repos-itflux-repo/uploads")
MCKO_PACKS = (
    ("ma7u", "ma7u_mcko_20261108_cebc.zip", 280),
    ("ma8u", "ma8u_mcko_20261108_291b.zip", 300),
    ("ma10u", "ma10u_mcko_20261108_82ff.zip", 240),
    ("inf7u", "inf7u_mcko_20261108_5344.zip", 160),
)
BASE_PACKS = (
    "ma7_vpr_base_20261108_v2_e385.zip",
    "ma8_vpr_base_20261108_v2_e4f7.zip",
    "ma10_vpr_base_20261108_938b.zip",
    "inf7_vpr_base_20261108_1309.zip",
    "inf8_vpr_base_20261108_v2_5e21.zip",
)


def _paths(rows):
    found = [UPLOADS / name for _pack, name, _count in rows]
    if not all(path.is_file() for path in found):
        return None
    return [str(path) for path in found]


def _tiny_zip(item, *, readme="базовый (ВПР-2026) не использовать"):
    blob = BytesIO()
    payload = {"pack": "ma7u", "count": 1, "items": [item], "author": "Цифровой поток"}
    with zipfile.ZipFile(blob, "w") as archive:
        archive.writestr("packs/ma7u/ma7u_bank.json", json.dumps(payload, ensure_ascii=False))
        archive.writestr("packs/ma7u/verify_report.txt", readme)
        archive.writestr("packs/ma7u/README.md", readme)
        archive.writestr("sources/mcko/spec.pdf", b"%PDF-not-imported")
        archive.writestr("packs/ma7u/tools/build.py", b"print('no')\n")
    return blob.getvalue()


class MckoSeparationTests(TestCase):
    def setUp(self):
        self.client = Client()
        self.math = Subject.objects.create(subject_short="math", subject_name="Математика")
        self.inf = Subject.objects.create(subject_short="inf", subject_name="Информатика")
        self.vpr = Level.objects.create(level="vpr", level_rus="ВПР")
        self.vpr_list = TaskList.objects.create(
            subject=self.math, level=self.vpr, task_number=1, task_title="ВПР 7 №1",
            max_score=2, vpr_class=7, part=None,
        )
        Criteria.objects.create(task_number=self.vpr_list, criteria_text="старый критерий ВПР", criteria_score=2)
        self.legacy = Task.objects.create(
            task=self.vpr_list,
            task_template="<p>Заполните таблицу истинности выражения.</p>",
            answer="0001",
            is_active=True,
            vpr_class=8,
            vpr_advanced=True,
            truth_table_enabled=True,
            author="ФИПИ",
        )
        self.teacher = User.objects.create_user("teacher", password="x", is_staff=True)
        self.pupil = User.objects.create_user("pupil", password="x")

    def test_fraction_stays_a_fraction(self):
        spec = {"answer_format": "fraction", "answer_data": {"value": "1/6", "numerator": 1, "denominator": 6}}
        self.assertEqual(score_vpr_spec(spec, "2/12", max_score=1)["status"], "correct")
        self.assertEqual(score_vpr_spec(spec, "0,166", max_score=1)["status"], "incorrect")
        self.assertEqual(score_vpr_spec(spec, "0.166", max_score=1)["status"], "incorrect")

    def test_report_header_does_not_become_vpr(self):
        item = {
            "id": "ma7u-u-01-01",
            "subject": "математика",
            "grade": 7,
            "number": 1,
            "level": "углублённый",
            "level_status": "mcko_spec_official_unconfirmed_year",
            "author": "Цифровой поток",
            "condition": "Найдите \\(1+1\\).<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>",
            "answer": "2",
            "answer_format": "number",
            "answer_data": {"value": "2"},
            "solution": "Сложение.",
            "criteria": [[1, "Дан верный ответ"], [0, "Нет"]],
            "max_score": 1,
            "official_task_difficulty": "Б",
            "specification_source": {
                "document": "образец, год не указан",
                "local": "sources/mcko/spec.pdf",
                "url": "https://mcko.ru/upload/documents/spec.pdf",
                "level": "Б",
            },
            "verification": {"answer_B": "2"},
            "files": None,
        }
        path = Path(self._tmpdir()) / "ma7u.zip"
        path.write_bytes(_tiny_zip(item))
        call_command("vpr_import_pack", str(path), "--apply", "--batch", "mcko-small")
        task = Task.objects.get(source_key="mcko_adv:ma7u-u-01-01")
        self.assertFalse(task.is_active)
        self.assertFalse(task.vpr_basic)
        self.assertFalse(task.vpr_advanced)
        self.assertEqual(task.task.level.level, "mcko")
        self.assertIn("углублённый", task.task.task_title)
        self.assertNotIn("ВПР", task.task.task_title)
        self.assertNotIn("sources/mcko", json.dumps(task.answer_spec, ensure_ascii=False))
        self.assertNotIn("mcko.ru", json.dumps(task.answer_spec, ensure_ascii=False))
        self.assertEqual(task.answer_spec["task_difficulty"], "Б")
        self.assertIn("<svg", task.task_template.lower())
        self.assertEqual(Criteria.objects.get(task_number=self.vpr_list).criteria_text, "старый критерий ВПР")
        self.legacy.refresh_from_db()
        self.assertEqual(self.legacy.answer, "0001")
        self.assertIsNone(self.legacy.import_batch)
        self.assertFalse(Task.objects.filter(source_key="ma7u-u-01-01").exists())

        task.is_active = True
        task.status = Task.Status.READY
        task.save(update_fields=["is_active", "status"])
        variant = Variant.objects.create(var_subject=self.math, level=task.task.level, created_by="test")
        VariantContent.objects.create(variant=variant, task=task, order=1)
        anon = self.client.get(f"/api/mcko/math/variant/{variant.id}/?role=student").json()["tasks"][0]
        blob = json.dumps(anon, ensure_ascii=False)
        self.assertNotIn("Сложение", blob)
        self.assertNotIn("verification", blob)
        self.assertNotIn("sources/mcko", blob)
        self.assertEqual(anon["answer"], "")
        denied = self.client.get(f"/api/mcko/math/criteria/?task_list_id={task.task_id}")
        self.assertEqual(denied.json()["criteria"], [])
        self.assertTrue(denied.json()["teacher_only"])
        self.client.login(username="teacher", password="x")
        allowed = self.client.get(f"/api/mcko/math/criteria/?task_list_id={task.task_id}")
        self.assertIn("верный ответ", json.dumps(allowed.json(), ensure_ascii=False).lower())

        with self.assertRaises(CommandError):
            call_command("vpr_import_pack", "--rollback-batch", "mcko-small")
        self.assertTrue(Task.objects.filter(pk=task.pk).exists())
        VariantContent.objects.filter(task=task).delete()
        call_command("vpr_import_pack", "--deactivate-batch", "mcko-small")
        task.refresh_from_db()
        self.assertFalse(task.is_active)
        self.assertTrue(Task.objects.filter(pk=task.pk).exists())

    def _tmpdir(self):
        import tempfile
        if not hasattr(self, "_root"):
            self._root = tempfile.mkdtemp()
        return self._root


class MckoFullPackTests(TestCase):
    def setUp(self):
        self.paths = _paths(MCKO_PACKS)
        if self.paths is None:
            self.skipTest("архивы 980 недоступны")
        Subject.objects.create(subject_short="math", subject_name="Математика")
        Subject.objects.create(subject_short="inf", subject_name="Информатика")
        self.vpr = Level.objects.create(level="vpr", level_rus="ВПР")
        self.vpr_list = TaskList.objects.create(
            subject=Subject.objects.get(subject_short="math"),
            level=self.vpr,
            task_number=14,
            task_title="ВПР 8 №14",
            max_score=2,
            vpr_class=8,
            part=None,
        )
        Criteria.objects.create(task_number=self.vpr_list, criteria_text="критерий базового ВПР", criteria_score=2)
        self.legacy = Task.objects.create(
            task=self.vpr_list,
            task_template="чужая таблица",
            answer="0001",
            is_active=True,
            author="ФИПИ",
        )

    def test_apply_repeat_activate_deactivate_without_mixing(self):
        from io import StringIO

        call_command("vpr_import_pack", *self.paths, "--apply", "--batch", "mcko_adv_20261108", stdout=StringIO())
        imported = Task.objects.filter(import_batch="mcko_adv_20261108")
        self.assertEqual(imported.count(), 980)
        self.assertEqual(set(imported.values_list("is_active", flat=True)), {False})
        self.assertFalse(imported.filter(vpr_advanced=True).exists())
        self.assertFalse(imported.filter(vpr_basic=True).exists())
        self.assertFalse(imported.exclude(source_key__startswith="mcko_adv:").exists())
        self.assertFalse(imported.filter(source_key__startswith="ma7-b-").exists())
        self.assertEqual(imported.filter(task__level__level="vpr").count(), 0)
        self.assertEqual(imported.filter(task__level__level="mcko").count(), 980)
        fraction = imported.get(source_key="mcko_adv:ma8u-u-14-01")
        self.assertEqual(fraction.answer_spec["answer_format"], "fraction")
        self.assertIn("/", fraction.answer)
        self.assertNotIn("sources/mcko", json.dumps(fraction.answer_spec))
        inf = imported.filter(source_key__startswith="mcko_adv:inf7u-").first()
        self.assertIn("авторский набор", inf.task.task_title)
        self.assertNotIn("углублённый", inf.task.task_title)
        math = imported.filter(source_key__startswith="mcko_adv:ma7u-").first()
        self.assertIn("углублённый", math.task.task_title)
        self.assertEqual(
            Criteria.objects.get(task_number=self.vpr_list).criteria_text,
            "критерий базового ВПР",
        )
        self.assertFalse(imported.filter(task_id=self.vpr_list.id).exists())
        ids = set(imported.values_list("pk", flat=True))
        call_command("vpr_import_pack", *self.paths, "--apply", "--batch", "mcko_adv_20261108", stdout=StringIO())
        again = Task.objects.filter(import_batch="mcko_adv_20261108")
        self.assertEqual(set(again.values_list("pk", flat=True)), ids)
        base_paths = [UPLOADS / name for name in BASE_PACKS]
        if all(path.is_file() for path in base_paths):
            call_command(
                "vpr_import_pack", *[str(path) for path in base_paths],
                "--apply", "--batch", "verified-1580", stdout=StringIO(),
            )
            self.assertEqual(Task.objects.filter(import_batch="verified-1580").count(), 1580)
            self.assertEqual(Task.objects.filter(import_batch="mcko_adv_20261108").count(), 980)
            shared = set(again.values_list("task_id", flat=True)) & set(
                Task.objects.filter(import_batch="verified-1580").values_list("task_id", flat=True)
            )
            self.assertEqual(shared, set())
        self.legacy.refresh_from_db()
        self.assertEqual(self.legacy.answer, "0001")
        self.assertIsNone(self.legacy.import_batch)
        call_command("vpr_import_pack", "--activate-batch", "mcko_adv_20261108", stdout=StringIO())
        self.assertEqual(again.filter(is_active=True).count(), 980)
        self.legacy.refresh_from_db()
        self.assertTrue(self.legacy.is_active)
        with self.assertRaises(CommandError):
            call_command("vpr_import_pack", "--rollback-batch", "mcko_adv_20261108")
        self.assertEqual(again.count(), 980)
        call_command("vpr_import_pack", "--deactivate-batch", "mcko_adv_20261108", stdout=StringIO())
        self.assertEqual(again.filter(is_active=False).count(), 980)
        self.assertEqual(set(again.values_list("pk", flat=True)), ids)
