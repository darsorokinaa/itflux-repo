"""Homework assignment API for variant solver (ExamPage) and teacher review."""

from __future__ import annotations

import json
import logging
import os
import re
import uuid
from datetime import timedelta
from urllib.parse import parse_qs, urlencode, urlparse, urlunparse

import jwt
from django.conf import settings
from django.core.files.storage import default_storage
from django.utils import timezone
from rest_framework import status
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from .choices import SubmissionStatus
from .models import Homework, HomeworkSubmission, HomeworkTask, Profile, Student
from .student_api import _homework_qs, _pick_student, resolve_roster_students
from .upload_validation import UploadValidationError, validate_uploaded_file

logger = logging.getLogger(__name__)

VARIANT_URL_RE = re.compile(r"/variant/(\d+)", re.I)
VARIANT_PATH_RE = re.compile(
    r"(?:https?://[^/]+)?/(?P<level>[^/]+)/(?P<subject>[^/]+)/variant/(?P<vid>\d+)",
    re.I,
)
HOMEWORK_TOKEN_ISS = {"itflux-cabinet", "itflux", "lk", "cabinet"}


def is_variant_url(url: str) -> bool:
    return bool(VARIANT_URL_RE.search((url or "").strip()))


def extract_variant_id(url: str) -> int | None:
    match = VARIANT_URL_RE.search((url or "").strip())
    if not match:
        return None
    try:
        return int(match.group(1))
    except (TypeError, ValueError):
        return None


def task_is_variant(task: HomeworkTask) -> bool:
    if task.task_type == "generated_task":
        return True
    if is_variant_url(task.description):
        return True
    return False


def homework_has_variant_task(homework: Homework) -> bool:
    return any(task_is_variant(task) for task in homework.tasks.all())


def _lesson_secret() -> str:
    # Без LESSON_SECRET live-ссылки на вариант не получают lesson_token —
    # ученик не может сохранить ответы. Fallback на SECRET_KEY для локалки.
    explicit = (getattr(settings, "LESSON_SECRET", None) or "").strip()
    if explicit:
        return explicit
    return (getattr(settings, "SECRET_KEY", None) or "").strip()


def _webhook_secret() -> str:
    return (
        (getattr(settings, "LESSON_WEBHOOK_SECRET", None) or "").strip()
        or _lesson_secret()
    )


def issue_homework_token(*, homework_id: int, student_user_id: int, hours: int = 12) -> str | None:
    secret = _lesson_secret()
    if not secret:
        return None
    payload = {
        "homework_assignment_id": homework_id,
        "cabinet_assignment": homework_id,
        "student_user_id": student_user_id,
        "session_kind": "homework",
        "type": "student",
        "iss": "itflux-cabinet",
        "exp": timezone.now() + timedelta(hours=hours),
    }
    return jwt.encode(payload, secret, algorithm="HS256")


def decode_homework_token(token: str) -> dict | None:
    secret = _lesson_secret()
    if not secret or not token:
        return None
    try:
        payload = jwt.decode(token, secret, algorithms=["HS256"])
    except jwt.PyJWTError:
        return None
    iss = str(payload.get("iss") or "").strip().lower()
    if iss and iss not in HOMEWORK_TOKEN_ISS:
        return None
    return payload


def _assignment_id_from_token(payload: dict) -> int | None:
    for key in ("homework_assignment_id", "cabinet_assignment", "homeworkAssignmentId", "cabinetAssignment"):
        value = payload.get(key)
        if value is None:
            continue
        try:
            return int(float(str(value).strip()))
        except (TypeError, ValueError):
            continue
    return None


def normalize_variant_spa_url(url: str) -> str:
    """Привести ссылку на вариант к SPA-маршруту /:level/:subject/variant/:id."""
    raw = (url or "").strip()
    if not raw:
        return ""
    match = VARIANT_PATH_RE.search(raw)
    if match:
        level = match.group("level")
        subject = match.group("subject")
        vid = match.group("vid")
        return f"/{level}/{subject}/variant/{vid}"
    if raw.startswith("/") and "/variant/" in raw:
        return raw.split("?", 1)[0]
    return raw


