"""API личного банка задач учителя."""

from __future__ import annotations

import logging
import os
import re
from uuid import uuid4
from django.conf import settings
from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
from django.db import transaction
from django.http import FileResponse
from django.utils.text import get_valid_filename
from django.db.models import Count, Prefetch
from django.utils import timezone
from rest_framework import status
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from Generator.latex_utils import process_latex
from Generator.models import (
    Level,
    Subject,
    SubTopic,
    TagOption,
    Task,
    TaskAttachment,
    TaskList,
    VariantContent,
    username_for_created_by,
)
from Generator.teacher_task_bank import (
    allocate_task_number,
    apply_teacher_search,
    format_task_public_code,
    get_or_create_teacher_bank,
    get_owned_task_or_none,
    homework_usage_count,
    preview_plain,
    task_usage_counts,
    teacher_own_tasks_qs,
    variant_usage_count,
)

from .activation_events import (
    TEACHER_TASK_ARCHIVED,
    TEACHER_TASK_ATTACHMENT_PAYWALL,
    TEACHER_TASK_COPIED_FROM_GLOBAL,
    TEACHER_TASK_COPY_LIMIT_REACHED,
    TEACHER_TASK_CREATED,
    TEACHER_TASK_DUPLICATED,
    TEACHER_TASK_EDITED,
    TEACHER_TASK_LIMIT_REACHED,
    record_event,
)
from .permissions import IsCabinetTeacher
from .subscription_access import AccessDenied
from .teacher_task_entitlements import (
    enforce_teacher_task_attachments,
    enforce_teacher_task_storage,
    lock_and_enforce_copy,
    lock_and_enforce_create,
    snapshot as teacher_task_bank_snapshot,
)
from .upload_validation import UploadValidationError, validate_uploaded_file, validate_uploaded_image

_IMAGE_MAX_BYTES = 5 * 1024 * 1024


def _entitlement_response(exc):
    if isinstance(exc, AccessDenied):
        return Response(exc.to_dict(), status=status.HTTP_403_FORBIDDEN)
    from .files_services import FileServiceError

    if isinstance(exc, FileServiceError):
        payload = {"detail": exc.message, "code": exc.code, "error": exc.message}
        payload.update(exc.extra or {})
        if exc.code == "QUOTA_EXCEEDED":
            payload["upgrade_required"] = True
            payload["feature"] = "storage"
        return Response(payload, status=exc.status or status.HTTP_400_BAD_REQUEST)
    raise exc


def _record_limit_event(request, event_name, extra=""):
    try:
        record_event(
            event_name,
            request.user,
            kind="confirmed",
            object_type="task_bank",
            source="teacher_task_bank",
            request=request,
            extra_idempotency=extra or event_name,
        )
    except Exception:
        logger.exception("teacher task limit analytics failed event=%s", event_name)

def _normalize_level_slug(value):
    if value is None:
        return None
    s = str(value).strip().lower()
    cyr = {
        "впр": "vpr",
        "огэ": "oge",
        "егэ": "ege",
        "ёгэ": "ege",
        "школа": "school",
        "школьная программа": "school",
        "школьная база": "school",
    }
    return cyr.get(s, s)


def _level_instance_for_catalog(level_raw):
    canonical = _normalize_level_slug(level_raw)
    if not canonical:
        return None
    exact = Level.objects.filter(level__iexact=canonical).first()
    if exact is not None:
        return exact
    for lev in Level.objects.all():
        if _normalize_level_slug(lev.level) == canonical:
            return lev
    return Level.objects.filter(level__iexact=str(level_raw or "").strip()).first()


logger = logging.getLogger("cabinet.teacher_tasks")


def exam_part_from_part(part):
    """Часть 1/2 только из названия Part в базе, без таблицы номеров заданий."""
    if part is None:
        return None
    title = (getattr(part, "part_title", None) or "").strip().lower()
    if re.search(r"часть\s*2|part\s*2|\bii\b", title) or title in ("2", "вторая"):
        return 2
    if re.search(r"часть\s*1|part\s*1", title) or title in ("1", "первая"):
        return 1
    return None


def _parse_exam_part(value):
    if value in (None, "", False, "none", "null"):
        return None
    try:
        n = int(value)
    except (TypeError, ValueError):
        return None
    return n if n in (1, 2) else None

_TEXT_MAX = 200_000
_ANSWER_MAX = 50_000
_AUTHOR_MAX = 500
_PER_PAGE_MAX = 100
_DEFAULT_PER_PAGE = 20


class TeacherTaskApiMixin:
    permission_classes = [IsCabinetTeacher]

    def teacher(self):
        return self.request.user

    def bank(self):
        return get_or_create_teacher_bank(self.teacher())

    def owned_qs(self):
        return (
            teacher_own_tasks_qs(self.teacher())
            .select_related(
                "task",
                "task__subject",
                "task__level",
                "task__part",
                "subtopic",
                "source_task",
            )
            .prefetch_related(
                "attachments",
                Prefetch(
                    "tag_options",
                    queryset=TagOption.objects.filter(is_active=True).select_related("tag_type"),
                )
            )
        )

    def get_owned_or_404(self, task_id):
        task = get_owned_task_or_none(self.teacher(), task_id)
        if task is None:
            return None, Response({"detail": "Задача не найдена."}, status=status.HTTP_404_NOT_FOUND)
        return task, None


