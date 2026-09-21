"""Нормализованные вложения заданий ДЗ. Source of truth — таблица HomeworkAttachment."""

from __future__ import annotations

import hashlib
import logging
import os
import uuid
from collections import defaultdict

from django.core.files.storage import default_storage
from django.db import transaction
from django.http import FileResponse
from django.utils import timezone
from rest_framework import status
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import AllowAny, IsAuthenticated  # noqa: F401
from rest_framework.response import Response
from rest_framework.views import APIView

from .choices import (
    HomeworkAttachmentOwnerRole,
    HomeworkAttachmentType,
    SubmissionStatus,
)
from .files_storage import content_disposition, sanitize_filename
from .models import Homework, HomeworkAttachment, HomeworkSubmission, HomeworkTask, Profile, Student
from .upload_validation import UploadValidationError, validate_uploaded_file

logger = logging.getLogger(__name__)

COMMENT_TASK_KEY = HomeworkAttachment.COMMENT_TASK_KEY
ATTACHMENT_PAYLOAD_KEYS = (
    "attachments_by_task_id",
    "attachments_by_number",
    "teacher_attachments_by_task_id",
    "teacher_attachments_by_number",
    "teacher_comment_attachments",
    "task_attachments",
)


class HomeworkTaskFileError(Exception):
    def __init__(self, message: str, code: str = "attachment_error", status_code: int = 400, extra=None):
        super().__init__(message)
        self.message = message
        self.code = code
        self.status_code = status_code
        self.extra = extra or {}


def _settings_max_count() -> int:
    from django.conf import settings

    return int(getattr(settings, "TASK_ATTACHMENT_MAX_COUNT", 20) or 20)


def strip_client_attachment_maps(payload: dict | None) -> dict:
    """Клиент не имеет права перезаписывать списки вложений через save-draft/submit."""
    data = dict(payload or {})
    for key in ATTACHMENT_PAYLOAD_KEYS:
        data.pop(key, None)
    return data


def _file_checksum_and_size(uploaded) -> tuple[str, int]:
    digest = hashlib.sha256()
    size = 0
    try:
        if hasattr(uploaded, "seek"):
            uploaded.seek(0)
    except Exception:
        pass
    chunks = uploaded.chunks() if hasattr(uploaded, "chunks") else [uploaded.read()]
    for chunk in chunks:
        if not chunk:
            continue
        digest.update(chunk)
        size += len(chunk)
    try:
        if hasattr(uploaded, "seek"):
            uploaded.seek(0)
    except Exception:
        pass
    return digest.hexdigest(), size


def resolve_homework_task(homework: Homework, task_key: str) -> HomeworkTask | None:
    key = str(task_key or "").strip()
    if not key or key == COMMENT_TASK_KEY:
        return None
    if key.isdigit():
        found = homework.tasks.filter(pk=int(key)).first()
        if found:
            return found
    matches = list(homework.tasks.filter(task_id=key)[:2])
    if len(matches) == 1:
        return matches[0]
    return None


def attachment_file_url(attachment: HomeworkAttachment) -> str:
    return f"/api/homework/attachments/{attachment.id}/file/"


def serialize_homework_task_attachment(attachment: HomeworkAttachment) -> dict:
    filename = attachment.original_filename or (
        os.path.basename(attachment.file.name) if attachment.file else ""
    ) or "Файл"
    url = attachment_file_url(attachment)
    if not attachment.file and attachment.legacy_url:
        url = attachment.legacy_url
    mime = attachment.mime_type or ""
    return {
        "id": str(attachment.id),
        "task_id": attachment.task_key,
        "task_number": attachment.task_number,
        "filename": filename,
        "name": filename,
        "url": url,
        "mime_type": mime,
        "content_type": mime,
        "file_size": attachment.file_size,
        "checksum": attachment.checksum,
        "owner_role": attachment.owner_role,
        "attachment_type": attachment.attachment_type,
        "created_at": attachment.created_at.isoformat() if attachment.created_at else None,
    }


