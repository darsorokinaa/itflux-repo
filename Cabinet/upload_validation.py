"""Validation for user-uploaded files in cabinet."""

import os

from django.conf import settings

MAX_UPLOAD_BYTES = int(getattr(settings, "CABINET_MAX_UPLOAD_BYTES", 20 * 1024 * 1024))

ALLOWED_UPLOAD_EXTENSIONS = frozenset({
    # documents
    ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".txt", ".rtf", ".csv",
    # images (без SVG — XSS при inline-preview)
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".heic", ".heif",
    # audio / video
    ".mp3", ".wav", ".ogg", ".m4a", ".mp4", ".webm", ".mov",
    # archives
    ".zip", ".rar", ".7z", ".tar", ".gz",
    # code as download-only text (без html/js/sh)
    ".py", ".ts", ".java", ".c", ".cpp", ".h", ".cs",
    ".css", ".json", ".xml", ".md", ".sql",
})

ALLOWED_UPLOAD_CONTENT_TYPES = frozenset({
    "application/pdf",
    "image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp",
    "image/heic", "image/heif",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "text/plain", "text/csv", "text/rtf", "application/rtf",
    "application/zip", "application/x-zip-compressed",
    "application/x-rar-compressed", "application/vnd.rar",
    "application/x-7z-compressed", "application/gzip", "application/x-tar",
    "audio/mpeg", "audio/wav", "audio/ogg", "audio/mp4", "audio/x-m4a",
    "video/mp4", "video/webm", "video/quicktime",
    "application/json", "application/xml", "text/xml", "text/css",
    "text/markdown",
    "application/octet-stream",
})

# Потенциально опасные расширения — всегда блокируются
BLOCKED_UPLOAD_EXTENSIONS = frozenset({
    ".exe", ".bat", ".cmd", ".com", ".msi", ".scr", ".pif",
    ".dll", ".sys", ".vbs", ".vbe", ".wsf", ".wsh", ".ps1",
    ".jar", ".apk", ".dmg", ".app", ".deb", ".rpm",
    ".php", ".phtml", ".asp", ".aspx", ".jsp", ".cgi",
    ".html", ".htm", ".xhtml", ".svg", ".js", ".jsx", ".mjs", ".cjs",
    ".sh", ".bash", ".zsh",
})

ALLOWED_IMAGE_EXTENSIONS = frozenset({
    ".png", ".jpg", ".jpeg", ".gif", ".webp",
})

ALLOWED_IMAGE_CONTENT_TYPES = frozenset({
    "image/png", "image/jpeg", "image/gif", "image/webp",
})

PREVIEWABLE_EXTENSIONS = frozenset({
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp",
    ".pdf", ".txt", ".md", ".csv", ".json", ".xml", ".css", ".py",
    ".mp3", ".wav", ".ogg", ".m4a", ".mp4", ".webm",
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
    if ext in BLOCKED_UPLOAD_EXTENSIONS:
        raise UploadValidationError(
            f"Тип файла запрещён из соображений безопасности ({ext or 'без расширения'})",
            "FILE_TYPE_BLOCKED",
        )
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


def is_previewable(extension: str, mime_type: str = "") -> bool:
    ext = (extension or "").lower()
    if not ext.startswith(".") and ext:
        ext = f".{ext}"
    if ext in PREVIEWABLE_EXTENSIONS:
        return True
    mime = (mime_type or "").lower()
    return mime.startswith(("image/", "audio/", "video/", "text/")) or mime == "application/pdf"
