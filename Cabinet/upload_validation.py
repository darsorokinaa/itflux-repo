"""Validation for user-uploaded files in cabinet."""

import os

from django.conf import settings

def get_max_upload_bytes():
    value = getattr(settings, "CABINET_MAX_UPLOAD_BYTES", None)
    if value in (None, 0, "", "none", "unlimited"):
        return None
    return int(value)


# None = без лимита размера. Для совместимости со старыми импортами.
MAX_UPLOAD_BYTES = get_max_upload_bytes()

# .ts не включаем: это TypeScript в code-allowlist, а не MPEG-TS.
VIDEO_UPLOAD_EXTENSIONS = frozenset({
    ".mp4", ".webm", ".mov", ".qt",
    ".avi", ".mkv", ".m4v", ".mpeg", ".mpg", ".mpe", ".mpv", ".m2v",
    ".wmv", ".flv", ".3gp", ".3g2", ".ogv",
    ".mts", ".m2ts", ".vob", ".f4v", ".asf",
})

SPREADSHEET_UPLOAD_EXTENSIONS = frozenset({
    ".xls", ".xlsx", ".xlsm", ".xlsb", ".xltx", ".xlt",
    ".csv", ".tsv", ".ods", ".ots", ".numbers",
})

DOCUMENT_UPLOAD_EXTENSIONS = frozenset({
    ".pdf", ".doc", ".docx", ".docm", ".dot", ".dotx",
    ".ppt", ".pptx", ".pptm", ".pps", ".ppsx",
    ".txt", ".rtf",
    ".odt", ".ott", ".odp", ".otp",
    ".pages", ".key", ".epub", ".djvu", ".djv",
})

ALLOWED_UPLOAD_EXTENSIONS = frozenset({
    # images (без SVG — XSS при inline-preview)
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".heic", ".heif",
    # audio
    ".mp3", ".wav", ".ogg", ".m4a",
    # archives
    ".zip", ".rar", ".7z", ".tar", ".gz",
    # code as download-only text (без html/js/sh)
    ".py", ".ts", ".java", ".c", ".cpp", ".h", ".cs",
    ".css", ".json", ".xml", ".md", ".sql",
}) | DOCUMENT_UPLOAD_EXTENSIONS | SPREADSHEET_UPLOAD_EXTENSIONS | VIDEO_UPLOAD_EXTENSIONS

ALLOWED_UPLOAD_CONTENT_TYPES = frozenset({
    "application/pdf",
    "image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp",
    "image/heic", "image/heif",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-word.document.macroenabled.12",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.template",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel.sheet.macroenabled.12",
    "application/vnd.ms-excel.sheet.binary.macroenabled.12",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.template",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.ms-powerpoint.presentation.macroenabled.12",
    "application/vnd.openxmlformats-officedocument.presentationml.slideshow",
    "application/vnd.oasis.opendocument.text",
    "application/vnd.oasis.opendocument.text-template",
    "application/vnd.oasis.opendocument.spreadsheet",
    "application/vnd.oasis.opendocument.spreadsheet-template",
    "application/vnd.oasis.opendocument.presentation",
    "application/vnd.oasis.opendocument.presentation-template",
    "application/vnd.apple.pages",
    "application/x-iwork-pages-sffpages",
    "application/vnd.apple.numbers",
    "application/x-iwork-numbers-sffnumbers",
    "application/vnd.apple.keynote",
    "application/x-iwork-keynote-sffkey",
    "application/epub+zip",
    "image/vnd.djvu", "image/x-djvu", "image/vnd.djvu+multipage",
    "text/plain", "text/csv", "text/tab-separated-values", "text/tsv",
    "text/rtf", "application/rtf", "application/csv",
    "application/zip", "application/x-zip-compressed",
    "application/x-rar-compressed", "application/vnd.rar",
    "application/x-7z-compressed", "application/gzip", "application/x-tar",
    "audio/mpeg", "audio/wav", "audio/ogg", "audio/mp4", "audio/x-m4a",
    "video/mp4", "video/webm", "video/quicktime",
    "video/x-msvideo", "video/avi", "video/msvideo",
    "video/x-matroska", "video/matroska",
    "video/x-m4v", "video/mpeg", "video/mpg", "video/x-mpeg",
    "video/x-ms-wmv", "video/x-ms-asf",
    "video/x-flv", "video/x-f4v",
    "video/3gpp", "video/3gpp2", "video/ogg",
    "video/mp2t", "video/vnd.dlna.mpeg-tts",
    "video/dvd", "video/x-ms-vob",
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

_NON_IMAGE_PREVIEW_EXTS = frozenset({".djvu", ".djv", ".epub"})

PREVIEWABLE_EXTENSIONS = frozenset({
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp",
    ".pdf", ".txt", ".md", ".csv", ".tsv", ".json", ".xml", ".css", ".py",
    ".mp3", ".wav", ".ogg", ".m4a",
}) | VIDEO_UPLOAD_EXTENSIONS


class UploadValidationError(Exception):
    def __init__(self, message: str, code: str = "INVALID_UPLOAD"):
        super().__init__(message)
        self.message = message
        self.code = code


def validate_uploaded_file(uploaded) -> None:
    if not uploaded:
        raise UploadValidationError("Файл не передан", "FILE_REQUIRED")

    size = getattr(uploaded, "size", None)
    limit = get_max_upload_bytes()
    if limit and size is not None and size > limit:
        mb = max(1, limit // (1024 * 1024))
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
        video_ok = content_type.startswith("video/") and ext in VIDEO_UPLOAD_EXTENSIONS
        if not video_ok:
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
    mime = (mime_type or "").lower()
    if ext in _NON_IMAGE_PREVIEW_EXTS or "djvu" in mime:
        return False
    if ext in PREVIEWABLE_EXTENSIONS:
        return True
    return mime.startswith(("image/", "audio/", "video/", "text/")) or mime == "application/pdf"