def public_attachment_from_row(attachment: HomeworkAttachment) -> dict:
    item = serialize_homework_task_attachment(attachment)
    return {
        "id": item["id"],
        "url": item["url"],
        "filename": item["filename"],
        "name": item["filename"],
        "content_type": item["content_type"],
    }


def _active_qs(submission: HomeworkSubmission):
    return HomeworkAttachment.objects.filter(submission=submission, is_deleted=False)


def _variant_number_to_task_ids(homework: Homework | None) -> dict[str, list[str]]:
    """number → id заданий варианта. Нужен, чтобы старые файлы с ключом-номером не пропали."""
    mapping: dict[str, list[str]] = defaultdict(list)
    if homework is None:
        return mapping
    try:
        from .homework_api import extract_variant_id
        from .meeting_present import _variant_tasks_answer_key
    except Exception:
        return mapping
    seen_ids: set[str] = set()
    for hw_task in homework.tasks.filter(is_active=True):
        variant_id = extract_variant_id(hw_task.description or "")
        if not variant_id:
            continue
        for task in _variant_tasks_answer_key(variant_id):
            task_id = str(task.get("id") or "").strip()
            number = str(task.get("number") or "").strip()
            if not task_id or not number or task_id in seen_ids:
                continue
            seen_ids.add(task_id)
            if task_id not in mapping[number]:
                mapping[number].append(task_id)
    return mapping


def _alias_legacy_number_buckets(tasks: dict[str, dict], homework: Homework | None) -> dict[str, dict]:
    """Файлы, сохранённые только под номером задания, показываем и по task_id."""
    mapping = _variant_number_to_task_ids(homework)
    if not mapping:
        return tasks
    variant_ids = {task_id for ids in mapping.values() for task_id in ids}
    for key, bucket in list(tasks.items()):
        if key in variant_ids:
            continue
        for task_id in mapping.get(str(key), []):
            dest = tasks.setdefault(task_id, {"student": [], "teacher": []})
            for role in ("student", "teacher"):
                seen = {item.get("id") for item in dest[role]}
                for item in bucket.get(role) or []:
                    ident = item.get("id")
                    if ident and ident in seen:
                        continue
                    dest[role].append(item)
                    if ident:
                        seen.add(ident)
    return tasks


def grouped_task_attachments(submission: HomeworkSubmission | None) -> dict:
    """Плоская группировка: {task_key: {student: [...], teacher: [...]}}."""
    tasks: dict[str, dict] = {}
    if submission is None:
        return {"tasks": tasks, "comment": []}
    rows = _active_qs(submission).order_by("created_at", "id")
    comment = []
    for row in rows:
        if row.attachment_type == HomeworkAttachmentType.NOTEBOOK_SOURCE:
            continue
        item = serialize_homework_task_attachment(row)
        if row.task_key == COMMENT_TASK_KEY:
            comment.append(item)
            continue
        bucket = tasks.setdefault(row.task_key, {"student": [], "teacher": []})
        if row.owner_role == HomeworkAttachmentOwnerRole.TEACHER:
            bucket["teacher"].append(item)
        else:
            bucket["student"].append(item)
    tasks = _alias_legacy_number_buckets(tasks, submission.homework)
    return {"tasks": tasks, "comment": comment}


def payload_maps_from_rows(submission: HomeworkSubmission) -> dict:
    by_id: dict[str, list] = defaultdict(list)
    teacher_by_id: dict[str, list] = defaultdict(list)
    comments: list[dict] = []
    for row in _active_qs(submission).order_by("created_at", "id"):
        if row.attachment_type == HomeworkAttachmentType.NOTEBOOK_SOURCE:
            continue
        entry = public_attachment_from_row(row)
        if row.task_key == COMMENT_TASK_KEY:
            comments.append(entry)
            continue
        if row.owner_role == HomeworkAttachmentOwnerRole.TEACHER:
            teacher_by_id[row.task_key].append(entry)
        else:
            by_id[row.task_key].append(entry)
    maps = {
        "attachments_by_task_id": dict(by_id),
        "attachments_by_number": {},
        "teacher_attachments_by_task_id": dict(teacher_by_id),
        "teacher_attachments_by_number": {},
        "teacher_comment_attachments": comments,
    }
    return maps


