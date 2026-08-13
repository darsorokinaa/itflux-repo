import json
import logging
from datetime import datetime
from urllib.parse import urlencode

from django.conf import settings
from django.utils.dateparse import parse_date

from django.contrib.auth import authenticate, login, logout
from django.contrib.auth.models import User
from django.contrib.auth.password_validation import validate_password
from django.contrib.auth.tokens import default_token_generator
from django.core.exceptions import ValidationError
from django.core.mail import send_mail
from django.http import JsonResponse
from django.utils import timezone
from django.utils.encoding import force_bytes, force_str
from django.utils.http import urlsafe_base64_decode, urlsafe_base64_encode
from django.views.decorators.http import require_http_methods

logger = logging.getLogger(__name__)

from .models import Profile, ScheduleEvent, TeacherApplication, TeacherCommunityFeedback
from .invitations import invite_accept_api_payload, try_accept_invite_token
from .plan_catalog import can_publish_catalog_lesson_plan
from .task_tags import can_edit_task_tags
from .rate_limit import client_ip, rate_limit_check, rate_limit_json_response
from .avatar_api import build_avatar_url
from .schedule_events import (
    list_schedule_events,
    parse_local_event_id,
    schedule_event_to_json,
)
from .telemost import (
    create_telemost_link,
    is_telemost_meeting_url,
    telemost_auto_create_enabled,
    telemost_is_configured,
)
from .yandex_calendar import (
    calendar_authorize_url,
    calendar_embed_config,
    calendar_integration_enabled,
    calendar_is_configured,
    fetch_calendar_events,
    profile_yandex_calendar_active,
    resolve_yandex_account_email,
)


def _profile_payload(user):
    profile = user.profile
    return {
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "name": profile.name,
        "surname": profile.surname,
        "role": profile.role,
        "role_label": profile.get_role_display(),
        "avatar": build_avatar_url(user) or None,
        "account_active": profile.account_active,
        "email_confirmed": profile.email_confirmed,
        "can_publish_catalog_plans": can_publish_catalog_lesson_plan(user),
        "can_edit_task_tags": can_edit_task_tags(user),
    }


def _profile_access_error(profile):
    if profile.account_blocked:
        return "Аккаунт заблокирован"
    if not profile.account_active:
        return "Аккаунт неактивен"
    return None


def _load_json_body(request):
    try:
        return json.loads(request.body or b"{}")
    except (json.JSONDecodeError, TypeError):
        return None


def _find_user_by_login(login_id: str):
    login_id = (login_id or "").strip()
    if not login_id:
        return None
    user = User.objects.filter(username__iexact=login_id).first()
    if user is None and "@" in login_id:
        user = User.objects.filter(email__iexact=login_id).first()
    return user


@require_http_methods(["GET"])
def api_me(request):
    if not request.user.is_authenticated:
        return JsonResponse({"authenticated": False})
    return JsonResponse({"authenticated": True, "user": _profile_payload(request.user)})


@require_http_methods(["POST"])
def api_login(request):
    if not rate_limit_check(request, "auth_login", 10, 900):
        return rate_limit_json_response()

    data = _load_json_body(request)
    if data is None:
        return JsonResponse({"ok": False, "error": "Некорректный JSON"}, status=400)

    login_id = (data.get("login") or data.get("username") or data.get("email") or "").strip()
    password = data.get("password") or ""

    if not login_id or not password:
        return JsonResponse({"ok": False, "error": "Введите логин и пароль"}, status=400)

    user = _find_user_by_login(login_id)
    if user is None:
        return JsonResponse({"ok": False, "error": "Неверный логин или пароль"}, status=403)

    auth_user = authenticate(request, username=user.username, password=password)
    if auth_user is None:
        return JsonResponse({"ok": False, "error": "Неверный логин или пароль"}, status=403)

    access_error = _profile_access_error(auth_user.profile)
    if access_error:
        return JsonResponse({"ok": False, "error": access_error}, status=403)

    login(request, auth_user)
    Profile.objects.filter(pk=auth_user.profile.pk).update(last_activity=timezone.now())

    invite_result = try_accept_invite_token(auth_user, data.get("invite_token"))
    payload = {"ok": True, "user": _profile_payload(auth_user)}
    if invite_result:
        student, invitation = invite_result
        payload["invite_accepted"] = True
        payload["student_id"] = student.id
        payload["invite"] = invite_accept_api_payload(student, invitation, auth_user)
    return JsonResponse(payload)


