"""
Единый источник истины для занятого хранилища пользователя.

storage_used = сумма размеров уникальных физических файлов (storage_key),
принадлежащих пользователю. Независимые счётчики не хранятся.

Правило корзины (вся платформа): файл занимает квоту, пока физически
не удалён из storage (purge). Soft-delete / корзина место не освобождают.
"""

from __future__ import annotations

import os
from typing import Any

from django.conf import settings
from django.contrib.auth.models import User
from django.core.files.storage import default_storage
from django.db import transaction

from .files_models import CabinetFile, CabinetFileVersion, UserStorageQuota
from .upload_validation import (
    DOCUMENT_UPLOAD_EXTENSIONS,
    SPREADSHEET_UPLOAD_EXTENSIONS,
    VIDEO_UPLOAD_EXTENSIONS,
)

IMAGE_EXTENSIONS = frozenset({
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".heic", ".heif",
})
DOCUMENT_EXTENSIONS = DOCUMENT_UPLOAD_EXTENSIONS | SPREADSHEET_UPLOAD_EXTENSIONS

BREAKDOWN_LABELS = {
    "documents": "Документы",
    "images": "Изображения",
    "video": "Видео",
    "other": "Другие файлы",
}

BREAKDOWN_ORDER = ("documents", "images", "video", "other")


def lock_user_storage(user: User) -> UserStorageQuota:
    """Сериализация загрузок одного пользователя. used_bytes здесь не хранится."""
    quota, _ = UserStorageQuota.objects.select_for_update().get_or_create(user=user)
    return quota


def storage_limit_bytes(user: User) -> int:
    """Лимит текущего тарифа в байтах."""
    try:
        from .subscription_service import SubscriptionLimitService

        plan = SubscriptionLimitService.get_current_plan(user)
        mb = int(getattr(plan, "max_storage_mb", 0) or 0) if plan else 0
        if mb > 0:
            return mb * 1024 * 1024
    except Exception:
        pass
    try:
        return user.storage_quota.effective_quota_bytes()
    except UserStorageQuota.DoesNotExist:
        return int(getattr(settings, "CABINET_FILE_STORAGE_QUOTA_BYTES", 1024 * 1024 * 1024))


def physical_size(storage_key: str, fallback: int = 0) -> int:
    if not storage_key:
        return max(0, int(fallback or 0))
    try:
        if default_storage.exists(storage_key):
            n = int(default_storage.size(storage_key) or 0)
            if n > 0:
                return n
    except Exception:
        pass
    return max(0, int(fallback or 0))


def category_for(*, name: str = "", mime: str = "", extension: str = "") -> str:
    ext = (extension or os.path.splitext(name or "")[1] or "").lower()
    if ext and not ext.startswith("."):
        ext = f".{ext}"
    mime = (mime or "").lower()
    if ext in IMAGE_EXTENSIONS or mime.startswith("image/"):
        return "images"
    if ext in VIDEO_UPLOAD_EXTENSIONS or mime.startswith("video/"):
        return "video"
    if ext in DOCUMENT_EXTENSIONS or mime in {
        "application/pdf",
        "application/msword",
        "text/plain",
        "text/csv",
    }:
        return "documents"
    return "other"


def format_storage_bytes(n: int) -> str:
    n = max(0, int(n or 0))
    kb, mb, gb = 1024, 1024 * 1024, 1024 * 1024 * 1024

    def ru(value: float, decimals: int) -> str:
        if decimals <= 0:
            return str(int(round(value)))
        text = f"{value:.{decimals}f}".rstrip("0").rstrip(".")
        return text.replace(".", ",")

    if n < mb:
        if n < kb:
            return f"{n} Б"
        value = n / kb
        return f"{ru(value, 0 if value >= 10 else 1)} КБ"
    if n < gb:
        value = n / mb
        decimals = 0 if value >= 100 or abs(value - round(value)) < 0.05 else 1
        return f"{ru(value, decimals)} МБ"
    value = n / gb
    decimals = 1 if value >= 10 else 2
    return f"{ru(value, decimals)} ГБ"


