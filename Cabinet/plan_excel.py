"""Excel-шаблон и импорт плана уроков. Один формат — тот же LessonPlanItem."""

from __future__ import annotations

import hashlib
import io
import logging
import re
import uuid
from datetime import date, datetime
from typing import Any

from django.db import transaction
from django.http import HttpResponse
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from openpyxl import Workbook, load_workbook
from openpyxl.comments import Comment
from openpyxl.styles import Alignment, Border, Font, PatternFill, Protection, Side
from openpyxl.utils import get_column_letter
from openpyxl.utils.datetime import from_excel
from openpyxl.formatting.rule import FormulaRule
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.worksheet.filters import AutoFilter
from openpyxl.worksheet.table import Table, TableColumn, TableFormula, TableStyleInfo
from rest_framework import status

from .choices import PlanItemStatus
from .files_storage import content_disposition, sanitize_filename
from .models import LessonPlan, LessonPlanItem, ScheduleEvent
from .plan_dates import (
    INTERVAL_LABELS,
    apply_sequence_dates,
    generate_plan_dates,
    iso_plan_date,
    normalize_interval,
    normalize_weekdays,
    parse_clock,
    parse_plan_date,
)
from .plan_excel_schedule import (
    SCHEDULE_MODES,
    WEEKDAY_NAMES,
    WEEKDAY_SETTING_LABELS,
    formula_anchor,
    formula_effective,
    formula_nearest_start,
    formula_prev_anchor,
    formula_schedule,
    resolve_schedule,
    sequence_plan,
)
from .plan_levels import get_plan_level_label, get_plan_level_options, normalize_plan_level_id
from .plan_subjects import get_plan_subject_label, get_plan_subject_options, normalize_plan_subject_id

logger = logging.getLogger("cabinet.plan_excel")

TEMPLATE_VERSION = "lesson_plan_v3"
SUPPORTED_TEMPLATE_VERSIONS = frozenset({"", "lesson_plan_v1", "lesson_plan_v2", "lesson_plan_v3"})
MAX_FILE_BYTES = 4 * 1024 * 1024
MAX_LESSONS = 500
MAX_TITLE = 255
MAX_TOPIC = 500
MAX_SUBTOPIC = 255
MAX_TASK_NUMBER = 32
TEMPLATE_SPARE_ROWS = 80

SHEET_LESSONS = "План занятий"
SHEET_LESSONS_LEGACY = "Уроки"
SHEET_INSTRUCTIONS = "Инструкция"
SHEET_SETTINGS = "Настройки расписания"
SHEET_SETTINGS_LEGACY = "Настройки"
SHEET_META = "_meta"
LESSON_SHEET_NAMES = (SHEET_LESSONS, SHEET_LESSONS_LEGACY)
SETTINGS_SHEET_NAMES = (SHEET_SETTINGS, SHEET_SETTINGS_LEGACY)

MODE_REPLACE_ALL = "replace_all"
MODE_INSERT = "insert"
MODE_REPLACE_DATES = "replace_dates"
MODE_SYNC = "sync"
IMPORT_MODES = (MODE_SYNC, MODE_REPLACE_ALL, MODE_INSERT, MODE_REPLACE_DATES)
LEGACY_MODE_MAP = {
    "replace": MODE_REPLACE_ALL,
    "append": MODE_INSERT,
}

GRADE_CHOICES = ("5", "6", "7", "8", "9", "10", "11", "10–11")

HEADER_FILL = PatternFill("solid", fgColor="334155")
HEADER_FONT = Font(name="Calibri", bold=True, color="FFFFFF", size=11)
CELL_FONT = Font(name="Calibri", size=11)
HINT_FONT = Font(name="Calibri", size=10, color="64748B")
TITLE_FONT = Font(name="Calibri", bold=True, size=16, color="0F172A")
SECTION_FONT = Font(name="Calibri", bold=True, size=12, color="0F172A")
LABEL_FONT = Font(name="Calibri", bold=True, size=11, color="0F172A")
BOX_FILL = PatternFill("solid", fgColor="F8FAFC")
SECTION_FILL = PatternFill("solid", fgColor="EEF2F7")
WARN_FILL = PatternFill("solid", fgColor="FFFBEB")
BAND_FILL = PatternFill("solid", fgColor="F8FAFC")
WHITE_FILL = PatternFill("solid", fgColor="FFFFFF")
AUTO_DATE_FILL = PatternFill("solid", fgColor="DBEAFE")
MANUAL_DATE_FILL = PatternFill("solid", fgColor="FEF3C7")
AUTO_DATE_FONT = Font(name="Calibri", size=11, color="1E40AF")
MANUAL_DATE_FONT = Font(name="Calibri", size=11, color="92400E")
THIN = Border(
    left=Side(style="thin", color="E2E8F0"),
    right=Side(style="thin", color="E2E8F0"),
    top=Side(style="thin", color="E2E8F0"),
    bottom=Side(style="thin", color="E2E8F0"),
)
WRAP = Alignment(wrap_text=True, vertical="top")
CENTER = Alignment(vertical="center", wrap_text=True)
TOP = Alignment(vertical="center")

COLUMNS = (
    {"key": "number", "title": "№", "width": 6, "locked": False, "hidden": False, "wrap": False},
    {"key": "item_id", "title": "ID урока", "width": 12, "locked": False, "hidden": True, "wrap": False},
    {"key": "row_key", "title": "Код строки", "width": 18, "locked": False, "hidden": True, "wrap": False},
    {"key": "revision", "title": "Версия", "width": 22, "locked": False, "hidden": True, "wrap": False},
    {"key": "schedule_date", "title": "Дата по расписанию", "width": 22, "locked": False, "hidden": False, "wrap": False,
     "hint": "Считается автоматически и подсвечивается голубым. Пустая ячейка остаётся пустой. Не заменяйте формулу: для исключения заполните «Дата вручную»."},
    {"key": "manual_date", "title": "Дата вручную", "width": 16, "locked": False, "hidden": False, "wrap": False,
     "hint": "Необязательно. Жёлтая ячейка — дата задана вами и не пересчитывается. Следующие автоматические даты продолжатся после неё."},
    {"key": "scheduled_date", "title": "Дата", "width": 14, "locked": False, "hidden": False, "wrap": False,
     "hint": "Итог. Голубой — автоматическая дата, жёлтый — дата вручную."},
    {"key": "skip_date", "title": "Пропустить", "width": 14, "locked": False, "hidden": False, "wrap": False,
     "hint": "Да — строка не занимает день в автоматической последовательности. Своя дата при этом берётся из «Дата вручную»."},
    {"key": "title", "title": "Название урока", "width": 28, "locked": False, "hidden": False, "wrap": True,
     "hint": "Можно оставить пустым, если заполнена тема."},
    {"key": "topic", "title": "Тема", "width": 28, "locked": False, "hidden": False, "wrap": True,
     "hint": "Например: Системы счисления"},
    {"key": "subtopic", "title": "Подтема", "width": 28, "locked": False, "hidden": False, "wrap": True,
     "hint": "Например: Перевод чисел между системами счисления"},
    {"key": "task_number", "title": "№ задания", "width": 14, "locked": False, "hidden": False, "wrap": False,
     "hint": "Номер задания ЕГЭ/ОГЭ, например 5, 8, 14 или 1-5."},
    {"key": "goal", "title": "Цель", "width": 36, "locked": False, "hidden": False, "wrap": True,
     "hint": "Что ученик должен уметь после занятия."},
    {"key": "description", "title": "План урока", "width": 40, "locked": False, "hidden": False, "wrap": True,
     "hint": "Краткий последовательный план занятия."},
    {"key": "homework_description", "title": "Домашнее задание", "width": 36, "locked": False, "hidden": False, "wrap": True,
     "hint": "Текстовое описание ДЗ. Файлы и задания добавляются потом в карточке урока."},
    {"key": "teacher_comment", "title": "Комментарий", "width": 28, "locked": False, "hidden": False, "wrap": True,
     "hint": "Заметка учителя. Не видна ученику как материал."},
    {"key": "date_source", "title": "Статус даты", "width": 14, "locked": False, "hidden": True, "wrap": False},
    {"key": "date_anchor", "title": "Опора даты", "width": 14, "locked": False, "hidden": True, "wrap": False},
    {"key": "order", "title": "Порядок", "width": 10, "locked": False, "hidden": True, "wrap": False},
    {"key": "prev_anchor", "title": "Прошлая опора", "width": 14, "locked": False, "hidden": True, "wrap": False},
)

HEADER_ALIASES = {
    "№": "number",
    "ID урока": "item_id",
    "Код строки": "row_key",
    "Версия": "revision",
    "Дата по расписанию": "schedule_date",
    "Дата вручную": "manual_date",
    "Дата": "scheduled_date",
    "Дата занятия": "scheduled_date",
    "Пропустить": "skip_date",
    "Название урока": "title",
    "Тема": "topic",
    "Подтема": "subtopic",
    "№ задания": "task_number",
    "Цель": "goal",
    "План урока": "description",
    "Домашнее задание": "homework_description",
    "Комментарий": "teacher_comment",
    "Статус даты": "date_source",
    "Опора даты": "date_anchor",
    "Порядок": "order",
    "Прошлая опора": "prev_anchor",
}
REQUIRED_HEADERS = ("Название урока", "Тема", "Дата")
TITLE_BY_KEY = {col["key"]: col["title"] for col in COLUMNS}
USER_KEYS = {
    col["key"] for col in COLUMNS
    if col["key"] not in {"number", "schedule_date", "scheduled_date", "date_anchor", "prev_anchor", "item_id", "date_source", "order"}
}
DATE_KEYS = {"schedule_date", "manual_date", "scheduled_date", "date_anchor", "prev_anchor"}
FORMULA_KEYS = {"number", "schedule_date", "scheduled_date", "date_anchor", "prev_anchor"}

SETTINGS_FIELDS = (
    {
        "key": "subject",
        "label": "Предмет",
        "hint": "Обновляет карточку плана при импорте.",
        "kind": "subject",
    },
    {
        "key": "direction",
        "label": "Уровень",
        "hint": "ЕГЭ, ОГЭ и другие уровни. Обновляет карточку плана.",
        "kind": "direction",
    },
    {
        "key": "grade",
        "label": "Класс",
        "hint": "Например: 9 или 10–11.",
        "kind": "grade",
    },
    {
        "key": "start_date",
        "label": "Дата первого занятия",
        "hint": "С этой даты начинается автоматическое расписание. Её можно изменить здесь или датой вручную в первой строке.",
        "kind": "date",
    },
    {
        "key": "schedule_mode",
        "label": "Режим расписания",
        "hint": "По выбранным дням, раз в неделю, каждые N дней или без автоматического расписания.",
        "kind": "mode",
    },
    {
        "key": "step_n",
        "label": "Интервал N",
        "hint": "Для режимов «каждые N недель» и «каждые N дней». Для остальных можно оставить пустым.",
        "kind": "number",
    },
    {
        "key": "start_time",
        "label": "Время начала",
        "hint": "Необязательно. Попадает в слоты расписания, если план уже назначен ученику.",
        "kind": "time",
    },
    {
        "key": "duration_minutes",
        "label": "Продолжительность, мин",
        "hint": "Необязательно. Например 60.",
        "kind": "number",
    },
)
SETTINGS_ROW = {field["key"]: 4 + index for index, field in enumerate(SETTINGS_FIELDS)}
WEEKDAY_ROW = {index: 14 + index for index in range(7)}


class PlanExcelError(Exception):
    def __init__(self, message, *, code="excel_error", http_status=status.HTTP_400_BAD_REQUEST):
        super().__init__(message)
        self.message = message
        self.code = code
        self.http_status = http_status


def normalize_import_mode(value: Any) -> str:
    raw = str(value or "").strip().lower()
    if raw in LEGACY_MODE_MAP:
        return LEGACY_MODE_MAP[raw]
    if raw in IMPORT_MODES:
        return raw
    raise PlanExcelError("Неизвестный режим импорта.")


def normalize_topic_key(value: str) -> str:
    return " ".join(str(value or "").split()).casefold()


def excel_safe_text(value: Any) -> str:
    text = "" if value is None else str(value)
    if text[:1] in {"=", "+", "-", "@"}:
        return f"'{text}"
    return text


def format_ru_date(value: Any) -> str:
    if isinstance(value, datetime):
        parsed = value.date()
    elif isinstance(value, date):
        parsed = value
    else:
        parsed = parse_plan_date(value)
    if not parsed:
        return ""
    return parsed.strftime("%d.%m.%Y")


def _clip(value: str, limit: int) -> tuple[str, bool]:
    text = str(value or "")
    if len(text) <= limit:
        return text, False
    return text[:limit], True


def _lessons_word(count: int) -> str:
    n = abs(int(count or 0))
    if n % 10 == 1 and n % 100 != 11:
        return "урок"
    if 2 <= n % 10 <= 4 and not (12 <= n % 100 <= 14):
        return "урока"
    return "уроков"


def parse_excel_date(value: Any) -> tuple[date | None, str | None]:
    if value is None or value == "":
        return None, None
    if isinstance(value, datetime):
        return value.date(), None
    if isinstance(value, date):
        return value, None
    if isinstance(value, bool):
        return None, "некорректная дата"
    if isinstance(value, (int, float)):
        try:
            parsed = from_excel(value)
        except Exception:
            return None, "некорректная дата"
        if isinstance(parsed, datetime):
            return parsed.date(), None
        if isinstance(parsed, date):
            return parsed, None
        return None, "некорректная дата"
    raw = str(value).strip()
    if not raw:
        return None, None
    if raw.startswith("="):
        return None, "формулы в дате не поддерживаются"
    for fmt in ("%d.%m.%Y", "%Y-%m-%d", "%d/%m/%Y", "%d.%m.%y", "%d/%m/%y"):
        try:
            return datetime.strptime(raw, fmt).date(), None
        except ValueError:
            continue
    iso = parse_plan_date(raw)
    if iso:
        return iso, None
    return None, f"некорректная дата «{raw}»"


