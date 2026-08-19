"""Оверлей папок над уже выданными материалами ученика."""

from django.db.utils import OperationalError, ProgrammingError

from .models import StudentMaterialFolder, StudentMaterialPlacement


def _teacher_name(user):
    profile = getattr(user, "profile", None)
    if profile:
        return profile.get_display_name()
    return user.get_full_name() or user.username


def library_key_of(item):
    return str(item.get("id") or "")


def serialize_folder(folder, *, item_count=0, teacher=None):
    teacher_obj = teacher or getattr(folder, "teacher", None)
    return {
        "id": folder.id,
        "name": folder.name,
        "parent_id": folder.parent_id,
        "student_subject_id": folder.student_subject_id,
        "item_count": item_count,
        "teacher_id": folder.teacher_id,
        "teacher_name": _teacher_name(teacher_obj) if teacher_obj is not None else "",
        "kind": "folder",
    }


def attach_library_folders(items, *, students=None, teacher=None, student=None):
    """Добавляет folder_id / library_key. Возвращает (items, folders)."""
    if not items and not (students or student):
        return items, []
    try:
        return _attach_library_folders(items, students=students, teacher=teacher, student=student)
    except (ProgrammingError, OperationalError):
        for item in items:
            item["library_key"] = library_key_of(item)
            item.setdefault("folder_id", None)
            item.setdefault("folder_name", "")
        return items, []


def _attach_library_folders(items, *, students=None, teacher=None, student=None):
    """Добавляет folder_id / library_key. Возвращает (items, folders)."""
    if not items and not (students or student):
        return items, []

    qs = StudentMaterialPlacement.objects.select_related(
        "folder", "folder__teacher", "folder__teacher__profile", "teacher", "teacher__profile",
    )
    folder_qs = StudentMaterialFolder.objects.select_related(
        "teacher", "teacher__profile", "student_subject", "parent",
    )
    if teacher is not None and student is not None:
        qs = qs.filter(teacher=teacher, student=student)
        folder_qs = folder_qs.filter(teacher=teacher, student=student)
        placements = list(qs)
        by_key = {p.library_key: p for p in placements}

        def lookup(item):
            return by_key.get(library_key_of(item))
    else:
        student_ids = [s.id for s in (students or [])]
        if not student_ids:
            for item in items:
                item["library_key"] = library_key_of(item)
                item.setdefault("folder_id", None)
                item.setdefault("folder_name", "")
            return items, []
        qs = qs.filter(student_id__in=student_ids)
        folder_qs = folder_qs.filter(student_id__in=student_ids)
        placements = list(qs)
        by_pair = {(p.teacher_id, p.library_key): p for p in placements}

        def lookup(item):
            return by_pair.get((item.get("teacher_id"), library_key_of(item)))

    counts = {}
    for item in items:
        key = library_key_of(item)
        item["library_key"] = key
        placement = lookup(item)
        folder = placement.folder if placement is not None else None
        item["folder_id"] = folder.id if folder is not None else None
        item["folder_name"] = folder.name if folder is not None else ""
        if folder is not None:
            counts[folder.id] = counts.get(folder.id, 0) + 1

    folder_list = list(folder_qs.order_by("sort_order", "name", "id"))
    folders = [
        serialize_folder(folder, item_count=counts.get(folder.id, 0), teacher=folder.teacher)
        for folder in folder_list
    ]
    return items, folders


def place_library_items(*, teacher, student, keys, folder=None, allowed_keys=None):
    """folder=None снимает с папки. Не трогает оригиналы материалов."""
    clean_keys = []
    seen = set()
    for raw in keys or []:
        key = str(raw or "").strip()
        if not key or key in seen:
            continue
        if allowed_keys is not None and key not in allowed_keys:
            continue
        seen.add(key)
        clean_keys.append(key)
    if not clean_keys:
        return 0
    if folder is not None and (folder.teacher_id != teacher.id or folder.student_id != student.id):
        raise PermissionError("folder")
    count = 0
    for key in clean_keys:
        if folder is None:
            deleted, _ = StudentMaterialPlacement.objects.filter(
                teacher=teacher, student=student, library_key=key,
            ).delete()
            if deleted:
                count += 1
            continue
        placement, created = StudentMaterialPlacement.objects.get_or_create(
            teacher=teacher,
            student=student,
            library_key=key,
            defaults={"folder": folder, "source": ""},
        )
        if created or placement.folder_id != folder.id:
            placement.folder = folder
            placement.save(update_fields=["folder", "updated_at"])
            count += 1
        else:
            count += 1
    return count
