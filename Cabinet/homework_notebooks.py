"""Тетрадь проверки ДЗ: страницы, аннотации, ревизии, экспорт PDF."""

from __future__ import annotations

import io
import logging
import os
import uuid
from copy import deepcopy

from django.core.files.base import ContentFile
from django.db import transaction
from django.db.models import Q
from django.http import FileResponse
from django.utils import timezone
from rest_framework import status
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .choices import (
    HomeworkAttachmentOwnerRole,
    HomeworkAttachmentType,
    HomeworkNotebookPageType,
    HomeworkNotebookRevisionReason,
    HomeworkNotebookStatus,
)
from .homework_task_files import (
    COMMENT_TASK_KEY,
    create_task_attachments,
    ensure_payload_migrated,
    file_response_for_attachment,
    grouped_task_attachments,
    resolve_homework_task,
    serialize_homework_task_attachment,
    soft_delete_attachment,
    user_can_view_submission,
    user_can_write_student_files,
    user_can_write_teacher_files,
    HomeworkTaskFileError,
)
from .models import (
    HomeworkAttachment,
    HomeworkNotebook,
    HomeworkNotebookPage,
    HomeworkNotebookRevision,
    HomeworkSubmission,
    Profile,
)
from .upload_validation import UploadValidationError, validate_uploaded_file

logger = logging.getLogger(__name__)

DEFAULT_PAGE_WIDTH = HomeworkNotebookPage.DEFAULT_WIDTH
DEFAULT_PAGE_HEIGHT = HomeworkNotebookPage.DEFAULT_HEIGHT
NOTEBOOK_IMAGE_TYPES = {
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
    "image/gif",
    "image/heic",
    "image/heif",
}
NOTEBOOK_PDF_TYPES = {"application/pdf"}


class NotebookError(Exception):
    def __init__(self, message: str, code: str = "notebook_error", status_code: int = 400, extra=None):
        super().__init__(message)
        self.message = message
        self.code = code
        self.status_code = status_code
        self.extra = extra or {}


class NotebookConflict(NotebookError):
    def __init__(self, current_version: int, document: dict | None = None):
        super().__init__(
            "Тетрадь изменена в другой вкладке. Перезагрузите актуальную версию.",
            code="version_conflict",
            status_code=409,
            extra={"current_version": current_version, "document": document},
        )


def _empty_state() -> dict:
    return {"version": 1, "objects": []}


def _pdf_page_count(attachment: HomeworkAttachment) -> int:
    try:
        from pypdf import PdfReader
    except Exception:
        return 1
    try:
        if attachment.file:
            attachment.file.open("rb")
            reader = PdfReader(attachment.file)
            return max(1, len(reader.pages))
        if attachment.storage_path:
            from django.core.files.storage import default_storage

            with default_storage.open(attachment.storage_path, "rb") as fh:
                reader = PdfReader(fh)
                return max(1, len(reader.pages))
    except Exception:
        logger.warning("pdf page count failed attachment=%s", attachment.id, exc_info=True)
        return 1
    return 1


def _is_pdf(attachment: HomeworkAttachment) -> bool:
    mime = (attachment.mime_type or "").lower()
    name = (attachment.original_filename or "").lower()
    return mime in NOTEBOOK_PDF_TYPES or name.endswith(".pdf")


def _is_image(attachment: HomeworkAttachment) -> bool:
    mime = (attachment.mime_type or "").lower()
    name = (attachment.original_filename or "").lower()
    if mime in NOTEBOOK_IMAGE_TYPES or mime.startswith("image/"):
        return True
    return name.endswith((".jpg", ".jpeg", ".png", ".webp", ".gif", ".heic", ".heif"))


SKIP_SEED_ATTACHMENT_TYPES = {
    HomeworkAttachmentType.NOTEBOOK_EXPORT,
    HomeworkAttachmentType.NOTEBOOK_SOURCE,
    HomeworkAttachmentType.TEACHER_COMMENT,
    HomeworkAttachmentType.TEACHER_CHECKED_FILE,
}

# Единая тетрадь для сдачи без варианта (файл/текст учителя → ответ ученика).
SUBMISSION_NOTEBOOK_TASK_KEY = "__homework__"


def _unique_keys(values) -> list[str]:
    seen = set()
    keys = []
    for value in values:
        key = str(value or "").strip()
        if not key or key == COMMENT_TASK_KEY or key in seen:
            continue
        seen.add(key)
        keys.append(key)
    return keys


def default_submission_notebook_task_key(submission: HomeworkSubmission) -> str:
    """Стабильный task_key для невариантной сдачи: PK первого задания или sentinel."""
    homework = getattr(submission, "homework", None)
    if homework is not None:
        first = homework.tasks.filter(is_active=True).order_by("order", "id").first()
        if first is not None:
            return str(first.pk)
    return SUBMISSION_NOTEBOOK_TASK_KEY


def _checksum_and_size_from_filefield(file_field) -> tuple[str, int]:
    import hashlib

    digest = hashlib.sha256()
    size = 0
    try:
        file_field.open("rb")
        try:
            for chunk in file_field.chunks():
                if not chunk:
                    continue
                digest.update(chunk)
                size += len(chunk)
        finally:
            try:
                file_field.close()
            except Exception:
                pass
    except Exception:
        logger.warning("checksum failed for submission file", exc_info=True)
        return "", 0
    return digest.hexdigest(), size