def _apply_attachment_maps(payload: dict, maps: dict) -> dict:
    data = dict(payload or {})
    for key, value in maps.items():
        if value:
            data[key] = value
        else:
            data.pop(key, None)
    return data


def overlay_payload_attachments(submission: HomeworkSubmission | None, payload: dict | None) -> dict:
    data = dict(payload or {})
    if submission is None:
        return data
    maps = payload_maps_from_rows(submission)
    data = _apply_attachment_maps(data, maps)
    data["task_attachments"] = grouped_task_attachments(submission)
    return data


def sync_payload_attachment_maps(submission: HomeworkSubmission) -> dict:
    payload = dict(submission.result_payload or {})
    maps = payload_maps_from_rows(submission)
    payload = _apply_attachment_maps(payload, maps)
    payload["task_attachments"] = grouped_task_attachments(submission)
    submission.result_payload = payload
    return payload


def user_can_view_submission(user, submission: HomeworkSubmission) -> bool:
    if not user or not getattr(user, "is_authenticated", False) or submission is None:
        return False
    homework = submission.homework
    if homework.teacher_id == user.id:
        return True
    profile = getattr(user, "profile", None)
    role = getattr(profile, "role", None)
    if role == Profile.Role.STUDENT:
        return Student.objects.filter(user=user, pk=submission.student_id).exists()
    if role == Profile.Role.PARENT:
        try:
            from .parent_models import ParentRelationshipStatus, ParentStudentRelationship

            rels = ParentStudentRelationship.objects.filter(
                parent=user,
                student_id=submission.student_id,
                status=ParentRelationshipStatus.ACTIVE,
            )
            return any(rel.has_permission("view_homework") for rel in rels)
        except Exception:
            return False
    return bool(getattr(user, "is_staff", False) or getattr(user, "is_superuser", False))


def user_can_write_student_files(user, submission: HomeworkSubmission) -> bool:
    if not user_can_view_submission(user, submission):
        return False
    profile = getattr(user, "profile", None)
    if getattr(profile, "role", None) != Profile.Role.STUDENT:
        return False
    if not Student.objects.filter(user=user, pk=submission.student_id).exists():
        return False
    if submission.status == SubmissionStatus.CHECKED:
        return False
    if submission.submitted_at and submission.status not in (
        SubmissionStatus.RETURNED,
        SubmissionStatus.NEEDS_REVISION,
    ):
        return False
    return True


def user_can_write_teacher_files(user, submission: HomeworkSubmission) -> bool:
    return bool(user and submission and submission.homework.teacher_id == getattr(user, "id", None))


def _legacy_url_to_storage_path(file_url: str) -> str:
    from urllib.parse import urlparse

    from django.conf import settings

    text = (file_url or "").strip()
    if not text:
        return ""
    media_url = (settings.MEDIA_URL or "/media/").rstrip("/") + "/"
    if text.startswith(media_url):
        return text[len(media_url) :].lstrip("/")
    parsed = urlparse(text)
    if parsed.path.startswith("/media/"):
        return parsed.path[len("/media/") :].lstrip("/")
    return ""


def _json_entry_id(item: dict) -> str:
    return str(item.get("id") or "").strip()


def _legacy_task_key_for_number(submission: HomeworkSubmission, number: str) -> tuple[str, str]:
    """Подбирает task_id, если номер однозначен. Иначе оставляет номер — файл не теряем."""
    num = str(number or "").strip()
    mapping = _variant_number_to_task_ids(submission.homework)
    matches = mapping.get(num) or []
    if len(matches) == 1:
        return matches[0], "resolved_unique_number"
    if len(matches) > 1:
        return num, "shared_number_kept"
    return num, "number_as_key"


def _clip(value, limit: int) -> str:
    return str(value or "")[:limit]


