"""Бизнес-логика хранилища «Мои файлы»."""

from __future__ import annotations

import os
from datetime import timedelta
from django.conf import settings
from django.db import transaction
from django.db.models import Q, Sum
from django.utils import timezone

from .files_models import (
    CabinetFile,
    CabinetFileAuditAction,
    CabinetFileAuditLog,
    CabinetFileRelation,
    CabinetFileRelationType,
    CabinetFileStatus,
    CabinetFileVersion,
    CabinetFolder,
    UserStorageQuota,
)
from .files_storage import (
    build_storage_key,
    compute_checksum,
    copy_key,
    delete_key,
    ensure_filename_extension,
    sanitize_filename,
    save_bytes,
)
from .models import (
    Homework,
    HomeworkSubmission,
    InteractiveBoard,
    Lesson,
    LessonPlanItem,
    Material,
    Profile,
    Student,
    StudentGroup,
)
from .upload_validation import UploadValidationError, validate_uploaded_file


class FileServiceError(Exception):
    def __init__(self, message: str, code: str = "FILE_ERROR", status: int = 400, extra: dict | None = None):
        super().__init__(message)
        self.message = message
        self.code = code
        self.status = status
        self.extra = extra or {}


def get_quota_bytes(user) -> int:
    """Лимит хранилища: актуальный тариф подписки, иначе ручная квота / settings."""
    try:
        from .subscription_service import SubscriptionLimitService

        sub = SubscriptionLimitService.get_or_create_subscription(user, apply_promo=False)
        plan = getattr(sub, "plan", None)
        mb = int(getattr(plan, "max_storage_mb", 0) or 0) if plan else 0
        if mb > 0:
            return mb * 1024 * 1024
    except Exception:
        pass
    try:
        quota = user.storage_quota
        return quota.effective_quota_bytes()
    except UserStorageQuota.DoesNotExist:
        return int(getattr(settings, "CABINET_FILE_STORAGE_QUOTA_BYTES", 1024 * 1024 * 1024))


def calc_usage_bytes(user) -> int:
    # Учитываем active и trashed; после purge запись исчезает.
    total = CabinetFile.objects.filter(owner=user).aggregate(total=Sum("size")).get("total")
    return int(total or 0)


def get_quota_info(user) -> dict:
    used = calc_usage_bytes(user)
    limit = get_quota_bytes(user)
    percent = round((used / limit) * 100, 1) if limit else 0
    over = used > limit > 0
    return {
        "used_bytes": used,
        "limit_bytes": limit,
        "available_bytes": max(0, limit - used),
        "percent": percent,
        "warning": percent >= 90,
        "over_limit": over,
    }


def assert_quota_allows(user, additional_bytes: int) -> None:
    info = get_quota_info(user)
    if info["used_bytes"] + int(additional_bytes or 0) > info["limit_bytes"]:
        used_gb = round(info["used_bytes"] / (1024 * 1024 * 1024), 2)
        limit_gb = round(info["limit_bytes"] / (1024 * 1024 * 1024), 2)
        if info.get("over_limit") and not additional_bytes:
            msg = (
                f"Использовано {used_gb} ГБ из {limit_gb} ГБ. "
                "Новые файлы нельзя загружать, пока объём не станет меньше лимита."
            )
        else:
            msg = (
                f"Недостаточно места в хранилище (использовано {used_gb} ГБ из {limit_gb} ГБ). "
                "Удалите ненужные файлы или повысьте тариф."
            )
        raise FileServiceError(
            msg,
            code="QUOTA_EXCEEDED",
            status=400,
            extra=info,
        )


def log_action(actor, action: str, *, file=None, folder=None, meta: dict | None = None) -> None:
    CabinetFileAuditLog.objects.create(
        actor=actor,
        action=action,
        file=file,
        folder=folder,
        meta=meta or {},
    )


def assert_owns_file(user, file_obj: CabinetFile, *, allow_trashed: bool = False) -> CabinetFile:
    if file_obj.owner_id != user.id:
        raise FileServiceError("Нет доступа к этому файлу", code="FORBIDDEN", status=403)
    if not allow_trashed and file_obj.status == CabinetFileStatus.TRASHED:
        raise FileServiceError("Файл находится в корзине", code="FILE_IN_TRASH", status=404)
    return file_obj


def user_can_read_file(user, file_obj: CabinetFile) -> bool:
    """Владелец, учитель по учебной связи или ученик с доступом через материалы."""
    if not user or not user.is_authenticated:
        return False
    if file_obj.owner_id == user.id:
        return file_obj.status != CabinetFileStatus.TRASHED
    if file_obj.status == CabinetFileStatus.TRASHED:
        return False
    profile = getattr(user, "profile", None)
    if not profile:
        return False

    if profile.role == Profile.Role.TEACHER:
        if CabinetFileRelation.objects.filter(file=file_obj).filter(
            Q(homework__teacher=user)
            | Q(submission__homework__teacher=user)
            | Q(student__teacher=user)
            | Q(group__teacher=user)
            | Q(lesson__teacher=user)
            | Q(plan_item__plan__teacher=user)
            | Q(material__teacher=user)
            | Q(board__owner=user)
        ).exists():
            return True
        if Material.objects.filter(cabinet_file=file_obj, teacher=user).exists():
            return True
        return False

    if profile.role != Profile.Role.STUDENT:
        return False
    students = list(Student.objects.filter(user=user).values_list("id", flat=True))
    if not students:
        return False
    if CabinetFileRelation.objects.filter(
        file=file_obj,
    ).filter(
        Q(student_id__in=students)
        | Q(submission__student_id__in=students)
        | Q(homework__student_id__in=students)
        | Q(homework__group__students__in=students)
    ).exists():
        return True
    material_ids = list(
        Material.objects.filter(cabinet_file=file_obj).values_list("id", flat=True)
    )
    if not material_ids:
        return False
    from .models import DirectMaterialAssignment, LessonAssignment

    if DirectMaterialAssignment.objects.filter(
        material_id__in=material_ids,
    ).filter(
        Q(student_id__in=students) | Q(group__students__in=students)
    ).exists():
        return True
    if LessonAssignment.objects.filter(
        Q(student_id__in=students) | Q(group__students__in=students),
        lesson__materials__id__in=material_ids,
    ).exists():
        return True
    if LessonPlanItem.objects.filter(
        Q(materials__id__in=material_ids) | Q(homework_materials__id__in=material_ids),
    ).filter(
        Q(plan__enrollments__student_id__in=students)
        | Q(plan__enrollments__group__students__in=students)
        | Q(homeworks__student_id__in=students)
        | Q(homeworks__group__students__in=students)
    ).exists():
        return True
    # ДЗ с файлом из «Мои файлы» (в т.ч. старые URL /media/cabinet/my-files/…)
    from .models import Homework

    storage_key = (file_obj.storage_key or "").strip()
    file_tail = storage_key.rstrip("/").split("/")[-1] if storage_key else ""
    hw_file_q = Q(cabinet_file_relations__file=file_obj) | Q(
        tasks__description__icontains=str(file_obj.id)
    )
    if storage_key:
        hw_file_q |= Q(tasks__description__icontains=storage_key)
    if file_tail and len(file_tail) >= 8:
        hw_file_q |= Q(tasks__description__icontains=file_tail)
    if Homework.objects.filter(
        Q(student_id__in=students) | Q(group__students__in=students),
    ).filter(hw_file_q).exists():
        return True
    return False