def ensure_submission_files_as_task_attachments(
    submission: HomeworkSubmission,
    task_key: str,
) -> list[HomeworkAttachment]:
    """
    Копирует attached_file / HomeworkSubmissionAttachment в HomeworkAttachment,
    чтобы тетрадь проверки могла сидиться так же, как у варианта.
    """
    task_key = str(task_key or "").strip() or default_submission_notebook_task_key(submission)
    if task_key == COMMENT_TASK_KEY:
        return []

    from .homework_task_files import resolve_homework_task, sync_payload_attachment_maps
    from .files_storage import sanitize_filename
    from .submission_files import submission_has_files

    if not submission_has_files(submission):
        return []

    existing = list(
        HomeworkAttachment.objects.filter(
            submission=submission,
            owner_role=HomeworkAttachmentOwnerRole.STUDENT,
            is_deleted=False,
        ).exclude(attachment_type__in=SKIP_SEED_ATTACHMENT_TYPES)
    )
    existing_checksums = {row.checksum for row in existing if row.checksum}
    existing_names = {
        (row.original_filename or "", int(row.file_size or 0))
        for row in existing
    }

    sources: list[tuple[object, str]] = []
    try:
        if submission.attached_file and submission.attached_file.name:
            name = submission.attached_file.name.split("/")[-1] or "file"
            sources.append((submission.attached_file, name))
    except Exception:
        pass
    for att in submission.file_attachments.all().order_by("id"):
        if not att.file:
            continue
        name = att.original_name or (att.file.name.split("/")[-1] if att.file.name else "file")
        sources.append((att.file, name))

    if not sources:
        return []

    homework = submission.homework
    homework_task = resolve_homework_task(homework, task_key)
    created: list[HomeworkAttachment] = []
    for file_field, raw_name in sources:
        checksum, size = _checksum_and_size_from_filefield(file_field)
        filename = sanitize_filename(raw_name or "file")
        if checksum and checksum in existing_checksums:
            continue
        if (filename, int(size or 0)) in existing_names and not checksum:
            continue
        mime = ""
        try:
            import mimetypes

            mime = mimetypes.guess_type(filename)[0] or ""
        except Exception:
            mime = ""
        row = HomeworkAttachment(
            submission=submission,
            homework=homework,
            homework_task=homework_task,
            task_key=task_key,
            task_number="",
            uploaded_by=None,
            owner_role=HomeworkAttachmentOwnerRole.STUDENT,
            attachment_type=HomeworkAttachmentType.STUDENT_ANSWER,
            original_filename=filename,
            mime_type=mime,
            file_size=size,
            checksum=checksum,
        )
        try:
            file_field.open("rb")
            try:
                data = file_field.read()
            finally:
                try:
                    file_field.close()
                except Exception:
                    pass
            row.file.save(filename, ContentFile(data), save=False)
        except Exception:
            logger.warning(
                "mirror submission file failed submission=%s name=%s",
                submission.pk,
                filename,
                exc_info=True,
            )
            continue
        if row.file and row.file.name:
            row.storage_path = row.file.name
        row.save()
        created.append(row)
        if checksum:
            existing_checksums.add(checksum)
        existing_names.add((filename, int(size or 0)))

    if created:
        sync_payload_attachment_maps(submission)
        submission.save(update_fields=["result_payload", "updated_at"])
    return created


def notebook_task_keys(submission: HomeworkSubmission, task_key: str) -> list[str]:
    """Все ключи, под которыми могли сохранить файлы этого задания."""
    raw = str(task_key or "").strip()
    keys = _unique_keys([raw, SUBMISSION_NOTEBOOK_TASK_KEY])
    homework = getattr(submission, "homework", None)
    hw_task = resolve_homework_task(homework, raw) if homework is not None else None
    if hw_task is not None:
        keys = _unique_keys(keys + [hw_task.pk, getattr(hw_task, "task_id", "")])
    if homework is None:
        return keys
    default_key = default_submission_notebook_task_key(submission)
    keys = _unique_keys(keys + [default_key])
    from .homework_task_files import _variant_number_to_task_ids

    mapping = _variant_number_to_task_ids(homework)
    extra = []
    for number, ids in mapping.items():
        if raw == number or raw in ids:
            extra.append(number)
            extra.extend(ids)
    return _unique_keys(keys + extra)


def student_attachments_for_notebook(
    submission: HomeworkSubmission,
    task_key: str,
    extra_task_keys=None,
) -> list[HomeworkAttachment]:
    ensure_payload_migrated(submission)
    ensure_submission_files_as_task_attachments(submission, task_key)
    keys = _unique_keys(notebook_task_keys(submission, task_key) + list(extra_task_keys or []))
    grouped = grouped_task_attachments(submission)
    buckets = grouped.get("tasks") or {}
    wanted = []
    seen = set()
    for key in keys:
        for item in (buckets.get(key) or {}).get("student") or []:
            ident = str(item.get("id") or "").strip()
            if ident and ident not in seen:
                seen.add(ident)
                wanted.append(ident)
    qs = HomeworkAttachment.objects.filter(
        submission=submission,
        owner_role=HomeworkAttachmentOwnerRole.STUDENT,
        is_deleted=False,
    ).exclude(attachment_type__in=SKIP_SEED_ATTACHMENT_TYPES)
    if wanted:
        return list(qs.filter(id__in=wanted).order_by("created_at", "id"))
    q = Q(task_key__in=keys) | Q(task_number__in=keys)
    matched = list(qs.filter(q).order_by("created_at", "id")) if keys else []
    if matched:
        return matched
    homework = getattr(submission, "homework", None)
    active_tasks = list(homework.tasks.filter(is_active=True)[:3]) if homework is not None else []
    all_files = list(qs.order_by("created_at", "id"))
    distinct_keys = {row.task_key for row in all_files if row.task_key}
    # Невариантная сдача / одно задание: все файлы ответа ученика в одну тетрадь.
    if len(active_tasks) <= 1 and len(distinct_keys) <= 1:
        return all_files
    from .homework_api import homework_has_variant_task

    if homework is not None and not homework_has_variant_task(homework):
        return all_files
    return []


def _page_is_unused_blank(page: HomeworkNotebookPage) -> bool:
    if page.page_type != HomeworkNotebookPageType.BLANK or page.source_attachment_id:
        return False
    state = page.state if isinstance(page.state, dict) else {}
    objects = state.get("objects") if isinstance(state, dict) else None
    return not objects


def seed_notebook_from_student_files(notebook: HomeworkNotebook, extra_task_keys=None) -> bool:
    """Добавляет страницы из файлов ученика; убирает пустой лист, если появились исходники."""
    attachments = student_attachments_for_notebook(
        notebook.submission, notebook.task_key, extra_task_keys
    )
    existing = {
        str(attachment_id)
        for attachment_id in notebook.pages.exclude(source_attachment_id=None).values_list(
            "source_attachment_id", flat=True
        )
    }
    preexisting = list(notebook.pages.all())
    only_empty_blanks = bool(preexisting) and all(_page_is_unused_blank(page) for page in preexisting)
    added = False
    for attachment in attachments:
        if str(attachment.id) in existing:
            continue
        _add_pages_from_attachment(notebook, attachment)
        existing.add(str(attachment.id))
        added = True
    if added and (not preexisting or only_empty_blanks):
        unused = [page for page in notebook.pages.all() if _page_is_unused_blank(page)]
        sourced = notebook.pages.exclude(id__in=[page.id for page in unused]).exists()
        if sourced:
            for page in unused:
                page.delete()
            _renumber_pages(notebook)
    if not notebook.pages.exists():
        create_blank_page(notebook)
        return True
    return added


