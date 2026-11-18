"""Приглашение коллег: привязка при регистрации, квалификация, дни «Репетитор»."""

from __future__ import annotations

import hashlib
import logging
import re
import secrets
from datetime import timedelta

from django.contrib.auth.models import User
from django.db import IntegrityError, transaction
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from .colleague_models import (
    ColleagueInviteAudit,
    ColleagueInviteLink,
    ColleagueInviteSettings,
    ColleagueReferral,
    ru_days,
)
from .models import Profile, TariffPlan, TeacherSubscription

logger = logging.getLogger(__name__)

TUTOR_SLUG = "teacher"
FREE_SLUGS = {"start", "free"}
_CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"
_DEVICE_RE = re.compile(r"^[A-Za-z0-9._:-]{8,128}$")
_GMAIL_DOMAINS = {"gmail.com", "googlemail.com"}
COOKIE_NAME = "itflux_colleague"
DEVICE_COOKIE = "itflux_device"
ANON_COOKIE = "ds_anon_id"
SESSION_CODE = "colleague_code"
SESSION_DEVICE = "colleague_device"

REJECT_SELF_USER = "self_user"
REJECT_SELF_EMAIL = "self_email"
REJECT_SELF_PHONE = "self_phone"
REJECT_SELF_IP = "self_ip"
REJECT_SELF_DEVICE = "self_device"
REJECT_NOT_INVITEE = "not_teacher_invitee"
REJECT_NOT_INVITER = "not_teacher_inviter"
REJECT_CAP = "monthly_cap"
REJECT_CODE = "invalid_code"
REJECT_DISABLED = "disabled"


def normalize_email(value: str) -> str:
    text = (value or "").strip().lower()
    if "@" not in text:
        return text
    local, domain = text.rsplit("@", 1)
    local = local.split("+", 1)[0]
    if domain in _GMAIL_DOMAINS:
        local = local.replace(".", "")
        domain = "gmail.com"
    return f"{local}@{domain}" if local else ""


def normalize_phone(value: str) -> str:
    digits = re.sub(r"\D", "", value or "")
    if len(digits) == 11 and digits.startswith("8"):
        digits = "7" + digits[1:]
    if len(digits) < 10:
        return ""
    return digits[-15:]


def hash_device(raw: str) -> str:
    text = (raw or "").strip()[:128]
    if not text or not _DEVICE_RE.match(text):
        return ""
    return hashlib.sha256(text.encode()).hexdigest()


def clean_ip(value: str) -> str:
    text = (value or "").strip()
    if not text or text.lower() == "unknown":
        return ""
    return text[:64]


def _month_start():
    local = timezone.localtime()
    return local.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def _parse_dt(value):
    if not value:
        return None
    parsed = parse_datetime(str(value))
    if parsed and timezone.is_naive(parsed):
        parsed = timezone.make_aware(parsed, timezone.get_current_timezone())
    return parsed


def _iso(value):
    return value.isoformat() if value else None


def tutor_plan():
    plan = TariffPlan.objects.filter(slug=TUTOR_SLUG, is_active=True).first()
    if plan:
        return plan
    return (
        TariffPlan.objects.filter(name__icontains="Репетитор", is_active=True)
        .order_by("sort_order")
        .first()
    )


def _role(user) -> str:
    if user is None:
        return ""
    return (
        Profile.objects.filter(user_id=user.pk).values_list("role", flat=True).first()
        or ""
    )


def _is_teacher(user) -> bool:
    return _role(user) == Profile.Role.TEACHER


def emails_of(user) -> set[str]:
    found = set()
    primary = normalize_email(getattr(user, "email", "") or "")
    if primary:
        found.add(primary)
    profile = (
        Profile.objects.filter(user_id=user.pk).only("yandex_account_email").first()
    )
    if profile:
        extra = normalize_email(profile.yandex_account_email or "")
        if extra:
            found.add(extra)
    from .models import SocialAccount

    for email in SocialAccount.objects.filter(user_id=user.pk).values_list(
        "email", flat=True
    ):
        normalized = normalize_email(email or "")
        if normalized:
            found.add(normalized)
    return {item for item in found if item}


def phones_of(user) -> set[str]:
    from .billing_models import BillingAccount
    from .models import Student

    raw = list(Student.objects.filter(user_id=user.pk).values_list("phone", flat=True))
    raw.extend(
        BillingAccount.objects.filter(payer_user_id=user.pk).values_list(
            "payer_phone", flat=True
        )
    )
    return {normalize_phone(item) for item in raw if normalize_phone(item)}


