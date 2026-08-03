"""Множественные вложения домашнего задания через CabinetFileRelation."""

from __future__ import annotations

from django.conf import settings
from django.db import transaction
from django.db.models import Max
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .choices import HomeworkTaskType
from .files_models import CabinetFileRelation, CabinetFileRelationType
from .files_services import (
    FileServiceError,
    _ensure_material_bridge,
    attach_file,
    detach_relation,
    material_file_url,
    material_view_url,
    upload_file,
)
from .models import Homework, HomeworkTask, Student
from .permissions import IsCabinetTeacher
from .upload_validation import (
    ALLOWED_UPLOAD_CONTENT_TYPES,
    ALLOWED_UPLOAD_EXTENSIONS,
    UploadValidationError,
    validate_uploaded_file,
)


def _teacher_can_edit_homework(teacher, homework: Homework) -> bool:
    from .homework_edit import teacher_can_edit_homework

    return teacher_can_edit_homework(teacher, homework)


class HomeworkAttachmentError(Exception):
    def __init__(self, message: str, code: str = "attachment_error", status: int = 400, extra=None):
        super().__init__(message)
        self.message = message
        self.code = code
        self.status = status
        self.extra = extra or {}


def _max_size() -> int:
    return int(
        getattr(
            settings,
            "HOMEWORK_ATTACHMENT_MAX_SIZE",
            getattr(settings, "CABINET_MAX_UPLOAD_BYTES", 20 * 1024 * 1024),
        )
    )


def _max_count() -> int:
    return int(getattr(settings, "HOMEWORK_ATTACHMENT_MAX_COUNT", 20))


def _allowed_types():
    configured = getattr(settings, "HOMEWORK_ALLOWED_ATTACHMENT_TYPES", None)
    if configured:
        return frozenset(configured)
    return ALLOWED_UPLOAD_CONTENT_TYPES


def _is_image(mime_type: str, extension: str) -> bool:
    mime = (mime_type or "").lower()
    ext = (extension or "").lower()
    if mime.startswith("image/"):
        return True
    return ext in {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".heic", ".heif", ".svg"}


def serialize_homework_attachment(relation: CabinetFileRelation, *, for_student: bool = False) -> dict:
    file_obj = relation.file
    material = relation.material
    name = (
        (file_obj.display_name if file_obj else "")
        or (file_obj.original_name if file_obj else "")
        or (material.title if material else "")
        or "Файл"
    )
    mime = (file_obj.mime_type if file_obj else "") or ""
    extension = (file_obj.extension if file_obj else "") or ""
    size = int(file_obj.size if file_obj else 0)
    if file_obj is not None:
        if for_student:
            url = f"/api/cabinet/student/files/shared/{file_obj.id}/download/"
            preview_url = f"/api/cabinet/student/files/shared/{file_obj.id}/preview/"
        else:
            url = f"/api/cabinet/files/{file_obj.id}/download/"
            preview_url = f"/api/cabinet/files/{file_obj.id}/preview/"
    elif material is not None:
        url = material_file_url(material, for_student=for_student)
        preview_url = material_view_url(material, for_student=for_student)
    else:
        url = ""
        preview_url = ""

    return {
        "id": str(relation.id),
        "relation_id": str(relation.id),
        "file_id": str(file_obj.id) if file_obj else None,
        "material_id": material.id if material else None,
        "name": name,
        "original_name": (file_obj.original_name if file_obj else name) or name,
        "url": url,
        "preview_url": preview_url if _is_image(mime, extension) else "",
        "mime_type": mime,
        "extension": extension,
        "size": size,
        "is_image": _is_image(mime, extension),
        "created_at": relation.created_at.isoformat() if relation.created_at else None,
    }


def list_homework_attachments(homework: Homework, *, for_student: bool = False) -> list[dict]:
    relations = (
        CabinetFileRelation.objects.filter(
            homework=homework,
            relation_type=CabinetFileRelationType.HOMEWORK,
        )
        .select_related("file", "material")
        .order_by("created_at", "id")
    )
    return [serialize_homework_attachment(rel, for_student=for_student) for rel in relations]


