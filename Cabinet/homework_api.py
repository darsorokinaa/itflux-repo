"""Homework assignment API for variant solver (ExamPage) and teacher review."""

from __future__ import annotations

import html
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
from django.db.models import Q
from django.utils import timezone
from rest_framework import status
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from .choices import SubmissionStatus
from .models import Homework, HomeworkSubmission, HomeworkTask, Profile, Student
from .student_api import _homework_qs, _pick_student, resolve_roster_students
from .submission_files import submission_has_files
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
    return any(task_is_variant(task) for task in homework.tasks.filter(is_active=True))


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


LIVE_MEETING_HOMEWORK_MARKER = "live-meeting:"


def is_live_meeting_homework(homework) -> bool:
    """Вариант, показанный на видеоуроке — не попадает в очередь «Проверка»."""
    if homework is None:
        return False
    return LIVE_MEETING_HOMEWORK_MARKER in (getattr(homework, "description", None) or "")


def exclude_live_meeting_review_items(qs):
    """Убрать ReviewItem по сдаче live-варианта с урока — в «Проверка» не попадают."""
    from .models import HomeworkSubmission

    live_submission_ids = HomeworkSubmission.objects.filter(
        homework__description__contains=LIVE_MEETING_HOMEWORK_MARKER,
    ).values("pk")
    return qs.exclude(source_type="homework", source_id__in=live_submission_ids)


def review_items_ready_to_check(qs):
    """Оставить только работы, которые ученик реально сдал (есть submitted_at)."""
    from django.db.models import Q

    from .models import HomeworkSubmission

    submitted_ids = HomeworkSubmission.objects.filter(submitted_at__isnull=False).values("pk")
    filtered = qs.filter(
        Q(source_type="homework", source_id__in=submitted_ids) | ~Q(source_type="homework")
    )
    return filtered


def explain_homework_missing_from_teacher_queue(submission: HomeworkSubmission) -> str:
    """Диагностика: почему сдача не попадает в счётчик/очередь учителя."""
    if submission is None:
        return "no_submission"
    if not submission.submitted_at:
        return "submitted_at_missing"
    homework = submission.homework
    if homework is None:
        return "homework_missing"
    if is_live_meeting_homework(homework):
        return "live_meeting_excluded"
    if homework.teacher_id is None:
        return "teacher_missing"
    from .models import ReviewItem

    if not ReviewItem.objects.filter(
        teacher_id=homework.teacher_id,
        source_type="homework",
        source_id=submission.pk,
    ).exists():
        return "review_item_missing"
    return "ok"


def ensure_homework_in_review_queue(homework: Homework, student: Student):
    """
    Показать выданное ДЗ в разделе «Проверка» сразу после назначения.
    Live-варианты с урока сюда не попадают.
    """
    from .models import ReviewItem

    if homework is None or student is None:
        return None
    if is_live_meeting_homework(homework):
        return None

    submission = _get_or_create_submission(homework, student)
    item, _ = ReviewItem.objects.get_or_create(
        teacher=homework.teacher,
        source_type="homework",
        source_id=submission.pk,
        defaults={
            "student": student,
            "group": homework.group,
            "title": f"{homework.title} — {student.full_name}",
            "status": "pending",
            "priority": "normal",
        },
    )
    return item


def sync_assigned_homework_into_review_queue(teacher) -> int:
    """
    Догнать уже выданные ДЗ, у которых ещё нет ReviewItem
    (например, авто-выдача после урока до фикса).
    """
    from .choices import HomeworkStatus, StudentStatus
    from .models import ReviewItem

    if teacher is None:
        return 0

    qs = (
        Homework.objects.filter(teacher=teacher, status=HomeworkStatus.ASSIGNED)
        .filter(student__isnull=False)
        .exclude(student__status=StudentStatus.ARCHIVED)
        .select_related("student", "group")
        .order_by("-id")[:300]
    )

    created = 0
    for homework in qs:
        if is_live_meeting_homework(homework):
            continue
        try:
            submission = _get_or_create_submission(homework, homework.student)
            if ReviewItem.objects.filter(
                teacher=teacher,
                source_type="homework",
                source_id=submission.pk,
            ).exists():
                continue
            if ensure_homework_in_review_queue(homework, homework.student) is not None:
                created += 1
        except Exception:
            logger.exception(
                "sync_assigned_homework_into_review_queue failed for homework_id=%s",
                getattr(homework, "pk", None),
            )
    return created


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
        if submission.answer_text.strip() or submission_has_files(submission):
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