def _client_ip(request) -> str:
    if request is None:
        return ""
    from .rate_limit import client_ip

    return clean_ip(client_ip(request))


def device_from_request(request, explicit: str = "") -> str:
    """sha256 устройства. В сессии лежит уже хеш, в cookie — сырой id."""
    hashed = hash_device(explicit)
    if hashed:
        return hashed
    if request is None:
        return ""
    for raw in (
        request.META.get("HTTP_X_DEVICE_ID"),
        request.COOKIES.get(DEVICE_COOKIE),
        request.COOKIES.get(ANON_COOKIE),
    ):
        hashed = hash_device(raw or "")
        if hashed:
            return hashed
    if hasattr(request, "session"):
        stored = str(request.session.get(SESSION_DEVICE) or "")
        if re.fullmatch(r"[0-9a-f]{64}", stored):
            return stored
    return ""


def colleague_code_from_request(request, data=None, explicit: str = "") -> str:
    data = data or {}
    session_code = ""
    cookie_code = ""
    if request is not None:
        if hasattr(request, "session"):
            session_code = request.session.get(SESSION_CODE) or ""
        cookie_code = request.COOKIES.get(COOKIE_NAME) or ""
    for candidate in (
        explicit,
        data.get("colleague_code"),
        data.get("colleague"),
        session_code,
        cookie_code,
    ):
        text = str(candidate or "").strip()
        if text:
            return text[:32]
    return ""


def _audit(
    *,
    action,
    detail="",
    reason="",
    referral=None,
    inviter=None,
    invited=None,
    actor=None,
    bonus_days=0,
):
    ColleagueInviteAudit.objects.create(
        action=action,
        detail=(detail or "")[:255],
        reason=(reason or "")[:40],
        referral=referral,
        inviter=inviter or (referral.inviter if referral else None),
        invited=invited or (referral.invited if referral else None),
        actor=actor,
        bonus_days=int(bonus_days or 0),
    )


def _snapshot(sub) -> dict:
    return {
        "plan_id": sub.plan_id,
        "status": sub.status,
        "source": sub.source,
        "expires_at": _iso(sub.expires_at),
        "current_period_end": _iso(sub.current_period_end),
    }


def _paid_active(sub) -> bool:
    if sub is None or not sub.is_valid():
        return False
    plan = sub.plan
    if plan is None or plan.is_free or plan.slug in FREE_SLUGS:
        return False
    return True


def _sync_period(sub):
    try:
        from .subscription_downgrade import DowngradeService

        DowngradeService.sync_effective_at_to_expires(sub)
    except Exception:
        logger.exception(
            "colleague bonus period sync failed sub=%s", getattr(sub, "pk", None)
        )


