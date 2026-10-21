"""r91: безопасный вход по ссылке на урок и OAuth-регистрация с выбором роли.

- Новый email через Яндекс/VK без явной роли -> экран «Я ученик / Я преподаватель»
  (не создаём молча пустой аккаунт учителя).
- Публичная подсказка для ссылки на комнату: маскированный email ученика урока.
- Ссылка на завершённый урок серии -> текущий/следующий урок той же серии.
"""
import json
import logging
import re
import time
from urllib.parse import urlencode

from django.contrib.auth import get_user_model
from django.db import transaction
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.http import require_http_methods

from .models import Profile, ScheduleEvent, SocialAccount, VideoMeeting

logger = logging.getLogger(__name__)
User = get_user_model()

PENDING_KEY = "oauth_pending"
PENDING_TTL = 15 * 60
MEETING_RE = re.compile(r"^/cabinet/meetings/([0-9a-fA-F-]{32,36})/?(?:[?#].*)?$")
STUDENT_PREFIXES = ("/cabinet/meetings/", "/cabinet/student", "/cabinet/join", "/join/", "/invite/")
PROVIDER_LABELS = {"yandex": "Яндекс ID", "vk": "VK ID"}


def mask_email(email):
    email = (email or "").strip()
    if "@" not in email:
        return ""
    local, domain = email.rsplit("@", 1)
    if not local or not domain:
        return ""
    return f"{local[:2] if len(local) > 2 else local[:1]}***@{domain.lower()}"


def is_student_link(next_path):
    return any(str(next_path or "").startswith(p) for p in STUDENT_PREFIXES)


def meeting_from_next(next_path):
    m = MEETING_RE.match(str(next_path or ""))
    if not m:
        return None
    try:
        return VideoMeeting.objects.select_related("schedule_event__student__user").filter(uuid=m.group(1)).first()
    except Exception:  # невалидный uuid
        return None


def meeting_student_user(meeting):
    ev = getattr(meeting, "schedule_event", None)
    st = getattr(ev, "student", None) if ev else None
    return getattr(st, "user", None) if st else None


def meeting_hint_email(meeting):
    u = meeting_student_user(meeting) if meeting else None
    if u and u.email:
        return mask_email(u.email)
    st = getattr(getattr(meeting, "schedule_event", None), "student", None) if meeting else None
    return mask_email(getattr(st, "email", "")) if st else ""


def _viewer_in_event(user, ev):
    if ev.student_id and ev.student and ev.student.user_id == user.id:
        return True
    if ev.group_id:
        try:
            return ev.group.students.filter(user_id=user.id).exists()
        except Exception:
            return False
    return False


def _is_finished(meeting, ev, now):
    if meeting.status in (VideoMeeting.Status.FINISHED, VideoMeeting.Status.CANCELLED):
        return True
    if ev.status in (ScheduleEvent.Status.DONE, ScheduleEvent.Status.COMPLETED, ScheduleEvent.Status.CANCELLED):
        return True
    return meeting.status == VideoMeeting.Status.SCHEDULED and ev.ends_at < now


def next_series_target(ev, now=None):
    """Путь к текущему/следующему уроку той же серии (того же ученика/группы) или None."""
    if not ev.series_id:
        return None
    now = now or timezone.now()
    qs = ScheduleEvent.objects.filter(series_id=ev.series_id, ends_at__gte=now).exclude(
        status__in=(ScheduleEvent.Status.CANCELLED, ScheduleEvent.Status.MOVED, ScheduleEvent.Status.SKIPPED,
                    ScheduleEvent.Status.DRAFT)).exclude(pk=ev.pk)
    if ev.student_id:
        qs = qs.filter(student_id=ev.student_id)
    elif ev.group_id:
        qs = qs.filter(group_id=ev.group_id)
    nxt = qs.order_by("starts_at").first()
    if not nxt:
        return None
    vm = VideoMeeting.objects.filter(schedule_event=nxt).only("uuid").first()
    if vm:
        return f"/cabinet/meetings/{vm.uuid}"
    return f"/cabinet/student/lessons/room/{nxt.pk}"


