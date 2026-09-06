"""Персональный банк задач учителя: коды, нумерация, изоляция queryset."""

from __future__ import annotations

import re
import secrets
from typing import Optional

from django.db import IntegrityError, transaction
from django.db.models import Count, Q, QuerySet
from django.utils.html import strip_tags

from .models import Task, TeacherTaskBank, Variant, VariantContent, username_for_created_by

BANK_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
BANK_CODE_LENGTH = 5
PUBLIC_CODE_RE = re.compile(
    r"^([A-HJ-NP-Z2-9]{5})(?:-V-)?-?(\d{1,8})?$",
    re.IGNORECASE,
)
MAX_CODE_ATTEMPTS = 32

TEACHER_OWNED_TASK_NOTICE = (
    "Эта задача создана другим преподавателем. Если создали её вы — войдите в свой аккаунт."
)
TEACHER_OWNED_VARIANT_NOTICE = (
    "Этот вариант создан другим преподавателем. Если создали его вы — войдите в свой аккаунт."
)
TEACHER_OWNED_TASK_NOTICE_LOGGED_IN = "Эта задача создана другим преподавателем."
TEACHER_OWNED_VARIANT_NOTICE_LOGGED_IN = "Этот вариант создан другим преподавателем."


def teacher_owned_notice(*, kind: str = "task", viewer_is_teacher: bool = False) -> dict:
    if kind == "variant":
        message = TEACHER_OWNED_VARIANT_NOTICE_LOGGED_IN if viewer_is_teacher else TEACHER_OWNED_VARIANT_NOTICE
    else:
        message = TEACHER_OWNED_TASK_NOTICE_LOGGED_IN if viewer_is_teacher else TEACHER_OWNED_TASK_NOTICE
    payload = {
        "code": "teacher_owned",
        "kind": kind,
        "message": message,
        "login_url": "/cabinet/login",
    }
    if viewer_is_teacher:
        payload["bank_url"] = "/tasks/my"
    return payload


def request_teacher(request):
    """Учитель из сессии или None. Не доверяет полям тела запроса."""
    user = getattr(request, "user", None) if request is not None else None
    if user is None or not getattr(user, "is_authenticated", False):
        return None
    profile = getattr(user, "profile", None)
    if profile is None:
        return None
    if getattr(profile, "account_blocked", False) or not getattr(profile, "account_active", True):
        return None
    role = getattr(profile, "role", None)
    if role != "teacher":
        return None
    return user


def generate_bank_code() -> str:
    return "".join(secrets.choice(BANK_CODE_ALPHABET) for _ in range(BANK_CODE_LENGTH))


def get_or_create_teacher_bank(teacher) -> TeacherTaskBank:
    existing = TeacherTaskBank.objects.filter(teacher=teacher).first()
    if existing:
        return existing
    for _ in range(MAX_CODE_ATTEMPTS):
        code = generate_bank_code()
        try:
            with transaction.atomic():
                return TeacherTaskBank.objects.create(teacher=teacher, public_code=code)
        except IntegrityError:
            continue
    raise RuntimeError("Не удалось выделить уникальный код банка задач")


@transaction.atomic
def allocate_task_number(teacher) -> tuple[int, TeacherTaskBank]:
    bank = get_or_create_teacher_bank(teacher)
    bank = TeacherTaskBank.objects.select_for_update().get(pk=bank.pk)
    number = bank.next_task_number
    bank.next_task_number = number + 1
    bank.save(update_fields=["next_task_number"])
    return number, bank


@transaction.atomic
def allocate_variant_number(teacher) -> tuple[int, TeacherTaskBank]:
    bank = get_or_create_teacher_bank(teacher)
    bank = TeacherTaskBank.objects.select_for_update().get(pk=bank.pk)
    number = bank.next_variant_number
    bank.next_variant_number = number + 1
    bank.save(update_fields=["next_variant_number"])
    return number, bank


def format_task_public_code(bank_code: str, local_number: int | None) -> str | None:
    if not bank_code or local_number is None:
        return None
    return f"{bank_code}-{int(local_number):03d}" if local_number < 1000 else f"{bank_code}-{int(local_number)}"


def format_variant_public_code(bank_code: str, local_number: int | None) -> str | None:
    if not bank_code or local_number is None:
        return None
    return f"{bank_code}-V-{int(local_number):03d}" if local_number < 1000 else f"{bank_code}-V-{int(local_number)}"


def parse_task_public_code(raw: str) -> tuple[str | None, int | None]:
    text = (raw or "").strip().upper().replace(" ", "")
    if not text:
        return None, None
    match = PUBLIC_CODE_RE.match(text)
    if not match:
        return None, None
    code = match.group(1).upper()
    number = int(match.group(2)) if match.group(2) else None
    return code, number


def public_bank_q(*, prefix: str = "") -> Q:
    p = prefix
    return Q(**{f"{p}is_active": True, f"{p}scope": Task.Scope.GLOBAL})


def owned_ready_q(teacher, *, prefix: str = "") -> Q:
    p = prefix
    return Q(
        **{
            f"{p}is_active": True,
            f"{p}scope": Task.Scope.TEACHER,
            f"{p}owner_teacher": teacher,
            f"{p}status": Task.Status.READY,
        }
    )


def normalize_generator_source(raw: str | None) -> str:
    value = (raw or "").strip().lower()
    if value in ("mine", "my", "teacher", "my_bank", "teacher_bank"):
        return "mine"
    if value in ("all", "both", "any"):
        return "all"
    return "global"