def serialize_page(page: HomeworkNotebookPage) -> dict:
    background_url = ""
    if page.background_file:
        background_url = f"/api/homework/notebook-pages/{page.id}/background/"
    source = None
    if page.source_attachment_id:
        source = serialize_homework_task_attachment(page.source_attachment)
    return {
        "id": str(page.id),
        "page_number": page.page_number,
        "page_type": page.page_type,
        "width": page.width,
        "height": page.height,
        "pdf_page_number": page.pdf_page_number,
        "source_attachment": source,
        "source_attachment_id": str(page.source_attachment_id) if page.source_attachment_id else None,
        "background_url": background_url,
        "state": page.state if isinstance(page.state, dict) else _empty_state(),
        "created_at": page.created_at.isoformat() if page.created_at else None,
        "updated_at": page.updated_at.isoformat() if page.updated_at else None,
    }


def serialize_notebook(notebook: HomeworkNotebook, *, include_pages: bool = True) -> dict:
    pages = []
    if include_pages:
        qs = notebook.pages.select_related("source_attachment").order_by("page_number", "id")
        pages = [serialize_page(page) for page in qs]
    published_id = str(notebook.published_revision_id) if notebook.published_revision_id else None
    return {
        "id": str(notebook.id),
        "submission_id": notebook.submission_id,
        "task_id": notebook.task_key,
        "owner_role": notebook.owner_role,
        "status": notebook.status,
        "version": notebook.version,
        "published_revision_id": published_id,
        "created_at": notebook.created_at.isoformat() if notebook.created_at else None,
        "updated_at": notebook.updated_at.isoformat() if notebook.updated_at else None,
        "pages": pages,
    }


def serialize_revision(revision: HomeworkNotebookRevision) -> dict:
    export_url = ""
    if revision.export_file:
        export_url = f"/api/homework/notebook-revisions/{revision.id}/export/"
    return {
        "id": str(revision.id),
        "notebook_id": str(revision.notebook_id),
        "version": revision.version,
        "reason": revision.reason,
        "created_at": revision.created_at.isoformat() if revision.created_at else None,
        "snapshot": revision.snapshot if isinstance(revision.snapshot, dict) else {},
        "export_url": export_url,
    }


def user_can_edit_notebook(user, notebook: HomeworkNotebook) -> bool:
    submission = notebook.submission
    if notebook.owner_role == HomeworkAttachmentOwnerRole.STUDENT:
        return user_can_write_student_files(user, submission)
    return user_can_write_teacher_files(user, submission)


def user_can_view_notebook(user, notebook: HomeworkNotebook) -> bool:
    if not user_can_view_submission(user, notebook.submission):
        return False
    profile = getattr(user, "profile", None)
    role = getattr(profile, "role", None)
    if notebook.owner_role == HomeworkAttachmentOwnerRole.TEACHER:
        if role == Profile.Role.STUDENT:
            return bool(notebook.published_revision_id)
        return True
    return True


def _next_page_number(notebook: HomeworkNotebook) -> int:
    last = notebook.pages.order_by("-page_number").values_list("page_number", flat=True).first()
    return int(last or 0) + 1


def _renumber_pages(notebook: HomeworkNotebook) -> None:
    pages = list(notebook.pages.order_by("page_number", "id"))
    for index, page in enumerate(pages, start=1):
        if page.page_number != index:
            page.page_number = index
            page.save(update_fields=["page_number"])


def _add_pages_from_attachment(notebook: HomeworkNotebook, attachment: HomeworkAttachment) -> list[HomeworkNotebookPage]:
    created = []
    if _is_pdf(attachment):
        count = _pdf_page_count(attachment)
        start = _next_page_number(notebook)
        for index in range(count):
            page = HomeworkNotebookPage.objects.create(
                notebook=notebook,
                page_number=start + index,
                source_attachment=attachment,
                page_type=HomeworkNotebookPageType.PDF_PAGE,
                pdf_page_number=index + 1,
                width=DEFAULT_PAGE_WIDTH,
                height=DEFAULT_PAGE_HEIGHT,
                state=_empty_state(),
            )
            created.append(page)
        return created
    page = HomeworkNotebookPage.objects.create(
        notebook=notebook,
        page_number=_next_page_number(notebook),
        source_attachment=attachment,
        page_type=HomeworkNotebookPageType.ATTACHMENT,
        width=DEFAULT_PAGE_WIDTH,
        height=DEFAULT_PAGE_HEIGHT,
        state=_empty_state(),
    )
    return [page]


def create_blank_page(notebook: HomeworkNotebook) -> HomeworkNotebookPage:
    return HomeworkNotebookPage.objects.create(
        notebook=notebook,
        page_number=_next_page_number(notebook),
        page_type=HomeworkNotebookPageType.BLANK,
        width=DEFAULT_PAGE_WIDTH,
        height=DEFAULT_PAGE_HEIGHT,
        state=_empty_state(),
    )


def get_or_create_notebook(
    *,
    submission: HomeworkSubmission,
    task_key: str,
    user,
    owner_role: str,
    seed_from_student_files: bool = False,
    extra_task_keys=None,
) -> HomeworkNotebook:
    task_key = str(task_key or "").strip()
    if not task_key or task_key == COMMENT_TASK_KEY:
        task_key = default_submission_notebook_task_key(submission)
    if not task_key or task_key == COMMENT_TASK_KEY:
        raise NotebookError("task_id required", code="TASK_ID_REQUIRED")
    homework_task = resolve_homework_task(submission.homework, task_key)
    notebook, created = HomeworkNotebook.objects.get_or_create(
        submission=submission,
        task_key=task_key,
        owner_role=owner_role,
        defaults={
            "created_by": user if getattr(user, "is_authenticated", False) else None,
            "homework_task": homework_task,
            "status": HomeworkNotebookStatus.DRAFT,
            "version": 1,
        },
    )
    if seed_from_student_files:
        seed_notebook_from_student_files(notebook, extra_task_keys=extra_task_keys)
    elif created and not notebook.pages.exists():
        create_blank_page(notebook)
    return notebook


