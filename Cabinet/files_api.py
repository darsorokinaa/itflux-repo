"""API личного файлового хранилища «Мои файлы»."""

from __future__ import annotations

import mimetypes

from django.http import FileResponse, Http404
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from .files_services import (
    FileServiceError,
    attach_file,
    attach_file_for_student,
    assign_file_to_recipients,
    copy_file,
    create_folder,
    detach_relation,
    download_filename,
    empty_trash,
    get_owned_file,
    get_owned_folder,
    get_quota_info,
    get_readable_file,
    list_directory,
    log_action,
    move_file,
    move_folder,
    purge_file,
    rename_file,
    rename_folder,
    restore_file,
    restore_folder,
    serialize_file,
    serialize_folder,
    set_favorite_file,
    set_favorite_folder,
    touch_accessed,
    trash_file,
    trash_folder,
    upload_file,
)
from .files_models import CabinetFileAuditAction
from .files_storage import content_disposition, open_file
from .models import HomeworkSubmission, Student
from .permissions import IsCabinetStudent, IsCabinetTeacher
from .upload_validation import is_previewable


def _error_response(exc: FileServiceError) -> Response:
    payload = {"detail": exc.message, "code": exc.code}
    if exc.extra:
        payload.update(exc.extra)
    return Response(payload, status=exc.status)


class TeacherFilesMixin:
    permission_classes = [IsCabinetTeacher]

    def get_user(self):
        return self.request.user


class StudentFilesMixin:
    permission_classes = [IsCabinetStudent]

    def get_user(self):
        return self.request.user


class FilesListView(TeacherFilesMixin, APIView):
    def get(self, request):
        try:
            data = list_directory(
                request.user,
                section=request.query_params.get("section") or "my",
                folder_id=request.query_params.get("folder_id") or None,
                search=request.query_params.get("search") or "",
                sort=request.query_params.get("sort") or "name",
                kind=request.query_params.get("kind") or "",
                student_id=request.query_params.get("student_id") or None,
                group_id=request.query_params.get("group_id") or None,
                lesson_id=request.query_params.get("lesson_id") or None,
                homework_id=request.query_params.get("homework_id") or None,
                page=request.query_params.get("page") or 1,
                page_size=request.query_params.get("page_size") or 50,
            )
        except FileServiceError as exc:
            return _error_response(exc)
        return Response(data)


class FilesQuotaView(TeacherFilesMixin, APIView):
    def get(self, request):
        return Response(get_quota_info(request.user))


class FilesFolderCreateView(TeacherFilesMixin, APIView):
    def post(self, request):
        try:
            folder = create_folder(
                request.user,
                request.data.get("name") or "",
                parent_id=request.data.get("parent_id") or request.data.get("folder_id"),
            )
        except FileServiceError as exc:
            return _error_response(exc)
        return Response(serialize_folder(folder), status=status.HTTP_201_CREATED)


class FilesUploadView(TeacherFilesMixin, APIView):
    def post(self, request):
        uploaded = request.FILES.get("file")
        try:
            file_obj = upload_file(
                request.user,
                uploaded,
                folder_id=request.data.get("folder_id") or None,
                display_name=request.data.get("display_name") or request.data.get("name"),
            )
        except FileServiceError as exc:
            return _error_response(exc)
        return Response(serialize_file(file_obj, include_relations=True), status=status.HTTP_201_CREATED)


class FilesDetailView(TeacherFilesMixin, APIView):
    def get(self, request, file_id):
        try:
            file_obj = get_owned_file(request.user, file_id, allow_trashed=True)
        except FileServiceError as exc:
            return _error_response(exc)
        touch_accessed(file_obj)
        return Response(serialize_file(file_obj, include_relations=True))

    def patch(self, request, file_id):
        try:
            file_obj = get_owned_file(request.user, file_id)
            data = request.data
            if "display_name" in data or "name" in data:
                file_obj = rename_file(request.user, file_id, data.get("display_name") or data.get("name"))
            if "is_favorite" in data:
                file_obj = set_favorite_file(request.user, file_id, data.get("is_favorite"))
            if "folder_id" in data:
                folder_id = data.get("folder_id")
                file_obj = move_file(request.user, file_id, None if folder_id in ("", None) else folder_id)
        except FileServiceError as exc:
            return _error_response(exc)
        return Response(serialize_file(file_obj, include_relations=True))

    def delete(self, request, file_id):
        force = str(request.query_params.get("force") or request.data.get("force") or "").lower() in (
            "1",
            "true",
            "yes",
        )
        try:
            result = purge_file(request.user, file_id, force=force)
        except FileServiceError as exc:
            return _error_response(exc)
        return Response(result)