def recompute_variant_checked(result: dict | None, variant_id: int | None, *, subject: str = "") -> dict | None:
    """
    Пересчитать checked по эталону варианта.
    Ученику answer в JSON не отдаётся → клиент часто шлёт checked=false даже при верном ответе.
    """
    if not result or not isinstance(result, dict) or not variant_id:
        return result
    checked = result.get("checked")
    if not isinstance(checked, dict) or not checked:
        return result
    try:
        from Generator.answer_check import answers_equal, expected_answer_for_variant_task
    except Exception:
        try:
            from Generator.Generator.answer_check import answers_equal, expected_answer_for_variant_task
        except Exception:
            logger.exception("recompute_variant_checked: cannot import answer_check")
            return result

    by_id = result.get("by_task_id") or result.get("byTaskId") or {}
    by_num = result.get("by_number") or result.get("byNumber") or {}
    if not isinstance(by_id, dict):
        by_id = {}
    if not isinstance(by_num, dict):
        by_num = {}

    out_checked = dict(checked)
    for key, _flag in list(checked.items()):
        key_s = str(key)
        answer = ""
        if key_s in by_id and by_id[key_s] is not None:
            answer = by_id[key_s]
        elif key in by_id and by_id[key] is not None:
            answer = by_id[key]
        elif key_s in by_num and by_num[key_s] is not None:
            answer = by_num[key_s]
        if isinstance(answer, dict) and "text" in answer:
            answer = str(answer.get("text") or "")
        else:
            answer = str(answer or "")
        if not str(answer).strip():
            continue
        task_id = None
        try:
            task_id = int(key_s)
        except (TypeError, ValueError):
            task_id = None
        expected = expected_answer_for_variant_task(
            int(variant_id),
            task_id=task_id,
            task_number_key=key_s if task_id is None else "",
        )
        if not expected and task_id is not None:
            expected = expected_answer_for_variant_task(
                int(variant_id),
                task_number_key=key_s,
            )
        if not str(expected or "").strip():
            continue
        out_checked[key_s] = answers_equal(answer, expected, subject=subject)

    updated = dict(result)
    updated["checked"] = out_checked
    return updated


def serialize_assignment_payload(*, homework: Homework, submission: HomeworkSubmission | None) -> dict:
    variant_id = None
    for task in homework.tasks.filter(is_active=True):
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
        "has_attached_file": submission_has_files(submission),
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
        # Live-вариант с урока специально исключён из очереди ДЗ, но ученик
        # на занятии должен сохранять ответы по показанному заданию.
        if is_live_meeting_homework(homework):
            return homework, student, None
        if not _homework_qs(students).filter(pk=homework_id).exists():
            return None, None, Response({"detail": "Нет доступа к заданию."}, status=status.HTTP_403_FORBIDDEN)
        return homework, student, None

    if profile and profile.role == Profile.Role.TEACHER and homework.teacher_id == user.id:
        student = homework.student or Student.objects.filter(teacher=user).first()
        return homework, student, None

    return None, None, Response({"detail": "Нет доступа."}, status=status.HTTP_403_FORBIDDEN)


def _get_or_create_submission(homework: Homework, student: Student) -> HomeworkSubmission:
    from django.db import transaction

    from .homework_submit import get_or_create_locked_submission

    with transaction.atomic():
        return get_or_create_locked_submission(homework, student)


def _safe_upload_filename(name: str) -> str:
    base = os.path.basename(name or "file")
    cleaned = re.sub(r"[^\w.\-() ]", "_", base).strip("._ ")
    return (cleaned[:180] or "file")


TASK_ATTACHMENT_MAX_COUNT = int(getattr(settings, "TASK_ATTACHMENT_MAX_COUNT", 20))


def collect_request_files(request) -> list:
    files = []
    seen = set()
    for key in ("file", "files"):
        for uploaded in request.FILES.getlist(key):
            ident = id(uploaded)
            if ident in seen:
                continue
            seen.add(ident)
            files.append(uploaded)
    return files


