"""
SubscriptionAccessService — единая точка проверки доступа по тарифу.

Покрывает: эффективный план, контент, анонимные лимиты вариантов/тетрадей,
лимиты учеников. Не смешивается с биллингом учеников.
"""

from __future__ import annotations

import uuid
from datetime import timedelta
from typing import Any, Optional

from django.conf import settings
from django.contrib.auth.models import User
from django.db import transaction
from django.db.models import F
from django.http import HttpRequest
from django.utils import timezone

from .choices import CONTENT_ACCESS_RANK, ContentAccessLevel, StudentStatus
from .subscription_service import LimitExceeded, SubscriptionLimitService

ANON_COOKIE = "ds_anon_id"
ANON_VARIANTS_LIMIT = getattr(settings, "ANON_VARIANTS_MONTHLY_LIMIT", 5)
ANON_WORKBOOKS_LIMIT = getattr(settings, "ANON_WORKBOOKS_MONTHLY_LIMIT", 3)

PLAN_LADDER = ["start", "teacher", "pro", "premium", "school"]

PLAN_SLUG_TO_RANK = {
    "start": 0,
    "teacher": 1,
    "repetitor": 1,  # legacy alias
    "pro": 2,
    "profi": 2,  # legacy alias
    "premium": 3,
    "school": 4,
}

# access_level → канонический ContentAccessLevel (план-slug и legacy значения).
ACCESS_LEVEL_ALIASES = {
    "paid": ContentAccessLevel.PROFESSIONAL,
    "private": ContentAccessLevel.CORPORATE,
    "pro": ContentAccessLevel.PROFESSIONAL,
    "profi": ContentAccessLevel.PROFESSIONAL,
    "start": ContentAccessLevel.FREE,
    "school": ContentAccessLevel.CORPORATE,
    "repetitor": ContentAccessLevel.TEACHER,
}

RANK_TO_MIN_PLAN = {
    0: "start",
    1: "teacher",
    2: "pro",
    3: "premium",
    4: "school",
}


class AccessDenied(Exception):
    def __init__(
        self,
        code: str,
        message: str,
        *,
        feature: str = "",
        min_plan: str = "",
        limit: int | None = None,
        current: int | None = None,
    ):
        super().__init__(message)
        self.code = code
        self.message = message
        self.feature = feature
        self.min_plan = min_plan
        self.limit = limit
        self.current = current

    def to_dict(self) -> dict:
        payload = {
            "code": self.code,
            "message": self.message,
            "error": self.message,
            "upgrade_required": True,
            "feature": self.feature,
            "min_plan": self.min_plan,
            "recommended_plan": self.min_plan,
        }
        if self.limit is not None:
            payload["limit"] = self.limit
        if self.current is not None:
            payload["current"] = self.current
        return payload


def next_plan_slug(current_slug: str) -> str:
    slug = current_slug or "start"
    if slug == "repetitor":
        slug = "teacher"
    elif slug == "profi":
        slug = "pro"
    try:
        idx = PLAN_LADDER.index(slug)
        return PLAN_LADDER[idx + 1] if idx + 1 < len(PLAN_LADDER) else "school"
    except ValueError:
        return "teacher"