class FilesDownloadView(TeacherFilesMixin, APIView):
    def get(self, request, file_id):
        try:
            file_obj = get_readable_file(request.user, file_id)
            fh = open_file(file_obj.storage_key, "rb")
        except FileServiceError as exc:
            return _error_response(exc)
        except Exception as exc:
            raise Http404("Файл недоступен") from exc
        touch_accessed(file_obj)
        log_action(request.user, CabinetFileAuditAction.DOWNLOAD, file=file_obj)
        content_type = file_obj.mime_type or mimetypes.guess_type(file_obj.original_name)[0] or "application/octet-stream"
        response = FileResponse(fh, content_type=content_type)
        response["Content-Disposition"] = content_disposition(download_filename(file_obj), inline=False)
        return response


class FilesPreviewView(TeacherFilesMixin, APIView):
    def get(self, request, file_id):
        try:
            file_obj = get_readable_file(request.user, file_id)
            if not is_previewable(file_obj.extension, file_obj.mime_type):
                raise FileServiceError(
                    "Предпросмотр для этого формата недоступен. Скачайте файл.",
                    code="PREVIEW_UNAVAILABLE",
                    status=400,
                )
            fh = open_file(file_obj.storage_key, "rb")
        except FileServiceError as exc:
            return _error_response(exc)
        except Exception as exc:
            raise Http404("Файл недоступен") from exc
        touch_accessed(file_obj)
        content_type = file_obj.mime_type or mimetypes.guess_type(file_obj.original_name)[0] or "application/octet-stream"
        response = FileResponse(fh, content_type=content_type)
        response["Content-Disposition"] = content_disposition(download_filename(file_obj), inline=True)
        return response


class FilesTrashView(TeacherFilesMixin, APIView):
    def post(self, request, file_id):
        try:
            file_obj = trash_file(request.user, file_id)
        except FileServiceError as exc:
            return _error_response(exc)
        return Response(serialize_file(file_obj))


class FilesRestoreView(TeacherFilesMixin, APIView):
    def post(self, request, file_id):
        try:
            file_obj = restore_file(
                request.user,
                file_id,
                target_folder_id=request.data.get("folder_id"),
            )
        except FileServiceError as exc:
            return _error_response(exc)
        return Response(serialize_file(file_obj))


class FilesCopyView(TeacherFilesMixin, APIView):
    def post(self, request, file_id):
        try:
            file_obj = copy_file(request.user, file_id, target_folder_id=request.data.get("folder_id"))
        except FileServiceError as exc:
            return _error_response(exc)
        return Response(serialize_file(file_obj), status=status.HTTP_201_CREATED)


class FilesAttachView(TeacherFilesMixin, APIView):
    def post(self, request, file_id):
        try:
            result = attach_file(
                request.user,
                file_id,
                request.data.get("target_type") or "",
                request.data.get("target_id"),
            )
        except FileServiceError as exc:
            return _error_response(exc)
        return Response(result, status=status.HTTP_201_CREATED)


class FilesAssignView(TeacherFilesMixin, APIView):
    """Выдать файл ученику или группе как материал либо ДЗ."""

    def post(self, request, file_id):
        try:
            result = assign_file_to_recipients(
                request.user,
                file_id,
                mode=request.data.get("mode") or "",
                student_id=request.data.get("student_id"),
                group_id=request.data.get("group_id"),
                message=request.data.get("message") or "",
                title=request.data.get("title") or "",
                due_at=request.data.get("due_at"),
            )
        except FileServiceError as exc:
            return _error_response(exc)
        return Response(result, status=status.HTTP_201_CREATED)


class FilesMoveBatchView(TeacherFilesMixin, APIView):
    def post(self, request):
        ids = request.data.get("ids") or []
        folder_ids = request.data.get("folder_ids") or []
        target = request.data.get("folder_id")
        if target in ("",):
            target = None
        moved = []
        try:
            for file_id in ids:
                moved.append(serialize_file(move_file(request.user, file_id, target)))
            for folder_id in folder_ids:
                moved.append(serialize_folder(move_folder(request.user, folder_id, target)))
        except FileServiceError as exc:
            return _error_response(exc)
        return Response({"items": moved})


class FilesEmptyTrashView(TeacherFilesMixin, APIView):
    def post(self, request):
        try:
            result = empty_trash(request.user)
        except FileServiceError as exc:
            return _error_response(exc)
        return Response(result)


class FolderDetailView(TeacherFilesMixin, APIView):
    def patch(self, request, folder_id):
        try:
            folder = get_owned_folder(request.user, folder_id)
            data = request.data
            if "name" in data:
                folder = rename_folder(request.user, folder_id, data.get("name"))
            if "is_favorite" in data:
                folder = set_favorite_folder(request.user, folder_id, data.get("is_favorite"))
            if "parent_id" in data:
                parent_id = data.get("parent_id")
                folder = move_folder(request.user, folder_id, None if parent_id in ("", None) else parent_id)
        except FileServiceError as exc:
            return _error_response(exc)
        return Response(serialize_folder(folder))

    def delete(self, request, folder_id):
        try:
            folder = trash_folder(request.user, folder_id)
        except FileServiceError as exc:
            return _error_response(exc)
        return Response(serialize_folder(folder))