class ColleagueInviteService:
    @staticmethod
    def ensure_link(owner: User) -> ColleagueInviteLink | None:
        if not _is_teacher(owner):
            return None
        existing = ColleagueInviteLink.objects.filter(owner=owner).first()
        if existing:
            return existing
        for _ in range(6):
            code = "".join(secrets.choice(_CODE_ALPHABET) for _ in range(10))
            try:
                return ColleagueInviteLink.objects.create(owner=owner, code=code)
            except IntegrityError:
                existing = ColleagueInviteLink.objects.filter(owner=owner).first()
                if existing:
                    return existing
        return ColleagueInviteLink.objects.filter(owner=owner).first()

    @staticmethod
    def public_path(link: ColleagueInviteLink) -> str:
        return f"/?colleague={link.code}"

    @staticmethod
    def public_url(link: ColleagueInviteLink, request=None) -> str:
        from .platform_mail import public_site_origin

        return f"{public_site_origin(request)}/?colleague={link.code}"

    @staticmethod
    def remember_owner_visit(
        link: ColleagueInviteLink, request, device_id: str = ""
    ) -> None:
        link.last_ip = _client_ip(request)
        fingerprint = device_from_request(request, device_id)
        fields = ["last_ip", "last_seen_at"]
        if fingerprint:
            link.last_fingerprint = fingerprint
            fields.append("last_fingerprint")
        link.last_seen_at = timezone.now()
        link.save(update_fields=fields)

    @staticmethod
    def summary(owner: User, request=None, device_id: str = "") -> dict:
        settings_row = ColleagueInviteSettings.get_solo()
        if not _is_teacher(owner) or not settings_row.enabled:
            return {"enabled": False, "bonus_days": int(settings_row.bonus_days or 0)}
        link = ColleagueInviteService.ensure_link(owner)
        if link is None:
            return {"enabled": False, "bonus_days": int(settings_row.bonus_days or 0)}
        if request is not None:
            ColleagueInviteService.remember_owner_visit(link, request, device_id)
        invited = ColleagueReferral.objects.filter(inviter=owner).count()
        qualified = ColleagueReferral.objects.filter(
            inviter=owner,
            status__in=[
                ColleagueReferral.Status.GRANTED,
                ColleagueReferral.Status.DEFERRED,
            ],
        ).count()
        used = ColleagueReferral.objects.filter(
            inviter=owner,
            created_at__gte=_month_start(),
        ).count()
        return {
            "enabled": True,
            "bonus_days": int(settings_row.bonus_days or 0),
            "monthly_cap": int(settings_row.monthly_cap or 0),
            "monthly_used": used,
            "code": link.code,
            "path": ColleagueInviteService.public_path(link),
            "url": ColleagueInviteService.public_url(link, request),
            "invited": invited,
            "qualified": qualified,
        }

    @staticmethod
    def touch(code: str, request) -> ColleagueInviteLink | None:
        settings_row = ColleagueInviteSettings.get_solo()
        if not settings_row.enabled:
            return None
        link = (
            ColleagueInviteLink.objects.select_related("owner")
            .filter(code__iexact=(code or "").strip(), is_active=True)
            .first()
        )
        if link is None or not _is_teacher(link.owner):
            return None
        if request is not None and hasattr(request, "session"):
            request.session[SESSION_CODE] = link.code
            fingerprint = device_from_request(request)
            if fingerprint:
                request.session[SESSION_DEVICE] = fingerprint
        return link

    @staticmethod
    def bind_from_request(
        user: User, request, data=None, code: str = ""
    ) -> dict | None:
        resolved = colleague_code_from_request(request, data, code)
        if not resolved:
            return None
        explicit_device = ""
        if isinstance(data, dict):
            explicit_device = str(data.get("device_id") or "")
        return ColleagueInviteService.bind(
            user,
            resolved,
            ip=_client_ip(request),
            fingerprint=device_from_request(request, explicit_device),
        )

    @staticmethod
    @transaction.atomic
    def bind(user: User, code: str, *, ip: str = "", fingerprint: str = "") -> dict:
        settings_row = ColleagueInviteSettings.get_solo()
        existing = (
            ColleagueReferral.objects.select_for_update().filter(invited=user).first()
        )
        if existing:
            return {"ok": True, "reason": "already_bound", "referral_id": existing.pk}

        if not settings_row.enabled:
            _audit(
                action=ColleagueInviteAudit.Action.REJECTED,
                reason=REJECT_DISABLED,
                detail="Программа приглашения коллег выключена",
                invited=user,
            )
            return {"ok": False, "reason": REJECT_DISABLED}

        link = (
            ColleagueInviteLink.objects.select_for_update()
            .select_related("owner")
            .filter(code__iexact=(code or "").strip(), is_active=True)
            .first()
        )
        if link is None:
            _audit(
                action=ColleagueInviteAudit.Action.REJECTED,
                reason=REJECT_CODE,
                detail="Ссылка приглашения не найдена",
                invited=user,
            )
            return {"ok": False, "reason": REJECT_CODE}

        inviter = link.owner
        if not _is_teacher(inviter):
            _audit(
                action=ColleagueInviteAudit.Action.REJECTED,
                reason=REJECT_NOT_INVITER,
                detail="Приглашать коллег может только учитель",
                inviter=inviter,
                invited=user,
            )
            return {"ok": False, "reason": REJECT_NOT_INVITER}
        if not _is_teacher(user):
            _audit(
                action=ColleagueInviteAudit.Action.REJECTED,
                reason=REJECT_NOT_INVITEE,
                detail="Бонус за приглашение начисляется только за учителя",
                inviter=inviter,
                invited=user,
            )
            return {"ok": False, "reason": REJECT_NOT_INVITEE}

        rejection = _self_invite_reason(
            inviter, user, link, settings_row, ip, fingerprint
        )
        if rejection:
            _audit(
                action=ColleagueInviteAudit.Action.REJECTED,
                reason=rejection,
                detail=_reject_detail(rejection),
                inviter=inviter,
                invited=user,
            )
            return {"ok": False, "reason": rejection}

        used = ColleagueReferral.objects.filter(
            inviter=inviter,
            created_at__gte=_month_start(),
        ).count()
        if used >= int(settings_row.monthly_cap or 0):
            _audit(
                action=ColleagueInviteAudit.Action.REJECTED,
                reason=REJECT_CAP,
                detail=f"Лимит {settings_row.monthly_cap} приглашений в этом месяце",
                inviter=inviter,
                invited=user,
            )
            return {"ok": False, "reason": REJECT_CAP}

        phones = phones_of(user)
        try:
            referral = ColleagueReferral.objects.create(
                inviter=inviter,
                invited=user,
                link=link,
                status=ColleagueReferral.Status.PENDING,
                email_normalized=normalize_email(user.email or ""),
                phone_normalized=next(iter(phones), ""),
                ip_address=clean_ip(ip),
                device_fingerprint=fingerprint or "",
            )
        except IntegrityError:
            existing = ColleagueReferral.objects.filter(invited=user).first()
            return {
                "ok": True,
                "reason": "already_bound",
                "referral_id": existing.pk if existing else None,
            }

        _audit(
            action=ColleagueInviteAudit.Action.BOUND,
            detail=f"Коллега зарегистрировался по ссылке {link.code}",
            referral=referral,
            bonus_days=int(settings_row.bonus_days or 0),
        )
        return {"ok": True, "reason": "bound", "referral_id": referral.pk}

    @staticmethod
    def note_activity(user, reason: str) -> ColleagueReferral | None:
        if user is None or reason not in {
            ColleagueReferral.Qualification.HOMEWORK,
            ColleagueReferral.Qualification.LESSON,
        }:
            return None
        try:
            with transaction.atomic():
                referral = (
                    ColleagueReferral.objects.select_for_update()
                    .select_related("inviter")
                    .filter(
                        invited_id=getattr(user, "pk", user),
                        status=ColleagueReferral.Status.PENDING,
                    )
                    .first()
                )
                if referral is None:
                    return None
                if not _is_teacher(referral.invited) or not _is_teacher(
                    referral.inviter
                ):
                    return None
                return _grant_locked(referral, reason)
        except Exception:
            logger.exception(
                "colleague qualification failed user=%s", getattr(user, "pk", user)
            )
            return None

    @staticmethod
    @transaction.atomic
    def revoke(
        referral: ColleagueReferral, *, actor=None, note: str = ""
    ) -> ColleagueReferral:
        locked = (
            ColleagueReferral.objects.select_for_update()
            .select_related("inviter")
            .get(pk=referral.pk)
        )
        if locked.status == ColleagueReferral.Status.REVOKED:
            return locked
        if (
            locked.effect
            in {
                ColleagueReferral.Effect.ACTIVATED,
                ColleagueReferral.Effect.EXTENDED,
            }
            and locked.status != ColleagueReferral.Status.DEFERRED
        ):
            _clawback(locked)
        locked.status = ColleagueReferral.Status.REVOKED
        locked.revoked_at = timezone.now()
        locked.revoked_by = actor
        locked.revoke_note = (note or "Отозвано в админке")[:255]
        locked.save(update_fields=["status", "revoked_at", "revoked_by", "revoke_note"])
        _audit(
            action=ColleagueInviteAudit.Action.REVOKED,
            detail=locked.revoke_note,
            referral=locked,
            actor=actor,
            bonus_days=locked.bonus_days,
        )
        return locked

    @staticmethod
    @transaction.atomic
    def apply_due_deferred(sub: TeacherSubscription) -> bool:
        """Когда чужой платный тариф истёк — выдать накопленные дни «Репетитор» вместо «Старта»."""
        now = timezone.now()
        if sub is None or not sub.expires_at or sub.expires_at > now:
            return False
        referrals = list(
            ColleagueReferral.objects.select_for_update().filter(
                inviter_id=sub.teacher_id,
                status=ColleagueReferral.Status.DEFERRED,
            )
        )
        if not referrals:
            return False
        days = sum(int(item.bonus_days or 0) for item in referrals)
        plan = tutor_plan()
        if plan is None or days <= 0:
            return False
        try:
            from .r50_tariffs import remember_expired

            remember_expired(sub)
        except Exception:
            logger.exception(
                "remember_expired before colleague bonus failed sub=%s", sub.pk
            )
        before = _snapshot(sub)
        sub.plan = plan
        sub.status = TeacherSubscription.Status.ACTIVE
        sub.source = TeacherSubscription.Source.REFERRAL
        sub.expires_at = now + timedelta(days=days)
        sub.current_period_end = sub.expires_at
        if not sub.current_period_start:
            sub.current_period_start = now
        sub.save(
            update_fields=[
                "plan",
                "status",
                "source",
                "expires_at",
                "current_period_start",
                "current_period_end",
                "updated_at",
            ]
        )
        _sync_period(sub)
        after = _snapshot(sub)
        for item in referrals:
            item.status = ColleagueReferral.Status.GRANTED
            item.effect = ColleagueReferral.Effect.ACTIVATED
            item.granted_at = item.granted_at or now
            item.subscription_before = before
            item.subscription_after = after
            item.save(
                update_fields=[
                    "status",
                    "effect",
                    "granted_at",
                    "subscription_before",
                    "subscription_after",
                ]
            )
            _audit(
                action=ColleagueInviteAudit.Action.DEFERRED_APPLIED,
                detail=f"После другого тарифа открыт «Репетитор» на {ru_days(item.bonus_days)}.",
                referral=item,
                bonus_days=item.bonus_days,
            )
        return True