def count_task_attachments(payload: dict, *, task_id: str, task_number: str, teacher: bool = False) -> int:
    id_key = "teacher_attachments_by_task_id" if teacher else "attachments_by_task_id"
    num_key = "teacher_attachments_by_number" if teacher else "attachments_by_number"
    by_id = payload.get(id_key) or {}
    by_num = payload.get(num_key) or {}
    items = None
    if task_id:
        items = by_id.get(str(task_id))
    if not items and task_number:
        items = by_num.get(str(task_number))
    return len(items) if isinstance(items, list) else 0


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


_RESULT_MAP_KEYS = (
    "by_task_id",
    "by_number",
    "checked",
    "scores",
    "attachments_by_task_id",
    "attachments_by_number",
    "teacher_attachments_by_task_id",
    "teacher_attachments_by_number",
    "comments_by_task_id",
    "comments_by_number",
)


def _merge_result_payload(
    existing: dict | None,
    new: dict | None,
) -> dict:
    """Частичный save-draft не затирает уже сохранённые ответы и вложения."""
    prev = existing if isinstance(existing, dict) else {}
    incoming = new if isinstance(new, dict) else {}
    if not prev:
        return dict(incoming)
    if not incoming:
        return dict(prev)
    merged = dict(prev)
    for key, val in incoming.items():
        if key in _RESULT_MAP_KEYS:
            old = merged.get(key) if isinstance(merged.get(key), dict) else {}
            nxt = val if isinstance(val, dict) else {}
            merged[key] = {**old, **nxt}
        else:
            merged[key] = val
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


def teacher_comment_attachments(payload: dict) -> list:
    items = (payload or {}).get("teacher_comment_attachments") or []
    return list(items) if isinstance(items, list) else []


def append_teacher_comment_attachment(payload: dict, *, file_url: str, filename: str) -> dict:
    items = teacher_comment_attachments(payload)
    items.append({
        "url": file_url,
        "filename": filename,
        "uploaded_at": timezone.now().isoformat(),
    })
    payload["teacher_comment_attachments"] = items
    return payload


def remove_teacher_comment_attachment(payload: dict, *, file_url: str) -> bool:
    items = teacher_comment_attachments(payload)
    kept = [item for item in items if str(item.get("url") or "") != str(file_url or "")]
    if len(kept) == len(items):
        return False
    payload["teacher_comment_attachments"] = kept
    return True


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
    if not submission.submitted_at:
        return None
    if is_live_meeting_homework(submission.homework):
        return None
    item, _ = ReviewItem.objects.get_or_create(
        teacher=submission.homework.teacher,
        source_type="homework",
        source_id=submission.pk,
        defaults={
            "student": submission.student,
            "group": submission.homework.group,
            "title": f"{submission.homework.title} — {submission.student.full_name}",
            "status": "pending",
            "priority": "normal",
        },
    )
    return item


