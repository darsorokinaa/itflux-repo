from datetime import date, datetime, timedelta
from io import BytesIO
from unittest.mock import patch

from django.contrib.auth.models import User
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from openpyxl import Workbook, load_workbook
from openpyxl.utils import get_column_letter
from openpyxl.utils.datetime import to_excel
from rest_framework.exceptions import ValidationError as DRFValidationError
from rest_framework.test import APIClient

from django.utils import timezone

from Cabinet.choices import PlanItemStatus, PlanStatus
from Cabinet.journal_models import LessonJournal
from Cabinet.models import Homework, HomeworkSubmission, LessonPlan, LessonPlanItem, Profile, ScheduleEvent, Student
from Cabinet.plan_dates import generate_plan_dates
from Cabinet.plan_excel_schedule import MODE_WEEKDAYS, MODE_WEEKLY, formula_prev_anchor, formula_schedule, sequence_plan
from Cabinet.plan_excel import (
    COLUMNS,
    REQUIRED_HEADERS,
    SHEET_INSTRUCTIONS,
    SHEET_LESSONS,
    SHEET_SETTINGS,
    TEMPLATE_VERSION,
    PlanExcelError,
    build_plan_workbook,
    excel_safe_text,
    parse_excel_date,
    parse_plan_workbook,
    read_uploaded_bytes,
)
from Cabinet.serializers import LessonPlanItemEditorSerializer


def _col(key):
    return next(index for index, col in enumerate(COLUMNS, start=1) if col["key"] == key)


def _patch_workbook(content, mutator):
    wb = load_workbook(BytesIO(content))
    mutator(wb)
    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()


class PlanExcelHelperTests(TestCase):
    def test_parses_calendar_dates_without_timezone_shift(self):
        self.assertEqual(parse_excel_date("11.09.2026")[0], date(2026, 9, 11))
        self.assertEqual(parse_excel_date("2026-09-11")[0], date(2026, 9, 11))
        self.assertEqual(parse_excel_date(date(2026, 9, 11))[0], date(2026, 9, 11))
        self.assertIsNone(parse_excel_date("31.02.2026")[0])
        self.assertIsNotNone(parse_excel_date("31.02.2026")[1])

    def test_formula_injection_is_prefixed_on_export(self):
        self.assertEqual(excel_safe_text("=1+1"), "'=1+1")
        self.assertEqual(excel_safe_text("Системы счисления"), "Системы счисления")

    def test_template_is_editable_without_password(self):
        content = build_plan_workbook(
            {"title": "Информатика", "subject": "inf", "direction": "ege", "grade": "10–11", "start_date": "2026-09-11"},
            [],
        )
        wb = load_workbook(BytesIO(content))
        self.assertEqual(wb.sheetnames[0], SHEET_INSTRUCTIONS)
        self.assertEqual(wb.sheetnames[1], SHEET_LESSONS)
        self.assertIn(SHEET_SETTINGS, wb.sheetnames)
        self.assertEqual(wb["_meta"]["B1"].value, TEMPLATE_VERSION)
        headers = [cell.value for cell in wb[SHEET_LESSONS][1]]
        for name in REQUIRED_HEADERS:
            self.assertIn(name, headers)
        self.assertIn("Дата по расписанию", headers)
        self.assertIn("Дата вручную", headers)
        ws = wb[SHEET_LESSONS]
        self.assertEqual(ws.freeze_panes, "A2")
        self.assertTrue(ws.tables)
        self.assertFalse(ws.protection.sheet)
        id_col = next(index for index, col in enumerate(COLUMNS, start=1) if col["key"] == "item_id")
        self.assertTrue(ws.column_dimensions[get_column_letter(id_col)].hidden)
        self.assertTrue(str(ws.cell(2, _col("schedule_date")).value).startswith("="))
        self.assertTrue(str(ws.cell(3, _col("schedule_date")).value).startswith("="))
        settings = wb[SHEET_SETTINGS]
        self.assertTrue(settings.protection.sheet)
        self.assertIn(settings.protection.password, (None, ""))
        self.assertEqual(settings["A1"].value, "Настройки расписания")
        self.assertEqual(settings["A4"].value, "Предмет")
        self.assertFalse(settings["B4"].protection.locked)
        self.assertEqual(settings["A14"].value, "Понедельник")
        self.assertFalse(settings["B14"].protection.locked)
        instruction = str(wb[SHEET_INSTRUCTIONS]["A1"].value)
        self.assertIn("План занятий", instruction)
        joined = "\n".join(str(cell.value or "") for row in wb[SHEET_INSTRUCTIONS].iter_rows(max_col=5) for cell in row)
        self.assertIn("Назначение файла", joined)
        self.assertIn("Учебные дни", joined)
        self.assertIn("Импорт обратно", joined)
        self.assertIn("отмен", joined.lower())


