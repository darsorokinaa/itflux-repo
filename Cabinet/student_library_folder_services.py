"""Сервисы оверлей-папок материалов ученика (вложенность, перемещение, ACL)."""

from django.db import transaction

from .models import Student, StudentMaterialFolder


class StudentFolderServiceError(Exception):
    def __init__(self, message, *, code="ERROR", status=400):
        super().__init__(message)
        self.code = code
        self.status = status


def get_owned_student_folder(*, teacher, student, folder_id) -> StudentMaterialFolder:
    folder = StudentMaterialFolder.objects.filter(
        pk=folder_id,
        teacher=teacher,
        student=student,
    ).select_related("parent").first()
    if folder is None:
        raise StudentFolderServiceError("Папка не найдена", code="NOT_FOUND", status=404)
    return folder


def _normalize_parent_id(parent_id):
    if parent_id in ("", None, 0, "0"):
        return None
    return parent_id


def folder_name_clash(*, teacher, student, name, parent_id, exclude_id=None):
    qs = StudentMaterialFolder.objects.filter(
        teacher=teacher,
        student=student,
        name=name,
    )
    if parent_id is None:
        qs = qs.filter(parent__isnull=True)
    else:
        qs = qs.filter(parent_id=parent_id)
    if exclude_id is not None:
        qs = qs.exclude(pk=exclude_id)
    return qs.exists()


def assert_no_student_folder_cycle(folder: StudentMaterialFolder, new_parent: StudentMaterialFolder | None) -> None:
    if new_parent is None:
        return
    if new_parent.id == folder.id:
        raise StudentFolderServiceError(
            "Нельзя переместить папку внутрь самой себя",
            code="FOLDER_CYCLE",
            status=400,
        )
    if new_parent.teacher_id != folder.teacher_id or new_parent.student_id != folder.student_id:
        raise StudentFolderServiceError("Папка не найдена", code="NOT_FOUND", status=404)
    current = new_parent
    seen = {folder.id}
    while current is not None:
        if current.id in seen:
            raise StudentFolderServiceError(
                "Нельзя переместить папку внутрь своей дочерней папки",
                code="FOLDER_CYCLE",
                status=400,
            )
        seen.add(current.id)
        current = current.parent


def folder_breadcrumbs(folder: StudentMaterialFolder | None) -> list[dict]:
    if folder is None:
        return []
    chain = []
    seen = set()
    current = folder
    while current is not None:
        if current.id in seen:
            break
        seen.add(current.id)
        chain.append(current)
        current = current.parent
    chain.reverse()
    return [{"id": f.id, "name": f.name} for f in chain]


@transaction.atomic
def create_student_material_folder(
    *,
    teacher,
    student,
    name: str,
    parent_id=None,
    student_subject=None,
) -> StudentMaterialFolder:
    name = (name or "").strip()
    if not name:
        raise StudentFolderServiceError("Название папки обязательно", code="NAME_REQUIRED", status=400)
    if len(name) > 80:
        raise StudentFolderServiceError("Слишком длинное название", code="NAME_TOO_LONG", status=400)
    parent_id = _normalize_parent_id(parent_id)
    parent = None
    if parent_id is not None:
        parent = get_owned_student_folder(teacher=teacher, student=student, folder_id=parent_id)
    if folder_name_clash(teacher=teacher, student=student, name=name, parent_id=parent_id):
        raise StudentFolderServiceError(
            "Папка с таким названием уже есть",
            code="NAME_CLASH",
            status=400,
        )
    return StudentMaterialFolder.objects.create(
        teacher=teacher,
        student=student,
        name=name,
        parent=parent,
        student_subject=student_subject,
    )


@transaction.atomic
def rename_student_material_folder(*, folder: StudentMaterialFolder, name: str) -> StudentMaterialFolder:
    name = (name or "").strip()
    if not name:
        raise StudentFolderServiceError("Название папки обязательно", code="NAME_REQUIRED", status=400)
    if len(name) > 80:
        raise StudentFolderServiceError("Слишком длинное название", code="NAME_TOO_LONG", status=400)
    parent_id = folder.parent_id
    if folder_name_clash(
        teacher=folder.teacher,
        student=folder.student,
        name=name,
        parent_id=parent_id,
        exclude_id=folder.id,
    ):
        raise StudentFolderServiceError(
            "Папка с таким названием уже есть",
            code="NAME_CLASH",
            status=400,
        )
    folder.name = name
    folder.save(update_fields=["name", "updated_at"])
    return folder


@transaction.atomic
def move_student_material_folder(
    *,
    folder: StudentMaterialFolder,
    parent_id=None,
) -> StudentMaterialFolder:
    parent_id = _normalize_parent_id(parent_id)
    parent = None
    if parent_id is not None:
        parent = get_owned_student_folder(
            teacher=folder.teacher,
            student=folder.student,
            folder_id=parent_id,
        )
    assert_no_student_folder_cycle(folder, parent)
    folder.parent = parent
    folder.save(update_fields=["parent", "updated_at"])
    return folder


def descendant_folder_ids(folder: StudentMaterialFolder) -> set[int]:
    """Все id дочерних папок (без самой папки)."""
    result = set()
    frontier = list(
        StudentMaterialFolder.objects.filter(parent_id=folder.id).values_list("id", flat=True)
    )
    while frontier:
        fid = frontier.pop()
        if fid in result:
            continue
        result.add(fid)
        frontier.extend(
            StudentMaterialFolder.objects.filter(parent_id=fid).values_list("id", flat=True)
        )
    return result


def folder_direct_item_counts(*, teacher, student, folder_ids) -> dict[int, int]:
    if not folder_ids:
        return {}
    from .models import StudentMaterialPlacement

    rows = (
        StudentMaterialPlacement.objects.filter(
            teacher=teacher,
            student=student,
            folder_id__in=folder_ids,
        )
        .values("folder_id")
        .order_by()
    )
    counts = {}
    for row in rows:
        fid = row["folder_id"]
        counts[fid] = counts.get(fid, 0) + 1
    return counts


def student_folder_queryset(*, teacher, student):
    return StudentMaterialFolder.objects.filter(
        teacher=teacher,
        student=student,
    ).select_related("parent", "teacher", "teacher__profile", "student_subject")


def archived_student_ids_for_teacher(teacher) -> set[int]:
    from .choices import StudentStatus

    return set(
        Student.objects.filter(teacher=teacher, status=StudentStatus.ARCHIVED).values_list("id", flat=True)
    )