def migrate_submission_payload_attachments(submission: HomeworkSubmission) -> dict:
    """Создаёт HomeworkAttachment из JSON. Каждое вложение сохраняется, ничего не удаляется."""
    payload = submission.result_payload if isinstance(submission.result_payload, dict) else {}
    report = {
        "submission_id": submission.pk,
        "created": 0,
        "skipped_existing": 0,
        "ambiguous": [],
        "notes": [],
    }
    existing_ids = {
        str(value)
        for value in HomeworkAttachment.objects.filter(submission=submission).values_list("id", flat=True)
    }
    existing_urls = {
        (row.owner_role, row.legacy_url)
        for row in HomeworkAttachment.objects.filter(submission=submission).only("owner_role", "legacy_url")
        if row.legacy_url
    }

    def _ingest(items, *, task_key: str, task_number: str, teacher: bool, comment: bool = False):
        if not isinstance(items, list):
            return
        for item in items:
            if not isinstance(item, dict):
                report["ambiguous"].append(
                    {
                        "reason": "non_object_entry",
                        "task_key": task_key,
                        "item": str(item)[:200],
                    }
                )
                continue
            url = str(item.get("url") or "").strip()
            filename = str(item.get("filename") or item.get("name") or "")
            raw_id = _json_entry_id(item)
            if raw_id and raw_id in existing_ids:
                report["skipped_existing"] += 1
                continue
            owner_role = (
                HomeworkAttachmentOwnerRole.TEACHER
                if teacher or comment
                else HomeworkAttachmentOwnerRole.STUDENT
            )
            if url and (owner_role, url) in existing_urls:
                report["skipped_existing"] += 1
                continue
            if not url and not filename:
                report["ambiguous"].append(
                    {
                        "reason": "empty_entry",
                        "task_key": task_key,
                        "item": item,
                    }
                )
                continue
            pk = None
            if raw_id:
                try:
                    pk = uuid.UUID(raw_id)
                except ValueError:
                    pk = uuid.uuid4()
            storage_path = _legacy_url_to_storage_path(url)
            attachment_type = HomeworkAttachmentType.STUDENT_ANSWER
            resolved_key = task_key
            if comment:
                attachment_type = HomeworkAttachmentType.TEACHER_COMMENT
                resolved_key = COMMENT_TASK_KEY
            elif teacher:
                attachment_type = HomeworkAttachmentType.TEACHER_CHECKED_FILE
            row = HomeworkAttachment(
                id=pk or uuid.uuid4(),
                submission=submission,
                homework_id=submission.homework_id,
                homework_task=resolve_homework_task(submission.homework, resolved_key),
                task_key=_clip(resolved_key, 255),
                task_number=_clip(task_number, 64),
                uploaded_by=None,
                owner_role=owner_role,
                attachment_type=attachment_type,
                original_filename=_clip(filename, 255),
                mime_type=_clip(item.get("content_type") or "", 128),
                storage_path=_clip(storage_path, 512),
                legacy_url=_clip(url, 1024),
            )
            file_max = min(HomeworkAttachment._meta.get_field("file").max_length or 100, 1024)
            if storage_path and len(storage_path) <= file_max and default_storage.exists(storage_path):
                row.file.name = storage_path
                try:
                    row.file_size = default_storage.size(storage_path)
                except Exception:
                    row.file_size = 0
            try:
                row.save()
            except Exception:
                row.file = None
                row.task_key = _clip(resolved_key, 64)
                row.task_number = _clip(task_number, 32)
                row.original_filename = _clip(filename, 255)
                row.save()
            existing_ids.add(str(row.id))
            if url:
                existing_urls.add((owner_role, url))
            report["created"] += 1

    student_by_id = payload.get("attachments_by_task_id") or {}
    student_by_num = payload.get("attachments_by_number") or {}
    teacher_by_id = payload.get("teacher_attachments_by_task_id") or {}
    teacher_by_num = payload.get("teacher_attachments_by_number") or {}

    ingested_ids: set[str] = set()
    ingested_urls: set[tuple[str, str]] = set()

    def _mark(items, *, teacher: bool):
        role = HomeworkAttachmentOwnerRole.TEACHER if teacher else HomeworkAttachmentOwnerRole.STUDENT
        if not isinstance(items, list):
            return
        for item in items:
            if not isinstance(item, dict):
                continue
            item_id = _json_entry_id(item)
            if item_id:
                ingested_ids.add(item_id)
            url = str(item.get("url") or "").strip()
            if url:
                ingested_urls.add((role, url))

    if isinstance(student_by_id, dict):
        for key, items in student_by_id.items():
            _ingest(items, task_key=str(key), task_number="", teacher=False)
            _mark(items, teacher=False)
    if isinstance(teacher_by_id, dict):
        for key, items in teacher_by_id.items():
            _ingest(items, task_key=str(key), task_number="", teacher=True)
            _mark(items, teacher=True)

    def _ingest_number_map(by_num, *, teacher: bool):
        if not isinstance(by_num, dict):
            return
        role = HomeworkAttachmentOwnerRole.TEACHER if teacher else HomeworkAttachmentOwnerRole.STUDENT
        for num, items in by_num.items():
            unique = []
            for item in items or []:
                if not isinstance(item, dict):
                    report["ambiguous"].append(
                        {
                            "reason": "non_object_entry",
                            "task_number": str(num),
                            "item": str(item)[:200],
                        }
                    )
                    continue
                item_id = _json_entry_id(item)
                url = str(item.get("url") or "").strip()
                if item_id and item_id in ingested_ids:
                    continue
                if url and (role, url) in ingested_urls:
                    continue
                unique.append(item)
            if not unique:
                continue
            task_key, note = _legacy_task_key_for_number(submission, str(num))
            report["notes"].append(
                {
                    "task_number": str(num),
                    "task_key": task_key,
                    "reason": note,
                    "owner_role": "teacher" if teacher else "student",
                    "count": len(unique),
                }
            )
            _ingest(unique, task_key=task_key, task_number=str(num), teacher=teacher)
            _mark(unique, teacher=teacher)

    _ingest_number_map(student_by_num, teacher=False)
    _ingest_number_map(teacher_by_num, teacher=True)

    comments = payload.get("teacher_comment_attachments") or []
    _ingest(comments, task_key=COMMENT_TASK_KEY, task_number="", teacher=True, comment=True)
    return report