def build_variant_open_url(
    *,
    base_url: str,
    homework_id: int,
    token: str | None = None,
    live_meeting: bool = False,
) -> str:
    raw = normalize_variant_spa_url(base_url)
    if not raw:
        return ""
    query = {
        "cabinet_assignment": str(homework_id),
        "homework_mode": "1",
    }
    if live_meeting:
        query["live_meeting"] = "1"
    if token:
        query["lesson_token"] = token
    qs = urlencode(query)
    separator = "&" if "?" in raw else "?"
    return f"{raw}{separator}{qs}"


def submission_api_status(submission: HomeworkSubmission | None) -> str:
    if not submission:
        return "sent"
    if submission.status == SubmissionStatus.CHECKED:
        return "reviewed"
    if submission.status in (SubmissionStatus.RETURNED, SubmissionStatus.NEEDS_REVISION):
        return "revision"
    # Есть ответы, но ещё не сдано — черновик (live-урок и обычное ДЗ).
    if not submission.submitted_at:
        return "sent"
    if submission.status == SubmissionStatus.SUBMITTED:
        if submission.result_payload:
            return "submitted"
        if submission.answer_text.strip() or submission.attached_file:
            return "submitted"
        return "sent"
    return "sent"


def compute_score_percent(result: dict | None) -> float | None:
    if not result or not isinstance(result, dict):
        return None
    checked = result.get("checked")
    if isinstance(checked, dict) and checked:
        total = len(checked)
        correct = sum(1 for value in checked.values() if value)
        return round(correct * 100 / total, 2) if total else None
    scores = result.get("scores")
    if isinstance(scores, dict) and scores:
        nums = []
        for value in scores.values():
            try:
                nums.append(float(value))
            except (TypeError, ValueError):
                continue
        if nums:
            max_score = max(nums) if max(nums) > 0 else 100
            return round(sum(nums) / (len(nums) * max_score) * 100, 2)
    return None


def serialize_assignment_payload(*, homework: Homework, submission: HomeworkSubmission | None) -> dict:
    variant_id = None
    for task in homework.tasks.all():
        vid = extract_variant_id(task.description)
        if vid:
            variant_id = vid
            break

    result = submission.result_payload if submission and submission.result_payload else None
    score = float(submission.score) if submission and submission.score is not None else None
    if score is None and result:
        computed = compute_score_percent(result)
        if computed is not None:
            score = computed

    return {
        "id": homework.id,
        "assignment_id": homework.id,
        "status": submission_api_status(submission),
        "result": result,
        "revision_task_ids": [],
        "deadline": homework.due_at.isoformat() if homework.due_at else None,
        "deadline_at": homework.due_at.isoformat() if homework.due_at else None,
        "variant_id": variant_id,
        "score": score,
        "score_percent": score,
        "answer_text": submission.answer_text if submission else "",
        "has_attached_file": bool(submission and submission.attached_file),
    }


def _token_from_request(request) -> str:
    auth = (request.headers.get("Authorization") or "").strip()
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    return (
        (request.query_params.get("token") or request.GET.get("token") or "")
        .strip()
        or (request.headers.get("X-Lesson-Token") or "").strip()
    )


def _webhook_ok(request) -> bool:
    expected = _webhook_secret()
    if not expected:
        return False
    got = (request.headers.get("X-Lesson-Webhook-Secret") or "").strip()
    return got == expected