def snapshot_notebook(notebook: HomeworkNotebook) -> dict:
    pages = [
        serialize_page(page)
        for page in notebook.pages.select_related("source_attachment").order_by("page_number", "id")
    ]
    return {
        "id": str(notebook.id),
        "task_id": notebook.task_key,
        "owner_role": notebook.owner_role,
        "version": notebook.version,
        "status": notebook.status,
        "pages": pages,
    }


def create_revision(
    notebook: HomeworkNotebook,
    *,
    user,
    reason: str,
    export_bytes: bytes | None = None,
    export_name: str = "",
) -> HomeworkNotebookRevision:
    revision = HomeworkNotebookRevision(
        notebook=notebook,
        version=notebook.version,
        created_by=user if getattr(user, "is_authenticated", False) else None,
        reason=reason,
        snapshot=snapshot_notebook(notebook),
    )
    if export_bytes:
        revision.export_file.save(
            export_name or "notebook.pdf",
            ContentFile(export_bytes),
            save=False,
        )
    revision.save()
    return revision


def apply_page_payloads(notebook: HomeworkNotebook, pages_payload: list) -> None:
    if not isinstance(pages_payload, list):
        raise NotebookError("pages must be a list", code="INVALID_PAGES")
    existing = {str(page.id): page for page in notebook.pages.all()}
    seen = set()
    for index, raw in enumerate(pages_payload, start=1):
        if not isinstance(raw, dict):
            continue
        page_id = str(raw.get("id") or "").strip()
        page = existing.get(page_id)
        state = raw.get("state") if isinstance(raw.get("state"), dict) else _empty_state()
        objects = state.get("objects")
        if not isinstance(objects, list):
            objects = []
        cleaned_objects = []
        for obj in objects:
            if not isinstance(obj, dict):
                continue
            obj_id = str(obj.get("id") or "").strip() or str(uuid.uuid4())
            item = dict(obj)
            item["id"] = obj_id
            cleaned_objects.append(item)
        state = {"version": int(state.get("version") or 1), "objects": cleaned_objects}
        viewport = raw.get("state", {}).get("viewport") if isinstance(raw.get("state"), dict) else None
        if isinstance(viewport, dict):
            state["viewport"] = viewport
        width = int(raw.get("width") or DEFAULT_PAGE_WIDTH)
        height = int(raw.get("height") or DEFAULT_PAGE_HEIGHT)
        page_type = str(raw.get("page_type") or "").strip() or HomeworkNotebookPageType.BLANK
        if page is None:
            page = HomeworkNotebookPage(
                notebook=notebook,
                page_type=page_type if page_type in HomeworkNotebookPageType.values else HomeworkNotebookPageType.BLANK,
                width=width,
                height=height,
                state=state,
            )
        page.page_number = int(raw.get("page_number") or index)
        page.width = max(100, min(width, 4000))
        page.height = max(100, min(height, 6000))
        page.state = state
        if page_type in HomeworkNotebookPageType.values:
            page.page_type = page_type
        page.save()
        seen.add(str(page.id))
    for page_id, page in existing.items():
        if page_id not in seen:
            page.delete()
    _renumber_pages(notebook)


def save_notebook_document(
    notebook: HomeworkNotebook,
    *,
    version: int,
    pages: list,
    user,
    reason: str = HomeworkNotebookRevisionReason.AUTOSAVE,
    snapshot: bool = False,
) -> HomeworkNotebook:
    with transaction.atomic():
        locked = HomeworkNotebook.objects.select_for_update().select_related("submission").get(pk=notebook.pk)
        if int(locked.version) != int(version):
            raise NotebookConflict(locked.version, serialize_notebook(locked))
        apply_page_payloads(locked, pages)
        locked.version = int(version) + 1
        locked.updated_at = timezone.now()
        locked.save(update_fields=["version", "updated_at"])
        if snapshot:
            create_revision(locked, user=user, reason=reason)
        return locked


def objects_to_svg(state: dict, width: int, height: int) -> str:
    objects = (state or {}).get("objects") or []
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" '
        f'width="100%" height="100%" preserveAspectRatio="none">'
    ]
    for obj in objects:
        if not isinstance(obj, dict):
            continue
        kind = str(obj.get("type") or "")
        color = str(obj.get("stroke") or obj.get("color") or "#d32f2f")
        stroke = float(obj.get("strokeWidth") or obj.get("width") or 3)
        opacity = float(obj.get("opacity") if obj.get("opacity") is not None else (0.28 if kind == "marker" else 1))
        if kind in ("pen", "marker", "eraser"):
            points = obj.get("points") or []
            if len(points) < 2:
                continue
            d = []
            for index, point in enumerate(points):
                if not isinstance(point, dict):
                    continue
                x = float(point.get("x") or 0)
                y = float(point.get("y") or 0)
                d.append(("M" if index == 0 else "L") + f"{x:.2f} {y:.2f}")
            if d:
                parts.append(
                    f'<path d="{" ".join(d)}" fill="none" stroke="{color}" '
                    f'stroke-width="{stroke}" stroke-linecap="round" stroke-linejoin="round" '
                    f'opacity="{opacity}"/>'
                )
        elif kind == "line":
            parts.append(
                f'<line x1="{float(obj.get("x1") or 0)}" y1="{float(obj.get("y1") or 0)}" '
                f'x2="{float(obj.get("x2") or 0)}" y2="{float(obj.get("y2") or 0)}" '
                f'stroke="{color}" stroke-width="{stroke}" />'
            )
        elif kind == "arrow":
            x1, y1 = float(obj.get("x1") or 0), float(obj.get("y1") or 0)
            x2, y2 = float(obj.get("x2") or 0), float(obj.get("y2") or 0)
            parts.append(
                f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{color}" '
                f'stroke-width="{stroke}" marker-end="url(#arrow)" />'
            )
        elif kind in ("rect", "rectangle"):
            parts.append(
                f'<rect x="{float(obj.get("x") or 0)}" y="{float(obj.get("y") or 0)}" '
                f'width="{float(obj.get("w") or obj.get("width") or 0)}" '
                f'height="{float(obj.get("h") or obj.get("height") or 0)}" '
                f'fill="none" stroke="{color}" stroke-width="{stroke}"/>'
            )
        elif kind in ("circle", "ellipse"):
            parts.append(
                f'<ellipse cx="{float(obj.get("cx") or obj.get("x") or 0)}" '
                f'cy="{float(obj.get("cy") or obj.get("y") or 0)}" '
                f'rx="{float(obj.get("rx") or obj.get("w") or 20)}" '
                f'ry="{float(obj.get("ry") or obj.get("h") or 20)}" '
                f'fill="none" stroke="{color}" stroke-width="{stroke}"/>'
            )
        elif kind == "text":
            text = (
                str(obj.get("text") or "")
                .replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;")
            )
            size = float(obj.get("fontSize") or obj.get("size") or 24)
            parts.append(
                f'<text x="{float(obj.get("x") or 0)}" y="{float(obj.get("y") or 0)}" '
                f'fill="{color}" font-size="{size}" font-family="sans-serif">{text}</text>'
            )
    parts.append("</svg>")
    return "".join(parts)