class SubscriptionAccessService:
    """Централизованный доступ по подписке / анонимным лимитам."""

    # ── Plan resolution ──────────────────────────────────────────────────────

    @staticmethod
    def get_start_plan():
        from .models import TariffPlan

        plan = TariffPlan.objects.filter(slug="start", is_active=True).first()
        if plan:
            return plan
        plan, _ = TariffPlan.objects.get_or_create(
            slug="start",
            defaults={"name": "Старт", "price_month": 0, "sort_order": 0, "is_free": True},
        )
        return plan

    @staticmethod
    def get_effective_plan(user: Optional[User] = None):
        """План пользователя или виртуальный start для анонима/без подписки."""
        if user is None or not getattr(user, "is_authenticated", False):
            return SubscriptionAccessService.get_start_plan()
        return SubscriptionLimitService.get_current_plan(user)

    @staticmethod
    def plan_content_rank(plan) -> int:
        """Ранг тарифа для контента. Выше по лестнице всегда включает нижестоящие уровни.

        Берём максимум из поля плана и ранга по slug: если в БД rank занижен,
        slug всё равно даёт доступ ко всему, что открыто более низким тарифам.
        """
        if plan is None:
            return 0
        db_rank = int(getattr(plan, "content_access_rank", 0) or 0)
        slug = (getattr(plan, "slug", "") or "").strip().lower()
        slug_rank = PLAN_SLUG_TO_RANK.get(slug, 0)
        return max(db_rank, slug_rank)

    @staticmethod
    def get_content_rank_for_user(user: Optional[User] = None) -> int:
        plan = SubscriptionAccessService.get_effective_plan(user)
        return SubscriptionAccessService.plan_content_rank(plan)

    @staticmethod
    def content_level_rank(access_level: str) -> int:
        level = (access_level or ContentAccessLevel.FREE).strip().lower()
        level = ACCESS_LEVEL_ALIASES.get(level, level)
        if level in CONTENT_ACCESS_RANK:
            return CONTENT_ACCESS_RANK[level]
        return PLAN_SLUG_TO_RANK.get(level, 0)

    @staticmethod
    def can_use_schedule(user) -> bool:
        """Расписание и видеозанятия через него — с тарифа «Учитель»."""
        plan = SubscriptionAccessService.get_effective_plan(user)
        if not plan:
            return False
        if getattr(plan, "is_free", False) or plan.slug == "start":
            return False
        return True

    @staticmethod
    def raise_if_cannot_use_schedule(user):
        if SubscriptionAccessService.can_use_schedule(user):
            return
        raise AccessDenied(
            code="SCHEDULE_REQUIRES_PAID_PLAN",
            message="Расписание доступно начиная с тарифа «Учитель».",
            feature="schedule",
            min_plan="teacher",
        )

    @staticmethod
    def can_use_student_booking(user) -> bool:
        """Самостоятельная запись учеников по ссылке — с тарифа «Учитель» и выше."""
        plan = SubscriptionAccessService.get_effective_plan(user)
        if not plan:
            return False
        return SubscriptionAccessService.plan_content_rank(plan) >= PLAN_SLUG_TO_RANK["teacher"]

    @staticmethod
    def raise_if_cannot_use_student_booking(user):
        if SubscriptionAccessService.can_use_student_booking(user):
            return
        raise AccessDenied(
            code="BOOKING_REQUIRES_TEACHER_PLAN",
            message="Запись учеников по ссылке доступна начиная с тарифа «Учитель».",
            feature="student_booking",
            min_plan="teacher",
        )

    # ── Content access ───────────────────────────────────────────────────────

    @staticmethod
    def is_student_user(user: Optional[User]) -> bool:
        if user is None or not getattr(user, "is_authenticated", False):
            return False
        from .models import Profile

        profile = getattr(user, "profile", None)
        return bool(profile is not None and profile.role == Profile.Role.STUDENT)

    @staticmethod
    def can_access_content(user: Optional[User], content) -> bool:
        from Generator.models import Lesson as GeneratorLesson
        from .models import Material

        if isinstance(content, GeneratorLesson):
            from .lesson_access import LessonAccessService

            return LessonAccessService.has_full_access(user, content)
        if isinstance(content, Material):
            if SubscriptionAccessService.is_student_user(user):
                return False
            if not user or not getattr(user, "is_authenticated", False):
                return False
        else:
            from .student_content_access import (
                is_real_linked_student,
                student_can_access_catalog_interesting,
            )

            if is_real_linked_student(user) and student_can_access_catalog_interesting(user, content):
                return True
            if SubscriptionAccessService.is_student_user(user):
                return False
        level = getattr(content, "access_level", ContentAccessLevel.FREE) or ContentAccessLevel.FREE
        required = SubscriptionAccessService.content_level_rank(level)
        if required <= 0:
            return bool(user and getattr(user, "is_authenticated", False)) if isinstance(content, Material) else True
        if user and getattr(user, "is_authenticated", False):
            teacher_id = getattr(content, "teacher_id", None)
            owner_id = getattr(content, "owner_id", None)
            if teacher_id == user.pk or owner_id == user.pk:
                return True
            if user.is_staff or user.is_superuser:
                return True
        return SubscriptionAccessService.get_content_rank_for_user(user) >= required

    @staticmethod
    def get_minimum_plan_for_content(content) -> str:
        level = getattr(content, "access_level", ContentAccessLevel.FREE) or ContentAccessLevel.FREE
        rank = SubscriptionAccessService.content_level_rank(level)
        return RANK_TO_MIN_PLAN.get(rank, "start")

    @staticmethod
    def raise_if_cannot_access_content(user: Optional[User], content):
        if SubscriptionAccessService.can_access_content(user, content):
            return
        min_plan = SubscriptionAccessService.get_minimum_plan_for_content(content)
        raise AccessDenied(
            code="CONTENT_ACCESS_DENIED",
            message="Материал доступен на более высоком тарифе",
            feature="content",
            min_plan=min_plan,
        )

    # ── Anonymous cookie helpers ─────────────────────────────────────────────

    @staticmethod
    def get_or_create_anonymous_id(request: HttpRequest) -> uuid.UUID:
        cached = getattr(request, "_ds_anon_id", None)
        if cached:
            return cached
        raw = request.COOKIES.get(ANON_COOKIE) or request.META.get("HTTP_X_ANON_ID")
        if raw:
            try:
                anon_id = uuid.UUID(str(raw))
                request._ds_anon_id = anon_id
                return anon_id
            except (ValueError, TypeError, AttributeError):
                pass
        anon_id = uuid.uuid4()
        request._ds_anon_id = anon_id
        return anon_id

    @staticmethod
    def set_anonymous_cookie(response, anon_id: uuid.UUID):
        response.set_cookie(
            ANON_COOKIE,
            str(anon_id),
            max_age=60 * 60 * 24 * 365 * 2,
            httponly=True,
            secure=not settings.DEBUG,
            samesite="Lax",
            path="/",
        )
        return response

    @staticmethod
    def get_or_create_anonymous_usage(request: HttpRequest):
        from .models import AnonymousUsage

        anon_id = SubscriptionAccessService.get_or_create_anonymous_id(request)
        session_key = ""
        if hasattr(request, "session"):
            try:
                session_key = request.session.session_key or ""
            except Exception:
                session_key = ""
        usage, _ = AnonymousUsage.objects.get_or_create(
            anonymous_id=anon_id,
            defaults={"session_key": session_key},
        )
        if session_key and usage.session_key != session_key:
            usage.session_key = session_key
            usage.save(update_fields=["session_key", "last_seen_at"])
        return usage

    @staticmethod
    def link_anonymous_to_user(request: HttpRequest, user: User):
        if not user or not getattr(user, "is_authenticated", False):
            return
        usage = SubscriptionAccessService.get_or_create_anonymous_usage(request)
        if usage.registered_user_id != user.pk:
            usage.registered_user = user
            usage.save(update_fields=["registered_user", "last_seen_at"])

    # ── Variants / workbooks ─────────────────────────────────────────────────

    @staticmethod
    def get_teacher_monthly_usage(teacher: User):
        from .models import TeacherMonthlyUsage

        period_start, period_end = SubscriptionLimitService.get_current_period()
        usage, _ = TeacherMonthlyUsage.objects.get_or_create(
            teacher=teacher,
            period_start=period_start,
            defaults={"period_end": period_end},
        )
        return usage

    @staticmethod
    def can_create_variant(request: HttpRequest) -> bool:
        user = getattr(request, "user", None)
        if user and getattr(user, "is_authenticated", False):
            from .tariff_usage import TariffUsageService

            return TariffUsageService.is_within_limit(user, "variant_generations")
        usage = SubscriptionAccessService.get_or_create_anonymous_usage(request)
        return usage.variants_created < ANON_VARIANTS_LIMIT

    @staticmethod
    def can_create_workbook(request: HttpRequest) -> bool:
        user = getattr(request, "user", None)
        if user and getattr(user, "is_authenticated", False):
            from .tariff_usage import TariffUsageService

            return TariffUsageService.is_within_limit(user, "workbooks")
        usage = SubscriptionAccessService.get_or_create_anonymous_usage(request)
        return usage.workbooks_created < ANON_WORKBOOKS_LIMIT

    @staticmethod
    @transaction.atomic
    def enforce_variant_creation(request: HttpRequest):
        user = getattr(request, "user", None)
        if user and getattr(user, "is_authenticated", False):
            plan = SubscriptionAccessService.get_effective_plan(user)
            limit = plan.max_variants_monthly
            usage = SubscriptionAccessService.get_teacher_monthly_usage(user)
            usage = type(usage).objects.select_for_update().get(pk=usage.pk)
            if limit is not None and usage.variants_created >= limit:
                raise AccessDenied(
                    code="VARIANT_LIMIT_REACHED",
                    message="Лимит генерации вариантов исчерпан",
                    feature="variants",
                    min_plan=next_plan_slug(plan.slug),
                    limit=limit,
                    current=usage.variants_created,
                )
            type(usage).objects.filter(pk=usage.pk).update(
                variants_created=F("variants_created") + 1,
                updated_at=timezone.now(),
            )
            usage.refresh_from_db()
            return usage

        usage = SubscriptionAccessService.get_or_create_anonymous_usage(request)
        from .models import AnonymousUsage

        usage = AnonymousUsage.objects.select_for_update().get(pk=usage.pk)
        if usage.variants_created >= ANON_VARIANTS_LIMIT:
            raise AccessDenied(
                code="ANON_VARIANT_LIMIT_REACHED",
                message="Лимит вариантов без регистрации исчерпан. Зарегистрируйтесь или выберите тариф.",
                feature="variants",
                min_plan="start",
                limit=ANON_VARIANTS_LIMIT,
                current=usage.variants_created,
            )
        AnonymousUsage.objects.filter(pk=usage.pk).update(
            variants_created=F("variants_created") + 1,
            last_seen_at=timezone.now(),
        )
        usage.refresh_from_db()
        return usage

    @staticmethod
    @transaction.atomic
    def enforce_workbook_creation(request: HttpRequest):
        user = getattr(request, "user", None)
        if user and getattr(user, "is_authenticated", False):
            plan = SubscriptionAccessService.get_effective_plan(user)
            limit = plan.max_workbooks_monthly
            usage = SubscriptionAccessService.get_teacher_monthly_usage(user)
            usage = type(usage).objects.select_for_update().get(pk=usage.pk)
            if limit is not None and usage.workbooks_created >= limit:
                raise AccessDenied(
                    code="WORKBOOK_LIMIT_REACHED",
                    message="Лимит рабочих тетрадей исчерпан",
                    feature="workbooks",
                    min_plan=next_plan_slug(plan.slug),
                    limit=limit,
                    current=usage.workbooks_created,
                )
            type(usage).objects.filter(pk=usage.pk).update(
                workbooks_created=F("workbooks_created") + 1,
                updated_at=timezone.now(),
            )
            usage.refresh_from_db()
            return usage

        usage = SubscriptionAccessService.get_or_create_anonymous_usage(request)
        from .models import AnonymousUsage

        usage = AnonymousUsage.objects.select_for_update().get(pk=usage.pk)
        if usage.workbooks_created >= ANON_WORKBOOKS_LIMIT:
            raise AccessDenied(
                code="ANON_WORKBOOK_LIMIT_REACHED",
                message="Лимит тетрадей без регистрации исчерпан. Зарегистрируйтесь или выберите тариф.",
                feature="workbooks",
                min_plan="start",
                limit=ANON_WORKBOOKS_LIMIT,
                current=usage.workbooks_created,
            )
        AnonymousUsage.objects.filter(pk=usage.pk).update(
            workbooks_created=F("workbooks_created") + 1,
            last_seen_at=timezone.now(),
        )
        usage.refresh_from_db()
        return usage

    # ── Students ─────────────────────────────────────────────────────────────

    @staticmethod
    def can_add_student(user: User) -> bool:
        return SubscriptionLimitService.can_create_student(user)

    @staticmethod
    def raise_if_cannot_add_student(user: User):
        try:
            SubscriptionLimitService.raise_if_student_limit_reached(user)
        except LimitExceeded as exc:
            raise AccessDenied(
                code=exc.code,
                message=exc.message,
                feature="students",
                min_plan=exc.recommended_plan or next_plan_slug(
                    SubscriptionAccessService.get_effective_plan(user).slug
                ),
                limit=exc.limit,
                current=exc.current,
            ) from exc

    # ── Library «new this month» ─────────────────────────────────────────────

    @staticmethod
    def new_this_month_queryset(model, user: Optional[User] = None):
        """Материалы, помеченные новинками или опубликованные в текущем месяце."""
        from datetime import datetime

        from django.db.models import Q
        from django.utils.timezone import make_aware

        now = timezone.now()
        period_start, _ = SubscriptionLimitService.get_current_period()
        month_start = make_aware(datetime.combine(period_start, datetime.min.time()))
        return model.objects.filter(
            Q(is_new=True, new_until__gte=now)
            | Q(is_new=True, new_until__isnull=True)
            | Q(published_at__gte=month_start)
        ).order_by("-published_at", "-created_at")

    @staticmethod
    def serialize_access_gate(user: Optional[User], content) -> dict[str, Any]:
        from Generator.models import Lesson as GeneratorLesson

        if isinstance(content, GeneratorLesson):
            from .lesson_access import LessonAccessService

            result = LessonAccessService.get_access(user, content)
            return {
                "allowed": result.is_full,
                "access_level": getattr(content, "access_level", "free"),
                "min_plan": result.required_plan,
                **result.to_dict(),
            }
        allowed = SubscriptionAccessService.can_access_content(user, content)
        payload = {
            "allowed": allowed,
            "can_view": allowed,
            "access_level": getattr(content, "access_level", "free"),
            "min_plan": SubscriptionAccessService.get_minimum_plan_for_content(content),
        }
        return payload


def cleanup_stale_anonymous_usage(*, days: int = 180) -> int:
    from .models import AnonymousUsage

    cutoff = timezone.now() - timedelta(days=days)
    deleted, _ = AnonymousUsage.objects.filter(
        last_seen_at__lt=cutoff,
        registered_user__isnull=True,
    ).delete()
    return deleted