def _resolve_access(request, homework_id: int):
    homework = Homework.objects.filter(pk=homework_id).select_related("teacher").first()
    if not homework:
        return None, None, Response({"detail": "Задание не найдено."}, status=status.HTTP_404_NOT_FOUND)

    token = _token_from_request(request)
    if token:
        payload = decode_homework_token(token)
        if not payload:
            return None, None, Response({"detail": "Невалидный токен."}, status=status.HTTP_401_UNAUTHORIZED)
        token_hw_id = _assignment_id_from_token(payload)
        if token_hw_id != homework_id:
            return None, None, Response({"detail": "Назначение не совпадает с токеном."}, status=status.HTTP_403_FORBIDDEN)
        student_user_id = payload.get("student_user_id") or payload.get("studentUserId")
        student = None
        if student_user_id:
            student = Student.objects.filter(user_id=student_user_id, teacher=homework.teacher).first()
        if not student and homework.student_id:
            student = homework.student
        if not student:
            return None, None, Response({"detail": "Ученик не найден."}, status=status.HTTP_403_FORBIDDEN)
        return homework, student, None

    if _webhook_ok(request):
        student = homework.student
        if not student:
            return None, None, Response({"detail": "Ученик не указан."}, status=status.HTTP_403_FORBIDDEN)
        return homework, student, None

    user = request.user
    if not user.is_authenticated:
        return None, None, Response({"detail": "Authentication credentials were not provided."}, status=status.HTTP_401_UNAUTHORIZED)

    profile = getattr(user, "profile", None)
    if profile and profile.role == Profile.Role.STUDENT:
        students = resolve_roster_students(user).filter(teacher=homework.teacher)
        if homework.student_id:
            students = students.filter(pk=homework.student_id)
        student = students.first()
        if not student:
            return None, None, Response({"detail": "Нет доступа к заданию."}, status=status.HTTP_403_FORBIDDEN)
        if not _homework_qs(students).filter(pk=homework_id).exists():
            return None, None, Response({"detail": "Нет доступа к заданию."}, status=status.HTTP_403_FORBIDDEN)
        return homework, student, None

    if profile and profile.role == Profile.Role.TEACHER and homework.teacher_id == user.id:
        student = homework.student or Student.objects.filter(teacher=user).first()
        return homework, student, None

    return None, None, Response({"detail": "Нет доступа."}, status=status.HTTP_403_FORBIDDEN)


def _get_or_create_submission(homework: Homework, student: Student) -> HomeworkSubmission:
    submission, _ = HomeworkSubmission.objects.get_or_create(
        homework=homework,
        student=student,
        defaults={},
    )
    return submission


def _safe_upload_filename(name: str) -> str:
    base = os.path.basename(name or "file")
    cleaned = re.sub(r"[^\w.\-() ]", "_", base).strip("._ ")
    return (cleaned[:180] or "file")


def _submission_student_editable(submission: HomeworkSubmission) -> bool:
    if submission.status == SubmissionStatus.CHECKED:
        return False
    if submission.submitted_at:
        if submission.status in (SubmissionStatus.RETURNED, SubmissionStatus.NEEDS_REVISION):
            return True
        return False
    return True


def _submission_upload_readonly(submission: HomeworkSubmission) -> bool:
    return not _submission_student_editable(submission)


def _merge_result_payload(
    existing: dict | None,
    new: dict | None,
) -> dict:
    merged = dict(new) if isinstance(new, dict) else {}
    prev = existing if isinstance(existing, dict) else {}
    for key in ("attachments_by_task_id", "attachments_by_number", "teacher_attachments_by_task_id", "teacher_attachments_by_number"):
        if key not in merged and key in prev:
            merged[key] = prev[key]
    return merged


def _attachment_url_matches(stored_url: str, requested_url: str) -> bool:
    a = (stored_url or "").strip()
    b = (requested_url or "").strip()
    if not a or not b:
        return False
    if a == b:
        return True
    try:
        return urlparse(a).path == urlparse(b).path
    except Exception:
        return a.split("?", 1)[0] == b.split("?", 1)[0]


def _storage_path_from_media_url(file_url: str) -> str | None:
    text = (file_url or "").strip()
    if not text:
        return None
    media_url = (settings.MEDIA_URL or "/media/").rstrip("/") + "/"
    if text.startswith(media_url):
        return text[len(media_url) :].lstrip("/")
    parsed = urlparse(text)
    if parsed.path.startswith("/media/"):
        return parsed.path[len("/media/") :].lstrip("/")
    return None


def _filter_attachment_list(items, file_url: str):
    if not isinstance(items, list):
        return items, None
    kept = []
    removed = None
    for item in items:
        if not isinstance(item, dict):
            kept.append(item)
            continue
        if removed is None and _attachment_url_matches(str(item.get("url") or ""), file_url):
            removed = item
            continue
        kept.append(item)
    return kept, removed