def _serialize_tag(opt: TagOption) -> dict:
    name = (opt.title or "").strip()
    if opt.emoji:
        name = f"{opt.emoji} {name}".strip()
    return {
        "id": opt.id,
        "name": name,
        "title": opt.title,
        "emoji": opt.emoji or "",
        "badge_style": opt.badge_style,
        "type": getattr(opt.tag_type, "slug", None),
    }


def _file_url(request, task):
    if not getattr(task, "files", None):
        return None
    f = task.files
    try:
        url = f.url
        if url:
            return request.build_absolute_uri(url)
    except Exception:
        pass
    return None


def _owned_attachment_url(request, task: Task, *, attachment_id=None, legacy=False) -> str:
    if legacy:
        path = f"/api/cabinet/my-tasks/{task.id}/attachments/legacy/"
    else:
        path = f"/api/cabinet/my-tasks/{task.id}/attachments/{attachment_id}/"
    return request.build_absolute_uri(path) if request else path


def _serialize_attachment(request, task: Task, att: TaskAttachment) -> dict:
    name = att.original_name or (att.file.name.rsplit("/", 1)[-1] if att.file else "")
    return {
        "id": att.id,
        "name": name,
        "size": att.size or 0,
        "url": _owned_attachment_url(request, task, attachment_id=att.id),
    }


def _task_attachments_payload(request, task: Task) -> list:
    items = []
    if getattr(task, "files", None) and task.files:
        name = task.files.name.rsplit("/", 1)[-1] if task.files else "file"
        size = 0
        try:
            size = int(task.files.size or 0)
        except Exception:
            size = 0
        items.append({
            "id": None,
            "name": name,
            "size": size,
            "url": _owned_attachment_url(request, task, legacy=True),
            "legacy": True,
        })
    for att in task.attachments.all():
        items.append(_serialize_attachment(request, task, att))
    return items


def _safe_upload_name(name: str) -> str:
    base = get_valid_filename(os.path.basename(name or "file")) or "file"
    return base[:255]


def _absolute_media_url(request, stored_name: str) -> str:
    url = default_storage.url(stored_name) or ""
    if str(url).startswith(("http://", "https://")):
        try:
            from urllib.parse import urlparse
            parsed = urlparse(url)
            if parsed.path:
                return parsed.path
        except Exception:
            pass
    if str(url).startswith("/"):
        return url
    media = getattr(settings, "MEDIA_URL", "/media/") or "/media/"
    return f"{media}{str(url).lstrip('/')}"


def _store_teacher_upload(teacher, uploaded, *, folder: str) -> str:
    ext = os.path.splitext(uploaded.name or "")[1].lower() or ".bin"
    rel = f"{folder}/teacher_{teacher.pk}/{uuid4().hex}{ext}"
    if hasattr(uploaded, "seek"):
        try:
            uploaded.seek(0)
        except Exception:
            pass
    return default_storage.save(rel, uploaded)


def serialize_teacher_task(
    request,
    task: Task,
    *,
    bank_code: str,
    usage: int | None = None,
    include_body: bool = False,
    include_answer: bool = False,
) -> dict:
    tl = task.task
    subject = tl.subject if tl else None
    level = tl.level if tl else None
    part = tl.part if tl else None
    st = task.subtopic
    public_code = format_task_public_code(bank_code, task.local_number)
    keep_tables = bool(tl and tl.part_id == 2)
    raw_text = str(task.task_template or "")
    payload = {
        "id": task.id,
        "scope": task.scope,
        "status": task.status,
        "local_number": task.local_number,
        "bank_code": bank_code,
        "public_code": public_code,
        "task_list_id": task.task_id,
        "exam_task_number": tl.task_number if tl else None,
        "task_title": tl.task_title if tl else "",
        "subject": subject.subject_short if subject else None,
        "subject_name": subject.subject_name if subject else None,
        "level": level.level if level else None,
        "level_title": (getattr(level, "level_rus", None) or (level.level if level else None)),
        "part_id": tl.part_id if tl else None,
        "part_title": part.part_title if part else None,
        "exam_part": task.exam_part,
        "attachments": _task_attachments_payload(request, task),
        "subtopic": st.title if st else None,
        "subtopic_id": task.subtopic_id,
        "max_score": task.max_score if task.max_score is not None else (tl.max_score if tl else 1),
        "text_preview": preview_plain(raw_text),
        "tags": [_serialize_tag(opt) for opt in task.tag_options.all() if getattr(opt, "is_active", True)],
        "author": (task.author or "").strip() or None,
        "file_url": _file_url(request, task),
        "vpr_class": task.vpr_class,
        "vpr_advanced": bool(task.vpr_advanced),
        "vpr_basic": bool(task.vpr_basic),
        "truth_table_enabled": bool(task.truth_table_enabled),
        "used_in_variants": usage if usage is not None else 0,
        "source_task_id": task.source_task_id,
        "is_active": bool(task.is_active),
        "added_at": task.added_at.isoformat() if task.added_at else None,
        "updated_at": task.updated_at.isoformat() if getattr(task, "updated_at", None) else None,
    }
    if include_body:
        payload["text"] = process_latex(raw_text, for_browser=True, keep_layout_tables=keep_tables)
        payload["text_raw"] = raw_text
    if include_answer:
        payload["answer"] = str(task.answer or "")
        payload["answer_html"] = process_latex(str(task.answer or ""), for_browser=True)
    return payload