class FolderRestoreView(TeacherFilesMixin, APIView):
    def post(self, request, folder_id):
        try:
            folder = restore_folder(
                request.user,
                folder_id,
                target_folder_id=request.data.get("parent_id") or request.data.get("folder_id"),
            )
        except FileServiceError as exc:
            return _error_response(exc)
        return Response(serialize_folder(folder))


class FileRelationDeleteView(TeacherFilesMixin, APIView):
    def delete(self, request, relation_id):
        try:
            result = detach_relation(request.user, relation_id)
        except FileServiceError as exc:
            return _error_response(exc)
        return Response(result)


# ── Student endpoints ─────────────────────────────────────────────────────────


class StudentFilesListView(StudentFilesMixin, APIView):
    def get(self, request):
        try:
            data = list_directory(
                request.user,
                section=request.query_params.get("section") or "my",
                folder_id=request.query_params.get("folder_id") or None,
                search=request.query_params.get("search") or "",
                sort=request.query_params.get("sort") or "name",
                kind=request.query_params.get("kind") or "",
                page=request.query_params.get("page") or 1,
                page_size=request.query_params.get("page_size") or 50,
            )
            # Подменяем URL превью/скачивания на student paths
            for item in data.get("items") or []:
                if item.get("kind") == "file":
                    item["download_url"] = f"/api/cabinet/student/files/{item['id']}/download/"
                    item["preview_url"] = f"/api/cabinet/student/files/{item['id']}/preview/"
        except FileServiceError as exc:
            return _error_response(exc)
        return Response(data)


class StudentFilesQuotaView(StudentFilesMixin, APIView):
    def get(self, request):
        return Response(get_quota_info(request.user))


class StudentFilesFolderCreateView(StudentFilesMixin, APIView):
    def post(self, request):
        try:
            folder = create_folder(
                request.user,
                request.data.get("name") or "",
                parent_id=request.data.get("parent_id") or request.data.get("folder_id"),
            )
        except FileServiceError as exc:
            return _error_response(exc)
        return Response(serialize_folder(folder), status=status.HTTP_201_CREATED)


class StudentFilesUploadView(StudentFilesMixin, APIView):
    def post(self, request):
        uploaded = request.FILES.get("file")
        try:
            file_obj = upload_file(
                request.user,
                uploaded,
                folder_id=request.data.get("folder_id") or None,
                display_name=request.data.get("display_name") or request.data.get("name"),
            )
            # Опциональная привязка к сдаче ДЗ
            submission_id = request.data.get("submission_id") or request.data.get("homework_id")
            if submission_id and request.data.get("attach_submission"):
                students = Student.objects.filter(user=request.user)
                submission = HomeworkSubmission.objects.filter(
                    pk=submission_id,
                    student__in=students,
                ).first()
                if submission:
                    attach_file_for_student(request.user, file_obj.id, submission)
        except FileServiceError as exc:
            return _error_response(exc)
        payload = serialize_file(file_obj, include_relations=True)
        payload["download_url"] = f"/api/cabinet/student/files/{file_obj.id}/download/"
        payload["preview_url"] = f"/api/cabinet/student/files/{file_obj.id}/preview/"
        return Response(payload, status=status.HTTP_201_CREATED)


class StudentFilesDetailView(StudentFilesMixin, APIView):
    def get(self, request, file_id):
        try:
            file_obj = get_owned_file(request.user, file_id, allow_trashed=True)
        except FileServiceError as exc:
            return _error_response(exc)
        touch_accessed(file_obj)
        payload = serialize_file(file_obj, include_relations=True)
        payload["download_url"] = f"/api/cabinet/student/files/{file_obj.id}/download/"
        payload["preview_url"] = f"/api/cabinet/student/files/{file_obj.id}/preview/"
        return Response(payload)

    def patch(self, request, file_id):
        try:
            data = request.data
            file_obj = get_owned_file(request.user, file_id)
            if "display_name" in data or "name" in data:
                file_obj = rename_file(request.user, file_id, data.get("display_name") or data.get("name"))
            if "is_favorite" in data:
                file_obj = set_favorite_file(request.user, file_id, data.get("is_favorite"))
            if "folder_id" in data:
                folder_id = data.get("folder_id")
                file_obj = move_file(request.user, file_id, None if folder_id in ("", None) else folder_id)
        except FileServiceError as exc:
            return _error_response(exc)
        return Response(serialize_file(file_obj, include_relations=True))

    def delete(self, request, file_id):
        force = str(request.query_params.get("force") or "").lower() in ("1", "true", "yes")
        try:
            result = purge_file(request.user, file_id, force=force)
        except FileServiceError as exc:
            return _error_response(exc)
        return Response(result)