def format_used_of_limit(used: int, limit: int) -> str:
    used_label = format_storage_bytes(used)
    limit_label = format_storage_bytes(limit)
    used_unit = used_label.rsplit(" ", 1)[-1]
    limit_unit = limit_label.rsplit(" ", 1)[-1]
    if used_unit == limit_unit:
        used_num = used_label.rsplit(" ", 1)[0]
        return f"{used_num} из {limit_label}"
    return f"{used_label} из {limit_label}"


def can_upgrade_storage(user: User) -> bool:
    try:
        from .models import TariffPlan
        from .subscription_service import SubscriptionLimitService

        plan = SubscriptionLimitService.get_current_plan(user)
        current = int(getattr(plan, "max_storage_mb", 0) or 0)
        from .models import Profile

        profile = getattr(user, "profile", None)
        if profile is not None and getattr(profile, "role", "") != Profile.Role.TEACHER:
            return False
        return TariffPlan.objects.filter(
            is_active=True,
            is_public=True,
            max_storage_mb__gt=current,
        ).exclude(slug=getattr(plan, "slug", "")).exists()
    except Exception:
        return False


def _media_name(value: str) -> str:
    if not value:
        return ""
    name = str(value).replace("\\", "/").split("?", 1)[0].lstrip("/")
    if name.startswith("media/"):
        name = name[6:]
    media = (getattr(settings, "MEDIA_URL", "/media/") or "/media/").strip("/")
    if media and name.startswith(f"{media}/"):
        name = name[len(media) + 1 :]
    if name.startswith("http://") or name.startswith("https://"):
        return ""
    return name


class _BlobSet:
    def __init__(self):
        self._items: dict[str, dict[str, Any]] = {}

    def add(self, key: str, size: int = 0, *, name: str = "", mime: str = "", extension: str = "") -> None:
        key = _media_name(key) if "://" in str(key) or str(key).startswith("/") else str(key or "").strip()
        key = key.replace("\\", "/").lstrip("/")
        if not key:
            return
        size = max(0, int(size or 0))
        if key in self._items:
            if size and not self._items[key]["size"]:
                self._items[key]["size"] = size
            return
        if not size:
            size = physical_size(key, 0)
        self._items[key] = {
            "size": size,
            "name": name or os.path.basename(key),
            "mime": mime or "",
            "extension": extension or os.path.splitext(name or key)[1].lower(),
        }

    def items(self):
        return self._items.items()

    def used_bytes(self) -> int:
        return sum(int(row["size"] or 0) for row in self._items.values())

    def breakdown(self) -> list[dict[str, Any]]:
        totals = {key: 0 for key in BREAKDOWN_ORDER}
        for row in self._items.values():
            cat = category_for(name=row["name"], mime=row["mime"], extension=row["extension"])
            totals[cat] = totals.get(cat, 0) + int(row["size"] or 0)
        return [
            {"key": key, "label": BREAKDOWN_LABELS[key], "used_bytes": totals[key]}
            for key in BREAKDOWN_ORDER
            if totals[key] > 0
        ]


def collect_owned_blobs(user: User) -> _BlobSet:
    blobs = _BlobSet()
    _add_cabinet_files(user, blobs)
    _add_materials(user, blobs)
    _add_board_assets(user, blobs)
    _add_interactive_uploads(user, blobs)
    _add_homework_attachments(user, blobs)
    _add_teacher_task_files(user, blobs)
    _add_notebook_files(user, blobs)
    return blobs


def _add_cabinet_files(user: User, blobs: _BlobSet) -> None:
    files = CabinetFile.objects.filter(owner=user).values(
        "storage_key", "size", "display_name", "original_name", "mime_type", "extension",
    )
    for row in files:
        blobs.add(
            row["storage_key"],
            row["size"] or 0,
            name=row["display_name"] or row["original_name"] or "",
            mime=row["mime_type"] or "",
            extension=row["extension"] or "",
        )
    versions = CabinetFileVersion.objects.filter(file__owner=user).values(
        "storage_key",
        "size",
        "file__display_name",
        "file__original_name",
        "file__mime_type",
        "file__extension",
    )
    for row in versions:
        blobs.add(
            row["storage_key"],
            row["size"] or 0,
            name=row["file__display_name"] or row["file__original_name"] or "",
            mime=row["file__mime_type"] or "",
            extension=row["file__extension"] or "",
        )