def _teacher_author_name(teacher) -> str:
    profile = getattr(teacher, "profile", None)
    if profile is not None:
        name = (profile.get_display_name() or "").strip()
        if name:
            return name[:_AUTHOR_MAX]
    username = getattr(teacher, "get_username", lambda: "")() or getattr(teacher, "username", "")
    return (str(username) or "Учитель")[:_AUTHOR_MAX]


def _parse_int(value):
    if value in (None, "", False):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _apply_status_to_task(task: Task, status_value: str | None):
    if not status_value:
        return
    allowed = {choice for choice, _label in Task.Status.choices}
    if status_value not in allowed:
        raise ValueError("Некорректный статус")
    task.status = status_value
    task.sync_active_from_status()


def _copy_task_file(source: Task, dest: Task):
    if not getattr(source, "files", None) or not source.files:
        return
    try:
        source.files.open("rb")
        content = source.files.read()
        name = source.files.name.rsplit("/", 1)[-1]
        dest.files.save(name, ContentFile(content), save=False)
    except Exception:
        logger.exception("copy task file failed source=%s", source.pk)
    finally:
        try:
            source.files.close()
        except Exception:
            pass


def _clone_teacher_task(*, teacher, source: Task, bank, created_by: str) -> Task:
    local_number, bank = allocate_task_number(teacher)
    clone = Task(
        task=source.task,
        quick_level_id=source.quick_level_id or (source.task.level_id if source.task_id else None),
        subtopic=source.subtopic,
        task_template=source.task_template,
        answer=source.answer,
        author=source.author,
        max_score=source.max_score,
        created_by=created_by,
        is_active=source.status == Task.Status.READY or source.scope == Task.Scope.GLOBAL,
        vpr_class=source.vpr_class,
        vpr_advanced=source.vpr_advanced,
        vpr_basic=source.vpr_basic,
        truth_table_enabled=source.truth_table_enabled,
        exam_part=source.exam_part or exam_part_from_part(getattr(source.task, "part", None) if source.task_id else None),
        scope=Task.Scope.TEACHER,
        owner_teacher=teacher,
        local_number=local_number,
        source_task=source,
        status=Task.Status.READY if source.scope == Task.Scope.GLOBAL else source.status,
        added_at=timezone.now(),
    )
    if source.scope == Task.Scope.GLOBAL:
        clone.author = _teacher_author_name(teacher)
    if clone.status != Task.Status.READY:
        clone.is_active = False
    else:
        clone.is_active = True
    can_attach = True
    try:
        enforce_teacher_task_attachments(teacher)
    except AccessDenied:
        can_attach = False
    if can_attach:
        _copy_task_file(source, clone)
    clone.save()
    if can_attach:
        for att in source.attachments.all():
            try:
                att.file.open("rb")
                content = att.file.read()
                name = att.original_name or att.file.name.rsplit("/", 1)[-1]
                copy = TaskAttachment(
                    task=clone,
                    original_name=_safe_upload_name(name),
                    size=att.size or len(content),
                )
                ext = os.path.splitext(name)[1].lower() or ".bin"
                copy.file.save(f"{uuid4().hex}{ext}", ContentFile(content), save=True)
            except Exception:
                logger.exception("copy task attachment failed source=%s att=%s", source.pk, att.pk)
            finally:
                try:
                    att.file.close()
                except Exception:
                    pass
    tag_ids = list(source.tag_options.values_list("id", flat=True))
    if tag_ids:
        clone.tag_options.set(tag_ids)
    return clone


def _record(request, event_name, task, extra=""):
    try:
        record_event(
            event_name,
            request.user,
            kind="confirmed",
            object_type="task",
            object_id=task.id,
            source="teacher_task_bank",
            request=request,
            extra_idempotency=extra or str(task.id),
        )
    except Exception:
        logger.exception("teacher task analytics failed event=%s task=%s", event_name, getattr(task, "pk", None))


class TeacherTaskBankMetaView(TeacherTaskApiMixin, APIView):
    def get(self, request):
        bank = self.bank()
        qs = teacher_own_tasks_qs(self.teacher())
        counts = {
            "all": qs.exclude(status=Task.Status.ARCHIVED).count(),
            "ready": qs.filter(status=Task.Status.READY).count(),
            "draft": qs.filter(status=Task.Status.DRAFT).count(),
            "archived": qs.filter(status=Task.Status.ARCHIVED).count(),
        }
        used_ids = set(
            VariantContent.objects.filter(
                task__scope=Task.Scope.TEACHER,
                task__owner_teacher=self.teacher(),
            ).values_list("task_id", flat=True)
        )
        subjects = []
        rows = (
            qs.exclude(status=Task.Status.ARCHIVED)
            .filter(task__subject__isnull=False)
            .values("task__subject__subject_short", "task__subject__subject_name")
            .annotate(c=Count("id"))
            .order_by("task__subject__subject_name")
        )
        for row in rows:
            subjects.append(
                {
                    "id": row["task__subject__subject_short"],
                    "name": row["task__subject__subject_name"],
                    "count": row["c"],
                }
            )
        return Response(
            {
                "bank_code": bank.public_code,
                "counts": counts,
                "used_in_variants": len(used_ids),
                "subjects": subjects,
                **teacher_task_bank_snapshot(self.teacher()),
            }
        )