def _notify_homework_submitted(submission: HomeworkSubmission, review_item=None, *, is_resubmit=False):
    from .teacher_notifications import (
        notify_teacher_auto_check_attention,
        notify_teacher_homework_submitted,
        notify_teacher_student_message,
        result_needs_manual_review,
    )

    teacher = submission.homework.teacher
    if teacher is None:
        return

    review_id = getattr(review_item, "pk", None)
    url = f"/cabinet/review/{review_id}" if review_id else "/cabinet/review"
    event_type = "homework_resubmitted" if is_resubmit else "homework_submitted"
    title = "Работа исправлена" if is_resubmit else "Домашняя работа отправлена"
    message = (
        f"{submission.student.full_name} повторно отправил(а) задание"
        if is_resubmit
        else f"{submission.student.full_name} · {submission.homework.title}"
    )
    payload = {
        "type": event_type,
        "event_type": event_type,
        "homework_id": submission.homework_id,
        "submission_id": submission.pk,
        "review_id": review_id,
        "url": url,
        "is_resubmit": bool(is_resubmit),
    }
    notify_teacher_homework_submitted(
        teacher=teacher,
        student=submission.student,
        title=title,
        message=message,
        payload=payload,
        is_resubmit=is_resubmit,
    )

    needs, reason = result_needs_manual_review(submission.result_payload)
    if needs:
        notify_teacher_auto_check_attention(
            teacher=teacher,
            student=submission.student,
            homework_title=submission.homework.title,
            review_url=url,
            reason=reason or "manual",
        )

    # Текстовый ответ без интерактива — короткое «сообщение» учителю
    answer = (submission.answer_text or "").strip()
    if answer and not (isinstance(submission.result_payload, dict) and submission.result_payload.get("checked")):
        notify_teacher_student_message(
            teacher=teacher,
            student=submission.student,
            preview=answer,
            url=url,
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
        variant_id = None
        for task in homework.tasks.filter(is_active=True):
            variant_id = extract_variant_id(task.description)
            if variant_id:
                break
        if not is_live_meeting_homework(homework):
            subject = ""
            try:
                subject = (build_homework_review_context(homework).get("subject") or "")
            except Exception:
                subject = ""
            merged = recompute_variant_checked(merged, variant_id, subject=subject) or merged
        submission.result_payload = merged
        computed = compute_score_percent(merged)
        if computed is not None:
            submission.score = computed
        submission.save(update_fields=["result_payload", "score", "updated_at"])
        logger.info(
            "homework.save_draft ok student_id=%s homework_id=%s submission_id=%s "
            "teacher_id=%s submitted_at=%s api_status=%s",
            getattr(student, "pk", None),
            homework_id,
            submission.pk,
            getattr(homework.teacher, "pk", None),
            submission.submitted_at.isoformat() if submission.submitted_at else None,
            submission_api_status(submission),
        )
        return Response(
            {
                "ok": True,
                "status": submission_api_status(submission),
                "result": merged,
            }
        )


class HomeworkAssignmentUploadAnswerView(HomeworkAssignmentBaseView):
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request, homework_id: int):
        homework, student, err = self.resolve(request, homework_id)
        if err:
            return err

        uploaded_files = collect_request_files(request)
        if not uploaded_files:
            return Response({"error": "file required"}, status=status.HTTP_400_BAD_REQUEST)

        try:
            if len(uploaded_files) > TASK_ATTACHMENT_MAX_COUNT:
                raise UploadValidationError(
                    f"Слишком много файлов. Максимум {TASK_ATTACHMENT_MAX_COUNT}.",
                    code="TOO_MANY_FILES",
                )
            for uploaded in uploaded_files:
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

        payload = dict(submission.result_payload or {})
        existing_count = count_task_attachments(
            payload, task_id=task_id, task_number=task_number, teacher=False
        )
        if existing_count + len(uploaded_files) > TASK_ATTACHMENT_MAX_COUNT:
            return Response(
                {
                    "error": f"Слишком много файлов к заданию. Максимум {TASK_ATTACHMENT_MAX_COUNT}.",
                    "code": "TOO_MANY_FILES",
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        by_id = dict(payload.get("attachments_by_task_id") or {})
        by_num = dict(payload.get("attachments_by_number") or {})
        saved = []
        for uploaded in uploaded_files:
            try:
                if hasattr(uploaded, "seek"):
                    uploaded.seek(0)
            except Exception:
                pass
            safe_name = _safe_upload_filename(uploaded.name)
            uid = uuid.uuid4().hex[:12]
            task_key = task_id or task_number
            rel_path = (
                f"cabinet/homework/answers/{homework_id}/{student.pk}/"
                f"{task_key}_{uid}_{safe_name}"
            )
            saved_path = default_storage.save(rel_path, uploaded)
            file_url = default_storage.url(saved_path)
            entry = {
                "url": file_url,
                "filename": safe_name,
                "uploaded_at": timezone.now().isoformat(),
            }
            if task_id:
                by_id.setdefault(task_id, []).append(entry)
            by_num.setdefault(task_number, []).append(entry)
            saved.append({"url": file_url, "filename": safe_name})

        payload["attachments_by_task_id"] = by_id
        payload["attachments_by_number"] = by_num
        submission.result_payload = payload
        submission.save(update_fields=["result_payload", "updated_at"])

        first = saved[0]
        return Response({
            "ok": True,
            "url": first["url"],
            "filename": first["filename"],
            "attachments": saved,
        })

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

        from .homework_submit import HomeworkSubmitError, submit_homework_for_student

        teacher = homework.teacher
        variant_id = None
        for task in homework.tasks.filter(is_active=True):
            variant_id = extract_variant_id(task.description)
            if variant_id:
                break

        try:
            outcome = submit_homework_for_student(
                homework=homework,
                student=student,
                result=result,
            )
        except HomeworkSubmitError as exc:
            logger.info(
                "homework.submit rejected code=%s student_id=%s homework_id=%s teacher_id=%s",
                exc.code,
                getattr(student, "pk", None),
                homework_id,
                getattr(teacher, "pk", None),
            )
            return Response({"error": exc.message, "code": exc.code}, status=exc.status)
        except Exception:
            logger.exception(
                "homework.submit failed student_id=%s homework_id=%s teacher_id=%s",
                getattr(student, "pk", None),
                homework_id,
                getattr(teacher, "pk", None),
            )
            return Response(
                {"error": "Не удалось сохранить отправку. Попробуйте ещё раз."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        submission = outcome.submission
        review_item = outcome.review_item
        if outcome.already_submitted:
            logger.info(
                "homework.submit idempotent student_id=%s homework_id=%s "
                "submission_id=%s teacher_id=%s variant_id=%s review_id=%s",
                getattr(student, "pk", None),
                homework_id,
                submission.pk,
                getattr(teacher, "pk", None),
                variant_id,
                getattr(review_item, "pk", None),
            )
            return Response({
                "ok": True,
                "status": "submitted",
                "already_submitted": True,
                "submitted_at": submission.submitted_at.isoformat() if submission.submitted_at else None,
                "submission_id": submission.pk,
                "review_id": getattr(review_item, "pk", None),
            })

        queue_reason = explain_homework_missing_from_teacher_queue(submission)
        if queue_reason != "ok":
            logger.warning(
                "homework.submit not_in_teacher_queue student_id=%s homework_id=%s "
                "submission_id=%s teacher_id=%s variant_id=%s reason=%s",
                getattr(student, "pk", None),
                homework_id,
                submission.pk,
                getattr(teacher, "pk", None),
                variant_id,
                queue_reason,
            )

        logger.info(
            "homework.submit ok student_id=%s homework_id=%s submission_id=%s "
            "teacher_id=%s variant_id=%s resubmit=%s review_id=%s score=%s",
            getattr(student, "pk", None),
            homework_id,
            submission.pk,
            getattr(teacher, "pk", None),
            variant_id,
            outcome.is_resubmit,
            getattr(review_item, "pk", None),
            submission.score,
        )
        return Response({
            "ok": True,
            "status": "submitted",
            "submitted_at": submission.submitted_at.isoformat() if submission.submitted_at else None,
            "submission_id": submission.pk,
            "review_id": getattr(review_item, "pk", None),
            "score": float(submission.score) if submission.score is not None else None,
        })


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
    from .files_services import is_blocked_media_url, material_file_url

    description = (task.description or "").strip()
    if looks_like_resource_path(description) and not is_blocked_media_url(description):
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
                url = material_file_url(material, for_student=True)
                if url and not is_blocked_media_url(url):
                    return url
                if material.external_url:
                    return material.external_url.strip()
                break

    # Старые задания: в description лежит /media/cabinet/my-files/... — ищем Material по имени файла
    if description and is_blocked_media_url(description):
        from .models import Material
        from .student_release import _link_material_file_to_homework

        file_name = description.rstrip("/").split("/")[-1].split("?")[0]
        materials = Material.objects.filter(
            Q(teacher_id=homework.teacher_id) | Q(is_public=True)
        ).filter(
            Q(cabinet_file__storage_key__endswith=file_name)
            | Q(file=description)
            | Q(file__endswith=file_name)
        )[:5]
        for material in materials:
            url = material_file_url(material, for_student=True)
            if url and not is_blocked_media_url(url):
                try:
                    _link_material_file_to_homework(homework, material)
                except Exception:
                    logger.debug(
                        "link material file to homework failed hw=%s material=%s",
                        homework.pk,
                        material.pk,
                        exc_info=True,
                    )
                return url

    return "" if is_blocked_media_url(description) else description


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
    elif (
        not is_variant
        and task.task_type != "text"
        and resource_url
        and looks_like_resource_path(resource_url)
    ):
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


INSTRUCTION_TASK_TITLES = frozenset({"домашнее задание", "описание"})


def homework_instruction_text(homework: Homework) -> str:
    """Текст инструкции ДЗ: поле description, иначе текстовая задача без ссылки."""
    text = (homework.description or "").strip()
    if text:
        return text
    tasks = homework.tasks.filter(is_active=True, task_type="text").order_by("order", "id")
    for task in tasks:
        if task_is_variant(task):
            continue
        desc = (task.description or "").strip()
        title = (task.title or "").strip().lower()
        if desc and not looks_like_resource_path(desc):
            return desc
        if title in INSTRUCTION_TASK_TITLES and desc and not looks_like_resource_path(desc):
            return desc
    return ""


def _is_instruction_text_task(task: HomeworkTask, homework_description: str) -> bool:
    """Текстовая задача, дублирующая инструкцию ДЗ — её не показывают как вложение."""
    if getattr(task, "task_type", "") != "text":
        return False
    if task_is_variant(task):
        return False
    desc = (task.description or "").strip()
    title = (task.title or "").strip()
    hw_desc = (homework_description or "").strip()
    if hw_desc and desc == hw_desc:
        return True
    return title.lower() in INSTRUCTION_TASK_TITLES


def _norm_key(value) -> str:
    return str(value or "").strip().lower()


def _basename_key(value) -> str:
    text = _norm_key(value)
    if not text:
        return ""
    return text.rstrip("/").split("/")[-1].split("?")[0]


def _filename_key(value) -> str:
    """Имя файла с расширением; служебные сегменты URL вроде download не считаем."""
    base = _basename_key(value)
    if "." not in base:
        return ""
    return base


def _attachment_dedupe_keys(attachments: list[dict]) -> set[str]:
    keys: set[str] = set()
    for att in attachments or []:
        for raw in (
            att.get("name"),
            att.get("original_name"),
            att.get("url"),
            att.get("preview_url"),
            att.get("file_id"),
            att.get("material_id"),
        ):
            key = _norm_key(raw)
            if key:
                keys.add(key)
            filename = _filename_key(raw)
            if filename:
                keys.add(filename)
    return keys


def _task_duplicates_attachment(row: dict, attachment_keys: set[str]) -> bool:
    if not attachment_keys or row.get("is_variant"):
        return False
    if row.get("task_type") not in {"file", "external_link"}:
        return False
    for raw in (
        row.get("title"),
        row.get("open_url"),
        row.get("file_url"),
        row.get("description"),
        row.get("material_id"),
    ):
        key = _norm_key(raw)
        if key and key in attachment_keys:
            return True
        filename = _filename_key(raw)
        if filename and filename in attachment_keys:
            return True
    return False


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
    from .homework_attachments import list_homework_attachments

    homework_description = homework_instruction_text(homework)
    attachment_keys = _attachment_dedupe_keys(list_homework_attachments(homework))
    seen = set()
    items = []
    for task in homework.tasks.filter(is_active=True).order_by("order", "id"):
        if _is_instruction_text_task(task, homework_description):
            continue
        row = serialize_student_task(
            task,
            homework=homework,
            homework_id=homework_id,
            token=token,
        )
        if _task_duplicates_attachment(row, attachment_keys):
            continue
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
    for task in homework.tasks.filter(is_active=True).order_by("order", "id"):
        row = serialize_student_task(task, homework=homework, homework_id=homework.id)
        key = _task_dedupe_key(row)
        if key in seen:
            continue
        seen.add(key)
        keep_ids.append(task.id)
    deleted, _ = homework.tasks.filter(is_active=True).exclude(id__in=keep_ids).delete()
    return deleted


def build_homework_review_context(homework: Homework) -> dict:
    variant_id = None
    variant_path = ""
    level = ""
    subject = ""
    for task in homework.tasks.filter(is_active=True):
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
    tasks = serialize_homework_tasks(homework, homework_id=homework.id, token=None)
    from .homework_attachments import list_homework_attachments

    attachments = list_homework_attachments(homework)
    return {
        "homework_id": homework.id,
        "homework_title": homework.title,
        "due_at": homework.due_at.isoformat() if homework.due_at else None,
        "has_variant": homework_has_variant_task(homework),
        "variant_id": variant_id,
        "variant_path": variant_path,
        "level": level,
        "subject": subject,
        "tasks": tasks,
        "tasks_count": len(tasks),
        "description": homework_instruction_text(homework),
        "attachments": attachments,
        "attachments_count": len(attachments),
        "subject_label": (
            homework.student_subject.display_label
            if homework.student_subject_id and homework.student_subject
            else ""
        ),
    }


def build_homework_review_list_context(homework: Homework) -> dict:
    """Лёгкий контекст для списка проверки — без сериализации всех заданий."""
    variant_id = None
    level = ""
    subject = ""
    has_variant = False
    tasks_count = 0
    for task in homework.tasks.all():
        if not getattr(task, "is_active", True):
            continue
        tasks_count += 1
        resource = (task.description or "").strip()
        if task_is_variant(task):
            has_variant = True
        vid = extract_variant_id(resource)
        if vid and not variant_id:
            variant_id = vid
            match = VARIANT_PATH_RE.search(resource)
            if match:
                level = match.group("level") or ""
                subject = match.group("subject") or ""
    subject_label = ""
    if homework.student_subject_id and homework.student_subject:
        subject_label = homework.student_subject.display_label
    return {
        "homework_id": homework.id,
        "homework_title": homework.title,
        "due_at": homework.due_at.isoformat() if homework.due_at else None,
        "has_variant": has_variant,
        "variant_id": variant_id,
        "level": level,
        "subject": subject,
        "subject_label": subject_label,
        "tasks_count": tasks_count,
    }


def prefetch_submissions_for_review_items(items) -> dict:
    """Один запрос submissions для списка ReviewItem (source_id не FK)."""
    ids = [
        item.source_id
        for item in items
        if getattr(item, "source_type", None) == "homework" and item.source_id
    ]
    if not ids:
        return {}
    submissions = (
        HomeworkSubmission.objects.filter(pk__in=ids)
        .select_related(
            "homework",
            "homework__student_subject",
            "student",
        )
        .prefetch_related("homework__tasks", "file_attachments")
    )
    return {sub.pk: sub for sub in submissions}


def _homework_recipient_students(homework: Homework) -> list:
    from .models import Student

    if homework.student_id:
        return [homework.student]
    if homework.group_id:
        return list(homework.group.students.exclude(status="archived").order_by("id"))
    student_ids = (
        HomeworkSubmission.objects.filter(homework=homework)
        .values_list("student_id", flat=True)
        .distinct()
    )
    return list(Student.objects.filter(id__in=student_ids).order_by("id"))


def notify_students_homework_tasks_added(
    homework: Homework,
    *,
    added_titles: list[str] | None = None,
) -> int:
    """Оповещение ученикам о новых заданиях в ДЗ (с учётом prefs.notify_homework)."""
    import html

    from .notification_catalog import NotificationEventType
    from .notification_dispatch import NotificationDispatcher
    from .telegram_connect import platform_path_url
    from Generator.telegram_utils import escape_telegram_html

    titles = [str(t).strip() for t in (added_titles or []) if str(t).strip()]
    if titles:
        if len(titles) == 1:
            detail = f"Добавлено задание: «{titles[0]}»."
        else:
            detail = f"Добавлены задания ({len(titles)}): " + ", ".join(f"«{t}»" for t in titles[:5])
            if len(titles) > 5:
                detail += "…"
    else:
        detail = "В домашнее задание добавлены новые материалы."

    title = "Обновлено домашнее задание"
    message = f"«{homework.title}». {detail}"
    assignment_path = f"/cabinet/student/assignments/{homework.id}"
    cabinet_url = platform_path_url(assignment_path)
    tg_text = (
        f"{escape_telegram_html(title)}\n\n"
        f"{escape_telegram_html(message)}\n\n"
        f'<a href="{html.escape(cabinet_url, quote=True)}">Открыть задание</a>'
    )
    actor = getattr(homework, "teacher", None)
    sent = 0

    for student in _homework_recipient_students(homework):
        user = student.user if student and student.user_id else None
        if user is None:
            continue
        result = NotificationDispatcher.notify(
            user,
            NotificationEventType.HOMEWORK_UPDATED,
            title=title,
            message=message,
            actor=actor if getattr(actor, "pk", None) else None,
            related_object=homework,
            payload={
                "type": NotificationEventType.HOMEWORK_UPDATED,
                "event_type": NotificationEventType.HOMEWORK_UPDATED,
                "homework_id": homework.id,
                "url": assignment_path,
                "added_titles": titles,
            },
            url=assignment_path,
            dedup_key=f"homework_updated:{homework.id}:{user.pk}:{timezone.now().strftime('%Y%m%d%H%M')}",
            recipient_student=student,
            skip_actor=True,
            create_telegram=True,
            telegram_text=tg_text,
            push_tag=f"hw-updated-{homework.id}",
        )
        if not result.skipped:
            sent += 1
    return sent


def add_tasks_to_homework(
    *,
    homework: Homework,
    teacher,
    material_ids: list[int] | None = None,
    interactive_ids: list[int] | None = None,
    text: str = "",
    text_title: str = "",
) -> dict:
    """
    Добавить задания в уже выданное ДЗ и оповестить учеников.
    """
    from django.db.models import Q

    from .choices import HomeworkStatus, HomeworkTaskType, InteractiveStatus
    from .models import HomeworkTask, Interactive, Material
    from .student_release import (
        _add_interactive_homework_task,
        _add_material_homework_task,
        _ensure_interactive_assignment,
        _record_variant_tasks_for_homework,
    )

    if homework.teacher_id != teacher.id:
        raise PermissionError("Нет доступа к этому домашнему заданию")
    if homework.status == HomeworkStatus.ARCHIVED:
        raise ValueError("Нельзя изменить архивное домашнее задание")
    from .homework_edit import homework_is_checked_or_completed

    if homework_is_checked_or_completed(homework):
        raise ValueError("Нельзя добавить задание: работа уже проверена и принята")

    material_ids = [int(pk) for pk in (material_ids or []) if pk]
    interactive_ids = [int(pk) for pk in (interactive_ids or []) if pk]
    text = (text or "").strip()
    text_title = (text_title or "").strip() or "Дополнительное задание"

    if not text and not material_ids and not interactive_ids:
        raise ValueError("Добавьте текст, материал или интерактив")

    materials = []
    if material_ids:
        materials = list(
            Material.objects.filter(pk__in=material_ids).filter(
                Q(is_public=True) | Q(teacher=teacher) | Q(teacher__isnull=True, is_public=True)
            )
        )
        if len(materials) != len(set(material_ids)):
            raise ValueError("Некоторые материалы недоступны")

    interactives = []
    if interactive_ids:
        interactives = list(
            Interactive.objects.filter(pk__in=interactive_ids, teacher=teacher).exclude(
                status=InteractiveStatus.ARCHIVED
            )
        )
        if len(interactives) != len(set(interactive_ids)):
            raise ValueError("Некоторые интерактивы недоступны")

    order = (
        HomeworkTask.objects.filter(homework=homework, is_active=True)
        .order_by("-order", "-id")
        .values_list("order", flat=True)
        .first()
    )
    order = (order or 0) + 1
    added_titles: list[str] = []

    if text:
        HomeworkTask.objects.create(
            homework=homework,
            task_type=HomeworkTaskType.TEXT,
            title=text_title,
            description=text,
            order=order,
        )
        added_titles.append(text_title)
        order += 1

    for material in materials:
        _add_material_homework_task(homework, material, order)
        added_titles.append(material.title or "Материал")
        order += 1

    for interactive in interactives:
        _add_interactive_homework_task(homework, interactive, order)
        for student in _homework_recipient_students(homework):
            _ensure_interactive_assignment(
                teacher=teacher,
                interactive=interactive,
                student=student,
                lesson=None,
                plan_item=None,
            )
        added_titles.append(interactive.title or "Интерактив")
        order += 1

    for student in _homework_recipient_students(homework):
        _record_variant_tasks_for_homework(homework, student, teacher)
        ensure_homework_in_review_queue(homework, student)

    notified = notify_students_homework_tasks_added(homework, added_titles=added_titles)
    context = build_homework_review_context(homework)
    context["notified_students"] = notified
    context["added_titles"] = added_titles
    return context
