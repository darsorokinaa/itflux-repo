"""API and PDF views — React SPA."""
import json
import logging
import os
import re
import io
import csv
import html as html_lib
import zipfile
from functools import lru_cache
from urllib.parse import parse_qs, quote, urlencode, urlparse, urlunparse
from urllib import request as urlrequest, error as urlerror
import secrets
import threading
import time
from datetime import datetime
from uuid import uuid4

import jwt as pyjwt

from django.conf import settings as django_settings
from django.core.signing import BadSignature, Signer
from django.db import transaction
from django.db.models import Case, Count, IntegerField, Min, Prefetch, Q, Value, When
from django.http import (
    FileResponse,
    Http404,
    HttpResponse,
    HttpResponseBadRequest,
    HttpResponseRedirect,
    JsonResponse,
)
from django.shortcuts import get_object_or_404, render
from django.template.loader import render_to_string
from django.utils.html import strip_tags
from django.utils import timezone
from django.contrib.auth.decorators import login_required
from django.views.decorators.csrf import csrf_exempt, ensure_csrf_cookie
from django.views.decorators.http import require_http_methods
from rest_framework.views import APIView
from rest_framework.response import Response as DRFResponse
try:
    from weasyprint import HTML as WeasyHTML
    _WEASYPRINT_OK = True
except Exception:
    WeasyHTML = None  # type: ignore[assignment,misc]
    _WEASYPRINT_OK = False

from .error_report_utils import notify_error_report_email
from .models import (
    Announcement,
    Criteria,
    ErrorReport,
    Lesson,
    Level,
    LinkedTaskGroup,
    Mark,
    Subject,
    SubTopic,
    SupportInfo,
    Task,
    TaskGroup,
    TaskGroupMember,
    TaskList,
    Update,
    Variant,
    VariantContent,
    username_for_created_by,
)
from .serializers import (
    LessonAdminSerializer,
    LessonCatalogSerializer,
)
from .latex_utils import process_latex
from . import pdf_utils
from . import telegram_utils
from .report_pedagogy import build_pedagogical_report_context

logger = logging.getLogger(__name__)

_CKEDITOR_ALLOWED_EXTENSIONS = {"jpg", "jpeg", "png", "gif", "webp"}
_CKEDITOR_MAX_FILE_SIZE = 5 * 1024 * 1024  # 5MB


_INNER_TABLE_RE = re.compile(r"<table\b[^>]*>(?:(?!<table\b).)*?</table>", re.IGNORECASE | re.DOTALL)
_TR_RE = re.compile(r"(<tr\b[^>]*>)(.*?)(</tr>)", re.IGNORECASE | re.DOTALL)
_CELL_RE = re.compile(r"<t[dh]\b[^>]*>.*?</t[dh]>", re.IGNORECASE | re.DOTALL)
_TASK_HTML_BLOCK_RE = re.compile(
    r'<div\b[^>]*class=["\'][^"\']*\btask-html-block\b[^"\']*["\'][^>]*>\s*<p\b[^>]*>.*?</p>\s*</div>',
    re.IGNORECASE | re.DOTALL,
)
_EGE_INF_1_SPARSE_POINT_TASK_IDS = {
    13715, 13716, 13718, 13720, 13721, 13722, 13725, 13726, 13727, 13729,
    13731, 13733, 13736, 13738, 13739, 13740, 13741, 13744, 13746, 13748,
    13749, 13751, 13752, 13753, 13757, 13758, 13762, 13764, 13768, 13769,
    13770, 13771, 13776, 13777, 13778, 13779, 13780, 13782, 13784, 13785,
    13786, 13787, 13789, 13790, 13792, 13793, 13795, 13796, 13797, 13798,
    13801, 13805, 13807, 13808, 13811, 13812, 13816, 13820, 13821, 13824,
    13827, 13828, 13829, 13831, 13832, 13833, 13834, 13836, 13838, 13839,
    13840, 13843, 13848, 13850, 13851, 13855, 13856, 13857, 13859, 13861,
    13863, 13864, 13865, 13866, 13867, 13868, 13869,
}


def _html_cell_text(cell_html: str) -> str:
    text = html_lib.unescape(strip_tags(cell_html))
    return re.sub(r"\s+", " ", text.replace("\xa0", " ")).strip()


def _is_point_label(text: str) -> bool:
    value = (text or "").strip()
    if len(value) > 12:
        return False
    return bool(
        re.fullmatch(r"[ПпPp]\s*[1-9]\d*", value)
        or re.fullmatch(r"[A-Za-zА-Яа-яЁё]", value)
        or re.fullmatch(r"[1-9]\d*", value)
    )


def _empty_td() -> str:
    return "<td>&nbsp;</td>"


def _solve_sparse_symmetric_matrix(labels: list[str], row_values: list[list[str]]) -> list[list[str | None]] | None:
    size = len(labels)
    matrix: list[list[str | None]] = [[None for _ in range(size)] for _ in range(size)]

    def solve(row: int, col: int, value_idx: int) -> bool:
        if row == size:
            return True
        if col == size:
            return value_idx == len(row_values[row]) and solve(row + 1, 0, 0)
        if col == row:
            return solve(row, col + 1, value_idx)

        if matrix[row][col] is not None:
            if value_idx < len(row_values[row]) and row_values[row][value_idx] == matrix[row][col]:
                return solve(row, col + 1, value_idx + 1)
            return False

        if solve(row, col + 1, value_idx):
            return True

        if value_idx < len(row_values[row]):
            value = row_values[row][value_idx]
            matrix[row][col] = value
            matrix[col][row] = value
            if solve(row, col + 1, value_idx + 1):
                return True
            matrix[row][col] = None
            matrix[col][row] = None
        return False

    return matrix if solve(0, 0, 0) else None


def _fill_sparse_point_table(table_html: str) -> str:
    rows = list(_TR_RE.finditer(table_html))
    if len(rows) < 4 or len(rows) > 20:
        return table_html

    row_cells = [_CELL_RE.findall(match.group(2)) for match in rows]
    if any(not cells for cells in row_cells):
        return table_html

    header_texts = [_html_cell_text(cell) for cell in row_cells[0]]
    has_corner = bool(header_texts and not _is_point_label(header_texts[0]))
    labels = [text for text in header_texts if _is_point_label(text)]
    if len(labels) < 3 or len(labels) > 15:
        return table_html
    if len(labels) == len(row_cells[0]) and has_corner:
        return table_html

    entries = []
    for cells in row_cells[1 : 1 + len(labels)]:
        row_label = _html_cell_text(cells[0])
        if not _is_point_label(row_label):
            return table_html
        values = [_html_cell_text(cell) for cell in cells[1:] if _html_cell_text(cell)]
        entries.append({"label": row_label, "cells": cells, "values": values})

    if [entry["label"] for entry in entries] != labels:
        return table_html

    if all(len(entry["cells"]) >= len(labels) + 1 for entry in entries):
        return table_html

    matrix = _solve_sparse_symmetric_matrix(labels, [entry["values"] for entry in entries])
    if matrix is None:
        return table_html

    replacements: dict[tuple[int, int], str] = {}

    header_cells = row_cells[0]
    new_header = []
    if has_corner:
        new_header.append(header_cells[0])
        label_cells = header_cells[1:]
    else:
        new_header.append(_empty_td())
        label_cells = header_cells
    new_header.extend(label_cells)
    replacements[(rows[0].start(2), rows[0].end(2))] = "".join(new_header)

    for row_idx, entry in enumerate(entries, start=1):
        cells = entry["cells"]
        value_cells = [cell for cell in cells[1:] if _html_cell_text(cell)]
        value_columns = [col for col, value in enumerate(matrix[row_idx - 1]) if value is not None]
        value_by_col = {
            col: value_cells[i]
            for i, col in enumerate(value_columns)
            if i < len(value_cells)
        }
        new_cells = [cells[0]]
        for col in range(len(labels)):
            new_cells.append(value_by_col.get(col, _empty_td()))
        replacements[(rows[row_idx].start(2), rows[row_idx].end(2))] = "".join(new_cells)

    pieces = []
    cursor = 0
    for (start, end), replacement in sorted(replacements.items()):
        pieces.append(table_html[cursor:start])
        pieces.append(replacement)
        cursor = end
    pieces.append(table_html[cursor:])
    return "".join(pieces)


def _fill_numbered_point_table(table_html: str) -> str:
    rows = list(_TR_RE.finditer(table_html))
    if len(rows) < 4 or len(rows) > 25:
        return table_html

    row_cells = [_CELL_RE.findall(match.group(2)) for match in rows]
    if any(not cells for cells in row_cells):
        return table_html

    header_idx = None
    labels: list[str] = []
    for idx, cells in enumerate(row_cells[:-1]):
        texts = [_html_cell_text(cell) for cell in cells]
        if len(texts) >= 3 and all(_is_point_label(text) for text in texts):
            header_idx = idx
            labels = texts
            break

    if header_idx is None or not labels:
        return table_html

    data_start = header_idx + 1
    data_rows = row_cells[data_start : data_start + len(labels)]
    if len(data_rows) < len(labels):
        return table_html

    entries = []
    for row_offset, cells in enumerate(data_rows):
        first_text = _html_cell_text(cells[0])
        has_side_title = row_offset == 0 and "номер" in first_text.lower() and len(cells) >= 2
        label_idx = 1 if has_side_title else 0
        value_start = label_idx + 1
        if len(cells) <= label_idx:
            return table_html
        row_label = _html_cell_text(cells[label_idx])
        if row_label != labels[row_offset]:
            return table_html
        entries.append({
            "cells": cells,
            "prefix": cells[:value_start],
            "value_start": value_start,
            "values": [_html_cell_text(cell) for cell in cells[value_start:] if _html_cell_text(cell)],
        })

    if all(len(entry["cells"]) - entry["value_start"] >= len(labels) for entry in entries):
        return table_html

    matrix = _solve_sparse_symmetric_matrix(labels, [entry["values"] for entry in entries])
    if matrix is None:
        return table_html

    replacements: dict[tuple[int, int], str] = {}
    title_row_cells = row_cells[header_idx - 1] if header_idx > 0 else []
    if (
        header_idx > 0
        and len(title_row_cells) == 1
        and "номер" in _html_cell_text(title_row_cells[0]).lower()
    ):
        replacements[
            (rows[header_idx - 1].start(2), rows[header_idx - 1].end(2))
        ] = '<td colspan="2" rowspan="2">&nbsp;</td>' + title_row_cells[0]

    for row_offset, entry in enumerate(entries):
        value_cells = [
            cell
            for cell in entry["cells"][entry["value_start"]:]
            if _html_cell_text(cell)
        ]
        value_columns = [
            col
            for col, value in enumerate(matrix[row_offset])
            if value is not None
        ]
        value_by_col = {
            col: value_cells[i]
            for i, col in enumerate(value_columns)
            if i < len(value_cells)
        }
        new_cells = list(entry["prefix"])
        for col in range(len(labels)):
            new_cells.append(value_by_col.get(col, _empty_td()))
        row_match = rows[data_start + row_offset]
        replacements[(row_match.start(2), row_match.end(2))] = "".join(new_cells)

    pieces = []
    cursor = 0
    for (start, end), replacement in sorted(replacements.items()):
        pieces.append(table_html[cursor:start])
        pieces.append(replacement)
        cursor = end
    pieces.append(table_html[cursor:])
    return "".join(pieces)


def _fill_sparse_point_tables_in_html(html: str) -> str:
    if not html or "<table" not in html.lower():
        return html

    def replace_table(match: re.Match[str]) -> str:
        table_html = match.group(0)
        filled = _fill_sparse_point_table(table_html)
        if filled != table_html:
            return filled
        return _fill_numbered_point_table(table_html)

    return _INNER_TABLE_RE.sub(replace_table, html)


def _block_contains_image(block_html: str) -> bool:
    return bool(re.search(r"<img\b", block_html, re.IGNORECASE))


def _build_point_matrix_table_html(labels: list[str], matrix: list[list[str | None]]) -> str:
    head_cells = ['<td colspan="2" rowspan="2">&nbsp;</td>', '<td colspan="%d"><p>Номер пункта</p></td>' % len(labels)]
    rows = ["<tr>%s</tr>" % "".join(head_cells)]
    rows.append("<tr>%s</tr>" % "".join(f"<td><p>{label}</p></td>" for label in labels))
    for row_idx, label in enumerate(labels):
        cells = []
        if row_idx == 0:
            cells.append(f'<td rowspan="{len(labels)}"><p>Номер пункта</p></td>')
        cells.append(f"<td><p>{label}</p></td>")
        for value in matrix[row_idx]:
            cells.append(f"<td><p>{value}</p></td>" if value is not None else _empty_td())
        rows.append("<tr>%s</tr>" % "".join(cells))
    return '<table class="raw-rebuilt-point-table"><tbody>%s</tbody></table>' % "".join(rows)


def _build_simple_point_matrix_table_html(labels: list[str], matrix: list[list[str | None]]) -> str:
    rows = ["<tr>%s</tr>" % ("<td>&nbsp;</td>" + "".join(f"<td><p>{label}</p></td>" for label in labels))]
    for row_idx, label in enumerate(labels):
        cells = [f"<td><p>{label}</p></td>"]
        for value in matrix[row_idx]:
            cells.append(f"<td><p>{value}</p></td>" if value is not None else _empty_td())
        rows.append("<tr>%s</tr>" % "".join(cells))
    return '<table class="raw-rebuilt-point-table"><tbody>%s</tbody></table>' % "".join(rows)


def _partition_flattened_point_rows(
    labels: list[str],
    texts: list[str],
    blocks: list[re.Match[str]],
    token_start: int,
) -> tuple[list[list[str]], int] | None:
    size = len(labels)
    solutions: list[tuple[list[list[str]], int]] = []

    def search(row_idx: int, idx: int, current: list[list[str]]) -> None:
        if solutions:
            return
        if row_idx == size:
            matrix = _solve_sparse_symmetric_matrix(labels, current)
            if matrix is not None:
                solutions.append((current, idx))
            return
        if idx >= len(texts) or texts[idx] != labels[row_idx]:
            return

        values_start = idx + 1
        if row_idx == size - 1:
            end = values_start
            while end < len(texts):
                if _block_contains_image(blocks[end].group(0)) or "номер" in texts[end].lower():
                    break
                end += 1
            values = [text for text in texts[values_start:end] if text]
            search(row_idx + 1, end, [*current, values])
            return

        next_label = labels[row_idx + 1]
        max_end = min(len(texts), values_start + size + 1)
        for end in range(values_start, max_end):
            if texts[end] != next_label:
                continue
            values = [text for text in texts[values_start:end] if text]
            search(row_idx + 1, end, [*current, values])

    search(0, token_start, [])
    return solutions[0] if solutions else None


def _rebuild_flattened_simple_point_table_in_html(html: str) -> str:
    if not html or "task-html-block" not in html:
        return html

    blocks = list(_TASK_HTML_BLOCK_RE.finditer(html))
    if len(blocks) < 10:
        return html

    texts = [_html_cell_text(block.group(0)) for block in blocks]
    idx = 0
    while idx < len(blocks):
        preserved_image = ""
        if _block_contains_image(blocks[idx].group(0)):
            preserved_image = blocks[idx].group(0)
            label_start = idx + 1
        else:
            label_start = idx

        labels: list[str] = []
        cursor = label_start
        while cursor < len(blocks) and _is_point_label(texts[cursor]):
            if len(labels) >= 3 and texts[cursor] == labels[0]:
                break
            labels.append(texts[cursor])
            cursor += 1

        if len(labels) < 3:
            idx += 1
            continue

        partition = _partition_flattened_point_rows(labels, texts, blocks, cursor)
        if partition is None:
            idx += 1
            continue
        row_values, token_idx = partition
        matrix = _solve_sparse_symmetric_matrix(labels, row_values)
        if matrix is None:
            idx += 1
            continue

        rebuilt = _build_simple_point_matrix_table_html(labels, matrix)
        if preserved_image:
            rebuilt = preserved_image + rebuilt
        return html[:blocks[idx].start()] + rebuilt + html[blocks[token_idx - 1].end():]

    return html


def _rebuild_flattened_point_tables_in_html(html: str) -> str:
    if not html or "task-html-block" not in html or "Номер пункта" not in html:
        return html

    blocks = list(_TASK_HTML_BLOCK_RE.finditer(html))
    if len(blocks) < 10:
        return html

    texts = [_html_cell_text(block.group(0)) for block in blocks]
    replacements: list[tuple[int, int, str]] = []
    idx = 0
    while idx < len(blocks):
        if "номер" not in texts[idx].lower():
            idx += 1
            continue

        label_start = idx + 1
        preserved_image = ""
        if label_start < len(blocks) and _block_contains_image(blocks[label_start].group(0)):
            preserved_image = blocks[label_start].group(0)
            label_start += 1

        labels: list[str] = []
        cursor = label_start
        while cursor < len(blocks) and _is_point_label(texts[cursor]):
            labels.append(texts[cursor])
            cursor += 1

        if len(labels) < 3 or cursor >= len(blocks) or "номер" not in texts[cursor].lower():
            idx += 1
            continue

        partition = _partition_flattened_point_rows(labels, texts, blocks, cursor + 1)
        if partition is None:
            idx += 1
            continue
        row_values, token_idx = partition

        matrix = _solve_sparse_symmetric_matrix(labels, row_values)
        if matrix is None:
            idx += 1
            continue

        start = blocks[idx].start()
        end = blocks[token_idx - 1].end()
        rebuilt = _build_point_matrix_table_html(labels, matrix)
        if preserved_image:
            rebuilt = preserved_image + rebuilt
        replacements.append((start, end, rebuilt))
        idx = token_idx

    if not replacements:
        return html

    pieces = []
    cursor = 0
    for start, end, replacement in replacements:
        pieces.append(html[cursor:start])
        pieces.append(replacement)
        cursor = end
    pieces.append(html[cursor:])
    return "".join(pieces)


@lru_cache(maxsize=1024)
def _fill_sparse_point_tables_cached(html: str) -> str:
    return _fill_sparse_point_tables_in_html(html)


@login_required
@require_http_methods(["POST"])
def ckeditor_upload(request):
    """
    Custom CKEditor5 image upload endpoint.
    Saves files to MEDIA_ROOT/tasks/ and returns {"url": "/media/tasks/<uuid>.<ext>"}.
    """
    upload = request.FILES.get("upload")
    if not upload:
        return JsonResponse({"error": {"message": "Файл не передан (поле upload)."}}, status=400)

    if upload.size > _CKEDITOR_MAX_FILE_SIZE:
        return JsonResponse({"error": {"message": "Файл слишком большой. Максимум 5MB."}}, status=400)

    original_name = (upload.name or "").strip()
    ext = os.path.splitext(original_name)[1].lower().lstrip(".")
    if ext not in _CKEDITOR_ALLOWED_EXTENSIONS:
        return JsonResponse(
            {"error": {"message": "Недопустимый формат. Разрешены: jpg, jpeg, png, gif, webp."}},
            status=400,
        )

    media_root = str(getattr(django_settings, "MEDIA_ROOT", "") or "").strip()
    media_url = getattr(django_settings, "MEDIA_URL", "/media/") or "/media/"
    if not media_root:
        return JsonResponse({"error": {"message": "MEDIA_ROOT не настроен."}}, status=500)

    target_dir = os.path.join(media_root, "tasks")
    os.makedirs(target_dir, exist_ok=True)

    filename = f"{uuid4().hex}.{ext}"
    absolute_path = os.path.join(target_dir, filename)
    with open(absolute_path, "wb+") as f:
        for chunk in upload.chunks():
            f.write(chunk)

    media_prefix = media_url if media_url.endswith("/") else f"{media_url}/"
    return JsonResponse({"url": f"{media_prefix}tasks/{filename}"})


def get_subject_for_api(subject_param):
    """Subject по short name из URL; регистр не важен (history == History)."""
    s = (subject_param or "").strip()
    return get_object_or_404(Subject, subject_short__iexact=s)


def _is_spa_lesson_join_path(level, subject):
    """React /:level/:subject не должен перехватывать /lesson/join — иначе в API уходит subject=join."""
    return (
        str(level or "").strip().lower() == "lesson"
        and str(subject or "").strip().lower() == "join"
    )


