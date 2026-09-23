"""Проверка вложений. Статус clean здесь не ставится: сканера нет."""

from __future__ import annotations

import hashlib
import os
import uuid

from django.conf import settings
from django.core.files.base import ContentFile
from django.core.files.storage import default_storage

from Cabinet.upload_validation import BLOCKED_UPLOAD_EXTENSIONS, UploadValidationError

STORAGE_PREFIX = "cabinet/messages"

ALLOWED_EXTENSIONS = frozenset({
    ".png", ".jpg", ".jpeg", ".gif", ".webp",
    ".pdf", ".txt", ".doc", ".docx",
})

ALLOWED_MIME = frozenset({
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
    "application/pdf",
    "text/plain",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
})

IMAGE_EXTENSIONS = frozenset({".png", ".jpg", ".jpeg", ".gif", ".webp"})
SERVE_MIME = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".pdf": "application/pdf",
    ".txt": "text/plain",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}
MAX_ATTACHMENTS = 5


def max_attachment_bytes() -> int:
    return int(getattr(settings, "MESSAGING_MAX_ATTACHMENT_BYTES", 10 * 1024 * 1024))


def _ext(name: str) -> str:
    return os.path.splitext(name or "")[1].lower()


def _matches_magic(ext: str, header: bytes) -> bool:
    if ext == ".png":
        return header.startswith(b"\x89PNG\r\n\x1a\n")
    if ext in {".jpg", ".jpeg"}:
        return header.startswith(b"\xff\xd8\xff")
    if ext == ".gif":
        return header.startswith((b"GIF87a", b"GIF89a"))
    if ext == ".webp":
        return len(header) >= 12 and header[:4] == b"RIFF" and header[8:12] == b"WEBP"
    if ext == ".pdf":
        return header.startswith(b"%PDF")
    if ext == ".txt":
        sample = header[:64].lstrip().lower()
        if sample.startswith((b"<!doctype", b"<html", b"<script", b"<?php", b"MZ", b"\x7fELF")):
            return False
        return True
    if ext == ".doc":
        return header.startswith(b"\xd0\xcf\x11\xe0")
    if ext == ".docx":
        return header.startswith(b"PK\x03\x04")
    return False


def validate_message_upload(uploaded) -> None:
    if not uploaded:
        raise UploadValidationError("Файл не передан", "FILE_REQUIRED")
    size = getattr(uploaded, "size", None) or 0
    limit = max_attachment_bytes()
    if size <= 0 or size > limit:
        mb = max(1, limit // (1024 * 1024))
        raise UploadValidationError(f"Файл слишком большой или пустой (макс. {mb} МБ)", "FILE_TOO_LARGE")
    ext = _ext(getattr(uploaded, "name", "") or "")
    if ext in BLOCKED_UPLOAD_EXTENSIONS or ext not in ALLOWED_EXTENSIONS:
        raise UploadValidationError("Тип файла не разрешён для сообщений", "FILE_TYPE_BLOCKED")
    mime = (getattr(uploaded, "content_type", "") or "").split(";", 1)[0].strip().lower()
    if mime not in ALLOWED_MIME:
        raise UploadValidationError("Недопустимый тип содержимого файла", "FILE_TYPE_NOT_ALLOWED")
    header = uploaded.read(64)
    try:
        uploaded.seek(0)
    except Exception:
        pass
    if not _matches_magic(ext, header or b""):
        raise UploadValidationError("Содержимое файла не совпадает с расширением", "FILE_MAGIC_MISMATCH")


def store_message_file(*, conversation_id, uploaded) -> tuple[str, str, int]:
    validate_message_upload(uploaded)
    ext = _ext(uploaded.name)
    key = f"{STORAGE_PREFIX}/{conversation_id}/{uuid.uuid4().hex}{ext}"
    raw = uploaded.read()
    try:
        uploaded.seek(0)
    except Exception:
        pass
    from .safety import MessageBlocked, inspect_file
    decision = inspect_file(getattr(uploaded, "name", "") or "", raw)
    if decision.blocked:
        raise MessageBlocked(decision.reason)
    digest = hashlib.sha256(raw).hexdigest()
    default_storage.save(key, ContentFile(raw))
    return key, digest, len(raw)


def is_image_ext(name: str) -> bool:
    return _ext(name) in IMAGE_EXTENSIONS


def safe_original_name(name: str) -> str:
    cleaned = "".join(
        ch for ch in (name or "file").replace("\\", "_").replace("/", "_")
        if ch.isprintable() and ch not in {'"', "\r", "\n"}
    ).strip()
    return (cleaned or "file")[:180]


def download_headers(original_name: str) -> tuple[str, str]:
    """Тип и disposition задаёт сервер, не браузер. Имя не может подменить заголовок."""
    ext = _ext(original_name)
    mime = SERVE_MIME.get(ext, "application/octet-stream")
    disposition = "inline" if ext in IMAGE_EXTENSIONS else "attachment"
    filename = safe_original_name(original_name)
    return mime, f'{disposition}; filename="{filename}"'


def safe_storage_relative(storage_key: str) -> str:
    prefix = STORAGE_PREFIX + "/"
    if not storage_key.startswith(prefix) or ".." in storage_key:
        raise UploadValidationError("Некорректный путь файла", "FILE_PATH_INVALID")
    return storage_key[len(prefix):]
