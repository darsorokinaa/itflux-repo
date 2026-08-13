"""Несколько файлов в сдаче ручного ДЗ: первый в FileField, остальные — связанные вложения."""

from __future__ import annotations

import mimetypes

from django.conf import settings
from django.http import FileResponse
from rest_framework import status
from rest_framework.response import Response

from .files_storage import content_disposition, sanitize_filename
from .models import HomeworkSubmission, HomeworkSubmissionAttachment
from .upload_validation import UploadValidationError, validate_uploaded_file

SUBMISSION_ATTACHMENT_MAX_COUNT = int(getattr(settings, "SUBMISSION_ATTACHMENT_MAX_COUNT", 20))


def collect_uploaded_submission_files(request) -> list:
    files = []
    seen = set()
    for key in ("attached_file", "attached_files", "file"):
        for uploaded in request.FILES.getlist(key):
            ident = id(uploaded)
            if ident in seen:
                continue
            seen.add(ident)
            files.append(uploaded)
    return files


def submission_has_files(submission: HomeworkSubmission | None) -> bool:
    if not submission:
        return False
    try:
        if submission.attached_file and submission.attached_file.name:
            return True
    except Exception:
        pass
    cache = getattr(submission, "_prefetched_objects_cache", None) or {}
    if "file_attachments" in cache:
        return bool(cache["file_attachments"])
    manager = getattr(submission, "file_attachments", None)
    if manager is None:
        return False
    return manager.exists()


def extra_attachment_api_url(
    attachment: HomeworkSubmissionAttachment,
    *,
    for_student: bool,
    homework_id: int | None = None,
) -> str:
    hw_id = homework_id
    if hw_id is None:
        hw_id = getattr(getattr(attachment, "submission", None), "homework_id", None)
    if for_student and hw_id:
        return f"/api/cabinet/student/assignments/{hw_id}/attached-files/{attachment.pk}/"
    return f"/api/cabinet/homework/submissions/{attachment.submission_id}/attached-files/{attachment.pk}/"


def serialize_submission_files(submission: HomeworkSubmission | None, *, for_student: bool = True) -> list[dict]:
    if not submission:
        return []

    from .files_models import CabinetFileRelation, CabinetFileRelationType
    from .files_services import submission_file_url

    items: list[dict] = []
    rel = (
        CabinetFileRelation.objects.filter(
            submission=submission,
            relation_type=CabinetFileRelationType.SUBMISSION,
        )
        .select_related("file")
        .first()
    )
    name = ""
    if rel and rel.file_id:
        name = rel.file.display_name or rel.file.original_name or ""
    elif submission.attached_file:
        name = submission.attached_file.name.split("/")[-1]
    url = submission_file_url(submission, for_student=for_student)
    if url or name:
        items.append({
            "id": "main",
            "name": name or "Файл",
            "url": url,
        })

    attachments = submission.file_attachments.all()
    if hasattr(attachments, "order_by"):
        attachments = attachments.order_by("id")
    for att in attachments:
        if not att.file:
            continue
        att_name = att.original_name or (att.file.name.split("/")[-1] if att.file.name else "Файл")
        items.append({
            "id": att.id,
            "name": att_name or "Файл",
            "url": extra_attachment_api_url(
                att,
                for_student=for_student,
                homework_id=submission.homework_id,
            ),
        })
    return items


def validate_submission_uploads(uploaded_files: list) -> None:
    if len(uploaded_files) > SUBMISSION_ATTACHMENT_MAX_COUNT:
        raise UploadValidationError(
            f"Слишком много файлов. Максимум {SUBMISSION_ATTACHMENT_MAX_COUNT}.",
            code="TOO_MANY_FILES",
        )
    for uploaded in uploaded_files:
        validate_uploaded_file(uploaded)


def save_submission_files(submission: HomeworkSubmission, uploaded_files: list) -> None:
    if not uploaded_files:
        return
    first, *rest = uploaded_files
    try:
        if hasattr(first, "seek"):
            first.seek(0)
    except Exception:
        pass
    submission.attached_file = first
    submission.save()
    for uploaded in rest:
        try:
            if hasattr(uploaded, "seek"):
                uploaded.seek(0)
        except Exception:
            pass
        original = sanitize_filename(getattr(uploaded, "name", "") or "file")
        HomeworkSubmissionAttachment.objects.create(
            submission=submission,
            file=uploaded,
            original_name=original,
        )
    cache = getattr(submission, "_prefetched_objects_cache", None)
    if cache is not None:
        cache.pop("file_attachments", None)


def filefield_download_response(file_field, download_name: str = ""):
    if not file_field:
        return Response({"error": "Файл не найден."}, status=status.HTTP_404_NOT_FOUND)
    try:
        fh = file_field.open("rb")
    except Exception:
        return Response({"error": "Файл недоступен."}, status=status.HTTP_404_NOT_FOUND)
    name = download_name or (file_field.name.split("/")[-1] if file_field.name else "file") or "file"
    content_type = mimetypes.guess_type(name)[0] or "application/octet-stream"
    response = FileResponse(fh, content_type=content_type)
    response["Content-Disposition"] = content_disposition(name, inline=False)
    return response