@require_http_methods(["POST"])
def api_register(request):
    if not rate_limit_check(request, "auth_register", 10, 900):
        return rate_limit_json_response()

    data = _load_json_body(request)
    if data is None:
        return JsonResponse({"ok": False, "error": "Некорректный JSON"}, status=400)

    username = (data.get("username") or "").strip()
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""
    password_confirm = data.get("password_confirm") or password
    name = (data.get("name") or "").strip()
    surname = (data.get("surname") or "").strip()
    role = (data.get("role") or Profile.Role.STUDENT).strip()
    invite_token = (data.get("invite_token") or "").strip()
    parent_invite_token = (data.get("parent_invite_token") or "").strip()
    referral_code = (data.get("referral_code") or data.get("ref") or "").strip()

    if parent_invite_token:
        role = Profile.Role.PARENT
    elif invite_token:
        role = Profile.Role.STUDENT

    if not email:
        return JsonResponse({"ok": False, "error": "Укажите email"}, status=400)
    if not password:
        return JsonResponse({"ok": False, "error": "Укажите пароль"}, status=400)
    if password != password_confirm:
        return JsonResponse({"ok": False, "error": "Пароли не совпадают"}, status=400)

    if not username:
        username = email.split("@", 1)[0]
    base_username = username
    suffix = 1
    while User.objects.filter(username__iexact=username).exists():
        username = f"{base_username}{suffix}"
        suffix += 1

    if User.objects.filter(email__iexact=email).exists():
        return JsonResponse({"ok": False, "error": "Пользователь с таким email уже зарегистрирован"}, status=400)

    if role not in Profile.Role.values:
        role = Profile.Role.STUDENT
    # Родительская регистрация только по приглашению из карточки ученика.
    if role == Profile.Role.PARENT and not parent_invite_token:
        return JsonResponse(
            {"ok": False, "error": "Регистрация родителя доступна только по приглашению преподавателя"},
            status=400,
        )

    try:
        validate_password(password)
    except ValidationError as exc:
        return JsonResponse({"ok": False, "error": " ".join(exc.messages)}, status=400)

    if referral_code and not invite_token and not parent_invite_token:
        role = Profile.Role.TEACHER

    user = User.objects.create_user(username=username, email=email, password=password)
    profile = user.profile
    profile.name = name
    profile.surname = surname
    profile.role = role
    profile.save(update_fields=["name", "surname", "role"])

    login(request, user)
    invite_result = try_accept_invite_token(user, invite_token) if invite_token else None

    parent_invite_result = None
    if parent_invite_token:
        try:
            from .parent_invitations import accept_parent_invitation, get_invitation_by_raw_token

            parent_inv = get_invitation_by_raw_token(parent_invite_token)
            if parent_inv:
                parent_invite_result = accept_parent_invitation(user, parent_inv)
        except Exception as exc:
            import logging
            logging.getLogger(__name__).warning("Parent invite accept failed: %s", exc)

    referral_result = None
    if referral_code and not invite_token and not parent_invite_token:
        from .referral_service import ReferralError, ReferralService
        try:
            referral_result = ReferralService.apply_on_registration(user, referral_code)
        except ReferralError as exc:
            import logging
            logging.getLogger(__name__).warning(
                "Referral not applied for %s (%s): %s",
                email or username,
                referral_code,
                exc.message,
            )
            referral_result = None

    registration_promo = None
    if role == Profile.Role.TEACHER:
        from .registration_promo import apply_registration_promo

        # Если рефералка уже выдала Премиум — акция не затрёт более выгодный срок.
        registration_promo = apply_registration_promo(user)

    payload = {"ok": True, "user": _profile_payload(user)}
    if invite_result:
        student, invitation = invite_result
        payload["invite_accepted"] = True
        payload["student_id"] = student.id
        payload["invite"] = invite_accept_api_payload(student, invitation, user)
    if parent_invite_result:
        payload["parent_invite_accepted"] = True
        payload["redirect"] = "/cabinet/parent"
    if referral_result:
        payload["referral_applied"] = True
        payload["referral_reward"] = referral_result
    if registration_promo:
        payload["registration_promo"] = registration_promo
    return JsonResponse(payload, status=201)


@require_http_methods(["GET"])
def api_referral_preview(request, code):
    if not rate_limit_check(request, "referral_preview", 60, 3600):
        return JsonResponse(
            {"code": "RATE_LIMITED", "message": "Слишком много запросов.", "valid": False},
            status=429,
        )

    from .referral_service import ReferralError, ReferralService

    try:
        link = ReferralService.validate(code)
        return JsonResponse(ReferralService.preview_payload(link))
    except ReferralError as exc:
        return JsonResponse(exc.to_dict(), status=404)


@require_http_methods(["POST"])
def api_logout(request):
    logout(request)
    return JsonResponse({"ok": True})


PASSWORD_RESET_SENT_MESSAGE = (
    "Если аккаунт с такими данными существует, мы отправили ссылку для восстановления пароля."
)


def _public_site_origin(request) -> str:
    origin = (getattr(settings, "LK_PUBLIC_URL", "") or "").rstrip("/")
    if origin:
        return origin
    return request.build_absolute_uri("/").rstrip("/")


def _password_reset_url(request, user) -> str:
    uid = urlsafe_base64_encode(force_bytes(user.pk))
    token = default_token_generator.make_token(user)
    query = urlencode({"mode": "reset", "uid": uid, "token": token})
    return f"{_public_site_origin(request)}/cabinet/login?{query}"


def _user_from_reset_uid(uidb64: str):
    try:
        uid = force_str(urlsafe_base64_decode(uidb64))
        return User.objects.filter(pk=uid).first()
    except (TypeError, ValueError, OverflowError, UnicodeDecodeError):
        return None


