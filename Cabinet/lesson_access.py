"""
LessonAccessService — единая политика доступа к готовым урокам Generator.Lesson.

Тариф отвечает: какие категории возможностей доступны сейчас.
Entitlement отвечает: имеет ли пользователь право на конкретный готовый урок.

Приоритет:
  1. отдельная покупка
  2. подходящий тариф (включая FREE + зарегистрированный Старт+)
  3. активная demo-session
  4. возможность начать demo
  5. нет доступа

Аноним никогда не получает полный урок, даже если он бесплатный.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import timedelta
from decimal import Decimal
from typing import Any, Iterable, Optional

from django.db import IntegrityError, transaction
from django.utils import timezone

from .choices import CONTENT_ACCESS_RANK, ContentAccessLevel, MaterialDemoMode
from .subscription_access import (
    RANK_TO_MIN_PLAN,
    AccessDenied,
    SubscriptionAccessService,
)

logger = logging.getLogger(__name__)

ACCESS_PURCHASED = "purchased"
ACCESS_SUBSCRIPTION = "subscription"
ACCESS_FREE_START = "free_start"
ACCESS_STUDENT = "student"
ACCESS_OWNER = "owner"
ACCESS_DEMO = "demo"
ACCESS_LOCKED = "locked"

DEFAULT_DEMO_MINUTES = 40
DEFAULT_DEMO_PAGE_COUNT = 3
DEMO_CONTINUATION_MESSAGE = "Продолжение доступно в полной версии."

PLAN_DISPLAY_NAMES = {
    "start": "Старт",
    "teacher": "Учитель",
    "repetitor": "Учитель",
    "pro": "Профи",
    "profi": "Профи",
    "premium": "Премиум",
    "school": "Школа",
}

LESSON_PREVIEW_VIEWED = "lesson_preview_viewed"
LESSON_PAYWALL_VIEWED = "lesson_paywall_viewed"
LESSON_REGISTRATION_REQUIRED = "lesson_registration_required"
LESSON_DEMO_WARNING_VIEWED = "lesson_demo_warning_viewed"
LESSON_DEMO_STARTED = "lesson_demo_started"
LESSON_DEMO_FINISHED = "lesson_demo_finished"
LESSON_DEMO_EXPIRED = "lesson_demo_expired"
LESSON_DEMO_REOPEN_DENIED = "lesson_demo_reopen_denied"
LESSON_PURCHASE_STARTED = "lesson_purchase_started"
LESSON_PURCHASE_COMPLETED = "lesson_purchase_completed"
LESSON_OPENED_SUBSCRIPTION = "lesson_opened_subscription"
LESSON_OPENED_PURCHASE = "lesson_opened_purchase"
LESSON_OPENED_FREE = "lesson_opened_free"
LESSON_OPENED_DEMO = "lesson_opened_demo"

LESSON_EVENT_NAMES = (
    LESSON_PREVIEW_VIEWED,
    LESSON_PAYWALL_VIEWED,
    LESSON_REGISTRATION_REQUIRED,
    LESSON_DEMO_WARNING_VIEWED,
    LESSON_DEMO_STARTED,
    LESSON_DEMO_FINISHED,
    LESSON_DEMO_EXPIRED,
    LESSON_DEMO_REOPEN_DENIED,
    LESSON_PURCHASE_STARTED,
    LESSON_PURCHASE_COMPLETED,
    LESSON_OPENED_SUBSCRIPTION,
    LESSON_OPENED_PURCHASE,
    LESSON_OPENED_FREE,
    LESSON_OPENED_DEMO,
)


def is_lesson_payment(payment) -> bool:
    if getattr(payment, "purpose", "") == "lesson":
        return True
    meta = payment.metadata if isinstance(getattr(payment, "metadata", None), dict) else {}
    return meta.get("purpose") == "lesson"


def plan_display_name(slug: str) -> str:
    slug = (slug or "start").strip().lower()
    return PLAN_DISPLAY_NAMES.get(slug, slug or "Старт")


def _money(value) -> float | None:
    if value is None:
        return None
    try:
        number = Decimal(str(value))
    except Exception:
        return None
    if number == number.to_integral_value():
        return int(number)
    return float(number)


@dataclass
class LessonAccessResult:
    access_type: str = ACCESS_LOCKED
    can_view: bool = False
    can_download: bool = False
    can_save: bool = False
    can_attach: bool = False
    can_assign: bool = False
    can_export: bool = False
    can_purchase: bool = False
    demo_available: bool = False
    demo_used: bool = False
    demo_active: bool = False
    demo_expires_at: Any = None
    demo_mode: str = MaterialDemoMode.FULL_WATERMARKED
    demo_duration_minutes: int = DEFAULT_DEMO_MINUTES
    demo_remaining_seconds: int | None = None
    required_plan: str = "start"
    required_plan_name: str = "Старт"
    standalone_purchase_available: bool = False
    standalone_price: float | None = None
    standalone_currency: str = "RUB"
    message: str = ""
    reason_code: str = ""
    cta: list[dict] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        payload = {
            "can_view": self.can_view,
            "can_open": self.can_view,
            "can_download": self.can_download,
            "can_save": self.can_save,
            "can_attach": self.can_attach,
            "can_assign": self.can_assign,
            "can_export": self.can_export,
            "can_purchase": self.can_purchase,
            "can_start_demo": self.demo_available,
            "can_continue_demo": self.demo_active,
            "access_type": self.access_type,
            "content_mode": self.content_mode,
            "required_plan": self.required_plan,
            "required_plan_name": self.required_plan_name,
            "standalone_purchase_available": self.standalone_purchase_available,
            "standalone_price": self.standalone_price,
            "standalone_currency": self.standalone_currency,
            "demo_available": self.demo_available,
            "demo_used": self.demo_used,
            "demo_active": self.demo_active,
            "demo_expires_at": (
                self.demo_expires_at.isoformat() if self.demo_expires_at else None
            ),
            "demo_mode": self.demo_mode,
            "demo_duration_minutes": self.demo_duration_minutes,
            "demo_remaining_seconds": self.demo_remaining_seconds,
            "purchase_available": self.can_purchase,
            "message": self.message,
            "reason_code": self.reason_code,
            "cta": self.cta,
        }
        return payload

    @property
    def is_full(self) -> bool:
        return self.access_type in (
            ACCESS_PURCHASED,
            ACCESS_SUBSCRIPTION,
            ACCESS_FREE_START,
            ACCESS_STUDENT,
            ACCESS_OWNER,
        )

    @property
    def content_mode(self) -> str:
        if self.is_full:
            return "full"
        if self.demo_active:
            return "demo"
        return "denied"

    @property
    def should_apply_viewer_watermark(self) -> bool:
        """Purchased/owner views are clean; tariff/demo use overlays elsewhere."""
        if not self.is_full or self.demo_active:
            return False
        return self.access_type not in (ACCESS_PURCHASED, ACCESS_OWNER)


class LessonAccessService:
    """Единая точка проверки entitlement к Generator.Lesson."""

    @staticmethod
    def is_authenticated(user) -> bool:
        return bool(user is not None and getattr(user, "is_authenticated", False))

    @staticmethod
    def is_staff(user) -> bool:
        return bool(
            LessonAccessService.is_authenticated(user)
            and (getattr(user, "is_staff", False) or getattr(user, "is_superuser", False))
        )

    @staticmethod
    def is_owner(user, lesson) -> bool:
        if not LessonAccessService.is_authenticated(user) or lesson is None:
            return False
        if LessonAccessService.is_staff(user):
            return True
        return user.pk in (
            getattr(lesson, "teacher_id", None),
            getattr(lesson, "owner_id", None),
        )

    @staticmethod
    def is_free_lesson(lesson) -> bool:
        level = getattr(lesson, "access_level", None) or ContentAccessLevel.FREE
        return SubscriptionAccessService.content_level_rank(level) <= 0

    @staticmethod
    def required_plan_slug(lesson) -> str:
        return SubscriptionAccessService.get_minimum_plan_for_content(lesson)

    @staticmethod
    def subscription_covers(user, lesson) -> bool:
        if not LessonAccessService.is_authenticated(user):
            return False
        if SubscriptionAccessService.is_student_user(user):
            return False
        required = SubscriptionAccessService.content_level_rank(
            getattr(lesson, "access_level", ContentAccessLevel.FREE)
        )
        if required <= 0:
            return True
        return SubscriptionAccessService.get_content_rank_for_user(user) >= required

    @staticmethod
    def _purchase_qs(user, lesson=None):
        from .models import LessonPurchase

        qs = LessonPurchase.objects.filter(user=user, status=LessonPurchase.Status.PAID)
        if lesson is not None:
            qs = qs.filter(lesson=lesson)
        return qs

    @staticmethod
    def has_purchase(user, lesson) -> bool:
        if not LessonAccessService.is_authenticated(user) or lesson is None:
            return False
        purchase = LessonAccessService._purchase_qs(user, lesson).first()
        return bool(purchase and purchase.is_active())

    @staticmethod
    def get_demo_row(user, lesson):
        if not LessonAccessService.is_authenticated(user) or lesson is None:
            return None
        from .models import LessonDemoAccess

        return LessonDemoAccess.objects.filter(user=user, lesson=lesson).first()

    @staticmethod
    def _standalone_enabled(lesson) -> bool:
        if not getattr(lesson, "standalone_purchase_enabled", False):
            return False
        price = getattr(lesson, "standalone_price", None)
        return price is not None and Decimal(str(price)) > 0

    @staticmethod
    def _demo_enabled(lesson) -> bool:
        if LessonAccessService.is_free_lesson(lesson):
            return False
        return bool(getattr(lesson, "demo_enabled", False))

    @classmethod
    def get_access(cls, user, lesson, *, _demo=None, _purchased: bool | None = None) -> LessonAccessResult:
        required = cls.required_plan_slug(lesson)
        result = LessonAccessResult(
            required_plan=required,
            required_plan_name=plan_display_name(required),
            standalone_purchase_available=cls._standalone_enabled(lesson),
            standalone_price=_money(getattr(lesson, "standalone_price", None))
            if cls._standalone_enabled(lesson)
            else None,
            standalone_currency=getattr(lesson, "standalone_currency", None) or "RUB",
            demo_mode=getattr(lesson, "demo_mode", None) or MaterialDemoMode.FULL_WATERMARKED,
            demo_duration_minutes=DEFAULT_DEMO_MINUTES,
        )

        if lesson is None:
            result.message = "Урок не найден."
            result.reason_code = "NOT_FOUND"
            return result

        if cls.is_owner(user, lesson):
            return cls._full(result, ACCESS_OWNER)

        from .student_content_access import student_can_access_catalog_lesson

        if student_can_access_catalog_lesson(user, lesson):
            return cls._student_full(result)

        purchased = _purchased if _purchased is not None else cls.has_purchase(user, lesson)
        if purchased:
            return cls._full(result, ACCESS_PURCHASED)

        if cls.subscription_covers(user, lesson):
            access_type = ACCESS_FREE_START if cls.is_free_lesson(lesson) else ACCESS_SUBSCRIPTION
            return cls._full(result, access_type)

        demo = _demo if _demo is not None else cls.get_demo_row(user, lesson)
        if demo is not None:
            result.demo_used = True
            if demo.is_session_active():
                result.access_type = ACCESS_DEMO
                result.can_view = True
                result.demo_active = True
                result.demo_expires_at = demo.expires_at
                remaining = int((demo.expires_at - timezone.now()).total_seconds())
                result.demo_remaining_seconds = max(0, remaining)
                result.reason_code = "DEMO_SESSION"
                result.message = (
                    "Демоверсия активна. Можно продолжить просмотр до окончания таймера."
                )
                result.can_purchase = (
                    cls.is_authenticated(user)
                    and result.standalone_purchase_available
                )
                result.cta = cls._demo_active_cta(result)
                return result

        result.demo_used = bool(demo)
        result.demo_available = (
            cls.is_authenticated(user)
            and cls._demo_enabled(lesson)
            and not result.demo_used
        )
        result.can_purchase = (
            cls.is_authenticated(user)
            and result.standalone_purchase_available
        )
        result.access_type = ACCESS_LOCKED
        result.cta = cls._locked_cta(user, lesson, result)
        result.message, result.reason_code = cls._locked_copy(user, lesson, result)
        return result

    @classmethod
    def _full(cls, result: LessonAccessResult, access_type: str) -> LessonAccessResult:
        result.access_type = access_type
        result.can_view = True
        result.can_download = True
        result.can_save = True
        result.can_attach = True
        result.can_assign = True
        result.can_export = True
        result.can_purchase = False
        result.demo_available = False
        result.demo_used = False
        result.demo_active = False
        result.message = ""
        result.reason_code = ""
        result.cta = [{"type": "open", "label": "Открыть", "primary": True}]
        return result

    @classmethod
    def _student_full(cls, result: LessonAccessResult) -> LessonAccessResult:
        """Полный просмотр для привязанного ученика; без скачивания/выдачи оригинала."""
        result.access_type = ACCESS_STUDENT
        result.can_view = True
        result.can_download = False
        result.can_save = False
        result.can_attach = False
        result.can_assign = False
        result.can_export = False
        result.can_purchase = False
        result.demo_available = False
        result.demo_used = False
        result.demo_active = False
        result.message = ""
        result.reason_code = ""
        result.cta = [{"type": "open", "label": "Открыть урок", "primary": True}]
        return result

    @classmethod
    def _locked_copy(cls, user, lesson, result: LessonAccessResult) -> tuple[str, str]:
        if not cls.is_authenticated(user):
            if cls.is_free_lesson(lesson):
                return (
                    "Этот урок доступен бесплатно после регистрации.",
                    "REGISTRATION_REQUIRED",
                )
            if cls._demo_enabled(lesson):
                return (
                    "Создайте аккаунт, чтобы открыть этот урок. Он сохранится в вашем кабинете.",
                    "REGISTRATION_REQUIRED",
                )
            return (
                "Создайте аккаунт, чтобы открыть этот урок. Он сохранится в вашем кабинете.",
                "REGISTRATION_REQUIRED",
            )
        if result.demo_used and not result.demo_active:
            return (
                "Демоверсия этого урока уже была использована.",
                "DEMO_EXPIRED",
            )
        plan_name = result.required_plan_name
        if result.standalone_purchase_available and result.standalone_price is not None:
            price = cls.format_price(result.standalone_price, result.standalone_currency)
            if not cls.is_free_lesson(lesson) and result.required_plan != "start":
                return (
                    f"Этот урок доступен на тарифе «{plan_name}» или отдельно за {price}.",
                    "PLAN_OR_PURCHASE",
                )
            return (
                f"Этот урок можно купить отдельно за {price}.",
                "PURCHASE_REQUIRED",
            )
        if not cls.is_free_lesson(lesson):
            return (
                f"Этот урок доступен на тарифе «{plan_name}».",
                "INSUFFICIENT_PLAN",
            )
        return ("Урок недоступен.", "LOCKED")

    @classmethod
    def _locked_cta(cls, user, lesson, result: LessonAccessResult, *, demo_active: bool = False) -> list[dict]:
        actions: list[dict] = []
        if not cls.is_authenticated(user):
            actions.append({
                "type": "register",
                "label": "Создать аккаунт и открыть урок",
                "primary": True,
            })
            if cls._demo_enabled(lesson):
                actions.append({
                    "type": "demo",
                    "label": "Открыть урок",
                    "primary": False,
                })
            return actions
        if demo_active:
            return cls._demo_active_cta(result)
        if result.demo_available:
            actions.append({"type": "demo", "label": "Открыть урок", "primary": True})
        if result.can_purchase and result.standalone_price is not None:
            price = cls.format_price(result.standalone_price, result.standalone_currency)
            actions.append({
                "type": "purchase",
                "label": f"Купить за {price}",
                "primary": not result.demo_available,
            })
        if not cls.is_free_lesson(lesson) and result.required_plan not in ("", "start"):
            actions.append({
                "type": "upgrade",
                "label": f"Получить в «{result.required_plan_name}»",
                "primary": not actions,
            })
        return actions

    @classmethod
    def _demo_active_cta(cls, result: LessonAccessResult) -> list[dict]:
        actions: list[dict] = [
            {"type": "demo", "label": "Продолжить урок", "primary": False},
        ]
        if result.can_purchase and result.standalone_price is not None:
            price = cls.format_price(result.standalone_price, result.standalone_currency)
            actions.append({
                "type": "purchase",
                "label": f"Купить за {price}",
                "primary": True,
            })
        else:
            actions[0]["primary"] = True
        return actions

    @staticmethod
    def format_price(amount, currency: str = "RUB") -> str:
        if amount is None:
            return ""
        try:
            number = Decimal(str(amount))
        except Exception:
            return str(amount)
        if number == number.to_integral_value():
            formatted = f"{int(number):,}".replace(",", " ")
        else:
            formatted = f"{number:.2f}".replace(".", ",")
        if (currency or "RUB").upper() == "RUB":
            return f"{formatted} ₽"
        return f"{formatted} {currency}"

    @classmethod
    def is_partial_demo(cls, lesson) -> bool:
        mode = getattr(lesson, "demo_mode", None) or MaterialDemoMode.FULL_WATERMARKED
        return mode == MaterialDemoMode.PARTIAL

    @classmethod
    def demo_page_limit(cls, lesson) -> int:
        try:
            count = int(getattr(lesson, "demo_page_count", 0) or DEFAULT_DEMO_PAGE_COUNT)
        except (TypeError, ValueError):
            count = DEFAULT_DEMO_PAGE_COUNT
        return max(1, min(count, 20))

    @classmethod
    def demo_visible_content(cls, lesson) -> str:
        """HTML/текст, который можно показать в DEMO. Оригинальные file URL вырезаются."""
        fragment = (getattr(lesson, "demo_fragment", None) or "").strip()
        full = getattr(lesson, "content", None) or ""
        if cls.is_partial_demo(lesson):
            text = fragment or (full[:1200] if full else "")
            return cls._strip_original_asset_urls(text)
        return cls._strip_original_asset_urls(full)

    @staticmethod
    def _strip_original_asset_urls(html: str) -> str:
        if not html:
            return ""
        import re

        html = re.sub(r"/media/cabinet/materials/[^\"'\\s>]+", "", html)
        html = re.sub(r"/media/lessons/files/[^\"'\\s>]+", "", html)
        html = re.sub(r"/media/lessons/archives/[^\"'\\s>]+", "", html)
        html = re.sub(r"/api/cabinet/materials/\d+/(file|preview)/?", "", html)
        return html

    @classmethod
    def can_view(cls, user, lesson) -> bool:
        return cls.get_access(user, lesson).can_view

    @classmethod
    def can_download(cls, user, lesson) -> bool:
        return cls.get_access(user, lesson).can_download

    @classmethod
    def can_preview_demo(cls, user, lesson) -> bool:
        access = cls.get_access(user, lesson)
        return bool(access.demo_available or access.demo_active)

    @classmethod
    def can_purchase(cls, user, lesson) -> bool:
        return cls.get_access(user, lesson).can_purchase

    @classmethod
    def has_full_access(cls, user, lesson) -> bool:
        return cls.get_access(user, lesson).is_full

    @classmethod
    def raise_if_cannot_view(cls, user, lesson):
        access = cls.get_access(user, lesson)
        if access.can_view:
            return access
        raise cls._denied(access)

    @classmethod
    def raise_if_cannot_download(cls, user, lesson):
        access = cls.get_access(user, lesson)
        if access.can_download:
            return access
        if access.demo_active:
            raise AccessDenied(
                code="DEMO_DOWNLOAD_FORBIDDEN",
                message="Скачивание оригинала в демоверсии недоступно.",
                feature="content",
                min_plan=access.required_plan,
            )
        raise cls._denied(access)

    @classmethod
    def raise_if_cannot_reuse(cls, user, lesson):
        """Save / attach / assign / export — только полный доступ."""
        access = cls.get_access(user, lesson)
        if access.can_save and access.can_attach:
            return access
        if access.demo_active or access.access_type == ACCESS_DEMO:
            raise AccessDenied(
                code="DEMO_REUSE_FORBIDDEN",
                message="Демоверсию нельзя сохранять, копировать или выдавать ученикам.",
                feature="content",
                min_plan=access.required_plan,
            )
        raise cls._denied(access)

    @staticmethod
    def _denied(access: LessonAccessResult) -> AccessDenied:
        return AccessDenied(
            code=access.reason_code or "CONTENT_ACCESS_DENIED",
            message=access.message or "Урок недоступен",
            feature="content",
            min_plan=access.required_plan,
        )

    @classmethod
    def start_demo(cls, user, lesson, *, terms_accepted: bool = False):
        from .models import LessonDemoAccess

        if not cls.is_authenticated(user):
            raise AccessDenied(
                code="REGISTRATION_REQUIRED",
                message="Создайте аккаунт, чтобы открыть этот урок. Он сохранится в вашем кабинете.",
                feature="content",
                min_plan="start",
            )
        if not terms_accepted:
            raise AccessDenied(
                code="DEMO_TERMS_REQUIRED",
                message="Чтобы открыть демоверсию, подтвердите условия использования.",
                feature="content",
                min_plan=cls.required_plan_slug(lesson),
            )
        if not cls._demo_enabled(lesson):
            raise AccessDenied(
                code="DEMO_DISABLED",
                message="Демоверсия этого урока недоступна.",
                feature="content",
                min_plan=cls.required_plan_slug(lesson),
            )

        with transaction.atomic():
            existing = (
                LessonDemoAccess.objects.select_for_update()
                .filter(user=user, lesson=lesson)
                .first()
            )
            if existing is not None:
                if existing.is_session_active():
                    return existing
                cls._record(
                    LESSON_DEMO_REOPEN_DENIED,
                    user,
                    lesson,
                    extra={"access_type": ACCESS_LOCKED},
                )
                raise AccessDenied(
                    code="DEMO_ALREADY_USED",
                    message="Вы уже использовали демоверсию этого урока.",
                    feature="content",
                    min_plan=cls.required_plan_slug(lesson),
                )

            access = cls.get_access(user, lesson)
            if access.is_full:
                raise AccessDenied(
                    code="DEMO_NOT_NEEDED",
                    message="У вас уже есть полный доступ к уроку.",
                    feature="content",
                    min_plan=access.required_plan,
                )
            if not access.demo_available:
                raise cls._denied(access)

            now = timezone.now()
            minutes = DEFAULT_DEMO_MINUTES
            try:
                demo = LessonDemoAccess.objects.create(
                    user=user,
                    lesson=lesson,
                    opened_at=now,
                    expires_at=now + timedelta(minutes=minutes),
                    terms_accepted_at=now,
                )
            except IntegrityError:
                existing = LessonDemoAccess.objects.filter(user=user, lesson=lesson).first()
                if existing and existing.is_session_active():
                    return existing
                raise AccessDenied(
                    code="DEMO_ALREADY_USED",
                    message="Вы уже использовали демоверсию этого урока.",
                    feature="content",
                    min_plan=cls.required_plan_slug(lesson),
                ) from None

        cls._record(
            LESSON_DEMO_STARTED,
            user,
            lesson,
            extra={"access_type": ACCESS_DEMO},
        )
        return demo

    @classmethod
    def record_opened(cls, user, lesson, access: LessonAccessResult):
        if not access.can_view:
            cls._record(
                LESSON_PREVIEW_VIEWED,
                user,
                lesson,
                extra={"access_type": access.access_type},
            )
            if access.reason_code == "REGISTRATION_REQUIRED":
                cls._record(
                    LESSON_REGISTRATION_REQUIRED,
                    user,
                    lesson,
                    extra={"access_type": access.access_type},
                )
            elif access.reason_code == "DEMO_EXPIRED":
                cls._record(
                    LESSON_DEMO_EXPIRED,
                    user,
                    lesson,
                    extra={"access_type": access.access_type},
                )
            elif access.access_type == ACCESS_LOCKED:
                cls._record(
                    LESSON_PAYWALL_VIEWED,
                    user,
                    lesson,
                    extra={"access_type": access.access_type},
                )
            return
        if access.access_type == ACCESS_DEMO:
            cls._record(
                LESSON_OPENED_DEMO,
                user,
                lesson,
                extra={"access_type": ACCESS_DEMO},
            )
            return
        event = {
            ACCESS_PURCHASED: LESSON_OPENED_PURCHASE,
            ACCESS_SUBSCRIPTION: LESSON_OPENED_SUBSCRIPTION,
            ACCESS_OWNER: LESSON_OPENED_SUBSCRIPTION,
            ACCESS_FREE_START: LESSON_OPENED_FREE,
        }.get(access.access_type)
        if event:
            cls._record(event, user, lesson, extra={"access_type": access.access_type})

    @staticmethod
    def _record(event_name: str, user, lesson, extra: dict | None = None):
        if user is None or not getattr(user, "is_authenticated", False):
            return
        try:
            from .activation_events import record_event

            metadata = {
                "lesson_id": getattr(lesson, "pk", None),
                "access_type": (extra or {}).get("access_type") or "",
            }
            record_event(
                event_name,
                user,
                object_type="lesson",
                object_id=getattr(lesson, "pk", None),
                source="lesson_access",
                metadata=metadata,
            )
        except Exception:
            logger.exception("lesson_access_event_failed name=%s", event_name)

    @classmethod
    def serialize_list(cls, user, lessons: Iterable) -> dict[int, LessonAccessResult]:
        lessons = list(lessons)
        if not lessons:
            return {}
        ids = [m.pk for m in lessons if m is not None]
        purchased_ids: set[int] = set()
        demo_map: dict[int, Any] = {}
        if cls.is_authenticated(user) and ids:
            from .models import LessonDemoAccess, LessonPurchase

            now = timezone.now()
            purchased_ids = set(
                LessonPurchase.objects.filter(
                    user=user,
                    lesson_id__in=ids,
                    status=LessonPurchase.Status.PAID,
                )
                .filter(models_q_valid(now))
                .values_list("lesson_id", flat=True)
            )
            demo_map = {
                row.lesson_id: row
                for row in LessonDemoAccess.objects.filter(user=user, lesson_id__in=ids)
            }
        return {
            lesson.pk: cls.get_access(
                user,
                lesson,
                _demo=demo_map.get(lesson.pk),
                _purchased=lesson.pk in purchased_ids,
            )
            for lesson in lessons
            if lesson is not None
        }


def models_q_valid(now):
    from django.db.models import Q

    return Q(valid_until__isnull=True) | Q(valid_until__gt=now)


class LessonPurchaseService:
    """Отдельная покупка готового урока. Не смешивается с биллингом учеников и подпиской."""

    @classmethod
    def create_checkout(cls, teacher, lesson, *, idempotency_key: str | None = None) -> dict:
        from django.conf import settings as django_settings

        from .models import Payment
        from .payment_service import get_payment_provider

        access = LessonAccessService.get_access(teacher, lesson)
        if access.is_full:
            raise AccessDenied(
                code="ALREADY_OWNED",
                message="У вас уже есть полный доступ к этому уроку.",
                feature="content",
                min_plan=access.required_plan,
            )
        if not access.can_purchase:
            raise AccessDenied(
                code="PURCHASE_UNAVAILABLE",
                message="Отдельная покупка этого урока недоступна.",
                feature="content",
                min_plan=access.required_plan,
            )

        provider_name = (
            getattr(django_settings, "PAYMENT_PROVIDER", None) or "mock"
        ).strip().lower()
        payments_on = bool(getattr(django_settings, "PAYMENTS_ENABLED", False))
        if not payments_on and provider_name != "mock":
            raise ValueError("Оплата временно недоступна. Попробуйте позже.")
        if provider_name == "mock" and not django_settings.DEBUG:
            raise ValueError("Mock payments are disabled in production")

        amount = Decimal(str(lesson.standalone_price))
        currency = (lesson.standalone_currency or "RUB").upper()
        key = (idempotency_key or "").strip() or f"les_{teacher.pk}_{lesson.pk}_{timezone.now().strftime('%Y%m%d')}"

        existing = Payment.objects.filter(idempotency_key=key).first()
        if existing:
            return cls._payment_payload(existing, lesson, idempotent=True)

        import uuid

        from .tbank_payment import customer_key_for_teacher

        payment = Payment.objects.create(
            teacher=teacher,
            subscription=None,
            plan=None,
            purpose=Payment.Purpose.LESSON,
            amount=amount,
            discount_amount=Decimal("0"),
            final_amount=amount,
            currency=currency,
            status=Payment.Status.PENDING,
            provider=provider_name,
            provider_payment_id=f"mock_{uuid.uuid4().hex[:16]}" if provider_name == "mock" else "",
            customer_key=customer_key_for_teacher(teacher),
            idempotency_key=key,
            metadata={
                "purpose": "lesson",
                "lesson_id": lesson.pk,
                "lesson_slug": lesson.slug,
                "lesson_title": (lesson.title or "")[:120],
            },
        )
        provider = get_payment_provider(provider_name)
        try:
            payment_url = provider.create_checkout(payment, None)
        except Exception:
            payment.status = Payment.Status.FAILED
            payment.save(update_fields=["status", "updated_at"])
            raise
        if payment_url:
            meta = dict(payment.metadata or {})
            meta["payment_url"] = payment_url
            payment.metadata = meta
            payment.save(update_fields=["metadata", "updated_at"])
        LessonAccessService._record(
            LESSON_PURCHASE_STARTED,
            teacher,
            lesson,
            extra={"access_type": ACCESS_LOCKED},
        )
        return cls._payment_payload(payment, lesson, payment_url=payment_url)

    @classmethod
    def _payment_payload(cls, payment, lesson, *, idempotent: bool = False, payment_url: str = "") -> dict:
        meta = payment.metadata if isinstance(payment.metadata, dict) else {}
        return {
            "payment_id": payment.pk,
            "provider_payment_id": payment.provider_payment_id,
            "provider": payment.provider,
            "status": payment.status,
            "payment_url": payment_url or str(meta.get("payment_url") or ""),
            "amount": str(payment.final_amount or payment.amount),
            "currency": payment.currency,
            "lesson_id": lesson.pk,
            "idempotent": idempotent,
        }

    @classmethod
    def fulfill_payment(cls, payment) -> Optional[Any]:
        """Создаёт LessonPurchase после успешной оплаты. Идемпотентно по payment."""
        from Generator.models import Lesson as GeneratorLesson
        from .models import LessonPurchase, Payment

        if not is_lesson_payment(payment):
            return None
        if payment.status != Payment.Status.PAID:
            return None

        meta = payment.metadata if isinstance(payment.metadata, dict) else {}
        lesson_id = meta.get("lesson_id")
        if not lesson_id:
            logger.error("material_payment_missing_lesson_id payment_id=%s", payment.pk)
            return None
        lesson = GeneratorLesson.objects.filter(pk=lesson_id).first()
        if lesson is None:
            logger.error("material_payment_material_missing payment_id=%s lesson_id=%s", payment.pk, lesson_id)
            return None

        with transaction.atomic():
            existing = LessonPurchase.objects.filter(payment=payment).first()
            if existing and existing.status == LessonPurchase.Status.PAID:
                return existing
            paid = (
                LessonPurchase.objects.select_for_update()
                .filter(
                    user=payment.teacher,
                    lesson=lesson,
                    status=LessonPurchase.Status.PAID,
                )
                .first()
            )
            if paid:
                if paid.payment_id is None:
                    paid.payment = payment
                    paid.save(update_fields=["payment", "updated_at"])
                return paid
            now = timezone.now()
            purchase, created = LessonPurchase.objects.get_or_create(
                payment=payment,
                defaults={
                    "user": payment.teacher,
                    "lesson": lesson,
                    "amount": payment.final_amount or payment.amount,
                    "currency": payment.currency or "RUB",
                    "status": LessonPurchase.Status.PAID,
                    "purchased_at": payment.paid_at or now,
                },
            )
            if not created and purchase.status != LessonPurchase.Status.PAID:
                purchase.status = LessonPurchase.Status.PAID
                purchase.purchased_at = payment.paid_at or now
                purchase.amount = payment.final_amount or payment.amount
                purchase.save(update_fields=["status", "purchased_at", "amount", "updated_at"])
        LessonAccessService._record(
            LESSON_PURCHASE_COMPLETED,
            payment.teacher,
            lesson,
            extra={"access_type": ACCESS_PURCHASED},
        )
        return purchase

    @classmethod
    def list_for_user(cls, user) -> list[dict]:
        from .models import LessonPurchase

        rows = (
            LessonPurchase.objects.filter(user=user, status=LessonPurchase.Status.PAID)
            .select_related("lesson")
            .order_by("-purchased_at", "-created_at")
        )
        items = []
        for row in rows:
            if not row.is_active():
                continue
            items.append({
                "id": row.pk,
                "lesson_id": row.lesson_id,
                "slug": row.lesson.slug,
                "title": row.lesson.title,
                "cover_url": (
                    row.lesson.cover_image.url if getattr(row.lesson, "cover_image", None) else ""
                ),
                "open_url": f"/lessons/{row.lesson.slug}/view",
                "purchased_at": row.purchased_at.isoformat() if row.purchased_at else None,
                "amount": _money(row.amount),
                "currency": row.currency,
                "price_label": LessonAccessService.format_price(row.amount, row.currency),
                "valid_until": row.valid_until.isoformat() if row.valid_until else None,
            })
        return items