def template_filename(*, title="", subject="", direction="", filled=False) -> str:
    subject_label = get_plan_subject_label(subject) if subject else ""
    level_label = get_plan_level_label(direction) if direction else ""
    if filled and title:
        base = f"План_уроков_{title}"
    elif subject_label and level_label:
        base = f"План_уроков_{subject_label}_{level_label}"
    elif subject_label:
        base = f"План_уроков_{subject_label}"
    else:
        base = "Шаблон_плана_уроков"
    safe = sanitize_filename(re.sub(r"\s+", "_", str(base).strip()))
    if not safe.lower().endswith(".xlsx"):
        safe = f"{safe}.xlsx"
    return safe


def xlsx_response(content: bytes, filename: str) -> HttpResponse:
    response = HttpResponse(
        content,
        content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )
    response["Content-Disposition"] = content_disposition(filename, inline=False)
    return response


def build_plan_workbook(settings: dict | None = None, items: list | None = None) -> bytes:
    settings = dict(settings or {})
    items = list(items or [])
    schedule = resolve_schedule(settings)
    settings["schedule"] = schedule
    wb = Workbook()
    wb.calculation.calcMode = "auto"
    wb.calculation.fullCalcOnLoad = True
    instructions = wb.active
    instructions.title = SHEET_INSTRUCTIONS
    _write_instructions_sheet(instructions)
    lessons = wb.create_sheet(SHEET_LESSONS)
    _write_lessons_sheet(lessons, items, schedule)
    settings_ws = wb.create_sheet(SHEET_SETTINGS)
    meta = wb.create_sheet(SHEET_META)
    _write_meta_sheet(meta, settings)
    _write_settings_sheet(settings_ws, settings, meta)
    _define_schedule_names(wb)
    wb.active = lessons
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _define_schedule_names(wb) -> None:
    from openpyxl.workbook.defined_name import DefinedName

    sheet = f"'{SHEET_SETTINGS}'"
    names = {
        "PlanStartDate": f"{sheet}!$B${SETTINGS_ROW['start_date']}",
        "PlanMode": f"{sheet}!$B${SETTINGS_ROW['schedule_mode']}",
        "PlanStepN": f"{sheet}!$B${SETTINGS_ROW['step_n']}",
    }
    for index, name in enumerate(WEEKDAY_NAMES):
        names[name] = f"{sheet}!$B${WEEKDAY_ROW[index]}"
    for name, ref in names.items():
        wb.defined_names.add(DefinedName(name=name, attr_text=ref))


def _col_letter(key: str) -> str:
    index = next(i for i, col in enumerate(COLUMNS, start=1) if col["key"] == key)
    return get_column_letter(index)


def _write_lessons_sheet(ws, items: list, schedule: dict | None = None) -> None:
    last_col = get_column_letter(len(COLUMNS))
    blank_count = max(len(items) + TEMPLATE_SPARE_ROWS, TEMPLATE_SPARE_ROWS, 2)
    last_row = 1 + blank_count
    ws.freeze_panes = "A2"
    ws.row_dimensions[1].height = 24
    ws.sheet_view.showGridLines = False
    ws.sheet_properties.tabColor = "2563EB"
    ws.page_setup.orientation = "landscape"
    ws.page_setup.fitToPage = True
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.page_setup.paperSize = ws.PAPERSIZE_A4
    ws.sheet_view.zoomScale = 110
    ws.oddHeader.left.text = "Цифровой поток"
    ws.oddHeader.right.text = "План занятий"

    schedule_col = _col_letter("schedule_date")
    manual_col = _col_letter("manual_date")
    effective_col = _col_letter("scheduled_date")
    skip_col = _col_letter("skip_date")
    anchor_col = _col_letter("date_anchor")
    prev_col = _col_letter("prev_anchor")

    for index, col in enumerate(COLUMNS, start=1):
        cell = ws.cell(1, index, col["title"])
        cell.fill = HEADER_FILL
        cell.font = HEADER_FONT
        cell.alignment = Alignment(vertical="center", wrap_text=True, horizontal="center")
        cell.border = THIN
        cell.protection = Protection(locked=False)
        if col.get("hint"):
            cell.comment = Comment(col["hint"], "Цифровой поток")
        ws.column_dimensions[get_column_letter(index)].width = col["width"]
        ws.column_dimensions[get_column_letter(index)].hidden = bool(col["hidden"])

    for row_idx in range(2, last_row + 1):
        item = items[row_idx - 2] if row_idx - 2 < len(items) else None
        ws.row_dimensions[row_idx].height = 32 if item else 22
        banded = BAND_FILL if row_idx % 2 == 0 else WHITE_FILL
        for col_idx, col in enumerate(COLUMNS, start=1):
            cell = ws.cell(row_idx, col_idx)
            cell.font = CELL_FONT
            cell.border = THIN
            cell.fill = banded
            cell.protection = Protection(locked=False)
            cell.alignment = WRAP if col["wrap"] else CENTER
            if col["key"] in DATE_KEYS:
                cell.number_format = "DD.MM.YYYY"
            elif col["key"] not in {"number", "order"}:
                cell.number_format = "@"
        title_col = _col_letter("title")
        topic_col = _col_letter("topic")
        ws.cell(row_idx, _col_index("number")).value = "=ROW()-1"
        ws.cell(row_idx, _col_index("prev_anchor")).value = formula_prev_anchor(anchor_col)
        ws.cell(row_idx, _col_index("schedule_date")).value = formula_schedule(
            row_idx, prev_col, skip_col, title_col, topic_col, manual_col,
        )
        ws.cell(row_idx, _col_index("scheduled_date")).value = formula_effective(row_idx, manual_col, schedule_col)
        ws.cell(row_idx, _col_index("date_anchor")).value = formula_anchor(
            row_idx, prev_col, skip_col, effective_col, title_col, topic_col, manual_col,
        )
        ws.cell(row_idx, _col_index("row_key")).value = _export_row_key(item)
        if item:
            for key in ("item_id", "manual_date", "skip_date", "title", "topic", "subtopic", "task_number", "goal", "description", "homework_description", "teacher_comment", "date_source", "order", "revision"):
                value = _export_cell(key, item, row_idx - 1)
                if value not in (None, ""):
                    ws.cell(row_idx, _col_index(key)).value = value

    manual_letters = manual_col
    dv = DataValidation(
        type="date",
        operator="between",
        formula1="DATE(2000,1,1)",
        formula2="DATE(2100,12,31)",
        allow_blank=True,
        showInputMessage=True,
        promptTitle="Дата вручную",
        prompt="Необязательно. Формат: ДД.ММ.ГГГГ. Следующие автоматические даты продолжатся после этой.",
        showErrorMessage=False,
    )
    dv.add(f"{manual_letters}2:{manual_letters}{last_row}")
    ws.add_data_validation(dv)
    skip_dv = DataValidation(
        type="list",
        formula1='"Да,Нет"',
        allow_blank=True,
        showErrorMessage=False,
        showInputMessage=True,
        promptTitle="Пропустить",
        prompt="Да — строка не сдвигает автоматические даты следующих занятий.",
    )
    skip_dv.add(f"{skip_col}2:{skip_col}{last_row}")
    ws.add_data_validation(skip_dv)

    _add_date_styles(ws, manual_col, schedule_col, effective_col, last_row)
    _add_plan_table(ws, last_col, last_row)
    ws.protection.sheet = False


def _add_date_styles(ws, manual_col: str, schedule_col: str, effective_col: str, last_row: int) -> None:
    """Голубой — автоматическая дата, жёлтый — дата, которую учитель вписал сам."""
    manual_test = f'AND({manual_col}2<>"",{manual_col}2>=DATE(2000,1,1))'
    auto_test = f'AND(OR({manual_col}2="",{manual_col}2<DATE(2000,1,1)),{schedule_col}2>=DATE(2000,1,1))'

    def manual_rule():
        return FormulaRule(formula=[manual_test], fill=MANUAL_DATE_FILL, font=MANUAL_DATE_FONT, stopIfTrue=True)

    def auto_rule():
        return FormulaRule(formula=[auto_test], fill=AUTO_DATE_FILL, font=AUTO_DATE_FONT, stopIfTrue=True)

    ws.conditional_formatting.add(f"{manual_col}2:{manual_col}{last_row}", manual_rule())
    ws.conditional_formatting.add(f"{effective_col}2:{effective_col}{last_row}", manual_rule())
    ws.conditional_formatting.add(f"{effective_col}2:{effective_col}{last_row}", auto_rule())
    ws.conditional_formatting.add(f"{schedule_col}2:{schedule_col}{last_row}", auto_rule())


def _add_plan_table(ws, last_col: str, last_row: int) -> None:
    ref = f"A1:{last_col}{last_row}"
    columns = []
    for index, col in enumerate(COLUMNS, start=1):
        formula = None
        if col["key"] in FORMULA_KEYS:
            raw = ws.cell(2, index).value
            if isinstance(raw, str) and raw.startswith("="):
                formula = TableFormula(attr_text=raw[1:])
        columns.append(TableColumn(id=index, name=col["title"], calculatedColumnFormula=formula))
    table = Table(displayName="PlanLessons", ref=ref, tableColumns=columns)
    table.autoFilter = AutoFilter(ref=ref)
    table.tableStyleInfo = TableStyleInfo(
        name="TableStyleLight1",
        showFirstColumn=False,
        showLastColumn=False,
        showRowStripes=True,
        showColumnStripes=False,
    )
    ws.add_table(table)


def _col_index(key: str) -> int:
    return next(i for i, col in enumerate(COLUMNS, start=1) if col["key"] == key)


def _export_row_key(item: dict | None) -> str:
    if not item:
        return uuid.uuid4().hex
    existing = str(item.get("import_key") or item.get("row_key") or "").strip()
    if existing:
        return existing[:80]
    raw_id = item.get("id")
    if raw_id not in (None, ""):
        try:
            number = int(raw_id)
        except (TypeError, ValueError):
            number = 0
        if number > 0:
            return f"id:{number}"
    return uuid.uuid4().hex


def _export_revision(item: dict | None) -> str:
    if not item:
        return ""
    value = item.get("revision") or item.get("updated_at")
    if value in (None, ""):
        return ""
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value).strip()


def _export_cell(key: str, item: dict, order: int):
    if key == "item_id":
        return item.get("id") or ""
    if key == "revision":
        return _export_revision(item)
    if key == "order":
        return item.get("order") or order
    if key == "date_source":
        return item.get("date_source") or ""
    if key == "skip_date":
        return "Да" if item.get("skip_date") in (True, "Да", "да", "1", 1) else ""
    if key == "manual_date":
        source = str(item.get("date_source") or "").lower()
        if source == "automatic":
            return None
        value = item.get("manual_date", item.get("scheduled_date") if source == "manual" or source == "" else None)
        if source == "manual":
            value = item.get("scheduled_date") or item.get("manual_date")
        elif source == "":
            value = item.get("manual_date") if "manual_date" in item else item.get("scheduled_date")
        if not value:
            return None
        return value if isinstance(value, date) else parse_plan_date(value)
    raw = item.get(key) or ""
    if key in USER_KEYS:
        return excel_safe_text(raw)
    return raw