class TeacherTaskListView(TeacherTaskApiMixin, APIView):
    parser_classes = [JSONParser, MultiPartParser, FormParser]

    def get(self, request):
        bank = self.bank()
        qs = self.owned_qs()
        status_filter = (request.query_params.get("status") or "").strip().lower()
        if status_filter in ("ready", "draft", "archived"):
            qs = qs.filter(status=status_filter)
        elif status_filter in ("", "all", "active"):
            qs = qs.exclude(status=Task.Status.ARCHIVED)

        subject = (request.query_params.get("subject") or "").strip()
        if subject:
            qs = qs.filter(task__subject__subject_short__iexact=subject)

        level = (request.query_params.get("level") or "").strip()
        exam = (request.query_params.get("exam") or "").strip().lower()
        if exam == "ege":
            qs = qs.filter(task__level__level__iexact="ege")
        elif exam == "oge":
            qs = qs.filter(task__level__level__iexact="oge")
        elif exam in ("none", "no-exam", "without"):
            qs = qs.exclude(task__level__level__iexact="ege").exclude(task__level__level__iexact="oge")
        elif level:
            qs = qs.filter(task__level__level__iexact=level)

        task_list_id = _parse_int(request.query_params.get("task_list_id") or request.query_params.get("task"))
        if task_list_id:
            qs = qs.filter(task_id=task_list_id)

        subtopic_id = request.query_params.get("subtopic_id") or request.query_params.get("subtopic")
        if subtopic_id:
            if str(subtopic_id).strip().lower() == "none":
                qs = qs.filter(subtopic_id__isnull=True)
            else:
                sid = _parse_int(subtopic_id)
                if sid:
                    qs = qs.filter(subtopic_id=sid)

        tag_id = _parse_int(request.query_params.get("tag_id") or request.query_params.get("difficulty"))
        if tag_id:
            qs = qs.filter(tag_options__id=tag_id)

        exam_part = _parse_exam_part(request.query_params.get("exam_part"))
        if exam_part:
            qs = qs.filter(exam_part=exam_part)

        qs = apply_teacher_search(qs, request.query_params.get("q") or "", bank)

        try:
            page = max(1, int(request.query_params.get("page", 1)))
            per_page = min(_PER_PAGE_MAX, max(1, int(request.query_params.get("per_page", _DEFAULT_PER_PAGE))))
        except (TypeError, ValueError):
            page, per_page = 1, _DEFAULT_PER_PAGE

        total = qs.count()
        offset = (page - 1) * per_page
        items = list(qs.order_by("-local_number", "-id")[offset:offset + per_page])
        usage = task_usage_counts([t.id for t in items])

        counts_qs = teacher_own_tasks_qs(self.teacher())
        counts = {
            "all": counts_qs.exclude(status=Task.Status.ARCHIVED).count(),
            "ready": counts_qs.filter(status=Task.Status.READY).count(),
            "draft": counts_qs.filter(status=Task.Status.DRAFT).count(),
            "archived": counts_qs.filter(status=Task.Status.ARCHIVED).count(),
        }
        used_in_variants = (
            VariantContent.objects.filter(
                task__scope=Task.Scope.TEACHER,
                task__owner_teacher=self.teacher(),
            )
            .values("task_id")
            .distinct()
            .count()
        )
        subjects = []
        for row in (
            teacher_own_tasks_qs(self.teacher())
            .exclude(status=Task.Status.ARCHIVED)
            .filter(task__subject__isnull=False)
            .values("task__subject__subject_short", "task__subject__subject_name")
            .annotate(c=Count("id"))
            .order_by("task__subject__subject_name")
        ):
            subjects.append(
                {
                    "id": row["task__subject__subject_short"],
                    "name": row["task__subject__subject_name"],
                    "count": row["c"],
                }
            )

        return Response(
            {
                "bank_code": bank.public_code,
                "counts": counts,
                "used_in_variants": used_in_variants,
                "subjects": subjects,
                "total": total,
                "page": page,
                "per_page": per_page,
                "tasks": [
                    serialize_teacher_task(
                        request,
                        task,
                        bank_code=bank.public_code,
                        usage=usage.get(task.id, 0),
                        include_body=True,
                        include_answer=True,
                    )
                    for task in items
                ],
                **teacher_task_bank_snapshot(self.teacher()),
            }
        )

    def post(self, request):
        data = request.data if isinstance(request.data, dict) else {}
        if "owner_teacher" in data or "owner_teacher_id" in data or "scope" in data or "local_number" in data:
            return Response({"detail": "Поля владельца задаёт сервер."}, status=status.HTTP_400_BAD_REQUEST)

        task_list_id = _parse_int(data.get("task_list_id"))
        if not task_list_id:
            return Response({"detail": "Выберите предмет, уровень и номер задания."}, status=status.HTTP_400_BAD_REQUEST)
        tl = TaskList.objects.filter(pk=task_list_id).select_related("subject", "level", "part").first()
        if tl is None:
            return Response({"detail": "Номер задания не найден."}, status=status.HTTP_400_BAD_REQUEST)

        text = data.get("task_template") or data.get("text") or ""
        if not str(text).strip():
            return Response({"detail": "Введите текст задания."}, status=status.HTTP_400_BAD_REQUEST)
        if len(str(text)) > _TEXT_MAX:
            return Response({"detail": "Текст задания слишком длинный."}, status=status.HTTP_400_BAD_REQUEST)

        answer = data.get("answer") or ""
        if len(str(answer)) > _ANSWER_MAX:
            return Response({"detail": "Ответ слишком длинный."}, status=status.HTTP_400_BAD_REQUEST)

        teacher = self.teacher()
        if "exam_part" in data:
            exam_part = _parse_exam_part(data.get("exam_part"))
        else:
            exam_part = exam_part_from_part(tl.part)
        upload = request.FILES.get("files") or request.FILES.get("file")
        if upload:
            try:
                enforce_teacher_task_attachments(teacher)
                enforce_teacher_task_storage(teacher, int(getattr(upload, "size", 0) or 0))
            except (AccessDenied, Exception) as exc:
                from .files_services import FileServiceError

                if isinstance(exc, AccessDenied):
                    _record_limit_event(request, TEACHER_TASK_ATTACHMENT_PAYWALL, extra=str(teacher.pk))
                    return _entitlement_response(exc)
                if isinstance(exc, FileServiceError):
                    return _entitlement_response(exc)
                raise
        try:
            with transaction.atomic():
                lock_and_enforce_create(teacher)
                local_number, bank = allocate_task_number(teacher)
                task = Task(
                    task=tl,
                    quick_level_id=tl.level_id,
                    task_template=str(text),
                    answer=str(answer),
                    author=(str(data.get("author") or "").strip()[:_AUTHOR_MAX] or _teacher_author_name(teacher)),
                    max_score=_parse_int(data.get("max_score")) or tl.max_score or 1,
                    created_by=username_for_created_by(request),
                    scope=Task.Scope.TEACHER,
                    owner_teacher=teacher,
                    local_number=local_number,
                    vpr_class=_parse_int(data.get("vpr_class")),
                    vpr_advanced=bool(data.get("vpr_advanced")),
                    vpr_basic=bool(data.get("vpr_basic")),
                    truth_table_enabled=bool(data.get("truth_table_enabled")),
                    exam_part=exam_part,
                )
                try:
                    _apply_status_to_task(task, (data.get("status") or Task.Status.READY))
                except ValueError as exc:
                    return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

                subtopic_id = _parse_int(data.get("subtopic_id"))
                if subtopic_id:
                    st = SubTopic.objects.filter(pk=subtopic_id, task_list=tl).first()
                    if st is None:
                        return Response({"detail": "Подтема не найдена."}, status=status.HTTP_400_BAD_REQUEST)
                    task.subtopic = st

                if upload:
                    try:
                        validate_uploaded_file(upload)
                    except UploadValidationError as exc:
                        return _upload_error_response(exc)
                    task.files = upload
                task.save()

                tag_ids = data.get("tag_ids") or data.get("tags") or []
                if isinstance(tag_ids, str):
                    tag_ids = [x for x in tag_ids.split(",") if x.strip()]
                parsed_tags = []
                for raw in tag_ids:
                    value = _parse_int(raw if not isinstance(raw, dict) else raw.get("id"))
                    if value:
                        parsed_tags.append(value)
                if parsed_tags:
                    task.tag_options.set(TagOption.objects.filter(id__in=parsed_tags, is_active=True))
        except AccessDenied as exc:
            _record_limit_event(request, TEACHER_TASK_LIMIT_REACHED, extra=f"{teacher.pk}:{exc.current}:{exc.limit}")
            return _entitlement_response(exc)

        task = self.owned_qs().get(pk=task.id)
        _record(request, TEACHER_TASK_CREATED, task)
        return Response(
            serialize_teacher_task(
                request,
                task,
                bank_code=bank.public_code,
                usage=0,
                include_body=True,
                include_answer=True,
            ),
            status=status.HTTP_201_CREATED,
        )