def _send_password_reset_email(request, user) -> bool:
    email = (user.email or "").strip()
    if not email:
        return False
    reset_url = _password_reset_url(request, user)
    if settings.DEBUG:
        logger.info("Password reset link for %s: %s", email, reset_url)
    name = ""
    profile = getattr(user, "profile", None)
    if profile:
        name = " ".join(part for part in (profile.name, profile.surname) if part).strip()
    greeting = f"Здравствуйте{', ' + name if name else ''}!"
    body = "\n".join(
        [
            greeting,
            "",
            "Вы запросили восстановление пароля на платформе «Цифровой поток».",
            "Перейдите по ссылке, чтобы задать новый пароль:",
            "",
            reset_url,
            "",
            "Ссылка действует ограниченное время. Если вы не запрашивали сброс, просто проигнорируйте это письмо.",
        ]
    )
    try:
        sent = send_mail(
            subject="Восстановление пароля — Цифровой поток",
            message=body,
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[email],
            fail_silently=False,
        )
        return bool(sent)
    except Exception:
        logger.exception("Не удалось отправить письмо для восстановления пароля на %s", email)
        return False


@require_http_methods(["POST"])
def api_password_reset_request(request):
    if not rate_limit_check(request, "auth_password_reset", 5, 900):
        return rate_limit_json_response()

    data = _load_json_body(request)
    if data is None:
        return JsonResponse({"ok": False, "error": "Некорректный JSON"}, status=400)

    login_id = (data.get("login") or data.get("email") or data.get("username") or "").strip()
    if not login_id:
        return JsonResponse({"ok": False, "error": "Укажите email или логин"}, status=400)

    user = _find_user_by_login(login_id)
    if user is not None:
        access_error = _profile_access_error(user.profile)
        if not access_error:
            _send_password_reset_email(request, user)

    return JsonResponse({"ok": True, "message": PASSWORD_RESET_SENT_MESSAGE})


@require_http_methods(["POST"])
def api_password_reset_confirm(request):
    if not rate_limit_check(request, "auth_password_reset_confirm", 10, 900):
        return rate_limit_json_response()

    data = _load_json_body(request)
    if data is None:
        return JsonResponse({"ok": False, "error": "Некорректный JSON"}, status=400)

    uidb64 = (data.get("uid") or "").strip()
    token = (data.get("token") or "").strip()
    password = data.get("password") or ""
    password_confirm = data.get("password_confirm") or password

    if not uidb64 or not token:
        return JsonResponse({"ok": False, "error": "Ссылка недействительна или устарела."}, status=400)
    if not password:
        return JsonResponse({"ok": False, "error": "Укажите новый пароль"}, status=400)
    if password != password_confirm:
        return JsonResponse({"ok": False, "error": "Пароли не совпадают"}, status=400)

    try:
        validate_password(password)
    except ValidationError as exc:
        return JsonResponse({"ok": False, "error": " ".join(exc.messages)}, status=400)

    user = _user_from_reset_uid(uidb64)
    if user is None or not default_token_generator.check_token(user, token):
        return JsonResponse({"ok": False, "error": "Ссылка недействительна или устарела."}, status=400)

    access_error = _profile_access_error(user.profile)
    if access_error:
        return JsonResponse({"ok": False, "error": access_error}, status=403)

    user.set_password(password)
    user.save(update_fields=["password"])
    auth_user = authenticate(request, username=user.username, password=password) or user
    login(request, auth_user)
    Profile.objects.filter(pk=auth_user.profile.pk).update(last_activity=timezone.now())
    return JsonResponse({"ok": True, "user": _profile_payload(auth_user)})


def _require_authenticated_user(request):
    if not request.user.is_authenticated:
        return JsonResponse({"ok": False, "error": "Требуется авторизация"}, status=401)
    access_error = _profile_access_error(request.user.profile)
    if access_error:
        return JsonResponse({"ok": False, "error": access_error}, status=403)
    return None


@require_http_methods(["GET"])
def api_telemost_status(request):
    auth_error = _require_authenticated_user(request)
    if auth_error:
        return auth_error

    from .telemost import diagnose_telemost_config

    report = diagnose_telemost_config()
    return JsonResponse({
        "ok": True,
        "configured": report.get("configured"),
        "authorize_url": report.get("authorize_url"),
        "account_email": report.get("account_email"),
        "token_email": report.get("token_email"),
        "api_available": bool((report.get("api_test") or {}).get("ok")),
        "caldav_fallback_enabled": report.get("caldav_fallback_enabled"),
        "diagnostics": report,
    })