def get_readable_file(user, file_id) -> CabinetFile:
    try:
        file_obj = CabinetFile.objects.get(pk=file_id)
    except CabinetFile.DoesNotExist as exc:
        raise FileServiceError("Файл не найден", code="NOT_FOUND", status=404) from exc
    if not user_can_read_file(user, file_obj):
        raise FileServiceError("Нет доступа к этому файлу", code="FORBIDDEN", status=403)
    return file_obj


def assert_owns_folder(user, folder: CabinetFolder, *, allow_trashed: bool = False) -> CabinetFolder:
    if folder.owner_id != user.id:
        raise FileServiceError("Нет доступа к этой папке", code="FORBIDDEN", status=403)
    if not allow_trashed and folder.deleted_at is not None:
        raise FileServiceError("Папка находится в корзине", code="FOLDER_IN_TRASH", status=404)
    return folder


def get_owned_file(user, file_id, *, allow_trashed: bool = False) -> CabinetFile:
    try:
        file_obj = CabinetFile.objects.get(pk=file_id)
    except CabinetFile.DoesNotExist as exc:
        raise FileServiceError("Файл не найден", code="NOT_FOUND", status=404) from exc
    return assert_owns_file(user, file_obj, allow_trashed=allow_trashed)


def get_owned_folder(user, folder_id, *, allow_trashed: bool = False) -> CabinetFolder:
    try:
        folder = CabinetFolder.objects.get(pk=folder_id)
    except CabinetFolder.DoesNotExist as exc:
        raise FileServiceError("Папка не найдена", code="NOT_FOUND", status=404) from exc
    return assert_owns_folder(user, folder, allow_trashed=allow_trashed)


def folder_ancestors(folder: CabinetFolder | None) -> list[CabinetFolder]:
    result = []
    seen = set()
    current = folder
    while current is not None:
        if current.id in seen:
            break
        seen.add(current.id)
        result.append(current)
        current = current.parent
    result.reverse()
    return result


def assert_no_folder_cycle(folder: CabinetFolder, new_parent: CabinetFolder | None) -> None:
    if new_parent is None:
        return
    if new_parent.id == folder.id:
        raise FileServiceError(
            "Нельзя переместить папку внутрь самой себя",
            code="FOLDER_CYCLE",
            status=400,
        )
    current = new_parent
    seen = {folder.id}
    while current is not None:
        if current.id in seen:
            raise FileServiceError(
                "Нельзя переместить папку внутрь своей дочерней папки",
                code="FOLDER_CYCLE",
                status=400,
            )
        seen.add(current.id)
        current = current.parent


def create_folder(user, name: str, parent_id=None) -> CabinetFolder:
    name = (name or "").strip()
    if not name:
        raise FileServiceError("Укажите название папки", code="NAME_REQUIRED", status=400)
    if len(name) > 255:
        raise FileServiceError("Слишком длинное название папки", code="NAME_TOO_LONG", status=400)
    parent = None
    if parent_id:
        parent = get_owned_folder(user, parent_id)
    folder = CabinetFolder.objects.create(owner=user, name=name, parent=parent)
    log_action(user, CabinetFileAuditAction.CREATE_FOLDER, folder=folder, meta={"name": name})
    return folder


@transaction.atomic
def upload_file(user, uploaded, *, folder_id=None, display_name: str | None = None) -> CabinetFile:
    try:
        validate_uploaded_file(uploaded)
    except UploadValidationError as exc:
        raise FileServiceError(exc.message, code=exc.code, status=400) from exc

    size = int(getattr(uploaded, "size", 0) or 0)
    assert_quota_allows(user, size)

    folder = None
    if folder_id:
        folder = get_owned_folder(user, folder_id)

    original = sanitize_filename(getattr(uploaded, "name", "") or "file")
    name = sanitize_filename(display_name) if display_name else original
    ext = os.path.splitext(original)[1].lower()
    mime = (getattr(uploaded, "content_type", "") or "").split(";", 1)[0].strip().lower()
    checksum = compute_checksum(uploaded)
    storage_key = build_storage_key(user.id, original)
    saved_key = save_bytes(storage_key, uploaded)

    file_obj = CabinetFile.objects.create(
        owner=user,
        folder=folder,
        original_name=original,
        display_name=name,
        storage_key=saved_key,
        mime_type=mime,
        extension=ext,
        size=size,
        checksum=checksum,
        current_version=1,
        status=CabinetFileStatus.ACTIVE,
    )
    CabinetFileVersion.objects.create(
        file=file_obj,
        version_number=1,
        storage_key=saved_key,
        size=size,
        checksum=checksum,
        uploaded_by=user,
    )
    log_action(user, CabinetFileAuditAction.UPLOAD, file=file_obj, meta={"size": size, "name": name})
    return file_obj


def rename_file(user, file_id, display_name: str) -> CabinetFile:
    file_obj = get_owned_file(user, file_id)
    name = ensure_filename_extension(display_name, file_obj.extension)
    if not name:
        raise FileServiceError("Укажите название", code="NAME_REQUIRED", status=400)
    old = file_obj.display_name
    file_obj.display_name = name
    file_obj.save(update_fields=["display_name", "updated_at"])
    log_action(user, CabinetFileAuditAction.RENAME, file=file_obj, meta={"from": old, "to": name})
    return file_obj