def _write_instructions_sheet(ws) -> None:
    ws.sheet_view.showGridLines = False
    ws.sheet_properties.tabColor = "64748B"
    ws.page_setup.orientation = "landscape"
    ws.page_setup.fitToPage = True
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 1
    ws.page_setup.paperSize = ws.PAPERSIZE_A4
    ws.page_setup.horizontalCentered = True
    ws.sheet_view.zoomScale = 120
    ws.oddFooter.center.text = "Цифровой поток  ·  план занятий"
    ws.column_dimensions["A"].width = 28
    ws.column_dimensions["B"].width = 36
    ws.column_dimensions["C"].width = 28
    ws.column_dimensions["D"].width = 36
    ws.column_dimensions["E"].width = 36
    ws.merge_cells("A1:E1")
    ws["A1"] = "План занятий в Excel"
    ws["A1"].font = TITLE_FONT
    ws.row_dimensions[1].height = 28
    ws.merge_cells("A2:E2")
    ws["A2"] = "Цифровой поток  ·  краткая инструкция. Рабочий лист — «План занятий»."
    ws["A2"].font = HINT_FONT

    row = 4
    row = _instr_section(ws, row, "1. Назначение файла")
    row = _instr_box(
        ws,
        row,
        "Файл нужен, чтобы править учебный план в Excel и вернуть его на платформу. "
        "Темы, даты и домашние задания остаются теми же занятиями: платформа узнаёт их по скрытому ID, а не по номеру строки.",
    )
    row += 1
    row = _instr_section(ws, row, "2. Как заполнять")
    row = _instr_para(
        ws,
        row,
        "Одно занятие — одна строка на листе «План занятий». Пустые строки внизу уже содержат формулы: "
        "заполните название или тему, и дата посчитается сама. В Excel строка, вставленная внутри таблицы, тоже получает эти формулы. "
        "В LibreOffice пустая вставка формулы не копирует: заполните готовую пустую строку и перетащите её на нужное место. "
        "Жёлтая дата задана вручную и не пересчитывается. Голубая дата автоматическая. Пустая дата остаётся пустой.",
        height=78,
    )
    row = _instr_table(
        ws,
        row,
        ("Столбец", "Кто заполняет", "Что означает", "Пример"),
        (
            ("Дата по расписанию", "Формула", "Следующий учебный день после предыдущего занятия. Формулу лучше не стирать.", "12.10.2026"),
            ("Дата вручную", "Учитель, если нужно", "Исключение. Следующие автоматические даты продолжаются после этого дня.", "16.10.2026"),
            ("Дата", "Формула", "Итог: ручная дата, если она есть, иначе дата по расписанию.", "16.10.2026"),
            ("Пропустить", "Необязательно", "«Да» — строка не занимает день в последовательности.", "Да"),
            ("Тема и название", "Учитель", "Нужно хотя бы одно из двух.", "Системы счисления"),
            ("Домашнее задание", "Учитель", "Текст ДЗ. Файлы и ответы ученика живут на платформе и при импорте не стираются.", "№ 5, 8"),
        ),
    )
    row += 1
    row = _instr_section(ws, row, "3. Учебные дни и даты")
    row = _instr_box(
        ws,
        row,
        "На листе «Настройки расписания» отметьте любые дни от одного до семи: только понедельник, понедельник и четверг, или все дни. "
        "Там же — дата первого занятия, периодичность, при необходимости время и длительность.\n"
        "Пример. Дни: понедельник и четверг. Первая дата 12.10.2026. Дальше сами получатся 15.10, 19.10, 22.10, 26.10. "
        "Если первую дату сменить на 15.10.2026, хвост сдвинется: 19.10, 22.10, 26.10.\n"
        "Если первая дата не попадает на учебный день, на листе настроек появится ближайшая подходящая. Выбранную дату можно оставить.\n"
        "Режим «Без автоматического расписания» ничего не подставляет: даты задаются только вручную. "
        "«Раз в две недели», «каждые N недель» и «каждые N дней» считаются от итоговой даты предыдущей строки.",
        height=96,
    )
    row += 1
    row = _instr_section(ws, row, "4. Что можно менять")
    row = _instr_para(
        ws,
        row,
        "Можно менять темы, содержание, ДЗ, даты, порядок строк, число занятий и продолжительность в настройках. "
        "Добавленная строка без ID станет новым занятием. У строки уже есть скрытый код: повторная загрузка того же файла не создаёт копию. "
        "Если занятие изменили на сайте после скачивания, импорт покажет обе версии и не заменит сайт молча. "
        "Удалённая строка с ID предлагается к удалению из плана — только после подтверждения при импорте.\n"
        "Удаление строки из плана и отмена уже стоящего урока — разные действия. "
        "Строка убирает пункт плана. Урок в календаре сам не отменяется: если он уже создан, проверьте, нужно ли отменить его в расписании.",
        height=72,
    )
    row += 1
    row = _instr_section(ws, row, "5. Импорт обратно")
    row = _instr_para(
        ws,
        row,
        "Сохраните .xlsx без макросов. На платформе: Excel → Импортировать. Перед записью откроется предпросмотр: "
        "сколько занятий без изменений, сколько обновится, добавится и удалится, какие даты сдвинулись и какие связаны с уже созданными уроками.\n"
        "Повторная загрузка того же файла не создаёт дубликаты. Если ID стёрт, изменён или повторён, строка помечается как неясная и не сопоставляется наугад по теме или дате.",
        height=68,
    )
    row += 1
    row = _instr_section(ws, row, "6. Предупреждения")
    row = _instr_box(
        ws,
        row,
        "Жёлтые пометки объясняют последствие, но не запрещают осознанное действие. "
        "Например: удаление занятия, у которого уже есть урок в расписании; дата, которая разошлась с календарём; другое число занятий.\n"
        "Проведённый урок, ответы ученика и журнал не переписываются датой плана. Плановая дата может измениться, фактическая дата состоявшегося занятия — нет.\n"
        "Excel без макросов не умеет спрашивать подтверждение перед удалением строки. Поэтому опасные изменения видны в предпросмотре на платформе.",
        fill=WARN_FILL,
        height=88,
    )

    ws.protection.sheet = True
    ws.protection.enable()
    ws.protection.selectLockedCells = True
    ws.protection.selectUnlockedCells = True
    ws.sheet_view.showGridLines = False



def _instr_section(ws, row: int, title: str) -> int:
    ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=5)
    cell = ws.cell(row, 1, title)
    cell.font = SECTION_FONT
    cell.fill = SECTION_FILL
    cell.alignment = CENTER
    for col in range(1, 6):
        ws.cell(row, col).fill = SECTION_FILL
        ws.cell(row, col).border = THIN
    ws.row_dimensions[row].height = 22
    return row + 1


def _instr_para(ws, row: int, text: str, *, height=48) -> int:
    ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=5)
    cell = ws.cell(row, 1, text)
    cell.font = CELL_FONT
    cell.alignment = Alignment(wrap_text=True, vertical="top")
    ws.row_dimensions[row].height = height
    return row + 1


def _instr_box(ws, row: int, text: str, *, height=56, fill=None) -> int:
    fill = fill or BOX_FILL
    ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=5)
    cell = ws.cell(row, 1, text)
    cell.font = CELL_FONT
    cell.fill = fill
    cell.alignment = Alignment(wrap_text=True, vertical="center")
    for col in range(1, 6):
        ws.cell(row, col).fill = fill
        ws.cell(row, col).border = THIN
    ws.row_dimensions[row].height = height
    return row + 1


def _instr_table(ws, row: int, headers: tuple, rows: tuple) -> int:
    for col, title in enumerate(headers, start=1):
        cell = ws.cell(row, col, title)
        cell.font = HEADER_FONT
        cell.fill = HEADER_FILL
        cell.alignment = CENTER
        cell.border = THIN
    ws.row_dimensions[row].height = 20
    row += 1
    for index, values in enumerate(rows):
        fill = BAND_FILL if index % 2 == 0 else WHITE_FILL
        height = 48 if any(len(str(value)) > 60 for value in values) else 32
        for col, value in enumerate(values, start=1):
            cell = ws.cell(row, col, value)
            cell.font = CELL_FONT
            cell.fill = fill
            cell.alignment = WRAP
            cell.border = THIN
        ws.row_dimensions[row].height = height
        row += 1
    return row


def _instr_example(ws, row: int, left_title: str, left_rows: tuple, mid_title: str, mid_rows: tuple, right_title: str, right_rows: tuple) -> int:
    ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=2)
    ws.merge_cells(start_row=row, start_column=3, end_row=row, end_column=3)
    ws.merge_cells(start_row=row, start_column=4, end_row=row, end_column=5)
    for col, title in ((1, left_title), (3, mid_title), (4, right_title)):
        cell = ws.cell(row, col, title)
        cell.font = LABEL_FONT
        cell.fill = BOX_FILL
        cell.alignment = CENTER
    ws.cell(row, 2).fill = BOX_FILL
    ws.cell(row, 5).fill = BOX_FILL
    row += 1
    count = max(len(left_rows), len(mid_rows), len(right_rows))
    for index in range(count):
        left = left_rows[index] if index < len(left_rows) else ("", "")
        mid = mid_rows[index] if index < len(mid_rows) else ("", "")
        right = right_rows[index] if index < len(right_rows) else ("", "")
        ws.cell(row, 1, left[0]).font = CELL_FONT
        ws.cell(row, 2, left[1]).font = CELL_FONT
        ws.cell(row, 3, f"{mid[0]}  {mid[1]}".strip()).font = CELL_FONT
        ws.cell(row, 4, right[0]).font = CELL_FONT
        ws.cell(row, 5, right[1]).font = CELL_FONT
        for col in range(1, 6):
            ws.cell(row, col).border = THIN
            ws.cell(row, col).alignment = CENTER
        row += 1
    return row + 1


def _write_settings_sheet(ws, settings: dict, meta) -> None:
    schedule = settings.get("schedule") or resolve_schedule(settings)
    ws.sheet_view.showGridLines = False
    ws.sheet_properties.tabColor = "0F766E"
    ws.page_setup.orientation = "landscape"
    ws.page_setup.fitToPage = True
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 1
    ws.page_setup.paperSize = ws.PAPERSIZE_A4
    ws.page_setup.horizontalCentered = True
    ws.sheet_view.zoomScale = 120
    ws.oddFooter.left.text = "Цифровой поток"
    ws.oddFooter.right.text = "Настройки расписания"
    ws.column_dimensions["A"].width = 32
    ws.column_dimensions["B"].width = 36
    ws.column_dimensions["C"].width = 78
    ws.merge_cells("A1:C1")
    ws["A1"] = "Настройки расписания"
    ws["A1"].font = TITLE_FONT
    ws.merge_cells("A2:C2")
    ws["A2"] = "Меняйте столбец B. Дни недели — отдельные ячейки «Да» или «Нет», строку дней вписывать не нужно."
    ws["A2"].font = HINT_FONT
    ws["A2"].alignment = Alignment(wrap_text=True, vertical="center")
    ws.row_dimensions[2].height = 28

    subject_label = get_plan_subject_label(settings.get("subject") or "") or settings.get("subject") or ""
    level_label = get_plan_level_label(settings.get("direction") or "") or settings.get("direction") or ""
    start = schedule.get("start") or parse_plan_date(settings.get("start_date"))
    values = {
        "subject": subject_label,
        "direction": level_label,
        "grade": settings.get("grade") or "",
        "start_date": start or "",
        "schedule_mode": schedule.get("mode") or "",
        "step_n": schedule.get("step_n") or "",
        "start_time": schedule.get("start_time") or settings.get("start_time") or "",
        "duration_minutes": schedule.get("duration_minutes") or settings.get("duration_minutes") or "",
    }
    for field in SETTINGS_FIELDS:
        row = SETTINGS_ROW[field["key"]]
        label_cell = ws.cell(row, 1, field["label"])
        label_cell.font = LABEL_FONT
        label_cell.fill = BOX_FILL
        label_cell.alignment = CENTER
        label_cell.border = THIN
        label_cell.protection = Protection(locked=True)
        value_cell = ws.cell(row, 2, values.get(field["key"]) or "")
        value_cell.font = CELL_FONT
        value_cell.alignment = CENTER
        value_cell.border = THIN
        value_cell.protection = Protection(locked=False)
        value_cell.fill = WHITE_FILL
        if field["kind"] == "date":
            value_cell.number_format = "DD.MM.YYYY"
        if field["kind"] == "time" and values.get(field["key"]):
            value_cell.number_format = "HH:MM"
        hint_cell = ws.cell(row, 3, field["hint"])
        hint_cell.font = HINT_FONT
        hint_cell.alignment = Alignment(wrap_text=True, vertical="center")
        hint_cell.protection = Protection(locked=True)
        ws.row_dimensions[row].height = 24

    section = WEEKDAY_ROW[0] - 1
    ws.merge_cells(start_row=section, start_column=1, end_row=section, end_column=3)
    title = ws.cell(section, 1, "Учебные дни")
    title.font = SECTION_FONT
    title.fill = SECTION_FILL
    for col in range(1, 4):
        ws.cell(section, col).fill = SECTION_FILL
        ws.cell(section, col).border = THIN
        ws.cell(section, col).protection = Protection(locked=True)
    selected = set(schedule.get("weekdays") or [])
    for index, label in enumerate(WEEKDAY_SETTING_LABELS):
        row = WEEKDAY_ROW[index]
        label_cell = ws.cell(row, 1, label)
        label_cell.font = LABEL_FONT
        label_cell.fill = BOX_FILL
        label_cell.border = THIN
        label_cell.protection = Protection(locked=True)
        value_cell = ws.cell(row, 2, "Да" if index in selected else "Нет")
        value_cell.font = CELL_FONT
        value_cell.alignment = CENTER
        value_cell.border = THIN
        value_cell.protection = Protection(locked=False)
        value_cell.fill = WHITE_FILL
        hint = ws.cell(row, 3, "Да — в этот день есть занятие. Можно выбрать от 1 до 7 дней.")
        hint.font = HINT_FONT
        hint.protection = Protection(locked=True)

    warn_row = WEEKDAY_ROW[6] + 2
    ws.merge_cells(start_row=warn_row, start_column=1, end_row=warn_row, end_column=2)
    warn = ws.cell(
        warn_row,
        1,
        "Если первая дата не совпадает с учебным днём, ближайшая подходящая появится справа. Выбранную дату можно оставить.",
    )
    warn.font = HINT_FONT
    warn.alignment = Alignment(wrap_text=True, vertical="center")
    warn.fill = WARN_FILL
    ws.cell(warn_row, 2).fill = WARN_FILL
    nearest = ws.cell(warn_row, 3, formula_nearest_start())
    nearest.font = LABEL_FONT
    nearest.number_format = "DD.MM.YYYY"
    nearest.fill = WARN_FILL
    ws.row_dimensions[warn_row].height = 36
    for col in range(1, 4):
        ws.cell(warn_row, col).border = THIN
        ws.cell(warn_row, col).protection = Protection(locked=True)

    _add_settings_validation(ws, meta)
    ws.protection.sheet = True
    ws.protection.enable()
    ws.protection.insertRows = False
    ws.protection.deleteRows = False
    ws.protection.insertColumns = False
    ws.protection.deleteColumns = False
    ws.protection.formatCells = True
    ws.protection.selectLockedCells = True
    ws.protection.selectUnlockedCells = True