def _validate_homework_upload(uploaded) -> None:
    # Базовая проверка проекта + явные лимиты ДЗ
    validate_uploaded_file(uploaded)
    size = getattr(uploaded, "size", None)
    max_size = _max_size()
    if size is not None and size > max_size:
        mb = max_size // (1024 * 1024)
        raise HomeworkAttachmentError(
            f"Файл слишком большой. Максимум {mb} МБ.",
            code="FILE_TOO_LARGE",
        )
    mime = (getattr(uploaded, "content_type", None) or "").split(";")[0].strip().lower()
    allowed = _allowed_types()
    if mime and mime not in allowed and mime != "application/octet-stream":
        raise HomeworkAttachmentError(
            f"Тип файла «{mime}» не поддерживается.",
            code="MIME_NOT_ALLOWED",
        )
    name = getattr(uploaded, "name", "") or ""
    ext = ("." + name.rsplit(".", 1)[-1].lower()) if "." in name else ""
    if ext and ext not in ALLOWED_UPLOAD_EXTENSIONS:
        raise HomeworkAttachmentError(
            f"Расширение «{ext}» не поддерживается.",
            code="EXT_NOT_ALLOWED",
        )


def _ensure_file_task_for_material(homework: Homework, material, *, teacher) -> HomeworkTask:
    from .student_release import _material_resource_url

    resource_url = _material_resource_url(material)
    existing = (
        homework.tasks.filter(is_active=True, task_type=HomeworkTaskType.FILE, title=material.title)
        .order_by("order", "id")
        .first()
    )
    if existing:
        updates = []
        if resource_url and existing.description != resource_url:
            existing.description = resource_url
            updates.append("description")
        if updates:
            existing.save(update_fields=updates)
        return existing

    max_order = homework.tasks.aggregate(m=Max("order")).get("m") or 0
    return HomeworkTask.objects.create(
        homework=homework,
        title=material.title,
        task_type=HomeworkTaskType.FILE,
        description=resource_url,
        order=max_order + 1,
        is_active=True,
    )


def _remove_file_task_for_material(homework: Homework, material) -> None:
    if material is None:
        return
    tasks = homework.tasks.filter(
        is_active=True,
        task_type=HomeworkTaskType.FILE,
        title=material.title,
    )
    for task in tasks:
        # Не трогаем ответы ученика — только деактивируем задание-файл
        task.is_active = False
        task.save(update_fields=["is_active"])


@transaction.atomic
def add_homework_attachments(homework: Homework, teacher, uploaded_files: list) -> dict:
    if homework.teacher_id != getattr(teacher, "id", teacher) and not (
        getattr(teacher, "is_staff", False) or getattr(teacher, "is_superuser", False)
    ):
        raise HomeworkAttachmentError("Нет доступа", code="forbidden", status=403)

    files = [f for f in (uploaded_files or []) if f]
    if not files:
        raise HomeworkAttachmentError("Файлы не переданы", code="FILE_REQUIRED")

    current_count = CabinetFileRelation.objects.filter(
        homework=homework,
        relation_type=CabinetFileRelationType.HOMEWORK,
    ).count()
    max_count = _max_count()
    if current_count + len(files) > max_count:
        raise HomeworkAttachmentError(
            f"Слишком много вложений. Максимум {max_count} на одно ДЗ "
            f"(сейчас {current_count}, пытаетесь добавить {len(files)}).",
            code="TOO_MANY_ATTACHMENTS",
        )

    created = []
    errors = []
    for uploaded in files:
        filename = getattr(uploaded, "name", None) or "файл"
        try:
            _validate_homework_upload(uploaded)
            file_obj = upload_file(teacher, uploaded)
            result = attach_file(
                teacher,
                file_obj.id,
                CabinetFileRelationType.HOMEWORK,
                homework.pk,
            )
            relation_id = (result.get("relation") or {}).get("id")
            relation = (
                CabinetFileRelation.objects.select_related("file", "material")
                .filter(pk=relation_id)
                .first()
            )
            if relation is None:
                relation = (
                    CabinetFileRelation.objects.select_related("file", "material")
                    .filter(
                        file=file_obj,
                        homework=homework,
                        relation_type=CabinetFileRelationType.HOMEWORK,
                    )
                    .order_by("-created_at")
                    .first()
                )
            material = relation.material if relation else None
            if material is None:
                material = _ensure_material_bridge(teacher, file_obj)
                if relation:
                    relation.material = material
                    relation.save(update_fields=["material"])
            _ensure_file_task_for_material(homework, material, teacher=teacher)
            created.append(serialize_homework_attachment(relation))
        except (HomeworkAttachmentError, UploadValidationError, FileServiceError) as exc:
            errors.append(
                {
                    "name": filename,
                    "detail": getattr(exc, "message", None) or str(exc),
                    "code": getattr(exc, "code", "upload_error"),
                }
            )

    if not created and errors:
        raise HomeworkAttachmentError(
            errors[0]["detail"],
            code=errors[0].get("code") or "upload_error",
            extra={"errors": errors},
        )

    return {
        "attachments": created,
        "errors": errors,
        "all_attachments": list_homework_attachments(homework),
    }