class TeacherTaskDetailView(TeacherTaskApiMixin, APIView):
    parser_classes = [JSONParser, MultiPartParser, FormParser]

    def get(self, request, task_id):
        task, err = self.get_owned_or_404(task_id)
        if err:
            return err
        bank = self.bank()
        payload = serialize_teacher_task(
            request,
            task,
            bank_code=bank.public_code,
            usage=variant_usage_count(task),
            include_body=True,
            include_answer=True,
        )
        payload["used_in_homework"] = homework_usage_count(task)
        return Response(payload)

    def patch(self, request, task_id):
        task, err = self.get_owned_or_404(task_id)
        if err:
            return err
        data = request.data if isinstance(request.data, dict) else {}
        if any(key in data for key in ("owner_teacher", "owner_teacher_id", "scope", "local_number")):
            return Response({"detail": "Поля владельца и номера изменять нельзя."}, status=status.HTTP_400_BAD_REQUEST)

        update_fields = []
        if "task_list_id" in data:
            tl_id = _parse_int(data.get("task_list_id"))
            tl = TaskList.objects.filter(pk=tl_id).first() if tl_id else None
            if tl is None:
                return Response({"detail": "Номер задания не найден."}, status=status.HTTP_400_BAD_REQUEST)
            task.task = tl
            task.quick_level_id = tl.level_id
            update_fields.extend(["task", "quick_level"])

        if "task_template" in data or "text" in data:
            text = data.get("task_template") if "task_template" in data else data.get("text")
            if len(str(text or "")) > _TEXT_MAX:
                return Response({"detail": "Текст задания слишком длинный."}, status=status.HTTP_400_BAD_REQUEST)
            if not str(text or "").strip():
                return Response({"detail": "Введите текст задания."}, status=status.HTTP_400_BAD_REQUEST)
            task.task_template = str(text)
            update_fields.append("task_template")

        if "answer" in data:
            if len(str(data.get("answer") or "")) > _ANSWER_MAX:
                return Response({"detail": "Ответ слишком длинный."}, status=status.HTTP_400_BAD_REQUEST)
            task.answer = str(data.get("answer") or "")
            update_fields.append("answer")

        if "max_score" in data:
            task.max_score = _parse_int(data.get("max_score")) or 1
            update_fields.append("max_score")

        if "author" in data:
            task.author = str(data.get("author") or "")[:_AUTHOR_MAX]
            update_fields.append("author")

        if "subtopic_id" in data:
            raw = data.get("subtopic_id")
            if raw in (None, "", False):
                task.subtopic = None
            else:
                st = SubTopic.objects.filter(pk=_parse_int(raw)).first()
                if st is None:
                    return Response({"detail": "Подтема не найдена."}, status=status.HTTP_400_BAD_REQUEST)
                if task.task_id and st.task_list_id != task.task_id:
                    return Response({"detail": "Подтема относится к другому номеру задания."}, status=status.HTTP_400_BAD_REQUEST)
                task.subtopic = st
            update_fields.append("subtopic")

        if "status" in data:
            try:
                _apply_status_to_task(task, str(data.get("status") or ""))
            except ValueError as exc:
                return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
            update_fields.extend(["status", "is_active"])

        for flag in ("vpr_advanced", "vpr_basic", "truth_table_enabled"):
            if flag in data:
                setattr(task, flag, bool(data.get(flag)))
                update_fields.append(flag)
        if "vpr_class" in data:
            task.vpr_class = _parse_int(data.get("vpr_class"))
            update_fields.append("vpr_class")

        if "exam_part" in data:
            task.exam_part = _parse_exam_part(data.get("exam_part"))
            update_fields.append("exam_part")

        upload = request.FILES.get("files") or request.FILES.get("file")
        if upload:
            try:
                enforce_teacher_task_attachments(self.teacher())
                enforce_teacher_task_storage(self.teacher(), int(getattr(upload, "size", 0) or 0))
                validate_uploaded_file(upload)
            except AccessDenied as exc:
                _record_limit_event(request, TEACHER_TASK_ATTACHMENT_PAYWALL, extra=str(self.teacher().pk))
                return _entitlement_response(exc)
            except Exception as exc:
                from .files_services import FileServiceError
                from .upload_validation import UploadValidationError as _UVE

                if isinstance(exc, FileServiceError):
                    return _entitlement_response(exc)
                if isinstance(exc, _UVE):
                    return _upload_error_response(exc)
                raise
            task.files = upload
            update_fields.append("files")

        if update_fields:
            task.created_by = username_for_created_by(request)
            update_fields.append("created_by")
            seen = []
            for name in update_fields:
                if name not in seen:
                    seen.append(name)
            task.save(update_fields=seen)

        if "tag_ids" in data or "tags" in data:
            tag_ids = data.get("tag_ids") if "tag_ids" in data else data.get("tags")
            if tag_ids is None:
                tag_ids = []
            if isinstance(tag_ids, str):
                tag_ids = [x for x in tag_ids.split(",") if x.strip()]
            parsed = []
            for raw in tag_ids:
                value = _parse_int(raw if not isinstance(raw, dict) else raw.get("id"))
                if value:
                    parsed.append(value)
            task.tag_options.set(TagOption.objects.filter(id__in=parsed, is_active=True))

        task = self.owned_qs().get(pk=task.id)
        _record(request, TEACHER_TASK_EDITED, task, extra=f"{task.id}:{timezone.now().strftime('%Y%m%d%H%M')}")
        return Response(
            serialize_teacher_task(
                request,
                task,
                bank_code=self.bank().public_code,
                usage=variant_usage_count(task),
                include_body=True,
                include_answer=True,
            )
        )

    def delete(self, request, task_id):
        task, err = self.get_owned_or_404(task_id)
        if err:
            return err
        used_variants = variant_usage_count(task)
        used_hw = homework_usage_count(task)
        if used_variants or used_hw:
            used_bits = []
            if used_variants:
                used_bits.append(f"{used_variants} вариантах")
            if used_hw:
                used_bits.append(f"{used_hw} домашних заданиях")
            return Response(
                {
                    "detail": (
                        "Задача уже использовалась в "
                        + " и ".join(used_bits)
                        + ". Чтобы сохранить историю учеников, её можно только архивировать."
                    ),
                    "code": "task_in_use",
                    "used_in_variants": used_variants,
                    "used_in_homework": used_hw,
                },
                status=status.HTTP_409_CONFLICT,
            )
        task.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class TeacherTaskDuplicateView(TeacherTaskApiMixin, APIView):
    def post(self, request, task_id):
        source, err = self.get_owned_or_404(task_id)
        if err:
            return err
        try:
            with transaction.atomic():
                lock_and_enforce_create(self.teacher())
                clone = _clone_teacher_task(
                    teacher=self.teacher(),
                    source=source,
                    bank=self.bank(),
                    created_by=username_for_created_by(request),
                )
        except AccessDenied as exc:
            _record_limit_event(
                request,
                TEACHER_TASK_LIMIT_REACHED,
                extra=f"{self.teacher().pk}:{exc.current}:{exc.limit}",
            )
            return _entitlement_response(exc)
        clone = self.owned_qs().get(pk=clone.id)
        _record(request, TEACHER_TASK_DUPLICATED, clone, extra=f"{source.id}:{clone.id}")
        return Response(
            serialize_teacher_task(
                request,
                clone,
                bank_code=self.bank().public_code,
                usage=0,
                include_body=True,
                include_answer=True,
            ),
            status=status.HTTP_201_CREATED,
        )