class PlanExcelApiTests(TestCase):
    def setUp(self):
        self.teacher = User.objects.create_user(username="excel_teacher", password="pass")
        self.teacher.profile.role = Profile.Role.TEACHER
        self.teacher.profile.save(update_fields=["role"])
        self.plan = LessonPlan.objects.create(
            teacher=self.teacher,
            title="Информатика",
            subject="inf",
            direction="ege",
            status=PlanStatus.DRAFT,
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.teacher)

    def _xlsx(self, content, name="plan.xlsx"):
        return SimpleUploadedFile(
            name,
            content,
            content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )

    def test_download_template(self):
        resp = self.client.get("/api/cabinet/lesson-plans/excel-template/?subject=inf&direction=ege")
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertIn(
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            resp["Content-Type"],
        )
        wb = load_workbook(BytesIO(resp.content))
        self.assertEqual(wb.sheetnames[0], "Инструкция")
        self.assertIn("План занятий", wb.sheetnames)

    def test_import_ten_lessons_roundtrip(self):
        items = [
            {
                "title": f"Урок {n}",
                "topic": "Системы счисления" if n % 2 else "Кодирование информации",
                "subtopic": "Перевод чисел",
                "task_number": "5",
                "goal": "Повторить тему",
                "description": "Разбор задач",
                "homework_description": "№5",
                "teacher_comment": "Кириллица",
                "scheduled_date": date(2026, 9, 11) if n == 1 else None,
            }
            for n in range(1, 11)
        ]
        content = build_plan_workbook(
            {"start_date": "2026-09-11", "interval": "twice_weekly", "subject": "inf"},
            items,
        )
        resp = self.client.post(
            f"/api/cabinet/lesson-plans/{self.plan.pk}/import-excel/",
            {"file": self._xlsx(content), "mode": "replace_all", "start_date": "2026-09-11", "interval": "twice_weekly"},
            format="multipart",
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(self.plan.items.count(), 10)
        first = self.plan.items.order_by("order").first()
        self.assertEqual(first.scheduled_date, date(2026, 9, 11))
        self.assertEqual(first.topic, "Системы счисления")

    def test_manual_date_is_kept(self):
        items = [
            {"title": "A", "topic": "Тема", "scheduled_date": None},
            {"title": "B", "topic": "Тема", "scheduled_date": date(2026, 9, 18)},
            {"title": "C", "topic": "Тема", "scheduled_date": None},
        ]
        content = build_plan_workbook({"start_date": "2026-09-11", "interval": "weekly"}, items)
        resp = self.client.post(
            f"/api/cabinet/lesson-plans/{self.plan.pk}/import-excel/",
            {"file": self._xlsx(content), "mode": "replace_all", "start_date": "2026-09-11", "interval": "weekly"},
            format="multipart",
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        dates = list(self.plan.items.order_by("order").values_list("scheduled_date", flat=True))
        self.assertEqual(dates[0], date(2026, 9, 11))
        self.assertEqual(dates[1], date(2026, 9, 18))
        self.assertEqual(dates[2], date(2026, 9, 25))

    def test_missing_header_is_user_error(self):
        content = build_plan_workbook({}, [{"title": "A", "topic": "Тема"}])
        wb = load_workbook(BytesIO(content))
        ws = wb[SHEET_LESSONS]
        for cell in ws[1]:
            if cell.value == "Тема":
                cell.value = "Темы"
                break
        buf = BytesIO()
        wb.save(buf)
        resp = self.client.post(
            "/api/cabinet/lesson-plans/excel-preview/",
            {"file": self._xlsx(buf.getvalue())},
            format="multipart",
        )
        self.assertEqual(resp.status_code, 400)
        self.assertIn("Тема", resp.json()["detail"])

    def test_legacy_date_header_still_works(self):
        content = build_plan_workbook({}, [{"title": "A", "topic": "Тема", "scheduled_date": date(2026, 9, 11)}])
        content = _patch_workbook(content, lambda wb: setattr(wb[SHEET_LESSONS].cell(1, _col("scheduled_date")), "value", "Дата занятия"))
        preview = parse_plan_workbook(content, mode="replace_all")
        self.assertTrue(preview["can_import"])
        self.assertEqual(preview["rows"][0]["item"]["scheduled_date"], "2026-09-11")

    def test_extra_column_is_ignored(self):
        content = build_plan_workbook({}, [{"title": "A", "topic": "Алгебра логики"}])
        wb = load_workbook(BytesIO(content))
        ws = wb[SHEET_LESSONS]
        ws.cell(1, 20, "Мои заметки")
        ws.cell(2, 20, "secret")
        buf = BytesIO()
        wb.save(buf)
        preview = parse_plan_workbook(buf.getvalue())
        self.assertTrue(preview["can_import"])
        warning_text = " ".join(preview["warnings"])
        self.assertIn("Мои заметки", warning_text)
        self.assertNotIn("Опора даты", warning_text)

    def test_empty_rows_are_skipped(self):
        items = [
            {"title": "A", "topic": "Тема"},
            {"title": "", "topic": ""},
            {"title": "B", "topic": "Тема"},
        ]
        content = build_plan_workbook({}, items)
        preview = parse_plan_workbook(content)
        self.assertEqual(preview["summary"]["found"], 2)
        self.assertEqual(preview["summary"]["skip"], 1)
        self.assertTrue(all(row["status"] != "skip" for row in preview["rows"]))

    def test_trailing_blank_template_rows_are_not_skipped_warnings(self):
        content = build_plan_workbook({}, [{"title": "A", "topic": "Системы счисления"}])
        preview = parse_plan_workbook(content)
        self.assertEqual(preview["summary"]["found"], 1)
        self.assertEqual(preview["summary"]["skip"], 0)
        self.assertEqual(preview["rows"][0]["status"], "ready")

    def test_task_number_keeps_range_text(self):
        content = build_plan_workbook({}, [{
            "title": "A",
            "topic": "Тема",
            "task_number": "1-5",
        }])
        wb = load_workbook(BytesIO(content))
        ws = wb[SHEET_LESSONS]
        task_col = next(index for index, col in enumerate(COLUMNS, start=1) if col["key"] == "task_number")
        self.assertEqual(ws.cell(2, task_col).number_format, "@")
        self.assertEqual(ws.cell(2, task_col).value, "1-5")
        preview = parse_plan_workbook(content)
        self.assertEqual(preview["rows"][0]["item"]["task_number"], "1-5")

    def test_title_or_topic_is_enough(self):
        content = build_plan_workbook({}, [{"title": "", "topic": "Кодирование текстовой информации"}])
        preview = parse_plan_workbook(content)
        self.assertTrue(preview["can_import"])
        self.assertEqual(preview["rows"][0]["item"]["title"], "Кодирование текстовой информации")


class PlanExcelAcceptanceTests(TestCase):
    def setUp(self):
        self.teacher = User.objects.create_user(username="excel_accept", password="pass")
        self.teacher.profile.role = Profile.Role.TEACHER
        self.teacher.profile.save(update_fields=["role"])
        self.other = User.objects.create_user(username="excel_stranger", password="pass")
        self.other.profile.role = Profile.Role.TEACHER
        self.other.profile.save(update_fields=["role"])
        self.plan = LessonPlan.objects.create(
            teacher=self.teacher,
            title="Информатика",
            subject="inf",
            direction="ege",
            status=PlanStatus.DRAFT,
        )
        self.other_plan = LessonPlan.objects.create(
            teacher=self.other,
            title="Чужой план",
            subject="inf",
            direction="ege",
            status=PlanStatus.DRAFT,
        )
        self.own_other_plan = LessonPlan.objects.create(
            teacher=self.teacher,
            title="Другой свой план",
            subject="inf",
            direction="ege",
            status=PlanStatus.DRAFT,
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.teacher)

    def _xlsx(self, content, name="plan.xlsx"):
        return SimpleUploadedFile(
            name,
            content,
            content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )

    def _import(self, content, *, mode="replace_all", start_date="2026-09-11", interval="weekly", plan=None):
        plan = plan or self.plan
        payload = {"file": self._xlsx(content), "mode": mode}
        if start_date:
            payload["start_date"] = start_date
        if interval:
            payload["interval"] = interval
        return self.client.post(
            f"/api/cabinet/lesson-plans/{plan.pk}/import-excel/",
            payload,
            format="multipart",
        )

    def _preview(self, content, *, plan=None, mode="replace_all", start_date="2026-09-11", interval="weekly"):
        payload = {"file": self._xlsx(content), "mode": mode}
        if plan is not None:
            payload["plan_id"] = plan.pk
        if start_date:
            payload["start_date"] = start_date
        if interval:
            payload["interval"] = interval
        return self.client.post("/api/cabinet/lesson-plans/excel-preview/", payload, format="multipart")

    def _reload(self, plan=None):
        plan = plan or self.plan
        return list(plan.items.order_by("order", "id").values("id", "title", "topic", "scheduled_date", "order"))

    def test_excel_date_and_text_date_stay_on_calendar_day(self):
        self.assertEqual(parse_excel_date("11.09.2026")[0], date(2026, 9, 11))
        self.assertEqual(parse_excel_date(date(2026, 9, 11))[0], date(2026, 9, 11))
        self.assertEqual(parse_excel_date(datetime(2026, 9, 11, 0, 0, 0))[0], date(2026, 9, 11))
        self.assertEqual(parse_excel_date(to_excel(date(2026, 9, 11)))[0], date(2026, 9, 11))

        content = build_plan_workbook({}, [{"title": "Дата", "topic": "Тема"}])
        content = _patch_workbook(content, lambda wb: wb[SHEET_LESSONS].cell(
            2, _col("scheduled_date"), datetime(2026, 9, 11, 0, 0, 0)
        ))
        resp = self._import(content, mode="replace_all")
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(self.plan.items.get().scheduled_date, date(2026, 9, 11))

    def test_replace_all_twenty_with_eight_keeps_excel_order(self):
        for n in range(1, 21):
            LessonPlanItem.objects.create(plan=self.plan, order=n, title=f"Старый {n}", topic="Тема")
        titles = [f"Новый {n}" for n in range(1, 9)]
        content = build_plan_workbook({}, [{"title": title, "topic": "Тема"} for title in titles])
        preview = self._preview(content, plan=self.plan, mode="replace_all").json()
        self.assertTrue(preview["can_import"])
        self.assertEqual(preview["summary"]["current_count"], 20)
        self.assertEqual(preview["summary"]["after_count"], 8)
        resp = self._import(content, mode="replace_all")
        self.assertEqual(resp.status_code, 200, resp.content)
        actual = list(self.plan.items.order_by("order").values_list("title", flat=True))
        self.assertEqual(actual, titles)
        self.assertEqual(self._reload(), self._reload())

    def test_replace_all_rolls_back_on_row_error(self):
        for n in range(1, 21):
            LessonPlanItem.objects.create(plan=self.plan, order=n, title=f"Старый {n}", topic="Тема")
        items = [{"title": f"Новый {n}", "topic": "Тема"} for n in range(1, 9)]
        content = build_plan_workbook({}, items)

        def break_fifth_row(wb):
            ws = wb[SHEET_LESSONS]
            ws.cell(6, _col("title")).value = ""
            ws.cell(6, _col("topic")).value = ""
            ws.cell(6, _col("scheduled_date")).value = date(2026, 9, 11)

        content = _patch_workbook(content, break_fifth_row)
        preview = self._preview(content, plan=self.plan, mode="replace_all").json()
        self.assertFalse(preview["can_import"])
        resp = self._import(content, mode="replace_all")
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(self.plan.items.count(), 20)
        self.assertEqual(
            list(self.plan.items.order_by("order").values_list("title", flat=True))[:3],
            ["Старый 1", "Старый 2", "Старый 3"],
        )

    def test_replace_all_does_not_match_by_title(self):
        item = LessonPlanItem.objects.create(plan=self.plan, order=1, title="Урок 1", topic="Тема")
        content = build_plan_workbook({}, [{"title": "Урок 1", "topic": "Другая"}])
        resp = self._import(content, mode="replace_all")
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(self.plan.items.count(), 1)
        self.assertFalse(LessonPlanItem.objects.filter(pk=item.pk).exists())
        self.assertEqual(self.plan.items.get().topic, "Другая")

    def test_insert_shifts_subsequent_lessons_with_existing_scheduler(self):
        LessonPlanItem.objects.create(plan=self.plan, order=1, title="Урок A", topic="Тема", scheduled_date=date(2026, 9, 11))
        LessonPlanItem.objects.create(plan=self.plan, order=2, title="Урок B", topic="Тема", scheduled_date=date(2026, 9, 18))
        LessonPlanItem.objects.create(plan=self.plan, order=3, title="Урок C", topic="Тема", scheduled_date=date(2026, 9, 25))
        content = build_plan_workbook({}, [{"title": "Новый урок", "topic": "Тема", "scheduled_date": date(2026, 9, 18)}])
        with patch("Cabinet.plan_dates.generate_plan_dates", wraps=generate_plan_dates) as spy:
            preview = self._preview(content, plan=self.plan, mode="insert", interval="weekly").json()
            resp = self._import(content, mode="insert", interval="weekly")
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertTrue(spy.called)
        self.assertTrue(preview["can_import"])
        self.assertEqual(preview["summary"]["added"], 1)
        rows = list(self.plan.items.order_by("order"))
        self.assertEqual([item.title for item in rows], ["Урок A", "Новый урок", "Урок B", "Урок C"])
        self.assertEqual([item.scheduled_date for item in rows], [
            date(2026, 9, 11),
            date(2026, 9, 18),
            date(2026, 9, 25),
            date(2026, 10, 2),
        ])
        self.assertEqual(self._reload(), self._reload())

    def test_insert_keeps_manual_dates(self):
        LessonPlanItem.objects.create(plan=self.plan, order=1, title="Урок A", topic="Тема", scheduled_date=date(2026, 9, 11))
        LessonPlanItem.objects.create(plan=self.plan, order=2, title="Урок B", topic="Тема", scheduled_date=date(2026, 9, 18))
        LessonPlanItem.objects.create(plan=self.plan, order=3, title="Урок C", topic="Тема", scheduled_date=date(2026, 10, 2))
        content = build_plan_workbook({}, [{"title": "Новый урок", "topic": "Тема", "scheduled_date": date(2026, 9, 18)}])
        resp = self._import(content, mode="insert", interval="weekly")
        self.assertEqual(resp.status_code, 200, resp.content)
        rows = list(self.plan.items.order_by("order"))
        self.assertEqual([item.title for item in rows], ["Урок A", "Новый урок", "Урок B", "Урок C"])
        self.assertEqual(rows[3].scheduled_date, date(2026, 10, 2))
        sources = {row["id"]: row["date_source"] for row in resp.json()["item_dates"]}
        self.assertEqual(sources[rows[1].pk], "manual")
        self.assertEqual(sources[rows[3].pk], "manual")

    def test_insert_ignores_ids_and_always_creates(self):
        local = LessonPlanItem.objects.create(plan=self.plan, order=1, title="Старый", topic="Тема", scheduled_date=date(2026, 9, 11))
        foreign = LessonPlanItem.objects.create(plan=self.other_plan, order=1, title="Чужой", topic="Секреты", scheduled_date=date(2026, 9, 11))
        content = build_plan_workbook({}, [
            {"id": foreign.pk, "title": "Добавленный из чужого ID", "topic": "Тема", "scheduled_date": date(2026, 9, 18)},
            {"id": local.pk, "title": "Тоже новый", "topic": "Тема", "scheduled_date": date(2026, 9, 25)},
        ])
        resp = self._import(content, mode="insert")
        self.assertEqual(resp.status_code, 200, resp.content)
        local.refresh_from_db()
        foreign.refresh_from_db()
        self.assertEqual(local.title, "Старый")
        self.assertEqual(foreign.title, "Чужой")
        self.assertEqual(self.plan.items.count(), 3)
        self.assertTrue(self.plan.items.filter(title="Добавленный из чужого ID").exists())
        self.assertTrue(self.plan.items.filter(title="Тоже новый").exists())

    def test_replace_dates_updates_existing_day(self):
        a = LessonPlanItem.objects.create(plan=self.plan, order=1, title="Системы счисления", topic="Тема", scheduled_date=date(2026, 9, 11))
        b = LessonPlanItem.objects.create(plan=self.plan, order=2, title="Логика", topic="Тема", scheduled_date=date(2026, 9, 16))
        c = LessonPlanItem.objects.create(plan=self.plan, order=3, title="Кодирование", topic="Тема", scheduled_date=date(2026, 9, 18))
        content = build_plan_workbook({}, [{"title": "Алгебра логики", "topic": "Тема", "scheduled_date": date(2026, 9, 16)}])
        preview = self._preview(content, plan=self.plan, mode="replace_dates").json()
        self.assertTrue(preview["can_import"])
        self.assertIn("Было: Логика", preview["rows"][0]["result"])
        self.assertIn("Станет: Алгебра логики", preview["rows"][0]["result"])
        resp = self._import(content, mode="replace_dates")
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(self.plan.items.count(), 3)
        a.refresh_from_db()
        b.refresh_from_db()
        c.refresh_from_db()
        self.assertEqual(a.title, "Системы счисления")
        self.assertEqual(b.title, "Алгебра логики")
        self.assertEqual(c.title, "Кодирование")
        self.assertEqual(b.scheduled_date, date(2026, 9, 16))
        self.assertEqual(b.order, 2)

    def test_replace_dates_missing_day_is_error(self):
        LessonPlanItem.objects.create(plan=self.plan, order=1, title="Есть", topic="Тема", scheduled_date=date(2026, 9, 11))
        content = build_plan_workbook({}, [{"title": "Нет цели", "topic": "Тема", "scheduled_date": date(2026, 9, 23)}])
        preview = self._preview(content, plan=self.plan, mode="replace_dates").json()
        self.assertFalse(preview["can_import"])
        self.assertIn("нет урока на 23.09.2026", preview["rows"][0]["messages"][0])
        resp = self._import(content, mode="replace_dates")
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(self.plan.items.count(), 1)
        self.assertEqual(self.plan.items.get().title, "Есть")

    def test_replace_dates_duplicate_excel_rows_are_error(self):
        LessonPlanItem.objects.create(plan=self.plan, order=1, title="Логика", topic="Тема", scheduled_date=date(2026, 9, 16))
        content = build_plan_workbook({}, [
            {"title": "Первая", "topic": "Тема", "scheduled_date": date(2026, 9, 16)},
            {"title": "Вторая", "topic": "Тема", "scheduled_date": date(2026, 9, 16)},
        ])
        preview = self._preview(content, plan=self.plan, mode="replace_dates").json()
        self.assertFalse(preview["can_import"])
        self.assertTrue(any("несколько строк для замены урока на 16.09.2026" in msg for row in preview["rows"] for msg in row["messages"]))
        resp = self._import(content, mode="replace_dates")
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(self.plan.items.get().title, "Логика")

    def test_replace_dates_ambiguous_existing_lessons_are_error(self):
        LessonPlanItem.objects.create(plan=self.plan, order=1, title="Первый", topic="Тема", scheduled_date=date(2026, 9, 16))
        LessonPlanItem.objects.create(plan=self.plan, order=2, title="Второй", topic="Тема", scheduled_date=date(2026, 9, 16))
        content = build_plan_workbook({}, [{"title": "Замена", "topic": "Тема", "scheduled_date": date(2026, 9, 16)}])
        preview = self._preview(content, plan=self.plan, mode="replace_dates").json()
        self.assertFalse(preview["can_import"])
        self.assertIn("несколько уроков", preview["rows"][0]["messages"][0])
        resp = self._import(content, mode="replace_dates")
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(self.plan.items.count(), 2)

    def test_foreign_id_never_updates_another_plan(self):
        foreign = LessonPlanItem.objects.create(plan=self.other_plan, order=1, title="Чужой", topic="Секреты", scheduled_date=date(2026, 9, 11))
        own_other = LessonPlanItem.objects.create(plan=self.own_other_plan, order=1, title="Другой план", topic="Тема", scheduled_date=date(2026, 9, 11))
        content = build_plan_workbook({}, [
            {"id": foreign.pk, "title": "Попытка захвата", "topic": "Тема", "scheduled_date": date(2026, 9, 11)},
        ])
        for mode in ("replace_all", "insert", "replace_dates"):
            LessonPlanItem.objects.filter(plan=self.plan).delete()
            LessonPlanItem.objects.create(plan=self.plan, order=1, title="Свой", topic="Тема", scheduled_date=date(2026, 9, 11))
            resp = self._import(content, mode=mode)
            self.assertIn(resp.status_code, {200, 400}, resp.content)
            foreign.refresh_from_db()
            own_other.refresh_from_db()
            self.assertEqual(foreign.title, "Чужой")
            self.assertEqual(own_other.title, "Другой план")
            self.assertFalse(self.other_plan.items.filter(title="Попытка захвата").exists())
            self.assertFalse(self.own_other_plan.items.filter(title="Попытка захвата").exists())

    def test_preview_matches_applied_replace_all(self):
        for n in range(1, 4):
            LessonPlanItem.objects.create(plan=self.plan, order=n, title=f"Старый {n}", topic="Тема")
        content = build_plan_workbook({}, [
            {"title": "A", "topic": "Тема"},
            {"title": "B", "topic": "Тема"},
        ])
        preview = self._preview(content, plan=self.plan, mode="replace_all").json()
        applied = self._import(content, mode="replace_all")
        self.assertEqual(applied.status_code, 200, applied.content)
        titles = list(self.plan.items.order_by("order").values_list("title", flat=True))
        self.assertEqual(preview["summary"]["after_count"], len(titles))
        self.assertEqual(titles, ["A", "B"])
        self.assertEqual(preview["rows"][0]["result"], "Будет в новом плане")

    def test_transaction_rolls_back_when_a_later_row_fails(self):
        for n in range(1, 4):
            LessonPlanItem.objects.create(plan=self.plan, order=n, title=f"Старый {n}", topic="Тема")
        content = build_plan_workbook({}, [
            {"title": f"Новый {n}", "topic": "Тема"} for n in range(1, 16)
        ])
        real_save = LessonPlanItemEditorSerializer.save
        calls = {"n": 0}

        def wrapped(self, **kwargs):
            calls["n"] += 1
            if calls["n"] == 15:
                raise DRFValidationError({"title": ["fail"]})
            return real_save(self, **kwargs)

        with patch.object(LessonPlanItemEditorSerializer, "save", wrapped):
            resp = self._import(content, mode="replace_all")
        self.assertEqual(resp.status_code, 400, resp.content)
        self.assertEqual(self.plan.items.count(), 3)
        self.assertEqual(
            list(self.plan.items.order_by("order").values_list("title", flat=True)),
            ["Старый 1", "Старый 2", "Старый 3"],
        )

    def test_mixed_auto_and_manual_dates(self):
        items = [
            {"title": "1", "topic": "Тема", "scheduled_date": None},
            {"title": "2", "topic": "Тема", "scheduled_date": None},
            {"title": "3", "topic": "Тема", "scheduled_date": date(2026, 10, 2)},
            {"title": "4", "topic": "Тема", "scheduled_date": None},
            {"title": "5", "topic": "Тема", "scheduled_date": None},
        ]
        content = build_plan_workbook({"start_date": "2026-09-11", "interval": "weekly"}, items)
        resp = self._import(content, mode="replace_all", start_date="2026-09-11", interval="weekly")
        self.assertEqual(resp.status_code, 200, resp.content)
        dates = list(self.plan.items.order_by("order").values_list("scheduled_date", flat=True))
        self.assertEqual(dates, [
            date(2026, 9, 11),
            date(2026, 9, 18),
            date(2026, 10, 2),
            date(2026, 10, 9),
            date(2026, 10, 16),
        ])
        sources = {row["id"]: row["date_source"] for row in resp.json()["item_dates"]}
        items = list(self.plan.items.order_by("order"))
        self.assertEqual(sources[items[0].pk], "automatic")
        self.assertEqual(sources[items[1].pk], "automatic")
        self.assertEqual(sources[items[2].pk], "manual")
        self.assertEqual(sources[items[3].pk], "automatic")
        self.assertEqual(sources[items[4].pk], "automatic")

    def test_topic_normalizes_without_fuzzy_match(self):
        LessonPlanItem.objects.create(plan=self.plan, order=1, title="База", topic="Системы счисления")
        items = [
            {"title": "A", "topic": "системы   счисления"},
            {"title": "B", "topic": "СИСТЕМЫ СЧИСЛЕНИЯ"},
            {"title": "C", "topic": "Системы счисл"},
        ]
        content = build_plan_workbook({}, items)
        preview = parse_plan_workbook(content, existing_items=list(self.plan.items.all()), mode="insert")
        topics = [row["item"]["topic"] for row in preview["rows"]]
        self.assertEqual(topics[0], "Системы счисления")
        self.assertEqual(topics[1], "Системы счисления")
        self.assertEqual(topics[2], "Системы счисл")

    def test_broken_files_return_user_errors(self):
        missing = _patch_workbook(
            build_plan_workbook({}, [{"title": "A", "topic": "Тема"}]),
            lambda wb: setattr(wb[SHEET_LESSONS].cell(1, _col("title")), "value", "Имя урока"),
        )
        resp = self._preview(missing)
        self.assertEqual(resp.status_code, 400)
        self.assertNotIn("Traceback", resp.content.decode())
        self.assertIn("Название урока", resp.json()["detail"])

        empty = self.client.post(
            "/api/cabinet/lesson-plans/excel-preview/",
            {"file": self._xlsx(b"", name="empty.xlsx")},
            format="multipart",
        )
        self.assertEqual(empty.status_code, 400)
        self.assertIn("пустой", empty.json()["detail"].lower())

        xlsm = self.client.post(
            "/api/cabinet/lesson-plans/excel-preview/",
            {"file": self._xlsx(build_plan_workbook({}, [{"title": "A", "topic": "Тема"}]), name="plan.xlsm")},
            format="multipart",
        )
        self.assertEqual(xlsm.status_code, 400)
        self.assertIn("xlsx", xlsm.json()["detail"].lower())

        xls = self.client.post(
            "/api/cabinet/lesson-plans/excel-preview/",
            {"file": self._xlsx(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1", name="plan.xlsx")},
            format="multipart",
        )
        self.assertEqual(xls.status_code, 400)

        other = Workbook()
        other.active["A1"] = "hello"
        buf = BytesIO()
        other.save(buf)
        other_resp = self._preview(buf.getvalue())
        self.assertEqual(other_resp.status_code, 400)

        corrupt = self.client.post(
            "/api/cabinet/lesson-plans/excel-preview/",
            {"file": self._xlsx(b"PK\x03\x04not-an-xlsx")},
            format="multipart",
        )
        self.assertEqual(corrupt.status_code, 400)
        self.assertNotIn("Traceback", corrupt.content.decode())

        class Dummy:
            name = "plan.xlsm"
            size = 10
            def read(self):
                return b"not used"
        with self.assertRaises(PlanExcelError):
            read_uploaded_bytes(Dummy())

    def test_formula_looking_text_roundtrip(self):
        content = build_plan_workbook({}, [{
            "title": "=SUM(A1:A2)",
            "topic": "+123",
            "subtopic": "@test",
            "goal": "-something",
        }])
        wb = load_workbook(BytesIO(content))
        title_cell = wb[SHEET_LESSONS].cell(2, _col("title"))
        self.assertNotEqual(title_cell.data_type, "f")
        self.assertEqual(title_cell.value, "'=SUM(A1:A2)")
        preview = parse_plan_workbook(content)
        item = preview["rows"][0]["item"]
        self.assertEqual(item["title"], "=SUM(A1:A2)")
        self.assertEqual(item["topic"], "+123")
        self.assertEqual(item["subtopic"], "@test")
        self.assertEqual(item["goal"], "-something")

    def test_large_file_keeps_order(self):
        items = [{"title": f"Урок {n:03d}", "topic": "Тема"} for n in range(1, 151)]
        content = build_plan_workbook({}, items)
        preview = parse_plan_workbook(content)
        self.assertEqual(preview["summary"]["found"], 150)
        self.assertTrue(preview["can_import"])
        resp = self._import(content, mode="replace_all")
        self.assertEqual(resp.status_code, 200, resp.content)
        titles = list(self.plan.items.order_by("order").values_list("title", flat=True))
        self.assertEqual(titles[0], "Урок 001")
        self.assertEqual(titles[-1], "Урок 150")
        self.assertEqual(len(titles), 150)


class PlanExcelScheduleTests(TestCase):
    def test_monday_thursday_sequence_and_first_date_shift(self):
        dates = [
            row["effective"]
            for row in sequence_plan(5, date(2026, 10, 12), MODE_WEEKDAYS, [0, 3], 1, [None] * 5, [False] * 5, [None] * 5)
        ]
        self.assertEqual(dates, [
            date(2026, 10, 12),
            date(2026, 10, 15),
            date(2026, 10, 19),
            date(2026, 10, 22),
            date(2026, 10, 26),
        ])
        shifted = [
            row["effective"]
            for row in sequence_plan(4, date(2026, 10, 15), MODE_WEEKDAYS, [0, 3], 1, [None] * 4, [False] * 4, [None] * 5)
        ]
        self.assertEqual(shifted, [date(2026, 10, 15), date(2026, 10, 19), date(2026, 10, 22), date(2026, 10, 26)])

    def test_off_weekday_start_warning_is_shown_once(self):
        content = build_plan_workbook(
            {"start_date": "2026-10-13", "schedule_mode": "weekdays", "weekdays": [0, 3]},
            [{"title": "Первое", "topic": "Курс"}],
        )
        preview = parse_plan_workbook(content, mode="sync")
        matches = [text for text in preview["warnings"] if "не совпадает с учебным днём" in text]
        self.assertEqual(matches, [
            "Первая дата 13.10.2026 не совпадает с учебным днём. "
            "Ближайшая подходящая: 15.10.2026. Выбранная дата сохранена.",
        ])
        self.assertEqual(preview["rows"][0]["item"]["scheduled_date"], "2026-10-13")

    def test_manual_date_continues_sequence_without_reordering_topics(self):
        manuals = [None, None, date(2026, 10, 16), None]
        rows = sequence_plan(4, date(2026, 10, 12), MODE_WEEKDAYS, [0, 3], 1, manuals, [False] * 4, [None] * 4)
        self.assertEqual([row["effective"] for row in rows], [
            date(2026, 10, 12),
            date(2026, 10, 15),
            date(2026, 10, 16),
            date(2026, 10, 19),
        ])
        self.assertEqual(rows[2]["source"], "manual")
        self.assertEqual(rows[3]["source"], "automatic")

    def test_weekday_counts_month_year_and_leap_day(self):
        for count, days in ((1, [0]), (2, [0, 3]), (3, [1, 2, 4]), (5, [0, 1, 2, 3, 4]), (7, list(range(7)))):
            rows = sequence_plan(6, date(2026, 10, 12), MODE_WEEKDAYS, days, 1, [None] * 6, [False] * 6, [None] * 6)
            produced = [row["effective"] for row in rows]
            self.assertEqual(len(produced), 6)
            self.assertEqual(len(set(produced)), 6)
            self.assertEqual(produced, sorted(produced))
            self.assertTrue(all(day.weekday() in days or index == 0 for index, day in enumerate(produced)))
            self.assertEqual(count, len(days))
        year = sequence_plan(3, date(2026, 12, 28), MODE_WEEKLY, [0], 1, [None] * 3, [False] * 3, [None] * 3)
        self.assertEqual([row["effective"] for row in year], [date(2026, 12, 28), date(2027, 1, 4), date(2027, 1, 11)])
        leap = sequence_plan(3, date(2024, 2, 28), "Каждый день", [], 1, [None] * 3, [False] * 3, [None] * 3)
        self.assertEqual([row["effective"] for row in leap], [date(2024, 2, 28), date(2024, 2, 29), date(2024, 3, 1)])

    def test_schedule_formula_survives_row_insert_and_delete(self):
        formula = formula_schedule(6, "T", "H", "I", "J", "F")
        self.assertIn("INDEX(T:T,ROW())", formula)
        self.assertIn("DATE(2000,1,1)", formula)
        self.assertNotIn("T5", formula)
        previous = formula_prev_anchor("R")
        self.assertIn("INDEX(R:R,ROW()-1)", previous)
        self.assertIn("DATE(2000,1,1)", previous)
        self.assertNotIn("R5", previous)
        content = build_plan_workbook(
            {"start_date": "2026-10-12", "schedule_mode": "weekdays", "weekdays": [0, 3]},
            [{"title": "Один", "topic": "Курс"}, {"title": "Два", "topic": "Курс"}],
        )
        wb = load_workbook(BytesIO(content))
        ws = wb[SHEET_LESSONS]
        anchor = get_column_letter(_col("date_anchor"))
        prev = get_column_letter(_col("prev_anchor"))
        original = ws.cell(4, _col("schedule_date")).value
        self.assertIn(f"INDEX({prev}:{prev},ROW())", original)
        self.assertIn("DATE(2000,1,1)", original)
        self.assertNotIn(f"{anchor}3", original)
        self.assertIn("DATE(2000,1,1)", ws.cell(4, _col("prev_anchor")).value)
        self.assertTrue(ws.column_dimensions[prev].hidden)
        table = ws.tables["PlanLessons"]
        calculated = {
            column.name: column.calculatedColumnFormula.attr_text
            for column in table.tableColumns
            if column.calculatedColumnFormula is not None
        }
        self.assertIn("Дата по расписанию", calculated)
        self.assertIn("Прошлая опора", calculated)
        self.assertNotIn("ID урока", calculated)
        self.assertNotIn("Код строки", calculated)
        styled = {str(range_) for range_ in ws.conditional_formatting._cf_rules}
        self.assertTrue(any("F2:F" in str(range_) for range_ in styled))
        self.assertTrue(any("G2:G" in str(range_) for range_ in styled))
        self.assertTrue(any("E2:E" in str(range_) for range_ in styled))
        ws.delete_rows(3)
        shifted = ws.cell(3, _col("schedule_date")).value
        self.assertIn("INDEX(", shifted)
        self.assertNotIn("#REF!", str(shifted))
        self.assertNotIn("#REF!", str(ws.cell(3, _col("prev_anchor")).value))


class PlanExcelSyncTests(PlanExcelAcceptanceTests):
    def _sync_file(self, items, **settings):
        payload = {"start_date": "2026-10-12", "schedule_mode": "weekdays", "weekdays": [0, 3], "interval": "weekdays"}
        payload.update(settings)
        return build_plan_workbook(payload, items)

    def test_sync_updates_adds_and_deletes_without_duplicating_ids(self):
        items = []
        for number in range(1, 21):
            items.append(LessonPlanItem.objects.create(
                plan=self.plan,
                order=number,
                title=f"Тема {number}",
                topic="Курс",
                homework_description="ДЗ",
                scheduled_date=date(2026, 10, 12),
            ))
        exported = [
            {
                "id": item.pk,
                "title": item.title,
                "topic": item.topic,
                "homework_description": item.homework_description,
                "scheduled_date": item.scheduled_date,
                "date_source": "automatic",
                "order": item.order,
            }
            for item in items
        ]
        exported[0]["title"] = "Введение"
        exported[0]["date_source"] = "manual"
        exported[0]["scheduled_date"] = date(2026, 10, 16)
        exported[1]["homework_description"] = "Повторить параграф"
        del exported[2]
        del exported[2]
        exported.extend([
            {"title": "Новое 1", "topic": "Курс", "date_source": "automatic"},
            {"title": "Новое 2", "topic": "Курс", "date_source": "automatic"},
            {"title": "Новое 3", "topic": "Курс", "date_source": "automatic"},
        ])
        removed = {items[2].pk, items[3].pk}
        kept = items[0].pk
        content = self._sync_file(exported)
        preview = self._preview(content, plan=self.plan, mode="sync").json()
        self.assertTrue(preview["can_import"], preview)
        self.assertGreaterEqual(preview["summary"]["updated"], 1)
        self.assertEqual(preview["summary"]["added"], 3)
        self.assertEqual(preview["summary"]["deleted"], 2)
        self.assertGreaterEqual(preview["summary"]["dates_changed"], 1)
        held = self._import_flags(content, confirm_deletes=False)
        self.assertEqual(held.status_code, 200, held.content)
        self.assertEqual(LessonPlanItem.objects.filter(pk__in=removed).count(), 2)
        resp = self._import_flags(content, confirm_deletes=True)
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertFalse(LessonPlanItem.objects.filter(pk__in=removed).exists())
        kept_item = LessonPlanItem.objects.get(pk=kept)
        self.assertEqual(kept_item.title, "Введение")
        self.assertEqual(kept_item.scheduled_date, date(2026, 10, 16))
        self.assertEqual(self.plan.items.filter(title__startswith="Новое").count(), 3)
        fresh = []
        for item in self.plan.items.order_by("order", "id"):
            fresh.append({
                "id": item.pk,
                "title": item.title,
                "topic": item.topic,
                "homework_description": item.homework_description,
                "scheduled_date": item.scheduled_date,
                "date_source": "manual" if item.pk == kept else "automatic",
                "order": item.order,
            })
        again = self._import_flags(self._sync_file(fresh), confirm_deletes=True)
        self.assertEqual(again.status_code, 200, again.content)
        self.assertEqual(again.json()["summary"]["created"], 0)
        self.assertEqual(again.json()["summary"]["deleted"], 0)
        self.assertEqual(again.json()["summary"]["updated"], 0)

    def test_corrupt_and_duplicate_ids_are_not_guessed(self):
        item = LessonPlanItem.objects.create(plan=self.plan, order=1, title="Свой", topic="Тема", scheduled_date=date(2026, 10, 12))
        content = self._sync_file([
            {"id": "abc", "title": "Порча", "topic": "Тема"},
            {"id": item.pk, "title": "Первая копия", "topic": "Тема"},
            {"id": item.pk, "title": "Вторая копия", "topic": "Тема"},
        ])
        preview = self._preview(content, plan=self.plan, mode="sync").json()
        self.assertTrue(preview["can_import"])
        self.assertGreaterEqual(preview["summary"]["attention"], 2)
        self.assertEqual(preview["summary"]["deleted"], 0)
        resp = self._import_flags(content, confirm_deletes=True)
        self.assertEqual(resp.status_code, 200, resp.content)
        item.refresh_from_db()
        self.assertEqual(item.title, "Свой")
        self.assertFalse(self.plan.items.filter(title="Порча").exists())

    def test_conducted_lesson_keeps_event_date_and_is_not_deleted(self):
        item = LessonPlanItem.objects.create(
            plan=self.plan,
            order=1,
            title="Проведённый",
            topic="Тема",
            status=PlanItemStatus.COMPLETED,
            scheduled_date=date(2026, 10, 12),
        )
        start = timezone.now()
        event = ScheduleEvent.objects.create(
            owner=self.teacher,
            title="Урок",
            topic="Тема",
            starts_at=start,
            ends_at=start + timedelta(minutes=60),
            event_type=ScheduleEvent.EventType.INDIVIDUAL_LESSON,
            status=ScheduleEvent.Status.COMPLETED,
            lesson_plan_item=item,
        )
        item.scheduled_event = event
        item.save(update_fields=["scheduled_event"])
        content = self._sync_file([
            {"title": "Другое занятие", "topic": "Тема", "date_source": "automatic"},
        ])
        preview = self._preview(content, plan=self.plan, mode="sync").json()
        self.assertTrue(any(row["status"] == "retain" for row in preview["rows"]))
        resp = self._import_flags(content, confirm_deletes=True)
        self.assertEqual(resp.status_code, 200, resp.content)
        item.refresh_from_db()
        event.refresh_from_db()
        self.assertEqual(item.title, "Проведённый")
        self.assertEqual(item.status, PlanItemStatus.COMPLETED)
        self.assertEqual(event.starts_at, start)
        self.assertEqual(event.lesson_plan_item_id, item.pk)
        self.assertTrue(self.plan.items.filter(title="Другое занятие").exists())

    def test_reimport_of_new_rows_without_server_id_does_not_duplicate(self):
        content = self._sync_file([
            {"title": "Новое занятие", "topic": "Курс", "homework_description": "ДЗ"},
            {"title": "Ещё одно", "topic": "Курс"},
        ])
        first = self._import_flags(content, confirm_deletes=True)
        self.assertEqual(first.status_code, 200, first.content)
        self.assertEqual(first.json()["summary"]["created"], 2)
        self.assertEqual(self.plan.items.count(), 2)
        again = self._import_flags(content, confirm_deletes=True)
        self.assertEqual(again.status_code, 200, again.content)
        self.assertEqual(again.json()["summary"]["created"], 0)
        self.assertEqual(again.json()["summary"]["deleted"], 0)
        self.assertEqual(self.plan.items.count(), 2)
        titles = set(self.plan.items.values_list("title", flat=True))
        self.assertEqual(titles, {"Новое занятие", "Ещё одно"})

    def test_reimport_without_row_key_matches_identical_content(self):
        content = self._sync_file([{"title": "Без кода", "topic": "Курс"}])
        content = _patch_workbook(content, lambda wb: wb[SHEET_LESSONS].cell(2, _col("row_key"), None))
        first = self._import_flags(content, confirm_deletes=True)
        self.assertEqual(first.status_code, 200, first.content)
        self.assertEqual(self.plan.items.count(), 1)
        again = self._import_flags(content, confirm_deletes=True)
        self.assertEqual(again.status_code, 200, again.content)
        self.assertEqual(again.json()["summary"]["created"], 0)
        self.assertEqual(again.json()["summary"]["deleted"], 0)
        self.assertEqual(self.plan.items.count(), 1)

    def test_site_edit_after_download_is_not_overwritten_until_chosen(self):
        item = LessonPlanItem.objects.create(
            plan=self.plan, order=1, title="Из файла", topic="Курс", scheduled_date=date(2026, 10, 12),
        )
        stamp = item.updated_at
        content = self._sync_file([{
            "id": item.pk,
            "title": "Из файла",
            "topic": "Курс",
            "scheduled_date": item.scheduled_date,
            "date_source": "automatic",
            "updated_at": stamp,
        }])
        item.title = "На сайте"
        item.save(update_fields=["title", "updated_at"])
        preview = self._preview(content, plan=self.plan, mode="sync").json()
        conflict = next(row for row in preview["rows"] if row.get("status") == "conflict")
        self.assertTrue(any(diff["field"] == "title" for diff in conflict["diffs"]))
        held = self._import_flags(content, confirm_deletes=True)
        self.assertEqual(held.status_code, 200, held.content)
        item.refresh_from_db()
        self.assertEqual(item.title, "На сайте")
        taken = self._import_flags(content, confirm_deletes=True, extra={"accept_conflicts": "2"})
        self.assertEqual(taken.status_code, 200, taken.content)
        item.refresh_from_db()
        self.assertEqual(item.title, "Из файла")

    def test_teacher_can_skip_one_update_and_one_delete(self):
        first = LessonPlanItem.objects.create(plan=self.plan, order=1, title="Первый", topic="Курс", scheduled_date=date(2026, 10, 12))
        second = LessonPlanItem.objects.create(plan=self.plan, order=2, title="Второй", topic="Курс", scheduled_date=date(2026, 10, 15))
        third = LessonPlanItem.objects.create(plan=self.plan, order=3, title="Третий", topic="Курс", scheduled_date=date(2026, 10, 19))
        content = self._sync_file([
            {"id": first.pk, "title": "Первый изменён", "topic": "Курс", "date_source": "automatic", "updated_at": first.updated_at},
            {"id": second.pk, "title": "Второй изменён", "topic": "Курс", "date_source": "automatic", "updated_at": second.updated_at},
        ])
        resp = self._import_flags(content, confirm_deletes=True, extra={"exclude_rows": f"2,delete:{third.pk}"})
        self.assertEqual(resp.status_code, 200, resp.content)
        first.refresh_from_db()
        second.refresh_from_db()
        self.assertEqual(first.title, "Первый")
        self.assertEqual(second.title, "Второй изменён")
        self.assertTrue(LessonPlanItem.objects.filter(pk=third.pk).exists())

    def test_calendar_event_moves_only_when_requested(self):
        item = LessonPlanItem.objects.create(
            plan=self.plan, order=1, title="Урок", topic="Курс", scheduled_date=date(2026, 10, 12),
        )
        start = timezone.make_aware(datetime(2026, 10, 12, 12, 0))
        event = ScheduleEvent.objects.create(
            owner=self.teacher,
            title="Урок",
            topic="Курс",
            starts_at=start,
            ends_at=start + timedelta(minutes=60),
            event_type=ScheduleEvent.EventType.INDIVIDUAL_LESSON,
            status=ScheduleEvent.Status.PLANNED,
            lesson_plan_item=item,
        )
        item.scheduled_event = event
        item.save(update_fields=["scheduled_event"])
        item.refresh_from_db()
        content = self._sync_file([{
            "id": item.pk,
            "title": "Урок",
            "topic": "Курс",
            "scheduled_date": date(2026, 10, 16),
            "date_source": "manual",
            "updated_at": item.updated_at,
        }])
        held = self._import_flags(content)
        self.assertEqual(held.status_code, 200, held.content)
        item.refresh_from_db()
        event.refresh_from_db()
        self.assertEqual(item.scheduled_date, date(2026, 10, 16))
        self.assertEqual(event.starts_at, start)
        moved_file = self._sync_file([{
            "id": item.pk,
            "title": "Урок",
            "topic": "Курс",
            "scheduled_date": date(2026, 10, 19),
            "date_source": "manual",
            "updated_at": item.updated_at,
        }])
        moved = self._import_flags(moved_file, extra={"move_event_rows": "2"})
        self.assertEqual(moved.status_code, 200, moved.content)
        event.refresh_from_db()
        self.assertEqual(timezone.localtime(event.starts_at).date(), date(2026, 10, 19))
        self.assertEqual(timezone.localtime(event.starts_at).hour, timezone.localtime(start).hour)
        self.assertTrue(moved.json()["summary"]["event_moves"][0]["moved"])

    def test_duplicate_row_key_is_not_applied_until_teacher_creates_new(self):
        item = LessonPlanItem.objects.create(
            plan=self.plan, title="Урок", topic="Курс", order=1,
            scheduled_date=date(2026, 10, 12), import_key="same-key",
        )
        other = LessonPlanItem.objects.create(
            plan=self.plan, title="Соседнее", topic="Курс", order=2,
            scheduled_date=date(2026, 10, 15), import_key="other-key",
        )
        content = self._sync_file([
            {"row_key": "same-key", "title": "Первая копия", "topic": "Курс", "scheduled_date": date(2026, 10, 12), "date_source": "manual"},
            {"row_key": "same-key", "title": "Вторая копия", "topic": "Курс", "scheduled_date": date(2026, 10, 15), "date_source": "manual"},
        ])
        preview = self._preview(content, mode="sync")
        self.assertEqual(preview.status_code, 200, preview.content)
        body = preview.json()
        self.assertTrue(any(row.get("allow_create") for row in body["rows"]))
        warning_text = " ".join(body.get("warnings") or [])
        self.assertIn("повторяющиеся коды", warning_text)
        self.assertNotIn("неясным ID", warning_text)
        self.assertEqual(body["summary"]["deleted"], 0)
        held = self._import_flags(content)
        self.assertEqual(held.status_code, 200, held.content)
        item.refresh_from_db()
        other.refresh_from_db()
        self.assertEqual(item.title, "Урок")
        self.assertEqual(other.title, "Соседнее")
        self.assertEqual(self.plan.items.count(), 2)
        created = self._import_flags(content, extra={"accept_conflicts": "3"})
        self.assertEqual(created.status_code, 200, created.content)
        self.assertEqual(self.plan.items.count(), 3)
        item.refresh_from_db()
        other.refresh_from_db()
        self.assertEqual(item.title, "Урок")
        self.assertEqual(other.title, "Соседнее")
        self.assertFalse(self.plan.items.exclude(pk=item.pk).filter(import_key="same-key").exists())

    def test_duplicate_stored_key_does_not_merge_lessons(self):
        first = LessonPlanItem.objects.create(
            plan=self.plan, title="Первое", topic="Курс", order=1,
            scheduled_date=date(2026, 10, 12), import_key="shared",
        )
        second = LessonPlanItem.objects.create(
            plan=self.plan, title="Второе", topic="Курс", order=2,
            scheduled_date=date(2026, 10, 15), import_key="shared",
        )
        content = self._sync_file([{
            "row_key": "shared", "title": "Объединённое", "topic": "Курс",
            "scheduled_date": date(2026, 10, 12), "date_source": "manual",
        }])
        response = self._import_flags(content, confirm_deletes=True)
        self.assertEqual(response.status_code, 200, response.content)
        first.refresh_from_db()
        second.refresh_from_db()
        self.assertEqual(first.title, "Первое")
        self.assertEqual(second.title, "Второе")
        self.assertEqual(self.plan.items.count(), 2)

    def test_identical_keyless_rows_are_not_created(self):
        content = self._sync_file([
            {"title": "Практика", "topic": "Курс", "scheduled_date": date(2026, 10, 12), "date_source": "manual", "manual_date": date(2026, 10, 12)},
            {"title": "Практика", "topic": "Курс", "scheduled_date": date(2026, 10, 12), "date_source": "manual", "manual_date": date(2026, 10, 12)},
        ])

        def clear_keys(wb):
            ws = wb[SHEET_LESSONS]
            header = {cell.value: cell.column for cell in ws[1]}
            for row_idx in (2, 3):
                ws.cell(row_idx, header["Код строки"]).value = None

        content = _patch_workbook(content, clear_keys)
        preview = self._preview(content, mode="sync")
        self.assertEqual(preview.status_code, 200, preview.content)
        self.assertTrue(all(row.get("allow_create") and row.get("status") == "ambiguous" for row in preview.json()["rows"]))
        response = self._import_flags(content)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(self.plan.items.count(), 0)

    def test_identical_lessons_with_different_keys_stay_separate(self):
        first = LessonPlanItem.objects.create(
            plan=self.plan, title="Практика", topic="Курс", order=1,
            scheduled_date=date(2026, 10, 12), import_key="key-a",
        )
        second = LessonPlanItem.objects.create(
            plan=self.plan, title="Практика", topic="Курс", order=2,
            scheduled_date=date(2026, 10, 15), import_key="key-b",
        )
        content = self._sync_file([
            {"id": first.pk, "row_key": "key-a", "title": "Практика", "topic": "Курс", "scheduled_date": date(2026, 10, 12), "date_source": "manual", "updated_at": first.updated_at},
            {"id": second.pk, "row_key": "key-b", "title": "Практика", "topic": "Курс", "scheduled_date": date(2026, 10, 15), "date_source": "manual", "updated_at": second.updated_at},
        ])
        response = self._import_flags(content)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(self.plan.items.count(), 2)
        self.assertTrue(self.plan.items.filter(pk=first.pk, import_key="key-a").exists())
        self.assertTrue(self.plan.items.filter(pk=second.pk, import_key="key-b").exists())

    def test_import_keeps_homework_journal_and_status(self):
        item = LessonPlanItem.objects.create(
            plan=self.plan, title="Урок", topic="Старая тема", order=1, status=PlanItemStatus.COMPLETED,
            scheduled_date=date(2026, 10, 12), import_key="keep-me",
        )
        start = timezone.make_aware(datetime(2026, 10, 12, 10, 0))
        event = ScheduleEvent.objects.create(
            owner=self.teacher, title="Урок", event_type=ScheduleEvent.EventType.INDIVIDUAL_LESSON,
            starts_at=start, ends_at=start + timedelta(hours=1), lesson_plan_item=item, status=ScheduleEvent.Status.DONE,
        )
        item.scheduled_event = event
        item.save(update_fields=["scheduled_event"])
        student = Student.objects.create(teacher=self.teacher, first_name="Анна")
        homework = Homework.objects.create(teacher=self.teacher, title="Задача", lesson_plan_item=item)
        submission = HomeworkSubmission.objects.create(homework=homework, student=student, score=4)
        journal = LessonJournal.objects.get(schedule_event=event)
        content = self._sync_file([{
            "id": item.pk, "row_key": "keep-me", "title": "Урок", "topic": "Новая тема",
            "scheduled_date": date(2026, 10, 12), "date_source": "manual", "updated_at": item.updated_at,
        }])
        response = self._import_flags(content)
        self.assertEqual(response.status_code, 200, response.content)
        item.refresh_from_db()
        event.refresh_from_db()
        homework.refresh_from_db()
        submission.refresh_from_db()
        self.assertEqual(item.status, PlanItemStatus.COMPLETED)
        self.assertEqual(item.topic, "Новая тема")
        self.assertEqual(item.scheduled_event_id, event.pk)
        self.assertEqual(homework.lesson_plan_item_id, item.pk)
        self.assertEqual(submission.score, 4)
        self.assertTrue(LessonJournal.objects.filter(pk=journal.pk, schedule_event=event).exists())
        self.assertEqual(event.starts_at, start)

    def test_blocked_calendar_move_explains_plan_date_only(self):
        item = LessonPlanItem.objects.create(
            plan=self.plan, title="Урок", topic="Курс", order=1,
            scheduled_date=date(2026, 10, 12), import_key="move-me",
        )
        start = timezone.make_aware(datetime(2026, 10, 12, 10, 0))
        event = ScheduleEvent.objects.create(
            owner=self.teacher, title="Урок", event_type=ScheduleEvent.EventType.INDIVIDUAL_LESSON,
            starts_at=start, ends_at=start + timedelta(hours=1), lesson_plan_item=item,
        )
        item.scheduled_event = event
        item.save(update_fields=["scheduled_event"])
        busy = timezone.make_aware(datetime(2026, 10, 19, 10, 0))
        ScheduleEvent.objects.create(
            owner=self.teacher, title="Другое", event_type=ScheduleEvent.EventType.INDIVIDUAL_LESSON,
            starts_at=busy, ends_at=busy + timedelta(hours=1),
        )
        content = self._sync_file([{
            "id": item.pk, "title": "Урок", "topic": "Курс",
            "scheduled_date": date(2026, 10, 19), "date_source": "manual", "updated_at": item.updated_at,
        }])
        response = self._import_flags(content, extra={"move_event_rows": "2"})
        self.assertEqual(response.status_code, 200, response.content)
        item.refresh_from_db()
        event.refresh_from_db()
        self.assertEqual(item.scheduled_date, date(2026, 10, 19))
        self.assertEqual(event.starts_at, start)
        detail = response.json()["summary"]["event_moves"][0]["detail"]
        self.assertIn("только плановая дата", detail)
        self.assertIn("12.10.2026", detail)

    def _import_flags(self, content, *, confirm_deletes=False, extra=None):
        payload = {"file": self._xlsx(content), "mode": "sync"}
        if confirm_deletes:
            payload["confirm_deletes"] = "1"
        if extra:
            payload.update(extra)
        return self.client.post(
            f"/api/cabinet/lesson-plans/{self.plan.pk}/import-excel/",
            payload,
            format="multipart",
        )