def _add_settings_validation(ws, meta) -> None:
    subject_labels = [item["label"] for item in get_plan_subject_options()]
    level_labels = [item["label"] for item in get_plan_level_options()]
    _write_meta_list(meta, 4, "subjects", subject_labels)
    _write_meta_list(meta, 5, "levels", level_labels)
    _write_meta_list(meta, 6, "grades", list(GRADE_CHOICES))
    _write_meta_list(meta, 7, "modes", list(SCHEDULE_MODES))

    def list_dv(col_letter: str, last_row: int, title: str, prompt: str):
        formula = f"'{SHEET_META}'!${col_letter}$2:${col_letter}${last_row}"
        return DataValidation(
            type="list",
            formula1=formula,
            allow_blank=True,
            showDropDown=False,
            showErrorMessage=False,
            showInputMessage=True,
            promptTitle=title,
            prompt=prompt,
        )

    subject_dv = list_dv("D", 1 + max(len(subject_labels), 1), "Предмет", "Выберите предмет плана.")
    subject_dv.add(f"B{SETTINGS_ROW['subject']}")
    ws.add_data_validation(subject_dv)
    level_dv = list_dv("E", 1 + max(len(level_labels), 1), "Уровень", "Выберите уровень плана.")
    level_dv.add(f"B{SETTINGS_ROW['direction']}")
    ws.add_data_validation(level_dv)
    grade_dv = list_dv("F", 1 + len(GRADE_CHOICES), "Класс", "Выберите класс или введите свой вариант.")
    grade_dv.add(f"B{SETTINGS_ROW['grade']}")
    ws.add_data_validation(grade_dv)
    date_dv = DataValidation(
        type="date",
        operator="between",
        formula1="DATE(2000,1,1)",
        formula2="DATE(2100,12,31)",
        allow_blank=True,
        showErrorMessage=False,
        showInputMessage=True,
        promptTitle="Дата первого занятия",
        prompt="Формат: ДД.ММ.ГГГГ.",
    )
    date_dv.add(f"B{SETTINGS_ROW['start_date']}")
    ws.add_data_validation(date_dv)
    mode_dv = list_dv("G", 1 + len(SCHEDULE_MODES), "Режим", "Как считать даты занятий.")
    mode_dv.add(f"B{SETTINGS_ROW['schedule_mode']}")
    ws.add_data_validation(mode_dv)
    yes_no = DataValidation(
        type="list",
        formula1='"Да,Нет"',
        allow_blank=False,
        showErrorMessage=False,
        showInputMessage=True,
        promptTitle="Учебный день",
        prompt="Да или Нет.",
    )
    first = WEEKDAY_ROW[0]
    last = WEEKDAY_ROW[6]
    yes_no.add(f"B{first}:B{last}")
    ws.add_data_validation(yes_no)


def _write_meta_list(ws, column: int, name: str, values: list[str]) -> None:
    ws.cell(1, column, name)
    for index, value in enumerate(values, start=2):
        ws.cell(index, column, value)


def _write_meta_sheet(ws, settings: dict) -> None:
    schedule = settings.get("schedule") or resolve_schedule(settings)
    ws.sheet_state = "hidden"
    rows = {
        "template_version": TEMPLATE_VERSION,
        "plan_id": settings.get("plan_id") or "",
        "subject": settings.get("subject") or "",
        "direction": settings.get("direction") or "",
        "interval": schedule.get("interval") or settings.get("interval") or "",
        "start_date": settings.get("start_date") or "",
        "grade": settings.get("grade") or "",
        "schedule_mode": schedule.get("mode") or "",
        "weekdays": ",".join(str(day) for day in (schedule.get("weekdays") or [])),
        "step_n": schedule.get("step_n") or "",
        "start_time": schedule.get("start_time") or settings.get("start_time") or "",
        "duration_minutes": schedule.get("duration_minutes") or settings.get("duration_minutes") or "",
    }
    for index, (key, value) in enumerate(rows.items(), start=1):
        ws.cell(index, 1, key)
        ws.cell(index, 2, value)


def read_uploaded_bytes(uploaded) -> bytes:
    if uploaded is None:
        raise PlanExcelError("Выберите файл Excel.")
    name = str(getattr(uploaded, "name", "") or "")
    if name and not name.lower().endswith(".xlsx"):
        raise PlanExcelError("Нужен файл в формате .xlsx. CSV, XLS и XLSM не подходят.")
    size = getattr(uploaded, "size", None)
    if size is not None and size > MAX_FILE_BYTES:
        raise PlanExcelError("Файл слишком большой. Загрузите Excel размером до 4 МБ.")
    data = uploaded.read()
    if not data:
        raise PlanExcelError("Файл пустой.")
    if len(data) > MAX_FILE_BYTES:
        raise PlanExcelError("Файл слишком большой. Загрузите Excel размером до 4 МБ.")
    if data[:2] != b"PK":
        raise PlanExcelError("Файл не похож на Excel-шаблон. Сохраните его как .xlsx.")
    return data


def parse_plan_workbook(
    data: bytes,
    *,
    existing_items: list | None = None,
    start_date: Any = None,
    interval: str = "weekly",
    extra_topics: list[str] | None = None,
    mode: str = MODE_REPLACE_ALL,
    confirm_deletes: bool = False,
    exclude_rows: list | None = None,
    exclude_deletes: list | None = None,
    accept_conflicts: list | None = None,
    move_event_rows: list | None = None,
) -> dict:
    parsed = _parse_workbook_rows(data, extra_topics=extra_topics)
    return build_excel_import_plan(
        parsed,
        existing_items=existing_items,
        start_date=start_date,
        interval=interval,
        mode=mode,
        confirm_deletes=confirm_deletes,
        exclude_rows=exclude_rows,
        exclude_deletes=exclude_deletes,
        accept_conflicts=accept_conflicts,
        move_event_rows=move_event_rows,
    )


def _parse_workbook_rows(data: bytes, *, extra_topics: list[str] | None = None) -> dict:
    try:
        wb = load_workbook(io.BytesIO(data), data_only=False, read_only=False, keep_vba=False)
    except Exception as exc:
        logger.info("plan excel open failed: %s", exc)
        raise PlanExcelError("Не удалось прочитать файл. Убедитесь, что это .xlsx без макросов.") from exc
    if getattr(wb, "vba_archive", None):
        raise PlanExcelError("Файлы с макросами не поддерживаются. Сохраните шаблон как .xlsx.")

    version = _read_template_version(wb)
    if version not in SUPPORTED_TEMPLATE_VERSIONS:
        raise PlanExcelError(
            f"Этот шаблон версии {version} пока не поддерживается. Скачайте актуальный шаблон."
        )
    file_settings = _read_file_settings(wb)
    ws, header_map, extra_headers = _find_lessons_sheet(wb)
    file_settings["engine"] = "v3" if (
        "manual_date" in header_map or "schedule_date" in header_map or version == TEMPLATE_VERSION
    ) else "legacy"
    warnings = []
    if extra_headers:
        extras = ", ".join(extra_headers[:6])
        warnings.append(f"Лишние столбцы проигнорированы: {extras}.")

    topic_canon = {}
    for topic in extra_topics or []:
        key = normalize_topic_key(topic)
        if key and key not in topic_canon:
            topic_canon[key] = str(topic).strip()

    rows = []
    skipped_empty = 0
    pending_empty = 0
    seen_lesson = False
    for excel_row in range(2, (ws.max_row or 1) + 1):
        raw = {key: ws.cell(excel_row, col_idx).value for key, col_idx in header_map.items()}
        if _row_is_empty(raw):
            if seen_lesson:
                pending_empty += 1
            continue
        if pending_empty:
            skipped_empty += pending_empty
            pending_empty = 0
        seen_lesson = True
        parsed = _parse_lesson_row(raw, excel_row=excel_row, topic_canon=topic_canon)
        rows.append(parsed)
        if len(rows) > MAX_LESSONS:
            raise PlanExcelError(
                f"В файле больше {MAX_LESSONS} уроков. За один раз можно импортировать не более {MAX_LESSONS}."
            )

    if not rows:
        raise PlanExcelError("В файле нет уроков для импорта. Заполните хотя бы одну строку.")

    return {
        "template_version": version or TEMPLATE_VERSION,
        "warnings": warnings,
        "rows": rows,
        "skipped_empty": skipped_empty,
        "settings": file_settings,
    }


def build_excel_import_plan(
    parsed: dict,
    *,
    existing_items: list | None = None,
    start_date: Any = None,
    interval: str = "weekly",
    mode: str = MODE_REPLACE_ALL,
    confirm_deletes: bool = False,
    exclude_rows: list | None = None,
    exclude_deletes: list | None = None,
    accept_conflicts: list | None = None,
    move_event_rows: list | None = None,
) -> dict:
    mode = normalize_import_mode(mode)
    file_settings = dict(parsed.get("settings") or {})
    excluded_rows = {int(row) for row in (exclude_rows or []) if str(row).strip().isdigit()}
    excluded_deletes = {int(row) for row in (exclude_deletes or []) if str(row).strip().isdigit()}
    accepted_conflicts = {int(row) for row in (accept_conflicts or []) if str(row).strip().isdigit()}
    move_rows = {int(row) for row in (move_event_rows or []) if str(row).strip().isdigit()}
    source_rows = list(parsed.get("rows") or [])
    if file_settings.get("start_date"):
        start = parse_plan_date(file_settings.get("start_date"))
    else:
        start = parse_plan_date(start_date) or _first_explicit_date(source_rows)
    if file_settings.get("interval"):
        interval = normalize_interval(file_settings.get("interval"))
    else:
        interval = normalize_interval(interval or "weekly")
    file_settings["start_date"] = start.isoformat() if start else file_settings.get("start_date") or ""
    if not file_settings.get("interval"):
        file_settings["interval"] = interval
    schedule = resolve_schedule(file_settings)
    file_settings["interval"] = schedule["interval"] or interval
    file_settings["schedule_mode"] = schedule["mode"]
    file_settings["weekdays"] = schedule["weekdays"]
    file_settings["step_n"] = schedule["step_n"]
    existing_entries = _existing_entries(existing_items or [], file_settings["interval"])
    topic_canon = {}
    for entry in existing_entries:
        key = normalize_topic_key(entry.get("topic") or "")
        if key and key not in topic_canon:
            topic_canon[key] = str(entry.get("topic") or "").strip()
    rows = [_with_canonical_topic(row, topic_canon) for row in source_rows]
    date_warnings = []
    if file_settings.get("engine") == "v3" and mode in {MODE_REPLACE_ALL, MODE_SYNC}:
        date_warnings = _assign_v3_dates(rows, file_settings)

    if mode == MODE_SYNC:
        plan = _resolve_sync(
            rows,
            existing_entries,
            confirm_deletes=confirm_deletes,
            exclude_rows=excluded_rows,
            exclude_deletes=excluded_deletes,
            accept_conflicts=accepted_conflicts,
            move_event_rows=move_rows,
        )
    elif mode == MODE_REPLACE_ALL:
        plan = _resolve_replace_all(
            rows,
            existing_entries,
            start,
            interval,
            assign_legacy=file_settings.get("engine") != "v3",
        )
    elif mode == MODE_INSERT:
        plan = _resolve_insert(rows, existing_entries, start, interval)
    else:
        plan = _resolve_replace_dates(rows, existing_entries)

    warnings = list(parsed.get("warnings") or []) + date_warnings + list(plan.get("warnings") or [])
    if schedule.get("warning"):
        warnings.append(schedule["warning"])
    errors = sum(1 for row in plan["rows"] if row["status"] == "error")
    warn_rows = sum(1 for row in plan["rows"] if row["status"] in {"warning", "retain", "ambiguous", "conflict"})
    can_import = errors == 0 and not plan.get("blocking_errors")
    auto_dates = sum(1 for row in plan["rows"] if row["item"].get("date_source") == "automatic" and row["item"].get("scheduled_date"))
    manual_dates = sum(1 for row in plan["rows"] if row["item"].get("date_source") == "manual")
    summary = {
        "found": len(rows),
        "file_count": len(rows),
        "current_count": len(existing_entries),
        "after_count": plan.get("after_count", len(existing_entries)),
        "added": plan.get("added", 0),
        "replaced": plan.get("replaced", 0),
        "updated": plan.get("updated", plan.get("replaced", 0)),
        "unchanged": plan.get("unchanged", 0),
        "deleted": plan.get("deleted", 0),
        "dates_changed": plan.get("dates_changed", 0),
        "linked": plan.get("linked", 0),
        "attention": plan.get("attention", 0),
        "conflicts": plan.get("conflicts", 0),
        "excluded": plan.get("excluded", 0),
        "skip": parsed.get("skipped_empty") or 0,
        "errors": errors + len(plan.get("blocking_errors") or []),
        "warnings": warn_rows + len(warnings),
        "auto_dates": auto_dates,
        "manual_dates": manual_dates,
        "subsequent_shift": bool(plan.get("shifts")),
    }
    stored_interval = file_settings.get("interval") or interval
    return {
        "ok": True,
        "mode": mode,
        "template_version": parsed.get("template_version") or TEMPLATE_VERSION,
        "warnings": warnings,
        "blocking_errors": plan.get("blocking_errors") or [],
        "confirmation": plan.get("confirmation") or "",
        "summary": summary,
        "rows": plan["rows"],
        "shifts": plan.get("shifts") or [],
        "operations": plan.get("operations") or [],
        "settings": {
            **file_settings,
            "start_date": start.isoformat() if start else "",
            "interval": stored_interval,
        },
        "can_import": can_import,
        "start_date": start.isoformat() if start else "",
        "interval": stored_interval,
    }