def build_notebook_pdf_html(notebook: HomeworkNotebook) -> str:
    sections = []
    for page in notebook.pages.select_related("source_attachment").order_by("page_number", "id"):
        svg = objects_to_svg(page.state if isinstance(page.state, dict) else {}, page.width, page.height)
        bg = ""
        if page.background_file:
            try:
                import base64

                data = page.background_file.read()
                page.background_file.seek(0)
                b64 = base64.b64encode(data).decode("ascii")
                bg = (
                    f'<img class="bg" src="data:image/jpeg;base64,{b64}" alt="" />'
                )
            except Exception:
                bg = ""
        sections.append(
            f'<section class="page">{bg}{svg}</section>'
        )
    return f"""<!doctype html>
<html><head><meta charset="utf-8">
<style>
@page {{ size: A4; margin: 0; }}
html, body {{ margin: 0; padding: 0; }}
.page {{
  position: relative;
  width: 210mm;
  height: 297mm;
  page-break-after: always;
  overflow: hidden;
  background: #fff;
}}
.page .bg {{ position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; }}
.page svg {{ position: absolute; inset: 0; width: 100%; height: 100%; }}
</style></head><body>{''.join(sections)}</body></html>"""


def export_notebook_pdf(notebook: HomeworkNotebook) -> bytes:
    html = build_notebook_pdf_html(notebook)
    from weasyprint import HTML

    return HTML(string=html, base_url=".").write_pdf()


def pdf_from_page_images(uploaded_files: list) -> bytes:
    import base64

    sections = []
    for uploaded in uploaded_files:
        data = uploaded.read()
        if hasattr(uploaded, "seek"):
            try:
                uploaded.seek(0)
            except Exception:
                pass
        mime = str(getattr(uploaded, "content_type", "") or "image/jpeg").split(";")[0].strip() or "image/jpeg"
        b64 = base64.b64encode(data).decode("ascii")
        sections.append(
            f'<section class="page"><img src="data:{mime};base64,{b64}" alt="" /></section>'
        )
    html = f"""<!doctype html>
<html><head><meta charset="utf-8">
<style>
@page {{ size: A4; margin: 0; }}
html, body {{ margin: 0; padding: 0; }}
.page {{
  position: relative;
  width: 210mm;
  height: 297mm;
  page-break-after: always;
  overflow: hidden;
  background: #fff;
}}
.page img {{ position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; }}
</style></head><body>{''.join(sections)}</body></html>"""
    from weasyprint import HTML

    return HTML(string=html, base_url=".").write_pdf()


def _replace_previous_notebook_exports(notebook: HomeworkNotebook, *, actor) -> None:
    previous = HomeworkAttachment.objects.filter(
        submission=notebook.submission,
        task_key=notebook.task_key,
        owner_role=notebook.owner_role,
        attachment_type=HomeworkAttachmentType.NOTEBOOK_EXPORT,
        is_deleted=False,
    )
    for attachment in previous:
        soft_delete_attachment(attachment, actor=actor)


def complete_notebook_with_export(
    notebook: HomeworkNotebook,
    *,
    user,
    uploaded_pages: list | None = None,
    export_file=None,
) -> tuple[HomeworkNotebook, HomeworkNotebookRevision, HomeworkAttachment | None]:
    pages = list(uploaded_pages or [])
    export_bytes = None
    export_name = ""
    attach_file = export_file
    if attach_file is None and len(pages) == 1:
        attach_file = pages[0]
    elif attach_file is None and len(pages) > 1:
        export_bytes = pdf_from_page_images(pages)
        export_name = "checked.pdf"
        attach_file = ContentFile(export_bytes, name=export_name)
        attach_file.content_type = "application/pdf"
    if attach_file is not None and export_bytes is None:
        raw = attach_file.read()
        if hasattr(attach_file, "seek"):
            try:
                attach_file.seek(0)
            except Exception:
                pass
        export_bytes = raw
        export_name = os.path.basename(getattr(attach_file, "name", "") or "") or "checked.jpg"
        if len(export_name) > 48:
            ext = os.path.splitext(export_name)[1] or ".jpg"
            export_name = f"checked{ext}"

    reason = HomeworkNotebookRevisionReason.STUDENT_SUBMIT
    new_status = HomeworkNotebookStatus.SUBMITTED
    if notebook.owner_role == HomeworkAttachmentOwnerRole.TEACHER:
        reason = HomeworkNotebookRevisionReason.TEACHER_RETURN
        new_status = HomeworkNotebookStatus.RETURNED

    with transaction.atomic():
        locked = HomeworkNotebook.objects.select_for_update().select_related("submission").get(pk=notebook.pk)
        revision = create_revision(
            locked,
            user=user,
            reason=reason,
            export_bytes=export_bytes,
            export_name=export_name or "notebook.pdf",
        )
        locked.status = new_status
        if locked.owner_role == HomeworkAttachmentOwnerRole.TEACHER:
            locked.published_revision = revision
        locked.save(update_fields=["status", "published_revision", "updated_at"])
        attachment = None
        if attach_file is not None:
            _replace_previous_notebook_exports(locked, actor=user)
            created = create_task_attachments(
                submission=locked.submission,
                uploaded_files=[attach_file],
                task_key=locked.task_key,
                user=user,
                teacher=locked.owner_role == HomeworkAttachmentOwnerRole.TEACHER,
                attachment_type=HomeworkAttachmentType.NOTEBOOK_EXPORT,
            )
            attachment = created[0] if created else None
        return locked, revision, attachment