def ensure_payload_migrated(submission: HomeworkSubmission) -> None:
    payload = submission.result_payload if isinstance(submission.result_payload, dict) else {}
    has_json = any(
        payload.get(key)
        for key in ATTACHMENT_PAYLOAD_KEYS
        if key != "task_attachments"
    )
    if not has_json:
        return
    migrate_submission_payload_attachments(submission)


def count_task_db_attachments(
    submission: HomeworkSubmission,
    *,
    task_key: str,
    teacher: bool,
) -> int:
    role = HomeworkAttachmentOwnerRole.TEACHER if teacher else HomeworkAttachmentOwnerRole.STUDENT
    return (
        _active_qs(submission)
        .filter(task_key=task_key, owner_role=role)
        .exclude(attachment_type=HomeworkAttachmentType.NOTEBOOK_SOURCE)
        .count()
    )


def create_task_attachments(
    *,
    submission: HomeworkSubmission,
    uploaded_files: list,
    task_key: str,
    task_number: str = "",
    user,
    teacher: bool,
    comment: bool = False,
    rel_prefix: str = "",
    attachment_type: str | None = None,
) -> list[HomeworkAttachment]:
    task_key = str(task_key or "").strip()
    if comment:
        task_key = COMMENT_TASK_KEY
    if not task_key:
        raise HomeworkTaskFileError("task_id required", code="TASK_ID_REQUIRED", status_code=400)
    max_count = _settings_max_count()
    if len(uploaded_files) > max_count:
        raise HomeworkTaskFileError(
            f"Слишком много файлов. Максимум {max_count}.",
            code="TOO_MANY_FILES",
        )
    existing = count_task_db_attachments(submission, task_key=task_key, teacher=teacher or comment)
    if existing + len(uploaded_files) > max_count:
        raise HomeworkTaskFileError(
            f"Слишком много файлов к заданию. Максимум {max_count}.",
            code="TOO_MANY_FILES",
        )
    homework = submission.homework
    homework_task = resolve_homework_task(homework, task_key)
    created = []
    from .files_services import FileServiceError, assert_quota_allows, lock_user_storage

    total_size = 0
    for uploaded in uploaded_files:
        total_size += int(getattr(uploaded, "size", 0) or 0)

    with transaction.atomic():
        if user and total_size:
            try:
                lock_user_storage(user)
                assert_quota_allows(user, total_size)
            except FileServiceError as exc:
                raise HomeworkTaskFileError(
                    exc.message,
                    code=exc.code,
                    status_code=exc.status,
                    extra=exc.extra,
                ) from exc

        for uploaded in uploaded_files:
            validate_uploaded_file(uploaded)
            checksum, size = _file_checksum_and_size(uploaded)
            filename = sanitize_filename(getattr(uploaded, "name", "") or "file")
            mime = str(getattr(uploaded, "content_type", "") or "").split(";")[0].strip()
            owner_role = (
                HomeworkAttachmentOwnerRole.TEACHER
                if teacher or comment
                else HomeworkAttachmentOwnerRole.STUDENT
            )
            if attachment_type:
                chosen_type = attachment_type
            elif comment:
                chosen_type = HomeworkAttachmentType.TEACHER_COMMENT
            elif teacher:
                chosen_type = HomeworkAttachmentType.TEACHER_CHECKED_FILE
            else:
                chosen_type = HomeworkAttachmentType.STUDENT_ANSWER
            row = HomeworkAttachment(
                submission=submission,
                homework=homework,
                homework_task=homework_task,
                task_key=task_key,
                task_number=str(task_number or ""),
                uploaded_by=user if getattr(user, "is_authenticated", False) else None,
                owner_role=owner_role,
                attachment_type=chosen_type,
                original_filename=filename,
                mime_type=mime,
                file_size=size,
                checksum=checksum,
            )
            row.file.save(filename, uploaded, save=False)
            if row.file and row.file.name:
                row.storage_path = row.file.name
            row.save()
            created.append(row)
        sync_payload_attachment_maps(submission)
        submission.save(update_fields=["result_payload", "updated_at"])
    return created