def download_filename(file_obj: CabinetFile) -> str:
    """Имя для скачивания — переименованное учителем (display_name), с расширением."""
    return ensure_filename_extension(
        file_obj.display_name or file_obj.original_name or "file",
        file_obj.extension,
    )


def rename_folder(user, folder_id, name: str) -> CabinetFolder:
    folder = get_owned_folder(user, folder_id)
    name = (name or "").strip()
    if not name:
        raise FileServiceError("Укажите название", code="NAME_REQUIRED", status=400)
    folder.name = name[:255]
    folder.save(update_fields=["name", "updated_at"])
    log_action(user, CabinetFileAuditAction.RENAME, folder=folder, meta={"to": folder.name})
    return folder


def move_file(user, file_id, target_folder_id=None) -> CabinetFile:
    file_obj = get_owned_file(user, file_id)
    target = None
    if target_folder_id:
        target = get_owned_folder(user, target_folder_id)
    file_obj.folder = target
    file_obj.save(update_fields=["folder", "updated_at"])
    log_action(
        user,
        CabinetFileAuditAction.MOVE,
        file=file_obj,
        meta={"folder_id": str(target.id) if target else None},
    )
    return file_obj


def move_folder(user, folder_id, target_folder_id=None) -> CabinetFolder:
    folder = get_owned_folder(user, folder_id)
    target = None
    if target_folder_id:
        target = get_owned_folder(user, target_folder_id)
    assert_no_folder_cycle(folder, target)
    folder.parent = target
    folder.save(update_fields=["parent", "updated_at"])
    log_action(
        user,
        CabinetFileAuditAction.MOVE,
        folder=folder,
        meta={"parent_id": str(target.id) if target else None},
    )
    return folder


@transaction.atomic
def copy_file(user, file_id, target_folder_id=None) -> CabinetFile:
    source = get_owned_file(user, file_id)
    assert_quota_allows(user, source.size)
    target = None
    if target_folder_id:
        target = get_owned_folder(user, target_folder_id)
    new_key = build_storage_key(user.id, source.original_name)
    saved_key = copy_key(source.storage_key, new_key)
    clone = CabinetFile.objects.create(
        owner=user,
        folder=target,
        original_name=source.original_name,
        display_name=source.display_name,
        storage_key=saved_key,
        mime_type=source.mime_type,
        extension=source.extension,
        size=source.size,
        checksum=source.checksum,
        current_version=1,
        status=CabinetFileStatus.ACTIVE,
    )
    CabinetFileVersion.objects.create(
        file=clone,
        version_number=1,
        storage_key=saved_key,
        size=clone.size,
        checksum=clone.checksum,
        uploaded_by=user,
        comment="Копия",
    )
    log_action(user, CabinetFileAuditAction.COPY, file=clone, meta={"source_id": str(source.id)})
    return clone


def set_favorite_file(user, file_id, is_favorite: bool) -> CabinetFile:
    file_obj = get_owned_file(user, file_id)
    file_obj.is_favorite = bool(is_favorite)
    file_obj.save(update_fields=["is_favorite", "updated_at"])
    log_action(user, CabinetFileAuditAction.FAVORITE, file=file_obj, meta={"value": bool(is_favorite)})
    return file_obj


def set_favorite_folder(user, folder_id, is_favorite: bool) -> CabinetFolder:
    folder = get_owned_folder(user, folder_id)
    folder.is_favorite = bool(is_favorite)
    folder.save(update_fields=["is_favorite", "updated_at"])
    log_action(user, CabinetFileAuditAction.FAVORITE, folder=folder, meta={"value": bool(is_favorite)})
    return folder


def trash_file(user, file_id) -> CabinetFile:
    file_obj = get_owned_file(user, file_id)
    file_obj.status = CabinetFileStatus.TRASHED
    file_obj.deleted_at = timezone.now()
    file_obj.save(update_fields=["status", "deleted_at", "updated_at"])
    log_action(user, CabinetFileAuditAction.TRASH, file=file_obj)
    return file_obj


def trash_folder(user, folder_id) -> CabinetFolder:
    folder = get_owned_folder(user, folder_id)
    now = timezone.now()
    folder.deleted_at = now
    folder.save(update_fields=["deleted_at", "updated_at"])
    # Мягко удаляем вложенные файлы и папки
    descendants = _collect_descendant_folders(folder)
    folder_ids = [folder.id] + [f.id for f in descendants]
    CabinetFolder.objects.filter(id__in=folder_ids, owner=user).update(deleted_at=now, updated_at=now)
    CabinetFile.objects.filter(owner=user, folder_id__in=folder_ids, status=CabinetFileStatus.ACTIVE).update(
        status=CabinetFileStatus.TRASHED,
        deleted_at=now,
        updated_at=now,
    )
    log_action(user, CabinetFileAuditAction.TRASH, folder=folder)
    return folder


def _collect_descendant_folders(folder: CabinetFolder) -> list[CabinetFolder]:
    result = []
    queue = list(CabinetFolder.objects.filter(parent=folder, owner=folder.owner))
    while queue:
        current = queue.pop(0)
        result.append(current)
        queue.extend(list(CabinetFolder.objects.filter(parent=current, owner=folder.owner)))
    return result


def restore_file(user, file_id, *, target_folder_id=None) -> CabinetFile:
    file_obj = get_owned_file(user, file_id, allow_trashed=True)
    if file_obj.status != CabinetFileStatus.TRASHED:
        raise FileServiceError("Файл не находится в корзине", code="NOT_IN_TRASH", status=400)
    target = None
    if target_folder_id:
        target = get_owned_folder(user, target_folder_id)
    elif file_obj.folder_id:
        try:
            target = get_owned_folder(user, file_obj.folder_id)
        except FileServiceError:
            target = None
    file_obj.folder = target
    file_obj.status = CabinetFileStatus.ACTIVE
    file_obj.deleted_at = None
    file_obj.save(update_fields=["folder", "status", "deleted_at", "updated_at"])
    log_action(user, CabinetFileAuditAction.RESTORE, file=file_obj)
    return file_obj