def _remove_attachment_from_payload(
    payload: dict,
    *,
    file_url: str,
    task_id: str = "",
    task_number: str = "",
) -> bool:
    removed_any = False
    by_id = dict(payload.get("attachments_by_task_id") or {})
    by_num = dict(payload.get("attachments_by_number") or {})

    if task_id and task_id in by_id:
        by_id[task_id], removed = _filter_attachment_list(by_id[task_id], file_url)
        if removed:
            removed_any = True
        if not by_id[task_id]:
            del by_id[task_id]

    if task_number and task_number in by_num:
        by_num[task_number], removed = _filter_attachment_list(by_num[task_number], file_url)
        if removed:
            removed_any = True
        if not by_num[task_number]:
            del by_num[task_number]

    if not removed_any:
        for key, items in list(by_id.items()):
            filtered, removed = _filter_attachment_list(items, file_url)
            if removed:
                removed_any = True
                if filtered:
                    by_id[key] = filtered
                else:
                    del by_id[key]
        for key, items in list(by_num.items()):
            filtered, removed = _filter_attachment_list(items, file_url)
            if removed:
                removed_any = True
                if filtered:
                    by_num[key] = filtered
                else:
                    del by_num[key]

    payload["attachments_by_task_id"] = by_id
    payload["attachments_by_number"] = by_num
    return removed_any


def _remove_teacher_attachment_from_payload(
    payload: dict,
    *,
    file_url: str,
    task_id: str = "",
    task_number: str = "",
) -> bool:
    removed_any = False
    by_id = dict(payload.get("teacher_attachments_by_task_id") or {})
    by_num = dict(payload.get("teacher_attachments_by_number") or {})

    if task_id and task_id in by_id:
        by_id[task_id], removed = _filter_attachment_list(by_id[task_id], file_url)
        if removed:
            removed_any = True
        if not by_id[task_id]:
            del by_id[task_id]

    if task_number and task_number in by_num:
        by_num[task_number], removed = _filter_attachment_list(by_num[task_number], file_url)
        if removed:
            removed_any = True
        if not by_num[task_number]:
            del by_num[task_number]

    if not removed_any:
        for key, items in list(by_id.items()):
            filtered, removed = _filter_attachment_list(items, file_url)
            if removed:
                removed_any = True
                if filtered:
                    by_id[key] = filtered
                else:
                    del by_id[key]
        for key, items in list(by_num.items()):
            filtered, removed = _filter_attachment_list(items, file_url)
            if removed:
                removed_any = True
                if filtered:
                    by_num[key] = filtered
                else:
                    del by_num[key]

    payload["teacher_attachments_by_task_id"] = by_id
    payload["teacher_attachments_by_number"] = by_num
    return removed_any


def append_teacher_feedback_attachment(
    payload: dict,
    *,
    task_id: str,
    task_number: str,
    file_url: str,
    filename: str,
) -> dict:
    by_id = dict(payload.get("teacher_attachments_by_task_id") or {})
    by_num = dict(payload.get("teacher_attachments_by_number") or {})
    entry = {
        "url": file_url,
        "filename": filename,
        "uploaded_at": timezone.now().isoformat(),
    }
    if task_id:
        by_id.setdefault(task_id, []).append(entry)
    if task_number:
        by_num.setdefault(task_number, []).append(entry)
    payload["teacher_attachments_by_task_id"] = by_id
    payload["teacher_attachments_by_number"] = by_num
    return payload


def _delete_attachment_file(file_url: str):
    rel_path = _storage_path_from_media_url(file_url)
    if rel_path and default_storage.exists(rel_path):
        default_storage.delete(rel_path)


def _parse_result_body(request):
    if hasattr(request.data, "get"):
        result = request.data.get("result")
        if result is not None:
            if isinstance(result, str):
                try:
                    return json.loads(result)
                except json.JSONDecodeError:
                    return None
            if isinstance(result, dict):
                return result
    try:
        body = request.body.decode("utf-8") if request.body else ""
        if body:
            parsed = json.loads(body)
            if isinstance(parsed, dict):
                return parsed.get("result", parsed)
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None
    return None


def _ensure_review_item(submission: HomeworkSubmission):
    from .models import ReviewItem

    if submission.status != SubmissionStatus.SUBMITTED:
        return None
    item, _ = ReviewItem.objects.get_or_create(
        teacher=submission.homework.teacher,
        source_type="homework",
        source_id=submission.pk,
        defaults={
            "student": submission.student,
            "title": f"{submission.homework.title} — {submission.student.full_name}",
            "status": "pending",
            "priority": "normal",
        },
    )
    return item


