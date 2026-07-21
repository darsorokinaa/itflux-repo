"""Провайдер-независимый слой хранения файлов кабинета."""

from __future__ import annotations

import hashlib
import os
import re
import uuid
from typing import BinaryIO

from django.core.files.base import ContentFile, File
from django.core.files.storage import default_storage


STORAGE_PREFIX = "cabinet/my-files"


def sanitize_filename(name: str) -> str:
    """Сохраняет читаемое имя, убирая опасные символы и path traversal."""
    base = os.path.basename((name or "file").replace("\\", "/"))
    base = base.strip().strip(".")
    if not base:
        base = "file"
    # Убираем управляющие символы и разделители путей
    base = re.sub(r"[\x00-\x1f\x7f]", "", base)
    base = re.sub(r"[/\\\\]+", "_", base)
    if len(base) > 200:
        stem, ext = os.path.splitext(base)
        base = stem[: 200 - len(ext)] + ext
    return base


def ensure_filename_extension(name: str, extension: str) -> str:
    """Если в имени нет расширения — добавляет известное расширение файла."""
    name = sanitize_filename(name)
    ext = (extension or "").strip().lower()
    if ext and not ext.startswith("."):
        ext = f".{ext}"
    if not ext or len(ext) > 20:
        return name
    _, current_ext = os.path.splitext(name)
    if not current_ext:
        return f"{name}{ext}"
    return name


def content_disposition(filename: str, *, inline: bool = False) -> str:
    """RFC 5987: filename для ASCII + filename* для кириллицы и прочих символов."""
    from urllib.parse import quote

    disposition = "inline" if inline else "attachment"
    safe = sanitize_filename(filename) or "file"
    ascii_name = safe.encode("ascii", "replace").decode("ascii").replace("?", "_") or "file"
    return f"{disposition}; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(safe)}"


def build_storage_key(owner_id: int, original_name: str) -> str:
    ext = os.path.splitext(original_name or "")[1].lower()
    if len(ext) > 20:
        ext = ""
    return f"{STORAGE_PREFIX}/{owner_id}/{uuid.uuid4().hex}{ext}"


def compute_checksum(file_obj) -> str:
    hasher = hashlib.sha256()
    pos = None
    if hasattr(file_obj, "seek") and hasattr(file_obj, "tell"):
        try:
            pos = file_obj.tell()
            file_obj.seek(0)
        except Exception:
            pos = None
    while True:
        chunk = file_obj.read(1024 * 1024)
        if not chunk:
            break
        hasher.update(chunk if isinstance(chunk, bytes) else chunk.encode("utf-8", errors="ignore"))
    if pos is not None:
        try:
            file_obj.seek(pos)
        except Exception:
            try:
                file_obj.seek(0)
            except Exception:
                pass
    return hasher.hexdigest()


def save_bytes(storage_key: str, content: bytes | BinaryIO | File) -> str:
    if isinstance(content, (bytes, bytearray)):
        return default_storage.save(storage_key, ContentFile(bytes(content)))
    if hasattr(content, "seek"):
        try:
            content.seek(0)
        except Exception:
            pass
    return default_storage.save(storage_key, content)


def open_file(storage_key: str, mode: str = "rb"):
    return default_storage.open(storage_key, mode)


def exists(storage_key: str) -> bool:
    return bool(storage_key) and default_storage.exists(storage_key)


def delete_key(storage_key: str) -> None:
    if not storage_key:
        return
    try:
        if default_storage.exists(storage_key):
            default_storage.delete(storage_key)
    except Exception:
        pass


def copy_key(source_key: str, dest_key: str) -> str:
    with default_storage.open(source_key, "rb") as src:
        return default_storage.save(dest_key, src)