class TeacherTaskArchiveView(TeacherTaskApiMixin, APIView):
    def post(self, request, task_id):
        task, err = self.get_owned_or_404(task_id)
        if err:
            return err
        task.status = Task.Status.ARCHIVED
        task.sync_active_from_status()
        task.save(update_fields=["status", "is_active"])
        _record(request, TEACHER_TASK_ARCHIVED, task)
        return Response(
            serialize_teacher_task(
                request,
                self.owned_qs().get(pk=task.id),
                bank_code=self.bank().public_code,
                usage=variant_usage_count(task),
            )
        )


class TeacherTaskRestoreView(TeacherTaskApiMixin, APIView):
    def post(self, request, task_id):
        task, err = self.get_owned_or_404(task_id)
        if err:
            return err
        task.status = Task.Status.READY
        task.sync_active_from_status()
        task.save(update_fields=["status", "is_active"])
        return Response(
            serialize_teacher_task(
                request,
                self.owned_qs().get(pk=task.id),
                bank_code=self.bank().public_code,
                usage=variant_usage_count(task),
            )
        )


class TeacherTaskCopyFromGlobalView(TeacherTaskApiMixin, APIView):
    def post(self, request):
        data = request.data if isinstance(request.data, dict) else {}
        source_id = _parse_int(data.get("task_id") or data.get("source_task_id"))
        if not source_id:
            return Response({"detail": "Укажите задачу общего банка."}, status=status.HTTP_400_BAD_REQUEST)
        source = (
            Task.objects.filter(pk=source_id, scope=Task.Scope.GLOBAL)
            .prefetch_related("tag_options")
            .first()
        )
        if source is None:
            return Response({"detail": "Задача общего банка не найдена."}, status=status.HTTP_404_NOT_FOUND)
        try:
            with transaction.atomic():
                lock_and_enforce_copy(self.teacher())
                clone = _clone_teacher_task(
                    teacher=self.teacher(),
                    source=source,
                    bank=self.bank(),
                    created_by=username_for_created_by(request),
                )
        except AccessDenied as exc:
            event = (
                TEACHER_TASK_COPY_LIMIT_REACHED
                if exc.code == "TEACHER_TASK_COPY_LIMIT_REACHED"
                else TEACHER_TASK_LIMIT_REACHED
            )
            _record_limit_event(request, event, extra=f"{self.teacher().pk}:{exc.current}:{exc.limit}")
            return _entitlement_response(exc)
        clone = self.owned_qs().get(pk=clone.id)
        _record(request, TEACHER_TASK_COPIED_FROM_GLOBAL, clone, extra=f"{source.id}:{clone.id}")
        return Response(
            serialize_teacher_task(
                request,
                clone,
                bank_code=self.bank().public_code,
                usage=0,
                include_body=True,
                include_answer=True,
            ),
            status=status.HTTP_201_CREATED,
        )