def _add_materials(user: User, blobs: _BlobSet) -> None:
    from .models import Material

    qs = Material.objects.filter(teacher=user).exclude(file="").values(
        "file", "title",
    )
    for row in qs:
        key = row["file"] or ""
        if not key:
            continue
        blobs.add(key, 0, name=row["title"] or os.path.basename(key))


def _add_board_assets(user: User, blobs: _BlobSet) -> None:
    from .models import InteractiveBoardAsset

    qs = InteractiveBoardAsset.objects.filter(board__owner=user).values(
        "file", "size_bytes", "original_name", "mime_type",
    )
    for row in qs:
        blobs.add(
            row["file"] or "",
            row["size_bytes"] or 0,
            name=row["original_name"] or "",
            mime=row["mime_type"] or "",
        )


def _add_interactive_uploads(user: User, blobs: _BlobSet) -> None:
    from .models import Interactive

    prefix = f"cabinet/interactives/uploads/{user.pk}/"
    try:
        _dirs, names = default_storage.listdir(prefix)
    except Exception:
        names = []
    for name in names or []:
        key = f"{prefix}{name}"
        blobs.add(key, physical_size(key), name=name, mime="")

    urls = Interactive.objects.filter(teacher=user).exclude(
        custom_background_image_url="",
    ).values_list("custom_background_image_url", flat=True)
    for url in urls:
        key = _media_name(url)
        if key:
            blobs.add(key, 0, name=os.path.basename(key), mime="")


def _add_homework_attachments(user: User, blobs: _BlobSet) -> None:
    from .models import HomeworkAttachment, HomeworkSubmission, HomeworkSubmissionAttachment

    att_qs = HomeworkAttachment.objects.filter(uploaded_by=user).values(
        "file", "storage_path", "file_size", "original_filename", "mime_type", "is_deleted",
    )
    for row in att_qs:
        key = row["file"] or row["storage_path"] or ""
        if row["is_deleted"]:
            if not key:
                continue
            try:
                if not default_storage.exists(key):
                    continue
            except Exception:
                continue
        blobs.add(
            key,
            row["file_size"] or 0,
            name=row["original_filename"] or "",
            mime=row["mime_type"] or "",
        )

    from .models import Student

    student_ids = list(Student.objects.filter(user=user).values_list("id", flat=True))

    if student_ids:
        for path in HomeworkSubmission.objects.filter(
            student_id__in=student_ids,
        ).exclude(attached_file="").values_list("attached_file", flat=True):
            blobs.add(path, 0, name=os.path.basename(str(path)))
        extra = HomeworkSubmissionAttachment.objects.filter(
            submission__student_id__in=student_ids,
        ).exclude(file="").values("file")
        for row in extra:
            blobs.add(row["file"], 0, name=os.path.basename(row["file"] or ""))


def _add_teacher_task_files(user: User, blobs: _BlobSet) -> None:
    try:
        from Generator.models import Task, TaskAttachment
    except Exception:
        return

    att = TaskAttachment.objects.filter(
        task__owner_teacher=user, task__scope="teacher",
    ).values("file", "size", "original_name")
    for row in att:
        blobs.add(row["file"] or "", row["size"] or 0, name=row.get("original_name") or "")

    for path in Task.objects.filter(owner_teacher=user, scope="teacher").exclude(files="").values_list("files", flat=True):
        blobs.add(path, 0, name=os.path.basename(str(path)))

    prefix = f"tasks/teacher_{user.pk}/"
    try:
        _dirs, names = default_storage.listdir(prefix)
    except Exception:
        names = []
    for name in names or []:
        blobs.add(f"{prefix}{name}", 0, name=name)