def _self_invite_reason(
    inviter, invited, link, settings_row, ip: str, fingerprint: str
) -> str:
    if inviter.pk == invited.pk:
        return REJECT_SELF_USER
    if emails_of(inviter) & emails_of(invited):
        return REJECT_SELF_EMAIL
    if phones_of(inviter) & phones_of(invited):
        return REJECT_SELF_PHONE
    window = int(settings_row.fingerprint_window_hours or 0)
    if window <= 0 or not link.last_seen_at:
        return ""
    if timezone.now() - link.last_seen_at > timedelta(hours=window):
        return ""
    if (
        clean_ip(ip)
        and clean_ip(link.last_ip)
        and clean_ip(ip) == clean_ip(link.last_ip)
    ):
        return REJECT_SELF_IP
    if fingerprint and link.last_fingerprint and fingerprint == link.last_fingerprint:
        return REJECT_SELF_DEVICE
    return ""


def _reject_detail(reason: str) -> str:
    return {
        REJECT_SELF_USER: "Нельзя пригласить самого себя",
        REJECT_SELF_EMAIL: "Email совпадает с пригласившим",
        REJECT_SELF_PHONE: "Телефон совпадает с пригласившим",
        REJECT_SELF_IP: "IP совпадает с пригласившим",
        REJECT_SELF_DEVICE: "Устройство совпадает с пригласившим",
        REJECT_NOT_INVITEE: "Приглашённый не учитель",
        REJECT_NOT_INVITER: "Пригласивший не учитель",
        REJECT_CAP: "Месячный лимит приглашений",
        REJECT_CODE: "Ссылка не найдена",
        REJECT_DISABLED: "Программа выключена",
    }.get(reason, reason)