class TeacherTaskCatalogView(TeacherTaskApiMixin, APIView):
    """Справочники предметов/уровней/номеров — те же, что у общего банка."""

    def get(self, request):
        subject = (request.query_params.get("subject") or "").strip()
        level = (request.query_params.get("level") or "").strip()
        subjects = []
        seen_subjects = set()
        for s in Subject.objects.order_by("subject_name"):
            sid = (s.subject_short or "").strip().lower()
            if not sid or sid in seen_subjects:
                continue
            seen_subjects.add(sid)
            subjects.append(
                {
                    "id": sid,
                    "pk": s.id,
                    "name": (s.subject_name or "").strip() or sid,
                }
            )
        levels = []
        seen_levels = set()
        for lv in Level.objects.order_by("id"):
            lid = _normalize_level_slug(lv.level) or (lv.level or "").strip().lower()
            if not lid or lid in seen_levels:
                continue
            seen_levels.add(lid)
            levels.append({"id": lid, "title": (lv.level_rus or "").strip() or lid})
        task_numbers = []
        subtopics = []
        if subject and level:
            subj = Subject.objects.filter(subject_short__iexact=subject).first()
            lvl = _level_instance_for_catalog(level)
            if subj and lvl:
                tls = TaskList.objects.filter(subject=subj, level=lvl).select_related("part").order_by("task_number")
                for tl in tls:
                    task_numbers.append(
                        {
                            "task_list_id": tl.id,
                            "task_number": tl.task_number,
                            "task_title": tl.task_title or "",
                            "suggested_exam_part": exam_part_from_part(tl.part),
                        }
                    )
                tl_id = _parse_int(request.query_params.get("task_list_id"))
                st_qs = SubTopic.objects.filter(task_list__subject=subj, task_list__level=lvl)
                if tl_id:
                    st_qs = st_qs.filter(task_list_id=tl_id)
                for st in st_qs.select_related("task_list").order_by("task_list__task_number", "order", "title"):
                    subtopics.append(
                        {
                            "id": st.id,
                            "title": st.title,
                            "task_list_id": st.task_list_id,
                            "task_number": st.task_list.task_number if st.task_list else None,
                        }
                    )
        tags = []
        for opt in (
            TagOption.objects.filter(is_active=True)
            .select_related("tag_type")
            .order_by("tag_type__order", "id")
        ):
            tags.append(_serialize_tag(opt))
        return Response(
            {
                "subjects": subjects,
                "levels": levels,
                "task_numbers": task_numbers,
                "subtopics": subtopics,
                "tags": tags,
            }
        )