def _submission_or_404(submission_id: int):
    return (
        HomeworkSubmission.objects.select_related("homework", "student", "student__user")
        .filter(pk=submission_id)
        .first()
    )


def _notebook_or_404(notebook_id):
    return (
        HomeworkNotebook.objects.select_related("submission", "submission__homework", "submission__student")
        .filter(pk=notebook_id)
        .first()
    )


def _owner_role_for_user(user, submission: HomeworkSubmission) -> str:
    profile = getattr(user, "profile", None)
    if getattr(profile, "role", None) == Profile.Role.TEACHER and user_can_write_teacher_files(user, submission):
        return HomeworkAttachmentOwnerRole.TEACHER
    return HomeworkAttachmentOwnerRole.STUDENT


class HomeworkNotebookCollectionView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, submission_id: int):
        submission = _submission_or_404(submission_id)
        if not submission or not user_can_view_submission(request.user, submission):
            return Response({"detail": "Нет доступа."}, status=status.HTTP_404_NOT_FOUND)
        task_key = str(request.query_params.get("task_id") or "").strip()
        qs = HomeworkNotebook.objects.filter(submission=submission)
        if task_key:
            qs = qs.filter(task_key=task_key)
        items = []
        for notebook in qs.order_by("task_key", "owner_role"):
            if user_can_view_notebook(request.user, notebook):
                items.append(serialize_notebook(notebook, include_pages=False))
        return Response({"notebooks": items})

    def post(self, request, submission_id: int):
        submission = _submission_or_404(submission_id)
        if not submission or not user_can_view_submission(request.user, submission):
            return Response({"detail": "Нет доступа."}, status=status.HTTP_404_NOT_FOUND)
        task_key = str(request.data.get("task_id") or request.data.get("task_key") or "").strip()
        extra_task_keys = [
            request.data.get("task_number"),
            request.data.get("task_key"),
        ]
        seed = bool(request.data.get("seed_from_attachments", True))
        requested_role = str(request.data.get("owner_role") or "").strip()
        role = _owner_role_for_user(request.user, submission)
        if requested_role == HomeworkAttachmentOwnerRole.TEACHER:
            if not user_can_write_teacher_files(request.user, submission):
                return Response({"detail": "Нет доступа."}, status=status.HTTP_403_FORBIDDEN)
            role = HomeworkAttachmentOwnerRole.TEACHER
        elif requested_role == HomeworkAttachmentOwnerRole.STUDENT:
            if not user_can_write_student_files(request.user, submission):
                return Response({"detail": "Нет доступа."}, status=status.HTTP_403_FORBIDDEN)
            role = HomeworkAttachmentOwnerRole.STUDENT
        if role == HomeworkAttachmentOwnerRole.STUDENT and not user_can_write_student_files(request.user, submission):
            existing = HomeworkNotebook.objects.filter(
                submission=submission, task_key=task_key, owner_role=role
            ).first()
            if existing and user_can_view_notebook(request.user, existing):
                return Response(serialize_notebook(existing))
            return Response({"detail": "Нет доступа."}, status=status.HTTP_403_FORBIDDEN)
        try:
            with transaction.atomic():
                locked = HomeworkSubmission.objects.select_for_update().get(pk=submission.pk)
                notebook = get_or_create_notebook(
                    submission=locked,
                    task_key=task_key,
                    user=request.user,
                    owner_role=role,
                    seed_from_student_files=seed,
                    extra_task_keys=extra_task_keys,
                )
        except NotebookError as exc:
            return Response({"error": exc.message, "code": exc.code}, status=exc.status_code)
        return Response(serialize_notebook(notebook), status=status.HTTP_201_CREATED)


class HomeworkNotebookDetailView(APIView):
    permission_classes = [IsAuthenticated]
    parser_classes = [JSONParser, MultiPartParser, FormParser]

    def get(self, request, notebook_id):
        notebook = _notebook_or_404(notebook_id)
        if not notebook or not user_can_view_notebook(request.user, notebook):
            return Response({"detail": "Нет доступа."}, status=status.HTTP_404_NOT_FOUND)
        profile = getattr(request.user, "profile", None)
        if (
            notebook.owner_role == HomeworkAttachmentOwnerRole.TEACHER
            and getattr(profile, "role", None) == Profile.Role.STUDENT
        ):
            revision = notebook.published_revision
            if not revision:
                return Response({"detail": "Проверка ещё не отправлена."}, status=status.HTTP_404_NOT_FOUND)
            return Response(
                {
                    "id": str(notebook.id),
                    "readonly": True,
                    "published": True,
                    "revision": serialize_revision(revision),
                    "document": revision.snapshot,
                }
            )
        if notebook.owner_role == HomeworkAttachmentOwnerRole.TEACHER:
            seed_notebook_from_student_files(notebook)
        return Response(serialize_notebook(notebook))

    def put(self, request, notebook_id):
        notebook = _notebook_or_404(notebook_id)
        if not notebook or not user_can_edit_notebook(request.user, notebook):
            return Response({"detail": "Нет доступа."}, status=status.HTTP_403_FORBIDDEN)
        try:
            version = int(request.data.get("version"))
        except (TypeError, ValueError):
            return Response({"error": "version required"}, status=status.HTTP_400_BAD_REQUEST)
        pages = request.data.get("pages")
        if not isinstance(pages, list):
            return Response({"error": "pages required"}, status=status.HTTP_400_BAD_REQUEST)
        try:
            saved = save_notebook_document(
                notebook,
                version=version,
                pages=pages,
                user=request.user,
                reason=str(request.data.get("reason") or HomeworkNotebookRevisionReason.AUTOSAVE),
                snapshot=bool(request.data.get("snapshot")),
            )
        except NotebookConflict as exc:
            return Response(
                {"error": exc.message, "code": exc.code, **exc.extra},
                status=exc.status_code,
            )
        except NotebookError as exc:
            return Response({"error": exc.message, "code": exc.code}, status=exc.status_code)
        return Response(serialize_notebook(saved))