def _grant_locked(referral: ColleagueReferral, reason: str) -> ColleagueReferral:
    if referral.status != ColleagueReferral.Status.PENDING:
        return referral
    settings_row = ColleagueInviteSettings.get_solo()
    days = int(settings_row.bonus_days or 0)
    if days > 0 and tutor_plan() is None:
        logger.error("colleague bonus skipped: tariff %s is missing", TUTOR_SLUG)
        return referral
    now = timezone.now()
    referral.qualification = reason
    referral.qualified_at = now
    referral.bonus_days = days
    effect, before, after = _apply_tutor_days(referral.inviter, days)
    referral.effect = effect
    referral.subscription_before = before
    referral.subscription_after = after
    referral.granted_at = now
    if effect == ColleagueReferral.Effect.DEFERRED:
        referral.status = ColleagueReferral.Status.DEFERRED
        action = ColleagueInviteAudit.Action.DEFERRED
        detail = (
            f"Коллега квалифицирован ({_qualification_label(reason)}). "
            f"+{ru_days(days)} «Репетитор» ждут окончания текущего тарифа"
        )
    else:
        referral.status = ColleagueReferral.Status.GRANTED
        action = ColleagueInviteAudit.Action.GRANTED
        detail = (
            f"Коллега квалифицирован ({_qualification_label(reason)}). "
            f"+{ru_days(days)} тарифа «Репетитор»"
        )
    referral.save(
        update_fields=[
            "qualification",
            "qualified_at",
            "bonus_days",
            "effect",
            "subscription_before",
            "subscription_after",
            "granted_at",
            "status",
        ]
    )
    _audit(action=action, detail=detail, referral=referral, bonus_days=days)
    return referral