def apply_plan_excel_import(plan: LessonPlan, preview: dict, *, mode: str, teacher) -> dict:
    mode = normalize_import_mode(mode or preview.get("mode"))
    from rest_framework.exceptions import ValidationError as DRFValidationError
    from .serializers import LessonPlanItemEditorSerializer

    if preview.get("mode") and preview["mode"] != mode:
        raise PlanExcelError("Предпросмотр построен для другого режима. Загрузите файл снова.")
    if not preview.get("can_import"):
        first = next((row for row in preview.get("rows") or [] if row.get("status") == "error"), None)
        message = ""
        if first and first.get("messages"):
            message = str(first["messages"][0])
        elif preview.get("blocking_errors"):
            message = str(preview["blocking_errors"][0])
        raise PlanExcelError(message or "Сначала исправьте ошибки в файле.")

    operations = list(preview.get("operations") or [])
    created = 0
    updated = 0
    deleted = 0
    item_dates = []
    event_moves = []

    with transaction.atomic():
        existing = list(plan.items.select_related("scheduled_event").prefetch_related("schedule_events_linked").order_by("order", "id"))
        existing_by_id = {item.pk: item for item in existing}

        if mode == MODE_REPLACE_ALL:
            blocked = [item for item in existing if _item_in_use(item)]
            if blocked:
                titles = ", ".join(item.title for item in blocked[:3])
                raise PlanExcelError(f"Нельзя обновить план целиком: занятие «{titles}» уже стоит в расписании.")
            for item in existing:
                item.delete()
                deleted += 1
            existing_by_id = {}

        for operation in operations:
            op = operation.get("op")
            payload = _serializer_payload(operation.get("item") or {}, operation.get("order") or 1)
            target_id = operation.get("id")
            instance = existing_by_id.get(int(target_id)) if target_id else None
            if instance is None and target_id:
                raise PlanExcelError("Нельзя изменить урок, который не относится к текущему плану.")
            try:
                if op == "delete":
                    if instance is None:
                        raise PlanExcelError("Нельзя удалить урок, который не относится к текущему плану.")
                    if _protected_reason(instance):
                        continue
                    instance.delete()
                    deleted += 1
                    continue
                if op == "retain":
                    continue
                if op == "update":
                    if instance is None:
                        raise PlanExcelError("Нельзя изменить урок, который не относится к текущему плану.")
                    serializer = LessonPlanItemEditorSerializer(
                        instance,
                        data=payload,
                        partial=True,
                        context={"teacher": teacher},
                    )
                    serializer.is_valid(raise_exception=True)
                    item = serializer.save()
                    updated += 1
                elif op == "create":
                    serializer = LessonPlanItemEditorSerializer(data=payload, context={"teacher": teacher})
                    serializer.is_valid(raise_exception=True)
                    item = serializer.save(plan=plan, status=_status_for_date(payload.get("scheduled_date")))
                    _remember_import_key(item, (operation.get("item") or {}).get("import_key"))
                    created += 1
                else:
                    continue
            except DRFValidationError as exc:
                raise PlanExcelError("Не удалось сохранить урок. Проверьте названия и длины полей.") from exc
            if op == "update" and operation.get("move_event"):
                event_moves.append(_move_linked_event(item, teacher, payload.get("scheduled_date")))
            item_dates.append({
                "id": item.pk,
                "date_source": (operation.get("item") or {}).get("date_source") or "",
            })

        _apply_plan_settings(plan, preview.get("settings") or {})
        plan.lessons_count = plan.items.count()
        plan.save(update_fields=["lessons_count", "updated_at", "subject", "direction", "grade"])

    return {
        "created": created,
        "updated": updated,
        "deleted": deleted,
        "mode": mode,
        "auto_dates": preview["summary"].get("auto_dates") or 0,
        "manual_dates": preview["summary"].get("manual_dates") or 0,
        "skipped": preview["summary"].get("skip") or 0,
        "item_dates": item_dates,
        "event_moves": event_moves,
    }


def _plan_date_only(item_id, title, reason, event) -> dict:
    stayed = "Урок в расписании остался на прежней дате."
    if event is not None and getattr(event, "starts_at", None):
        stayed = f"Урок в расписании остался на {timezone.localtime(event.starts_at).strftime('%d.%m.%Y')}."
    return {
        "id": item_id,
        "moved": False,
        "detail": f"«{title}»: {reason} Изменилась только плановая дата. {stayed}",
    }


def _remember_import_key(item, key) -> None:
    text = str(key or "").strip()[:80]
    if not text or text.lower().startswith("id:") or text == (item.import_key or ""):
        return
    LessonPlanItem.objects.filter(pk=item.pk).update(import_key=text)


def _move_linked_event(item, teacher, new_date) -> dict:
    event = item.scheduled_event if getattr(item, "scheduled_event_id", None) else None
    if event is None:
        event = item.schedule_events_linked.exclude(status=ScheduleEvent.Status.CANCELLED).first()
    title = item.title or "Занятие"
    if event is None:
        return _plan_date_only(item.pk, title, "событие в календаре не найдено.", None)
    if getattr(teacher, "id", None) and event.owner_id != teacher.id:
        return _plan_date_only(item.pk, title, "нет права переносить это событие.", event)
    if event.status in {
        ScheduleEvent.Status.DONE,
        ScheduleEvent.Status.COMPLETED,
        ScheduleEvent.Status.CANCELLED,
        ScheduleEvent.Status.SKIPPED,
    } or _protected_reason(item):
        return _plan_date_only(item.pk, title, "проведённый или отменённый урок переносить нельзя.", event)
    try:
        journal = event.journal
    except Exception:
        journal = None
    if journal is not None:
        return _plan_date_only(item.pk, title, "у урока есть журнал.", event)
    new_day = parse_plan_date(new_date)
    if new_day is None:
        return _plan_date_only(item.pk, title, "нет даты для переноса события.", event)
    from .schedule_service import check_conflicts, resolve_schedule_timezone

    zone = resolve_schedule_timezone(event=event, teacher=teacher)
    local = timezone.localtime(event.starts_at, zone)
    try:
        new_start = timezone.make_aware(datetime.combine(new_day, local.time().replace(microsecond=0)), zone)
    except Exception:
        return _plan_date_only(item.pk, title, "эту дату нельзя поставить в календарь.", event)
    new_end = new_start + (event.ends_at - event.starts_at)
    conflicts = check_conflicts(
        teacher=event.owner,
        starts_at=new_start,
        ends_at=new_end,
        student_id=event.student_id,
        group_id=event.group_id,
        exclude_event_id=event.pk,
        travel_before_minutes=event.travel_before_minutes or 0,
        travel_after_minutes=event.travel_after_minutes or 0,
        all_day=bool(event.all_day),
    )
    if conflicts:
        return _plan_date_only(item.pk, title, "новое время уже занято другим занятием.", event)
    event.starts_at = new_start
    event.ends_at = new_end
    event.save(update_fields=["starts_at", "ends_at", "updated_at"])
    return {"id": item.pk, "moved": True, "detail": f"«{title}»: событие расписания перенесено на новую дату."}


def _apply_plan_settings(plan: LessonPlan, settings: dict) -> None:
    subject = str(settings.get("subject") or "").strip()
    direction = str(settings.get("direction") or "").strip()
    grade = str(settings.get("grade") or "").strip()
    if subject:
        plan.subject = subject[:20]
    if direction:
        plan.direction = direction[:20]
    if grade:
        plan.grade = grade[:32]
    if settings.get("engine") != "v3" and not settings.get("schedule_mode"):
        return
    schedule = resolve_schedule(settings)
    if not schedule.get("mode"):
        return
    from .choices import EnrollmentStatus
    from .models import LessonPlanEnrollment

    weekdays = schedule.get("weekdays") or []
    start_time = parse_clock(schedule.get("start_time") or "16:00").strftime("%H:%M")
    duration = int(schedule.get("duration_minutes") or 60)
    slots = [
        {"weekday": day, "start_time": start_time, "duration_minutes": min(24 * 60, max(15, duration))}
        for day in weekdays
    ]
    LessonPlanEnrollment.objects.filter(plan=plan).exclude(
        status__in=[EnrollmentStatus.COMPLETED, EnrollmentStatus.CANCELLED],
    ).update(frequency=schedule.get("interval") or "", weekday_slots=slots)


def _status_for_date(scheduled):
    return PlanItemStatus.PLANNED if scheduled else PlanItemStatus.NOT_STARTED


def _item_in_use(item) -> bool:
    if isinstance(item, dict):
        return bool(item.get("in_use"))
    if getattr(item, "scheduled_event_id", None):
        return True
    linked = item.schedule_events_linked.exclude(status=ScheduleEvent.Status.CANCELLED)
    return linked.exists()


def _serializer_payload(item: dict, order: int) -> dict:
    scheduled = item.get("scheduled_date")
    if hasattr(scheduled, "isoformat"):
        scheduled = scheduled.isoformat()
    return {
        "order": order,
        "title": item.get("title") or "",
        "topic": item.get("topic") or "",
        "subtopic": item.get("subtopic") or "",
        "task_number": item.get("task_number") or "",
        "goal": item.get("goal") or "",
        "description": item.get("description") or "",
        "homework_description": item.get("homework_description") or "",
        "teacher_comment": item.get("teacher_comment") or "",
        "scheduled_date": scheduled or None,
    }


def _read_template_version(wb) -> str:
    meta = _read_meta_settings(wb)
    return str(meta.get("template_version") or "").strip()


def _read_meta_settings(wb) -> dict:
    settings = {}
    if SHEET_META not in wb.sheetnames:
        return settings
    meta = wb[SHEET_META]
    for row in meta.iter_rows(min_row=1, max_row=16, max_col=2, values_only=True):
        key = str(row[0] or "").strip()
        if key:
            settings[key] = row[1]
    return settings


def _read_file_settings(wb) -> dict:
    settings = _read_meta_settings(wb)
    parsed = {
        "subject": normalize_plan_subject_id(settings.get("subject") or "") or "",
        "direction": normalize_plan_level_id(settings.get("direction") or "") or "",
        "grade": str(settings.get("grade") or "").strip(),
        "start_date": settings.get("start_date") or "",
        "interval": settings.get("interval") or "",
        "schedule_mode": settings.get("schedule_mode") or "",
        "weekdays": settings.get("weekdays") or "",
        "step_n": settings.get("step_n") or "",
        "start_time": settings.get("start_time") or "",
        "duration_minutes": settings.get("duration_minutes") or "",
    }
    ws = None
    for name in SETTINGS_SHEET_NAMES:
        if name in wb.sheetnames:
            ws = wb[name]
            break
    if ws is not None:
        by_label = {field["label"]: field["key"] for field in SETTINGS_FIELDS}
        by_label.update({label: "weekday" for label in WEEKDAY_SETTING_LABELS})
        by_label["Дата начала"] = "start_date"
        by_label["Расписание"] = "interval"
        weekdays = []
        seen_weekday = False
        for row in ws.iter_rows(min_row=1, max_row=30, max_col=2, values_only=True):
            label = str(row[0] or "").strip()
            key = by_label.get(label)
            if key == "weekday":
                seen_weekday = True
                if str(row[1] or "").strip().casefold() == "да":
                    weekdays.append(WEEKDAY_SETTING_LABELS.index(label))
                continue
            if not key:
                continue
            parsed[key] = row[1]
        if seen_weekday:
            parsed["weekdays"] = weekdays
    return _normalize_settings_values(parsed)


def _normalize_settings_values(raw: dict) -> dict:
    subject = _match_option(raw.get("subject"), get_plan_subject_options(), normalize_plan_subject_id)
    direction = _match_option(raw.get("direction"), get_plan_level_options(), normalize_plan_level_id)
    interval_raw = raw.get("interval")
    interval = ""
    if interval_raw not in (None, ""):
        label_map = {label.casefold(): key for key, label in INTERVAL_LABELS.items()}
        text = str(interval_raw).strip()
        interval = label_map.get(text.casefold()) or normalize_interval(text)
    start, _err = parse_excel_date(raw.get("start_date"))
    grade = str(raw.get("grade") or "").strip()
    weekdays = raw.get("weekdays")
    if isinstance(weekdays, str):
        weekdays = normalize_weekdays([part for part in weekdays.replace(";", ",").split(",") if part != ""])
    else:
        weekdays = normalize_weekdays(weekdays)
    schedule_mode = str(raw.get("schedule_mode") or "").strip()
    step_n = raw.get("step_n") or ""
    start_time = str(raw.get("start_time") or "").strip()
    if hasattr(raw.get("start_time"), "strftime"):
        start_time = raw.get("start_time").strftime("%H:%M")
    duration = raw.get("duration_minutes") or ""
    return {
        "subject": subject,
        "direction": direction,
        "grade": grade,
        "start_date": start.isoformat() if start else "",
        "interval": interval,
        "schedule_mode": schedule_mode,
        "weekdays": weekdays,
        "step_n": step_n,
        "start_time": start_time,
        "duration_minutes": duration,
    }


def _match_option(value, options, normalize) -> str:
    if value in (None, ""):
        return ""
    raw = str(value).strip()
    nid = normalize(raw)
    for item in options:
        if item["id"] == nid or item["label"].casefold() == raw.casefold():
            return item["id"]
    return nid


def _find_lessons_sheet(wb):
    candidates = []
    seen = set()
    for name in LESSON_SHEET_NAMES:
        if name in wb.sheetnames and name not in seen:
            candidates.append(wb[name])
            seen.add(name)
    for ws in wb.worksheets:
        if ws.title in seen or ws.title in {SHEET_INSTRUCTIONS, SHEET_SETTINGS, SHEET_SETTINGS_LEGACY, SHEET_META}:
            continue
        candidates.append(ws)
    last_missing = list(REQUIRED_HEADERS)
    extra = []
    for ws in candidates:
        header_map, extra_headers, missing = _map_headers(ws)
        extra = extra_headers
        if missing:
            last_missing = missing
            continue
        return ws, header_map, extra_headers
    missing = last_missing[0] if last_missing else "Название урока"
    raise PlanExcelError(f"Файл не соответствует шаблону. Не найден столбец «{missing}».")


def _map_headers(ws) -> tuple[dict, list, list]:
    header_map = {}
    extra = []
    for col_idx in range(1, (ws.max_column or 0) + 1):
        title = str(ws.cell(1, col_idx).value or "").strip()
        if not title:
            continue
        key = HEADER_ALIASES.get(title)
        if key:
            header_map[key] = col_idx
        else:
            extra.append(title)
    missing = []
    if "title" not in header_map:
        missing.append("Название урока")
    if "topic" not in header_map:
        missing.append("Тема")
    if "scheduled_date" not in header_map and "schedule_date" not in header_map and "manual_date" not in header_map:
        missing.append("Дата")
    return header_map, extra, missing


def _is_formula(value: Any) -> bool:
    return isinstance(value, str) and value.startswith("=")


def _meaningful(value: Any) -> bool:
    if value in (None, ""):
        return False
    if _is_formula(value):
        return False
    return True


def _row_is_empty(raw: dict) -> bool:
    for key in ("title", "topic", "subtopic", "task_number", "goal", "description", "homework_description", "teacher_comment", "manual_date"):
        if _meaningful(raw.get(key)):
            return False
    legacy = "manual_date" not in raw and "schedule_date" not in raw
    if legacy and _meaningful(raw.get("scheduled_date")):
        return False
    if not legacy and _meaningful(raw.get("scheduled_date")) and not _is_formula(raw.get("scheduled_date")):
        return False
    if not legacy and _meaningful(raw.get("schedule_date")) and not _is_formula(raw.get("schedule_date")):
        return False
    return True