class HomeworkNotebookPageCreateView(APIView):
    permission_classes = [IsAuthenticated]
    parser_classes = [JSONParser, MultiPartParser, FormParser]

    def post(self, request, notebook_id):
        notebook = _notebook_or_404(notebook_id)
        if not notebook or not user_can_edit_notebook(request.user, notebook):
            return Response({"detail": "Нет доступа."}, status=status.HTTP_403_FORBIDDEN)
        kind = str(request.data.get("page_type") or "blank").strip()
        uploaded = request.FILES.get("file")
        with transaction.atomic():
            locked = HomeworkNotebook.objects.select_for_update().get(pk=notebook.pk)
            created_pages = []
            if uploaded:
                try:
                    validate_uploaded_file(uploaded)
                except UploadValidationError as exc:
                    return Response({"error": exc.message, "code": exc.code}, status=400)
                name = (uploaded.name or "").lower()
                mime = (getattr(uploaded, "content_type", "") or "").lower()
                if mime in NOTEBOOK_PDF_TYPES or name.endswith(".pdf"):
                    try:
                        created = create_task_attachments(
                            submission=locked.submission,
                            uploaded_files=[uploaded],
                            task_key=locked.task_key,
                            user=request.user,
                            teacher=locked.owner_role == HomeworkAttachmentOwnerRole.TEACHER,
                            attachment_type=HomeworkAttachmentType.NOTEBOOK_SOURCE,
                        )
                    except HomeworkTaskFileError as exc:
                        return Response({"error": exc.message, "code": exc.code}, status=exc.status_code)
                    created_pages = _add_pages_from_attachment(locked, created[0])
                else:
                    page = create_blank_page(locked)
                    page.page_type = HomeworkNotebookPageType.ATTACHMENT
                    page.background_file.save(uploaded.name or "page.jpg", uploaded, save=True)
                    created_pages = [page]
            elif kind == "blank":
                created_pages = [create_blank_page(locked)]
            elif kind == "duplicate":
                source_id = str(request.data.get("page_id") or "")
                source = locked.pages.filter(pk=source_id).first()
                if not source:
                    return Response({"error": "Страница не найдена."}, status=status.HTTP_404_NOT_FOUND)
                clone = HomeworkNotebookPage.objects.create(
                    notebook=locked,
                    page_number=_next_page_number(locked),
                    source_attachment=source.source_attachment,
                    page_type=source.page_type,
                    pdf_page_number=source.pdf_page_number,
                    width=source.width,
                    height=source.height,
                    state=deepcopy(source.state if isinstance(source.state, dict) else _empty_state()),
                )
                if source.background_file:
                    clone.background_file.save(
                        f"copy-{source.pk}.jpg",
                        ContentFile(source.background_file.read()),
                        save=True,
                    )
                created_pages = [clone]
            elif kind in ("attachment", "pdf_page"):
                attachment_id = str(request.data.get("attachment_id") or "")
                attachment = HomeworkAttachment.objects.filter(
                    pk=attachment_id,
                    submission=locked.submission,
                    is_deleted=False,
                ).first()
                if not attachment:
                    return Response({"error": "Файл не найден."}, status=status.HTTP_404_NOT_FOUND)
                created_pages = _add_pages_from_attachment(locked, attachment)
            else:
                return Response({"error": "Неизвестный тип страницы."}, status=status.HTTP_400_BAD_REQUEST)
            locked.version += 1
            locked.save(update_fields=["version", "updated_at"])
        return Response(
            {
                "pages": [serialize_page(page) for page in created_pages],
                "document": serialize_notebook(locked),
            },
            status=status.HTTP_201_CREATED,
        )


class HomeworkNotebookPageDeleteView(APIView):
    permission_classes = [IsAuthenticated]

    def delete(self, request, notebook_id, page_id):
        notebook = _notebook_or_404(notebook_id)
        if not notebook or not user_can_edit_notebook(request.user, notebook):
            return Response({"detail": "Нет доступа."}, status=status.HTTP_403_FORBIDDEN)
        with transaction.atomic():
            locked = HomeworkNotebook.objects.select_for_update().get(pk=notebook.pk)
            page = locked.pages.filter(pk=page_id).first()
            if not page:
                return Response({"error": "Страница не найдена."}, status=status.HTTP_404_NOT_FOUND)
            if locked.pages.count() <= 1:
                return Response({"error": "Нельзя удалить последнюю страницу."}, status=status.HTTP_400_BAD_REQUEST)
            page.delete()
            _renumber_pages(locked)
            locked.version += 1
            locked.save(update_fields=["version", "updated_at"])
        return Response({"ok": True, "document": serialize_notebook(locked)})


class HomeworkNotebookPageBackgroundView(APIView):
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser]

    def get(self, request, page_id):
        page = HomeworkNotebookPage.objects.select_related(
            "notebook", "notebook__submission", "notebook__submission__homework"
        ).filter(pk=page_id).first()
        if not page or not user_can_view_notebook(request.user, page.notebook):
            return Response({"detail": "Нет доступа."}, status=status.HTTP_404_NOT_FOUND)
        if page.background_file:
            from .submission_files import filefield_download_response

            return filefield_download_response(page.background_file, "page.jpg")
        if page.source_attachment_id:
            return file_response_for_attachment(page.source_attachment, inline=True)
        return Response({"error": "Фона нет."}, status=status.HTTP_404_NOT_FOUND)

    def post(self, request, page_id):
        page = HomeworkNotebookPage.objects.select_related(
            "notebook", "notebook__submission", "notebook__submission__homework"
        ).filter(pk=page_id).first()
        if not page or not user_can_edit_notebook(request.user, page.notebook):
            return Response({"detail": "Нет доступа."}, status=status.HTTP_403_FORBIDDEN)
        uploaded = request.FILES.get("file")
        if not uploaded:
            return Response({"error": "file required"}, status=status.HTTP_400_BAD_REQUEST)
        try:
            validate_uploaded_file(uploaded)
        except UploadValidationError as exc:
            return Response({"error": exc.message, "code": exc.code}, status=400)
        page.background_file.save(uploaded.name or "page.jpg", uploaded, save=True)
        return Response(serialize_page(page))