@require_http_methods(["POST"])
def api_telemost_start(request):
    auth_error = _require_authenticated_user(request)
    if auth_error:
        return auth_error

    try:
        payload = json.loads(request.body or "{}")
    except json.JSONDecodeError:
        payload = {}

    event_id = (payload.get("event_id") or "").strip()

    if event_id:
        from django.core.cache import cache

        cached = cache.get(f"telemost:event:{event_id}")
        if cached and is_telemost_meeting_url(cached.get("join_url")):
            join_url = cached["join_url"]
            _persist_telemost_link(request.user, event_id, join_url)
            return JsonResponse({
                "ok": True,
                "join_url": join_url,
                "share_url": join_url,
                "conference_id": cached.get("id"),
                "cached": True,
                "provider": "telemost",
                "message": "Телемост открыт.",
            })

    from .telemost import create_telemost_link

    event_title = (payload.get("title") or "").strip()
    event_topic = (payload.get("topic") or "").strip()
    starts_at = _parse_schedule_datetime(payload.get("starts_at"))
    ends_at = _parse_schedule_datetime(payload.get("ends_at"))
    if event_id and (not starts_at or not ends_at or not event_title):
        local_event = _get_schedule_event(request.user, event_id)
        if local_event:
            starts_at = starts_at or local_event.starts_at
            ends_at = ends_at or local_event.ends_at
            event_title = event_title or local_event.title
            event_topic = event_topic or local_event.topic

    join_url, error = create_telemost_link(
        title=event_title or "Онлайн-урок",
        starts_at=starts_at,
        ends_at=ends_at,
        topic=event_topic,
    )
    if error or not is_telemost_meeting_url(join_url):
        return JsonResponse({
            "ok": False,
            "error": error or "Не удалось создать встречу в Телемосте.",
        }, status=502)

    conference = {"join_url": join_url, "id": None}

    if event_id:
        from django.core.cache import cache

        cache.set(
            f"telemost:event:{event_id}",
            {"join_url": join_url, "id": conference.get("id")},
            timeout=86400,
        )
        _persist_telemost_link(request.user, event_id, join_url)

    return JsonResponse({
        "ok": True,
        "join_url": join_url,
        "share_url": join_url,
        "conference_id": conference.get("id"),
        "provider": "telemost",
        "message": "Телемост открыт.",
    })


def _parse_range_param(value):
    if not value:
        return None
    parsed = parse_date(value)
    if parsed:
        return parsed
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).date()
    except ValueError:
        return None


def _persist_telemost_link(user, event_id, join_url):
    pk = parse_local_event_id(event_id)
    if not pk or not join_url:
        return
    ScheduleEvent.objects.filter(owner=user, pk=pk).update(telemost_url=join_url)


def _create_telemost_link_for_user(user, *, title="", starts_at=None, ends_at=None, topic=""):
    return create_telemost_link(
        title=title,
        starts_at=starts_at,
        ends_at=ends_at,
        topic=topic,
    )


def _get_schedule_event(user, event_id):
    pk = parse_local_event_id(event_id)
    if not pk:
        return None
    return ScheduleEvent.objects.select_related("series").filter(owner=user, pk=pk).first()


def _parse_schedule_datetime(value):
    if not value:
        return None
    text = str(value).strip()
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    if timezone.is_naive(parsed):
        return timezone.make_aware(parsed, timezone.get_current_timezone())
    return parsed


def _schedule_times_equal(left, right):
    if left is None or right is None:
        return left is right
    local_left = timezone.localtime(left).replace(second=0, microsecond=0)
    local_right = timezone.localtime(right).replace(second=0, microsecond=0)
    return local_left == local_right


@require_http_methods(["GET"])
def api_schedule_events(request):
    auth_error = _require_authenticated_user(request)
    if auth_error:
        return auth_error

    date_from = _parse_range_param(request.GET.get("from"))
    date_to = _parse_range_param(request.GET.get("to"))
    if not date_from or not date_to:
        return JsonResponse({
            "ok": False,
            "error": "Укажите параметры from и to в формате YYYY-MM-DD.",
        }, status=400)

    events = list_schedule_events(
        user=request.user,
        date_from=date_from,
        date_to=date_to,
    )
    return JsonResponse({
        "ok": True,
        "events": events,
        "source": "local",
    })