def _subtopics_for_groups(subject_instance, level_instance, task_numbers, vpr_vf=None):
    """Подтемы для групп: TaskGroup.subtopic + Task.subtopic + все SubTopic предмета/уровня."""
    if not task_numbers:
        return []
    group_ids = _taskgroup_ids_matching_task_numbers(
        subject_instance, level_instance, task_numbers, vpr_vf
    )
    from django.db.models import Count as DbCount

    by_sid = {}
    _tm_kwargs = {}
    if vpr_vf:
        for _k, _v in vpr_vf.items():
            _tm_kwargs[f"task__{_k}"] = _v

    # 1) По TaskGroup.subtopic (пропускаем sid=None) — только если есть группы
    if group_ids:
        for row in (
            TaskGroup.objects.filter(id__in=group_ids)
            .values("subtopic_id")
            .annotate(cnt=DbCount("id"))
        ):
            sid = row["subtopic_id"]
            if sid is None:
                continue
            cnt = row["cnt"]
            st = SubTopic.objects.filter(id=sid).values_list("title", flat=True).first()
            by_sid[sid] = {"id": sid, "title": st or f"Подтема {sid}", "group_count": cnt, "display_count": cnt}

    # 2) Подтемы из Task.subtopic в группах (только если есть группы)
    if group_ids:
        for row in (
            TaskGroupMember.objects.filter(
                task_group_id__in=group_ids,
                task__is_active=True,
                task__subtopic_id__isnull=False,
                **_tm_kwargs,
            )
            .values("task__subtopic_id")
            .annotate(cnt=DbCount("task_group_id", distinct=True))
        ):
            sid = row["task__subtopic_id"]
            if not sid:
                continue
            cnt = row["cnt"]
            if sid not in by_sid:
                st = SubTopic.objects.filter(id=sid).values_list("title", flat=True).first()
                by_sid[sid] = {"id": sid, "title": st or f"Подтема {sid}", "group_count": cnt, "display_count": cnt}
            else:
                by_sid[sid]["group_count"] = max(by_sid[sid]["group_count"], cnt)
                by_sid[sid]["display_count"] = max(by_sid[sid]["display_count"], cnt)

    # 3) Все SubTopic предмета/уровня — TaskList для наших номеров
    tasklist_ids = list(
        TaskList.objects.filter(
            subject=subject_instance,
            level=level_instance,
            task_number__in=task_numbers,
        ).values_list("id", flat=True)
    )
    for st in SubTopic.objects.filter(task_list_id__in=tasklist_ids).order_by("order", "title"):
        if st.id not in by_sid:
            cnt = TaskGroupMember.objects.filter(
                task_group_id__in=group_ids,
                task__is_active=True,
                task__subtopic_id=st.id,
                **_tm_kwargs,
            ).values("task_group_id").distinct().count()
            task_cnt = Task.active_objects.filter(
                task__subject=subject_instance,
                task__level=level_instance,
                task__task_number__in=task_numbers,
                subtopic_id=st.id,
                **(vpr_vf or {}),
            ).count()
            display_count = cnt if cnt > 0 else max(0, task_cnt // len(task_numbers))
            by_sid[st.id] = {"id": st.id, "title": st.title, "group_count": cnt, "display_count": display_count}

    # 4) Если всё ещё пусто — все SubTopic предмета/уровня (на случай разных частей)
    if not by_sid:
        all_tls = TaskList.objects.filter(
            subject=subject_instance, level=level_instance
        ).values_list("id", flat=True)
        for st in SubTopic.objects.filter(task_list_id__in=all_tls).order_by("order", "title")[:20]:
            cnt = TaskGroupMember.objects.filter(
                task_group_id__in=group_ids,
                task__is_active=True,
                task__subtopic_id=st.id,
                **_tm_kwargs,
            ).values("task_group_id").distinct().count()
            task_cnt = Task.active_objects.filter(
                task__subject=subject_instance,
                task__level=level_instance,
                subtopic_id=st.id,
                **(vpr_vf or {}),
            ).count()
            n_per_group = len(task_numbers)
            display_count = cnt if cnt > 0 else max(0, task_cnt // n_per_group)
            by_sid[st.id] = {"id": st.id, "title": st.title, "group_count": cnt, "display_count": display_count}

    return sorted(by_sid.values(), key=lambda x: (-x["group_count"], x["title"]))


def _normalize_content(data):
    if not isinstance(data, dict):
        return {}
    result = {}
    for k, v in data.items():
        if isinstance(v, dict):
            continue
        try:
            n = int(v)
        except (TypeError, ValueError):
            continue
        if n > 0:
            result[str(k)] = n
    return result


def _linked_group_subtopic_config_key(task_numbers):
    """
    Канонический ключ для group_subtopic_config.
    Порядок номеров в LinkedTaskGroup.task_numbers и в JSON tasks[].task_numbers может различаться;
    без сортировки конфиг подтем не находился, и группы собирались без учёта выбранных подтем.
    """
    if not task_numbers:
        return tuple()
    ints = []
    for n in task_numbers:
        try:
            ints.append(int(n))
        except (TypeError, ValueError):
            continue
    return tuple(sorted(ints))


def _group_members_match_group(members, required_nums, expected_len):
    """Проверка: в группе ровно expected_len членов и множество номеров совпадает с required_nums."""
    if len(members) != expected_len:
        return False
    return {m.task_number for m in members} == required_nums


def _tasklist_id_for_number(id_by_number, n):
    """Сопоставление номера задания с TaskList.id (в id_by_number ключи — int из БД, n может быть str из JSON)."""
    if not id_by_number:
        return None
    if n in id_by_number:
        return id_by_number[n]
    try:
        return id_by_number.get(int(n))
    except (TypeError, ValueError):
        return None


def _parse_linked_task_numbers(raw):
    """
    LinkedTaskGroup.task_numbers в JSONField: числа или строки.
    Без int()-нормализации id_by_number.get("3") не находит ключ 3 → падаем в fallback
    и берём по одной случайной задаче на номер вместо целой TaskGroup.
    """
    if not raw:
        return []
    out = []
    for n in raw:
        try:
            out.append(int(n))
        except (TypeError, ValueError):
            return None
    return out


def favicon(request):
    from django.contrib.staticfiles import finders

    png_path = finders.find("favicon.png")
    if png_path and os.path.isfile(png_path):
        return FileResponse(open(png_path, "rb"), content_type="image/png")
    return HttpResponse(status=404)


_YANDEX_WEBMASTER_HTML = {
    "yandex_ef13ec5e267d285b.html": (
        "<html>\n"
        "    <head>\n"
        '        <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">\n'
        "    </head>\n"
        "    <body>Verification: ef13ec5e267d285b</body>\n"
        "</html>\n"
    ),
    "yandex_031b211eae53d997.html": (
        "<html>\n"
        "    <head>\n"
        '        <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">\n'
        "    </head>\n"
        "    <body>Verification: 031b211eae53d997</body>\n"
        "</html>\n"
    ),
}


def yandex_webmaster_verification(request, filename="yandex_ef13ec5e267d285b.html"):
    """Файл подтверждения Яндекс.Вебмастера из корня репозитория или встроенный шаблон."""
    if not re.fullmatch(r"yandex_[0-9a-f]+\.html", filename):
        return HttpResponse(status=404)

    search_roots = [
        django_settings.BASE_DIR.parent,
        django_settings.BASE_DIR,
        getattr(django_settings, "FRONTEND_DIR", django_settings.BASE_DIR.parent / "frontend" / "dist"),
        django_settings.BASE_DIR.parent / "frontend" / "public",
    ]
    for base in search_roots:
        p = os.path.join(base, filename)
        if os.path.isfile(p):
            return FileResponse(open(p, "rb"), content_type="text/html; charset=UTF-8")

    body = _YANDEX_WEBMASTER_HTML.get(filename)
    if body:
        return HttpResponse(body, content_type="text/html; charset=UTF-8")

    return HttpResponse("Verification file not found", status=404, content_type="text/plain; charset=UTF-8")


def react_app(request):
    frontend_dir = getattr(django_settings, 'FRONTEND_DIR', django_settings.BASE_DIR.parent / 'frontend' / 'dist')
    index_path = frontend_dir / 'index.html'
    if index_path.exists():
        with open(index_path, 'r', encoding='utf-8') as f:
            resp = HttpResponse(f.read(), content_type='text/html; charset=utf-8')
        # Иначе браузер/CDN держит старый index.html и подгружает старый бандл без новых экранов/карточек.
        resp["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        resp["Pragma"] = "no-cache"
        return resp
    return HttpResponse(
        "<div><h1>Frontend не собран</h1><p>Запусти <code>npm run build</code> в frontend/</p></div>",
        status=500,
    )


# Фильтр ФИПИ: автор пустой, 'ФИПИ' или содержит любое из этих слов (без учёта регистра)
_FIPI_AUTHOR_KEYWORDS = [
    "фипи", "fipi", "егкр", "егэ", "апробация", "открытый вариант", "открытый",
    "демоверсия", "демо", "досрочный",
]


def _get_fipi_q():
    """Единый фильтр ФИПИ: автор пустой, или 'ФИПИ', или содержит любое ключевое слово из списка."""
    return (
        Q(author__isnull=True)
        | Q(author__exact="")
        | Q(author__iexact="ФИПИ")
        | Q(author__icontains="фипи")
        | Q(author__icontains="fipi")
        | Q(author__icontains="ЕГКР")
        | Q(author__icontains="егэ")
        | Q(author__icontains="ЕГЭ")
        | Q(author__icontains="Апробация")
        | Q(author__icontains="Открытый вариант")
        | Q(author__icontains="Открытый")
        | Q(author__icontains="демоверсия")
        | Q(author__icontains="Демоверсия")
        | Q(author__icontains="демо")
        | Q(author__icontains="Досрочный")
    )


def _get_fipi_task_filter_q():
    """ФИПИ в банке: поле author и импорт с created_by=ФИПИ."""
    return (
        _get_fipi_q()
        | Q(created_by__iexact="ФИПИ")
        | Q(created_by__icontains="fipi")
    )


def _vpr_task_filters_from_request(request, level_str):
    """GET: класс (grade) и углублённость (advanced=1) для заданий ВПР. None — не ВПР."""
    if (level_str or "").lower() != "vpr":
        return None
    flt = {}
    g = (request.GET.get("grade") or "").strip()
    if g.isdigit():
        flt["vpr_class"] = int(g)
    flt["vpr_advanced"] = (request.GET.get("advanced") or "").strip() == "1"
    return flt


def _vpr_task_filters_from_payload(data, level_str):
    """POST варианта/теста: vpr_grade, vpr_advanced в JSON."""
    if (level_str or "").lower() != "vpr" or not isinstance(data, dict):
        return None
    flt = {}
    g = data.get("vpr_grade", data.get("grade"))
    if g is not None and str(g).strip().isdigit():
        flt["vpr_class"] = int(g)
    if "vpr_advanced" in data:
        flt["vpr_advanced"] = bool(data.get("vpr_advanced"))
    else:
        flt["vpr_advanced"] = False
    return flt


def _taskmember_q_for_vpr(vf):
    """Фильтр TaskGroupMember по полям связанной Task (vf — словарь с ключами модели Task)."""
    q = Q(task__is_active=True)
    if vf:
        for k, v in vf.items():
            q &= Q(**{f"task__{k}": v})
    return q


def _taskgroup_ids_matching_task_numbers(subject_instance, level_instance, task_numbers, vpr_vf=None):
    """ID групп с ровно len(task_numbers) членами и нужными номерами; при vpr_vf все задачи проходят фильтр ВПР."""
    n = len(task_numbers)
    if n <= 0:
        return []
    base = TaskGroup.objects.filter(
        subject=subject_instance,
        level=level_instance,
        taskgroupmember__task_number__in=task_numbers,
    )
    if vpr_vf:
        return list(
            base.annotate(
                good_m=Count("taskgroupmember", filter=_taskmember_q_for_vpr(vpr_vf)),
                all_m=Count("taskgroupmember", distinct=True),
            )
            .filter(good_m=n, all_m=n)
            .values_list("id", flat=True)
            .distinct()
        )
    return list(
        base.exclude(taskgroupmember__task__is_active=False)
        .annotate(mcnt=Count("taskgroupmember", distinct=True))
        .filter(mcnt=n)
        .values_list("id", flat=True)
        .distinct()
    )


def _create_variant(subject_short, level_str, body_bytes, create=True, request=None):
    subject_instance = get_subject_for_api(subject_short)
    level_instance = get_object_or_404(Level, level=level_str)
    data = json.loads(body_bytes)
    vpr_vf = _vpr_task_filters_from_payload(data, level_str) if isinstance(data, dict) else None

    # Глобальный флаг "только ФИПИ" (для варианта/теста)
    only_fipi = False
    if isinstance(data, dict):
        only_fipi = bool(data.get("only_fipi"))

    # Унифицированное извлечение content: либо из поля "content", либо из корневого словаря
    if isinstance(data, dict) and "content" in data:
        content = _normalize_content(data["content"])
    else:
        content = _normalize_content(data)
    # Дополнительно: для linked-групп из tasks обеспечиваем нужное кол-во ГРУПП по каждому слоту
    group_subtopic_config = {}  # key: _linked_group_subtopic_config_key -> {subtopic_ids, subtopic_counts}
    if isinstance(data, dict) and data.get("tasks"):
        content = dict(content)
        for t in data["tasks"]:
            if isinstance(t, dict):
                nums = tuple(t.get("task_numbers") or [])
                cnt = t.get("count")
                try:
                    cnt = int(cnt) if cnt is not None else 0
                except (TypeError, ValueError):
                    cnt = 0
                if nums and cnt > 0:
                    for n in nums:
                        try:
                            ni = int(n)
                        except (TypeError, ValueError):
                            continue
                        tl = TaskList.objects.filter(
                            subject=subject_instance,
                            level=level_instance,
                            task_number=ni,
                        ).values_list("id", flat=True).first()
                        if tl:
                            key = str(tl)
                            content[key] = max(content.get(key, 0), cnt)
                    # Подтемы для группы: subtopic_ids, subtopic_counts в самом элементе tasks
                    st_ids = t.get("subtopic_ids")
                    st_counts = t.get("subtopic_counts")
                    if st_ids is not None or (st_counts and isinstance(st_counts, dict)):
                        cfg = {}
                        if isinstance(st_ids, list):
                            cfg["subtopic_ids"] = [int(x) for x in st_ids if x is not None and str(x) not in ("", "all")]
                        else:
                            cfg["subtopic_ids"] = []
                        if isinstance(st_counts, dict):
                            cfg["subtopic_counts"] = {}
                            for k, v in st_counts.items():
                                if str(k) == "all":
                                    cfg["subtopic_counts"]["all"] = int(v) if v else 0
                                else:
                                    try:
                                        ki = int(k)
                                        n = int(v) if v else 0
                                        if n > 0:
                                            cfg["subtopic_counts"][ki] = n
                                    except (TypeError, ValueError):
                                        pass
                        else:
                            cfg["subtopic_counts"] = {}
                        if cfg["subtopic_ids"] or cfg["subtopic_counts"]:
                            cfg_key = _linked_group_subtopic_config_key(nums)
                            if cfg_key:
                                group_subtopic_config[cfg_key] = cfg
    tasklist_ids = [int(k) for k in content.keys()]
    # ОГЭ инф. №13: какие подтемы включать (текст / презентация); иначе — по одной задаче из каждой подтемы
    oge_inf_13_subtopics = None
    if isinstance(data, dict) and data.get("oge_inf_13_subtopics"):
        raw = data["oge_inf_13_subtopics"]
        if isinstance(raw, list):
            tmp = []
            for x in raw:
                if x is None or str(x).strip() == "":
                    continue
                try:
                    tmp.append(int(x))
                except (TypeError, ValueError):
                    continue
            oge_inf_13_subtopics = tmp or None

    subtopic_ids = None
    subtopic_counts = None
    if isinstance(data, dict) and data.get("subtopic_ids"):
        raw = data["subtopic_ids"]
        subtopic_ids = [int(x) for x in raw if x is not None and str(x).strip() != ""]
        if not subtopic_ids:
            subtopic_ids = None
    if isinstance(data, dict) and data.get("subtopic_counts") and isinstance(data["subtopic_counts"], dict):
        subtopic_counts = {}
        for k, v in data["subtopic_counts"].items():
            if isinstance(v, dict):
                continue
            try:
                n = int(v)
            except (TypeError, ValueError):
                continue
            if n > 0:
                try:
                    subtopic_counts[int(k)] = n
                except (TypeError, ValueError):
                    pass
        if not subtopic_counts:
            subtopic_counts = None
    if not content:
        raise ValueError("Не выбрано ни одного задания")

    # Тот же фильтр ФИПИ, что и в тренажёре (без учёта подтем)
    fipi_q = _get_fipi_q() if only_fipi else Q()

    tasklist_ids = [int(k) for k in content.keys()]

    ordered_tasklists = list(
        TaskList.objects.filter(
            subject=subject_instance,
            level=level_instance,
            id__in=tasklist_ids,
        ).order_by("task_number")
    )
    if not ordered_tasklists:
        raise ValueError("Указанные задания не найдены для этого предмета и уровня")

    id_by_number = {tl.task_number: tl.id for tl in ordered_tasklists}
    selected_tasks = []
    handled_tasklist_ids = set()


    def take_linked_groups(linked):
        """
        Целые TaskGroup из БД: случайный выбор групп, все задачи только из одной группы за раз.
        Подтема: группа подходит, если subtopic у TaskGroup совпадает ИЛИ у всех задач в группе
        один и тот же subtopic_id из выбранных (фильтр в Python — без ложных совпадений из-за JOIN).
        """
        from random import shuffle

        parsed = _parse_linked_task_numbers(linked.task_numbers)
        if parsed is None:
            return None, None
        task_numbers = parsed
        if not task_numbers:
            return None, None
        ids_for_group = [_tasklist_id_for_number(id_by_number, n) for n in task_numbers]
        if any(i is None for i in ids_for_group):
            return None, None
        cfg_key = _linked_group_subtopic_config_key(task_numbers)
        cfg = group_subtopic_config.get(cfg_key, {}) if cfg_key else {}
        st_counts = cfg.get("subtopic_counts") or {}
        st_ids = cfg.get("subtopic_ids") or []

        member_qs = TaskGroupMember.objects.select_related("task").filter(task__is_active=True)
        if vpr_vf:
            for _k, _v in vpr_vf.items():
                member_qs = member_qs.filter(**{f"task__{_k}": _v})
        member_prefetch = Prefetch(
            "taskgroupmember_set",
            queryset=member_qs.order_by("task_number"),
        )
        required_nums = set(task_numbers)
        n_per = len(task_numbers)

        def _linked_groups_base_qs(extra_filter=None):
            if vpr_vf:
                qs = (
                    TaskGroup.objects.filter(
                        subject=subject_instance,
                        level=level_instance,
                        taskgroupmember__task_number__in=task_numbers,
                    )
                    .annotate(
                        good_m=Count(
                            "taskgroupmember",
                            filter=_taskmember_q_for_vpr(vpr_vf),
                        ),
                        all_m=Count("taskgroupmember", distinct=True),
                    )
                    .filter(good_m=n_per, all_m=n_per)
                    .distinct()
                )
            else:
                qs = (
                    TaskGroup.objects.filter(
                        subject=subject_instance,
                        level=level_instance,
                        taskgroupmember__task_number__in=task_numbers,
                    )
                    .exclude(taskgroupmember__task__is_active=False)
                    .annotate(mcnt=Count("taskgroupmember", distinct=True))
                    .filter(mcnt=n_per)
                    .distinct()
                )
            if extra_filter is not None:
                qs = qs.filter(extra_filter)
            return qs

        def _group_matches_subtopic_filter(group, members, allowed_ids, require_null_group_subtopic=False):
            """allowed_ids: frozenset[int] или None. require_null: группа и все задачи без подтемы."""
            if require_null_group_subtopic:
                if group.subtopic_id is not None:
                    return False
                return members and all(m.task.subtopic_id is None for m in members)
            if allowed_ids is None:
                return True
            gsid = group.subtopic_id
            if gsid is not None and gsid in allowed_ids:
                return True
            task_subs = [m.task.subtopic_id for m in members]
            if not task_subs:
                return False
            u = set(task_subs)
            if len(u) != 1:
                return False
            only = task_subs[0]
            return only is not None and only in allowed_ids

        def _pick_random_full_groups(
            candidate_qs,
            num_groups_needed,
            allowed_subtopic_ids=None,
            require_null_group_subtopic=False,
            exclude_group_ids=None,
        ):
            if num_groups_needed <= 0:
                return []
            exclude_group_ids = exclude_group_ids or set()
            ids = list(candidate_qs.values_list("id", flat=True).distinct())
            shuffle(ids)
            picked_tasks = []
            used_gids = set()
            for gid in ids:
                if len(picked_tasks) >= num_groups_needed * n_per:
                    break
                if gid in used_gids or gid in exclude_group_ids:
                    continue
                group = (
                    TaskGroup.objects.filter(pk=gid)
                    .prefetch_related(member_prefetch)
                    .first()
                )
                if not group:
                    continue
                members = sorted(
                    group.taskgroupmember_set.all(),
                    key=lambda m: (m.task_number, m.id),
                )
                if not _group_members_match_group(members, required_nums, n_per):
                    continue
                if not _group_matches_subtopic_filter(
                    group, members, allowed_subtopic_ids, require_null_group_subtopic
                ):
                    continue
                tasks_row = [m.task for m in members]
                if only_fipi and fipi_q:
                    tids = [t.id for t in tasks_row]
                    if (
                        Task.active_objects.filter(id__in=tids)
                        .filter(fipi_q)
                        .count()
                        != len(tids)
                    ):
                        continue
                picked_tasks.extend(tasks_row)
                used_gids.add(gid)
            if len(picked_tasks) < num_groups_needed * n_per:
                return None
            return picked_tasks

        try:
            num_groups_wanted = int(min(content.get(str(i), 0) for i in ids_for_group))
        except (TypeError, ValueError):
            num_groups_wanted = 0
        if num_groups_wanted <= 0:
            return None, None

        base_plain = _linked_groups_base_qs()

        def _pick_plain(n):
            return _pick_random_full_groups(base_plain, n, None, False)

        wants_subtopic_cfg = bool(st_counts) or bool(st_ids)
        all_tasks = []

        if wants_subtopic_cfg:
            # Один выбор подтемы с count (типичный случай): одна целая группа за раз, не суммируем лишние ключи
            positive_counts = []
            for sid_raw, raw_cnt in st_counts.items():
                try:
                    c = int(raw_cnt) if raw_cnt is not None and raw_cnt != "" else 0
                except (TypeError, ValueError):
                    continue
                if c <= 0:
                    continue
                sk = sid_raw if isinstance(sid_raw, str) else str(sid_raw)
                if sk == "all":
                    positive_counts.append(("all", c))
                elif sid_raw is None or sk == "null":
                    positive_counts.append(("null", c))
                else:
                    try:
                        positive_counts.append((int(sid_raw), c))
                    except (TypeError, ValueError):
                        continue

            remaining = num_groups_wanted

            if positive_counts:
                # Если выбрана ровно одна числовая подтема — берём min(её count, remaining) групп с этой подтемой
                numeric_only = [x for x in positive_counts if isinstance(x[0], int)]
                all_all = [x for x in positive_counts if x[0] == "all"]
                all_null = [x for x in positive_counts if x[0] == "null"]

                if len(numeric_only) == 1 and not all_all and not all_null:
                    sid_i, c = numeric_only[0]
                    take = min(c, remaining)
                    part = _pick_random_full_groups(
                        base_plain, take, frozenset({sid_i}), False
                    )
                    if part:
                        all_tasks.extend(part)
                elif all_all and not numeric_only and not all_null:
                    take = min(all_all[0][1], remaining)
                    part = _pick_plain(take)
                    if part:
                        all_tasks.extend(part)
                elif all_null and not numeric_only and not all_all:
                    take = min(all_null[0][1], remaining)
                    part = _pick_random_full_groups(
                        base_plain, take, None, True
                    )
                    if part:
                        all_tasks.extend(part)
                else:
                    # Несколько подтем / смешанный выбор: по очереди, не больше remaining
                    for kind, c in positive_counts:
                        if remaining <= 0:
                            break
                        take = min(c, remaining)
                        if kind == "all":
                            part = _pick_plain(take)
                        elif kind == "null":
                            part = _pick_random_full_groups(
                                base_plain, take, None, True
                            )
                        else:
                            part = _pick_random_full_groups(
                                base_plain, take, frozenset({kind}), False
                            )
                        if not part:
                            all_tasks = []
                            break
                        all_tasks.extend(part)
                        remaining = num_groups_wanted - len(all_tasks) // n_per
            if not all_tasks and st_ids:
                allowed = frozenset(int(x) for x in st_ids)
                part = _pick_random_full_groups(
                    base_plain, num_groups_wanted, allowed, False
                )
                if part:
                    all_tasks.extend(part)

            need_tasks = num_groups_wanted * n_per
            if len(all_tasks) >= need_tasks:
                return all_tasks, ids_for_group
            short_groups = num_groups_wanted - len(all_tasks) // n_per
            if short_groups > 0 and all_tasks:
                picked_tids = [t.id for t in all_tasks]
                excl_gids = set(
                    TaskGroupMember.objects.filter(task_id__in=picked_tids).values_list(
                        "task_group_id", flat=True
                    )
                )
                extra = _pick_random_full_groups(
                    base_plain, short_groups, None, False, excl_gids
                )
                if extra:
                    all_tasks.extend(extra)
            if len(all_tasks) >= need_tasks:
                return all_tasks, ids_for_group
            # Не набрали с подтемой — одна/несколько любых целых групп по номерам
            if not all_tasks:
                fallback = _pick_plain(num_groups_wanted)
                if fallback:
                    return fallback, ids_for_group
            return None, None

        all_tasks = _pick_plain(num_groups_wanted)
        if all_tasks is None:
            return None, None
        return all_tasks, ids_for_group

    linked_defs = list(
        LinkedTaskGroup.objects.filter(
            subject=subject_instance,
            level=level_instance,
        )
    )

    for tasklist in ordered_tasklists:
        tasklist_id = tasklist.id
        if tasklist_id in handled_tasklist_ids:
            continue
        count = content.get(str(tasklist_id), 0)
        if count <= 0:
            continue
        group_tasks, group_ids = None, None
        linked_for_slot = None
        for linked in linked_defs:
            nums = _parse_linked_task_numbers(linked.task_numbers)
            if nums is None:
                continue
            if nums and nums[0] == int(tasklist.task_number):
                linked_for_slot = linked
                group_tasks, group_ids = take_linked_groups(linked)
                break
        if linked_for_slot and group_tasks is None and group_ids is None:
            raise ValueError(
                "Для связанных заданий не удалось подобрать нужное число целых групп в базе "
                "(или при включённом «только ФИПИ» ни одна группа целиком не проходит фильтр). "
                "Добавьте группы в админке или ослабьте ограничения."
            )
        if group_tasks is not None and group_ids is not None:
            # Связанные группы уже отобраны (в т.ч. с учётом subtopic из group_subtopic_config)
            if only_fipi and fipi_q:
                task_numbers = []
                for linked in linked_defs:
                    nums = _parse_linked_task_numbers(linked.task_numbers)
                    if nums and nums[0] == int(tasklist.task_number):
                        task_numbers = nums
                        break
                n_per_group = len(task_numbers) if task_numbers else len(group_ids)
                fipi_ids = set(
                    Task.active_objects.filter(id__in=[t.id for t in group_tasks])
                    .filter(fipi_q)
                    .values_list("id", flat=True)
                )
                for i in range(0, len(group_tasks), n_per_group):
                    chunk = group_tasks[i : i + n_per_group]
                    if len(chunk) == n_per_group and all(t.id in fipi_ids for t in chunk):
                        selected_tasks.extend(chunk)
            else:
                selected_tasks.extend(group_tasks)
            handled_tasklist_ids.update(group_ids)
            continue
        # Одиночные задания: берём случайные задачи (с фильтром по подтемам при выборе)
        qs = Task.active_objects.filter(task_id=tasklist_id)
        if vpr_vf:
            qs = qs.filter(**vpr_vf)
        if only_fipi and fipi_q:
            qs = qs.filter(fipi_q)

        is_oge_inf_13 = (
            subject_instance.subject_short == "inf"
            and level_instance.level == "oge"
            and tasklist.task_number == 13
        )
        # Радио «текст / презентация»: только задачи выбранной подтемы (важнее глобальных subtopic_ids тренажёра)
        oge13_subtopic_locked = False
        if is_oge_inf_13 and oge_inf_13_subtopics:
            valid_oge13_ids = list(
                SubTopic.objects.filter(
                    task_list_id=tasklist_id,
                    id__in=oge_inf_13_subtopics,
                ).values_list("id", flat=True)
            )
            if valid_oge13_ids:
                qs = qs.filter(subtopic_id__in=valid_oge13_ids)
                oge13_subtopic_locked = True

        # Только подтемы, принадлежащие этому слоту (TaskList)
        slot_subtopic_ids = None
        if subtopic_ids:
            slot_subtopic_ids = list(
                SubTopic.objects.filter(
                    id__in=subtopic_ids, task_list_id=tasklist_id
                ).values_list("id", flat=True)
            )

        # Важно: при одновременной передаче subtopic_ids и subtopic_counts сначала
        # собираем задачи по счётчикам (точное кол-во на подтему). Иначе ветка
        # slot_subtopic_ids брала count случайных задач из объединения подтем и игнорировала counts.
        tasks_for_slot = None

        if oge13_subtopic_locked:
            tasks_for_slot = list(qs.order_by("?")[: int(count)])
        elif subtopic_counts:
            from random import shuffle
            count_ids = []
            for k in subtopic_counts:
                if str(k) in ("all", "null"):
                    continue
                try:
                    count_ids.append(int(k))
                except (TypeError, ValueError):
                    continue
            # Порядок подтем фиксирован (order в справочнике); внутри каждой подтемы — случайный выбор задач.
            # Между подтемами не перемешиваем: сначала все выбранные по первой подтеме, затем по второй и т.д.
            slot_subtopic_ids_for_counts = list(
                SubTopic.objects.filter(
                    id__in=count_ids,
                    task_list_id=tasklist_id,
                )
                .order_by("order", "title", "id")
                .values_list("id", flat=True)
            )
            pooled = []
            for sid in slot_subtopic_ids_for_counts:
                cnt = subtopic_counts.get(sid, subtopic_counts.get(str(sid), 0))
                cnt = int(cnt) if cnt else 0
                if cnt <= 0:
                    continue
                subset = list(
                    qs.filter(subtopic_id=sid).values_list("id", flat=True)
                )
                shuffle(subset)
                pooled.extend(subset[:cnt])
            if pooled:
                capped_ids = pooled[: int(count)]
                id_to_task = {
                    t.id: t
                    for t in Task.active_objects.filter(id__in=capped_ids)
                }
                tasks_for_slot = [
                    id_to_task[i] for i in capped_ids if i in id_to_task
                ]

        if tasks_for_slot is None:
            if slot_subtopic_ids:
                qf = qs.filter(subtopic_id__in=slot_subtopic_ids)
                tasks_for_slot = list(qf.order_by("?")[: int(count)])
            elif is_oge_inf_13 and not oge_inf_13_subtopics:
                st_ids_with_tasks = list(
                    qs.exclude(subtopic_id__isnull=True)
                    .values_list("subtopic_id", flat=True)
                    .distinct()
                )
                tasks_for_slot = []
                for sid in st_ids_with_tasks:
                    one = qs.filter(subtopic_id=sid).order_by("?").first()
                    if one:
                        tasks_for_slot.append(one)
                if not tasks_for_slot:
                    tasks_for_slot = list(qs.order_by("?")[: int(count)])
            else:
                tasks_for_slot = list(qs.order_by("?")[: int(count)])
        selected_tasks.extend(tasks_for_slot)

    if create:
        new_variant = Variant.objects.create(
            var_subject=subject_instance,
            level=level_instance,
            created_by=username_for_created_by(request),
            share_token=secrets.token_urlsafe(12),
            content=content or {},
        )
        VariantContent.objects.bulk_create([
            VariantContent(variant=new_variant, task=task, order=index)
            for index, task in enumerate(selected_tasks, start=1)
        ])
        return new_variant
    return selected_tasks


@ensure_csrf_cookie
def api_csrf(request):
    return JsonResponse({"detail": "CSRF cookie set"})


def admin_logout_to_public_home(request):
    """Выход из Django-админки с редиректом на публичную главную (itflux.ru), а не на / текущего хоста."""
    from django.contrib.auth import logout as auth_logout
    from django.http import HttpResponseRedirect

    auth_logout(request)
    url = getattr(django_settings, "ITFLUX_PUBLIC_HOME_URL", "https://itflux.ru/").strip()
    if not url.endswith("/"):
        url += "/"
    return HttpResponseRedirect(url)


LK_NAV_COOKIE_NAME = "lk_nav_gate"
LK_NAV_SIGNER_SALT = "lk_nav_gate_v1"


def _lk_nav_signer():
    return Signer(salt=LK_NAV_SIGNER_SALT)


def lk_nav_cookie_is_valid(request) -> bool:
    raw = (request.COOKIES.get(LK_NAV_COOKIE_NAME) or "").strip()
    if not raw:
        return False
    try:
        return _lk_nav_signer().unsign(raw) == "1"
    except BadSignature:
        return False


def lk_nav_password_configured() -> bool:
    return bool((getattr(django_settings, "LK_NAVIGATION_PASSWORD", "") or "").strip())


def lk_site_base_url() -> str:
    return getattr(django_settings, "LK_PUBLIC_URL", "http://lk.itflux.ru").rstrip("/")


def lk_user_nav_url() -> str:
    """Куда вести пользователя по кнопке «Личный кабинет» (дашборд при наличии LK_DASHBOARD_URL)."""
    dash = (getattr(django_settings, "LK_DASHBOARD_URL", "") or "").strip().rstrip("/")
    return dash or lk_site_base_url()


@require_http_methods(["GET"])
def api_site_config(request):
    """Публичные настройки для SPA: URL личного кабинета (не хардкодить в бандле VITE_)."""
    lk_base = lk_site_base_url()
    lk_nav = lk_user_nav_url()
    pwd_required = lk_nav_password_configured()
    return JsonResponse(
        {
            "lk_public_url": lk_base,
            "lk_nav_url": lk_nav,
            "lk_nav_password_required": pwd_required,
            "lk_nav_unlocked": (not pwd_required) or lk_nav_cookie_is_valid(request),
        }
    )


def _vpr_counts_filters_from_request(request):
    """Фильтры Task для подсчёта ВПР: применяем только если передан grade и/или advanced."""
    if not any(k in request.GET for k in ("grade", "advanced")):
        return {}
    flt = {}
    g = (request.GET.get("grade") or "").strip()
    if g.isdigit():
        flt["vpr_class"] = int(g)
    flt["vpr_advanced"] = (request.GET.get("advanced") or "").strip() == "1"
    return flt


def _subject_task_counts_by_level(request, level_str: str):
    """
    Счётчики активных заданий по предметам для уровня (vpr / oge / ege).
    Для ВПР: с query grade / advanced — как у api_tasks.
    """
    level_str = (level_str or "").lower()
    if level_str not in ("vpr", "oge", "ege"):
        return None

    level_instance = _level_instance_for_canonical_slug(level_str)
    if not level_instance:
        return JsonResponse({})

    shorts_by_level = {
        "vpr": ("math", "inf", "phys", "rus", "history"),
        "oge": ("math", "inf", "phys", "rus"),
        "ege": ("math", "inf"),
    }
    shorts = shorts_by_level[level_str]

    vf = {}
    if level_str == "vpr":
        vf = _vpr_counts_filters_from_request(request)

    out = {}
    for short in shorts:
        try:
            subject_instance = Subject.objects.get(subject_short__iexact=short)
        except Subject.DoesNotExist:
            out[short] = 0
            continue
        qs = Task.active_objects.filter(task__subject=subject_instance, task__level=level_instance)
        if vf:
            qs = qs.filter(**vf)
        out[short] = qs.count()

    return JsonResponse(out)


@require_http_methods(["GET"])
def api_vpr_subject_task_counts(request):
    """
    Число активных заданий ВПР по предметам (math, inf, phys, …) для карточек выбора.
    Без query — все активные задания уровня ВПР по предмету.
    С grade / advanced — те же ограничения, что у api_tasks для ВПР.
    """
    resp = _subject_task_counts_by_level(request, "vpr")
    return resp if resp is not None else JsonResponse({})


@require_http_methods(["GET"])
def api_level_subject_task_counts(request, level):
    """GET /api/<level>/subject-task-counts/ — счётчики по предметам для vpr, oge, ege."""
    resp = _subject_task_counts_by_level(request, level)
    if resp is None:
        return JsonResponse({"error": "unknown level"}, status=400)
    return resp


@csrf_exempt
@require_http_methods(["POST"])
def api_lk_nav_unlock(request):
    """Проверка пароля для перехода в ЛК; при успехе — подписанная cookie на несколько дней."""
    expected = (getattr(django_settings, "LK_NAVIGATION_PASSWORD", "") or "").strip()
    if not expected:
        return JsonResponse({"ok": True, "unlocked": True})
    try:
        data = json.loads(request.body or b"{}")
    except (json.JSONDecodeError, TypeError):
        return JsonResponse({"ok": False, "error": "invalid json"}, status=400)
    pwd = str((data or {}).get("password") or "")
    if pwd != expected:
        return JsonResponse({"ok": False, "error": "Неверный пароль"}, status=403)
    max_age = int(getattr(django_settings, "LK_NAV_COOKIE_MAX_AGE", 604800))
    response = JsonResponse({"ok": True, "unlocked": True})
    response.set_cookie(
        LK_NAV_COOKIE_NAME,
        _lk_nav_signer().sign("1"),
        max_age=max_age,
        httponly=True,
        samesite="Lax",
        secure=request.is_secure(),
        path="/",
    )
    return response


def api_tasks(request, level, subject):
    if _is_spa_lesson_join_path(level, subject):
        return JsonResponse({"subject_name": "", "tasks": []})
    subject_instance = get_subject_for_api(subject)
    level_instance = get_object_or_404(Level, level=level)
    vpr_vf = _vpr_task_filters_from_request(request, level)

    subtopic_ids = None
    if request.GET.get("subtopic_ids"):
        raw = request.GET.get("subtopic_ids", "").strip().split(",")
        subtopic_ids = [int(x) for x in raw if x.strip().isdigit()]
        if not subtopic_ids:
            subtopic_ids = None

    count_task_filter = Q(task__is_active=True)
    if vpr_vf:
        for _vk, _vv in vpr_vf.items():
            count_task_filter &= Q(**{f"task__{_vk}": _vv})
    tasks_qs = list(
        TaskList.objects.filter(
            subject=subject_instance,
            level=level_instance,
        )
        .annotate(count_task=Count("task", filter=count_task_filter))
        .order_by('task_number')
    )
    if subtopic_ids:
        _tq = Task.active_objects.filter(
            task__subject=subject_instance,
            task__level=level_instance,
            subtopic_id__in=subtopic_ids,
        )
        if vpr_vf:
            _tq = _tq.filter(**vpr_vf)
        id_to_count = dict(
            _tq.values("task_id")
            .annotate(c=Count("id"))
            .values_list("task_id", "c")
        )
        for t in tasks_qs:
            t.count_task = id_to_count.get(t.id, 0)
    id_by_number = {tl.task_number: tl.id for tl in tasks_qs}
    tl_by_id = {tl.id: tl for tl in tasks_qs}

    linked_defs = list(
        LinkedTaskGroup.objects.filter(
            subject=subject_instance,
            level=level_instance,
        )
    )

    # Collect all task_numbers from linked groups to batch-count in one query
    linked_number_sets = []
    for linked in linked_defs:
        task_numbers = _parse_linked_task_numbers(linked.task_numbers)
        if task_numbers is None or not task_numbers:
            continue
        ids_for_group = [_tasklist_id_for_number(id_by_number, n) for n in task_numbers]
        if any(i is None for i in ids_for_group):
            continue
        linked_number_sets.append((linked, task_numbers, ids_for_group))

    # Batch count available groups for all linked defs in one query per unique set
    linked_counts = {}
    for linked, task_numbers, ids_for_group in linked_number_sets:
        key = tuple(task_numbers)
        if key not in linked_counts:
            linked_counts[key] = len(
                _taskgroup_ids_matching_task_numbers(
                    subject_instance,
                    level_instance,
                    task_numbers,
                    vpr_vf,
                )
            )

    linked_tasklist_ids = set()
    linked_group_items = []

    for linked, task_numbers, ids_for_group in linked_number_sets:
        key = tuple(task_numbers)
        groups_count = linked_counts.get(key, 0)
        subtopics = _subtopics_for_groups(subject_instance, level_instance, task_numbers, vpr_vf)
        # Показываем linked_group, если есть группы ИЛИ подтемы с задачами (display_count > 0)
        has_subtopics_with_tasks = any((s.get("display_count") or 0) > 0 for s in subtopics)
        if groups_count == 0 and not has_subtopics_with_tasks:
            continue
        linked_tasklist_ids.update(ids_for_group)
        # Reuse already-loaded tasklist data instead of a new DB query
        tasklists = sorted(
            [tl_by_id[i] for i in ids_for_group if i in tl_by_id],
            key=lambda tl: tl.task_number,
        )
        linked_group_items.append({
            "type": "linked_group",
            "linked_key": "_".join(str(n) for n in task_numbers),
            "task_numbers": task_numbers,
            "tasks": [
                {
                    "tasklist_id": tl.id,
                    "task_number": tl.task_number,
                    "task_title": tl.task_title,
                    "part": tl.part_id,
                }
                for tl in tasklists
            ],
            "count_available": groups_count,
            "subtopics": subtopics,
        })

    groups = TaskGroup.objects.filter(
        subject=subject_instance,
        level=level_instance,
    )
    _gm_extra = {}
    if vpr_vf:
        for _gk, _gv in vpr_vf.items():
            _gm_extra[f"task__{_gk}"] = _gv
    group_members = TaskGroupMember.objects.filter(
        task_group__in=groups,
        task__is_active=True,
        **_gm_extra,
    ).select_related("task_group", "task", "task__task")

    group_dict = {}
    grouped_tasklist_ids = set(linked_tasklist_ids)

    group_tasklist_ids = [m.task.task_id for m in group_members if m.task.task_id]
    _tcl_f = Q(task__is_active=True)
    if vpr_vf:
        for _ck, _cv in vpr_vf.items():
            _tcl_f &= Q(**{f"task__{_ck}": _cv})
    tasklist_counts = dict(
        TaskList.objects.filter(id__in=group_tasklist_ids)
        .annotate(count_task=Count("task", filter=_tcl_f))
        .values_list("id", "count_task")
    ) if group_tasklist_ids else {}

    for member in group_members:
        group_id = member.task_group_id
        tl_id = member.task.task_id
        if tl_id and tl_id in linked_tasklist_ids:
            continue
        if group_id not in group_dict:
            group_dict[group_id] = {
                "type": "group",
                "group_id": group_id,
                "tasks": [],
            }
        tl = member.task.task
        group_dict[group_id]["tasks"].append({
            "id": member.task.id,
            "tasklist_id": tl_id,
            "task_number": member.task_number,
            "task_title": tl.task_title if tl else "",
            "part": tl.part_id if tl else None,
            "count_task": tasklist_counts.get(tl_id, 0),
        })
        if tl_id:
            grouped_tasklist_ids.add(tl_id)

    # Добавляем подтемы для каждой группы
    for group_id, gd in group_dict.items():
        task_nums = sorted({t["task_number"] for t in gd["tasks"]})
        gd["subtopics"] = _subtopics_for_groups(subject_instance, level_instance, task_nums, vpr_vf)
        gd["task_numbers"] = task_nums

    result = []
    for t in tasks_qs:
        if t.id in grouped_tasklist_ids:
            continue
        if subtopic_ids and (t.count_task or 0) <= 0:
            continue
        result.append({
            "type": "single",
            "id": t.id,
            "task_number": t.task_number,
            "task_title": t.task_title,
            "part": t.part_id,
            "count_task": t.count_task,
        })

    linked_task_number_sets = {frozenset(item["task_numbers"]) for item in linked_group_items}
    for gd in group_dict.values():
        gd_nums = frozenset(gd.get("task_numbers") or [])
        if gd_nums not in linked_task_number_sets:
            result.append(gd)
    # Дедупликация linked_group по task_numbers (на случай дублей в БД или разных TaskList для одних номеров)
    seen_task_nums = set()
    deduped_linked = []
    for item in linked_group_items:
        key = frozenset(item.get("task_numbers") or [])
        if key in seen_task_nums:
            continue
        seen_task_nums.add(key)
        deduped_linked.append(item)
    result.extend(deduped_linked)

    # Fallback: задания, попавшие в grouped_tasklist_ids, но не отображающиеся ни в одной группе
    # (напр. LinkedTaskGroup без групп/подтем — скипнули, а TaskGroup с тем же номером не добавили)
    shown_task_numbers = set()
    for item in result:
        if item.get("type") == "single":
            shown_task_numbers.add(item.get("task_number"))
        else:
            for t in item.get("tasks") or []:
                shown_task_numbers.add(t.get("task_number"))
    for t in tasks_qs:
        if t.id in grouped_tasklist_ids and t.task_number not in shown_task_numbers:
            result.append({
                "type": "single",
                "id": t.id,
                "task_number": t.task_number,
                "task_title": t.task_title,
                "part": t.part_id,
                "count_task": t.count_task,
            })

    def sort_key(item):
        if item["type"] == "single":
            return item["task_number"]
        if item["type"] == "linked_group":
            return min(item["task_numbers"])
        return min(task["task_number"] for task in item["tasks"])

    result = sorted(result, key=sort_key)

    resp = {
        "subject_name": subject_instance.subject_name,
        "tasks": result
    }
    # Диагностика: при ?debug=1 показывать, почему linked_group может не отображаться
    if request.GET.get("debug") == "1":
        debug_linked = []
        for linked in LinkedTaskGroup.objects.filter(
            subject=subject_instance, level=level_instance
        ):
            tn = linked.task_numbers or []
            parsed = _parse_linked_task_numbers(tn)
            ids_for = (
                [_tasklist_id_for_number(id_by_number, n) for n in parsed]
                if parsed is not None
                else []
            )
            missing = (
                [n for n, i in zip(parsed, ids_for) if i is None]
                if parsed is not None
                else list(tn)
            )
            key = tuple(parsed) if parsed is not None and parsed else ()
            cnt = linked_counts.get(key, 0)
            debug_linked.append({
                "task_numbers_in_db": tn,
                "missing_in_tasklist": missing if missing else None,
                "groups_count": cnt,
                "skipped_reason": (
                    "empty_task_numbers" if not tn else
                    "invalid_task_numbers" if parsed is None else
                    "tasklist_missing" if missing else
                    "no_groups" if cnt == 0 else None
                ),
            })
        resp["_debug_linked"] = debug_linked
    return JsonResponse(resp)


def api_subtopics(request, level, subject):
    """GET: список подтем по номерам заданий и связанным группам для тренажёра."""
    if _is_spa_lesson_join_path(level, subject):
        return JsonResponse({"subtopics_by_task": []})
    subject_instance = get_subject_for_api(subject)
    level_instance = get_object_or_404(Level, level=level)
    vpr_vf = _vpr_task_filters_from_request(request, level)

    # --- Одиночные задания (старая логика) ---
    task_lists = (
        TaskList.objects.filter(
            subject=subject_instance,
            level=level_instance,
        )
        .filter(subtopics__isnull=False)
        .distinct()
        .order_by("task_number")
    )
 
    fipi_q = _get_fipi_q()
    out = []
 
    for tl in task_lists:
        subtopics = list(
            SubTopic.objects.filter(task_list=tl).order_by("order", "title").values("id", "title", "order")
        )
        if not subtopics:
            continue
        for st in subtopics:
            title = st["title"]
            base_qs = Task.active_objects.filter(task_id=tl.id, subtopic__title=title)
            if vpr_vf:
                base_qs = base_qs.filter(**vpr_vf)
            st["task_count"] = base_qs.count()
            st["fipi_task_count"] = base_qs.filter(fipi_q).count()
        out.append({
            "task_list_id": tl.id,
            "task_number": tl.task_number,
            "task_title": tl.task_title,
            "subtopics": subtopics,
        })

    return JsonResponse({
        "subtopics_by_task": out,
    })

@csrf_exempt
@require_http_methods(["POST"])
def api_generate_variant(request, level, subject):
    try:
        new_variant = _create_variant(subject, level, request.body, request=request)
        return JsonResponse({'variant_id': new_variant.id})
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=400)


# ── LK Variant Builder endpoints ──────────────────────────────────────────────

@require_http_methods(["GET"])
def api_catalog(request):
    """GET /api/catalog/ — subjects grouped by level, for the LK variant picker."""
    result = []
    for level in Level.objects.all().order_by('level'):
        subjects = (
            Subject.objects
            .filter(tasklist__level=level)
            .distinct()
            .order_by('subject_name')
            .values('subject_short', 'subject_name')
        )
        subj_list = list(subjects)
        if subj_list:
            result.append({
                'level': level.level,
                'level_rus': level.level_rus,
                'subjects': subj_list,
            })
    return JsonResponse({'catalog': result})


def _normalize_level_slug(value):
    """Привести значение Level.level к каноническому slug vpr | oge | ege."""
    if value is None:
        return None
    s = str(value).strip().lower()
    cyr = {
        "впр": "vpr",
        "огэ": "oge",
        "егэ": "ege",
        "ёгэ": "ege",
    }
    return cyr.get(s, s)


def _level_instance_for_canonical_slug(canonical: str):
    """Найти запись Level по латинскому slug из URL (vpr/oge/ege), если в БД level хранится по-русски или иначе."""
    if canonical not in ("vpr", "oge", "ege"):
        return None
    for lev in Level.objects.all():
        if _normalize_level_slug(lev.level) == canonical:
            return lev
    return None


@require_http_methods(["GET"])
def api_platform_stats(request):
    """GET /api/platform-stats/ — агрегаты для главной: всего заданий, предметов с заданиями, суммы по уровням."""
    total_tasks = Task.active_objects.count()
    subjects_count = (
        Task.active_objects.filter(task__subject_id__isnull=False)
        .values("task__subject_id")
        .distinct()
        .count()
    )

    tasks_by_level = {}
    for level_str in ("vpr", "oge", "ege"):
        li = _level_instance_for_canonical_slug(level_str)
        tasks_by_level[level_str] = (
            int(Task.active_objects.filter(task__level=li).count()) if li else 0
        )
    return JsonResponse(
        {
            "total_tasks": int(total_tasks),
            "subjects_count": int(subjects_count),
            "tasks_by_level": tasks_by_level,
        }
    )


@require_http_methods(["GET"])
def api_task_bank_filters(request, level, subject):
    """GET /api/<level>/<subject>/task-bank-filters/ — номера заданий и подтемы для фильтра банка."""
    subject_instance = get_subject_for_api(subject)
    level_instance = get_object_or_404(Level, level=level)
    vpr_vf = _vpr_task_filters_from_request(request, level)

    task_list_qs = TaskList.objects.filter(
        subject=subject_instance,
        level=level_instance,
    ).order_by("task_number")

    task_list_id = (request.GET.get("task_list_id") or "").strip()
    tl_id_filter = int(task_list_id) if task_list_id.isdigit() else None

    task_numbers = []
    for tl in task_list_qs:
        task_count = Task.active_objects.filter(task_id=tl.id, **(vpr_vf or {})).count()
        task_numbers.append({
            "task_list_id": tl.id,
            "task_number": tl.task_number,
            "task_title": tl.task_title or "",
            "task_count": task_count,
        })

    subtopics = []
    subtopic_tl_qs = (
        task_list_qs.filter(id=tl_id_filter) if tl_id_filter is not None else task_list_qs
    )
    for tl in subtopic_tl_qs:
        for st in SubTopic.objects.filter(task_list=tl).order_by("order", "title"):
            st_qs = Task.active_objects.filter(task_id=tl.id, subtopic_id=st.id)
            if vpr_vf:
                st_qs = st_qs.filter(**vpr_vf)
            subtopics.append({
                "id": st.id,
                "title": st.title,
                "task_list_id": tl.id,
                "task_number": tl.task_number,
                "task_count": st_qs.count(),
            })

    return JsonResponse({
        "task_numbers": task_numbers,
        "subtopics": subtopics,
    })


@require_http_methods(["GET"])
def api_task_bank(request, level, subject):
    """GET /api/<level>/<subject>/task-bank/
    Individual tasks from the bank for the LK manual variant builder.
    Query params: task_list_id, subtopic_id, only_fipi (1), raw_html (1), grade/advanced (ВПР),
    page (default 1), per_page (default 12, max 50).
    """
    subject_instance = get_subject_for_api(subject)
    level_instance = get_object_or_404(Level, level=level)

    qs = Task.active_objects.filter(
        task__subject=subject_instance,
        task__level=level_instance,
    ).select_related('task', 'task__part', 'subtopic')

    vpr_vf = _vpr_task_filters_from_request(request, level)
    if vpr_vf:
        qs = qs.filter(**vpr_vf)

    if (request.GET.get("only_fipi") or "").strip() in ("1", "true", "yes"):
        qs = qs.filter(_get_fipi_task_filter_q())

    task_list_id = request.GET.get('task_list_id')
    if task_list_id:
        try:
            qs = qs.filter(task_id=int(task_list_id))
        except (TypeError, ValueError):
            pass

    subtopic_id = request.GET.get('subtopic_id')
    no_answer_only = False
    if subtopic_id:
        if subtopic_id.strip().lower() == "none":
            qs = qs.filter(subtopic_id__isnull=True)
        elif subtopic_id.strip().lower() == "no-answer":
            no_answer_only = True
        else:
            try:
                qs = qs.filter(subtopic_id=int(subtopic_id))
            except (TypeError, ValueError):
                pass

    if no_answer_only:
        qs = qs.filter(Q(answer__isnull=True) | Q(answer__exact=''))

    raw_html = (request.GET.get("raw_html") or "").strip().lower() in ("1", "true", "yes")

    try:
        page = max(1, int(request.GET.get('page', 1)))
        per_page = min(10000, max(1, int(request.GET.get('per_page', 12))))
    except (TypeError, ValueError):
        page, per_page = 1, 12

    total = qs.count()
    offset = (page - 1) * per_page
    tasks_qs = qs.order_by('task__task_number', 'id')[offset:offset + per_page]

    result = []
    for task in tasks_qs:
        tl = task.task

        file_url = None
        if getattr(task, 'files', None):
            f = task.files
            try:
                url = f.url
                if url:
                    file_url = request.build_absolute_uri(url)
            except Exception:
                pass
            if not file_url and getattr(f, 'name', ''):
                media_url = getattr(django_settings, 'MEDIA_URL', '/media/') or '/media/'
                rel = (media_url.rstrip('/') + '/' + f.name.lstrip('/')).replace('//', '/')
                file_url = request.build_absolute_uri(rel)

        keep_tables = bool(tl and tl.part_id == 2)
        task_text_raw = str(task.task_template or '')
        try:
            from fipi_bare_innerimg_repair import repair_bare_fipi_innerimg_html
            from import_tasks_universal import download as fipi_media_download

            task_text_raw = repair_bare_fipi_innerimg_html(
                task_text_raw,
                task_db_id=task.id,
                task_list_id=task.task_id,
                subtopic_id=task.subtopic_id,
                download=fipi_media_download,
            )
        except Exception:
            logging.getLogger(__name__).debug(
                "bare innerimg repair skipped for task %s", task.id, exc_info=True
            )

        result.append({
            'id': task.id,
            'task_list_id': task.task_id,
            'task_number': tl.task_number if tl else None,
            'task_title': tl.task_title if tl else '',
            'subtopic': task.subtopic.title if task.subtopic else None,
            'max_score': tl.max_score if tl else 1,
            'part_id': tl.part_id if tl else None,
            'part_title': (tl.part.part_title if tl and tl.part else None),
            'text': (
                task_text_raw
                if raw_html
                else process_latex(
                    task_text_raw,
                    for_browser=True,
                    keep_layout_tables=keep_tables,
                )
            ),
            'answer': str(task.answer or ''),
            'file_url': file_url,
            'author': (task.author or '').strip() or None,
            'added_at': task.added_at.strftime('%d.%m.%Y') if task.added_at else None,
        })

    return JsonResponse({
        'total': total,
        'page': page,
        'per_page': per_page,
        'tasks': result,
    })


@csrf_exempt
@require_http_methods(["POST"])
def api_variant_from_ids(request, level, subject):
    """POST /api/<level>/<subject>/variant-from-ids/
    Body: {"task_ids": [1, 5, 12, ...]}  — ordered list of Task.id
    Creates a Variant with VariantContent in that exact order.
    Returns: {"variant_id": 123}
    """
    try:
        data = json.loads(request.body)
    except (json.JSONDecodeError, TypeError):
        logger.warning("api_variant_from_ids: Invalid JSON")
        return JsonResponse({'error': 'Invalid JSON'}, status=400)

    task_ids = data.get('task_ids') or []
    if not task_ids:
        logger.warning("api_variant_from_ids: task_ids is required and must be non-empty")
        return JsonResponse({'error': 'task_ids is required and must be non-empty'}, status=400)

    subject_instance = get_subject_for_api(subject)
    level_instance = get_object_or_404(Level, level=level)

    # Verify tasks exist and belong to this subject+level
    task_map = {
        t.id: t
        for t in Task.active_objects.filter(
            id__in=[int(tid) for tid in task_ids],
            task__subject=subject_instance,
            task__level=level_instance,
        )
    }

    variant = Variant.objects.create(
        var_subject=subject_instance,
        level=level_instance,
        created_by='lk_teacher',
    )

    vc_objects = []
    for order, tid in enumerate(task_ids, start=1):
        task = task_map.get(int(tid))
        if task:
            vc_objects.append(VariantContent(variant=variant, task=task, order=order))

    if not vc_objects:
        variant.delete()
        logger.warning(f"api_variant_from_ids: No valid tasks found for this subject/level. task_ids={task_ids}, task_map={task_map}")
        return JsonResponse({'error': 'No valid tasks found for this subject/level'}, status=400)

    VariantContent.objects.bulk_create(vc_objects)
    return JsonResponse({'variant_id': variant.id})


# ── TaskListView (DRF) ────────────────────────────────────────────────────────

class TaskListView(APIView):
    """GET /api/tasks/?subject=math&level=oge&task=5&subtopic=12&page=1&per_page=20
    Список заданий из банка — фильтрация по query-параметрам.
    Используется кабинетом-прокси (X-Tasks-Get-Secret).
    """

    def get(self, request):
        subject_param = (request.GET.get('subject') or '').strip()
        level_param   = (request.GET.get('level')   or '').strip()
        task_param    = (request.GET.get('task')     or '').strip()
        subtopic_param = (request.GET.get('subtopic') or '').strip()

        qs = Task.active_objects.select_related('task', 'subtopic')

        if subject_param:
            subj = Subject.objects.filter(subject_short__iexact=subject_param).first()
            if subj:
                qs = qs.filter(task__subject=subj)
            else:
                return DRFResponse({'total': 0, 'page': 1, 'per_page': 20, 'tasks': []})

        if level_param:
            lvl = Level.objects.filter(level__iexact=level_param).first()
            if lvl:
                qs = qs.filter(task__level=lvl)

        if task_param:
            try:
                qs = qs.filter(task__task_number=int(task_param))
            except (TypeError, ValueError):
                pass

        if subtopic_param:
            try:
                qs = qs.filter(subtopic_id=int(subtopic_param))
            except (TypeError, ValueError):
                qs = qs.filter(subtopic__title__icontains=subtopic_param)

        try:
            page     = max(1, int(request.GET.get('page', 1)))
            per_page = min(100, max(1, int(request.GET.get('per_page', 20))))
        except (TypeError, ValueError):
            page, per_page = 1, 20

        total  = qs.count()
        offset = (page - 1) * per_page
        items  = qs.order_by('id')[offset:offset + per_page]

        result = []
        for t in items:
            result.append({
                'id':           t.id,
                'task_list_id': t.task_id,
                'task_number':  t.task.task_number if t.task else None,
                'task_title':   t.task.task_title  if t.task else '',
                'subtopic':     t.subtopic.title   if t.subtopic else None,
                'subtopic_id':  t.subtopic_id,
                'text':         process_latex(str(t.task_template or ''), for_browser=True),
                'answer':       str(t.answer or ''),
                'max_score':    t.max_score,
                'added_at':     t.added_at.strftime('%d.%m.%Y') if t.added_at else None,
            })

        return DRFResponse({
            'total':    total,
            'page':     page,
            'per_page': per_page,
            'tasks':    result,
        })


# ── end LK Variant Builder ────────────────────────────────────────────────────


def _bank_task_file_url(request, task):
    """Абсолютный URL вложения задачи (как в api_task_bank)."""
    if not getattr(task, 'files', None):
        return None
    f = task.files
    try:
        url = f.url
        if url:
            return request.build_absolute_uri(url)
    except Exception:
        pass
    if getattr(f, 'name', ''):
        media_url = getattr(django_settings, 'MEDIA_URL', '/media/') or '/media/'
        rel = (media_url.rstrip('/') + '/' + f.name.lstrip('/')).replace('//', '/')
        return request.build_absolute_uri(rel)
    return None


def _task_matches_bank_filters(task, vpr_vf=None, only_fipi=False):
    if not task or not getattr(task, 'is_active', True):
        return False
    if vpr_vf:
        for key, val in vpr_vf.items():
            if getattr(task, key, None) != val:
                return False
    if only_fipi and not Task.objects.filter(pk=task.pk).filter(_get_fipi_task_filter_q()).exists():
        return False
    return True


def _serialize_bank_group_member(request, member, *, raw_html=False):
    t = member.task
    tl = t.task if t else None
    part = tl.part if tl else None
    keep_tables = bool(tl and tl.part_id == 2)
    task_text_raw = str(t.task_template or '') if t else ''
    if t:
        try:
            from fipi_bare_innerimg_repair import repair_bare_fipi_innerimg_html
            from import_tasks_universal import download as fipi_media_download

            task_text_raw = repair_bare_fipi_innerimg_html(
                task_text_raw,
                task_db_id=t.id,
                task_list_id=t.task_id,
                subtopic_id=t.subtopic_id,
                download=fipi_media_download,
            )
        except Exception:
            logging.getLogger(__name__).debug(
                "bare innerimg repair skipped for task %s", t.id, exc_info=True
            )
    return {
        'id': t.id if t else None,
        'task_list_id': tl.id if tl else None,
        'task_number': member.task_number,
        'task_title': tl.task_title if tl else '',
        'subtopic': t.subtopic.title if t and t.subtopic else None,
        'max_score': tl.max_score if tl else 1,
        'part_id': tl.part_id if tl else None,
        'part_title': (part.part_title if part else None),
        'text': (
            task_text_raw
            if raw_html
            else process_latex(
                task_text_raw,
                for_browser=True,
                keep_layout_tables=keep_tables,
            )
        ) if t else '',
        'answer': str(t.answer or '') if t else '',
        'file_url': _bank_task_file_url(request, t) if t else None,
        'author': (t.author or '').strip() or None if t else None,
        'added_at': t.added_at.strftime('%d.%m.%Y') if t and t.added_at else None,
    }


@require_http_methods(["GET"])
def api_group_instances(request, level, subject):
    """GET /api/<level>/<subject>/group-instances/
    Полные экземпляры TaskGroup с текстом каждого задания.
    Params:
      group_id    — вернуть один конкретный TaskGroup по ID (type=group)
      linked_key  — вернуть все TaskGroup, соответствующие набору номеров заданий
                    (строка вида "19_20_21"; type=linked_group)
      subtopic_id — опциональная фильтрация по подтеме TaskGroup.subtopic (none — без подтемы)
      only_fipi   — 1: только группы, где все задания из ФИПИ
      page        — страница (default 1)
      per_page    — размер (default 20, max 10000)
    """
    subject_instance = get_subject_for_api(subject)
    level_instance   = get_object_or_404(Level, level=level)
    vpr_vf = _vpr_task_filters_from_request(request, level)
    only_fipi = (request.GET.get("only_fipi") or "").strip() in ("1", "true", "yes")
    raw_html = (request.GET.get("raw_html") or "").strip().lower() in ("1", "true", "yes")

    member_qs = (
        TaskGroupMember.objects
        .select_related('task', 'task__task', 'task__task__part', 'task__subtopic')
        .filter(task__is_active=True)
        .order_by('task_number')
    )
    if vpr_vf:
        for _vk, _vv in vpr_vf.items():
            member_qs = member_qs.filter(**{f'task__{_vk}': _vv})

    qs = (
        TaskGroup.objects
        .filter(subject=subject_instance, level=level_instance)
        .exclude(taskgroupmember__task__is_active=False)
        .prefetch_related(Prefetch('taskgroupmember_set', queryset=member_qs))
    )

    group_id_param   = request.GET.get('group_id', '').strip()
    linked_key_param = request.GET.get('linked_key', '').strip()
    subtopic_id_param = request.GET.get('subtopic_id', '').strip()
    no_answer_only = False
    expected_task_numbers = None

    if group_id_param:
        try:
            qs = qs.filter(id=int(group_id_param))
        except (TypeError, ValueError):
            return JsonResponse({'total': 0, 'instances': []})

    elif linked_key_param:
        try:
            task_numbers = [int(n) for n in linked_key_param.split('_') if n.strip().isdigit()]
        except (ValueError, TypeError):
            return JsonResponse({'total': 0, 'instances': []})
        if not task_numbers:
            return JsonResponse({'total': 0, 'instances': []})
        expected_task_numbers = task_numbers
        # Группы, у которых есть ровно все нужные task_number
        qs = (
            qs
            .filter(taskgroupmember__task_number__in=task_numbers)
            .annotate(mcnt=Count('taskgroupmember', distinct=True))
            .filter(mcnt=len(task_numbers))
            .distinct()
        )

    if subtopic_id_param:
        if subtopic_id_param.strip().lower() == "none":
            qs = qs.filter(subtopic_id__isnull=True)
        elif subtopic_id_param.strip().lower() == "no-answer":
            no_answer_only = True
        else:
            try:
                qs = qs.filter(subtopic_id=int(subtopic_id_param))
            except (TypeError, ValueError):
                pass

    try:
        page     = max(1, int(request.GET.get('page', 1)))
        per_page = min(10000, max(1, int(request.GET.get('per_page', 20))))
    except (TypeError, ValueError):
        page, per_page = 1, 20

    instances = []
    for grp in qs.order_by('id'):
        members = list(grp.taskgroupmember_set.all())
        if no_answer_only and any(str(m.task.answer or '').strip() for m in members):
            continue
        if expected_task_numbers is not None:
            member_nums = {m.task_number for m in members}
            if not all(n in member_nums for n in expected_task_numbers):
                continue
        if only_fipi:
            raw_members = TaskGroupMember.objects.filter(
                task_group_id=grp.id,
                task__is_active=True,
            ).select_related('task')
            if any(not _task_matches_bank_filters(m.task, vpr_vf=vpr_vf, only_fipi=True) for m in raw_members):
                continue
        task_items = [
            _serialize_bank_group_member(request, m, raw_html=raw_html)
            for m in members
            if _task_matches_bank_filters(m.task, vpr_vf=vpr_vf, only_fipi=False)
        ]
        if expected_task_numbers is not None and len(task_items) != len(expected_task_numbers):
            continue
        if not task_items:
            continue
        instances.append({
            'group_id': grp.id,
            'subtopic_id': grp.subtopic_id,
            'tasks': task_items,
        })

    total = len(instances)
    offset = (page - 1) * per_page
    page_instances = instances[offset:offset + per_page]

    return JsonResponse({
        'total': total,
        'page': page,
        'per_page': per_page,
        'instances': page_instances,
    })

def api_variant_lookup(request, variant_id):
    variant = get_object_or_404(Variant.objects.select_related('level', 'var_subject'), id=variant_id)
    return JsonResponse({
        "level": variant.level.level,
        "subject": variant.var_subject.subject_short,
    })


@require_http_methods(["GET"])
def api_criteria(request, level, subject):
    """Критерии по task_list_id или по (subject, level, task_number). Criteria привязаны к TaskList (номер задания)."""
    subject_instance = get_subject_for_api(subject)
    level_instance = get_object_or_404(Level, level=level)

    tl_ids = []
    task_list_id = request.GET.get("task_list_id")
    task_number_param = request.GET.get("task_number")

    if task_list_id:
        try:
            tl_ids.append(int(task_list_id))
        except (TypeError, ValueError):
            pass
    if task_number_param is not None:
        try:
            tn = int(task_number_param)
            ids_by_num = list(
                TaskList.objects.filter(
                    subject=subject_instance,
                    level=level_instance,
                    task_number=tn,
                ).values_list("id", flat=True)
            )
            tl_ids = list(dict.fromkeys(tl_ids + ids_by_num))
        except (TypeError, ValueError):
            pass

    if not tl_ids:
        return JsonResponse({"criteria": []})

    criteria_list = list(
        Criteria.objects.filter(task_number_id__in=tl_ids)
        .order_by("-criteria_score", "id")
        .values("id", "criteria_text", "criteria_score")
    )
    for c in criteria_list:
        c["criteria_text"] = process_latex(str(c.get("criteria_text") or ""), for_browser=True)

    max_score = TaskList.objects.filter(id__in=tl_ids).order_by("-max_score").values_list("max_score", flat=True).first()
    max_score = max_score if max_score is not None else 1

    return JsonResponse({"criteria": criteria_list, "max_score": max_score})


def _variant_detail_payload(request, variant):
    """Единая сборка JSON варианта для API (по id)."""
    contents = (
        VariantContent.objects
        .filter(variant=variant)
        .select_related("task", "task__task", "task__subtopic")
        .order_by("order")
    )

    tasks_data = []
    for item in contents:
        task_list = item.task.task
        file_url = None
        if item.task.files:
            f = item.task.files
            try:
                url = f.url
                if url:
                    file_url = request.build_absolute_uri(url)
            except Exception:
                pass
            if not file_url and f.name:
                media_url = getattr(django_settings, "MEDIA_URL", "/media/") or "/media/"
                rel = (media_url.rstrip("/") + "/" + f.name.lstrip("/")).replace("//", "/")
                file_url = request.build_absolute_uri(rel)

        if task_list:
            max_score = getattr(task_list, "max_score", 1)
        else:
            max_score = getattr(item.task, "max_score", None)
            if max_score is None:
                max_score = 1

        st = getattr(item.task, "subtopic", None)
        tasks_data.append({
            "id": item.task.id,
            "task_list_id": task_list.id if task_list else None,
            "number": task_list.task_number if task_list else item.order,
            "task_title": task_list.task_title if task_list else "",
            "text": process_latex(str(item.task.task_template or ""), for_browser=True),
            "answer": process_latex(str(item.task.answer or ""), for_browser=True),
            "part": task_list.part_id if task_list else None,
            "subdivision": (task_list.subdivision or "").strip() or None,
            "subtopic_id": st.id if st else None,
            "subtopic_title": (st.title or "").strip() if st else "",
            "file": file_url,
            "author": (item.task.author or "").strip() or None,
            "max_score": max_score,
            "truth_table_enabled": item.task.truth_table_enabled,
            "vpr_class": item.task.vpr_class,
            "vpr_advanced": bool(item.task.vpr_advanced),
        })

    return {
        "id": variant.id,
        "level": variant.level.level,
        "subject": variant.var_subject.subject_short,
        "tasks": tasks_data,
    }


def api_variant_detail(request, level, subject, variant_id):
    variant = get_object_or_404(Variant.objects.select_related('level', 'var_subject'), id=variant_id)
    url_level = (level or "").strip().lower()
    url_subject = (subject or "").strip().lower()
    if (variant.level.level or "").strip().lower() != url_level:
        raise Http404()
    if (variant.var_subject.subject_short or "").strip().lower() != url_subject:
        raise Http404()
    return JsonResponse(_variant_detail_payload(request, variant))


@require_http_methods(["GET"])
def api_lesson_variant_detail(request, variant_id):
    """Вариант для урока: всегда по /api, без зависимости от роутинга SPA."""
    variant = get_object_or_404(Variant.objects.select_related("level", "var_subject"), id=variant_id)
    return JsonResponse(_variant_detail_payload(request, variant))


@require_http_methods(["GET"])
def variant_detail_short_url(request, level, subject, variant_id):
    """
    Короткий URL варианта без /api.

    В браузере должен открываться обычный интерфейс варианта (SPA),
    а JSON оставляем только для явного запроса интеграций.
    """
    # Редирект в /lesson/join/ только для старых ссылок ЛК вида
    # /level/subject/variant/N/?token=<jwt> (открыть комнату вместо варианта в окне браузера).
    # Встроенный вариант в iframe комнаты передаёт lesson_embed=1 и lesson_token=…;
    # иногда в URL дублируется legacy ?token= из lesson_variant_url — тогда редирект ломает iframe.
    token_q = (request.GET.get("token") or "").strip()
    lesson_embed = str(request.GET.get("lesson_embed") or "").strip().lower() in ("1", "true", "yes")
    iframe_lesson_token = (request.GET.get("lesson_token") or "").strip()
    if token_q and not lesson_embed and not iframe_lesson_token:
        try:
            verify_lesson_token(token_q)
        except ValueError:
            # Невалидный/чужой token не должен ломать обычное открытие варианта.
            pass
        else:
            q = request.META.get("QUERY_STRING", "").strip()
            target = "/lesson/join/" + ("?" + q if q else "")
            return HttpResponseRedirect(target)

    wants_json = (
        request.GET.get("format") == "json"
        or request.GET.get("raw") == "1"
        or "application/json" in request.headers.get("Accept", "")
    )
    if wants_json:
        return api_variant_detail(request, level, subject, variant_id)
    return react_app(request)


@require_http_methods(["GET"])
def api_score_conversion(request, level, subject):
    """Конвертация первичных баллов в вторичные по таблице Mark. Работает для всех предметов (subject_short в Mark)."""
    score = request.GET.get("score", "0")
    try:
        total = int(score)
    except ValueError:
        total = 0
    level_norm = (level or "").strip().lower()
    subject_norm = (subject or "").strip().lower()
    # Строки Mark по предмету и уровню (точный уровень или level=null для любого)
    qs = (
        Mark.objects
        .filter(subject__subject_short__iexact=subject_norm)
        .filter(Q(level__level__iexact=level_norm) | Q(level__isnull=True))
        .filter(score__lte=total)
        .select_related("comment")
    )
    # Сначала берём запись с подходящим уровнем, затем с максимальным score <= total
    qs = qs.annotate(
        level_match=Case(
            When(level__level__iexact=level_norm, then=Value(1)),
            default=Value(0),
            output_field=IntegerField(),
        )
    ).order_by("-level_match", "-score")
    mark_row = qs.first()
    if mark_row is None:
        return JsonResponse({"score_exam": None, "comment": None, "mark_level": None})
    score_exam = mark_row.score_exam
    comment = mark_row.comment.comment_text if mark_row.comment else None
    mark_level = mark_row.comment.mark_level if (mark_row.comment and mark_row.comment.mark_level) else None
    return JsonResponse({"score_exam": score_exam, "comment": comment, "mark_level": mark_level})


@require_http_methods(["GET"])
def api_support_info(request, level, subject):
    """Справочная информация по предмету и уровню.

    Для ВПР: при query-параметре vpr_class или class (целое число) отдаются блоки без класса
    (общие) и блоки с указанным классом.
    """
    from django.db.models import Q

    qs = (
        SupportInfo.objects
        .filter(subject__subject_short__iexact=(subject or "").strip())
        .filter(Q(level__level=level) | Q(level__isnull=True))
    )
    level_norm = str(level or "").strip().lower()
    if level_norm == "vpr":
        raw = request.GET.get("vpr_class") or request.GET.get("class")
        if raw is not None and str(raw).strip().isdigit():
            g = int(str(raw).strip())
            qs = qs.filter(Q(vpr_class__isnull=True) | Q(vpr_class=g))
    items = list(qs.select_related("subject", "level").order_by("-level_id"))
    result = [
        {"html": process_latex(str(info.info_text or ""), for_browser=True)}
        for info in items
    ]
    return JsonResponse({"items": result})


@require_http_methods(["GET"])
def api_updates(request):
    """Список обновлений платформы (только с show=True), по убыванию времени добавления."""
    items = list(
        Update.objects.filter(show=True).order_by("-created")[:20].values("id", "title", "description", "created")
    )
    for item in items:
        d = item.get("created")
        if d:
            try:
                item["created_display"] = d.strftime("%d.%m.%Y, %H:%M")
                item["created_iso"] = d.strftime("%Y-%m-%dT%H:%M:%S")
            except (AttributeError, TypeError):
                item["created_display"] = ""
                item["created_iso"] = ""
        else:
            item["created_display"] = ""
            item["created_iso"] = ""
        del item["created"]
    return JsonResponse({"updates": items})


@require_http_methods(["GET"])
def api_announcements(request):
    """Активные объявления для главной страницы (show=True), по порядку."""
    qs = Announcement.objects.filter(show=True).order_by("sort_order", "-created")[:10]
    def build_url(field):
        if field:
            try:
                return request.build_absolute_uri(field.url)
            except (ValueError, TypeError):
                pass
        return ""

    rows = []
    for obj in qs:
        rows.append({
            "id": obj.id,
            "title": obj.title,
            "body": str(obj.body or ""),
            "image_url": build_url(obj.corner_image),
            "button_label": obj.button_label,
            "button_url": obj.button_url,
            "background_url": build_url(obj.background),
            "has_button": bool(
                (obj.button_label or "").strip() and (obj.button_url or "").strip()
            ),
            "theme_overlay_url": build_url(obj.theme_overlay),
            "theme_header_bg_url": build_url(obj.theme_header_bg),
            "theme_logo_url": build_url(obj.theme_logo),
            "theme_decor_url": build_url(obj.theme_decor),
            "theme_worksheet_bg_url": build_url(obj.theme_worksheet_bg),
        })
    return JsonResponse({"announcements": rows})


def _lesson_viewer_is_teacher_or_admin(request) -> bool:
    user = getattr(request, "user", None)
    if user is None:
        return False
    if not getattr(user, "is_authenticated", False):
        return False
    return bool(getattr(user, "is_staff", False) or getattr(user, "is_superuser", False))


def _lesson_admin_forbidden_response():
    return JsonResponse({"error": "Недостаточно прав"}, status=403)


def _require_lesson_admin(request):
    if _lesson_viewer_is_teacher_or_admin(request):
        return None
    return _lesson_admin_forbidden_response()


def _visible_lessons_queryset(request):
    qs = Lesson.objects.all()
    if _lesson_viewer_is_teacher_or_admin(request):
        return qs
    return qs.filter(status=Lesson.Status.PUBLISHED).exclude(access_level=Lesson.AccessLevel.PRIVATE)


def _parse_lesson_int_param(request, key):
    value = (request.GET.get(key) or "").strip()
    if not value:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _parse_request_json_object(request):
    try:
        raw = request.body.decode("utf-8") if isinstance(request.body, (bytes, bytearray)) else request.body
        data = json.loads(raw or "{}")
    except (json.JSONDecodeError, UnicodeDecodeError, TypeError, ValueError):
        return None, JsonResponse({"error": "Неверный JSON"}, status=400)
    if not isinstance(data, dict):
        return None, JsonResponse({"error": "Тело запроса должно быть JSON-объектом"}, status=400)
    return data, None


def _extract_task_ids_from_block_content(content):
    if not isinstance(content, dict):
        return []
    raw_ids = content.get("task_ids")
    if not isinstance(raw_ids, list):
        return []
    result = []
    seen = set()
    for raw in raw_ids:
        try:
            task_id = int(raw)
        except (TypeError, ValueError):
            continue
        if task_id <= 0 or task_id in seen:
            continue
        seen.add(task_id)
        result.append(task_id)
    return result


def _task_file_absolute_url(request, task):
    f = getattr(task, "files", None)
    if not f:
        return None
    try:
        url = f.url
    except Exception:
        return None
    try:
        return request.build_absolute_uri(url)
    except Exception:
        return url


def _serialize_task_for_lesson(request, task, include_answer=False):
    tl = getattr(task, "task", None)
    part_id = getattr(tl, "part_id", None)
    keep_tables = bool(part_id == 2)
    payload = {
        "id": task.id,
        "task_list_id": tl.id if tl else None,
        "task_number": tl.task_number if tl else None,
        "task_title": tl.task_title if tl else "",
        "subject": tl.subject.subject_short if tl and tl.subject else None,
        "level": tl.level.level if tl and tl.level else None,
        "text": process_latex(
            str(task.task_template or ""),
            for_browser=True,
            keep_layout_tables=keep_tables,
        ),
        "max_score": getattr(task, "max_score", 1) or 1,
        "file_url": _task_file_absolute_url(request, task),
    }
    if include_answer:
        payload["answer"] = process_latex(str(task.answer or ""), for_browser=True)
    return payload


def _serialize_lesson_blocks(request, steps, viewer_is_teacher):
    step_payloads = []
    file_resource_ids = set()
    task_ids = set()

    for step in steps:
        if hasattr(step, 'genericstep'):
            content = step.genericstep.content if isinstance(step.genericstep.content, dict) else {}
            file_keys = ("file_resource_id", "file_resource_ids", "resource_id", "resource_ids")
            for key in file_keys:
                raw = content.get(key)
                if raw is None:
                    continue
                if isinstance(raw, list):
                    candidates = raw
                else:
                    candidates = [raw]
                for candidate in candidates:
                    try:
                        file_resource_ids.add(int(candidate))
                    except (TypeError, ValueError):
                        continue
            if step.step_type in {
                LessonStep.StepType.TASKS,
                LessonStep.StepType.HOMEWORK,
                LessonStep.StepType.QUIZ,
            }:
                task_ids.update(_extract_task_ids_from_block_content(content))

    file_resources_map = {
        fr.id: fr
        for fr in FileResource.objects.filter(id__in=file_resource_ids)
    }
    tasks_map = {
        t.id: t
        for t in Task.active_objects.filter(id__in=task_ids).select_related(
            "task",
            "task__subject",
            "task__level",
            "task__part",
            "subtopic",
        )
    }

    for step in steps:
        serialized = LessonStepSerializer(step, context={"request": request}).data

        if hasattr(step, 'presentationstep') and step.presentationstep.presentation:
            serialized["presentation"] = PresentationPublicSerializer(
                step.presentationstep.presentation,
                context={"request": request},
            ).data

        if hasattr(step, 'genericstep'):
            content = serialized.get("content") or {}
            if not isinstance(content, dict):
                content = {}

            file_candidates = []
            for key in ("file_resource_id", "resource_id"):
                if content.get(key) is not None:
                    file_candidates.append(content.get(key))
            for key in ("file_resource_ids", "resource_ids"):
                value = content.get(key)
                if isinstance(value, list):
                    file_candidates.extend(value)
            resolved_files = []
            for candidate in file_candidates:
                try:
                    rid = int(candidate)
                except (TypeError, ValueError):
                    continue
                resource = file_resources_map.get(rid)
                if resource is None:
                    continue
                resolved_files.append(
                    FileResourceSerializer(resource, context={"request": request}).data
                )
            if resolved_files:
                content["resources"] = resolved_files

            if step.step_type in {
                LessonStep.StepType.TASKS,
                LessonStep.StepType.HOMEWORK,
                LessonStep.StepType.QUIZ,
            }:
                task_ids_ordered = _extract_task_ids_from_block_content(content)
                include_answer = bool(content.get("show_answers")) or viewer_is_teacher
                content["tasks"] = [
                    _serialize_task_for_lesson(request, tasks_map[task_id], include_answer=include_answer)
                    for task_id in task_ids_ordered
                    if task_id in tasks_map
                ]

            serialized["content"] = content

        step_payloads.append(serialized)

    return step_payloads


@require_http_methods(["GET"])
def api_lessons(request):
    qs = _visible_lessons_queryset(request)

    subject = (request.GET.get("subject") or "").strip()
    if subject:
        qs = qs.filter(subject__iexact=subject)
    grade = _parse_lesson_int_param(request, "grade")
    if grade is not None:
        qs = qs.filter(grade=grade)
    level = (request.GET.get("level") or "").strip()
    if level:
        qs = qs.filter(level__iexact=level)
    exam_type = (request.GET.get("exam_type") or "").strip()
    if exam_type:
        qs = qs.filter(exam_type=exam_type.lower())
    task_number = _parse_lesson_int_param(request, "task_number")
    if task_number is not None:
        qs = qs.filter(task_number=task_number)
    topic = (request.GET.get("topic") or "").strip()
    if topic:
        qs = qs.filter(topic__icontains=topic)
    subtopic = (request.GET.get("subtopic") or "").strip()
    if subtopic:
        qs = qs.filter(subtopic__icontains=subtopic)
    difficulty = (request.GET.get("difficulty") or "").strip()
    if difficulty:
        qs = qs.filter(difficulty=difficulty)
    access_level = (request.GET.get("access_level") or "").strip()
    if access_level:
        qs = qs.filter(access_level=access_level)

    if _lesson_viewer_is_teacher_or_admin(request):
        status = (request.GET.get("status") or "").strip()
        if status:
            qs = qs.filter(status=status)

    q = (request.GET.get("q") or "").strip()
    if q:
        qs = qs.filter(
            Q(title__icontains=q)
            | Q(topic__icontains=q)
            | Q(subtopic__icontains=q)
            | Q(short_description__icontains=q)
        )

    lessons = list(qs.order_by("-updated_at", "-created_at"))

    serializer = LessonCatalogSerializer(lessons, many=True, context={"request": request})
    return JsonResponse({"lessons": serializer.data, "total": len(serializer.data)})


@require_http_methods(["GET"])
def api_lesson_detail(request, slug):
    lesson = get_object_or_404(_visible_lessons_queryset(request), slug=slug)
    lesson_data = LessonCatalogSerializer(lesson, context={"request": request}).data
    lesson_data.update(
        {
            "teacher_goal": lesson.teacher_goal,
            "student_result": lesson.student_result,
            "viewer": {"is_teacher_or_admin": _lesson_viewer_is_teacher_or_admin(request)},
        }
    )
    return JsonResponse({"lesson": lesson_data})


@require_http_methods(["GET"])
def api_lesson_archive_view(request, slug):
    lesson = get_object_or_404(_visible_lessons_queryset(request), slug=slug)

    from .lesson_archive import (
        archive_base_dir,
        find_html_entry,
        lesson_file_base_href,
        open_lesson_archive,
        read_archive_html,
        read_lesson_file_html,
    )

    if lesson.archive:
        with open_lesson_archive(lesson.archive.path) as zf:
            html_entry = find_html_entry(zf.namelist())
            if not html_entry:
                raise Http404("HTML в архиве не найден")
            base_dir = archive_base_dir(html_entry)
            base_href = request.build_absolute_uri(f"/api/lessons/{slug}/archive/{base_dir}")
            if not base_href.endswith("/"):
                base_href += "/"
            html = read_archive_html(zf, html_entry, base_href, request=request, slug=slug)
        return HttpResponse(html, content_type="text/html; charset=utf-8")

    if lesson.file:
        file_path = lesson.file.path
        if not file_path.lower().endswith(".html"):
            from django.http import FileResponse
            import mimetypes
            content_type = mimetypes.guess_type(file_path)[0] or "application/octet-stream"
            return FileResponse(open(file_path, "rb"), content_type=content_type)
            
        base_href = lesson_file_base_href(request, lesson)
        html = read_lesson_file_html(file_path, base_href, request=request, slug=slug)
        return HttpResponse(html, content_type="text/html; charset=utf-8")

    raise Http404("Урок не найден")


@require_http_methods(["GET"])
def api_lesson_archive_asset(request, slug, asset_path):
    lesson = get_object_or_404(_visible_lessons_queryset(request), slug=slug)
    if not lesson.archive:
        raise Http404("Архив урока не найден")

    from .lesson_archive import (
        archive_asset_response,
        find_html_entry,
        open_lesson_archive,
        resolve_archive_asset,
    )

    with open_lesson_archive(lesson.archive.path) as zf:
        namelist = zf.namelist()
        html_entry = find_html_entry(namelist)
        if not html_entry:
            raise Http404("HTML в архиве не найден")
        entry = resolve_archive_asset(namelist, asset_path, html_entry)
        if not entry:
            raise Http404("Файл не найден")
        return archive_asset_response(zf, entry)


@csrf_exempt
@require_http_methods(["POST"])
def api_lesson_block_launch(request, slug, block_id):
    lesson = get_object_or_404(_visible_lessons_queryset(request), slug=slug)
    step = get_object_or_404(LessonStep, lesson=lesson, id=block_id)

    viewer_is_teacher = _lesson_viewer_is_teacher_or_admin(request)
    if not viewer_is_teacher and not step.is_visible_to_student:
        return JsonResponse({"error": "Блок недоступен"}, status=403)

    if step.step_type not in {
        LessonStep.StepType.TASKS,
        LessonStep.StepType.HOMEWORK,
        LessonStep.StepType.QUIZ,
    }:
        return JsonResponse({"error": "Блок не поддерживает интерактивный запуск"}, status=400)

    content = {}
    if hasattr(step, 'genericstep'):
        content = step.genericstep.content if isinstance(step.genericstep.content, dict) else {}
        
    task_ids = _extract_task_ids_from_block_content(content)
    if not task_ids:
        return JsonResponse({"error": "В блоке нет task_ids"}, status=400)

    tasks = list(
        Task.active_objects.filter(id__in=task_ids).select_related("task", "task__subject", "task__level")
    )
    task_map = {task.id: task for task in tasks}
    ordered_tasks = [task_map[task_id] for task_id in task_ids if task_id in task_map]
    if not ordered_tasks:
        return JsonResponse({"error": "Не найдены валидные задачи для запуска"}, status=400)

    subject_ids = {task.task.subject_id for task in ordered_tasks if task.task and task.task.subject_id}
    level_ids = {task.task.level_id for task in ordered_tasks if task.task and task.task.level_id}
    if len(subject_ids) != 1 or len(level_ids) != 1:
        return JsonResponse(
            {"error": "Для интерактивного запуска задачи должны быть одного предмета и уровня"},
            status=400,
        )

    variant = Variant.objects.create(
        var_subject=ordered_tasks[0].task.subject,
        level=ordered_tasks[0].task.level,
        created_by=username_for_created_by(request),
    )
    VariantContent.objects.bulk_create(
        [
            VariantContent(variant=variant, task=task, order=order)
            for order, task in enumerate(ordered_tasks, start=1)
        ]
    )

    level_slug = ordered_tasks[0].task.level.level
    subject_slug = ordered_tasks[0].task.subject.subject_short
    return JsonResponse(
        {
            "variant_id": variant.id,
            "variant_url": f"/{level_slug}/{subject_slug}/variant/{variant.id}",
            "subject": subject_slug,
            "level": level_slug,
        }
    )


@csrf_exempt
@require_http_methods(["GET", "POST"])
def api_admin_lessons(request):
    denied = _require_lesson_admin(request)
    if denied is not None:
        return denied

    if request.method == "GET":
        qs = Lesson.objects.all().order_by("-updated_at", "-created_at")
        status = (request.GET.get("status") or "").strip()
        if status:
            qs = qs.filter(status=status)
        subject = (request.GET.get("subject") or "").strip()
        if subject:
            qs = qs.filter(subject__iexact=subject)
        q = (request.GET.get("q") or "").strip()
        if q:
            qs = qs.filter(
                Q(title__icontains=q)
                | Q(topic__icontains=q)
                | Q(subtopic__icontains=q)
                | Q(short_description__icontains=q)
            )

        data = LessonAdminSerializer(qs, many=True, context={"request": request}).data
        return JsonResponse({"lessons": data, "total": len(data)})

    payload, err = _parse_request_json_object(request)
    if err is not None:
        return err
    serializer = LessonAdminSerializer(data=payload, context={"request": request})
    if not serializer.is_valid():
        return JsonResponse({"errors": serializer.errors}, status=400)
    lesson = serializer.save()
    out = LessonAdminSerializer(lesson, context={"request": request}).data
    return JsonResponse({"lesson": out}, status=201)


@csrf_exempt
@require_http_methods(["GET", "PATCH", "DELETE"])
def api_admin_lesson_detail(request, slug):
    denied = _require_lesson_admin(request)
    if denied is not None:
        return denied

    lesson = get_object_or_404(Lesson, slug=slug)
    if request.method == "GET":
        data = LessonAdminSerializer(lesson, context={"request": request}).data
        return JsonResponse({"lesson": data})

    if request.method == "DELETE":
        lesson.delete()
        return JsonResponse({"ok": True})

    payload, err = _parse_request_json_object(request)
    if err is not None:
        return err
    serializer = LessonAdminSerializer(
        lesson,
        data=payload,
        partial=True,
        context={"request": request},
    )
    if not serializer.is_valid():
        return JsonResponse({"errors": serializer.errors}, status=400)
    updated_lesson = serializer.save()
    data = LessonAdminSerializer(updated_lesson, context={"request": request}).data
    return JsonResponse({"lesson": data})


@csrf_exempt
@require_http_methods(["GET", "POST"])
def api_admin_lesson_blocks(request, slug):
    denied = _require_lesson_admin(request)
    if denied is not None:
        return denied

    lesson = get_object_or_404(Lesson, slug=slug)
    if request.method == "GET":
        steps = LessonStep.objects.filter(lesson=lesson).order_by("order", "id")
        data = LessonStepSerializer(steps, many=True, context={"request": request}).data
        return JsonResponse({"lesson_slug": lesson.slug, "blocks": data, "total": len(data)})

    payload, err = _parse_request_json_object(request)
    if err is not None:
        return err

    step_type = payload.get("block_type") or payload.get("step_type")
    payload["step_type"] = step_type

    if step_type == LessonStep.StepType.PRESENTATION:
        serializer = PresentationStepSerializer(data=payload, context={"request": request})
    elif step_type == LessonStep.StepType.HTML:
        serializer = HtmlStepSerializer(data=payload, context={"request": request})
    else:
        serializer = GenericStepSerializer(data=payload, context={"request": request})

    if not serializer.is_valid():
        return JsonResponse({"errors": serializer.errors}, status=400)
    try:
        step = serializer.save(lesson=lesson)
    except Exception as exc:
        return JsonResponse({"error": str(exc)}, status=400)
    return JsonResponse({"block": LessonStepSerializer(step, context={"request": request}).data}, status=201)


@csrf_exempt
@require_http_methods(["PATCH", "DELETE"])
def api_admin_lesson_block_detail(request, slug, block_id):
    denied = _require_lesson_admin(request)
    if denied is not None:
        return denied

    lesson = get_object_or_404(Lesson, slug=slug)
    step = get_object_or_404(LessonStep, lesson=lesson, id=block_id)

    if request.method == "DELETE":
        step.delete()
        return JsonResponse({"ok": True})

    payload, err = _parse_request_json_object(request)
    if err is not None:
        return err

    if hasattr(step, 'presentationstep'):
        serializer = PresentationStepSerializer(step.presentationstep, data=payload, partial=True, context={"request": request})
    elif hasattr(step, 'htmlstep'):
        serializer = HtmlStepSerializer(step.htmlstep, data=payload, partial=True, context={"request": request})
    elif hasattr(step, 'genericstep'):
        serializer = GenericStepSerializer(step.genericstep, data=payload, partial=True, context={"request": request})
    else:
        serializer = LessonStepSerializer(step, data=payload, partial=True, context={"request": request})

    if not serializer.is_valid():
        return JsonResponse({"errors": serializer.errors}, status=400)
    try:
        updated_step = serializer.save()
    except Exception as exc:
        return JsonResponse({"error": str(exc)}, status=400)
    return JsonResponse({"block": LessonStepSerializer(updated_step, context={"request": request}).data})


@csrf_exempt
@require_http_methods(["POST"])
def api_admin_lesson_blocks_reorder(request, slug):
    denied = _require_lesson_admin(request)
    if denied is not None:
        return denied

    lesson = get_object_or_404(Lesson, slug=slug)
    payload, err = _parse_request_json_object(request)
    if err is not None:
        return err

    ordered_block_ids = payload.get("ordered_block_ids")
    order_rows = payload.get("orders")

    steps = {
        step.id: step
        for step in LessonStep.objects.filter(lesson=lesson)
    }

    with transaction.atomic():
        if isinstance(ordered_block_ids, list):
            seq = []
            seen = set()
            for raw in ordered_block_ids:
                try:
                    step_id = int(raw)
                except (TypeError, ValueError):
                    continue
                if step_id in seen or step_id not in steps:
                    continue
                seen.add(step_id)
                seq.append(step_id)
            tail = [bid for bid in steps.keys() if bid not in seen]
            full_order = seq + tail
            for index, step_id in enumerate(full_order, start=1):
                LessonStep.objects.filter(id=step_id, lesson=lesson).update(order=index)
        elif isinstance(order_rows, list):
            used_orders = set()
            updates = []
            for row in order_rows:
                if not isinstance(row, dict):
                    continue
                try:
                    step_id = int(row.get("id"))
                    order_value = int(row.get("order"))
                except (TypeError, ValueError):
                    continue
                if step_id not in steps or order_value < 0 or order_value in used_orders:
                    continue
                used_orders.add(order_value)
                updates.append((step_id, order_value))
            if not updates:
                return JsonResponse({"error": "Передайте ordered_block_ids или корректный список orders"}, status=400)
            for step_id, order_value in updates:
                LessonStep.objects.filter(id=step_id, lesson=lesson).update(order=order_value)
        else:
            return JsonResponse({"error": "Передайте ordered_block_ids или список orders"}, status=400)

    data = LessonStepSerializer(
        LessonStep.objects.filter(lesson=lesson).order_by("order", "id"),
        many=True,
        context={"request": request}
    ).data
    return JsonResponse({"lesson_slug": lesson.slug, "blocks": data, "total": len(data)})


@csrf_exempt
@require_http_methods(["POST"])
def report_pdf(request, level, subject):
    """Генерация PDF-отчёта по результатам выполнения варианта."""
    try:
        data = json.loads(request.body)
    except (json.JSONDecodeError, TypeError):
        return JsonResponse({"error": "Неверный формат данных"}, status=400)

    variant_id = data.get("variantId")
    if not variant_id:
        return JsonResponse({"error": "Не указан вариант"}, status=400)

    variant = get_object_or_404(
        Variant.objects.select_related("var_subject", "level"),
        id=variant_id,
    )
    if (
        str(variant.var_subject.subject_short).lower() != str(subject).lower()
        or str(variant.level.level).lower() != str(level).lower()
    ):
        return JsonResponse({"error": "Вариант не соответствует уровню/предмету"}, status=400)

    student_name = (data.get("studentName") or "Ученик").strip() or "Ученик"
    start_time_raw = data.get("startTime") or ""
    end_time_raw = data.get("endTime") or ""
    total_time_formatted = data.get("totalTimeFormatted") or ""
    task_times = data.get("taskTimes") or {}
    scores = data.get("scores") or {}
    tasks = data.get("tasks") or []
    total_score = data.get("totalScore", 0)
    max_score = data.get("maxScore", 0)
    score_exam = data.get("scoreExam")
    score_comment = data.get("scoreComment") or ""
    mark_level = data.get("markLevel")

    # Время в отчёте — по компьютеру пользователя (передано с фронта в локальном формате)
    date_solution = (data.get("dateSolutionLocal") or "").strip()
    time_start = (data.get("timeStartLocal") or "").strip()
    time_end = (data.get("timeEndLocal") or "").strip()
    if not date_solution or not time_start:
        try:
            if start_time_raw:
                dt = datetime.fromisoformat(start_time_raw.replace("Z", "+00:00"))
                if not date_solution:
                    date_solution = dt.strftime("%d.%m.%Y")
                if not time_start:
                    time_start = dt.strftime("%H:%M:%S")
            if end_time_raw and not time_end:
                dt_end = datetime.fromisoformat(end_time_raw.replace("Z", "+00:00"))
                time_end = dt_end.strftime("%H:%M:%S")
        except (ValueError, TypeError):
            pass

    subj_short = str(subject).strip().lower()
    subject_label = {
        "inf": "Информатика",
        "math": "Математика",
    }.get(subj_short, variant.var_subject.subject_name or str(subject))
    level_val = str(level).lower()
    level_label = {"oge": "ОГЭ", "ege": "ЕГЭ", "vpr": "ВПР"}.get(level_val, level_val.upper())
    if level_val.isdigit():
        level_label = f"{level_val} класс"

    vpr_grade = None
    if level_val == "vpr":
        agg = VariantContent.objects.filter(variant=variant).aggregate(
            _vpr=Min("task__vpr_class")
        )
        vpr_grade = agg.get("_vpr")
        if vpr_grade is None:
            raw_g = data.get("vprGrade") or data.get("vpr_grade") or data.get("grade")
            if raw_g is not None and str(raw_g).strip().isdigit():
                vpr_grade = int(str(raw_g).strip())
        if vpr_grade is None:
            for t in tasks:
                if not isinstance(t, dict):
                    continue
                vc = t.get("vpr_class")
                if vc is not None and str(vc).strip().isdigit():
                    vpr_grade = int(str(vc).strip())
                    break

    subtopic_by_task_id = {}
    topic_by_task_id = {}
    try:
        for vc in VariantContent.objects.filter(variant=variant).select_related("task__subtopic", "task__task"):
            st = getattr(vc.task, "subtopic", None)
            if st and (st.title or "").strip():
                subtopic_by_task_id[vc.task_id] = (st.title or "").strip()
            tl = getattr(vc.task, "task", None)
            if tl and (tl.task_title or "").strip():
                topic_by_task_id[vc.task_id] = (tl.task_title or "").strip()
    except Exception:
        pass

    level_to_class = {1: "insufficient", 2: "threshold", 3: "average", 4: "high"}
    score_comment_class = level_to_class.get(mark_level, "") if mark_level else ""

    base_url = request.build_absolute_uri("/").rstrip("/") or "/"

    pedagogical_ctx = build_pedagogical_report_context(
        student_name=student_name,
        subject_label=subject_label,
        level_val=level_val,
        level_label=level_label,
        variant_id=variant_id,
        date_solution=date_solution,
        time_start=time_start,
        time_end=time_end,
        total_time_formatted=total_time_formatted,
        total_score=total_score,
        max_score=max_score,
        score_exam=score_exam,
        score_comment=score_comment,
        mark_level=mark_level,
        is_vpr=level_val == "vpr",
        vpr_grade=vpr_grade,
        tasks_payload=tasks,
        scores=scores,
        task_times=task_times,
        subtopic_by_task_id=subtopic_by_task_id,
        topic_by_task_id=topic_by_task_id,
    )

    context = {
        **pedagogical_ctx,
        "base_url": base_url,
        "pdf_css": pdf_utils.get_pdf_css(),
        "score_comment_class": score_comment_class,
        "favicon_url": request.build_absolute_uri("/favicon.png"),
    }

    html_string = render_to_string("report_template.html", context)
    base_url = request.build_absolute_uri("/")

    if not _WEASYPRINT_OK:
        return HttpResponse("PDF недоступен: WeasyPrint не установлен", status=503, content_type="text/plain; charset=utf-8")

    try:
        pdf = WeasyHTML(string=html_string, base_url=base_url).write_pdf()
    except Exception as e:
        logger.exception("WeasyPrint report PDF failed: %s", e)
        return HttpResponse("Ошибка генерации PDF", status=500, content_type="text/plain; charset=utf-8")

    safe_name = "".join(c if c.isalnum() or c in " -_" else "-" for c in student_name).strip() or "report"
    response = HttpResponse(pdf, content_type="application/pdf")
    response["Content-Disposition"] = f'attachment; filename="report-{safe_name}.pdf"'
    return response


def _render_variant_pdf(request, level, subject, variant_id, background_url="", theme="default"):

    author_filter = (request.GET.get("author") or "").strip() or None
    url_level = (level or "").strip().lower()
    url_subject = (subject or "").strip().lower()
    cache_path = pdf_utils.get_pdf_cache_path(variant_id, theme, author_filter)
    nocache = request.GET.get("nocache", "").lower() in ("1", "true", "yes")
    if django_settings.DEBUG:
        nocache = True  # В режиме разработки всегда перегенерируем PDF
    variant = get_object_or_404(Variant.objects.select_related("level", "var_subject"), id=variant_id)
    if (variant.level.level or "").strip().lower() != url_level:
        raise Http404()
    if (variant.var_subject.subject_short or "").strip().lower() != url_subject:
        raise Http404()
    if os.path.exists(cache_path) and not nocache:
        f = open(cache_path, "rb")
        try:
            ascii_name, pretty_name = pdf_utils.build_pdf_filename(variant)
            response = FileResponse(f, content_type="application/pdf")
            response["Content-Disposition"] = (
                f'inline; filename="{ascii_name}"; '
                f"filename*=UTF-8''{quote(pretty_name)}"
            )
            return response
        except Exception:
            f.close()
            raise
    try:
        context = pdf_utils.build_pdf_context(request, variant, subject, author_filter=author_filter)
    except Exception as e:
        logger.exception("PDF build_pdf_context failed for variant %s: %s", variant_id, e)
        return HttpResponse("Ошибка подготовки PDF", status=500, content_type="text/plain; charset=utf-8")

    context["background_url"] = background_url

    html_string = render_to_string("pdf_template.html", context)
    base_url = request.build_absolute_uri('/')

    if not _WEASYPRINT_OK:
        return HttpResponse("PDF недоступен: WeasyPrint не установлен", status=503, content_type="text/plain; charset=utf-8")

    try:
        pdf = WeasyHTML(string=html_string, base_url=base_url).write_pdf()
    except IndexError:
        html_safe = re.sub(
            r'<div class="task__text">\s*</div>',
            '<div class="task__text"><p>&nbsp;</p></div>',
            html_string,
        )
        html_safe = re.sub(
            r'<div class="task-body">\s*</div>',
            '<div class="task-body"><p>&nbsp;</p></div>',
            html_safe,
        )
        html_safe = re.sub(
            r'<div class="task__answer-field">\s*</div>',
            '<div class="task__answer-field">&nbsp;</div>',
            html_safe,
        )
        html_safe = re.sub(
            r'<span class="answer-field">\s*</span>',
            '<span class="answer-field">&nbsp;</span>',
            html_safe,
        )
        pdf = WeasyHTML(string=html_safe, base_url=base_url).write_pdf()
    except Exception as e:
        logger.exception("WeasyPrint PDF generation failed for variant %s: %s", variant_id, e)
        return HttpResponse("Ошибка генерации PDF", status=500, content_type="text/plain; charset=utf-8")

    try:
        with open(cache_path, "wb") as f:
            f.write(pdf)
    except OSError as e:
        logger.warning("Could not cache PDF to %s: %s", cache_path, e)

    ascii_name, pretty_name = pdf_utils.build_pdf_filename(variant)
    response = HttpResponse(pdf, content_type="application/pdf")
    response["Content-Disposition"] = (
        f'inline; filename="{ascii_name}"; '
        f"filename*=UTF-8''{quote(pretty_name)}"
    )
    return response


def _get_announcement_worksheet_bg(request, theme=None):
    """Ищет активное объявление с заполненным theme_worksheet_bg, фильтруя по теме."""
    qs = (
        Announcement.objects
        .filter(show=True, theme_worksheet_bg__isnull=False)
        .exclude(theme_worksheet_bg="")
        .order_by("sort_order", "-created")
    )
    if theme == "easter":
        qs = qs.filter(title__iregex=r'пасх|easter')
    elif theme == "cosmos":
        qs = qs.filter(title__iregex=r'косм|cosmos|space')
    obj = qs.first()
    if obj and obj.theme_worksheet_bg:
        try:
            return request.build_absolute_uri(obj.theme_worksheet_bg.url)
        except (ValueError, TypeError):
            pass
    return ""


def variant_pdf(request, level, subject, variant_id):
    theme = request.GET.get("theme", "").lower()
    background_url = ""
    if theme == "cosmos":
        background_url = pdf_utils.resolve_background_image("img/cosmos.png", request=request)
    elif theme == "easter":
        background_url = pdf_utils.resolve_background_image("img/easter.png", request=request)
    return _render_variant_pdf(
        request,
        level,
        subject,
        variant_id,
        background_url=background_url,
        theme=theme or "default",
    )


def variant_pdfCosmos(request, level, subject, variant_id):
    """PDF варианта с космической темой (алиас для /pdf/cosmos)."""
    background_url = pdf_utils.resolve_background_image("img/cosmos.png", request=request)
    return _render_variant_pdf(
        request,
        level,
        subject,
        variant_id,
        background_url=background_url,
        theme="cosmos",
    )


def search_task(request):
    q = (request.GET.get("q") or "").strip()
    if not q or not q.isdigit():
        return JsonResponse({"tasks": []})

    task = Task.active_objects.filter(id=int(q)).select_related("task").first()
    if not task or not task.task:
        return JsonResponse({"tasks": []})

    return JsonResponse({
        "tasks": [{
            "id": task.id,
            "subject": task.task.subject.subject_short if task.task and task.task.subject else None,
            "task_number": task.task.task_number,
            "task_text": process_latex(str(task.task_template or ""), for_browser=True),
            "answer": task.answer,
        }]
    })


def search_variant(request):
    q = (request.GET.get("q") or "").strip()
    if not q or not q.isdigit():
        return JsonResponse({"variant": None, "tasks": []})

    variant = Variant.objects.filter(id=int(q)).select_related("var_subject", "level").first()
    if not variant:
        return JsonResponse({"variant": None, "tasks": []})

    contents = (
        VariantContent.objects
        .filter(variant=variant)
        .select_related("task")
        .order_by("order")
    )
    tasks = [
        {
            "number": item.order,
            "id": item.task.id,
            "answer": item.task.answer,
            "task_text": process_latex(str(item.task.task_template or ""), for_browser=True),
        }
        for item in contents
    ]
    return JsonResponse({
        "variant": {
            "id": variant.id,
            "level": variant.level.level,
            "subject": variant.var_subject.subject_short,
            "subject_name": variant.var_subject.subject_name,
        },
        "tasks": tasks,
    })


@csrf_exempt
@require_http_methods(["POST"])
def report_error(request, level, subject):
    """Приём отчёта об ошибке и сохранение в базу данных."""
    try:
        data = json.loads(request.body)
    except (json.JSONDecodeError, TypeError):
        return JsonResponse({"error": "Неверный формат данных"}, status=400)

    task_id = data.get("taskId")
    task_number = data.get("taskNumber")
    error_type = data.get("errorType")
    comment = (data.get("comment") or "").strip()
    variant_id = data.get("variantId")

    if not error_type:
        return JsonResponse({"error": "Не указан тип ошибки"}, status=400)

    try:
        report = ErrorReport.objects.create(
            subject=str(subject),
            level=str(level),
            task_number=int(task_number) if task_number is not None else None,
            task_id=int(task_id) if task_id is not None else None,
            variant_id=int(variant_id) if variant_id is not None else None,
            error_type=str(error_type),
            comment=comment,
        )
    except Exception:
        logger.exception("Не удалось сохранить ErrorReport")
        return JsonResponse({"error": "Не удалось сохранить сообщение"}, status=500)

    try:
        notify_error_report_email(
            subject=report.subject,
            level=report.level,
            task_number=report.task_number,
            task_id=report.task_id,
            variant_id=report.variant_id,
            error_type=report.error_type,
            comment=report.comment,
        )
    except Exception:
        logger.exception("Не удалось отправить письмо об ошибке")

    return JsonResponse({"ok": True})


# ---------------------------------------------------------------------------
# Lesson join (receives JWT from cabinet, renders lesson room)
# ---------------------------------------------------------------------------

def _lesson_jwt_iss_allowed(iss) -> bool:
    """ЛК может подставлять iss по-разному (домен, короткое имя) — после проверки подписи допускаем типовые варианты."""
    if iss is None:
        return True
    s = str(iss).strip().lower()
    if not s:
        return True
    if s in (
        "cabinet",
        "lk-cabinet",
        "lk_cabinet",
        "lk",
        "personal-cabinet",
        "personal_cabinet",
        "lesson",
    ):
        return True
    if "cabinet" in s or "lk" in s or "lesson" in s:
        return True
    return False


def _persist_lesson_room(room_id: str, payload: dict) -> None:
    rid = str(room_id or "").strip()[:200]
    if not rid:
        return
    try:
        current_payload = (
            LessonRoom.objects.filter(room_id=rid)
            .values_list("jwt_payload", flat=True)
            .first()
        )
        merged_payload = dict(payload or {})
        if isinstance(current_payload, dict):
            for key, value in current_payload.items():
                if str(key).startswith("_lesson_"):
                    merged_payload[key] = value
        LessonRoom.objects.update_or_create(
            room_id=rid,
            defaults={"jwt_payload": merged_payload},
        )
    except Exception:
        logger.exception("Не удалось сохранить LessonRoom для %s", rid)


def _is_lesson_session_closed(room_id: str) -> bool:
    rid = str(room_id or "").strip()[:200]
    if not rid:
        return False
    try:
        return LessonRoom.objects.filter(room_id=rid, lesson_ended_at__isnull=False).exists()
    except Exception:
        logger.exception("LessonRoom closed check failed for %s", rid)
        return False


def mark_lesson_session_closed(room_id: str) -> bool:
    """
    Помечает комнату завершённой. Возвращает True, если закрытие выполнено впервые
    (нужно уведомить остальных по WebSocket).
    """
    rid = str(room_id or "").strip()[:200]
    if not rid:
        return False
    try:
        now = timezone.now()
        room = LessonRoom.objects.filter(room_id=rid).first()
        if room and room.lesson_ended_at:
            return False
        if room:
            room.lesson_ended_at = now
            room.save(update_fields=["lesson_ended_at", "updated_at"])
            return True
        LessonRoom.objects.create(room_id=rid, jwt_payload={}, lesson_ended_at=now)
        return True
    except Exception:
        logger.exception("Не удалось пометить LessonRoom завершённой: %s", rid)
        return False


def _broadcast_lesson_session_closed(room_id: str) -> None:
    try:
        from asgiref.sync import async_to_sync
        from channels.layers import get_channel_layer

        channel_layer = get_channel_layer()
        if not channel_layer:
            return
        rid = str(room_id or "").strip()
        if not rid:
            return
        async_to_sync(channel_layer.group_send)(
            f"lesson_{rid}",
            {
                "type": "lesson_message",
                "payload": {
                    "type": "lesson_ended",
                    "reason": "session_closed",
                    "by_role": "server",
                },
            },
        )
    except Exception:
        logger.exception("WS broadcast session_closed failed for %s", room_id)


def _lk_lesson_webhook_headers() -> dict:
    headers = {"Content-Type": "application/json"}
    wh = (getattr(django_settings, "LESSON_WEBHOOK_SECRET", None) or "").strip()
    if not wh:
        wh = (getattr(django_settings, "LESSON_SECRET", None) or "").strip()
    if wh:
        headers["X-Lesson-Webhook-Secret"] = wh
    return headers


def _cabinet_api_base_url() -> str:
    """База API ЛК для server-to-server запросов генератора."""
    return (
        (getattr(django_settings, "CABINET_API_BASE", "") or "").strip().rstrip("/")
        or (getattr(django_settings, "LK_PUBLIC_URL", "") or "").strip().rstrip("/")
    )


def _post_lk_lesson_webhook(endpoint: str, token: str, extra: dict | None = None) -> tuple[bool, str]:
    """
    POST { "token": ..., ...extra } на URL ЛК с X-Lesson-Webhook-Secret (как teacher-joined / student-joined).
    """
    payload: dict = {"token": token}
    if extra:
        for k, v in extra.items():
            if v is None or v == "":
                continue
            payload[k] = v
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    headers = _lk_lesson_webhook_headers()
    headers["X-Lesson-Token"] = token
    import ssl as _ssl

    http_fallback: str | None = None
    if endpoint.startswith("https://"):
        http_fallback = endpoint.replace("https://", "http://", 1)

    def _do_request(url: str) -> tuple[bool, int | None, str]:
        req = urlrequest.Request(url, data=body, method="POST", headers=headers)
        try:
            with urlrequest.urlopen(req, timeout=12):
                return True, None, ""
        except urlerror.HTTPError as e:
            detail = ""
            try:
                detail = (e.read() or b"").decode("utf-8", errors="replace")[:300]
            except Exception:
                pass
            code = getattr(e, "code", None)
            logger.warning("ЛК ответил HTTP %s на lesson webhook (%s): %s", code, url, detail or str(e))
            return False, code, detail or str(e)
        except Exception as exc:
            raise exc

    last_err: Exception | None = None
    last_detail = ""
    for attempt in range(3):
        try:
            ok, http_code, detail = _do_request(endpoint)
            if ok:
                return True, ""
            last_detail = f"HTTP {http_code} от {endpoint}: {detail[:120]}" if http_code else detail
        except (_ssl.SSLError, _ssl.CertificateError, urlerror.URLError) as e:
            last_err = e
            ssl_reason = str(e)
            last_detail = f"Ошибка соединения с {endpoint}: {ssl_reason[:120]}"
            if http_fallback and http_fallback != endpoint:
                logger.warning(
                    "SSL/URL-ошибка при обращении к %s (%s), пробуем HTTP: %s",
                    endpoint,
                    ssl_reason,
                    http_fallback,
                )
                try:
                    ok2, http_code2, detail2 = _do_request(http_fallback)
                    if ok2:
                        logger.info("Уведомление ЛК доставлено по HTTP-fallback: %s", http_fallback)
                        return True, ""
                    last_detail = (
                        f"HTTP {http_code2} от {http_fallback}: {detail2[:120]}" if http_code2 else detail2
                    )
                except Exception as e2:
                    last_err = e2
                    last_detail = f"Ошибка соединения с {http_fallback}: {str(e2)[:120]}"
        except (TimeoutError, OSError, ValueError) as e:
            last_err = e
            last_detail = f"Ошибка соединения с {endpoint}: {str(e)[:120]}"
        if attempt < 2:
            time.sleep(0.35 * (2**attempt))
    logger.warning(
        "Не удалось уведомить ЛК (lesson webhook) после 3 попыток: %s (%s)",
        endpoint,
        last_err or last_detail,
    )
    return False, last_detail


def notify_lk_teacher_joined(token: str, extra: dict | None = None) -> tuple[bool, str]:
    """
    Сообщает ЛК, что учитель реально вошёл в урок.
    ЛК рассылает ученику приглашение (WS / push на все устройства — реализуется в ЛК).
    Возвращает (success, error_detail) — error_detail не пустой только при неудаче.
    """
    endpoint = (getattr(django_settings, "LK_LESSON_NOTIFY_URL", "") or "").strip()
    if not endpoint:
        lk_base = _cabinet_api_base_url()
        if lk_base:
            endpoint = f"{lk_base}/api/lesson/teacher-joined/"
    if not endpoint and bool(getattr(django_settings, "DEBUG", False)):
        endpoint = "http://127.0.0.1:8001/api/lesson/teacher-joined/"
    if not endpoint:
        return False, "LK_PUBLIC_URL не задан — неизвестно куда отправить уведомление"
    return _post_lk_lesson_webhook(endpoint, token, extra)


def notify_lk_student_joined(token: str, extra: dict | None = None) -> tuple[bool, str]:
    """
    Сообщает ЛК, что ученик реально открыл комнату урока на генераторе (в т.ч. без клика «Присоединиться» в ЛК).
    Тот же заголовок X-Lesson-Webhook-Secret, что и для teacher-joined.
    """
    endpoint = (getattr(django_settings, "LK_LESSON_STUDENT_NOTIFY_URL", "") or "").strip()
    if not endpoint:
        lk_base = _cabinet_api_base_url()
        if lk_base:
            endpoint = f"{lk_base}/api/lesson/student-joined/"
    if not endpoint and bool(getattr(django_settings, "DEBUG", False)):
        endpoint = "http://127.0.0.1:8001/api/lesson/student-joined/"
    if not endpoint:
        return False, "LK_PUBLIC_URL не задан — неизвестно куда отправить student-joined"
    return _post_lk_lesson_webhook(endpoint, token, extra)


def notify_lk_teacher_left(token: str, extra: dict | None = None) -> tuple[bool, str]:
    """
    Сообщает ЛК, что сессия урока завершена (как в POST /api/lesson/teacher-left/ в 02_lk),
    чтобы появились записи «Урок» во вкладке «Результаты учеников».
    """
    endpoint = (getattr(django_settings, "LK_LESSON_TEACHER_LEFT_URL", "") or "").strip()
    if not endpoint:
        lk_base = _cabinet_api_base_url()
        if lk_base:
            endpoint = f"{lk_base}/api/lesson/teacher-left/"
    if not endpoint and bool(getattr(django_settings, "DEBUG", False)):
        endpoint = "http://127.0.0.1:8001/api/lesson/teacher-left/"
    if not endpoint:
        return False, "LK_PUBLIC_URL не задан — неизвестно куда отправить teacher-left"
    return _post_lk_lesson_webhook(endpoint, token, extra)


def verify_lesson_token(token: str) -> dict:
    secret = (getattr(django_settings, "LESSON_SECRET", None) or "").strip() or os.environ.get(
        "LESSON_SECRET", ""
    ).strip()
    if not secret:
        raise ValueError("LESSON_SECRET не задан на сервере")
    try:
        payload = pyjwt.decode(token, secret, algorithms=["HS256"])
        iss = payload.get("iss")
        if not _lesson_jwt_iss_allowed(iss):
            raise ValueError("Неверный издатель токена")
        return payload
    except pyjwt.ExpiredSignatureError:
        raise ValueError("Токен истёк")
    except Exception as e:
        raise ValueError(f"Невалидный токен: {e}")


def normalize_lesson_jwt_payload(payload: dict) -> dict:
    """Кабинет может отдавать snake_case или camelCase — без этого lesson_join давал KeyError (ошибка join)."""
    room = (
        payload.get("room_id")
        or payload.get("roomId")
        or payload.get("room")
        or payload.get("lesson_room_id")
        or payload.get("lessonRoomId")
        or payload.get("session_id")
        or payload.get("sessionId")
        or payload.get("lesson_id")
        or payload.get("lessonId")
    )
    teacher = (
        payload.get("teacher")
        or payload.get("teacher_name")
        or payload.get("teacherName")
        or payload.get("tutor_name")
        or payload.get("tutorName")
        or ""
    )
    target = (
        payload.get("target_name")
        or payload.get("targetName")
        or payload.get("student_name")
        or payload.get("studentName")
        or payload.get("user_name")
        or payload.get("display_name")
        or payload.get("name")
        or ""
    )
    group_name = (
        payload.get("group_name")
        or payload.get("groupName")
        or payload.get("class_name")
        or payload.get("className")
        or payload.get("stream_name")
        or payload.get("streamName")
        or payload.get("cohort_name")
        or payload.get("cohortName")
        or payload.get("lesson_group_name")
        or payload.get("lessonGroupName")
        or ""
    )
    raw_role = (
        payload.get("type")
        or payload.get("role")
        or payload.get("lesson_type")
        or payload.get("lessonType")
        or payload.get("lesson_format")
        or payload.get("lessonFormat")
        or payload.get("lesson_formaat")
        or ""
    )
    variant_obj = payload.get("variant") if isinstance(payload.get("variant"), dict) else {}
    lesson_obj = payload.get("lesson") if isinstance(payload.get("lesson"), dict) else {}

    lesson_level = (
        payload.get("level")
        or payload.get("exam_level")
        or payload.get("examLevel")
        or payload.get("level_short")
        or payload.get("levelShort")
        or variant_obj.get("level")
        or lesson_obj.get("level")
        or payload.get("lesson_level")
        or payload.get("lessonLevel")
        or ""
    )
    lesson_subject = (
        payload.get("subject")
        or payload.get("subject_short")
        or payload.get("subjectShort")
        or payload.get("subject_code")
        or payload.get("subjectCode")
        or payload.get("exam_subject")
        or payload.get("examSubject")
        or variant_obj.get("subject")
        or variant_obj.get("subject_short")
        or lesson_obj.get("subject")
        or payload.get("lesson_subject")
        or payload.get("lessonSubject")
        or ""
    )
    lesson_variant_id = (
        payload.get("variant_id")
        or payload.get("variantId")
        or payload.get("vid")
        or payload.get("variant")
        or payload.get("test_variant_id")
        or payload.get("testVariantId")
        or variant_obj.get("id")
        or variant_obj.get("variant_id")
        or lesson_obj.get("variant_id")
        or lesson_obj.get("variantId")
        or payload.get("lesson_variant_id")
        or payload.get("lessonVariantId")
    )
    lesson_variant_url = (
        payload.get("variant_url")
        or payload.get("variantUrl")
        or payload.get("variant_link")
        or payload.get("variantLink")
        or payload.get("url")
        or payload.get("link")
        or payload.get("target_url")
        or payload.get("targetUrl")
        or variant_obj.get("url")
        or variant_obj.get("link")
        or lesson_obj.get("variant_url")
        or lesson_obj.get("variantUrl")
        or payload.get("lesson_variant_url")
        or payload.get("lessonVariantUrl")
        or ""
    )
    s = str(raw_role).strip().lower()
    if s in ("teacher", "tutor", "учитель"):
        lesson_type = "teacher"
    elif s in ("student", "pupil", "learner", "ученик"):
        lesson_type = "student"
    elif payload.get("is_teacher") is True or payload.get("isTeacher") is True:
        lesson_type = "teacher"
    elif payload.get("is_student") is True or payload.get("isStudent") is True:
        lesson_type = "student"
    elif not s:
        lesson_type = "student"
    elif "teacher" in s or "tutor" in s or "учит" in s:
        lesson_type = "teacher"
    elif "student" in s or "pupil" in s or "учен" in s:
        lesson_type = "student"
    else:
        lesson_type = "student"

    if room is None or str(room).strip() == "":
        raise ValueError("В токене нет идентификатора комнаты (room_id / roomId / session_id и т.п.)")

    teacher = str(teacher).strip() or "Учитель"
    target = str(target).strip()
    group_name = str(group_name).strip()
    if lesson_type == "student":
        participant_name = target or "Ученик"
    else:
        participant_name = teacher
    session_kind = str(
        payload.get("session_kind") or payload.get("sessionKind") or payload.get("session_type") or ""
    ).strip()
    homework_assignment_id = (
        payload.get("homework_assignment_id")
        or payload.get("homeworkAssignmentId")
        or payload.get("cabinet_assignment")
        or payload.get("cabinetAssignment")
    )
    lesson_format_raw = str(
        payload.get("lesson_format") or payload.get("lessonFormat") or raw_role or ""
    ).strip()

    return {
        "room_id": str(room).strip(),
        "teacher_name": teacher,
        "target_name": target,
        "lesson_group_name": group_name,
        "lesson_type": lesson_type,
        "participant_name": participant_name,
        "lesson_level": str(lesson_level).strip().lower(),
        "lesson_subject": str(lesson_subject).strip().lower(),
        "lesson_variant_id": str(lesson_variant_id).strip() if lesson_variant_id is not None else "",
        "lesson_variant_url": str(lesson_variant_url).strip(),
        "session_kind": session_kind,
        "homework_assignment_id": str(homework_assignment_id).strip()
        if homework_assignment_id is not None and str(homework_assignment_id).strip() != ""
        else "",
        "lesson_format": lesson_format_raw,
    }


def _apply_lesson_video_collapsed_ui(normalized: dict) -> None:
    """Текст в свёрнутой колонке видео: группа, имя ученика или (для ученика) имя учителя — не номер варианта."""
    g = (normalized.get("lesson_group_name") or "").strip()
    t = (normalized.get("target_name") or "").strip()
    teacher = (normalized.get("teacher_name") or "").strip()
    role = normalized.get("lesson_type")
    if g:
        normalized["lesson_video_collapsed_label"] = g
        normalized["lesson_video_collapsed_hint"] = "Группа"
    elif t:
        normalized["lesson_video_collapsed_label"] = t
        normalized["lesson_video_collapsed_hint"] = "Ученик" if role == "teacher" else ""
    elif role == "student" and teacher:
        normalized["lesson_video_collapsed_label"] = teacher
        normalized["lesson_video_collapsed_hint"] = "Учитель"
    else:
        normalized["lesson_video_collapsed_label"] = ""
        normalized["lesson_video_collapsed_hint"] = ""


def _lesson_first_url(*candidates) -> str:
    for v in candidates:
        if v is None:
            continue
        s = str(v).strip()
        if s:
            return s
    return ""


def _merge_jitsi_jwt_query(url: str, payload: dict, lesson_type: str) -> str:
    """
    Подставляет ?jwt= из payload ЛК (если токен есть и ещё не задан в URL).
    Учитель: берёт jitsi_jwt / jitsiJwt.
    Ученик:  берёт student_jitsi_jwt / studentJitsiJwt.
    На своём Jitsi / JaaS токен несёт роль (moderator=true/false); meet.jit.si JWT не принимает.
    """
    if lesson_type == "teacher":
        tok = _lesson_first_url(
            payload.get("jitsi_jwt"),
            payload.get("jitsiJwt"),
            payload.get("jitsi_token"),
            payload.get("jitsiToken"),
        )
    else:
        tok = _lesson_first_url(
            payload.get("student_jitsi_jwt"),
            payload.get("studentJitsiJwt"),
        )
    tok = (tok or "").strip()
    if not tok:
        return url
    u = urlparse(url)
    if not u.scheme or not u.hostname:
        return url
    if not _jitsi_embed_host_allowed(u.hostname):
        return url
    qs = parse_qs(u.query, keep_blank_values=True)
    if qs.get("jwt"):
        return url  # JWT уже встроен в URL из ЛК — не перезаписываем
    qs["jwt"] = [tok]
    new_query = urlencode(qs, doseq=True)
    return urlunparse(u._replace(query=new_query))


def _generate_jitsi_jwt(room_name: str, hostname: str, *, moderator: bool, display_name: str = "") -> str:
    """
    Генерирует Jitsi JWT (HS256) для собственного сервера (lesson.itflux.ru и т.п.).
    Требует JITSI_APP_ID и JITSI_APP_SECRET в settings (из prosody-конфига Jitsi).
    moderator=True  → учитель/организатор.
    moderator=False → ученик/участник.
    """
    app_id = (getattr(django_settings, "JITSI_APP_ID", "") or "").strip()
    app_secret = (getattr(django_settings, "JITSI_APP_SECRET", "") or "").strip()
    if not app_id or not app_secret:
        return ""
    now = int(time.time())
    payload = {
        "context": {
            "user": {
                "name": display_name or ("Teacher" if moderator else "Student"),
                "moderator": moderator,
            },
        },
        "aud": "jitsi",
        "iss": app_id,
        "sub": hostname,
        "room": room_name,
        "iat": now,
        "exp": now + 7200,
    }
    try:
        return pyjwt.encode(payload, app_secret, algorithm="HS256")
    except Exception:
        logger.exception("Не удалось сгенерировать Jitsi JWT для комнаты %s", room_name)
        return ""


def _jitsi_embed_host_allowed(hostname: str) -> bool:
    """Хосты, для которых дополняем URL параметрами встраивания во фрейм."""
    h = (hostname or "").lower().rstrip(".")
    if not h:
        return False
    if h in django_settings.JITSI_EMBED_EXTRA_HOSTS:
        return True
    if h == "meet.jit.si":
        return True
    if h.endswith(".8x8.vc"):
        return True
    if h.endswith(".meet.jitsi.net"):
        return True
    return False


def enhance_jitsi_iframe_url(url: str, *, as_organizer: bool = False) -> str:
    """
    Добавляет во fragment параметры Jitsi Meet для работы во встроенном iframe:
    отключает deep linking (редирект в приложение) и экран prejoin в узкой вставке.
    Учитель: config.startAsModerator=true (модератор/организатор без отдельного входа в Jitsi),
    config.hideLoginButton — скрыть кнопку входа в аккаунт Jitsi.
    Ученик: config.startAsModerator=false — обычный участник.
    Перечисленные config.* из additions подставляются поверх одноимённых ключей во fragment.
    Не трогает URL с JSON во fragment и неизвестные хосты.
    """
    raw = (url or "").strip()
    if not raw:
        return raw
    u = urlparse(raw)
    if u.scheme not in ("https", "http") or not u.hostname:
        return raw
    if u.scheme == "http" and u.hostname not in ("localhost", "127.0.0.1"):
        return raw
    if not _jitsi_embed_host_allowed(u.hostname):
        return raw
    frag = u.fragment or ""
    if frag.strip().startswith("{"):
        return raw
    additions = [
        ("config.disableDeepLinking", "true"),
        # Отключаем lobby/waiting-room (meet.jit.si требует это явно)
        ("config.disableLobbyMode", "true"),
        ("config.lobby.enabled", "false"),
        ("config.autoKnockLobby", "false"),
        # Отключаем экран «перед звонком»
        ("config.prejoinConfig.enabled", "false"),
        ("config.prejoinPageEnabled", "false"),
        ("config.requireDisplayName", "false"),
        # Прячем кнопку входа и прочие отвлекающие элементы
        ("config.hideLoginButton", "true"),
        ("config.enableInsecureRoomNameWarning", "false"),
    ]
    additions.append(
        ("config.startAsModerator", "true" if as_organizer else "false"),
    )
    if as_organizer:
        # Дополнительные привилегии организатора
        additions += [
            ("config.enableUserRolesBasedOnToken", "false"),
            ("config.disableRemoteMute", "false"),
        ]
    override_keys = {k for k, _ in additions}
    pairs = []
    if frag:
        for part in frag.split("&"):
            part = part.strip()
            if not part or "=" not in part:
                continue
            k, v = part.split("=", 1)
            if k in override_keys:
                continue
            pairs.append((k, v))
    pairs.extend(additions)
    new_frag = "&".join(f"{k}={v}" for k, v in pairs)
    return urlunparse(u._replace(fragment=new_frag))


def lesson_video_context_from_jwt(payload: dict, lesson_type: str = "teacher") -> dict:
    """
    Ссылка на видеозвонок из ЛК (JWT). В iframe только https (или localhost) — иначе только внешняя ссылка.
    lesson_type: 'teacher' или 'student' — выбирает нужный URL из payload.
    """
    p = payload or {}

    # Чистый Jitsi-поток: берём role-specific URL, затем fallback на общий video_url.
    if lesson_type == "teacher":
        role_url = _lesson_first_url(
            p.get("teacher_video_url"),
            p.get("teacherVideoUrl"),
            p.get("video_url"),
            p.get("videoUrl"),
        )
    else:
        role_url = _lesson_first_url(
            p.get("student_video_url"),
            p.get("studentVideoUrl"),
            p.get("video_url"),
            p.get("videoUrl"),
        )

    direct = _lesson_first_url(
        role_url,
        p.get("jitsi_url"), p.get("jitsiUrl"),
    )
    role_jitsi_room = _lesson_first_url(
        p.get("teacher_jitsi_room") if lesson_type == "teacher" else p.get("student_jitsi_room"),
        p.get("teacherJitsiRoom") if lesson_type == "teacher" else p.get("studentJitsiRoom"),
        p.get("jitsi_room"),
        p.get("jitsiRoom"),
    )
    if not direct and role_jitsi_room:
        slug = role_jitsi_room.strip()
        if slug:
            direct = "https://meet.jit.si/" + quote(slug, safe="")
    if direct:
        direct = _merge_jitsi_jwt_query(direct, p, lesson_type)
    # Если ЛК не передал Jitsi JWT, но у нас есть JITSI_APP_ID+SECRET — генерируем сами.
    if direct and _jitsi_embed_host_allowed(urlparse(direct).hostname or ""):
        parsed_direct = urlparse(direct)
        qs_direct = parse_qs(parsed_direct.query, keep_blank_values=True)
        if not qs_direct.get("jwt"):
            room_name = parsed_direct.path.lstrip("/").split("/")[0]
            hostname = parsed_direct.hostname or ""
            is_moderator = lesson_type == "teacher"
            display_name = (
                p.get("teacher_name") or p.get("teacherName") or ""
                if is_moderator
                else p.get("target_name") or p.get("targetName") or p.get("student_name") or p.get("studentName") or ""
            )
            gen_jwt = _generate_jitsi_jwt(room_name, hostname, moderator=is_moderator, display_name=display_name)
            if gen_jwt:
                qs_direct["jwt"] = [gen_jwt]
                direct = urlunparse(parsed_direct._replace(query=urlencode(qs_direct, doseq=True)))
    # Извлекаем поля для Jitsi External API (домен, комната, JWT) из URL с уже добавленным токеном.
    jitsi_domain = ""
    jitsi_room_name = ""
    jitsi_ext_jwt = ""
    if direct:
        _pu = urlparse(direct)
        if _jitsi_embed_host_allowed(_pu.hostname or ""):
            jitsi_domain = _pu.hostname or ""
            jitsi_room_name = (_pu.path or "").lstrip("/").split("/")[0]
            jitsi_ext_jwt = parse_qs(_pu.query, keep_blank_values=True).get("jwt", [""])[0]

    embed_url = ""
    link_url = ""
    if direct:
        low = direct.lower()
        as_organizer = lesson_type == "teacher"
        if low.startswith("https://") or low.startswith("http://localhost") or low.startswith("http://127.0.0.1"):
            enhanced = enhance_jitsi_iframe_url(direct, as_organizer=as_organizer)
            embed_url = enhanced
            link_url = enhanced
        else:
            link_url = direct

    return {
        "lesson_video_embed_url": embed_url,
        "lesson_video_link_url": link_url,
        "jitsi_domain": jitsi_domain,
        "jitsi_room": jitsi_room_name,
        "jitsi_jwt": jitsi_ext_jwt,
    }


def _hw_assignment_id_from_payload(payload: dict) -> int | None:
    """
    id назначения ДЗ в JWT/кабинете: int/str/float; float(" 4 ") устойчивее, чем int(" 4 ").
    """
    for key in (
        "homework_assignment_id",
        "homeworkAssignmentId",
        "cabinet_assignment",
        "cabinetAssignment",
    ):
        v = payload.get(key)
        if v is None:
            continue
        s = str(v).strip()
        if not s or s.lower() in ("null", "none", "undefined"):
            continue
        try:
            return int(float(s))
        except (ValueError, TypeError, OverflowError):
            continue
    return None


def _assert_homework_token_matches_assignment(aid: int, payload: dict) -> str | None:
    """None если ок, иначе текст ошибки (для 403/400)."""
    exp = _hw_assignment_id_from_payload(payload)
    if exp is None:
        return "В токене нет id домашнего задания"
    try:
        if int(aid) != int(exp):
            return "Назначение не совпадает с токеном"
    except (ValueError, TypeError) as e:
        logger.warning("proxy homework: bad id in token aid=%s: %s", aid, e)
        return "Некорректный id в токене"
    return None


def _lk_homework_request_headers(lesson_token: str) -> dict[str, str]:
    """
    Серверный запрос к API ЛК (обход CORS в браузере).
    На стороне ЛК нужно принять JWT (см. LK_HOMEWORK_* в settings) или вебхук-секрет.
    """
    h: dict[str, str] = {"X-Lesson-Token": lesson_token}
    scheme = (getattr(django_settings, "LK_HOMEWORK_AUTHORIZATION_SCHEME", None) or "Bearer").strip()
    if scheme.lower() not in ("", "none", "off", "0", "false"):
        h["Authorization"] = f"{scheme} {lesson_token}"
    wh = (getattr(django_settings, "LESSON_WEBHOOK_SECRET", None) or "").strip() or (
        getattr(django_settings, "LESSON_SECRET", None) or ""
    ).strip()
    if wh:
        h["X-Lesson-Webhook-Secret"] = wh
    return h


def _lk_homework_url_on_lk(aid: int, suffix: str, lesson_token: str | None = None) -> str | None:
    """
    suffix: "" | "save-draft/" | "submit/" — путь на ЛК после /api/homework/assignment/<id>/
    """
    lk = _cabinet_api_base_url()
    if not lk and bool(getattr(django_settings, "DEBUG", False)):
        lk = "http://127.0.0.1:8001"
    if not lk:
        return None
    base = f"{lk}/api/homework/assignment/{int(aid)}/{suffix}"
    if (
        lesson_token
        and bool(getattr(django_settings, "LK_HOMEWORK_APPEND_TOKEN_QUERY", True))
    ):
        qn = (getattr(django_settings, "LK_HOMEWORK_TOKEN_QUERY_PARAM", None) or "token").strip()
        if qn:
            sep = "&" if "?" in base else "?"
            base = f"{base}{sep}{quote(qn, safe='')}={quote(lesson_token, safe='')}"
    return base


def _forward_to_lk_homework(
    method: str,
    aid: int,
    lesson_token: str,
    suffix: str,
    body: bytes | None,
    request_content_type: str | None = None,
) -> tuple[int, bytes, str]:
    """(status, body, content_type) — от ЛК на генератор (или ошибка 502/503)."""
    fetch_url = (getattr(django_settings, "LK_HOMEWORK_FETCH_URL", None) or "").strip()
    if not fetch_url:
        lk = _cabinet_api_base_url()
        if lk:
            fetch_url = f"{lk}/api/homework/assignment/fetch-by-token/"
    use_internal_fetch = fetch_url and method == "GET" and not (suffix or "").strip()
    if use_internal_fetch:
        url = fetch_url
        req_method = "POST"
        req_body = json.dumps({"token": lesson_token, "assignment_id": int(aid)}, ensure_ascii=False).encode(
            "utf-8"
        )
        headers = _lk_homework_request_headers(lesson_token)
        headers["Content-Type"] = "application/json; charset=utf-8"
    else:
        url = _lk_homework_url_on_lk(aid, suffix, lesson_token)
        if not url:
            return (
                503,
                '{"error":"LK_PUBLIC_URL не задан на генераторе"}'.encode("utf-8"),
                "application/json; charset=utf-8",
            )
        req_method = method
        req_body = body
        headers = _lk_homework_request_headers(lesson_token)
        if body is not None:
            if request_content_type:
                headers["Content-Type"] = request_content_type
            else:
                headers["Content-Type"] = "application/json; charset=utf-8"
        else:
            headers.setdefault("Accept", "application/json")
    import ssl as _ssl

    http_fb = url.replace("https://", "http://", 1) if url.startswith("https://") else None

    def _one(u: str) -> tuple[int, bytes, str]:
        req = urlrequest.Request(u, data=req_body, method=req_method, headers=headers)
        with urlrequest.urlopen(req, timeout=45) as resp:  # noqa: S310 — URL из настроек
            raw = resp.read() or b""
            ct = resp.headers.get("Content-Type") or "application/octet-stream"
            return (resp.status or 200), raw, ct
    try:
        return _one(url)
    except urlerror.HTTPError as e:
        try:
            raw = e.read() or b""
        except Exception:
            raw = b""
        ct = (e.headers.get("Content-Type") if e.headers else None) or "text/plain; charset=utf-8"
        return (e.code or 502), raw, ct
    except (_ssl.SSLError, _ssl.CertificateError, urlerror.URLError, OSError) as e:
        if http_fb and http_fb != url:
            try:
                return _one(http_fb)
            except Exception as e2:
                logger.warning("ЛК homework proxy SSL failed %s, HTTP fallback: %s", e, e2)
        en = (str(e) or "connection error").encode("utf-8", errors="replace")
        return 502, b'{"error":"' + en[:200].replace(b'"', b"'") + b'"}', "application/json; charset=utf-8"


@csrf_exempt
@require_http_methods(["GET"])
def api_lesson_homework_assignment(request, aid: int):
    """
    Прокси GET /api/homework/assignment/<id>/ на ЛК. Тот же origin, что страница варианта — без CORS.
    GET ?token=<JWT урока> — id назначения должен совпадать с токеном.
    """
    token = (request.GET.get("token") or "").strip()
    if not token:
        return JsonResponse({"error": "token required"}, status=400)
    try:
        payload = verify_lesson_token(token)
    except ValueError as e:
        return JsonResponse({"error": str(e)}, status=401)
    bad = _assert_homework_token_matches_assignment(aid, payload)
    if bad:
        logger.info("Прокси ДЗ: отклонение по токену assignment=%s: %s", aid, bad)
        return JsonResponse({"error": bad}, status=403)
    code, body, _ct = _forward_to_lk_homework("GET", aid, token, "", None)
    if code and code >= 400:
        logger.warning(
            "Прокси ДЗ: ответ ЛК HTTP %s assignment=%s: %s",
            code,
            aid,
            (body[:500] or b"").decode("utf-8", errors="replace"),
        )
    try:
        return HttpResponse(
            body,
            content_type="application/json; charset=utf-8",
            status=code,
        )
    except Exception:
        return HttpResponse(body, status=code, content_type="application/json; charset=utf-8")


@csrf_exempt
@require_http_methods(["POST"])
def api_lesson_homework_save_draft(request, aid: int):
    token = (request.GET.get("token") or "").strip()
    if not token:
        return JsonResponse({"error": "token required"}, status=400)
    try:
        payload = verify_lesson_token(token)
    except ValueError as e:
        return JsonResponse({"error": str(e)}, status=401)
    bad = _assert_homework_token_matches_assignment(aid, payload)
    if bad:
        return JsonResponse({"error": bad}, status=403)
    code, body, _ct = _forward_to_lk_homework(
        "POST", aid, token, "save-draft/", (request.body or b"") if (request.body or b"") else b"{}"
    )
    if code and code >= 400:
        logger.warning(
            "Прокси ДЗ save-draft: ответ ЛК HTTP %s assignment=%s: %s",
            code,
            aid,
            (body[:500] or b"").decode("utf-8", errors="replace"),
        )
    return HttpResponse(body, content_type="application/json; charset=utf-8", status=code)


@csrf_exempt
@require_http_methods(["POST"])
def api_lesson_homework_submit(request, aid: int):
    token = (request.GET.get("token") or "").strip()
    if not token:
        return JsonResponse({"error": "token required"}, status=400)
    try:
        payload = verify_lesson_token(token)
    except ValueError as e:
        return JsonResponse({"error": str(e)}, status=401)
    bad = _assert_homework_token_matches_assignment(aid, payload)
    if bad:
        return JsonResponse({"error": bad}, status=403)
    code, body, _ct = _forward_to_lk_homework(
        "POST",
        aid,
        token,
        "submit/",
        (request.body or b"") if (request.body or b"") else b"{}",
    )
    if code and code >= 400:
        logger.warning(
            "Прокси ДЗ submit: ответ ЛК HTTP %s assignment=%s: %s",
            code,
            aid,
            (body[:500] or b"").decode("utf-8", errors="replace"),
        )
    return HttpResponse(body, content_type="application/json; charset=utf-8", status=code)


@csrf_exempt
@require_http_methods(["POST"])
def api_lesson_homework_upload_answer(request, aid: int):
    """
    Прокси multipart-загрузки ответа в ЛК:
    POST /api/homework/assignment/<aid>/upload-answer/
    """
    token = (request.GET.get("token") or "").strip()
    if not token:
        return JsonResponse({"error": "token required"}, status=400)
    try:
        payload = verify_lesson_token(token)
    except ValueError as e:
        return JsonResponse({"error": str(e)}, status=401)
    bad = _assert_homework_token_matches_assignment(aid, payload)
    if bad:
        return JsonResponse({"error": bad}, status=403)
    if "file" not in request.FILES:
        return JsonResponse({"error": "file required"}, status=400)
    if not str(request.POST.get("task_number") or "").strip():
        return JsonResponse({"error": "task_number required"}, status=400)

    code, body, ct = _forward_to_lk_homework(
        "POST",
        aid,
        token,
        "upload-answer/",
        request.body or b"",
        request.META.get("CONTENT_TYPE") or "",
    )
    if code and code >= 400:
        logger.warning(
            "Прокси ДЗ upload-answer: ответ ЛК HTTP %s assignment=%s: %s",
            code,
            aid,
            (body[:500] or b"").decode("utf-8", errors="replace"),
        )
    return HttpResponse(body, content_type=ct or "application/json; charset=utf-8", status=code)


@require_http_methods(["GET"])
def api_lesson_verify(request):
    """
    Проверка JWT из ЛК без HTML-страницы (для SPA на /lesson/join/).
    GET ?token=...
    """
    token = (request.GET.get("token") or "").strip()
    if not token:
        return JsonResponse({"ok": False, "error": "Параметр token не передан"}, status=400)
    try:
        payload = verify_lesson_token(token)
        normalized = normalize_lesson_jwt_payload(payload)
    except ValueError as e:
        return JsonResponse({"ok": False, "error": str(e)}, status=401)
    if _is_lesson_session_closed(normalized["room_id"]):
        return JsonResponse(
            {
                "ok": False,
                "error": "Урок уже завершён. Запросите новую ссылку в личном кабинете.",
            },
            status=403,
        )
    _persist_lesson_room(normalized["room_id"], payload)
    video = lesson_video_context_from_jwt(payload, lesson_type=normalized.get("lesson_type", "teacher"))
    _apply_lesson_video_collapsed_ui(normalized)
    return JsonResponse(
        {
            "ok": True,
            "room_id": normalized["room_id"],
            "teacher": normalized["teacher_name"],
            "target_name": normalized["target_name"],
            "group_name": normalized.get("lesson_group_name") or "",
            "lesson_type": normalized["lesson_type"],
            "participant_name": normalized["participant_name"],
            "video_collapsed_label": normalized.get("lesson_video_collapsed_label") or "",
            "video_collapsed_hint": normalized.get("lesson_video_collapsed_hint") or "",
            "teacher_id": payload.get("teacher_id") or payload.get("teacherId"),
            "target_id": payload.get("target_id") or payload.get("targetId"),
            "video_embed_url": video["lesson_video_embed_url"],
            "video_link_url": video["lesson_video_link_url"],
        }
    )


@csrf_exempt
@require_http_methods(["POST"])
def api_lesson_teacher_joined(request):
    """
    Явный сигнал от страницы урока, что учитель открыл видеозвонок.
    После этого ЛК отправляет приглашение ученику.
    """
    try:
        data = json.loads(request.body or b"{}")
    except (json.JSONDecodeError, TypeError):
        return JsonResponse({"ok": False, "error": "invalid json"}, status=400)
    token = str((data or {}).get("token") or "").strip()
    role_override = str((data or {}).get("role") or "").strip().lower()
    if not token:
        return JsonResponse({"ok": False, "error": "token required"}, status=400)
    try:
        payload = verify_lesson_token(token)
        normalized = normalize_lesson_jwt_payload(payload)
    except ValueError as e:
        return JsonResponse({"ok": False, "error": str(e)}, status=401)
    if role_override in ("teacher", "tutor"):
        normalized["lesson_type"] = "teacher"
    elif role_override in ("student", "pupil"):
        normalized["lesson_type"] = "student"
    if normalized.get("lesson_type") != "teacher":
        return JsonResponse({"ok": False, "error": "teacher token required"}, status=400)
    lk_extra = {
        "room_id": normalized.get("room_id"),
        "target_id": payload.get("target_id") or payload.get("targetId"),
        "teacher_id": payload.get("teacher_id") or payload.get("teacherId"),
    }
    delivered, notify_detail = notify_lk_teacher_joined(token, extra=lk_extra)
    if not delivered:
        return JsonResponse({"ok": False, "error": "notify failed", "detail": notify_detail}, status=502)
    return JsonResponse({"ok": True})


@csrf_exempt
@require_http_methods(["POST"])
def api_lesson_session_close(request):
    """
    Завершение сессии урока: после вызова повторный вход в ту же комнату по JWT запрещён.
    Вызывается со страницы урока (выход из Jitsi, кнопка «Завершить урок»).
    Причина page_unload (обновление/закрытие вкладки) игнорируется — учитель может вернуться.
    """
    try:
        data = json.loads(request.body or b"{}")
    except (json.JSONDecodeError, TypeError):
        return JsonResponse({"ok": False, "error": "invalid json"}, status=400)
    reason = str((data or {}).get("reason") or "").strip()
    # Обновление страницы не завершает урок — только явное действие учителя
    if reason == "page_unload":
        return JsonResponse({"ok": True, "closed": False, "skipped": True})
    token = str((data or {}).get("token") or "").strip()
    if not token:
        return JsonResponse({"ok": False, "error": "token required"}, status=400)
    try:
        payload = verify_lesson_token(token)
        normalized = normalize_lesson_jwt_payload(payload)
    except ValueError as e:
        return JsonResponse({"ok": False, "error": str(e)}, status=401)
    room_id = normalized["room_id"]
    first_close = mark_lesson_session_closed(room_id)
    if first_close:
        _broadcast_lesson_session_closed(room_id)
    if first_close and normalized.get("lesson_type") == "teacher":
        _ok_tl, _err_tl = notify_lk_teacher_left(
            token,
            extra={
                "room_id": normalized.get("room_id"),
                "target_id": payload.get("target_id") or payload.get("targetId"),
                "teacher_id": payload.get("teacher_id") or payload.get("teacherId"),
            },
        )
        if not _ok_tl:
            logger.warning("ЛК teacher-left не доставлен: %s", _err_tl)
    return JsonResponse({"ok": True, "closed": True})


def _lesson_results_payload(room_id: str, variant_id: int | None = None) -> list[dict]:
    qs = LessonStudentResult.objects.filter(room_id=str(room_id or "").strip()[:200])
    if variant_id is not None:
        qs = qs.filter(variant_id=max(0, int(variant_id)))
    rows = []
    for r in qs.order_by("student", "id"):
        rows.append(
            {
                "student": r.student,
                "teacher": r.teacher,
                "room_id": r.room_id,
                "variant_id": r.variant_id,
                "total_tasks": r.total_tasks,
                "correct_count": r.correct_count,
                "wrong_count": r.wrong_count,
                "empty_count": r.empty_count,
                "teacher_comment": r.teacher_comment,
                "updated_at": r.updated_at.isoformat() if r.updated_at else "",
            }
        )
    return rows


def _save_lesson_finalize_snapshot(room_id: str, results: list[dict]) -> None:
    rid = str(room_id or "").strip()[:200]
    if not rid:
        return
    try:
        room = LessonRoom.objects.filter(room_id=rid).only("id", "jwt_payload").first()
        if not room:
            return
        payload = dict(room.jwt_payload or {})
        payload["_lesson_finalized_at"] = timezone.now().isoformat()
        payload["_lesson_final_results"] = results
        room.jwt_payload = payload
        room.save(update_fields=["jwt_payload", "updated_at"])
    except Exception:
        logger.exception("Не удалось сохранить итоговый snapshot урока для %s", rid)


@csrf_exempt
@require_http_methods(["POST"])
def api_lesson_finalize(request):
    """
    Явное завершение урока учителем: закрывает комнату и возвращает финальные результаты учеников.
    """
    try:
        data = json.loads(request.body or b"{}")
    except (json.JSONDecodeError, TypeError):
        return JsonResponse({"ok": False, "error": "invalid json"}, status=400)

    token = str((data or {}).get("token") or "").strip()
    role_override = str((data or {}).get("role") or "").strip().lower()
    if not token:
        return JsonResponse({"ok": False, "error": "token required"}, status=400)
    try:
        payload = verify_lesson_token(token)
        normalized = normalize_lesson_jwt_payload(payload)
    except ValueError as e:
        return JsonResponse({"ok": False, "error": str(e)}, status=401)

    lesson_type = normalized.get("lesson_type")
    if role_override in ("teacher", "tutor"):
        lesson_type = "teacher"
    elif role_override in ("student", "pupil"):
        lesson_type = "student"
    if lesson_type != "teacher":
        return JsonResponse({"ok": False, "error": "teacher token required"}, status=400)

    room_id = normalized["room_id"]
    variant_raw = (
        payload.get("variant_id")
        or payload.get("variantId")
        or payload.get("lesson_variant_id")
        or payload.get("lessonVariantId")
        or normalized.get("lesson_variant_id")
    )
    try:
        variant_id = int(variant_raw) if variant_raw not in (None, "") else None
    except (TypeError, ValueError):
        variant_id = None

    first_close = mark_lesson_session_closed(room_id)
    if first_close:
        _broadcast_lesson_session_closed(room_id)

    results = _lesson_results_payload(room_id, variant_id=variant_id)
    _save_lesson_finalize_snapshot(room_id, results)

    # Запись «Урок» в ЛК (Результаты учеников): POST /api/lesson/teacher-left/
    _ok_tl, _err_tl = notify_lk_teacher_left(
        token,
        extra={
            "room_id": room_id,
            "target_id": payload.get("target_id") or payload.get("targetId"),
            "teacher_id": payload.get("teacher_id") or payload.get("teacherId"),
        },
    )
    if not _ok_tl:
        logger.warning("ЛК teacher-left (finalize) не доставлен: %s", _err_tl)

    return JsonResponse(
        {
            "ok": True,
            "closed": True,
            "already_closed": not first_close,
            "room_id": room_id,
            "variant_id": variant_id,
            "results": results,
        }
    )


def _normalize_lesson_task_number(value) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""
    if len(raw) >= 2 and raw[0] == "t" and raw[1:].isdigit():
        return raw[:32]
    digits = re.sub(r"[^\d]+", "", raw)
    return (digits or raw)[:32]


def _normalize_lesson_answer(value) -> str:
    text = strip_tags(str(value or "")).replace("\xa0", " ")
    text = re.sub(r"\s+", "", text)
    return text.lower().strip()


def _get_expected_answer_for_variant_task(variant_id: int, task_number_key: str) -> str:
    """Номер задания в UI = TaskList.task_number; fallback — порядок в варианте (order). Ключ t<id> = Task.id в варианте."""
    if variant_id <= 0 or not task_number_key:
        return ""
    if len(task_number_key) >= 2 and task_number_key[0] == "t" and task_number_key[1:].isdigit():
        tid = int(task_number_key[1:])
        vc = (
            VariantContent.objects.select_related("task")
            .filter(variant_id=variant_id, task_id=tid)
            .first()
        )
        if vc and vc.task:
            return str(getattr(vc.task, "answer", "") or "")
        return ""
    if task_number_key.isdigit():
        tn = int(task_number_key)
        vc = (
            VariantContent.objects.select_related("task")
            .filter(variant_id=variant_id, task__task__task_number=tn)
            .first()
        )
        if vc and vc.task:
            return str(getattr(vc.task, "answer", "") or "")
        if 1 <= tn <= 500:
            vc2 = (
                VariantContent.objects.select_related("task")
                .filter(variant_id=variant_id, order=tn)
                .first()
            )
            if vc2 and vc2.task:
                return str(getattr(vc2.task, "answer", "") or "")
    return ""


def _upsert_lesson_student_result(
    *,
    room_id: str,
    variant_id: int,
    teacher_name: str,
    student_name: str,
    task_number: str,
    answer_text: str,
    save_payload: dict | None = None,
):
    task_number = _normalize_lesson_task_number(task_number)
    student_name = str(student_name or "").strip()[:200]
    teacher_name = str(teacher_name or "").strip()[:200]
    room_id = str(room_id or "").strip()[:200]
    variant_id = max(0, int(variant_id or 0))

    expected_answer = _get_expected_answer_for_variant_task(variant_id, task_number)

    normalized_student = _normalize_lesson_answer(answer_text)
    normalized_expected = _normalize_lesson_answer(expected_answer)
    is_empty = normalized_student == ""
    is_correct = bool(normalized_student) and bool(normalized_expected) and normalized_student == normalized_expected

    payload = dict(save_payload or {})
    payload.setdefault("source", "api_lesson_student_answer")

    answer_row, created = LessonStudentsAnswer.objects.update_or_create(
        room_id=room_id,
        variant_id=variant_id,
        task_number=task_number,
        student=student_name,
        defaults={
            "teacher": teacher_name,
            "answer": str(answer_text or ""),
            "is_correct": is_correct,
            "is_empty": is_empty,
            "payload": payload,
        },
    )

    answers_qs = LessonStudentsAnswer.objects.filter(
        room_id=room_id,
        variant_id=variant_id,
        student=student_name,
    )
    total_tasks = VariantContent.objects.filter(variant_id=variant_id).count() if variant_id > 0 else 0
    if total_tasks <= 0:
        total_tasks = answers_qs.count()

    correct_count = answers_qs.filter(is_correct=True).count()
    non_empty_count = answers_qs.filter(is_empty=False).count()
    empty_count = max(total_tasks - non_empty_count, 0)
    wrong_count = max(total_tasks - correct_count, 0)

    prev = LessonStudentResult.objects.filter(
        room_id=room_id, variant_id=variant_id, student=student_name
    ).only("teacher_comment", "payload").first()
    teacher_comment = prev.teacher_comment if prev else ""
    rollup_payload = dict(prev.payload or {}) if prev and isinstance(prev.payload, dict) else {}
    rollup_payload.update(
        {
            "last_task_number": task_number,
            "source": "lesson_result_rollup",
        }
    )
    LessonStudentResult.objects.update_or_create(
        room_id=room_id,
        variant_id=variant_id,
        student=student_name,
        defaults={
            "teacher": teacher_name,
            "total_tasks": total_tasks,
            "correct_count": correct_count,
            "wrong_count": wrong_count,
            "empty_count": empty_count,
            "teacher_comment": teacher_comment,
            "payload": rollup_payload,
        },
    )
    return answer_row, created


@csrf_exempt
@require_http_methods(["POST"])
def api_lesson_student_answer(request):
    """Сохранение ответа ученика и пересчёт итогов урока в БД."""
    try:
        data = json.loads(request.body or b"{}")
    except (json.JSONDecodeError, TypeError):
        return JsonResponse({"ok": False, "error": "invalid json"}, status=400)

    if not isinstance(data, dict):
        return JsonResponse({"ok": False, "error": "invalid payload"}, status=400)

    lesson_token = str(data.get("lesson_token") or "").strip()
    room_id = str(data.get("room_id") or "").strip()
    teacher_name = str(data.get("teacher") or "").strip()
    student_name = str(data.get("student") or "").strip()
    task_id_raw = data.get("task_id")
    task_number = ""
    if task_id_raw is not None and str(task_id_raw).strip() != "":
        try:
            tid = int(task_id_raw)
            if tid > 0:
                task_number = f"t{tid}"[:32]
        except (TypeError, ValueError):
            pass
    if not task_number:
        task_number = _normalize_lesson_task_number(data.get("task_number") or data.get("task"))
    answer_text = str(data.get("answer") or "")
    variant_raw = data.get("variant_id")
    extra_payload = data.get("payload")

    if lesson_token:
        try:
            token_payload = verify_lesson_token(lesson_token)
            normalized = normalize_lesson_jwt_payload(token_payload)
            room_id = room_id or str(normalized.get("room_id") or "").strip()
            if not teacher_name:
                teacher_name = str(normalized.get("teacher_name") or "").strip()
        except ValueError as exc:
            return JsonResponse({"ok": False, "error": str(exc)}, status=401)

    if not room_id:
        return JsonResponse({"ok": False, "error": "room_id required"}, status=400)
    if not student_name:
        return JsonResponse({"ok": False, "error": "student required"}, status=400)

    try:
        variant_id = int(variant_raw or 0)
    except (TypeError, ValueError):
        variant_id = 0
    if variant_id < 0:
        variant_id = 0

    save_payload = extra_payload if isinstance(extra_payload, dict) else {}
    save_payload.update({"raw": {"variant_id": variant_raw, "task_number": task_number}})

    try:
        row, created = _upsert_lesson_student_result(
            room_id=room_id,
            variant_id=variant_id,
            teacher_name=teacher_name,
            student_name=student_name,
            task_number=task_number,
            answer_text=answer_text,
            save_payload=save_payload,
        )
    except Exception:
        logger.exception("Не удалось сохранить LessonStudentsAnswer")
        return JsonResponse({"ok": False, "error": "db_save_failed"}, status=500)

    return JsonResponse(
        {
            "ok": True,
            "id": row.id,
            "created": created,
        }
    )


@require_http_methods(["GET"])
def api_lesson_results(request):
    """Итоги урока по ученикам: всего задач/правильные/неправильные/пустые/комментарий."""
    token = str(request.GET.get("token") or request.GET.get("lesson_token") or "").strip()
    room_id = str(request.GET.get("room_id") or "").strip()
    variant_raw = request.GET.get("variant_id")
    role_override = str(request.GET.get("role") or "").strip().lower()
    normalized = None
    lesson_type = ""
    student_name_filter = ""
    if token:
        try:
            payload = verify_lesson_token(token)
            normalized = normalize_lesson_jwt_payload(payload)
            room_id = room_id or str(normalized.get("room_id") or "").strip()
        except ValueError as exc:
            return JsonResponse({"ok": False, "error": str(exc)}, status=401)
        lesson_type = str(normalized.get("lesson_type") or "")
        if role_override in ("teacher", "tutor"):
            lesson_type = "teacher"
        elif role_override in ("student", "pupil"):
            lesson_type = "student"
        if lesson_type not in ("teacher", "student"):
            return JsonResponse({"ok": False, "error": "invalid role"}, status=403)
        if lesson_type == "student":
            student_name_filter = str(
                normalized.get("participant_name")
                or normalized.get("target_name")
                or ""
            ).strip()[:200]
    if not room_id:
        return JsonResponse({"ok": False, "error": "room_id required"}, status=400)
    qs = LessonStudentResult.objects.filter(room_id=room_id[:200])
    if student_name_filter:
        qs = qs.filter(student=student_name_filter)
    try:
        variant_id = int(variant_raw) if variant_raw not in (None, "") else None
    except (TypeError, ValueError):
        variant_id = None
    if variant_id is not None:
        vid = max(0, variant_id)
        if vid > 0:
            # Записи с variant_id=0 — до синка варианта в LessonRoom по WS
            qs = qs.filter(Q(variant_id=vid) | Q(variant_id=0))
        else:
            qs = qs.filter(variant_id=0)
    ordered = list(qs.order_by("student", "-variant_id", "id"))
    if variant_id is not None and max(0, variant_id) > 0:
        seen = set()
        deduped = []
        for r in ordered:
            if r.student in seen:
                continue
            seen.add(r.student)
            deduped.append(r)
        ordered = deduped
    rows = [
        {
            "student": r.student,
            "teacher": r.teacher,
            "room_id": r.room_id,
            "variant_id": r.variant_id,
            "total_tasks": r.total_tasks,
            "correct_count": r.correct_count,
            "wrong_count": r.wrong_count,
            "empty_count": r.empty_count,
            "teacher_comment": r.teacher_comment,
            "updated_at": r.updated_at.isoformat() if r.updated_at else "",
        }
        for r in ordered
    ]
    return JsonResponse({"ok": True, "results": rows})


@require_http_methods(["GET"])
def api_lesson_task_answers(request):
    """Все ответы учеников по задачам в комнате (для синхронизации UI учителя с БД)."""
    token = str(request.GET.get("token") or request.GET.get("lesson_token") or "").strip()
    room_id = str(request.GET.get("room_id") or "").strip()
    variant_raw = request.GET.get("variant_id")
    role_override = str(request.GET.get("role") or "").strip().lower()
    if not token:
        return JsonResponse({"ok": False, "error": "token required"}, status=400)
    try:
        _payload = verify_lesson_token(token)
        normalized = normalize_lesson_jwt_payload(_payload)
        room_id = room_id or str(normalized.get("room_id") or "").strip()
    except ValueError as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=401)
    if not room_id:
        return JsonResponse({"ok": False, "error": "room_id required"}, status=400)
    lesson_type = str(normalized.get("lesson_type") or "")
    student_name_filter = ""
    if role_override in ("teacher", "tutor"):
        lesson_type = "teacher"
    elif role_override in ("student", "pupil"):
        lesson_type = "student"
    if lesson_type not in ("teacher", "student"):
        return JsonResponse({"ok": False, "error": "invalid role"}, status=403)
    if lesson_type == "student":
        student_name_filter = str(
            normalized.get("participant_name")
            or normalized.get("target_name")
            or ""
        ).strip()[:200]

    try:
        variant_id = int(variant_raw) if variant_raw not in (None, "") else None
    except (TypeError, ValueError):
        variant_id = None

    qs = LessonStudentsAnswer.objects.filter(room_id=room_id[:200])
    if student_name_filter:
        qs = qs.filter(student=student_name_filter)
    if variant_id is not None:
        vid = max(0, variant_id)
        if vid > 0:
            qs = qs.filter(Q(variant_id=vid) | Q(variant_id=0))
        else:
            qs = qs.filter(variant_id=0)
    ordered_ans = list(qs.order_by("student", "task_number", "-variant_id", "id"))
    if variant_id is not None and max(0, variant_id) > 0:
        seen_keys = set()
        deduped_ans = []
        for a in ordered_ans:
            key = (a.student, a.task_number)
            if key in seen_keys:
                continue
            seen_keys.add(key)
            deduped_ans.append(a)
        ordered_ans = deduped_ans
    answers = [
        {
            "student": a.student,
            "task_number": a.task_number,
            "answer": a.answer,
            "is_correct": a.is_correct,
            "is_empty": a.is_empty,
            "updated_at": a.updated_at.isoformat() if a.updated_at else "",
        }
        for a in ordered_ans
    ]
    return JsonResponse({"ok": True, "answers": answers})


@csrf_exempt
@require_http_methods(["POST"])
def api_lesson_student_comment(request):
    """Комментарий учителя к ученику в уроке."""
    try:
        data = json.loads(request.body or b"{}")
    except (json.JSONDecodeError, TypeError):
        return JsonResponse({"ok": False, "error": "invalid json"}, status=400)
    if not isinstance(data, dict):
        return JsonResponse({"ok": False, "error": "invalid payload"}, status=400)

    lesson_token = str(data.get("lesson_token") or data.get("token") or "").strip()
    room_id = str(data.get("room_id") or "").strip()
    teacher_name = str(data.get("teacher") or "").strip()
    student_name = str(data.get("student") or "").strip()
    comment = str(data.get("teacher_comment") or data.get("comment") or "")
    variant_raw = data.get("variant_id")

    if lesson_token:
        try:
            token_payload = verify_lesson_token(lesson_token)
            normalized = normalize_lesson_jwt_payload(token_payload)
            room_id = room_id or str(normalized.get("room_id") or "").strip()
            teacher_name = teacher_name or str(normalized.get("teacher_name") or "").strip()
        except ValueError as exc:
            return JsonResponse({"ok": False, "error": str(exc)}, status=401)

    if not room_id:
        return JsonResponse({"ok": False, "error": "room_id required"}, status=400)
    if not student_name:
        return JsonResponse({"ok": False, "error": "student required"}, status=400)
    try:
        variant_id = int(variant_raw or 0)
    except (TypeError, ValueError):
        variant_id = 0
    variant_id = max(0, variant_id)

    row, _ = LessonStudentResult.objects.get_or_create(
        room_id=room_id[:200],
        variant_id=variant_id,
        student=student_name[:200],
        defaults={"teacher": teacher_name[:200]},
    )
    row.teacher = teacher_name[:200] or row.teacher
    row.teacher_comment = comment
    row.save(update_fields=["teacher", "teacher_comment", "updated_at"])
    return JsonResponse({"ok": True, "id": row.id})


def _lesson_report_pdf_response(request, room_id: str, variant_id: int | None, results, answers) -> HttpResponse:
    """PDF-отчёт по уроку (WeasyPrint)."""
    def _format_mmss(seconds: int | None) -> str:
        if seconds is None:
            return "—"
        s = max(0, int(seconds))
        mm, ss = divmod(s, 60)
        return f"{mm:02d}:{ss:02d}"

    by_task_id = {}
    by_task_number = {}
    if variant_id and int(variant_id) > 0:
        vcs = (
            VariantContent.objects.select_related("task", "task__task", "task__subtopic")
            .filter(variant_id=int(variant_id))
            .order_by("order", "id")
        )
        for vc in vcs:
            t = vc.task
            if not t:
                continue
            disp_num = ""
            try:
                disp_num = str(int(getattr(getattr(t, "task", None), "task_number", 0) or 0))
            except (TypeError, ValueError):
                disp_num = ""
            if not disp_num:
                disp_num = str(int(getattr(vc, "order", 0) or 0))
            meta = {
                "display_number": disp_num,
                "subtopic_title": str(getattr(getattr(t, "subtopic", None), "title", "") or "").strip(),
                "correct_answer": str(getattr(t, "answer", "") or "").strip(),
            }
            by_task_id[int(t.id)] = meta
            if disp_num and disp_num not in by_task_number:
                by_task_number[disp_num] = meta

    def _answer_meta(raw_task_number: str) -> dict:
        raw = str(raw_task_number or "").strip()
        if not raw:
            return {"display_number": "—", "subtopic_title": "", "correct_answer": ""}
        if len(raw) >= 2 and raw[0] == "t" and raw[1:].isdigit():
            tid = int(raw[1:])
            m = by_task_id.get(tid)
            if m:
                return m
            return {"display_number": f"#{tid}", "subtopic_title": "", "correct_answer": ""}
        digits = re.sub(r"[^\d]+", "", raw)
        if digits:
            m = by_task_number.get(digits)
            if m:
                return m
            return {"display_number": digits, "subtopic_title": "", "correct_answer": ""}
        return {"display_number": raw[:32], "subtopic_title": "", "correct_answer": ""}

    def _elapsed_seconds(payload: dict) -> int | None:
        if not isinstance(payload, dict):
            return None
        direct = payload.get("elapsed_seconds")
        if direct is None and isinstance(payload.get("raw"), dict):
            direct = payload["raw"].get("elapsed_seconds")
        if direct is None:
            return None
        try:
            v = int(direct)
        except (TypeError, ValueError):
            return None
        return max(0, v)

    by_student: dict[str, list] = {}
    for a in answers:
        student = str(a.student or "").strip() or "student"
        meta = _answer_meta(a.task_number)
        elapsed = _elapsed_seconds(a.payload if isinstance(a.payload, dict) else {})
        by_student.setdefault(student, []).append(
            {
                "task_number": meta["display_number"],
                "subtopic_title": meta["subtopic_title"],
                "answer": str(a.answer or ""),
                "correct_answer": str(meta["correct_answer"] or ""),
                "is_correct": bool(a.is_correct),
                "is_empty": bool(a.is_empty),
                "elapsed_seconds": elapsed,
                "elapsed_mmss": _format_mmss(elapsed),
                "updated_at": a.updated_at,
            }
        )

    answers_sections = []
    for student_name in sorted(by_student.keys()):
        rows = sorted(by_student[student_name], key=lambda r: (str(r["task_number"]), str(r["updated_at"] or "")))
        student_elapsed = None
        for r in rows:
            es = r.get("elapsed_seconds")
            if es is None:
                continue
            student_elapsed = es if student_elapsed is None else max(student_elapsed, es)
        answers_sections.append(
            {
                "student": student_name,
                "rows": rows,
                "total_elapsed_seconds": student_elapsed,
                "total_elapsed_mmss": _format_mmss(student_elapsed),
                "wrong_rows": [r for r in rows if not bool(r.get("is_correct"))],
            }
        )
    context = {
        "room_id": room_id,
        "variant_id": variant_id,
        "generated_at": timezone.now().strftime("%d.%m.%Y %H:%M"),
        "results": results,
        "answers_sections": answers_sections,
    }
    html_string = render_to_string("lesson_report_pdf.html", context)
    base_url = request.build_absolute_uri("/")
    if not _WEASYPRINT_OK:
        return HttpResponse("PDF недоступен: WeasyPrint не установлен", status=503, content_type="text/plain; charset=utf-8")
    try:
        pdf = WeasyHTML(string=html_string, base_url=base_url).write_pdf()
    except Exception as e:
        logger.exception("lesson report PDF failed: %s", e)
        return HttpResponse("Ошибка генерации PDF", status=500, content_type="text/plain; charset=utf-8")
    safe_room = re.sub(r"[^a-zA-Z0-9_-]", "_", room_id)[:64] or "room"
    response = HttpResponse(pdf, content_type="application/pdf")
    response["Content-Disposition"] = f'attachment; filename="lesson_report_{safe_room}.pdf"'
    return response


@require_http_methods(["GET"])
def api_lesson_report_download(request):
    """
    Скачать отчёт по уроку:
      - format=zip (по умолчанию): архив CSV — summary, details, по ученикам;
      - format=pdf: один PDF-файл с таблицей и ответами.
    """
    token = str(request.GET.get("token") or request.GET.get("lesson_token") or "").strip()
    room_id = str(request.GET.get("room_id") or "").strip()
    variant_raw = request.GET.get("variant_id")
    role_override = str(request.GET.get("role") or "").strip().lower()

    normalized = None
    payload = None
    if token:
        try:
            payload = verify_lesson_token(token)
            normalized = normalize_lesson_jwt_payload(payload)
            room_id = room_id or str(normalized.get("room_id") or "").strip()
        except ValueError as exc:
            return JsonResponse({"ok": False, "error": str(exc)}, status=401)
    if not room_id:
        return JsonResponse({"ok": False, "error": "room_id required"}, status=400)

    lesson_type = (normalized or {}).get("lesson_type", "")
    if role_override in ("teacher", "tutor"):
        lesson_type = "teacher"
    elif role_override in ("student", "pupil"):
        lesson_type = "student"
    if token and lesson_type != "teacher":
        return JsonResponse({"ok": False, "error": "teacher token required"}, status=403)

    variant_guess = (
        variant_raw
        or (payload or {}).get("variant_id")
        or (payload or {}).get("variantId")
        or (payload or {}).get("lesson_variant_id")
        or (payload or {}).get("lessonVariantId")
        or (normalized or {}).get("lesson_variant_id")
    )
    try:
        variant_id = int(variant_guess) if variant_guess not in (None, "") else None
    except (TypeError, ValueError):
        variant_id = None

    results_qs = LessonStudentResult.objects.filter(room_id=room_id[:200])
    answers_qs = LessonStudentsAnswer.objects.filter(room_id=room_id[:200])
    if variant_id is not None:
        variant_id = max(0, variant_id)
        results_qs = results_qs.filter(variant_id=variant_id)
        answers_qs = answers_qs.filter(variant_id=variant_id)

    results = list(results_qs.order_by("student", "id"))
    answers = list(answers_qs.order_by("student", "task_number", "id"))

    fmt = (request.GET.get("format") or "zip").strip().lower()
    if fmt == "pdf":
        return _lesson_report_pdf_response(request, room_id, variant_id, results, answers)

    summary_buf = io.StringIO()
    sw = csv.writer(summary_buf)
    sw.writerow(
        [
            "student",
            "teacher",
            "room_id",
            "variant_id",
            "total_tasks",
            "correct_count",
            "wrong_count",
            "empty_count",
            "teacher_comment",
            "updated_at",
        ]
    )
    for r in results:
        sw.writerow(
            [
                r.student,
                r.teacher,
                r.room_id,
                r.variant_id,
                r.total_tasks,
                r.correct_count,
                r.wrong_count,
                r.empty_count,
                r.teacher_comment,
                r.updated_at.isoformat() if r.updated_at else "",
            ]
        )

    details_buf = io.StringIO()
    dw = csv.writer(details_buf)
    dw.writerow(
        [
            "student",
            "teacher",
            "room_id",
            "variant_id",
            "task_number",
            "answer",
            "is_correct",
            "is_empty",
            "updated_at",
        ]
    )
    for a in answers:
        dw.writerow(
            [
                a.student,
                a.teacher,
                a.room_id,
                a.variant_id,
                a.task_number,
                a.answer,
                1 if a.is_correct else 0,
                1 if a.is_empty else 0,
                a.updated_at.isoformat() if a.updated_at else "",
            ]
        )

    zip_buf = io.BytesIO()
    with zipfile.ZipFile(zip_buf, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("summary.csv", summary_buf.getvalue().encode("utf-8-sig"))
        zf.writestr("details_all.csv", details_buf.getvalue().encode("utf-8-sig"))
        by_student: dict[str, list] = {}
        for a in answers:
            by_student.setdefault(str(a.student or "").strip() or "student", []).append(a)
        for student_name, rows in by_student.items():
            student_buf = io.StringIO()
            cw = csv.writer(student_buf)
            cw.writerow(
                [
                    "student",
                    "task_number",
                    "answer",
                    "is_correct",
                    "is_empty",
                    "updated_at",
                ]
            )
            for a in rows:
                cw.writerow(
                    [
                        a.student,
                        a.task_number,
                        a.answer,
                        1 if a.is_correct else 0,
                        1 if a.is_empty else 0,
                        a.updated_at.isoformat() if a.updated_at else "",
                    ]
                )
            safe_student = re.sub(r"[^a-zA-Z0-9_\-]+", "_", student_name).strip("_") or "student"
            zf.writestr(f"students/{safe_student}.csv", student_buf.getvalue().encode("utf-8-sig"))

    zip_name = f"lesson_report_{re.sub(r'[^a-zA-Z0-9_-]', '_', room_id)[:64] or 'room'}.zip"
    response = HttpResponse(zip_buf.getvalue(), content_type="application/zip")
    response["Content-Disposition"] = f'attachment; filename="{zip_name}"'
    return response


@csrf_exempt
@require_http_methods(["POST"])
def api_lesson_attachment_upload(request):
    """
    Загрузка файла-решения от ученика (изображение, файл, голосовое).
    POST multipart: поля lesson_token, task_number, file; опционально task_id (id задания в варианте — Task.id).
    Файл хранится в MEDIA_ROOT/lesson_attachments/<safe_room>/<file_token><ext>.
    """
    lesson_token = (
        request.POST.get("lesson_token")
        or request.META.get("HTTP_X_LESSON_TOKEN", "")
    ).strip()
    if not lesson_token:
        return JsonResponse({"ok": False, "error": "lesson_token required"}, status=400)
    try:
        payload = verify_lesson_token(lesson_token)
        normalized = normalize_lesson_jwt_payload(payload)
    except ValueError as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=401)

    uploaded = request.FILES.get("file")
    if not uploaded:
        return JsonResponse({"ok": False, "error": "field 'file' required"}, status=400)

    max_bytes = 20 * 1024 * 1024  # 20 MB
    if uploaded.size > max_bytes:
        return JsonResponse({"ok": False, "error": "Файл слишком большой (макс. 20 МБ)"}, status=400)

    room_id = normalized["room_id"]
    safe_room = re.sub(r"[^a-zA-Z0-9_-]", "_", room_id)[:64]
    file_token = secrets.token_urlsafe(32)
    orig_ext = os.path.splitext(uploaded.name)[1][:10].lower()
    filename = f"{file_token}{orig_ext}"

    attach_dir = os.path.join(django_settings.MEDIA_ROOT, "lesson_attachments", safe_room)
    os.makedirs(attach_dir, exist_ok=True)

    filepath = os.path.join(attach_dir, filename)
    with open(filepath, "wb") as f:
        for chunk in uploaded.chunks():
            f.write(chunk)

    _tid_raw = (request.POST.get("task_id") or "").strip()
    task_id_meta = ""
    if _tid_raw.isdigit():
        task_id_meta = _tid_raw
    meta = {
        "original_name": uploaded.name[:200],
        "content_type": uploaded.content_type or "application/octet-stream",
        "room_id": room_id,
        "safe_room": safe_room,
        "participant": normalized.get("participant_name", ""),
        "task_number": request.POST.get("task_number", ""),
        "task_id": task_id_meta,
        "created_at": time.time(),
    }
    with open(filepath + ".meta.json", "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False)

    serve_url = f"/api/lesson/attachment/{safe_room}/{filename}"
    task_num = str(request.POST.get("task_number", "") or "").strip()
    student_label = str(
        normalized.get("participant_name")
        or normalized.get("target_name")
        or ""
    ).strip() or "Ученик"
    try:
        from asgiref.sync import async_to_sync
        from channels.layers import get_channel_layer

        channel_layer = get_channel_layer()
        if channel_layer and room_id:
            ws_payload = {
                "type": "student_attachment",
                "task_number": task_num,
                "name": student_label,
                "url": serve_url,
                "filename": uploaded.name[:200],
            }
            if task_id_meta:
                ws_payload["task_id"] = task_id_meta
            async_to_sync(channel_layer.group_send)(
                f"lesson_{room_id}",
                {
                    "type": "lesson_message",
                    "payload": ws_payload,
                },
            )
    except Exception:
        logger.exception("WS broadcast student_attachment failed for room %s", room_id)

    return JsonResponse({"ok": True, "url": serve_url, "filename": uploaded.name[:200]})


@require_http_methods(["GET"])
def api_lesson_attachments_list(request):
    """Список вложений комнаты (для учителя после перезагрузки)."""
    token = str(request.GET.get("token") or request.GET.get("lesson_token") or "").strip()
    if not token:
        return JsonResponse({"ok": False, "error": "token required"}, status=400)
    try:
        payload = verify_lesson_token(token)
        normalized = normalize_lesson_jwt_payload(payload)
    except ValueError as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=401)
    role_override = str(request.GET.get("role") or "").strip().lower()
    lesson_type = str(normalized.get("lesson_type") or "")
    if role_override in ("teacher", "tutor"):
        lesson_type = "teacher"
    elif role_override in ("student", "pupil"):
        lesson_type = "student"
    if lesson_type != "teacher":
        return JsonResponse({"ok": False, "error": "teacher token required"}, status=403)

    room_id = str(normalized.get("room_id") or "").strip()
    if not room_id:
        return JsonResponse({"ok": False, "error": "room_id missing in token"}, status=400)
    safe_room = re.sub(r"[^a-zA-Z0-9_-]", "_", room_id)[:64]
    attach_dir = os.path.join(django_settings.MEDIA_ROOT, "lesson_attachments", safe_room)
    items = []
    if os.path.isdir(attach_dir):
        for fn in sorted(os.listdir(attach_dir)):
            if not fn.endswith(".meta.json"):
                continue
            stem = fn[:-10]
            meta_path = os.path.join(attach_dir, fn)
            try:
                with open(meta_path, encoding="utf-8") as mf:
                    meta = json.load(mf)
            except Exception:
                continue
            if not stem or ".." in stem or "/" in stem:
                continue
            serve_url = f"/api/lesson/attachment/{safe_room}/{stem}"
            item = {
                "task_number": str(meta.get("task_number") or ""),
                "student": str(meta.get("participant") or ""),
                "url": serve_url,
                "filename": str(meta.get("original_name") or ""),
            }
            tid = str(meta.get("task_id") or "").strip()
            if tid:
                item["task_id"] = tid
            items.append(item)
    return JsonResponse({"ok": True, "items": items})


def api_lesson_attachment_serve(request, safe_room, filename):
    """
    Отдача файла вложения. Доступ только участникам урока (валидный lesson_token).
    lesson_token передаётся query-параметром ?t=...
    """
    # Проверяем токен
    lesson_token = (request.GET.get("t") or "").strip()
    if not lesson_token:
        return HttpResponse("Нет доступа: передайте ?t=<lesson_token>", status=403, content_type="text/plain")
    try:
        payload = verify_lesson_token(lesson_token)
        normalized = normalize_lesson_jwt_payload(payload)
    except ValueError:
        return HttpResponse("Токен недействителен", status=403, content_type="text/plain")

    # safe_room в URL должен совпадать с room_id из токена
    expected_safe_room = re.sub(r"[^a-zA-Z0-9_-]", "_", normalized["room_id"])[:64]
    if safe_room != expected_safe_room:
        return HttpResponse("Доступ запрещён", status=403, content_type="text/plain")

    # Защита от path traversal
    if ".." in filename or "/" in filename or "\\" in filename:
        return HttpResponse("Недопустимое имя файла", status=400, content_type="text/plain")

    attach_dir = os.path.join(django_settings.MEDIA_ROOT, "lesson_attachments", safe_room)
    filepath = os.path.join(attach_dir, filename)
    if not os.path.isfile(filepath):
        return HttpResponse("Файл не найден", status=404, content_type="text/plain")

    # Читаем метаданные для content-type
    content_type = "application/octet-stream"
    original_name = filename
    meta_path = filepath + ".meta.json"
    if os.path.isfile(meta_path):
        try:
            with open(meta_path, encoding="utf-8") as mf:
                meta = json.load(mf)
            content_type = meta.get("content_type") or content_type
            original_name = meta.get("original_name") or filename
        except Exception:
            pass

    response = FileResponse(open(filepath, "rb"), content_type=content_type)
    # Для изображений — показываем inline; для остальных — скачиваем
    safe_name = re.sub(r'[^\w.\-]', '_', original_name)
    is_image = content_type.startswith("image/")
    is_audio = content_type.startswith("audio/")
    if is_image or is_audio:
        response["Content-Disposition"] = f'inline; filename="{safe_name}"'
    else:
        response["Content-Disposition"] = f'attachment; filename="{safe_name}"'
    return response


def lesson_join_redirect(request):
    """Без завершающего слэша запрос иначе попадает в react_app — сохраняем query (?token=…)."""
    q = request.META.get("QUERY_STRING", "").strip()
    target = "/lesson/join/" + ("?" + q if q else "")
    return HttpResponseRedirect(target)


def lesson_join(request):
    token = request.GET.get("token", "")
    if not token:
        return HttpResponseBadRequest("Токен не передан")
    try:
        payload = verify_lesson_token(token)
        normalized = normalize_lesson_jwt_payload(payload)
        # ?role= в URL переопределяет роль из JWT (учитель и ученик открывают разные ссылки)
        role_override = request.GET.get("role", "").strip().lower()
        if role_override in ("teacher", "tutor"):
            normalized["lesson_type"] = "teacher"
            normalized["participant_name"] = normalized["teacher_name"]
        elif role_override in ("student", "pupil"):
            normalized["lesson_type"] = "student"
            normalized["participant_name"] = normalized["target_name"] or "Ученик"
        normalized.update(lesson_video_context_from_jwt(payload, lesson_type=normalized.get("lesson_type", "teacher")))
        _apply_lesson_video_collapsed_ui(normalized)
    except ValueError as e:
        return HttpResponseBadRequest(str(e))

    # Фолбэк: если ЛК передал параметры варианта query-параметрами, используем их.
    if not normalized.get("lesson_level"):
        normalized["lesson_level"] = str(request.GET.get("level") or "").strip().lower()
    if not normalized.get("lesson_subject"):
        normalized["lesson_subject"] = str(request.GET.get("subject") or "").strip().lower()
    if not normalized.get("lesson_variant_id"):
        normalized["lesson_variant_id"] = str(
            request.GET.get("variant_id")
            or request.GET.get("variantId")
            or request.GET.get("variant")
            or request.GET.get("vid")
            or request.GET.get("v")
            or ""
        ).strip()
    if not normalized.get("lesson_variant_url"):
        normalized["lesson_variant_url"] = str(
            request.GET.get("variant_url")
            or request.GET.get("variantUrl")
            or request.GET.get("url")
            or request.GET.get("link")
            or ""
        ).strip()

    # Если пришёл только variant_id, достраиваем level/subject из БД.
    if normalized.get("lesson_variant_id") and (not normalized.get("lesson_level") or not normalized.get("lesson_subject")):
        try:
            v = Variant.objects.select_related("level", "var_subject").get(id=int(normalized["lesson_variant_id"]))
            if not normalized.get("lesson_level"):
                normalized["lesson_level"] = str(v.level.level or "").strip().lower()
            if not normalized.get("lesson_subject"):
                normalized["lesson_subject"] = str(v.var_subject.subject_short or "").strip().lower()
        except (ValueError, TypeError, Variant.DoesNotExist):
            pass

    if _is_lesson_session_closed(normalized["room_id"]):
        return HttpResponseRedirect(lk_user_nav_url())

    # Домашнее задание из ЛК: query и/или поля JWT
    cabinet_session = str(request.GET.get("cabinet_session") or request.GET.get("cabinetSession") or "").strip()
    cabinet_assignment = str(
        request.GET.get("cabinet_assignment")
        or request.GET.get("cabinetAssignment")
        or normalized.get("homework_assignment_id")
        or payload.get("homework_assignment_id")
        or payload.get("homeworkAssignmentId")
        or ""
    ).strip()
    if not cabinet_assignment and payload.get("homework_assignment_id") is not None:
        cabinet_assignment = str(payload.get("homework_assignment_id")).strip()
    sk = str(
        (normalized.get("session_kind") or payload.get("session_kind") or payload.get("sessionKind") or "")
    ).strip().lower()
    lf = str(
        (
            normalized.get("lesson_format")
            or payload.get("lesson_format")
            or payload.get("lessonFormat")
            or ""
        )
    ).strip().lower()
    cas = cabinet_session.lower()
    homework_mode = bool(
        cas == "homework"
        or sk == "homework"
        or lf == "homework"
        or bool(cabinet_assignment)
    )

    _persist_lesson_room(normalized["room_id"], payload)
    normalized["lesson_token"] = token
    normalized["cabinet_session"] = cabinet_session
    normalized["cabinet_assignment"] = cabinet_assignment
    normalized["homework_mode"] = homework_mode

    # Уведомление ЛК: ученик зашёл в комнату (в т.ч. homework).
    if str(normalized.get("lesson_type") or "").strip().lower() == "student":
        student_user_id = (
            payload.get("student_user_id")
            or payload.get("studentUserId")
            or payload.get("target_id")
            or payload.get("targetId")
            or payload.get("user_id")
            or payload.get("userId")
        )
        _tkn = token
        _lk_student_extra = {
            "room_id": normalized.get("room_id"),
            "target_id": payload.get("target_id") or payload.get("targetId"),
            "teacher_id": payload.get("teacher_id") or payload.get("teacherId"),
            "student_user_id": student_user_id,
        }

        def _notify_student_joined_room():
            ok_st, detail_st = notify_lk_student_joined(_tkn, extra=_lk_student_extra)
            if not ok_st:
                logger.warning("ЛК student-joined не доставлен: %s", detail_st)

        threading.Thread(target=_notify_student_joined_room, daemon=True).start()

    # В JSON для страницы подмешиваем роль после ?role=… — в JWT ЛК иногда шлёт lesson_format=student и для ссылки учителя.
    # Не затираем lesson_format, если в JWT это режим «homework» (домашка из ЛК).
    client_payload = dict(payload) if isinstance(payload, dict) else {}
    lt_eff = str(normalized.get("lesson_type") or "").strip().lower()
    lf_jwt = str(
        (payload.get("lesson_format") or payload.get("lessonFormat") or "")
        if isinstance(payload, dict)
        else ""
    ).strip().lower()
    if lt_eff in ("teacher", "student"):
        client_payload["lesson_type"] = lt_eff
        if lf_jwt != "homework":
            client_payload["lesson_format"] = lt_eff
    normalized["lesson_payload_json"] = json.dumps(client_payload, ensure_ascii=False)
    normalized["lk_public_url"] = lk_user_nav_url()
    # Для редиректа после завершения урока нужен именно корень ЛК, а не /dashboard или /app.
    normalized["lk_home_url"] = lk_site_base_url()
    normalized["lk_nav_password_required"] = lk_nav_password_configured()
    normalized["lk_nav_unlocked"] = (not normalized["lk_nav_password_required"]) or lk_nav_cookie_is_valid(
        request
    )
    return render(request, "lesson_room.html", normalized)

@csrf_exempt
@require_http_methods(["POST"])
def api_admin_upload(request):
    denied = _require_lesson_admin(request)
    if denied is not None:
        return denied

    upload_type = request.POST.get("type", "file")
    uploaded_file = request.FILES.get("file")
    
    if not uploaded_file:
        return JsonResponse({"error": "Файл не передан"}, status=400)

    try:
        if upload_type == "presentation":
            presentation = Presentation.objects.create(
                title=uploaded_file.name,
                original_file=uploaded_file
            )
            return JsonResponse({
                "id": presentation.id,
                "title": presentation.title,
                "type": "presentation"
            })
        else:
            file_resource = FileResource.objects.create(
                title=uploaded_file.name,
                file=uploaded_file,
                file_type=uploaded_file.name.split('.')[-1].lower() if '.' in uploaded_file.name else ""
            )
            return JsonResponse({
                "id": file_resource.id,
                "title": file_resource.title,
                "url": file_resource.file.url if file_resource.file else None,
                "type": "file"
            })
    except Exception as e:
        return JsonResponse({"error": str(e)}, status=500)