@transaction.atomic
def delete_homework_attachment(homework: Homework, teacher, attachment_id) -> dict:
    if not _teacher_can_edit_homework(teacher, homework):
        raise HomeworkAttachmentError("Нет доступа", code="forbidden", status=403)

    relation = (
        CabinetFileRelation.objects.select_related("file", "material")
        .filter(
            pk=attachment_id,
            homework=homework,
            relation_type=CabinetFileRelationType.HOMEWORK,
        )
        .first()
    )
    if relation is None:
        raise HomeworkAttachmentError("Вложение не найдено", code="NOT_FOUND", status=404)

    material = relation.material
    detach_relation(teacher, relation.id)
    _remove_file_task_for_material(homework, material)
    return {
        "ok": True,
        "deleted_id": str(attachment_id),
        "attachments": list_homework_attachments(homework),
    }


def user_can_view_homework_attachments(user, homework: Homework) -> bool:
    if _teacher_can_edit_homework(user, homework):
        return True
    # Ученик — адресат ДЗ
    student_ids = list(Student.objects.filter(user=user).values_list("id", flat=True))
    if homework.student_id and homework.student_id in student_ids:
        return True
    if homework.group_id and Student.objects.filter(user=user, groups=homework.group_id).exists():
        return True
    # Родитель ребёнка-адресата с правом view_homework
    try:
        from .parent_models import ParentRelationshipStatus, ParentStudentRelationship

        child_ids = []
        if homework.student_id:
            child_ids.append(homework.student_id)
        if homework.group_id:
            child_ids.extend(
                list(Student.objects.filter(groups=homework.group_id).values_list("id", flat=True))
            )
        if child_ids:
            rels = ParentStudentRelationship.objects.filter(
                parent=user,
                student_id__in=child_ids,
                status=ParentRelationshipStatus.ACTIVE,
            )
            for rel in rels:
                if rel.has_permission("view_homework"):
                    return True
    except Exception:
        pass
    return False


class HomeworkAttachmentsView(APIView):
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser]

    def _get_homework(self, homework_id: int) -> Homework:
        return get_object_or_404(
            Homework.objects.select_related("student", "group", "teacher"),
            pk=homework_id,
        )

    def get(self, request, homework_id: int):
        homework = self._get_homework(homework_id)
        if not user_can_view_homework_attachments(request.user, homework):
            return Response({"detail": "Нет доступа"}, status=status.HTTP_403_FORBIDDEN)
        for_student = not _teacher_can_edit_homework(request.user, homework)
        return Response(
            {
                "attachments": list_homework_attachments(homework, for_student=for_student),
                "limits": {
                    "max_size": _max_size(),
                    "max_count": _max_count(),
                },
            }
        )

    def post(self, request, homework_id: int):
        if not IsCabinetTeacher().has_permission(request, self):
            return Response({"detail": "Только учитель может добавлять вложения"}, status=403)
        homework = self._get_homework(homework_id)
        if not _teacher_can_edit_homework(request.user, homework):
            return Response({"detail": "Нет доступа"}, status=status.HTTP_403_FORBIDDEN)

        uploaded = []
        if hasattr(request.FILES, "getlist"):
            uploaded.extend(request.FILES.getlist("files") or [])
            uploaded.extend(request.FILES.getlist("file") or [])
            uploaded.extend(request.FILES.getlist("attachments") or [])
        # одиночный file=
        single = request.FILES.get("file")
        if single and single not in uploaded:
            uploaded.append(single)

        try:
            result = add_homework_attachments(homework, request.user, uploaded)
        except HomeworkAttachmentError as exc:
            body = {"detail": exc.message, "code": exc.code}
            if exc.extra:
                body.update(exc.extra)
            return Response(body, status=exc.status)
        except FileServiceError as exc:
            return Response(
                {"detail": exc.message, "code": exc.code},
                status=exc.status,
            )
        return Response(result, status=status.HTTP_201_CREATED)


class HomeworkAttachmentDetailView(APIView):
    permission_classes = [IsAuthenticated, IsCabinetTeacher]

    def delete(self, request, homework_id: int, attachment_id):
        homework = get_object_or_404(Homework, pk=homework_id)
        try:
            result = delete_homework_attachment(homework, request.user, attachment_id)
        except HomeworkAttachmentError as exc:
            return Response(
                {"detail": exc.message, "code": exc.code},
                status=exc.status,
            )
        except FileServiceError as exc:
            return Response(
                {"detail": exc.message, "code": exc.code},
                status=exc.status,
            )
        return Response(result)