def restore_folder(user, folder_id, *, target_folder_id=None) -> CabinetFolder:
    folder = get_owned_folder(user, folder_id, allow_trashed=True)
    if folder.deleted_at is None:
        raise FileServiceError("Папка не находится в корзине", code="NOT_IN_TRASH", status=400)
    target = None
    if target_folder_id:
        target = get_owned_folder(user, target_folder_id)
    elif folder.parent_id:
        try:
            target = get_owned_folder(user, folder.parent_id)
        except FileServiceError:
            target = None
    if target:
        assert_no_folder_cycle(folder, target)
    folder.parent = target
    folder.deleted_at = None
    folder.save(update_fields=["parent", "deleted_at", "updated_at"])
    descendants = _collect_descendant_folders(folder)
    folder_ids = [folder.id] + [f.id for f in descendants]
    CabinetFolder.objects.filter(id__in=folder_ids, owner=user).update(deleted_at=None, updated_at=timezone.now())
    CabinetFile.objects.filter(owner=user, folder_id__in=folder_ids, status=CabinetFileStatus.TRASHED).update(
        status=CabinetFileStatus.ACTIVE,
        deleted_at=None,
        updated_at=timezone.now(),
    )
    log_action(user, CabinetFileAuditAction.RESTORE, folder=folder)
    return folder


def list_active_relations(file_obj: CabinetFile):
    return list(
        file_obj.relations.select_related(
            "lesson", "plan_item", "homework", "submission", "student", "group", "board", "material"
        )
    )


def relation_warnings(file_obj: CabinetFile) -> list[dict]:
    warnings = []
    for rel in list_active_relations(file_obj):
        label = rel.get_relation_type_display()
        title = ""
        if rel.lesson_id:
            title = rel.lesson.title
        elif rel.plan_item_id:
            title = rel.plan_item.title
        elif rel.homework_id:
            title = rel.homework.title
        elif rel.submission_id:
            title = f"Сдача #{rel.submission_id}"
        elif rel.student_id:
            title = rel.student.full_name if hasattr(rel.student, "full_name") else str(rel.student_id)
        elif rel.group_id:
            title = rel.group.title
        elif rel.board_id:
            title = rel.board.title
        elif rel.material_id:
            title = rel.material.title
        warnings.append(
            {
                "relation_id": str(rel.id),
                "relation_type": rel.relation_type,
                "label": label,
                "title": title,
            }
        )
    return warnings


@transaction.atomic
def purge_file(user, file_id, *, force: bool = False) -> dict:
    file_obj = get_owned_file(user, file_id, allow_trashed=True)
    warnings = relation_warnings(file_obj)
    if warnings and not force:
        raise FileServiceError(
            "Файл используется в уроках или заданиях. Подтвердите окончательное удаление.",
            code="FILE_IN_USE",
            status=409,
            extra={"relations": warnings},
        )
    storage_keys = {file_obj.storage_key}
    for version in file_obj.versions.all():
        storage_keys.add(version.storage_key)
    # Не удаляем физический ключ, если на него ссылается другой файл того же владельца
    other_refs = CabinetFile.objects.filter(owner=user, storage_key__in=storage_keys).exclude(pk=file_obj.pk)
    version_refs = CabinetFileVersion.objects.filter(
        file__owner=user, storage_key__in=storage_keys
    ).exclude(file_id=file_obj.pk)
    protected = set(other_refs.values_list("storage_key", flat=True)) | set(
        version_refs.values_list("storage_key", flat=True)
    )
    file_obj.relations.all().delete()
    Material.objects.filter(cabinet_file=file_obj).update(cabinet_file=None)
    log_action(user, CabinetFileAuditAction.PURGE, file=file_obj, meta={"name": file_obj.display_name})
    file_obj.delete()
    for key in storage_keys:
        if key and key not in protected:
            delete_key(key)
    return {"ok": True, "purged_relations": warnings}


def empty_trash(user) -> dict:
    files = list(CabinetFile.objects.filter(owner=user, status=CabinetFileStatus.TRASHED))
    folders = list(CabinetFolder.objects.filter(owner=user, deleted_at__isnull=False))
    purged = 0
    blocked = []
    for file_obj in files:
        try:
            purge_file(user, file_obj.id, force=False)
            purged += 1
        except FileServiceError as exc:
            if exc.code == "FILE_IN_USE":
                blocked.append({"id": str(file_obj.id), "name": file_obj.display_name, "relations": exc.extra.get("relations")})
            else:
                raise
    for folder in folders:
        # Удаляем пустые/уже очищенные папки
        has_files = CabinetFile.objects.filter(folder=folder).exists()
        has_children = CabinetFolder.objects.filter(parent=folder).exists()
        if not has_files and not has_children:
            folder.delete()
    return {"purged": purged, "blocked": blocked}


def touch_accessed(file_obj: CabinetFile) -> None:
    CabinetFile.objects.filter(pk=file_obj.pk).update(last_accessed_at=timezone.now())


def serialize_folder(folder: CabinetFolder, *, trash_days: int | None = None) -> dict:
    trash_days = trash_days if trash_days is not None else int(getattr(settings, "CABINET_FILE_TRASH_DAYS", 30))
    purge_at = None
    days_left = None
    if folder.deleted_at:
        purge_at = folder.deleted_at + timedelta(days=trash_days)
        days_left = max(0, (purge_at - timezone.now()).days)
    return {
        "id": str(folder.id),
        "kind": "folder",
        "name": folder.name,
        "parent_id": str(folder.parent_id) if folder.parent_id else None,
        "is_favorite": folder.is_favorite,
        "created_at": folder.created_at.isoformat() if folder.created_at else None,
        "updated_at": folder.updated_at.isoformat() if folder.updated_at else None,
        "deleted_at": folder.deleted_at.isoformat() if folder.deleted_at else None,
        "purge_at": purge_at.isoformat() if purge_at else None,
        "days_left": days_left,
    }