@require_http_methods(["POST"])
def api_schedule_create(request):
    auth_error = _require_authenticated_user(request)
    if auth_error:
        return auth_error

    data = _load_json_body(request)
    if data is None:
        return JsonResponse({"ok": False, "error": "Некорректный JSON"}, status=400)

    title = (data.get("title") or "").strip()
    starts_at = _parse_schedule_datetime(data.get("starts_at"))
    ends_at = _parse_schedule_datetime(data.get("ends_at"))
    if not title:
        return JsonResponse({"ok": False, "error": "Укажите название урока."}, status=400)
    if not starts_at or not ends_at:
        return JsonResponse({"ok": False, "error": "Укажите дату и время урока."}, status=400)
    if ends_at <= starts_at:
        return JsonResponse({"ok": False, "error": "Время окончания должно быть позже начала."}, status=400)

    fmt = (data.get("format") or "online").strip().lower()
    is_online = fmt in ("online", "онлайн")
    telemost_url = (data.get("telemost_url") or data.get("link") or "").strip()
    telemost_auto = data.get("telemost_auto_create") is True
    jitsi_auto = data.get("jitsi_auto_create") is True

    if is_online and not telemost_url and telemost_auto and telemost_auto_create_enabled():
        telemost_url, telemost_error = _create_telemost_link_for_user(
            request.user,
            title=title,
            starts_at=starts_at,
            ends_at=ends_at,
            topic=(data.get("topic") or "").strip(),
        )
        if telemost_error or not telemost_url:
            return JsonResponse({
                "ok": False,
                "error": f"Не удалось создать ссылку на звонок: {telemost_error or 'нет ссылки'}",
            }, status=502)

    # Manual Telemost URL wins; otherwise auto-Jitsi when requested.
    if telemost_url:
        meeting_provider = "yandex_telemost"
        jitsi_auto = False
    elif is_online and jitsi_auto:
        meeting_provider = "jitsi"
    else:
        meeting_provider = "none"

    from datetime import datetime as dt

    from .schedule_service import check_conflicts, create_series, create_single_event
    from .video_meeting_service import get_or_create_meeting_for_event

    recurrence_type = (data.get("recurrence_type") or data.get("repeat_type") or "none").strip()
    student_ids = data.get("student_ids") or ([data["student_id"]] if data.get("student_id") else None)
    extra_student_ids = data.get("extra_student_ids")
    group_id = data.get("group_id")
    notify = data.get("notify_participants", True)
    force = data.get("force", False)

    if not force:
        conflicts = check_conflicts(
            teacher=request.user,
            starts_at=starts_at,
            ends_at=ends_at,
            student_id=student_ids[0] if student_ids and len(student_ids) == 1 else None,
            group_id=group_id,
        )
        if conflicts:
            return JsonResponse({
                "ok": False,
                "error": "В это время уже есть занятие.",
                "conflicts": conflicts,
                "code": "schedule_conflict",
            }, status=409)

    event_type = (data.get("type") or data.get("event_type") or "group_lesson").strip()
    if event_type in ("group", "individual"):
        event_type = "group_lesson" if event_type == "group" else "individual_lesson"

    def _ensure_jitsi_meetings(created_events):
        if not (is_online and jitsi_auto):
            return
        for ev in created_events:
            get_or_create_meeting_for_event(event=ev, created_by=request.user)

    student_subject_id = data.get("student_subject_id") or data.get("student_subject")

    if recurrence_type and recurrence_type != "none":
        start_date = starts_at.date()
        series_data = {
            "title": title,
            "description": (data.get("description") or "").strip(),
            "topic": (data.get("topic") or "").strip(),
            "event_type": event_type,
            "lesson": data.get("lesson_id") or data.get("lesson"),
            "lesson_plan_item": data.get("lesson_plan_item_id") or data.get("lesson_plan_item"),
            "homework": data.get("homework_id") or data.get("homework"),
            "timezone": data.get("timezone") or "Europe/Moscow",
            "start_date": start_date,
            "start_time": starts_at.time(),
            "end_time": ends_at.time(),
            "recurrence_type": recurrence_type,
            "recurrence_interval": int(data.get("recurrence_interval") or data.get("repeat_interval") or 1),
            "recurrence_weekdays": data.get("recurrence_weekdays") or data.get("repeat_weekdays") or [],
            "recurrence_until": data.get("recurrence_until") or data.get("repeat_until"),
            "recurrence_count": data.get("recurrence_count") or data.get("repeat_count"),
            "meeting_url": telemost_url if is_online else "",
            "meeting_provider": meeting_provider,
            "format": "online" if is_online else "offline",
            "teacher_comment": (data.get("teacher_comment") or data.get("comment") or "").strip(),
            "materials": (data.get("materials") or "").strip(),
            "reminder_minutes": data.get("reminder_minutes"),
            "notify_participants": notify,
            "student_subject_id": student_subject_id,
        }
        if series_data["recurrence_until"] and isinstance(series_data["recurrence_until"], str):
            series_data["recurrence_until"] = dt.strptime(series_data["recurrence_until"], "%Y-%m-%d").date()
        try:
            series, events = create_series(
                teacher=request.user,
                series_data=series_data,
                student_ids=student_ids,
                group_id=group_id,
                extra_student_ids=extra_student_ids,
                notify=notify,
            )
        except ValueError as exc:
            return JsonResponse({"ok": False, "error": str(exc)}, status=400)
        first = events[0] if events else None
        if not first:
            return JsonResponse({"ok": False, "error": "Не удалось создать занятия серии."}, status=400)
        _ensure_jitsi_meetings(events)
        return JsonResponse({
            "ok": True,
            "event": schedule_event_to_json(first),
            "series_id": series.pk,
            "events_created": len(events),
        }, status=201)

    try:
        event = create_single_event(
            teacher=request.user,
            data={
                "title": title,
                "description": (data.get("description") or "").strip(),
                "topic": (data.get("topic") or "").strip(),
                "starts_at": starts_at,
                "ends_at": ends_at,
                "event_type": event_type,
                "format": ScheduleEvent.Format.ONLINE if is_online else ScheduleEvent.Format.OFFLINE,
                "telemost_url": telemost_url if is_online else "",
                "meeting_provider": meeting_provider,
                "audience": (data.get("audience") or "").strip(),
                "materials": (data.get("materials") or "").strip(),
                "teacher_comment": (data.get("teacher_comment") or data.get("comment") or "").strip(),
                "lesson": data.get("lesson_id") or data.get("lesson"),
                "lesson_plan_item": data.get("lesson_plan_item_id") or data.get("lesson_plan_item"),
                "homework": data.get("homework_id") or data.get("homework"),
                "timezone": data.get("timezone") or "Europe/Moscow",
                "reminder_minutes": data.get("reminder_minutes"),
                "notify_participants": notify,
                "student_subject_id": student_subject_id,
            },
            student_ids=student_ids,
            group_id=group_id,
            extra_student_ids=extra_student_ids,
            notify=notify,
        )
    except ValueError as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=400)
    if data.get("audience"):
        event.audience = data.get("audience")
        event.save(update_fields=["audience"])
    _ensure_jitsi_meetings([event])
    return JsonResponse({"ok": True, "event": schedule_event_to_json(event)}, status=201)