def attachment_is_referenced(attachment: HomeworkAttachment) -> bool:
    from .models import HomeworkNotebookPage, HomeworkNotebookRevision

    if HomeworkNotebookPage.objects.filter(source_attachment=attachment).exists():
        return True
    ident = str(attachment.id)
    for revision in HomeworkNotebookRevision.objects.filter(
        notebook__submission=attachment.submission
    ).only("snapshot"):
        snap = revision.snapshot if isinstance(revision.snapshot, dict) else {}
        blob = str(snap)
        if ident in blob:
            return True
    return False


def soft_delete_attachment(attachment: HomeworkAttachment, *, actor) -> None:
    if attachment.is_deleted:
        return
    referenced = attachment_is_referenced(attachment)
    attachment.is_deleted = True
    attachment.deleted_at = timezone.now()
    attachment.save(update_fields=["is_deleted", "deleted_at", "updated_at"])
    if not referenced and attachment.file:
        path = attachment.file.name or attachment.storage_path
        others = HomeworkAttachment.objects.filter(is_deleted=False).exclude(pk=attachment.pk)
        still_used = False
        if path:
            still_used = others.filter(file=path).exists() or others.filter(storage_path=path).exists()
        if path and not still_used and default_storage.exists(path):

            def _delete(storage_name=path):
                try:
                    default_storage.delete(storage_name)
                except Exception:
                    logger.warning("homework attachment file delete failed path=%s", storage_name)

            transaction.on_commit(_delete)
    sync_payload_attachment_maps(attachment.submission)
    attachment.submission.save(update_fields=["result_payload", "updated_at"])