def serialize_file(file_obj: CabinetFile, *, include_relations: bool = False, trash_days: int | None = None) -> dict:
    trash_days = trash_days if trash_days is not None else int(getattr(settings, "CABINET_FILE_TRASH_DAYS", 30))
    purge_at = None
    days_left = None
    if file_obj.deleted_at:
        purge_at = file_obj.deleted_at + timedelta(days=trash_days)
        days_left = max(0, (purge_at - timezone.now()).days)
    data = {
        "id": str(file_obj.id),
        "kind": "file",
        "original_name": file_obj.original_name,
        "display_name": file_obj.display_name,
        "name": file_obj.display_name,
        "mime_type": file_obj.mime_type,
        "extension": file_obj.extension,
        "size": file_obj.size,
        "checksum": file_obj.checksum,
        "current_version": file_obj.current_version,
        "status": file_obj.status,
        "is_favorite": file_obj.is_favorite,
        "folder_id": str(file_obj.folder_id) if file_obj.folder_id else None,
        "owner_id": file_obj.owner_id,
        "created_at": file_obj.created_at.isoformat() if file_obj.created_at else None,
        "updated_at": file_obj.updated_at.isoformat() if file_obj.updated_at else None,
        "deleted_at": file_obj.deleted_at.isoformat() if file_obj.deleted_at else None,
        "last_accessed_at": file_obj.last_accessed_at.isoformat() if file_obj.last_accessed_at else None,
        "purge_at": purge_at.isoformat() if purge_at else None,
        "days_left": days_left,
        "download_url": f"/api/cabinet/files/{file_obj.id}/download/",
        "preview_url": f"/api/cabinet/files/{file_obj.id}/preview/",
    }
    if include_relations:
        data["relations"] = relation_warnings(file_obj)
    return data