def _parse_lesson_row(raw: dict, *, excel_row: int, topic_canon: dict) -> dict:
    messages = []
    status_name = "ready"

    title, title_cut = _clip(_cell_text(raw.get("title"), collapse=True), MAX_TITLE)
    topic, topic_cut = _clip(_cell_text(raw.get("topic"), collapse=True), MAX_TOPIC)
    subtopic, sub_cut = _clip(_cell_text(raw.get("subtopic"), collapse=True), MAX_SUBTOPIC)
    task_number, task_cut = _clip(_cell_text(raw.get("task_number"), collapse=True), MAX_TASK_NUMBER)
    goal = _cell_text(raw.get("goal"))
    description = _cell_text(raw.get("description"))
    homework = _cell_text(raw.get("homework_description"))
    comment = _cell_text(raw.get("teacher_comment"))

    if title_cut:
        messages.append("Название обрезано до 255 символов.")
        status_name = "warning"
    if topic_cut:
        messages.append("Тема обрезана до 500 символов.")
        status_name = "warning"
    if sub_cut:
        messages.append("Подтема обрезана до 255 символов.")
        status_name = "warning"
    if task_cut:
        messages.append("№ задания обрезан до 32 символов.")
        status_name = "warning"

    if not title and not topic:
        return {
            "excel_row": excel_row,
            "status": "error",
            "result": "Ошибка",
            "messages": ["Укажите название урока или тему."],
            "item": _empty_item(excel_row, subtopic, task_number, goal, description, homework, comment),
        }

    if not title:
        title = topic

    topic_key = normalize_topic_key(topic)
    if topic_key and topic_key in topic_canon:
        topic = topic_canon[topic_key]
    elif topic:
        topic_canon[topic_key] = topic

    v3 = "manual_date" in raw or "schedule_date" in raw
    manual = None
    pinned = None
    scheduled = None
    date_source = "automatic"
    skip = str(raw.get("skip_date") or "").strip().casefold() in {"да", "yes", "1", "true"}
    item_id, id_state = _parse_item_id_detail(raw.get("item_id"))
    if id_state == "invalid":
        messages.append(f"Строка {excel_row}: ID занятия повреждён. Строка не будет сопоставлена по теме или дате.")
        status_name = "ambiguous"
    if v3:
        manual, manual_error = _optional_date(raw.get("manual_date"))
        pinned, pinned_error = _optional_date(raw.get("schedule_date"))
        typed_final, final_error = _optional_date(raw.get("scheduled_date"))
        for error in (manual_error, pinned_error, final_error):
            if error:
                messages.append(f"Строка {excel_row}: {error}")
                status_name = "error"
        if manual:
            scheduled = manual
            date_source = "manual"
        elif typed_final and not _is_formula(raw.get("scheduled_date")):
            scheduled = typed_final
            date_source = "manual"
            manual = typed_final
        elif pinned and not _is_formula(raw.get("schedule_date")):
            scheduled = pinned
            date_source = "automatic"
        else:
            scheduled = None
            date_source = "automatic"
    else:
        scheduled, date_error = parse_excel_date(raw.get("scheduled_date"))
        if _is_formula(raw.get("scheduled_date")):
            scheduled, date_error = None, None
        if date_error:
            messages.append(f"Строка {excel_row}: {date_error}")
            status_name = "error"
            date_source = ""
        elif scheduled:
            date_source = "manual"
        else:
            date_source = "automatic"

    return {
        "excel_row": excel_row,
        "status": status_name,
        "result": "",
        "messages": messages,
        "item": {
            "id": None,
            "source_item_id": item_id,
            "id_state": id_state,
            "row_key": _cell_text(raw.get("row_key"))[:80],
            "revision": _cell_text(raw.get("revision")),
            "title": title,
            "topic": topic,
            "subtopic": subtopic,
            "task_number": task_number,
            "goal": goal,
            "description": description,
            "homework_description": homework,
            "teacher_comment": comment,
            "scheduled_date": scheduled.isoformat() if scheduled else None,
            "manual_date": manual.isoformat() if manual else None,
            "pinned_schedule": pinned.isoformat() if pinned and date_source != "manual" else None,
            "skip_date": skip,
            "date_source": date_source,
            "order": excel_row - 1,
        },
    }


def _optional_date(value):
    if _is_formula(value) or value in (None, ""):
        return None, None
    return parse_excel_date(value)


def _empty_item(excel_row, subtopic, task_number, goal, description, homework, comment):
    return {
        "id": None,
        "source_item_id": None,
        "title": "",
        "topic": "",
        "subtopic": subtopic,
        "task_number": task_number,
        "goal": goal,
        "description": description,
        "homework_description": homework,
        "teacher_comment": comment,
        "scheduled_date": None,
        "date_source": "",
        "order": excel_row - 1,
    }


def _with_canonical_topic(row: dict, topic_canon: dict) -> dict:
    item = dict(row.get("item") or {})
    topic = item.get("topic") or ""
    key = normalize_topic_key(topic)
    if key and key in topic_canon:
        item["topic"] = topic_canon[key]
    elif topic:
        topic_canon[key] = topic
    return {**row, "item": item}


def _cell_text(value: Any, *, collapse: bool = False) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return ""
    if isinstance(value, int):
        text = str(value)
    elif isinstance(value, float) and value.is_integer():
        text = str(int(value))
    elif isinstance(value, datetime):
        text = value.date().isoformat()
    elif isinstance(value, date):
        text = value.isoformat()
    else:
        text = str(value).strip()
        if text.startswith("'") and len(text) > 1 and text[1:2] in {"=", "+", "-", "@"}:
            text = text[1:]
    if collapse:
        return " ".join(text.split()) if text else ""
    return text


def _parse_item_id(value: Any) -> int | None:
    number, _state = _parse_item_id_detail(value)
    return number


def _parse_item_id_detail(value: Any) -> tuple[int | None, str]:
    if value in (None, "") or _is_formula(value):
        return None, "empty"
    text = str(value).strip()
    if text.startswith("'"):
        text = text[1:].strip()
    if not text:
        return None, "empty"
    try:
        number = int(float(text))
    except (TypeError, ValueError):
        return None, "invalid"
    if number <= 0:
        return None, "invalid"
    return number, "ok"


def _first_explicit_date(rows: list[dict]) -> date | None:
    for row in rows:
        parsed = parse_plan_date((row.get("item") or {}).get("scheduled_date"))
        if parsed:
            return parsed
    return None


def _existing_entries(existing_items: list, interval: str) -> list[dict]:
    rows = []
    for item in existing_items:
        if isinstance(item, dict):
            rows.append({
                "id": item.get("id") or item.get("pk"),
                "title": item.get("title") or "",
                "topic": item.get("topic") or "",
                "subtopic": item.get("subtopic") or "",
                "task_number": item.get("task_number") or "",
                "goal": item.get("goal") or "",
                "description": item.get("description") or "",
                "homework_description": item.get("homework_description") or "",
                "teacher_comment": item.get("teacher_comment") or "",
                "scheduled_date": iso_plan_date(item.get("scheduled_date")) or None,
                "date_source": item.get("date_source") or "",
                "order": item.get("order") or 0,
                "in_use": bool(item.get("in_use")),
                "status": item.get("status") or "",
                "protected_reason": item.get("protected_reason") or "",
                "import_key": item.get("import_key") or "",
                "updated_at": item.get("updated_at") or "",
                "event_id": item.get("event_id"),
                "event_status": item.get("event_status") or "",
                "can_move_event": bool(item.get("can_move_event")),
                "event_move_reason": item.get("event_move_reason") or "",
            })
        else:
            snapshot = _linked_event_snapshot(item)
            rows.append({
                "id": item.pk,
                "title": item.title,
                "topic": item.topic,
                "subtopic": item.subtopic,
                "task_number": item.task_number,
                "goal": item.goal,
                "description": item.description,
                "homework_description": item.homework_description,
                "teacher_comment": item.teacher_comment,
                "scheduled_date": iso_plan_date(item.scheduled_date) or None,
                "date_source": "",
                "order": item.order,
                "in_use": _item_in_use(item),
                "status": item.status or "",
                "protected_reason": _protected_reason(item),
                "import_key": getattr(item, "import_key", "") or "",
                "updated_at": item.updated_at.isoformat() if getattr(item, "updated_at", None) else "",
                **snapshot,
            })
    rows.sort(key=lambda item: (item.get("order") or 0, item.get("id") or 0))
    first = parse_plan_date(rows[0]["scheduled_date"]) if rows else None
    planned = generate_plan_dates(first, len(rows), interval) if first else []
    for index, row in enumerate(rows):
        if row.get("date_source") in {"manual", "automatic"}:
            continue
        current = parse_plan_date(row.get("scheduled_date"))
        auto = planned[index] if index < len(planned) else None
        if current and auto and current != auto and index > 0:
            row["date_source"] = "manual"
        elif current:
            row["date_source"] = "automatic"
        else:
            row["date_source"] = ""
    return rows


def _protected_reason(item) -> str:
    if isinstance(item, dict):
        return str(item.get("protected_reason") or "")
    if item.status == PlanItemStatus.COMPLETED or getattr(item, "completed_at", None):
        return "Занятие уже проведено. Оно останется в плане: фактическая дата урока и журнал не переписываются."
    try:
        homeworks = list(item.homeworks.all())
    except Exception:
        homeworks = []
    for homework in homeworks:
        try:
            if homework.submissions.exists():
                return "Есть ответы ученика. Занятие останется в плане, результаты не удаляются."
        except Exception:
            continue
    events = []
    if getattr(item, "scheduled_event_id", None) and getattr(item, "scheduled_event", None):
        events.append(item.scheduled_event)
    try:
        events.extend(list(item.schedule_events_linked.all()))
    except Exception:
        pass
    seen = set()
    for event in events:
        if event is None or event.pk in seen:
            continue
        seen.add(event.pk)
        if event.status in {ScheduleEvent.Status.DONE, ScheduleEvent.Status.COMPLETED}:
            return "Урок в расписании уже проведён. Занятие останется в плане."
        try:
            journal = event.journal
        except Exception:
            journal = None
        if journal is not None:
            return "Есть запись в журнале. Занятие останется в плане."
    return ""


def _assign_v3_dates(rows: list[dict], settings: dict) -> list[str]:
    schedule = resolve_schedule(settings)
    manuals = []
    skips = []
    pinned = []
    for row in rows:
        item = row.get("item") or {}
        manuals.append(item.get("manual_date") if item.get("date_source") == "manual" else None)
        skips.append(bool(item.get("skip_date")))
        pinned.append(item.get("pinned_schedule"))
    planned = sequence_plan(
        len(rows),
        schedule.get("start"),
        schedule.get("mode"),
        schedule.get("weekdays"),
        schedule.get("step_n"),
        manuals,
        skips,
        pinned,
    )
    for row, plan in zip(rows, planned):
        if row.get("status") == "error":
            continue
        item = row["item"]
        item["scheduled_date"] = plan["effective"].isoformat() if plan["effective"] else None
        item["date_source"] = plan["source"]
    return []


def _text_same(left, right) -> bool:
    return str(left or "").strip() == str(right or "").strip()


_COMPARE_FIELDS = (
    ("title", "название"),
    ("topic", "тема"),
    ("subtopic", "подтема"),
    ("task_number", "№ задания"),
    ("goal", "цель"),
    ("description", "план урока"),
    ("homework_description", "домашнее задание"),
    ("teacher_comment", "комментарий"),
)


def _parse_stamp(value):
    if isinstance(value, datetime):
        parsed = value
    else:
        text = str(value or "").strip()
        if not text or text.startswith("="):
            return None
        parsed = parse_datetime(text)
        if parsed is None:
            return None
    if timezone.is_naive(parsed):
        parsed = timezone.make_aware(parsed, timezone.get_current_timezone())
    return parsed


def _row_fingerprint(item: dict) -> str:
    parts = [
        item.get("title"),
        item.get("topic"),
        item.get("subtopic"),
        item.get("task_number"),
        item.get("goal"),
        item.get("description"),
        item.get("homework_description"),
        item.get("teacher_comment"),
        item.get("manual_date") or "",
        "1" if item.get("skip_date") else "0",
    ]
    digest = hashlib.sha256("\n".join(str(part or "").strip() for part in parts).encode()).hexdigest()[:32]
    return f"fp:{digest}"


def _stored_import_key(item: dict, *, occurrence: int) -> str:
    key = str(item.get("row_key") or "").strip()[:80]
    if key and occurrence == 0 and not key.lower().startswith("id:"):
        return key
    fingerprint = _row_fingerprint(item)
    if occurrence:
        return f"{fingerprint}:{occurrence}"[:80]
    return fingerprint


def _field_diffs(item: dict, current: dict) -> list[dict]:
    diffs = []
    for key, label in _COMPARE_FIELDS:
        if _text_same(item.get(key), current.get(key)):
            continue
        diffs.append({
            "field": key,
            "label": label,
            "site": str(current.get(key) or ""),
            "file": str(item.get(key) or ""),
        })
    old_date = iso_plan_date(current.get("scheduled_date")) or ""
    new_date = iso_plan_date(item.get("scheduled_date")) or ""
    if old_date != new_date:
        diffs.append({
            "field": "scheduled_date",
            "label": "дата",
            "site": old_date,
            "file": new_date,
        })
    return diffs