def _notify_homework_submitted(submission: HomeworkSubmission, review_item=None):
    from django.utils import timezone as dj_tz

    from .choices import NotificationChannel, NotificationStatus
    from .models import Notification
    from .notifications import get_or_create_preferences

    teacher = submission.homework.teacher
    if teacher is None:
        return
    prefs = get_or_create_preferences(teacher)
    if not getattr(prefs, "notify_homework", True):
        return
    review_id = getattr(review_item, "pk", None)
    url = f"/cabinet/review/{review_id}" if review_id else "/cabinet/review"
    Notification.objects.create(
        recipient_user=teacher,
        recipient_teacher=teacher,
        channel=NotificationChannel.IN_APP,
        title="Сдано домашнее задание",
        message=f"{submission.student.full_name} сдал(а) «{submission.homework.title}».",
        payload={
            "type": "homework_submitted",
            "homework_id": submission.homework_id,
            "submission_id": submission.pk,
            "review_id": review_id,
            "url": url,
        },
        status=NotificationStatus.SENT,
        sent_at=dj_tz.now(),
    )


class HomeworkAssignmentBaseView(APIView):
    permission_classes = [AllowAny]

    def resolve(self, request, homework_id: int):
        return _resolve_access(request, homework_id)


class HomeworkAssignmentDetailView(HomeworkAssignmentBaseView):
    def get(self, request, homework_id: int):
        homework, student, err = self.resolve(request, homework_id)
        if err:
            return err
        submission = (
            HomeworkSubmission.objects.filter(homework=homework, student=student)
            .order_by("-submitted_at", "-id")
            .first()
        )
        return Response(serialize_assignment_payload(homework=homework, submission=submission))


class HomeworkAssignmentSaveDraftView(HomeworkAssignmentBaseView):
    def post(self, request, homework_id: int):
        homework, student, err = self.resolve(request, homework_id)
        if err:
            return err
        result = _parse_result_body(request)
        if result is None:
            return Response({"detail": "result required"}, status=status.HTTP_400_BAD_REQUEST)

        submission = _get_or_create_submission(homework, student)
        if not _submission_student_editable(submission):
            message = (
                "Работа уже проверена."
                if submission.status == SubmissionStatus.CHECKED
                else "Работа уже отправлена на проверку."
            )
            return Response({"error": message}, status=status.HTTP_403_FORBIDDEN)
        merged = _merge_result_payload(submission.result_payload, result)
        submission.result_payload = merged
        computed = compute_score_percent(merged)
        if computed is not None:
            submission.score = computed
        submission.save(update_fields=["result_payload", "score", "updated_at"])
        return Response({"ok": True, "status": submission_api_status(submission)})