def _upload_error_response(exc: UploadValidationError):
    return Response({"detail": exc.message, "code": exc.code}, status=status.HTTP_400_BAD_REQUEST)


def _file_response(file_field, download_name: str):
    if not file_field:
        return Response({"detail": "Файл не найден."}, status=status.HTTP_404_NOT_FOUND)
    try:
        handle = file_field.open("rb")
    except Exception:
        return Response({"detail": "Файл не найден."}, status=status.HTTP_404_NOT_FOUND)
    return FileResponse(handle, as_attachment=False, filename=download_name or "file")


class TeacherTaskImageUploadView(TeacherTaskApiMixin, APIView):
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request):
        upload = request.FILES.get("upload") or request.FILES.get("file") or request.FILES.get("image")
        if not upload:
            return Response({"detail": "Файл не передан."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            validate_uploaded_image(upload)
        except UploadValidationError as exc:
            return _upload_error_response(exc)
        if getattr(upload, "size", 0) > _IMAGE_MAX_BYTES:
            return Response({"detail": "Файл слишком большой. Максимум 5MB."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            enforce_teacher_task_storage(self.teacher(), int(getattr(upload, "size", 0) or 0))
        except Exception as exc:
            from .files_services import FileServiceError

            if isinstance(exc, FileServiceError):
                return _entitlement_response(exc)
            raise
        stored = _store_teacher_upload(self.teacher(), upload, folder="tasks")
        url = _absolute_media_url(request, stored)
        return Response({"url": url, "name": _safe_upload_name(upload.name)})


class TeacherTaskAttachmentsView(TeacherTaskApiMixin, APIView):
    parser_classes = [MultiPartParser, FormParser]

    def get(self, request, task_id):
        task, err = self.get_owned_or_404(task_id)
        if err:
            return err
        task = self.owned_qs().get(pk=task.id)
        return Response({"attachments": _task_attachments_payload(request, task)})

    def post(self, request, task_id):
        task, err = self.get_owned_or_404(task_id)
        if err:
            return err
        upload = request.FILES.get("file") or request.FILES.get("files") or request.FILES.get("upload")
        if not upload:
            return Response({"detail": "Файл не передан."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            enforce_teacher_task_attachments(self.teacher())
            enforce_teacher_task_storage(self.teacher(), int(getattr(upload, "size", 0) or 0))
            validate_uploaded_file(upload)
        except AccessDenied as exc:
            _record_limit_event(request, TEACHER_TASK_ATTACHMENT_PAYWALL, extra=str(self.teacher().pk))
            return _entitlement_response(exc)
        except Exception as exc:
            from .files_services import FileServiceError

            if isinstance(exc, FileServiceError):
                return _entitlement_response(exc)
            if isinstance(exc, UploadValidationError):
                return _upload_error_response(exc)
            raise
        att = TaskAttachment(
            task=task,
            original_name=_safe_upload_name(upload.name),
            size=int(getattr(upload, "size", 0) or 0),
        )
        att.file.save(_safe_upload_name(upload.name), upload, save=True)
        return Response(_serialize_attachment(request, task, att), status=status.HTTP_201_CREATED)


class TeacherTaskLegacyAttachmentView(TeacherTaskApiMixin, APIView):
    def get(self, request, task_id):
        task, err = self.get_owned_or_404(task_id)
        if err:
            return err
        name = task.files.name.rsplit("/", 1)[-1] if task.files else "file"
        return _file_response(task.files, name)

    def delete(self, request, task_id):
        task, err = self.get_owned_or_404(task_id)
        if err:
            return err
        if task.files:
            task.files.delete(save=False)
            task.files = None
            task.save(update_fields=["files"])
        return Response(status=status.HTTP_204_NO_CONTENT)


class TeacherTaskAttachmentDetailView(TeacherTaskApiMixin, APIView):
    def get(self, request, task_id, attachment_id):
        task, err = self.get_owned_or_404(task_id)
        if err:
            return err
        att = TaskAttachment.objects.filter(pk=attachment_id, task=task).first()
        if att is None:
            return Response({"detail": "Файл не найден."}, status=status.HTTP_404_NOT_FOUND)
        return _file_response(att.file, att.original_name or "file")

    def delete(self, request, task_id, attachment_id):
        task, err = self.get_owned_or_404(task_id)
        if err:
            return err
        att = TaskAttachment.objects.filter(pk=attachment_id, task=task).first()
        if att is None:
            return Response({"detail": "Файл не найден."}, status=status.HTTP_404_NOT_FOUND)
        if att.file:
            att.file.delete(save=False)
        att.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