def find_attachment_for_delete(
    submission: HomeworkSubmission,
    *,
    attachment_id: str = "",
    file_url: str = "",
    teacher: bool | None = None,
) -> HomeworkAttachment | None:
    qs = _active_qs(submission)
    if teacher is True:
        qs = qs.filter(owner_role=HomeworkAttachmentOwnerRole.TEACHER)
    elif teacher is False:
        qs = qs.filter(owner_role=HomeworkAttachmentOwnerRole.STUDENT)
    if attachment_id:
        try:
            pk = uuid.UUID(str(attachment_id))
        except ValueError:
            pk = None
        if pk:
            found = qs.filter(pk=pk).first()
            if found:
                return found
    if file_url:
        path = _legacy_url_to_storage_path(file_url)
        found = qs.filter(legacy_url=file_url).first()
        if found:
            return found
        if path:
            found = qs.filter(storage_path=path).first() or qs.filter(file=path).first()
            if found:
                return found
        suffix = file_url.split("attachments/")[-1].strip("/") if "attachments/" in file_url else ""
        if suffix:
            ident = suffix.split("/")[0]
            try:
                found = qs.filter(pk=uuid.UUID(ident)).first()
                if found:
                    return found
            except ValueError:
                pass
    return None


def file_response_for_attachment(attachment: HomeworkAttachment, *, inline: bool = False):
    from .submission_files import filefield_download_response

    name = attachment.original_filename or "file"
    if attachment.file:
        try:
            fh = attachment.file.open("rb")
        except Exception:
            return Response({"error": "Файл недоступен."}, status=status.HTTP_404_NOT_FOUND)
        import mimetypes

        content_type = attachment.mime_type or mimetypes.guess_type(name)[0] or "application/octet-stream"
        response = FileResponse(fh, content_type=content_type)
        response["Content-Disposition"] = content_disposition(name, inline=inline)
        return response
    if attachment.storage_path and default_storage.exists(attachment.storage_path):
        fh = default_storage.open(attachment.storage_path, "rb")
        import mimetypes

        content_type = attachment.mime_type or mimetypes.guess_type(name)[0] or "application/octet-stream"
        response = FileResponse(fh, content_type=content_type)
        response["Content-Disposition"] = content_disposition(name, inline=inline)
        return response
    return Response({"error": "Файл не найден."}, status=status.HTTP_404_NOT_FOUND)


def _resolve_submission_for_request(request, submission_id: int) -> tuple[HomeworkSubmission | None, Response | None]:
    submission = (
        HomeworkSubmission.objects.select_related("homework", "student", "student__user")
        .filter(pk=submission_id)
        .first()
    )
    if not submission:
        return None, Response({"detail": "Сдача не найдена."}, status=status.HTTP_404_NOT_FOUND)
    if not user_can_view_submission(request.user, submission):
        return None, Response({"detail": "Нет доступа."}, status=status.HTTP_403_FORBIDDEN)
    return submission, None


class HomeworkSubmissionAttachmentsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, submission_id: int):
        submission, err = _resolve_submission_for_request(request, submission_id)
        if err:
            return err
        ensure_payload_migrated(submission)
        grouped = grouped_task_attachments(submission)
        return Response(grouped)


class HomeworkSubmissionTaskAttachmentsView(APIView):
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request, submission_id: int, task_id: str):
        from .homework_api import collect_request_files

        task_key = str(task_id or "").strip()
        if not task_key:
            return Response({"error": "task_id required"}, status=status.HTTP_400_BAD_REQUEST)
        uploaded = collect_request_files(request)
        if not uploaded:
            return Response({"error": "file required"}, status=status.HTTP_400_BAD_REQUEST)
        comment = str(request.data.get("attachment_type") or "") == HomeworkAttachmentType.TEACHER_COMMENT
        try:
            with transaction.atomic():
                submission = (
                    HomeworkSubmission.objects.select_for_update()
                    .filter(pk=submission_id)
                    .first()
                )
                if not submission:
                    return Response({"detail": "Сдача не найдена."}, status=status.HTTP_404_NOT_FOUND)
                profile = getattr(request.user, "profile", None)
                teacher = getattr(profile, "role", None) == Profile.Role.TEACHER
                if teacher:
                    if not user_can_write_teacher_files(request.user, submission):
                        return Response({"detail": "Нет доступа."}, status=status.HTTP_403_FORBIDDEN)
                else:
                    if not user_can_write_student_files(request.user, submission):
                        return Response(
                            {"error": "Работа уже отправлена на проверку."},
                            status=status.HTTP_403_FORBIDDEN,
                        )
                ensure_payload_migrated(submission)
                rows = create_task_attachments(
                    submission=submission,
                    uploaded_files=uploaded,
                    task_key=task_key,
                    task_number=str(request.data.get("task_number") or ""),
                    user=request.user,
                    teacher=teacher,
                    comment=comment and teacher,
                )
        except UploadValidationError as exc:
            return Response({"error": exc.message, "code": exc.code}, status=status.HTTP_400_BAD_REQUEST)
        except HomeworkTaskFileError as exc:
            payload = {"error": exc.message, "detail": exc.message, "code": exc.code}
            payload.update(exc.extra or {})
            return Response(payload, status=exc.status_code)
        first = serialize_homework_task_attachment(rows[0])
        return Response(
            {
                "ok": True,
                **first,
                "submission_id": submission.pk,
                "attachments": [serialize_homework_task_attachment(row) for row in rows],
            },
            status=status.HTTP_201_CREATED,
        )


class HomeworkAttachmentDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, attachment_id):
        attachment = (
            HomeworkAttachment.objects.select_related("submission", "submission__homework")
            .filter(pk=attachment_id, is_deleted=False)
            .first()
        )
        if not attachment or not user_can_view_submission(request.user, attachment.submission):
            return Response({"detail": "Нет доступа."}, status=status.HTTP_404_NOT_FOUND)
        return Response(serialize_homework_task_attachment(attachment))

    def delete(self, request, attachment_id):
        with transaction.atomic():
            found = (
                HomeworkAttachment.objects.filter(pk=attachment_id, is_deleted=False)
                .only("id", "submission_id")
                .first()
            )
            if not found:
                return Response({"error": "Файл не найден."}, status=status.HTTP_404_NOT_FOUND)
            submission = (
                HomeworkSubmission.objects.select_for_update()
                .filter(pk=found.submission_id)
                .first()
            )
            attachment = (
                HomeworkAttachment.objects.select_for_update()
                .filter(pk=attachment_id, is_deleted=False)
                .first()
            )
            if not submission or not attachment:
                return Response({"error": "Файл не найден."}, status=status.HTTP_404_NOT_FOUND)
            if attachment.owner_role == HomeworkAttachmentOwnerRole.STUDENT:
                if not user_can_write_student_files(request.user, submission):
                    return Response({"detail": "Нет доступа."}, status=status.HTTP_403_FORBIDDEN)
            else:
                if not user_can_write_teacher_files(request.user, submission):
                    return Response({"detail": "Нет доступа."}, status=status.HTTP_403_FORBIDDEN)
            attachment.submission = submission
            soft_delete_attachment(attachment, actor=request.user)
        return Response({"ok": True, "deleted_id": str(attachment_id)})


class HomeworkAttachmentFileView(APIView):
    permission_classes = [AllowAny]

    def get(self, request, attachment_id):
        attachment = (
            HomeworkAttachment.objects.select_related("submission", "submission__homework", "submission__student")
            .filter(pk=attachment_id, is_deleted=False)
            .first()
        )
        if not attachment:
            return Response({"error": "Файл не найден."}, status=status.HTTP_404_NOT_FOUND)
        user = request.user
        allowed = user_can_view_submission(user, attachment.submission)
        if not allowed:
            from .homework_api import _token_from_request, decode_homework_token

            token = _token_from_request(request)
            if token:
                payload = decode_homework_token(token)
                student_user_id = (payload or {}).get("student_user_id") or (payload or {}).get("studentUserId")
                if student_user_id and int(student_user_id) == int(attachment.submission.student.user_id or 0):
                    allowed = True
        if not allowed:
            return Response({"detail": "Нет доступа."}, status=status.HTTP_403_FORBIDDEN)
        mime = (attachment.mime_type or "").lower()
        inline = mime.startswith("image/") or mime == "application/pdf" or request.query_params.get("inline") == "1"
        return file_response_for_attachment(attachment, inline=inline)