class HomeworkAssignmentUploadAnswerView(HomeworkAssignmentBaseView):
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request, homework_id: int):
        homework, student, err = self.resolve(request, homework_id)
        if err:
            return err

        uploaded = request.FILES.get("file")
        if not uploaded:
            return Response({"error": "file required"}, status=status.HTTP_400_BAD_REQUEST)

        try:
            validate_uploaded_file(uploaded)
        except UploadValidationError as exc:
            return Response({"error": exc.message, "code": exc.code}, status=status.HTTP_400_BAD_REQUEST)

        task_number = str(
            request.data.get("task_number") or request.POST.get("task_number") or ""
        ).strip()
        if not task_number:
            return Response({"error": "task_number required"}, status=status.HTTP_400_BAD_REQUEST)

        task_id = str(request.data.get("task_id") or request.POST.get("task_id") or "").strip()

        submission = _get_or_create_submission(homework, student)
        if _submission_upload_readonly(submission):
            return Response(
                {"error": "Работа уже отправлена на проверку."},
                status=status.HTTP_403_FORBIDDEN,
            )

        safe_name = _safe_upload_filename(uploaded.name)
        uid = uuid.uuid4().hex[:12]
        task_key = task_id or task_number
        rel_path = (
            f"cabinet/homework/answers/{homework_id}/{student.pk}/"
            f"{task_key}_{uid}_{safe_name}"
        )
        saved_path = default_storage.save(rel_path, uploaded)
        file_url = default_storage.url(saved_path)

        payload = dict(submission.result_payload or {})
        by_id = dict(payload.get("attachments_by_task_id") or {})
        by_num = dict(payload.get("attachments_by_number") or {})
        entry = {
            "url": file_url,
            "filename": safe_name,
            "uploaded_at": timezone.now().isoformat(),
        }
        if task_id:
            by_id.setdefault(task_id, []).append(entry)
        by_num.setdefault(task_number, []).append(entry)
        payload["attachments_by_task_id"] = by_id
        payload["attachments_by_number"] = by_num
        submission.result_payload = payload
        submission.save(update_fields=["result_payload", "updated_at"])

        return Response({"ok": True, "url": file_url, "filename": safe_name})

    def delete(self, request, homework_id: int):
        homework, student, err = self.resolve(request, homework_id)
        if err:
            return err

        file_url = str(
            request.query_params.get("url")
            or request.data.get("url")
            or ""
        ).strip()
        if not file_url:
            return Response({"error": "url required"}, status=status.HTTP_400_BAD_REQUEST)

        task_number = str(
            request.query_params.get("task_number")
            or request.data.get("task_number")
            or ""
        ).strip()
        task_id = str(
            request.query_params.get("task_id")
            or request.data.get("task_id")
            or ""
        ).strip()

        submission = _get_or_create_submission(homework, student)
        if _submission_upload_readonly(submission):
            return Response(
                {"error": "Работа уже отправлена на проверку."},
                status=status.HTTP_403_FORBIDDEN,
            )

        payload = dict(submission.result_payload or {})
        if not _remove_attachment_from_payload(
            payload,
            file_url=file_url,
            task_id=task_id,
            task_number=task_number,
        ):
            return Response({"error": "Файл не найден."}, status=status.HTTP_404_NOT_FOUND)

        _delete_attachment_file(file_url)
        submission.result_payload = payload
        submission.save(update_fields=["result_payload", "updated_at"])
        return Response({"ok": True})


class HomeworkAssignmentSubmitView(HomeworkAssignmentBaseView):
    def post(self, request, homework_id: int):
        homework, student, err = self.resolve(request, homework_id)
        if err:
            return err
        result = _parse_result_body(request)

        submission = _get_or_create_submission(homework, student)
        if submission.status == SubmissionStatus.CHECKED:
            return Response(
                {"error": "Работа уже проверена."},
                status=status.HTTP_403_FORBIDDEN,
            )
        if submission.submitted_at and submission.status == SubmissionStatus.SUBMITTED:
            return Response(
                {"error": "Работа уже отправлена на проверку."},
                status=status.HTTP_403_FORBIDDEN,
            )
        if result is not None:
            merged = _merge_result_payload(submission.result_payload, result)
            submission.result_payload = merged
            computed = compute_score_percent(merged)
            if computed is not None:
                submission.score = computed
        submission.status = SubmissionStatus.SUBMITTED
        submission.submitted_at = timezone.now()
        submission.save()
        review_item = _ensure_review_item(submission)
        _notify_homework_submitted(submission, review_item)
        return Response({"ok": True, "status": "submitted"})


class HomeworkAssignmentFetchByTokenView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        if not _webhook_ok(request):
            token = _token_from_request(request)
            if not token or not decode_homework_token(token):
                return Response({"detail": "Unauthorized"}, status=status.HTTP_401_UNAUTHORIZED)

        data = request.data if isinstance(request.data, dict) else {}
        homework_id = data.get("assignment_id") or data.get("homework_id")
        try:
            homework_id = int(homework_id)
        except (TypeError, ValueError):
            return Response({"detail": "assignment_id required"}, status=status.HTTP_400_BAD_REQUEST)

        homework, student, err = _resolve_access(request, homework_id)
        if err:
            return err
        submission = (
            HomeworkSubmission.objects.filter(homework=homework, student=student)
            .order_by("-submitted_at", "-id")
            .first()
        )
        return Response(serialize_assignment_payload(homework=homework, submission=submission))


def is_http_url(value: str) -> bool:
    return (value or "").strip().lower().startswith(("http://", "https://"))