def _linked_event_snapshot(item) -> dict:
    event = None
    if getattr(item, "scheduled_event_id", None) and getattr(item, "scheduled_event", None):
        event = item.scheduled_event
    if event is None:
        try:
            event = item.schedule_events_linked.exclude(status=ScheduleEvent.Status.CANCELLED).first()
        except Exception:
            event = None
    if event is None:
        return {
            "event_id": None,
            "event_status": "",
            "can_move_event": False,
            "event_move_reason": "",
        }
    reason = ""
    movable = event.status in {
        ScheduleEvent.Status.PLANNED,
        ScheduleEvent.Status.DRAFT,
        ScheduleEvent.Status.MOVED,
    }
    if item.status == PlanItemStatus.COMPLETED or getattr(item, "completed_at", None):
        movable = False
        reason = "Занятие уже проведено. Событие расписания не переносится."
    elif event.status in {ScheduleEvent.Status.DONE, ScheduleEvent.Status.COMPLETED}:
        movable = False
        reason = "Урок в расписании уже проведён. Событие не переносится."
    elif event.status in {ScheduleEvent.Status.CANCELLED, ScheduleEvent.Status.SKIPPED}:
        movable = False
        reason = "Событие отменено или пропущено. Календарь не переносится."
    else:
        try:
            journal = event.journal
        except Exception:
            journal = None
        if journal is not None:
            movable = False
            reason = "Есть запись в журнале. Событие расписания не переносится."
    if movable:
        reason = "Плановая дата изменится. Событие в календаре останется на прежнем времени, пока вы отдельно не перенесёте его."
    elif reason:
        reason = reason.rstrip(".") + ". Изменится только плановая дата, занятие в календаре останется на прежней дате."
    return {
        "event_id": event.pk,
        "event_status": event.status or "",
        "can_move_event": movable,
        "event_move_reason": reason,
    }


def _event_move_payload(current: dict, date_changed: bool) -> dict | None:
    if not date_changed or not current.get("in_use"):
        return None
    return {
        "can_move": bool(current.get("can_move_event")),
        "event_id": current.get("event_id"),
        "reason": current.get("event_move_reason") or "Событие расписания по умолчанию не переносится.",
    }


def _resolve_sync(
    rows: list[dict],
    existing: list[dict],
    *,
    confirm_deletes: bool,
    exclude_rows: set | None = None,
    exclude_deletes: set | None = None,
    accept_conflicts: set | None = None,
    move_event_rows: set | None = None,
) -> dict:
    exclude_rows = exclude_rows or set()
    exclude_deletes = exclude_deletes or set()
    accept_conflicts = accept_conflicts or set()
    move_event_rows = move_event_rows or set()
    by_id = {}
    by_key = {}
    db_key_counts = {}
    for entry in existing:
        if entry.get("id"):
            by_id[int(entry["id"])] = entry
        key = str(entry.get("import_key") or "").strip()
        if not key:
            continue
        db_key_counts[key] = db_key_counts.get(key, 0) + 1
        if key not in by_key:
            by_key[key] = entry
    file_key_counts = {}
    bare_fingerprints = {}
    for row in rows:
        raw_item = row.get("item") or {}
        if raw_item.get("source_item_id"):
            continue
        raw_key = str(raw_item.get("row_key") or "").strip()
        if raw_key:
            file_key_counts[raw_key] = file_key_counts.get(raw_key, 0) + 1
        else:
            fingerprint = _row_fingerprint(raw_item)
            bare_fingerprints[fingerprint] = bare_fingerprints.get(fingerprint, 0) + 1
    seen_ids = {}
    seen_keys = {}
    fingerprint_seen = {}
    duplicate_hold_ids = set()
    prepared = []
    ambiguous = False
    for row in rows:
        item = dict(row["item"])
        messages = list(row.get("messages") or [])
        status_name = row.get("status") or "ready"
        source_id = item.get("source_item_id")
        id_state = item.get("id_state") or ("ok" if source_id else "empty")
        row_key = str(item.get("row_key") or "").strip()
        if id_state == "invalid" or status_name == "ambiguous":
            ambiguous = True
            status_name = "ambiguous"
            result = "Неясно"
            if not any("ID" in message for message in messages):
                messages.append("ID занятия не читается. Строка не будет применена.")
            prepared.append({**row, "item": item, "status": status_name, "messages": messages, "result": result})
            continue
        if source_id and seen_ids.get(source_id):
            ambiguous = True
            message = f"Строка {row['excel_row']}: ID {source_id} повторяется. Соответствие не угадано."
            for previous in prepared:
                if (previous.get("item") or {}).get("source_item_id") == source_id and previous.get("status") != "ambiguous":
                    previous["status"] = "ambiguous"
                    previous["result"] = "Неясно"
                    previous["messages"] = list(previous.get("messages") or []) + [message]
            prepared.append({
                **row,
                "item": item,
                "status": "ambiguous",
                "messages": messages + [message],
                "result": "Неясно",
            })
            continue
        if source_id:
            seen_ids[source_id] = row["excel_row"]
        current = by_id.get(int(source_id)) if source_id else None
        if source_id and current is None:
            ambiguous = True
            messages.append("Этот ID не относится к текущему плану. Строка не будет создана и не изменит другое занятие.")
            prepared.append({**row, "item": item, "status": "ambiguous", "messages": messages, "result": "Неясно"})
            continue
        matched_by_key = False
        stable_key = row_key
        fingerprint = _row_fingerprint(item) if not source_id else ""
        key_repeats = bool(row_key) and (file_key_counts.get(row_key, 0) > 1 or db_key_counts.get(row_key, 0) > 1)
        content_repeats = (not source_id and not row_key and bare_fingerprints.get(fingerprint, 0) > 1)
        stored_repeats = (not source_id and not row_key and db_key_counts.get(fingerprint, 0) > 1)
        if current is None and not source_id and (key_repeats or content_repeats or stored_repeats):
            if key_repeats:
                for entry in existing:
                    if str(entry.get("import_key") or "") == row_key and entry.get("id"):
                        duplicate_hold_ids.add(int(entry["id"]))
                messages.append(
                    "Код строки повторяется. Занятие не обновляется и не создаётся автоматически. "
                    "Исправьте код или отметьте «Создать как новое занятие»."
                )
            else:
                for entry in existing:
                    stored = str(entry.get("import_key") or "")
                    if entry.get("id") and (stored == fingerprint or stored.startswith(f"{fingerprint}:")):
                        duplicate_hold_ids.add(int(entry["id"]))
                messages.append(
                    "Несколько строк без уникального кода совпадают по содержанию. "
                    "Они не объединяются и не создаются автоматически. Можно создать строку как новое занятие."
                )
            if row["excel_row"] in accept_conflicts and row["excel_row"] not in exclude_rows:
                item["import_key"] = uuid.uuid4().hex
                prepared.append({
                    **row,
                    "item": item,
                    "status": "create",
                    "messages": messages,
                    "result": "Будет добавлено как новое занятие",
                    "allow_create": True,
                })
            else:
                ambiguous = True
                prepared.append({
                    **row,
                    "item": item,
                    "status": "ambiguous",
                    "messages": messages,
                    "result": "Нужно решение",
                    "allow_create": True,
                })
            continue
        if current is None and row_key and row_key not in seen_keys:
            if row_key.lower().startswith("id:"):
                tail = row_key.split(":", 1)[1]
                stable_key = ""
                if tail.isdigit() and int(tail) in by_id and int(tail) not in seen_ids:
                    current = by_id[int(tail)]
                    matched_by_key = True
            elif row_key in by_key and int(by_key[row_key]["id"]) not in seen_ids:
                current = by_key[row_key]
                matched_by_key = True
        if current is None and not source_id and (not stable_key or stable_key in seen_keys):
            fingerprint = _row_fingerprint(item)
            occurrence = fingerprint_seen.get(fingerprint, 0)
            fingerprint_seen[fingerprint] = occurrence + 1
            stored = fingerprint if occurrence == 0 else f"{fingerprint}:{occurrence}"
            candidate = by_key.get(stored)
            if candidate is not None and int(candidate["id"]) not in seen_ids:
                current = candidate
                matched_by_key = True
            else:
                item["import_key"] = stored[:80]
        elif current is None and not source_id and stable_key:
            item["import_key"] = stable_key[:80]
        if row_key:
            seen_keys[row_key] = row["excel_row"]
        if current is not None:
            seen_ids[int(current["id"])] = row["excel_row"]
        if status_name == "error":
            prepared.append({**row, "item": item, "status": "error", "messages": messages, "result": "Ошибка"})
            continue
        if current is None:
            if "import_key" not in item:
                item["import_key"] = _stored_import_key(item, occurrence=0)
            if row["excel_row"] in exclude_rows:
                prepared.append({
                    **row,
                    "item": item,
                    "status": "excluded",
                    "messages": messages,
                    "result": "Добавление не будет применено",
                })
                continue
            prepared.append({
                **row,
                "item": item,
                "status": "create",
                "messages": messages,
                "result": "Будет добавлено",
            })
            continue
        item["id"] = current["id"]
        diffs = _field_diffs(item, current)
        changed_fields = [diff["label"] for diff in diffs]
        date_changed = any(diff["field"] == "scheduled_date" for diff in diffs)
        revision = _parse_stamp(item.get("revision"))
        site_stamp = _parse_stamp(current.get("updated_at"))
        site_changed = bool(revision and site_stamp and site_stamp > revision)
        if matched_by_key and not source_id and changed_fields:
            messages.append("Занятие узнано по скрытому коду строки, серверный ID в файле пустой.")
        if not changed_fields:
            prepared.append({
                **row,
                "item": item,
                "status": "unchanged",
                "messages": messages,
                "result": "Без изменений",
                "current_id": current["id"],
            })
            continue
        if site_changed:
            messages.append(
                "Это занятие изменили на сайте после скачивания файла. "
                "По умолчанию останется версия с сайта. Версию из файла можно выбрать в предпросмотре."
            )
            take_file = row["excel_row"] in accept_conflicts and row["excel_row"] not in exclude_rows
            prepared.append({
                **row,
                "item": item,
                "status": "conflict" if not take_file else ("warning" if messages else "update"),
                "messages": messages,
                "result": "На сайте новее. Версия из файла не применяется." if not take_file else "Будет обновлено из файла: " + ", ".join(changed_fields),
                "current_id": current["id"],
                "date_changed": date_changed and take_file,
                "diffs": diffs,
                "conflict": True,
                "resolution": "file" if take_file else "site",
                "event_move": _event_move_payload(current, date_changed) if take_file else None,
            })
            continue
        if date_changed and (current.get("in_use") or current.get("protected_reason")):
            messages.append(
                "Новая дата отличается от текущего плана. Плановая дата обновится, "
                "а дата урока в расписании останется прежней, пока вы отдельно не перенесёте событие."
            )
        if current.get("protected_reason") and "домашнее задание" in changed_fields:
            messages.append("Текст домашнего задания изменится. Ответы ученика и проверка сохранятся.")
        if row["excel_row"] in exclude_rows:
            prepared.append({
                **row,
                "item": item,
                "status": "excluded",
                "messages": messages,
                "result": "Изменение не будет применено",
                "current_id": current["id"],
                "diffs": diffs,
            })
            continue
        prepared.append({
            **row,
            "item": item,
            "status": "warning" if messages else "update",
            "messages": messages,
            "result": "Будет обновлено: " + ", ".join(changed_fields),
            "current_id": current["id"],
            "date_changed": date_changed,
            "diffs": diffs,
            "event_move": _event_move_payload(current, date_changed),
        })

    position = 0
    for row in prepared:
        if row.get("status") in {"error", "ambiguous"}:
            continue
        position += 1
        current_id = row.get("current_id")
        if not current_id or row.get("status") != "unchanged":
            continue
        current = by_id.get(int(current_id))
        if current and int(current.get("order") or 0) != position:
            if row.get("excel_row") in exclude_rows:
                continue
            row["status"] = "update"
            row["result"] = "Будет обновлено: порядок"

    present_ids = set()
    for row in prepared:
        if row.get("status") in {"error", "ambiguous"}:
            continue
        current_id = row.get("current_id") or (row.get("item") or {}).get("id")
        if current_id:
            present_ids.add(int(current_id))
    present_ids.update(duplicate_hold_ids)
    warnings = []
    missing = [entry for entry in existing if entry.get("id") and int(entry["id"]) not in present_ids]
    key_ambiguous = any(row.get("allow_create") and row.get("status") == "ambiguous" for row in prepared)
    id_ambiguous = any(row.get("status") == "ambiguous" and not row.get("allow_create") for row in prepared)
    if missing and (id_ambiguous or key_ambiguous):
        if id_ambiguous:
            warnings.append(
                "Есть строки с неясным ID, поэтому занятия, которых нет в файле, не предлагаются к удалению. "
                "Исправьте ID и загрузите файл снова."
            )
        missing = []
    if key_ambiguous:
        warnings.append(
            "Есть повторяющиеся коды или одинаковые строки без уникального кода. "
            "Они не применены. В предпросмотре можно создать такую строку как новое занятие."
        )
    deleted = 0
    retained = 0
    for entry in missing:
        reason = entry.get("protected_reason") or ""
        if reason:
            retained += 1
            prepared.append({
                "excel_row": None,
                "status": "retain",
                "result": "Останется в плане",
                "messages": [reason],
                "item": entry,
                "current_id": entry["id"],
            })
            continue
        if int(entry["id"]) in exclude_deletes:
            prepared.append({
                "excel_row": None,
                "status": "excluded",
                "result": "Удаление не будет применено",
                "messages": ["Занятие останется в плане."],
                "item": entry,
                "current_id": entry["id"],
            })
            continue
        deleted += 1
        note = "Занятие будет удалено из плана."
        if entry.get("in_use"):
            note = "Занятие будет убрано из плана. Если урок уже стоит в расписании, проверьте, нужно ли его отменить: календарь сам не изменится."
        prepared.append({
            "excel_row": None,
            "status": "delete",
            "result": "Будет удалено" if confirm_deletes else "Будет удалено после подтверждения",
            "messages": [note],
            "item": entry,
            "current_id": entry["id"],
        })

    if deleted and not confirm_deletes:
        for row in prepared:
            if row.get("status") == "update" and row.get("result") == "Будет обновлено: порядок":
                row["status"] = "unchanged"
                row["result"] = "Без изменений"

    operations = []
    order = 1
    for row in prepared:
        status_name = row.get("status")
        item = row.get("item") or {}
        if status_name in {"error", "ambiguous", "delete", "retain", "excluded", "conflict"}:
            if status_name not in {"delete", "retain"}:
                if status_name not in {"error", "ambiguous"}:
                    order += 1
            continue
        payload = dict(item)
        payload["id"] = row.get("current_id") or item.get("id")
        move = bool(
            row.get("excel_row") in move_event_rows
            and (row.get("event_move") or {}).get("can_move")
            and row.get("date_changed")
        )
        if status_name == "create":
            operations.append({"op": "create", "order": order, "item": payload, "excel_row": row.get("excel_row")})
        elif status_name in {"update", "warning", "unchanged"} and payload.get("id"):
            if status_name != "unchanged":
                operations.append({
                    "op": "update",
                    "id": payload["id"],
                    "order": order,
                    "item": payload,
                    "excel_row": row.get("excel_row"),
                    "move_event": move,
                })
        order += 1
    if confirm_deletes and not ambiguous:
        for row in prepared:
            if row.get("status") != "delete":
                continue
            operations.append({"op": "delete", "id": row.get("current_id"), "order": 0, "item": row.get("item") or {}})
    for row in prepared:
        if row.get("status") == "retain":
            operations.append({"op": "retain", "id": row.get("current_id"), "order": 0, "item": row.get("item") or {}})

    added = sum(1 for row in prepared if row.get("status") == "create")
    updated = sum(1 for row in prepared if row.get("status") in {"update", "warning"})
    unchanged = sum(1 for row in prepared if row.get("status") == "unchanged")
    excluded = sum(1 for row in prepared if row.get("status") == "excluded")
    conflicts = sum(1 for row in prepared if row.get("status") == "conflict" or row.get("conflict"))
    dates_changed = sum(1 for row in prepared if row.get("date_changed"))
    linked = sum(
        1 for row in prepared
        if (row.get("item") or {}).get("in_use") and row.get("status") in {"update", "warning", "delete", "retain", "conflict"}
    )
    attention = sum(1 for row in prepared if row.get("status") in {"ambiguous", "retain", "warning", "delete", "conflict"})
    applied_deletes = deleted if confirm_deletes and not ambiguous else 0
    after = unchanged + updated + added + retained + excluded + (conflicts if conflicts else 0) + (deleted - applied_deletes)
    # conflicts that were accepted are already counted as update/warning
    conflict_open = sum(1 for row in prepared if row.get("status") == "conflict")
    after = len(existing) - applied_deletes + added
    if not confirm_deletes and deleted:
        warnings.append(
            f"В файле нет {deleted} {_lessons_word(deleted)}. Они будут удалены из плана только после подтверждения."
        )
    if conflict_open:
        if conflict_open == 1:
            conflict_text = "Одно занятие изменили на сайте после скачивания файла."
        else:
            conflict_text = f"{conflict_open} занятий изменили на сайте после скачивания файла."
        warnings.append(
            conflict_text + " По умолчанию остаётся версия с сайта. В предпросмотре можно взять версию из файла."
        )
    if abs((unchanged + updated + added + conflict_open) - len(existing)) and not warnings:
        warnings.append("Количество занятий изменилось. Проверьте итоговый учебный план перед импортом.")
    confirmation = (
        f"Без изменений: {unchanged}. Обновятся: {updated}. "
        f"Добавятся: {added}. Удалятся: {applied_deletes if confirm_deletes else 0}."
    )
    if conflict_open:
        confirmation += f" Конфликтов, где останется сайт: {conflict_open}."
    if excluded:
        confirmation += f" Исключено из импорта: {excluded}."
    return {
        "rows": prepared,
        "operations": operations,
        "after_count": after,
        "added": added,
        "replaced": updated,
        "updated": updated,
        "unchanged": unchanged,
        "deleted": deleted,
        "dates_changed": dates_changed,
        "linked": linked,
        "attention": attention,
        "conflicts": conflict_open,
        "excluded": excluded,
        "confirmation": confirmation,
        "blocking_errors": [],
        "warnings": warnings,
        "shifts": [],
    }