def _qualification_label(reason: str) -> str:
    if reason == ColleagueReferral.Qualification.HOMEWORK:
        return "первое домашнее задание"
    return "проведённый урок"


def _apply_tutor_days(teacher: User, days: int):
    from .subscription_service import SubscriptionLimitService

    sub = SubscriptionLimitService.get_or_create_subscription(
        teacher, apply_promo=False
    )
    before = _snapshot(sub)
    if days <= 0:
        return ColleagueReferral.Effect.NONE, before, before
    plan = tutor_plan()
    if plan is None:
        logger.error("colleague bonus skipped: tariff teacher is missing")
        return ColleagueReferral.Effect.NONE, before, before

    now = timezone.now()
    if _paid_active(sub) and sub.plan_id != plan.pk:
        return ColleagueReferral.Effect.DEFERRED, before, before

    if _paid_active(sub) and sub.plan_id == plan.pk and not sub.expires_at:
        return ColleagueReferral.Effect.ALREADY_COVERED, before, before

    if _paid_active(sub) and sub.plan_id == plan.pk:
        base = sub.expires_at if sub.expires_at and sub.expires_at > now else now
        sub.expires_at = base + timedelta(days=days)
        sub.current_period_end = sub.expires_at
        sub.status = TeacherSubscription.Status.ACTIVE
        sub.save(
            update_fields=["expires_at", "current_period_end", "status", "updated_at"]
        )
        _sync_period(sub)
        return ColleagueReferral.Effect.EXTENDED, before, _snapshot(sub)

    sub.plan = plan
    sub.status = TeacherSubscription.Status.ACTIVE
    sub.source = TeacherSubscription.Source.REFERRAL
    sub.expires_at = now + timedelta(days=days)
    sub.current_period_end = sub.expires_at
    if not sub.current_period_start:
        sub.current_period_start = now
    sub.save(
        update_fields=[
            "plan",
            "status",
            "source",
            "expires_at",
            "current_period_start",
            "current_period_end",
            "updated_at",
        ]
    )
    _sync_period(sub)
    return ColleagueReferral.Effect.ACTIVATED, before, _snapshot(sub)


def _clawback(referral: ColleagueReferral) -> None:
    from .subscription_service import SubscriptionLimitService

    sub = SubscriptionLimitService.get_or_create_subscription(
        referral.inviter, apply_promo=False
    )
    plan = tutor_plan()
    if plan is None or sub.plan_id != plan.pk:
        return
    before = referral.subscription_before or {}
    after = referral.subscription_after or {}
    after_expires = _parse_dt(after.get("expires_at"))
    unchanged = (
        after_expires is not None
        and sub.expires_at is not None
        and abs((sub.expires_at - after_expires).total_seconds()) < 2
    )
    if unchanged and before.get("plan_id"):
        sub.plan_id = before["plan_id"]
        sub.status = before.get("status") or sub.status
        sub.source = before.get("source") or sub.source
        sub.expires_at = _parse_dt(before.get("expires_at"))
        sub.current_period_end = _parse_dt(before.get("current_period_end"))
    elif sub.expires_at:
        sub.expires_at = sub.expires_at - timedelta(days=int(referral.bonus_days or 0))
        sub.current_period_end = sub.expires_at
        if (
            sub.expires_at <= timezone.now()
            and referral.effect == ColleagueReferral.Effect.ACTIVATED
        ):
            if before.get("plan_id"):
                sub.plan_id = before["plan_id"]
                sub.status = before.get("status") or TeacherSubscription.Status.ACTIVE
                sub.source = before.get("source") or sub.source
                sub.expires_at = _parse_dt(before.get("expires_at"))
                sub.current_period_end = _parse_dt(before.get("current_period_end"))
    sub.save(
        update_fields=[
            "plan",
            "status",
            "source",
            "expires_at",
            "current_period_end",
            "updated_at",
        ]
    )
    _sync_period(sub)