def looks_like_resource_path(value: str) -> bool:
    text = (value or "").strip()
    if not text:
        return False
    if is_http_url(text):
        return True
    return text.startswith("/")


def _task_resource_url(task: HomeworkTask, homework: Homework) -> str:
    description = (task.description or "").strip()
    if looks_like_resource_path(description):
        return description

    plan_item = getattr(homework, "lesson_plan_item", None)
    if plan_item_id := getattr(homework, "lesson_plan_item_id", None):
        if plan_item is None:
            from .models import LessonPlanItem
            plan_item = LessonPlanItem.objects.filter(pk=plan_item_id).prefetch_related(
                "homework_materials"
            ).first()
        if plan_item:
            for material in plan_item.homework_materials.all():
                if material.title != task.title:
                    continue
                if material.file:
                    return material.file.url
                if material.external_url:
                    return material.external_url.strip()
                break

    return description


def serialize_student_task(
    task: HomeworkTask,
    *,
    homework: Homework,
    homework_id: int,
    token: str | None = None,
) -> dict:
    is_variant = task_is_variant(task)
    resource_url = _task_resource_url(task, homework)
    open_url = None
    if is_variant and resource_url and looks_like_resource_path(resource_url):
        open_url = build_variant_open_url(
            base_url=resource_url,
            homework_id=homework_id,
            token=token,
        )
    elif not is_variant and resource_url and looks_like_resource_path(resource_url):
        open_url = resource_url

    file_url = ""
    if task.task_type == "file" and resource_url:
        file_url = resource_url
    elif not is_variant and resource_url and task.task_type in ("external_link", "file"):
        file_url = resource_url

    return {
        "id": task.id,
        "title": task.title,
        "description": task.description,
        "task_type": task.task_type,
        "interactive_id": task.interactive_id,
        "is_variant": is_variant,
        "variant_id": extract_variant_id(resource_url or task.description),
        "file_url": file_url,
        "open_url": open_url,
    }


def _task_dedupe_key(serialized: dict) -> tuple:
    variant_id = serialized.get("variant_id")
    if variant_id:
        return ("variant", variant_id)
    title = (serialized.get("title") or "").strip().lower()
    resource = (
        serialized.get("open_url")
        or serialized.get("file_url")
        or serialized.get("description")
        or ""
    ).strip().lower()
    return ("resource", title, resource)


def serialize_homework_tasks(
    homework: Homework,
    *,
    homework_id: int,
    token: str | None = None,
) -> list[dict]:
    seen = set()
    items = []
    for task in homework.tasks.order_by("order", "id"):
        row = serialize_student_task(
            task,
            homework=homework,
            homework_id=homework_id,
            token=token,
        )
        key = _task_dedupe_key(row)
        if key in seen:
            continue
        seen.add(key)
        items.append(row)
    return items


def cleanup_duplicate_homework_tasks(homework: Homework) -> int:
    """Удалить дубли задач с одинаковым названием/ссылкой (legacy)."""
    keep_ids = []
    seen = set()
    for task in homework.tasks.order_by("order", "id"):
        row = serialize_student_task(task, homework=homework, homework_id=homework.id)
        key = _task_dedupe_key(row)
        if key in seen:
            continue
        seen.add(key)
        keep_ids.append(task.id)
    deleted, _ = homework.tasks.exclude(id__in=keep_ids).delete()
    return deleted


def build_homework_review_context(homework: Homework) -> dict:
    variant_id = None
    variant_path = ""
    level = ""
    subject = ""
    for task in homework.tasks.all():
        resource = (task.description or "").strip()
        vid = extract_variant_id(resource)
        if not vid:
            continue
        variant_id = vid
        variant_path = normalize_variant_spa_url(resource)
        match = VARIANT_PATH_RE.search(resource)
        if match:
            level = match.group("level")
            subject = match.group("subject")
        break
    return {
        "homework_id": homework.id,
        "homework_title": homework.title,
        "due_at": homework.due_at.isoformat() if homework.due_at else None,
        "has_variant": homework_has_variant_task(homework),
        "variant_id": variant_id,
        "variant_path": variant_path,
        "level": level,
        "subject": subject,
    }