def _add_notebook_files(user: User, blobs: _BlobSet) -> None:
    from .models import HomeworkNotebookPage, HomeworkNotebookRevision

    pages = HomeworkNotebookPage.objects.filter(
        notebook__created_by=user,
    ).exclude(background_file="").values_list("background_file", flat=True)
    for path in pages:
        blobs.add(path, 0, name=os.path.basename(str(path)))

    exports = HomeworkNotebookRevision.objects.filter(
        created_by=user,
    ).exclude(export_file="").values_list("export_file", flat=True)
    for path in exports:
        blobs.add(path, 0, name=os.path.basename(str(path)))


def calc_usage_bytes(user: User) -> int:
    return collect_owned_blobs(user).used_bytes()


def get_quota_info(user: User) -> dict[str, Any]:
    blobs = collect_owned_blobs(user)
    used = blobs.used_bytes()
    limit = storage_limit_bytes(user)
    percent = round((used / limit) * 100, 1) if limit else 0
    over = used > limit > 0
    can_upgrade = can_upgrade_storage(user)
    return {
        "storage_used_bytes": used,
        "storage_limit_bytes": limit,
        "used_bytes": used,
        "limit_bytes": limit,
        "available_bytes": max(0, limit - used),
        "percent": percent,
        "warning": percent >= 90,
        "over_limit": over,
        "breakdown": blobs.breakdown(),
        "can_upgrade": can_upgrade,
        "actions": ["open_files"] + (["upgrade_storage"] if can_upgrade else []),
    }


def quota_exceeded_message(info: dict[str, Any]) -> str:
    used = int(info.get("storage_used_bytes") or info.get("used_bytes") or 0)
    limit = int(info.get("storage_limit_bytes") or info.get("limit_bytes") or 0)
    return (
        "Недостаточно места в хранилище. "
        f"Использовано {format_used_of_limit(used, limit)}."
    )


def sync_recorded_sizes(*, user: User | None = None) -> dict[str, int]:
    """Пересчитывает записанные размеры по фактическому storage. Счётчик used не хранится."""
    files_qs = CabinetFile.objects.all()
    versions_qs = CabinetFileVersion.objects.all()
    if user is not None:
        files_qs = files_qs.filter(owner=user)
        versions_qs = versions_qs.filter(file__owner=user)

    files_updated = 0
    versions_updated = 0
    for file_obj in files_qs.iterator():
        actual = physical_size(file_obj.storage_key, file_obj.size)
        if actual != int(file_obj.size or 0):
            file_obj.size = actual
            file_obj.save(update_fields=["size"])
            files_updated += 1
    for version in versions_qs.iterator():
        actual = physical_size(version.storage_key, version.size)
        if actual != int(version.size or 0):
            version.size = actual
            version.save(update_fields=["size"])
            versions_updated += 1

    hw_updated = 0
    try:
        from .models import HomeworkAttachment, InteractiveBoardAsset

        att_qs = HomeworkAttachment.objects.filter(is_deleted=False).exclude(file="")
        if user is not None:
            att_qs = att_qs.filter(uploaded_by=user)
        for row in att_qs.iterator():
            key = row.file.name if row.file else row.storage_path
            actual = physical_size(key, row.file_size)
            if actual != int(row.file_size or 0):
                row.file_size = actual
                row.save(update_fields=["file_size"])
                hw_updated += 1

        board_qs = InteractiveBoardAsset.objects.all()
        if user is not None:
            board_qs = board_qs.filter(board__owner=user)
        board_updated = 0
        for row in board_qs.iterator():
            key = row.file.name if row.file else ""
            actual = physical_size(key, row.size_bytes)
            if actual != int(row.size_bytes or 0):
                row.size_bytes = actual
                row.save(update_fields=["size_bytes"])
                board_updated += 1
    except Exception:
        board_updated = 0

    return {
        "files": files_updated,
        "versions": versions_updated,
        "homework_attachments": hw_updated,
        "board_assets": board_updated,
    }


def quota_error_extra(user: User) -> dict[str, Any]:
    info = get_quota_info(user)
    info["storage_used_bytes"] = info["used_bytes"]
    info["storage_limit_bytes"] = info["limit_bytes"]
    return info