def _copy_item(item: dict) -> dict:
    copied = dict(item)
    copied["id"] = None
    return copied


def _resolve_replace_all(rows: list[dict], existing: list[dict], start, interval: str, *, assign_legacy: bool = True) -> dict:
    prepared = []
    for row in rows:
        item = dict(row["item"])
        item["id"] = None
        prepared.append({**row, "item": item, "result": "Будет в новом плане" if row["status"] != "error" else "Ошибка"})
    if assign_legacy:
        _assign_automatic_dates(prepared, start, interval)
    blocking = []
    in_use = [entry for entry in existing if entry.get("in_use")]
    if in_use:
        titles = ", ".join(entry.get("title") or "Без названия" for entry in in_use[:3])
        blocking.append(f"Нельзя обновить план целиком: занятие «{titles}» уже стоит в расписании.")
    operations = []
    order = 1
    for row in prepared:
        if row["status"] == "error":
            continue
        operations.append({"op": "create", "order": order, "item": row["item"]})
        order += 1
    current = len(existing)
    after = sum(1 for row in prepared if row["status"] != "error")
    confirmation = (
        f"В плане сейчас {current} {_lessons_word(current)}. "
        f"После обновления останется {after} {_lessons_word(after)} из Excel. "
        f"Это действие заменит текущий состав плана."
    )
    return {
        "rows": prepared,
        "operations": operations,
        "after_count": after,
        "added": after,
        "replaced": 0,
        "confirmation": confirmation,
        "blocking_errors": blocking,
        "warnings": [],
        "shifts": [],
    }


def _resolve_insert(rows: list[dict], existing: list[dict], start, interval: str) -> dict:
    prepared = []
    inserts = []
    for row in rows:
        item = dict(row["item"])
        item["id"] = None
        status_name = row["status"]
        messages = list(row.get("messages") or [])
        scheduled = parse_plan_date(item.get("scheduled_date"))
        if status_name != "error" and not scheduled:
            status_name = "error"
            messages.append(f"Строка {row['excel_row']}: укажите дату, на которую нужно добавить урок.")
        result = ""
        if status_name == "error":
            result = "Ошибка"
        elif scheduled:
            result = f"{format_ru_date(scheduled)} → будет добавлен новый урок на эту дату"
            item["date_source"] = "manual"
            item["scheduled_date"] = scheduled.isoformat()
        prepared.append({**row, "item": item, "status": status_name, "messages": messages, "result": result})
        if status_name != "error" and scheduled:
            inserts.append(prepared[-1])

    sequence = [dict(entry) for entry in existing]
    inserts_sorted = sorted(
        inserts,
        key=lambda row: (parse_plan_date(row["item"]["scheduled_date"]), row["excel_row"]),
    )
    first_insert_index = None
    for row in inserts_sorted:
        insert_date = parse_plan_date(row["item"]["scheduled_date"])
        index = next(
            (
                pos
                for pos, entry in enumerate(sequence)
                if parse_plan_date(entry.get("scheduled_date")) is None
                or parse_plan_date(entry.get("scheduled_date")) >= insert_date
            ),
            len(sequence),
        )
        new_entry = {
            **_copy_item(row["item"]),
            "kind": "new",
            "excel_row": row["excel_row"],
            "date_source": "manual",
            "scheduled_date": insert_date.isoformat(),
        }
        sequence.insert(index, new_entry)
        first_insert_index = index if first_insert_index is None else min(first_insert_index, index)

    before_dates = {entry.get("id"): entry.get("scheduled_date") for entry in existing if entry.get("id")}
    if sequence and first_insert_index is not None:
        start_for_shift = parse_plan_date(sequence[first_insert_index].get("scheduled_date")) or start
        apply_sequence_dates(sequence, start_for_shift, interval, from_index=first_insert_index, preserve_manual=True)

    warnings = []
    if sequence:
        warnings.extend(_same_date_warnings(sequence))
    shifts = []
    for entry in sequence:
        old_id = entry.get("id")
        if not old_id:
            continue
        new_date = entry.get("scheduled_date")
        old_date = before_dates.get(old_id)
        if old_date != new_date:
            shifts.append({
                "id": old_id,
                "title": entry.get("title") or "",
                "from": old_date,
                "to": new_date,
                "date_source": entry.get("date_source") or "",
            })

    operations = []
    for order, entry in enumerate(sequence, start=1):
        payload = {
            "title": entry.get("title") or "",
            "topic": entry.get("topic") or "",
            "subtopic": entry.get("subtopic") or "",
            "task_number": entry.get("task_number") or "",
            "goal": entry.get("goal") or "",
            "description": entry.get("description") or "",
            "homework_description": entry.get("homework_description") or "",
            "teacher_comment": entry.get("teacher_comment") or "",
            "scheduled_date": entry.get("scheduled_date"),
            "date_source": entry.get("date_source") or "",
        }
        if entry.get("kind") == "new" or not entry.get("id"):
            operations.append({"op": "create", "order": order, "item": payload})
        else:
            operations.append({"op": "update", "id": entry.get("id"), "order": order, "item": payload})

    added = sum(1 for row in prepared if row["status"] != "error")
    confirmation = (
        f"Будет добавлено: {added} {_lessons_word(added)}. "
        "Последующие уроки будут сдвинуты согласно расписанию плана."
    )
    return {
        "rows": prepared,
        "operations": operations,
        "after_count": len(existing) + added,
        "added": added,
        "replaced": 0,
        "confirmation": confirmation,
        "blocking_errors": [],
        "warnings": warnings,
        "shifts": shifts,
    }


def _same_date_warnings(sequence: list[dict]) -> list[str]:
    grouped = {}
    for entry in sequence:
        key = iso_plan_date(entry.get("scheduled_date"))
        if not key:
            continue
        grouped.setdefault(key, []).append(entry)
    warnings = []
    for key, entries in grouped.items():
        if len(entries) < 2:
            continue
        warnings.append(
            f"На {format_ru_date(key)} окажется несколько уроков. Ручные даты не были сдвинуты автоматически."
        )
    return warnings


def _resolve_replace_dates(rows: list[dict], existing: list[dict]) -> dict:
    by_date = {}
    for entry in existing:
        key = iso_plan_date(entry.get("scheduled_date"))
        if not key:
            continue
        by_date.setdefault(key, []).append(entry)

    date_rows = {}
    prepared = []
    operations = []
    for row in rows:
        item = dict(row["item"])
        status_name = row["status"]
        messages = list(row.get("messages") or [])
        scheduled = parse_plan_date(item.get("scheduled_date"))
        current = None
        result = "Ошибка"
        if status_name != "error" and not scheduled:
            status_name = "error"
            messages.append(f"Строка {row['excel_row']}: укажите дату урока, который нужно заменить.")
        if scheduled:
            key = scheduled.isoformat()
            date_rows.setdefault(key, []).append(row["excel_row"])
            matches = by_date.get(key) or []
            if status_name != "error" and not matches:
                status_name = "error"
                messages.append(
                    f"Строка {row['excel_row']}: в текущем плане нет урока на {format_ru_date(scheduled)}. Заменить нечего."
                )
            elif status_name != "error" and len(matches) > 1:
                status_name = "error"
                messages.append(
                    f"Строка {row['excel_row']}: на {format_ru_date(scheduled)} в плане несколько уроков, нельзя однозначно выбрать, какой заменить."
                )
            elif status_name != "error":
                current = matches[0]
                item["id"] = current.get("id")
                item["scheduled_date"] = key
                item["date_source"] = current.get("date_source") or item.get("date_source")
                result = (
                    f"{format_ru_date(scheduled)}\n"
                    f"Было: {current.get('title') or current.get('topic') or '—'}\n"
                    f"Станет: {item.get('title') or item.get('topic') or '—'}"
                )
        prepared.append({
            **row,
            "item": item,
            "status": status_name,
            "messages": messages,
            "result": result,
            "current": {
                "id": current.get("id"),
                "title": current.get("title") or "",
                "topic": current.get("topic") or "",
                "scheduled_date": current.get("scheduled_date"),
            } if current else None,
        })

    for key, excel_rows in date_rows.items():
        if len(excel_rows) < 2:
            continue
        message = f"В файле несколько строк для замены урока на {format_ru_date(key)}."
        for row in prepared:
            if parse_plan_date(row["item"].get("scheduled_date")) and iso_plan_date(row["item"].get("scheduled_date")) == key:
                row["status"] = "error"
                row["result"] = "Ошибка"
                if message not in row["messages"]:
                    row["messages"].append(message)
                row["current"] = None

    replaced = 0
    seen_targets = set()
    for row in prepared:
        if row["status"] == "error" or not row.get("current"):
            continue
        target_id = row["current"]["id"]
        if not target_id or target_id in seen_targets:
            continue
        seen_targets.add(target_id)
        current = next(entry for entry in existing if entry.get("id") == target_id)
        operations.append({
            "op": "update",
            "id": target_id,
            "order": current.get("order") or 1,
            "item": {
                **row["item"],
                "scheduled_date": current.get("scheduled_date"),
                "date_source": current.get("date_source") or "",
            },
        })
        replaced += 1

    return {
        "rows": prepared,
        "operations": operations,
        "after_count": len(existing),
        "added": 0,
        "replaced": replaced,
        "confirmation": f"Будет заменено: {replaced} {_lessons_word(replaced)}. Добавлено: 0.",
        "blocking_errors": [],
        "warnings": [],
        "shifts": [],
    }


def _assign_automatic_dates(rows: list[dict], start: date | None, interval: str) -> None:
    if not start:
        return
    dates = generate_plan_dates(start, len(rows), interval)
    for index, row in enumerate(rows):
        item = row["item"]
        if item.get("date_source") == "manual" and item.get("scheduled_date"):
            continue
        if item.get("scheduled_date"):
            continue
        generated = dates[index] if index < len(dates) else None
        if generated:
            item["scheduled_date"] = generated.isoformat()
            item["date_source"] = "automatic"


def items_from_plan(plan: LessonPlan, interval: str = "weekly") -> list[dict]:
    items = list(plan.items.order_by("order", "id"))
    return _existing_entries(items, interval)