@require_http_methods(["PATCH"])
def api_schedule_update(request, event_id):
    auth_error = _require_authenticated_user(request)
    if auth_error:
        return auth_error

    event = _get_schedule_event(request.user, event_id)
    if not event:
        return JsonResponse({"ok": False, "error": "Урок не найден."}, status=404)

    data = _load_json_body(request)
    if data is None:
        return JsonResponse({"ok": False, "error": "Некорректный JSON"}, status=400)

    from .schedule_service import (
        apply_series_edit,
        cancel_event_with_scope,
        coerce_schedule_datetime,
        move_event_with_scope,
        normalize_series_scope,
        update_event,
    )

    notify = data.get("notify_participants", True)
    scope = normalize_series_scope(data.get("scope"))
    original_start = event.starts_at
    original_end = event.ends_at
    time_rescheduled = False

    if "starts_at" in data or "ends_at" in data:
        new_start = original_start
        new_end = original_end
        if "starts_at" in data:
            parsed = coerce_schedule_datetime(data.get("starts_at"))
            if parsed is None:
                return JsonResponse({"ok": False, "error": "Некорректная дата или время начала."}, status=400)
            new_start = parsed
        if "ends_at" in data:
            parsed = coerce_schedule_datetime(data.get("ends_at"))
            if parsed is None:
                return JsonResponse({"ok": False, "error": "Некорректная дата или время окончания."}, status=400)
            new_end = parsed
        if not _schedule_times_equal(new_start, original_start) or not _schedule_times_equal(new_end, original_end):
            force = data.get("force", False)
            if not force:
                from .schedule_service import check_conflicts, events_for_edit_scope

                exclude_event_ids = [event.pk]
                if scope in ("series", "following"):
                    from .schedule_service import events_for_edit_scope

                    exclude_event_ids = list(
                        events_for_edit_scope(event, scope).values_list("pk", flat=True)
                    )

                conflicts = check_conflicts(
                    teacher=request.user,
                    starts_at=new_start,
                    ends_at=new_end,
                    student_id=event.student_id,
                    group_id=event.group_id,
                    exclude_event_ids=exclude_event_ids,
                )
                if conflicts:
                    return JsonResponse({
                        "ok": False,
                        "error": "В это время уже есть занятие.",
                        "conflicts": conflicts,
                        "code": "schedule_conflict",
                    }, status=409)
            move_event_with_scope(
                event,
                starts_at=new_start,
                ends_at=new_end,
                changed_by=request.user,
                scope=scope,
                notify=notify,
            )
            time_rescheduled = True
            event.refresh_from_db()

    if data.get("status") == ScheduleEvent.Status.CANCELLED:
        plan_cancel_action = (data.get("plan_cancel_action") or data.get("planOnCancel") or "").strip() or None
        cancel_event_with_scope(
            event,
            changed_by=request.user,
            scope=scope,
            notify=notify,
            plan_cancel_action=plan_cancel_action,
        )
        event.refresh_from_db()
        return JsonResponse({"ok": True, "event": schedule_event_to_json(event)})

    update_fields = {}
    if "title" in data:
        update_fields["title"] = (data.get("title") or "").strip() or event.title
    if "topic" in data:
        update_fields["topic"] = (data.get("topic") or "").strip()
    if "type" in data:
        event.event_type = (data.get("type") or event.event_type).strip()
    if "format" in data:
        fmt = (data.get("format") or "").strip().lower()
        event.format = (
            ScheduleEvent.Format.ONLINE
            if fmt in ("online", "онлайн", "Онлайн".lower())
            else ScheduleEvent.Format.OFFLINE
        )
    if "telemost_url" in data or "link" in data:
        update_fields["telemost_url"] = (data.get("telemost_url") or data.get("link") or "").strip()
    if "audience" in data:
        event.audience = (data.get("audience") or "").strip()
    if "materials" in data:
        update_fields["materials"] = (data.get("materials") or "").strip()
    if "teacher_comment" in data or "comment" in data:
        update_fields["teacher_comment"] = (data.get("teacher_comment") or data.get("comment") or "").strip()
    if "reminder_minutes" in data:
        update_fields["reminder_minutes"] = data.get("reminder_minutes")
    if "tags" in data and isinstance(data.get("tags"), list):
        event.tags = data.get("tags")
    if "student_subject" in data or "student_subject_id" in data:
        from .student_subjects import resolve_student_subject_for_write

        ss_id = data.get("student_subject_id")
        if ss_id is None:
            ss_id = data.get("student_subject")
        try:
            ss = resolve_student_subject_for_write(
                teacher=request.user,
                student=event.student,
                student_subject_id=ss_id,
                allow_empty=True,
            )
        except ValueError as exc:
            return JsonResponse({"ok": False, "error": str(exc)}, status=400)
        update_fields["student_subject"] = ss.id if ss else None

    notify_updates = notify and not time_rescheduled

    if scope != "single":
        apply_series_edit(event, scope=scope, changed_by=request.user, data={**data, **update_fields}, notify=notify_updates)
    elif update_fields:
        update_event(event, changed_by=request.user, data=update_fields, notify=notify_updates)
    else:
        event.save()

    event.refresh_from_db()
    return JsonResponse({"ok": True, "event": schedule_event_to_json(event)})