def _student_file_response(request, file_id, *, inline: bool):
    try:
        file_obj = get_owned_file(request.user, file_id)
        if inline and not is_previewable(file_obj.extension, file_obj.mime_type):
            raise FileServiceError(
                "Предпросмотр для этого формата недоступен. Скачайте файл.",
                code="PREVIEW_UNAVAILABLE",
                status=400,
            )
        fh = open_file(file_obj.storage_key, "rb")
    except FileServiceError as exc:
        return _error_response(exc)
    except Exception as exc:
        raise Http404("Файл недоступен") from exc
    touch_accessed(file_obj)
    if not inline:
        log_action(request.user, CabinetFileAuditAction.DOWNLOAD, file=file_obj)
    content_type = file_obj.mime_type or mimetypes.guess_type(file_obj.original_name)[0] or "application/octet-stream"
    response = FileResponse(fh, content_type=content_type)
    response["Content-Disposition"] = content_disposition(download_filename(file_obj), inline=inline)
    return response


class StudentFilesDownloadView(StudentFilesMixin, APIView):
    def get(self, request, file_id):
        return _student_file_response(request, file_id, inline=False)


class StudentFilesPreviewView(StudentFilesMixin, APIView):
    def get(self, request, file_id):
        return _student_file_response(request, file_id, inline=True)


class StudentFilesTrashView(StudentFilesMixin, APIView):
    def post(self, request, file_id):
        try:
            file_obj = trash_file(request.user, file_id)
        except FileServiceError as exc:
            return _error_response(exc)
        return Response(serialize_file(file_obj))


class StudentFilesRestoreView(StudentFilesMixin, APIView):
    def post(self, request, file_id):
        try:
            file_obj = restore_file(request.user, file_id, target_folder_id=request.data.get("folder_id"))
        except FileServiceError as exc:
            return _error_response(exc)
        return Response(serialize_file(file_obj))


class StudentFolderDetailView(StudentFilesMixin, APIView):
    def patch(self, request, folder_id):
        try:
            data = request.data
            folder = get_owned_folder(request.user, folder_id)
            if "name" in data:
                folder = rename_folder(request.user, folder_id, data.get("name"))
            if "is_favorite" in data:
                folder = set_favorite_folder(request.user, folder_id, data.get("is_favorite"))
            if "parent_id" in data:
                parent_id = data.get("parent_id")
                folder = move_folder(request.user, folder_id, None if parent_id in ("", None) else parent_id)
        except FileServiceError as exc:
            return _error_response(exc)
        return Response(serialize_folder(folder))

    def delete(self, request, folder_id):
        try:
            folder = trash_folder(request.user, folder_id)
        except FileServiceError as exc:
            return _error_response(exc)
        return Response(serialize_folder(folder))


class StudentSharedFileDownloadView(StudentFilesMixin, APIView):
    """Скачивание файла учителя, доступного ученику через материалы/связи."""

    def get(self, request, file_id):
        try:
            file_obj = get_readable_file(request.user, file_id)
            fh = open_file(file_obj.storage_key, "rb")
        except FileServiceError as exc:
            return _error_response(exc)
        except Exception as exc:
            raise Http404("Файл недоступен") from exc
        touch_accessed(file_obj)
        log_action(request.user, CabinetFileAuditAction.DOWNLOAD, file=file_obj)
        content_type = file_obj.mime_type or mimetypes.guess_type(file_obj.original_name)[0] or "application/octet-stream"
        response = FileResponse(fh, content_type=content_type)
        response["Content-Disposition"] = content_disposition(download_filename(file_obj), inline=False)
        return response


class StudentSharedFilePreviewView(StudentFilesMixin, APIView):
    def get(self, request, file_id):
        try:
            file_obj = get_readable_file(request.user, file_id)
            if not is_previewable(file_obj.extension, file_obj.mime_type):
                raise FileServiceError(
                    "Предпросмотр для этого формата недоступен. Скачайте файл.",
                    code="PREVIEW_UNAVAILABLE",
                    status=400,
                )
            fh = open_file(file_obj.storage_key, "rb")
        except FileServiceError as exc:
            return _error_response(exc)
        except Exception as exc:
            raise Http404("Файл недоступен") from exc
        touch_accessed(file_obj)
        content_type = file_obj.mime_type or mimetypes.guess_type(file_obj.original_name)[0] or "application/octet-stream"
        response = FileResponse(fh, content_type=content_type)
        response["Content-Disposition"] = content_disposition(download_filename(file_obj), inline=True)
        return response
