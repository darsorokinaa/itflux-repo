"""Шифрование аватаров at-rest (Fernet, ключ из SECRET_KEY)."""

from __future__ import annotations

import base64
import hashlib
import io
from typing import Final

from cryptography.fernet import Fernet, InvalidToken
from django.conf import settings
from PIL import Image, UnidentifiedImageError

ALLOWED_CONTENT_TYPES: Final[set[str]] = {
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
}
MAX_AVATAR_BYTES: Final[int] = 2 * 1024 * 1024
MAX_AVATAR_SIDE: Final[int] = 512


def _fernet() -> Fernet:
    digest = hashlib.sha256(settings.SECRET_KEY.encode("utf-8")).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt_avatar_bytes(raw: bytes) -> bytes:
    return _fernet().encrypt(raw)


def decrypt_avatar_bytes(ciphertext: bytes) -> bytes:
    try:
        return _fernet().decrypt(ciphertext)
    except InvalidToken as exc:
        raise ValueError("Не удалось расшифровать аватар") from exc


def normalize_avatar_image(raw: bytes, content_type: str = "") -> tuple[bytes, str]:
    """Проверяет тип/размер и приводит к JPEG ≤ MAX_AVATAR_SIDE."""
    if len(raw) > MAX_AVATAR_BYTES:
        raise ValueError("Файл слишком большой (максимум 2 МБ)")

    declared = (content_type or "").split(";", 1)[0].strip().lower()
    if declared and declared not in ALLOWED_CONTENT_TYPES and declared != "application/octet-stream":
        raise ValueError("Допустимы только JPEG, PNG, WebP или GIF")

    try:
        image = Image.open(io.BytesIO(raw))
        image.load()
    except UnidentifiedImageError as exc:
        raise ValueError("Некорректный файл изображения") from exc

    image = image.convert("RGB")
    image.thumbnail((MAX_AVATAR_SIDE, MAX_AVATAR_SIDE), Image.Resampling.LANCZOS)

    out = io.BytesIO()
    image.save(out, format="JPEG", quality=85, optimize=True)
    data = out.getvalue()
    if len(data) > MAX_AVATAR_BYTES:
        raise ValueError("Файл слишком большой после обработки")
    return data, "image/jpeg"