@require_http_methods(["GET"])
def meeting_entry(request, meeting_uuid):
    """Публично: что показать по ссылке на комнату. Персональных данных — только маска email."""
    try:
        meeting = VideoMeeting.objects.select_related("schedule_event__student__user", "schedule_event__group").get(
            uuid=meeting_uuid)
    except (VideoMeeting.DoesNotExist, ValueError, Exception):
        return JsonResponse({"error": "not_found"}, status=404)
    ev = meeting.schedule_event
    now = timezone.now()
    finished = _is_finished(meeting, ev, now)
    user = request.user
    if not user.is_authenticated:
        return JsonResponse({
            "authenticated": False,
            "finished": finished,
            "student_email_hint": meeting_hint_email(meeting),
            "next": f"/cabinet/meetings/{meeting.uuid}",
        })
    is_student = _viewer_in_event(user, ev)
    data = {"authenticated": True, "finished": finished, "is_student": is_student, "redirect": None,
            "finished_no_next": False}
    if is_student and finished:
        target = next_series_target(ev, now)
        if target:
            data["redirect"] = target
        else:
            data["finished_no_next"] = True
    return JsonResponse(data)


# ---------- OAuth: отложенная регистрация с выбором роли ----------

def stash_pending(request, provider, ident, ctx):
    request.session[PENDING_KEY] = {
        "provider": provider,
        "ident": {k: str(ident.get(k) or "") for k in ("uid", "email", "first_name", "last_name")},
        "next": ctx.get("next") or "/cabinet",
        "pd": bool(ctx.get("pd")),
        "mkt": bool(ctx.get("mkt")),
        "ts": int(time.time()),
    }
    request.session.modified = True


def _get_pending(request):
    p = request.session.get(PENDING_KEY)
    if not p or int(time.time()) - int(p.get("ts") or 0) > PENDING_TTL:
        if p:
            request.session.pop(PENDING_KEY, None)
        return None
    return p


def _name_match_student(first, last):
    if not first.strip() or not last.strip():
        return False
    return Profile.objects.filter(role=Profile.Role.STUDENT, name__iexact=first.strip(),
                                  surname__iexact=last.strip()).exists()


@require_http_methods(["GET"])
def oauth_pending(request):
    p = _get_pending(request)
    if not p:
        return JsonResponse({"error": "no_pending"}, status=404)
    ident, nxt = p["ident"], p["next"]
    student_link = is_student_link(nxt)
    meeting = meeting_from_next(nxt) if student_link else None
    return JsonResponse({
        "first_name": ident["first_name"],
        "provider": PROVIDER_LABELS.get(p["provider"], p["provider"]),
        "email_hint": mask_email(ident["email"]),
        "default_role": Profile.Role.STUDENT if student_link else "",
        "student_link": student_link,
        "meeting_student_email_hint": meeting_hint_email(meeting) if meeting else "",
        "name_match_student": _name_match_student(ident["first_name"], ident["last_name"]),
        "next": nxt,
    })


@require_http_methods(["POST"])
def oauth_complete(request):
    from .social_auth import create_oauth_user, finish_login

    p = _get_pending(request)
    if not p:
        return JsonResponse({"error": "Сессия входа устарела, попробуйте ещё раз"}, status=400)
    try:
        body = json.loads(request.body or b"{}")
    except ValueError:
        body = {}
    role = body.get("role")
    if role not in (Profile.Role.STUDENT, Profile.Role.TEACHER):
        return JsonResponse({"error": "Выберите, кто вы: ученик или преподаватель"}, status=400)
    provider, ident = p["provider"], p["ident"]
    with transaction.atomic():
        acc = SocialAccount.objects.select_related("user").filter(provider=provider, uid=ident["uid"]).first()
        if acc:
            user = acc.user
        else:
            user = User.objects.filter(email__iexact=ident["email"]).first() if ident["email"] else None
            if user is None:
                user = create_oauth_user(provider, ident, role, request)
            SocialAccount.objects.create(user=user, provider=provider, uid=ident["uid"], email=ident["email"])
    request.session.pop(PENDING_KEY, None)
    err = finish_login(request, user, provider, p)
    if err:
        return JsonResponse({"error": err}, status=403)
    logger.info("r91 oauth signup provider=%s user=%s role=%s", provider, user.id, role)
    return JsonResponse({"ok": True, "redirect": p["next"] or "/cabinet"})


@require_http_methods(["POST"])
def oauth_cancel(request):
    p = request.session.pop(PENDING_KEY, None) or {}
    nxt = p.get("next") or "/cabinet"
    return JsonResponse({"ok": True, "redirect": "/cabinet/login?" + urlencode({"next": nxt})})