class HomeworkNotebookSubmitView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, notebook_id):
        notebook = _notebook_or_404(notebook_id)
        if not notebook or not user_can_edit_notebook(request.user, notebook):
            return Response({"detail": "Нет доступа."}, status=status.HTTP_403_FORBIDDEN)
        reason = HomeworkNotebookRevisionReason.STUDENT_SUBMIT
        new_status = HomeworkNotebookStatus.SUBMITTED
        if notebook.owner_role == HomeworkAttachmentOwnerRole.TEACHER:
            reason = HomeworkNotebookRevisionReason.TEACHER_RETURN
            new_status = HomeworkNotebookStatus.RETURNED
        export_bytes = None
        try:
            export_bytes = export_notebook_pdf(notebook)
        except Exception:
            logger.warning("notebook pdf export failed notebook=%s", notebook.id, exc_info=True)
        with transaction.atomic():
            locked = HomeworkNotebook.objects.select_for_update().get(pk=notebook.pk)
            revision = create_revision(
                locked,
                user=request.user,
                reason=reason,
                export_bytes=export_bytes,
                export_name="notebook.pdf",
            )
            locked.status = new_status
            if notebook.owner_role == HomeworkAttachmentOwnerRole.TEACHER:
                locked.published_revision = revision
            locked.save(update_fields=["status", "published_revision", "updated_at"])
        return Response(
            {
                "ok": True,
                "notebook": serialize_notebook(locked),
                "revision": serialize_revision(revision),
            }
        )


class HomeworkNotebookCompleteView(APIView):
    permission_classes = [IsAuthenticated]
    parser_classes = [JSONParser, MultiPartParser, FormParser]

    def post(self, request, notebook_id):
        notebook = _notebook_or_404(notebook_id)
        if not notebook or not user_can_edit_notebook(request.user, notebook):
            return Response({"detail": "Нет доступа."}, status=status.HTTP_403_FORBIDDEN)
        pages_payload = request.data.get("pages")
        if isinstance(pages_payload, str):
            import json

            try:
                pages_payload = json.loads(pages_payload)
            except json.JSONDecodeError:
                return Response({"error": "pages must be JSON"}, status=status.HTTP_400_BAD_REQUEST)
        if isinstance(pages_payload, list):
            try:
                version = int(request.data.get("version"))
            except (TypeError, ValueError):
                return Response({"error": "version required"}, status=status.HTTP_400_BAD_REQUEST)
            try:
                notebook = save_notebook_document(
                    notebook,
                    version=version,
                    pages=pages_payload,
                    user=request.user,
                    reason=HomeworkNotebookRevisionReason.MANUAL_SAVE,
                    snapshot=False,
                )
            except NotebookConflict as exc:
                return Response(
                    {"error": exc.message, "code": exc.code, **exc.extra},
                    status=exc.status_code,
                )
            except NotebookError as exc:
                return Response({"error": exc.message, "code": exc.code}, status=exc.status_code)
        uploaded_pages = list(request.FILES.getlist("pages") or request.FILES.getlist("page"))
        export_file = request.FILES.get("file")
        try:
            locked, revision, attachment = complete_notebook_with_export(
                notebook,
                user=request.user,
                uploaded_pages=uploaded_pages,
                export_file=export_file,
            )
        except HomeworkTaskFileError as exc:
            return Response({"error": exc.message, "code": exc.code}, status=exc.status_code)
        except Exception:
            logger.exception("notebook complete failed notebook=%s", notebook.id)
            return Response({"error": "Не удалось сформировать файл проверки."}, status=500)
        return Response(
            {
                "ok": True,
                "notebook": serialize_notebook(locked),
                "revision": serialize_revision(revision),
                "attachment": serialize_homework_task_attachment(attachment) if attachment else None,
                "task_attachments": grouped_task_attachments(locked.submission),
                "task_id": locked.task_key,
                "submission_id": locked.submission_id,
            }
        )


class HomeworkNotebookExportView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, notebook_id):
        notebook = _notebook_or_404(notebook_id)
        if not notebook or not user_can_view_notebook(request.user, notebook):
            return Response({"detail": "Нет доступа."}, status=status.HTTP_404_NOT_FOUND)
        try:
            pdf = export_notebook_pdf(notebook)
        except Exception as exc:
            logger.warning("notebook export failed: %s", exc, exc_info=True)
            return Response({"error": "Не удалось сформировать PDF."}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
        response = FileResponse(io.BytesIO(pdf), content_type="application/pdf")
        response["Content-Disposition"] = f'attachment; filename="notebook-{notebook.id}.pdf"'
        return response


class HomeworkNotebookRevisionExportView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, revision_id):
        revision = (
            HomeworkNotebookRevision.objects.select_related(
                "notebook", "notebook__submission", "notebook__submission__homework"
            )
            .filter(pk=revision_id)
            .first()
        )
        if not revision or not user_can_view_notebook(request.user, revision.notebook):
            return Response({"detail": "Нет доступа."}, status=status.HTTP_404_NOT_FOUND)
        if revision.export_file:
            from .submission_files import filefield_download_response

            return filefield_download_response(revision.export_file, "notebook.pdf")
        return Response({"error": "Экспорт ещё не создан."}, status=status.HTTP_404_NOT_FOUND)


class HomeworkNotebookPublishedView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, submission_id: int, task_id: str):
        submission = _submission_or_404(submission_id)
        if not submission or not user_can_view_submission(request.user, submission):
            return Response({"detail": "Нет доступа."}, status=status.HTTP_404_NOT_FOUND)
        notebook = HomeworkNotebook.objects.filter(
            submission=submission,
            task_key=str(task_id),
            owner_role=HomeworkAttachmentOwnerRole.TEACHER,
        ).first()
        if not notebook or not notebook.published_revision_id:
            return Response({"detail": "Проверенная работа ещё не отправлена."}, status=status.HTTP_404_NOT_FOUND)
        if not user_can_view_notebook(request.user, notebook):
            return Response({"detail": "Нет доступа."}, status=status.HTTP_403_FORBIDDEN)
        revision = notebook.published_revision
        return Response(
            {
                "notebook_id": str(notebook.id),
                "revision": serialize_revision(revision),
                "document": revision.snapshot,
            }
        )
