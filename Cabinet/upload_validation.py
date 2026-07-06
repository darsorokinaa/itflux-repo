"""Validation for user-uploaded files in cabinet."""

import os

from django.conf import settings

MAX_UPLOAD_BYTES = int(getattr(settings, "CABINET_MAX_UPLOAD_BYTES", 20 * 1024 * 1024))

ALLOWED_UPLOAD_EXTENSIONS = frozenset({
    ".pdf", ".png", ".jpg", ".jpeg", ".gif", ".webp",
    ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
    ".txt", ".zip",
})

ALLOWED_UPLOAD_CONTENT_TYPES = frozenset({
    "application/pdf",
    "image/png", "image/jpeg", "image/gif", "image/webp",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "text/plain",
    "application/zip",
    "application/x-zip-compressed",
})

ALLOWED_IMAGE_EXTENSIONS = frozenset({
    ".png", ".jpg", ".jpeg", ".gif", ".webp",
})

ALLOWED_IMAGE_CONTENT_TYPES = frozenset({
    "image/png", "image/jpeg", "image/gif", "image/webp",
})


class UploadValidationError(Exception):
    def __init__(self, message: str, code: str = "INVALID_UPLOAD"):
        super().__init__(message)
        self.message = message
        self.code = code


def validate_uploaded_file(uploaded) -> None:
    if not uploaded:
        raise UploadValidationError("Файл не передан", "FILE_REQUIRED")

    size = getattr(uploaded, "size", None)
    if size is not None and size > MAX_UPLOAD_BYTES:
        mb = MAX_UPLOAD_BYTES // (1024 * 1024)
        raise UploadValidationError(f"Файл слишком большой (макс. {mb} МБ)", "FILE_TOO_LARGE")

    name = getattr(uploaded, "name", "") or "file"
    ext = os.path.splitext(name)[1].lower()
    if ext not in ALLOWED_UPLOAD_EXTENSIONS:
        raise UploadValidationError(
            f"Тип файла не поддерживается ({ext or 'без расширения'})",
            "FILE_TYPE_NOT_ALLOWED",
        )

    content_type = (getattr(uploaded, "content_type", "") or "").split(";", 1)[0].strip().lower()
    if content_type and content_type not in ALLOWED_UPLOAD_CONTENT_TYPES:
        raise UploadValidationError("Недопустимый тип содержимого файла", "FILE_TYPE_NOT_ALLOWED")


def validate_uploaded_image(uploaded) -> None:
    validate_uploaded_file(uploaded)

    name = getattr(uploaded, "name", "") or "file"
    ext = os.path.splitext(name)[1].lower()
    if ext not in ALLOWED_IMAGE_EXTENSIONS:
        raise UploadValidationError(
            f"Поддерживаются только изображения ({ext or 'без расширения'})",
            "IMAGE_TYPE_NOT_ALLOWED",
        )

    content_type = (getattr(uploaded, "content_type", "") or "").split(";", 1)[0].strip().lower()
    if content_type and content_type not in ALLOWED_IMAGE_CONTENT_TYPES:
        raise UploadValidationError("Можно загружать только изображения", "IMAGE_TYPE_NOT_ALLOWED")