@require_http_methods(["POST"])
def api_schedule_check_conflicts(request):
    auth_error = _require_authenticated_user(request)
    if auth_error:
        return auth_error

    data = _load_json_body(request)
    if data is None:
        return JsonResponse({"ok": False, "error": "Некорректный JSON"}, status=400)

    starts_at = _parse_schedule_datetime(data.get("starts_at"))
    ends_at = _parse_schedule_datetime(data.get("ends_at"))
    if not starts_at or not ends_at:
        return JsonResponse({"ok": False, "error": "Укажите starts_at и ends_at."}, status=400)

    from .schedule_events import parse_local_event_id
    from .schedule_service import check_conflicts

    exclude_id = data.get("exclude_event_id")
    if exclude_id:
        exclude_id = parse_local_event_id(exclude_id) or exclude_id

    student_id = data.get("student_id")
    student_ids = data.get("student_ids")
    if not student_id and student_ids and len(student_ids) == 1:
        student_id = student_ids[0]

    conflicts = check_conflicts(
        teacher=request.user,
        starts_at=starts_at,
        ends_at=ends_at,
        student_id=student_id,
        group_id=data.get("group_id"),
        exclude_event_id=exclude_id,
    )
    return JsonResponse({
        "ok": True,
        "conflicts": conflicts,
        "has_conflicts": bool(conflicts),
    })


@require_http_methods(["DELETE"])
def api_schedule_delete(request, event_id):
    auth_error = _require_authenticated_user(request)
    if auth_error:
        return auth_error

    event = _get_schedule_event(request.user, event_id)
    if not event:
        return JsonResponse({"ok": False, "error": "Урок не найден."}, status=404)

    from .schedule_service import cancel_event_with_scope

    data = _load_json_body(request) or {}
    scope = data.get("scope") or request.GET.get("scope")
    notify = data.get("notify_participants", True)
    plan_cancel_action = (data.get("plan_cancel_action") or data.get("planOnCancel") or "").strip() or None

    cancel_event_with_scope(
        event,
        changed_by=request.user,
        scope=scope,
        notify=notify,
        plan_cancel_action=plan_cancel_action,
    )
    return JsonResponse({"ok": True})


@require_http_methods(["GET"])
def api_calendar_status(request):
    auth_error = _require_authenticated_user(request)
    if auth_error:
        return auth_error

    from .telemost import resolve_telemost_oauth_token

    profile = request.user.profile
    yandex_enabled = calendar_integration_enabled()
    yandex_connected = profile_yandex_calendar_active(profile)
    calendar_source = "yandex" if yandex_connected else "local"
    embed = calendar_embed_config() if yandex_connected else {
        "enabled": False,
        "layer_ids": "",
        "tz_id": "",
        "embed_url": None,
        "help_url": "",
        "display_mode": "local",
    }

    account_email = (profile.yandex_account_email or "").strip()
    if yandex_connected and not account_email:
        token, _ = resolve_telemost_oauth_token()
        account_email = resolve_yandex_account_email(token) or account_email

    return JsonResponse({
        "ok": True,
        "configured": yandex_connected and calendar_is_configured(),
        "authorize_url": calendar_authorize_url(),
        "account_email": account_email or None,
        "calendar_source": calendar_source,
        "yandex_enabled": yandex_enabled,
        "yandex_connected": yandex_connected,
        "telemost_platform": telemost_is_configured(),
        **embed,
    })


@require_http_methods(["GET"])
def api_calendar_events(request):
    auth_error = _require_authenticated_user(request)
    if auth_error:
        return auth_error

    profile = request.user.profile
    if not profile_yandex_calendar_active(profile):
        return JsonResponse({
            "ok": False,
            "error": "Яндекс Календарь отключён. Используется расписание кабинета.",
        }, status=400)

    date_from = _parse_range_param(request.GET.get("from"))
    date_to = _parse_range_param(request.GET.get("to"))
    if not date_from or not date_to:
        return JsonResponse({
            "ok": False,
            "error": "Укажите параметры from и to в формате YYYY-MM-DD.",
        }, status=400)

    events, error = fetch_calendar_events(date_from=date_from, date_to=date_to)
    if error:
        return JsonResponse({"ok": False, "error": error}, status=502)

    return JsonResponse({
        "ok": True,
        "events": events,
        "source": "yandex_calendar",
    })