KIND_FILTERS = {
    "documents": [".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".txt", ".rtf", ".csv"],
    "images": [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp"],
    "video": [".mp4", ".webm", ".mov"],
    "audio": [".mp3", ".wav", ".ogg", ".m4a"],
    "archives": [".zip", ".rar", ".7z", ".tar", ".gz"],
    "code": [".py", ".js", ".ts", ".jsx", ".tsx", ".java", ".c", ".cpp", ".h", ".cs", ".html", ".css", ".json", ".xml", ".md", ".sql", ".sh"],
}


def list_directory(
    user,
    *,
    section: str = "my",
    folder_id=None,
    search: str = "",
    sort: str = "name",
    kind: str = "",
    student_id=None,
    group_id=None,
    lesson_id=None,
    homework_id=None,
    page: int = 1,
    page_size: int = 50,
) -> dict:
    page = max(1, int(page or 1))
    page_size = min(100, max(1, int(page_size or 50)))
    section = (section or "my").strip()
    search = (search or "").strip()
    kind = (kind or "").strip()

    breadcrumbs = [{"id": None, "name": "Мои файлы"}]
    current_folder = None

    folders_qs = CabinetFolder.objects.filter(owner=user, deleted_at__isnull=True)
    files_qs = CabinetFile.objects.filter(owner=user, status=CabinetFileStatus.ACTIVE)

    if section == "trash":
        folders_qs = CabinetFolder.objects.filter(owner=user, deleted_at__isnull=False)
        files_qs = CabinetFile.objects.filter(owner=user, status=CabinetFileStatus.TRASHED)
        breadcrumbs = [{"id": None, "name": "Корзина"}]
    elif section == "favorites":
        folders_qs = folders_qs.filter(is_favorite=True)
        files_qs = files_qs.filter(is_favorite=True)
        breadcrumbs = [{"id": None, "name": "Избранное"}]
    elif section == "recent":
        folders_qs = CabinetFolder.objects.none()
        files_qs = files_qs.order_by("-last_accessed_at", "-updated_at")
        breadcrumbs = [{"id": None, "name": "Недавние"}]
    elif section == "learning":
        folders_qs = CabinetFolder.objects.none()
        related_ids = CabinetFileRelation.objects.filter(file__owner=user).values_list("file_id", flat=True)
        files_qs = files_qs.filter(id__in=related_ids)
        breadcrumbs = [{"id": None, "name": "Учебные материалы"}]
    elif section == "shared":
        # Этап 3 — пока пусто для владельца
        folders_qs = CabinetFolder.objects.none()
        files_qs = CabinetFile.objects.none()
        breadcrumbs = [{"id": None, "name": "Доступные мне"}]
    else:
        if folder_id:
            current_folder = get_owned_folder(user, folder_id)
            folders_qs = folders_qs.filter(parent=current_folder)
            files_qs = files_qs.filter(folder=current_folder)
            breadcrumbs = [{"id": None, "name": "Мои файлы"}] + [
                {"id": str(f.id), "name": f.name} for f in folder_ancestors(current_folder)
            ]
        else:
            folders_qs = folders_qs.filter(parent__isnull=True)
            files_qs = files_qs.filter(folder__isnull=True)

    if search:
        folders_qs = folders_qs.filter(name__icontains=search)
        files_qs = files_qs.filter(
            Q(display_name__icontains=search)
            | Q(original_name__icontains=search)
            | Q(extension__icontains=search.lstrip("."))
        )
        # В поиске не ограничиваем текущей папкой для my
        if section == "my" and not folder_id:
            folders_qs = CabinetFolder.objects.filter(owner=user, deleted_at__isnull=True, name__icontains=search)
            files_qs = CabinetFile.objects.filter(owner=user, status=CabinetFileStatus.ACTIVE).filter(
                Q(display_name__icontains=search)
                | Q(original_name__icontains=search)
                | Q(extension__icontains=search.lstrip("."))
            )

    if kind in KIND_FILTERS:
        files_qs = files_qs.filter(extension__in=KIND_FILTERS[kind])
        folders_qs = folders_qs.none() if section != "trash" else folders_qs

    # Учебные фильтры
    rel_filter = Q()
    if student_id:
        rel_filter &= Q(relations__student_id=student_id)
    if group_id:
        rel_filter &= Q(relations__group_id=group_id)
    if lesson_id:
        rel_filter &= Q(relations__lesson_id=lesson_id)
    if homework_id:
        rel_filter &= Q(relations__homework_id=homework_id)
    if rel_filter:
        files_qs = files_qs.filter(rel_filter).distinct()
        folders_qs = folders_qs.none()

    # Сортировка
    folder_order = ["name"]
    file_order = ["display_name"]
    if sort == "updated":
        folder_order = ["-updated_at", "name"]
        file_order = ["-updated_at", "display_name"]
    elif sort == "created":
        folder_order = ["-created_at", "name"]
        file_order = ["-created_at", "display_name"]
    elif sort == "size":
        folder_order = ["name"]
        file_order = ["-size", "display_name"]
    elif sort == "type":
        folder_order = ["name"]
        file_order = ["extension", "display_name"]
    elif sort == "-name":
        folder_order = ["-name"]
        file_order = ["-display_name"]

    if section != "recent":
        folders_qs = folders_qs.order_by(*folder_order)
        files_qs = files_qs.order_by(*file_order)

    folders = list(folders_qs)
    files = list(files_qs)
    # Папки сначала, затем файлы; пагинация по объединённому списку
    items = [serialize_folder(f) for f in folders] + [serialize_file(f) for f in files]
    total = len(items)
    start = (page - 1) * page_size
    end = start + page_size
    return {
        "section": section,
        "folder": serialize_folder(current_folder) if current_folder else None,
        "breadcrumbs": breadcrumbs,
        "items": items[start:end],
        "page": page,
        "page_size": page_size,
        "total": total,
        "has_more": end < total,
        "quota": get_quota_info(user),
    }


@transaction.atomic
def attach_file(user, file_id, target_type: str, target_id) -> dict:
    file_obj = get_owned_file(user, file_id)
    target_type = (target_type or "").strip()
    # material / as_material — создать TeacherMaterial из файла; target_id не нужен
    material_only = target_type in (
        CabinetFileRelationType.MATERIAL,
        "material",
        "as_material",
    )
    if not target_type or (not material_only and target_id in (None, "")):
        raise FileServiceError("Укажите объект для прикрепления", code="TARGET_REQUIRED", status=400)

    rel_kwargs = {
        "file": file_obj,
        "relation_type": target_type,
        "created_by": user,
    }
    material = None

    if material_only:
        material = _ensure_material_bridge(user, file_obj)
        log_action(
            user,
            CabinetFileAuditAction.ATTACH,
            file=file_obj,
            meta={"target_type": "material", "material_id": material.id},
        )
        return {
            "relation": {
                "id": None,
                "relation_type": CabinetFileRelationType.MATERIAL,
                "material_id": material.id,
            },
            "file": serialize_file(file_obj, include_relations=True),
            "material_id": material.id,
            "material": {
                "id": material.id,
                "title": material.title,
                "material_type": material.material_type,
                "file_url": material_file_url(material),
                "cabinet_file_id": str(file_obj.id),
            },
        }
    if target_type == CabinetFileRelationType.LESSON:
        lesson = Lesson.objects.filter(pk=target_id, teacher=user).first()
        if not lesson:
            raise FileServiceError("Урок не найден", code="NOT_FOUND", status=404)
        rel_kwargs["lesson"] = lesson
        material = _ensure_material_bridge(user, file_obj)
        lesson.materials.add(material)
        rel_kwargs["material"] = material
    elif target_type == CabinetFileRelationType.PLAN_ITEM:
        item = LessonPlanItem.objects.filter(pk=target_id, plan__teacher=user).first()
        if not item:
            raise FileServiceError("Пункт плана не найден", code="NOT_FOUND", status=404)
        rel_kwargs["plan_item"] = item
        material = _ensure_material_bridge(user, file_obj)
        item.materials.add(material)
        rel_kwargs["material"] = material
    elif target_type == CabinetFileRelationType.HOMEWORK:
        homework = Homework.objects.filter(pk=target_id, teacher=user).first()
        if not homework:
            raise FileServiceError("Домашнее задание не найдено", code="NOT_FOUND", status=404)
        rel_kwargs["homework"] = homework
        material = _ensure_material_bridge(user, file_obj)
        rel_kwargs["material"] = material
        if homework.student_id:
            rel_kwargs["student"] = homework.student
        if homework.group_id:
            rel_kwargs["group"] = homework.group
    elif target_type == CabinetFileRelationType.SUBMISSION:
        submission = HomeworkSubmission.objects.select_related("homework").filter(pk=target_id).first()
        if not submission or submission.homework.teacher_id != user.id:
            # ученик — отдельная проверка в API
            raise FileServiceError("Сдача не найдена", code="NOT_FOUND", status=404)
        rel_kwargs["submission"] = submission
        rel_kwargs["homework"] = submission.homework
        rel_kwargs["student"] = submission.student
    elif target_type == CabinetFileRelationType.STUDENT:
        student = Student.objects.filter(pk=target_id, teacher=user).first()
        if not student:
            raise FileServiceError("Ученик не найден", code="NOT_FOUND", status=404)
        rel_kwargs["student"] = student
    elif target_type == CabinetFileRelationType.GROUP:
        group = StudentGroup.objects.filter(pk=target_id, teacher=user).first()
        if not group:
            raise FileServiceError("Группа не найдена", code="NOT_FOUND", status=404)
        rel_kwargs["group"] = group
    elif target_type == CabinetFileRelationType.BOARD:
        board = InteractiveBoard.objects.filter(pk=target_id, owner=user).first()
        if not board:
            raise FileServiceError("Доска не найдена", code="NOT_FOUND", status=404)
        rel_kwargs["board"] = board
    else:
        raise FileServiceError("Неизвестный тип объекта", code="INVALID_TARGET", status=400)

    # Избегаем дублей одной и той же связи
    existing = CabinetFileRelation.objects.filter(
        file=file_obj,
        relation_type=target_type,
        lesson=rel_kwargs.get("lesson"),
        plan_item=rel_kwargs.get("plan_item"),
        homework=rel_kwargs.get("homework"),
        submission=rel_kwargs.get("submission"),
        student=rel_kwargs.get("student") if target_type == CabinetFileRelationType.STUDENT else None,
        group=rel_kwargs.get("group") if target_type == CabinetFileRelationType.GROUP else None,
        board=rel_kwargs.get("board"),
    ).first()
    if existing:
        relation = existing
    else:
        relation = CabinetFileRelation.objects.create(**rel_kwargs)

    log_action(
        user,
        CabinetFileAuditAction.ATTACH,
        file=file_obj,
        meta={"target_type": target_type, "target_id": str(target_id), "relation_id": str(relation.id)},
    )
    return {
        "relation": {
            "id": str(relation.id),
            "relation_type": relation.relation_type,
            "material_id": material.id if material else None,
        },
        "file": serialize_file(file_obj, include_relations=True),
        "material_id": material.id if material else None,
    }


def assign_file_to_recipients(
    user,
    file_id,
    *,
    mode: str,
    student_id=None,
    group_id=None,
    message: str = "",
    title: str = "",
    due_at=None,
) -> dict:
    """Выдать файл ученику или группе как материал либо как ДЗ."""
    from datetime import datetime, time

    from django.utils.dateparse import parse_date, parse_datetime

    from .choices import StudentStatus
    from .models import DirectMaterialAssignment
    from .student_release import assign_custom_homework

    file_obj = get_owned_file(user, file_id)
    mode = (mode or "").strip().lower()
    if mode not in ("material", "homework"):
        raise FileServiceError(
            "Выберите способ выдачи: материал или домашнее задание",
            code="INVALID_MODE",
            status=400,
        )
    if not student_id and not group_id:
        raise FileServiceError("Укажите ученика или группу", code="TARGET_REQUIRED", status=400)
    if student_id and group_id:
        raise FileServiceError("Укажите либо ученика, либо группу", code="TARGET_AMBIGUOUS", status=400)

    student = None
    group = None
    if student_id:
        student = Student.objects.filter(pk=student_id, teacher=user).first()
        if not student:
            raise FileServiceError("Ученик не найден", code="NOT_FOUND", status=404)
    if group_id:
        group = StudentGroup.objects.filter(pk=group_id, teacher=user).first()
        if not group:
            raise FileServiceError("Группа не найдена", code="NOT_FOUND", status=404)

    material = _ensure_material_bridge(user, file_obj)
    if material.title != file_obj.display_name:
        material.title = file_obj.display_name
        material.save(update_fields=["title", "updated_at"])

    parsed_due = None
    if due_at:
        parsed_due = parse_datetime(str(due_at))
        if parsed_due is None:
            date_val = parse_date(str(due_at))
            if date_val:
                parsed_due = timezone.make_aware(
                    datetime.combine(date_val, time(hour=23, minute=59)),
                    timezone.get_current_timezone(),
                )
        elif timezone.is_naive(parsed_due):
            parsed_due = timezone.make_aware(parsed_due, timezone.get_current_timezone())

    result = {
        "mode": mode,
        "material_id": material.id,
        "file_id": str(file_obj.id),
        "assignments": [],
        "homeworks": [],
    }

    if mode == "material":
        da = DirectMaterialAssignment.objects.create(
            teacher=user,
            material=material,
            group=group,
            student=student,
            message=(message or "").strip(),
        )
        if student:
            CabinetFileRelation.objects.get_or_create(
                file=file_obj,
                relation_type=CabinetFileRelationType.STUDENT,
                student=student,
                defaults={"created_by": user, "material": material},
            )
        if group:
            CabinetFileRelation.objects.get_or_create(
                file=file_obj,
                relation_type=CabinetFileRelationType.GROUP,
                group=group,
                defaults={"created_by": user, "material": material},
            )
        result["assignments"].append({"id": da.id, "student_id": student.id if student else None, "group_id": group.id if group else None})
        log_action(
            user,
            CabinetFileAuditAction.ATTACH,
            file=file_obj,
            meta={"mode": "material", "student_id": student.id if student else None, "group_id": group.id if group else None},
        )
        return result

    # homework
    hw_title = (title or "").strip() or f"ДЗ: {file_obj.display_name}"
    hw_description = (message or "").strip()
    recipients = []
    if student:
        recipients = [student]
    else:
        recipients = list(group.students.filter(status=StudentStatus.ACTIVE)) or list(group.students.all())
        if not recipients:
            raise FileServiceError("В группе пока нет учеников", code="GROUP_EMPTY", status=400)

    errors = []
    for recipient in recipients:
        try:
            homework = assign_custom_homework(
                teacher=user,
                student=recipient,
                title=hw_title,
                description=hw_description or f"Материал: {file_obj.display_name}",
                material_ids=[material.id],
                due_at=parsed_due,
            )
            CabinetFileRelation.objects.get_or_create(
                file=file_obj,
                relation_type=CabinetFileRelationType.HOMEWORK,
                homework=homework,
                defaults={
                    "created_by": user,
                    "material": material,
                    "student": recipient,
                    "group": group,
                },
            )
            result["homeworks"].append({"id": homework.id, "student_id": recipient.id})
        except Exception as exc:
            errors.append(f"{recipient}: {exc}")

    if not result["homeworks"]:
        raise FileServiceError(
            errors[0] if errors else "Не удалось выдать домашнее задание",
            code="ASSIGN_FAILED",
            status=400,
        )

    log_action(
        user,
        CabinetFileAuditAction.ATTACH,
        file=file_obj,
        meta={
            "mode": "homework",
            "student_id": student.id if student else None,
            "group_id": group.id if group else None,
            "homework_ids": [h["id"] for h in result["homeworks"]],
            "errors": errors,
        },
    )
    if errors:
        result["partial_errors"] = errors
    return result


def attach_file_for_student(user, file_id, submission: HomeworkSubmission) -> dict:
    file_obj = get_owned_file(user, file_id)
    relation, _ = CabinetFileRelation.objects.get_or_create(
        file=file_obj,
        relation_type=CabinetFileRelationType.SUBMISSION,
        submission=submission,
        defaults={
            "homework": submission.homework,
            "student": submission.student,
            "created_by": user,
        },
    )
    # Связываем submission.attached_file с тем же storage_key без второй копии на диске
    if not submission.attached_file or submission.attached_file.name != file_obj.storage_key:
        submission.attached_file = file_obj.storage_key
        submission.save(update_fields=["attached_file", "updated_at"])
    log_action(
        user,
        CabinetFileAuditAction.ATTACH,
        file=file_obj,
        meta={"target_type": "submission", "target_id": submission.id, "relation_id": str(relation.id)},
    )
    return {"relation_id": str(relation.id), "file": serialize_file(file_obj)}


def _ensure_material_bridge(user, file_obj: CabinetFile) -> Material:
    material = Material.objects.filter(teacher=user, cabinet_file=file_obj).first()
    if material:
        return material
    from .choices import MaterialType, MaterialStatus

    material = Material(
        teacher=user,
        title=file_obj.display_name,
        material_type=MaterialType.FILE,
        status=MaterialStatus.PUBLISHED,
        cabinet_file=file_obj,
    )
    # Указываем тот же ключ хранилища — без повторной записи байтов
    material.file.name = file_obj.storage_key
    material.save()
    CabinetFileRelation.objects.get_or_create(
        file=file_obj,
        relation_type=CabinetFileRelationType.MATERIAL,
        material=material,
        defaults={"created_by": user},
    )
    return material


def detach_relation(user, relation_id) -> dict:
    try:
        relation = CabinetFileRelation.objects.select_related("file", "material", "lesson", "plan_item").get(pk=relation_id)
    except CabinetFileRelation.DoesNotExist as exc:
        raise FileServiceError("Связь не найдена", code="NOT_FOUND", status=404) from exc
    if relation.file.owner_id != user.id and relation.created_by_id != user.id:
        raise FileServiceError("Нет доступа", code="FORBIDDEN", status=403)

    if relation.material_id:
        if relation.lesson_id:
            relation.lesson.materials.remove(relation.material)
        if relation.plan_item_id:
            relation.plan_item.materials.remove(relation.material)

    file_obj = relation.file
    relation.delete()
    log_action(user, CabinetFileAuditAction.DETACH, file=file_obj, meta={"relation_id": str(relation_id)})
    return {"ok": True}


def submission_attached_file_api_url(submission: HomeworkSubmission, *, for_student: bool = True) -> str:
    """Авторизованный URL скачивания ответа — без публичного /media/."""
    if not submission or not submission.pk:
        return ""
    if for_student and submission.homework_id:
        return f"/api/cabinet/student/assignments/{submission.homework_id}/attached-file/"
    return f"/api/cabinet/homework/submissions/{submission.pk}/attached-file/"


def submission_file_url(submission: HomeworkSubmission, *, for_student: bool = True) -> str:
    if not submission:
        return ""
    rel = (
        CabinetFileRelation.objects.filter(
            submission=submission,
            relation_type=CabinetFileRelationType.SUBMISSION,
        )
        .select_related("file")
        .first()
    )
    if rel and rel.file_id:
        if for_student:
            # Владелец файла — ученик
            if rel.file.owner_id:
                return f"/api/cabinet/student/files/{rel.file_id}/download/"
            return f"/api/cabinet/student/files/shared/{rel.file_id}/download/"
        return f"/api/cabinet/files/{rel.file_id}/download/"
    if submission.attached_file:
        name = (submission.attached_file.name or "").lstrip("/")
        if name.startswith("cabinet/my-files/"):
            # Закрытое хранилище: ищем CabinetFile и отдаём API-ссылку
            file_obj = CabinetFile.objects.filter(storage_key=name).first()
            if file_obj is None:
                file_obj = CabinetFile.objects.filter(storage_key=name.lstrip("/")).first()
            if file_obj is not None:
                if for_student:
                    return f"/api/cabinet/student/files/{file_obj.id}/download/"
                return f"/api/cabinet/files/{file_obj.id}/download/"
            return ""
        # cabinet/homework/ и прочие FileField — только через авторизованный API
        return submission_attached_file_api_url(submission, for_student=for_student)
    return ""


def student_can_access_material_file(user, material: Material) -> bool:
    """Ученик может скачать файл материала только если он выдан ему в кабинете."""
    if not user or not getattr(user, "is_authenticated", False) or not material:
        return False
    from .models import (
        DirectMaterialAssignment,
        Homework,
        LessonAssignment,
        Student,
    )

    student_ids = list(Student.objects.filter(user=user).values_list("id", flat=True))
    if not student_ids:
        return False
    if material.teacher_id and not Student.objects.filter(
        id__in=student_ids, teacher_id=material.teacher_id
    ).exists():
        return False
    if DirectMaterialAssignment.objects.filter(
        student_id__in=student_ids, material=material
    ).exists():
        return True
    if LessonAssignment.objects.filter(
        student_id__in=student_ids, lesson__materials=material
    ).exists():
        return True
    if LessonAssignment.objects.filter(
        group__students__id__in=student_ids, lesson__materials=material
    ).exists():
        return True
    hw_qs = Homework.objects.filter(
        Q(student_id__in=student_ids) | Q(group__students__id__in=student_ids)
    )
    if hw_qs.filter(lesson_plan_item__homework_materials=material).exists():
        return True
    if hw_qs.filter(lesson_plan_item__materials=material).exists():
        return True
    if hw_qs.filter(lesson__materials=material).exists():
        return True
    return False


def _legacy_material_file_api_url(material: Material, *, for_student: bool, inline: bool) -> str:
    """Авторизованный URL для Material.file без публичного /media/."""
    if not material or not material.pk:
        return ""
    action = "preview" if inline else "file"
    if for_student:
        return f"/api/cabinet/student/materials/{material.pk}/{action}/"
    return f"/api/cabinet/materials/{material.pk}/{action}/"


def material_file_url(material: Material, *, for_student: bool = False) -> str:
    if material.cabinet_file_id:
        if for_student:
            return f"/api/cabinet/student/files/shared/{material.cabinet_file_id}/download/"
        return f"/api/cabinet/files/{material.cabinet_file_id}/download/"
    if material.file:
        # Приватные префиксы нельзя отдавать как публичный /media/
        name = material.file.name or ""
        if name.startswith("cabinet/my-files/"):
            if material.cabinet_file_id:
                return material_file_url(material, for_student=for_student)
            return ""
        if (
            name.startswith("cabinet/materials/")
            or name.startswith("cabinet/homework/")
            or name.startswith("cabinet/boards/")
            or name.startswith("cabinet/boards_private/")
        ):
            return _legacy_material_file_api_url(material, for_student=for_student, inline=False)
        return material.file.url
    return ""


def material_view_url(material: Material, *, for_student: bool = False) -> str:
    """
    URL для просмотра в iframe/img (inline), а не скачивания.
    Для файлов из хранилища всегда API preview — /media/cabinet/my-files/ закрыт.
    """
    if material.cabinet_file_id:
        if for_student:
            return f"/api/cabinet/student/files/shared/{material.cabinet_file_id}/preview/"
        return f"/api/cabinet/files/{material.cabinet_file_id}/preview/"
    if material.file:
        name = material.file.name or ""
        if name.startswith("cabinet/my-files/") or name.startswith("cabinet/boards_private/"):
            # Без cabinet_file публичный media недоступен — вернём пусто.
            return ""
        if (
            name.startswith("cabinet/materials/")
            or name.startswith("cabinet/homework/")
            or name.startswith("cabinet/boards/")
        ):
            return _legacy_material_file_api_url(material, for_student=for_student, inline=True)
        return material.file.url
    return (material.external_url or "").strip()


def is_blocked_media_url(url: str) -> bool:
    raw = (url or "").strip().lower()
    if not raw:
        return False
    path = raw.split("?", 1)[0]
    return (
        "/media/cabinet/my-files/" in path
        or "/media/cabinet/boards_private/" in path
        or "/media/cabinet/homework/" in path
        or "/media/cabinet/materials/" in path
        or path.startswith("cabinet/my-files/")
        or path.startswith("cabinet/boards_private/")
        or path.startswith("cabinet/homework/")
        or path.startswith("cabinet/materials/")
    )