def generator_source_q(request, source: str | None, *, prefix: str = "") -> Q:
    source = normalize_generator_source(source)
    teacher = request_teacher(request)
    if source == "mine":
        if teacher is None:
            return Q(pk__in=[])
        return owned_ready_q(teacher, prefix=prefix)
    if source == "all" and teacher is not None:
        return public_bank_q(prefix=prefix) | owned_ready_q(teacher, prefix=prefix)
    return public_bank_q(prefix=prefix)


def generator_bank_queryset(request, source: str | None = None) -> QuerySet:
    return Task.objects.filter(generator_source_q(request, source)).distinct()


def teacher_own_tasks_qs(teacher) -> QuerySet:
    return Task.objects.filter(scope=Task.Scope.TEACHER, owner_teacher=teacher)


def get_owned_task_or_none(teacher, task_id) -> Optional[Task]:
    if teacher is None or task_id is None:
        return None
    try:
        task_id = int(task_id)
    except (TypeError, ValueError):
        return None
    return (
        teacher_own_tasks_qs(teacher)
        .select_related("task", "task__subject", "task__level", "task__part", "subtopic", "owner_teacher")
        .filter(pk=task_id)
        .first()
    )


def find_task_for_public_search(q: str) -> Optional[Task]:
    """Найти задачу по числовому ID или коду банка учителя (ABC12-001)."""
    text = (q or "").strip()
    if not text:
        return None
    qs = Task.objects.select_related("task", "task__subject", "owner_teacher")
    if text.isdigit():
        return qs.filter(id=int(text)).first()
    code, number = parse_task_public_code(text)
    if not code or number is None:
        return None
    bank = TeacherTaskBank.objects.filter(public_code__iexact=code).first()
    if bank is None:
        return None
    return qs.filter(
        scope=Task.Scope.TEACHER,
        owner_teacher_id=bank.teacher_id,
        local_number=number,
    ).first()


def tasks_allowed_in_variant(task_ids, teacher) -> tuple[dict[int, Task], list[int]]:
    """Вернуть map разрешённых задач и список id чужих teacher-задач (IDOR)."""
    ids = []
    for raw in task_ids or []:
        try:
            ids.append(int(raw))
        except (TypeError, ValueError):
            continue
    ids = list(dict.fromkeys(ids))
    if not ids:
        return {}, []
    rows = list(
        Task.objects.filter(id__in=ids, is_active=True).select_related("task", "task__subject", "task__level")
    )
    allowed = {}
    foreign = []
    teacher_id = getattr(teacher, "id", None)
    for task in rows:
        if task.scope == Task.Scope.GLOBAL:
            allowed[task.id] = task
            continue
        if task.scope == Task.Scope.TEACHER and teacher_id and task.owner_teacher_id == teacher_id:
            allowed[task.id] = task
            continue
        if task.scope == Task.Scope.TEACHER:
            foreign.append(task.id)
    return allowed, foreign


def create_variant_for_request(
    *,
    subject,
    level,
    request=None,
    created_by: str | None = None,
    share_token: str | None = None,
    content=None,
) -> Variant:
    teacher = request_teacher(request)
    kwargs = {
        "var_subject": subject,
        "level": level,
        "created_by": created_by or username_for_created_by(request),
    }
    if share_token is not None:
        kwargs["share_token"] = share_token
    if content is not None:
        kwargs["content"] = content
    if teacher is not None:
        local_number, _bank = allocate_variant_number(teacher)
        kwargs["owner_teacher"] = teacher
        kwargs["local_number"] = local_number
    return Variant.objects.create(**kwargs)


def task_usage_counts(task_ids: list[int]) -> dict[int, int]:
    if not task_ids:
        return {}
    rows = (
        VariantContent.objects.filter(task_id__in=task_ids)
        .values("task_id")
        .annotate(c=Count("id"))
    )
    return {row["task_id"]: int(row["c"]) for row in rows}


def homework_usage_count(task) -> int:
    try:
        from Cabinet.models import HomeworkTask
    except Exception:
        return 0
    return HomeworkTask.objects.filter(task_id=str(task.id)).count()


def variant_usage_count(task) -> int:
    return VariantContent.objects.filter(task=task).count()


def task_is_used(task) -> bool:
    return variant_usage_count(task) > 0 or homework_usage_count(task) > 0


def apply_teacher_search(qs: QuerySet, query: str, bank: TeacherTaskBank | None) -> QuerySet:
    text = (query or "").strip()
    if not text:
        return qs
    code, number = parse_task_public_code(text)
    if code and number is not None:
        own_code = (bank.public_code if bank else "").upper()
        if code == own_code:
            return qs.filter(local_number=number)
        return qs.none()
    if text.isdigit():
        n = int(text)
        return qs.filter(Q(local_number=n) | Q(pk=n))
    q = (
        Q(task_template__icontains=text)
        | Q(task__task_title__icontains=text)
        | Q(subtopic__title__icontains=text)
        | Q(tag_options__title__icontains=text)
        | Q(author__icontains=text)
    )
    if text.upper() == (bank.public_code if bank else "").upper():
        return qs
    return qs.filter(q).distinct()


def preview_plain(html: str, limit: int = 180) -> str:
    text = " ".join(strip_tags(html or "").split())
    if len(text) <= limit:
        return text
    return text[: limit - 1].rstrip() + "…"