@require_http_methods(["POST"])
def api_teacher_application(request):
    """Публичная заявка со страницы «Для учителей»."""
    if not rate_limit_check(request, "teacher_application", 8, 3600):
        return rate_limit_json_response("teacher_application")

    try:
        data = json.loads(request.body.decode("utf-8") or "{}")
    except (TypeError, ValueError, UnicodeDecodeError):
        return JsonResponse({"ok": False, "error": "Некорректный JSON"}, status=400)

    if not isinstance(data, dict):
        return JsonResponse({"ok": False, "error": "Некорректные данные"}, status=400)

    name = str(data.get("name") or "").strip()
    contact = str(data.get("contact") or "").strip()
    role = str(data.get("role") or "").strip()[:64]
    teaches = str(data.get("teaches") or "").strip()[:500]
    comment = str(data.get("comment") or "").strip()
    materials_url = str(
        data.get("materialsUrl") or data.get("materials_url") or ""
    ).strip()[:500]
    help_raw = data.get("help") or data.get("help_topics") or []
    if isinstance(help_raw, str):
        help_topics = [help_raw.strip()] if help_raw.strip() else []
    elif isinstance(help_raw, list):
        help_topics = [str(item).strip() for item in help_raw if str(item).strip()][:20]
    else:
        help_topics = []

    if not name:
        return JsonResponse({"ok": False, "error": "Укажите имя"}, status=400)
    if not contact:
        return JsonResponse({"ok": False, "error": "Укажите email или Telegram"}, status=400)
    if not role:
        return JsonResponse({"ok": False, "error": "Выберите, кто вы"}, status=400)
    if not help_topics:
        return JsonResponse({"ok": False, "error": "Выберите хотя бы один вариант помощи"}, status=400)

    if materials_url and not (
        materials_url.startswith("http://") or materials_url.startswith("https://")
    ):
        return JsonResponse(
            {"ok": False, "error": "Ссылка на материалы должна начинаться с http:// или https://"},
            status=400,
        )

    ua = (request.META.get("HTTP_USER_AGENT") or "")[:512]
    application = TeacherApplication.objects.create(
        name=name[:200],
        contact=contact[:255],
        role=role,
        teaches=teaches,
        help_topics=help_topics,
        comment=comment,
        materials_url=materials_url,
        ip_address=client_ip(request) or None,
        user_agent=ua,
    )

    return JsonResponse({
        "ok": True,
        "id": application.id,
        "message": "Заявка отправлена. Мы свяжемся с вами в ближайшее время.",
    })


FEEDBACK_TYPE_ALIASES = {
    "review": TeacherCommunityFeedback.FeedbackType.REVIEW,
    "feature": TeacherCommunityFeedback.FeedbackType.FEATURE,
    "bug": TeacherCommunityFeedback.FeedbackType.BUG,
    "testing": TeacherCommunityFeedback.FeedbackType.TESTING,
    "development": TeacherCommunityFeedback.FeedbackType.DEVELOPMENT,
    "methodology": TeacherCommunityFeedback.FeedbackType.METHODOLOGY,
    "other": TeacherCommunityFeedback.FeedbackType.OTHER,
    # human-readable aliases from the form
    "отзыв о платформе": TeacherCommunityFeedback.FeedbackType.REVIEW,
    "предложение новой функции": TeacherCommunityFeedback.FeedbackType.FEATURE,
    "сообщение об ошибке": TeacherCommunityFeedback.FeedbackType.BUG,
    "участие в тестировании": TeacherCommunityFeedback.FeedbackType.TESTING,
    "хочу помочь с разработкой": TeacherCommunityFeedback.FeedbackType.DEVELOPMENT,
    "методическое сотрудничество": TeacherCommunityFeedback.FeedbackType.METHODOLOGY,
    "другое": TeacherCommunityFeedback.FeedbackType.OTHER,
}


@require_http_methods(["POST"])
def api_teacher_community_feedback(request):
    """Публичная форма обратной связи сообщества учителей."""
    if not rate_limit_check(request, "teacher_community_feedback", 10, 3600):
        return rate_limit_json_response("teacher_community_feedback")

    try:
        data = json.loads(request.body.decode("utf-8") or "{}")
    except (TypeError, ValueError, UnicodeDecodeError):
        return JsonResponse({"ok": False, "error": "Некорректный JSON"}, status=400)

    if not isinstance(data, dict):
        return JsonResponse({"ok": False, "error": "Некорректные данные"}, status=400)

    # Honeypot: bots fill hidden fields; humans leave them empty.
    if str(data.get("website") or data.get("hp") or "").strip():
        return JsonResponse({"ok": True, "id": 0, "message": "Спасибо! Ваше сообщение отправлено."})

    raw_type = str(data.get("feedbackType") or data.get("feedback_type") or "").strip()
    feedback_type = FEEDBACK_TYPE_ALIASES.get(raw_type.lower())
    if not feedback_type:
        return JsonResponse({"ok": False, "error": "Выберите тип обращения"}, status=400)

    message = str(data.get("message") or "").strip()
    if not message:
        return JsonResponse({"ok": False, "error": "Напишите сообщение"}, status=400)
    if len(message) > 5000:
        return JsonResponse({"ok": False, "error": "Сообщение слишком длинное"}, status=400)

    name = str(data.get("name") or "").strip()[:200]
    contact = str(data.get("contact") or "").strip()[:255]
    subject_area = str(
        data.get("subjectArea") or data.get("subject_area") or ""
    ).strip()[:200]
    consent = bool(data.get("consent") or data.get("consent_given"))

    if contact and not consent:
        return JsonResponse(
            {
                "ok": False,
                "error": "Чтобы оставить контакт, отметьте согласие на обработку данных",
            },
            status=400,
        )

    user = request.user if getattr(request, "user", None) and request.user.is_authenticated else None
    ua = (request.META.get("HTTP_USER_AGENT") or "")[:512]
    feedback = TeacherCommunityFeedback.objects.create(
        feedback_type=feedback_type,
        name=name,
        contact=contact,
        subject_area=subject_area,
        message=message,
        user=user,
        consent_given=consent,
        ip_address=client_ip(request) or None,
        user_agent=ua,
    )

    return JsonResponse({
        "ok": True,
        "id": feedback.id,
        "message": "Спасибо! Ваше сообщение отправлено. Именно такие отзывы помогают развивать платформу.",
    })

