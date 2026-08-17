"""Сервис сессий синхронных материалов видеоурока."""

from __future__ import annotations

import logging
from copy import deepcopy
from typing import Any

from django.contrib.auth.models import User
from django.db import transaction
from django.utils import timezone

from .files_services import is_blocked_media_url, material_file_url, material_view_url
from .material_adapters import (
    EPHEMERAL_ACTIONS,
    EXCLUDED_PRESENT_KINDS,
    NAVIGATION_ACTIONS,
    MaterialCollaborationError,
    get_adapter,
    infer_resource_kind,
)
from .meeting_material_models import (
    MeetingMaterialCollaborativeScope,
    MeetingMaterialFollowPolicy,
    MeetingMaterialInteractionMode,
    MeetingMaterialSession,
    MeetingMaterialWork,
)
from .meeting_present import append_meeting_query, list_event_students
from .models import Interactive, Material, VideoMeeting
from .video_meeting_service import VideoMeetingError, assert_can_manage_meeting, resolve_access

logger = logging.getLogger(__name__)

MAX_RECENT_OPERATION_IDS = 300
PERSIST_EVERY_N_VERSIONS = 5


def meeting_material_group_name(meeting_uuid) -> str:
    return f"video_meeting_{meeting_uuid}"


def broadcast_material_event(meeting_uuid, payload: dict) -> None:
    """Синхронная рассылка в channel layer (из REST/сервисного кода)."""
    try:
        from asgiref.sync import async_to_sync
        from channels.layers import get_channel_layer

        layer = get_channel_layer()
        if layer is None:
            return
        async_to_sync(layer.group_send)(
            meeting_material_group_name(meeting_uuid),
            {"type": "meeting.material_event", "payload": payload},
        )
    except Exception:
        logger.exception("material_broadcast_failed meeting=%s", meeting_uuid)


def _append_meeting(url: str, meeting: VideoMeeting) -> str:
    raw = (url or "").strip()
    # API preview/download не нуждаются в ?meeting= — и query ломает PDF-viewer.
    if raw.startswith("/api/cabinet/"):
        return raw
    return append_meeting_query(raw, str(meeting.uuid))


def _storage_key_from_media_url(url: str) -> str:
    """Извлечь storage_key из /media/cabinet/my-files/... или полного URL."""
    raw = (url or "").strip()
    if not raw:
        return ""
    path = raw.split("?", 1)[0]
    marker = "/media/"
    idx = path.find(marker)
    if idx >= 0:
        return path[idx + len(marker) :].lstrip("/")
    if path.startswith("cabinet/"):
        return path.lstrip("/")
    return ""


def _resolve_material_from_open_url(*, teacher, open_url: str, cabinet_file_id=None) -> Material | None:
    """Восстановить Material, если клиент прислал только media/API URL без materialId."""
    if cabinet_file_id:
        material = Material.objects.filter(teacher=teacher, cabinet_file_id=cabinet_file_id).first()
        if material:
            return material
    key = _storage_key_from_media_url(open_url)
    if key:
        material = Material.objects.filter(teacher=teacher, file=key).first()
        if material:
            return material
        material = Material.objects.filter(teacher=teacher, cabinet_file__storage_key=key).first()
        if material:
            return material
    # /api/cabinet/files/<uuid>/preview|download/
    api_marker = "/api/cabinet/files/"
    path = (open_url or "").split("?", 1)[0]
    if api_marker in path:
        tail = path.split(api_marker, 1)[1]
        file_id = tail.split("/", 1)[0]
        if file_id:
            return Material.objects.filter(teacher=teacher, cabinet_file_id=file_id).first()
    return None


def _grant_material_file_access_to_event_students(*, meeting: VideoMeeting, material: Material) -> None:
    """Выдать ученикам урока доступ к файлу материала на время показа."""
    if not material or not material.cabinet_file_id:
        return
    from .files_models import CabinetFileRelation, CabinetFileRelationType

    file_id = material.cabinet_file_id
    for student in list_event_students(meeting.schedule_event):
        exists = CabinetFileRelation.objects.filter(
            file_id=file_id,
            relation_type=CabinetFileRelationType.STUDENT,
            student=student,
        ).exists()
        if exists:
            continue
        CabinetFileRelation.objects.create(
            file_id=file_id,
            relation_type=CabinetFileRelationType.STUDENT,
            student=student,
            material=material,
            created_by=meeting.schedule_event.owner,
        )


def _safe_open_url_for_user(
    *,
    meeting: VideoMeeting,
    user: User | None,
    open_url: str,
    material: Material | None,
) -> str:
    url = (open_url or "").strip()
    access = resolve_access(user, meeting.schedule_event) if user else None
    for_student = bool(access and access.role == "student")

    # Всегда предпочитаем безопасный API preview для материалов из хранилища.
    if material is not None:
        view_url = material_view_url(material, for_student=for_student)
        if view_url:
            url = view_url
        elif is_blocked_media_url(url):
            # Клиент прислал /media/cabinet/my-files/… — так открывать нельзя.
            fallback = material_file_url(material, for_student=for_student) or (material.external_url or "")
            url = "" if is_blocked_media_url(fallback) else fallback
        elif not url:
            url = material.external_url or ""
            if is_blocked_media_url(url):
                url = ""
    elif is_blocked_media_url(url):
        url = ""

    return _append_meeting(url, meeting)


def serialize_material_session(
    session: MeetingMaterialSession | None,
    *,
    user: User | None = None,
    include_state: bool = True,
) -> dict | None:
    if session is None or not session.is_active:
        return None
    open_url = _safe_open_url_for_user(
        meeting=session.meeting,
        user=user,
        open_url=session.open_url,
        material=session.material,
    )
    payload = {
        "sessionId": session.pk,
        "sessionUuid": str(session.uuid),
        "lessonId": session.meeting.schedule_event_id,
        "meetingUuid": str(session.meeting.uuid),
        "material": {
            "id": session.material_id,
            "interactiveId": session.interactive_id,
            "cabinetFileId": session.cabinet_file_id,
            "type": session.resource_kind,
            "title": session.title or "",
            "openUrl": open_url,
            "contentText": session.content_text or "",
        },
        "interactionMode": session.interaction_mode,
        "followPolicy": session.follow_policy,
        "controllerUserId": session.controller_id,
        "collaborativeScope": session.collaborative_scope,
        "collaborativeUserIds": list(session.collaborative_user_ids or []),
        "collaborationPermission": getattr(session, "collaboration_permission", None) or "annotate",
        "independentUserIds": list(session.independent_user_ids or []),
        "version": session.version,
        "openedAt": session.opened_at.isoformat() if session.opened_at else None,
        "updatedAt": session.updated_at.isoformat() if session.updated_at else None,
        "isActive": session.is_active,
    }
    if include_state:
        state = deepcopy(session.current_state or {})
        # Ученик не видит ответы других; учитель/staff — полную картину.
        if user is not None:
            access = resolve_access(user, session.meeting.schedule_event)
            if access.role == "student":
                state = _personalize_student_state(state, user.pk)
        payload["state"] = state
    return payload


def _personalize_student_state(state: dict, user_id: int) -> dict:
    """Оставляет ученику только свои answers/fields; навигация общая."""
    out = deepcopy(state) if state else {}
    user_key = str(user_id)
    for bucket_name in ("answers", "fields"):
        bucket = out.get(bucket_name)
        if not isinstance(bucket, dict):
            continue
        # Per-user: {userId: {itemId: row}}
        if user_key in bucket and isinstance(bucket.get(user_key), dict):
            sample = next(iter(bucket[user_key].values()), None)
            if isinstance(sample, dict) and ("value" in sample or "author_id" in sample):
                out[bucket_name] = {user_key: bucket[user_key]}
                continue
        # Legacy flat: {itemId: {value, author_id}}
        mine = {}
        for item_id, row in bucket.items():
            if not isinstance(row, dict):
                continue
            if "value" in row or "author_id" in row:
                if int(row.get("author_id") or 0) == int(user_id):
                    mine[item_id] = row
        out[bucket_name] = {user_key: mine} if mine else {user_key: {}}
    return out


def get_active_material_session(meeting: VideoMeeting) -> MeetingMaterialSession | None:
    return (
        MeetingMaterialSession.objects.filter(meeting=meeting, is_active=True)
        .select_related("material", "interactive", "meeting", "meeting__schedule_event")
        .order_by("-opened_at")
        .first()
    )


def user_can_collaborate(session: MeetingMaterialSession, user: User, role: str) -> bool:
    if role in ("teacher", "coteacher", "staff"):
        return True
    if session.interaction_mode != MeetingMaterialInteractionMode.COLLABORATIVE:
        return False
    if session.collaborative_scope == MeetingMaterialCollaborativeScope.ALL:
        return role == "student"
    allowed = {int(x) for x in (session.collaborative_user_ids or []) if str(x).isdigit() or isinstance(x, int)}
    return user.pk in allowed


def student_can_navigate_independently(session: MeetingMaterialSession, user: User) -> bool:
    """Самостоятельный просмотр: room-wide independent или персональный whitelist."""
    if session.follow_policy == MeetingMaterialFollowPolicy.INDEPENDENT:
        return True
    ids = session.independent_user_ids or []
    return user.pk in {int(x) for x in ids if str(x).isdigit() or isinstance(x, int)}


def user_is_material_controller(session: MeetingMaterialSession, user: User, role: str) -> bool:
    if role == "staff":
        return True
    if session.controller_id:
        return session.controller_id == user.pk
    return role in ("teacher", "coteacher", "staff")


def _assert_material_access(*, meeting: VideoMeeting, user: User, material: Material | None) -> None:
    if material is None:
        return
    event = meeting.schedule_event
    owner_id = event.owner_id
    if material.teacher_id and material.teacher_id != owner_id and material.teacher_id != user.pk:
        if not material.is_public and not user.is_staff:
            raise VideoMeetingError("Нет доступа к материалу", code="forbidden", status=403)
    if material.teacher_id is None and material.owner_id and not material.is_public:
        # Платформенный материал — ок, если публичный или прикреплён к плану урока.
        pass


def _assert_interactive_access(*, meeting: VideoMeeting, user: User, interactive: Interactive | None) -> None:
    if interactive is None:
        return
    if interactive.teacher_id not in (None, meeting.schedule_event.owner_id, user.pk) and not user.is_staff:
        raise VideoMeetingError("Нет доступа к интерактиву", code="forbidden", status=403)


def _deactivate_active_sessions(meeting: VideoMeeting, *, save_work: bool = True) -> None:
    active = MeetingMaterialSession.objects.filter(meeting=meeting, is_active=True)
    now = timezone.now()
    for session in active:
        if save_work:
            _persist_work(session)
        session.is_active = False
        session.closed_at = now
        session.interaction_mode = MeetingMaterialInteractionMode.VIEW_ONLY
        session.save(update_fields=["is_active", "closed_at", "interaction_mode", "updated_at"])


def _persist_work(session: MeetingMaterialSession) -> MeetingMaterialWork:
    authors: dict[int, dict] = {}
    state = session.current_state or {}
    for bucket_name in ("annotations", "notes", "pairs"):
        for row in state.get(bucket_name) or []:
            if not isinstance(row, dict):
                continue
            aid = row.get("author_id")
            if aid is None:
                continue
            authors[int(aid)] = {
                "userId": int(aid),
                "role": row.get("author_role") or "",
            }
    for bucket_name in ("answers", "fields", "items"):
        bucket = state.get(bucket_name) or {}
        if not isinstance(bucket, dict):
            continue
        for row in bucket.values():
            if not isinstance(row, dict):
                continue
            aid = row.get("author_id")
            if aid is None:
                continue
            authors[int(aid)] = {
                "userId": int(aid),
                "role": row.get("author_role") or "",
            }

    work, _created = MeetingMaterialWork.objects.update_or_create(
        session=session,
        defaults={
            "meeting": session.meeting,
            "title": session.title,
            "resource_kind": session.resource_kind,
            "state": deepcopy(state),
            "authors": list(authors.values()),
            "version": session.version,
        },
    )
    return work


def open_material_session(
    *,
    meeting: VideoMeeting,
    user: User,
    resource_kind: str = "",
    title: str = "",
    open_url: str = "",
    content_text: str = "",
    material_id=None,
    interactive_id=None,
    cabinet_file_id=None,
    row_kind: str = "",
    material_type: str = "",
    interactive_type: str = "",
    initial_state: dict | None = None,
) -> MeetingMaterialSession:
    assert_can_manage_meeting(user, meeting)
    if meeting.status != VideoMeeting.Status.LIVE:
        raise VideoMeetingError("Открыть материал можно только во время урока", code="not_live", status=409)

    material = None
    if material_id:
        material = Material.objects.filter(pk=material_id).first()
        if material is None:
            raise VideoMeetingError("Материал не найден", code="not_found", status=404)
    elif open_url or cabinet_file_id:
        material = _resolve_material_from_open_url(
            teacher=meeting.schedule_event.owner,
            open_url=open_url,
            cabinet_file_id=cabinet_file_id,
        )

    if material is not None:
        _assert_material_access(meeting=meeting, user=user, material=material)
        title = title or material.title
        material_type = material_type or material.material_type
        # Не сохраняем /media/cabinet/my-files/ — только API preview или внешнюю ссылку.
        open_url = (
            material_view_url(material, for_student=False)
            or material_file_url(material, for_student=False)
            or (material.external_url or "")
            or ("" if is_blocked_media_url(open_url) else open_url)
        )
        if not content_text:
            content_text = material.content or ""
        _grant_material_file_access_to_event_students(meeting=meeting, material=material)
    elif is_blocked_media_url(open_url):
        raise VideoMeetingError(
            "Файл нельзя открыть напрямую. Прикрепите материал из хранилища и откройте снова.",
            code="blocked_media",
            status=400,
        )

    interactive = None
    if interactive_id:
        interactive = Interactive.objects.filter(pk=interactive_id).first()
        if interactive is None:
            raise VideoMeetingError("Интерактив не найден", code="not_found", status=404)
        _assert_interactive_access(meeting=meeting, user=user, interactive=interactive)
        title = title or interactive.title
        interactive_type = interactive_type or interactive.interactive_type
        if not open_url:
            open_url = f"/cabinet/interactives/{interactive.id}"

    kind = (resource_kind or "").strip().lower() or infer_resource_kind(
        row_kind=row_kind,
        material_type=material_type,
        interactive_type=interactive_type,
        url=open_url,
        has_text=bool(content_text),
    )
    if not kind or kind in EXCLUDED_PRESENT_KINDS:
        raise VideoMeetingError(
            "Этот тип материала синхронизируется отдельно (доска/вариант)",
            code="excluded_kind",
            status=400,
        )

    adapter = get_adapter(kind)
    state = adapter.initial_state()
    if isinstance(initial_state, dict):
        state.update({k: v for k, v in initial_state.items() if k in state or k in ("annotations", "answers", "fields", "items", "pairs", "notes")})

    # При открытии синхронного материала снимаем показ board/variant, чтобы режимы не конфликтовали.
    from .meeting_present import clear_presented

    with transaction.atomic():
        if meeting.presented_kind:
            clear_presented(meeting=meeting, user=user)
            meeting.refresh_from_db(fields=["presented_kind", "presented_payload", "presented_at", "presented_by"])
        _deactivate_active_sessions(meeting, save_work=True)
        session = MeetingMaterialSession.objects.create(
            meeting=meeting,
            material=material,
            interactive=interactive,
            cabinet_file_id=cabinet_file_id or getattr(material, "cabinet_file_id", None),
            resource_kind=kind,
            title=(title or "Материал")[:255],
            open_url=(open_url or "")[:1024],
            content_text=content_text or "",
            opened_by=user,
            controller=user,
            interaction_mode=MeetingMaterialInteractionMode.VIEW_ONLY,
            follow_policy=MeetingMaterialFollowPolicy.STRICT,
            collaborative_scope=MeetingMaterialCollaborativeScope.ALL,
            collaborative_user_ids=[],
            independent_user_ids=[],
            current_state=state,
            recent_operation_ids=[],
            is_active=True,
            version=1,
            opened_at=timezone.now(),
        )

    logger.info(
        "material_session_opened meeting=%s session=%s kind=%s user=%s",
        meeting.uuid,
        session.pk,
        kind,
        user.pk,
    )
    return session


def close_material_session(*, meeting: VideoMeeting, user: User, session_id=None) -> None:
    assert_can_manage_meeting(user, meeting)
    closed_ids: list[int] = []
    with transaction.atomic():
        qs = MeetingMaterialSession.objects.filter(meeting=meeting, is_active=True)
        if session_id:
            qs = qs.filter(pk=session_id)
        now = timezone.now()
        for session in qs:
            _persist_work(session)
            session.is_active = False
            session.closed_at = now
            session.interaction_mode = MeetingMaterialInteractionMode.VIEW_ONLY
            session.save(update_fields=["is_active", "closed_at", "interaction_mode", "updated_at"])
            closed_ids.append(session.pk)
            logger.info(
                "material_session_closed meeting=%s session=%s user=%s",
                meeting.uuid,
                session.pk,
                user.pk,
            )
    for sid in closed_ids:
        broadcast_material_event(
            meeting.uuid,
            {
                "type": "material.closed",
                "session_id": sid,
                "meetingUuid": str(meeting.uuid),
            },
        )


def set_interaction_mode(
    *,
    meeting: VideoMeeting,
    user: User,
    mode: str,
    session_id=None,
    collaborative_scope: str | None = None,
    collaborative_user_ids: list | None = None,
    collaboration_permission: str | None = None,
) -> MeetingMaterialSession:
    assert_can_manage_meeting(user, meeting)
    meeting.refresh_from_db(fields=["status"])
    if meeting.status != VideoMeeting.Status.LIVE:
        raise VideoMeetingError("Урок не активен", code="not_live", status=409)
    mode = (mode or "").strip().lower()
    if mode not in MeetingMaterialInteractionMode.values:
        raise VideoMeetingError("Некорректный режим", code="invalid_mode", status=400)

    session = get_active_material_session(meeting)
    if session is None or (session_id and session.pk != int(session_id)):
        raise VideoMeetingError("Нет активной сессии материала", code="no_session", status=404)

    session.interaction_mode = mode
    update_fields = ["interaction_mode", "updated_at"]
    if collaborative_scope is not None:
        scope = (collaborative_scope or "").strip().lower()
        if scope not in MeetingMaterialCollaborativeScope.values:
            raise VideoMeetingError("Некорректный scope", code="invalid_scope", status=400)
        session.collaborative_scope = scope
        update_fields.append("collaborative_scope")
    if collaborative_user_ids is not None:
        if not isinstance(collaborative_user_ids, list):
            raise VideoMeetingError("collaborativeUserIds должен быть списком", code="invalid", status=400)
        # Только ученики текущего урока.
        roster_user_ids = {
            s.user_id for s in list_event_students(meeting.schedule_event) if s.user_id
        }
        cleaned = []
        for raw in collaborative_user_ids[:50]:
            try:
                uid = int(raw)
            except (TypeError, ValueError):
                continue
            if uid in roster_user_ids:
                cleaned.append(uid)
        session.collaborative_user_ids = cleaned
        update_fields.append("collaborative_user_ids")
        if cleaned and session.collaborative_scope == MeetingMaterialCollaborativeScope.ALL:
            session.collaborative_scope = MeetingMaterialCollaborativeScope.SELECTED
            if "collaborative_scope" not in update_fields:
                update_fields.append("collaborative_scope")
    if collaboration_permission is not None:
        from .meeting_material_models import MeetingMaterialCollaborationPermission
        perm = (collaboration_permission or "").strip().lower()
        if perm not in MeetingMaterialCollaborationPermission.values:
            raise VideoMeetingError("Некорректные права совместной работы", code="invalid_permission", status=400)
        session.collaboration_permission = perm
        update_fields.append("collaboration_permission")

    session.save(update_fields=update_fields)
    logger.info(
        "material_permission_changed meeting=%s session=%s mode=%s perm=%s user=%s",
        meeting.uuid,
        session.pk,
        mode,
        getattr(session, "collaboration_permission", ""),
        user.pk,
    )
    return session


def set_follow_policy(
    *,
    meeting: VideoMeeting,
    user: User,
    policy: str,
    session_id=None,
    independent_user_ids: list | None = None,
) -> MeetingMaterialSession:
    """strict / independent + опциональный список учеников в самостоятельном режиме."""
    assert_can_manage_meeting(user, meeting)
    meeting.refresh_from_db(fields=["status"])
    if meeting.status != VideoMeeting.Status.LIVE:
        raise VideoMeetingError("Урок не активен", code="not_live", status=409)
    policy = (policy or "").strip().lower()
    if policy not in MeetingMaterialFollowPolicy.values:
        raise VideoMeetingError("Некорректная политика следования", code="invalid_policy", status=400)

    session = get_active_material_session(meeting)
    if session is None or (session_id and session.pk != int(session_id)):
        raise VideoMeetingError("Нет активной сессии материала", code="no_session", status=404)
    if not user_is_material_controller(session, user, resolve_access(user, meeting.schedule_event).role):
        raise VideoMeetingError("Управление материалом у другого ведущего", code="not_controller", status=403)

    session.follow_policy = policy
    update_fields = ["follow_policy", "updated_at"]
    if independent_user_ids is not None:
        roster_user_ids = {
            s.user_id for s in list_event_students(meeting.schedule_event) if s.user_id
        }
        cleaned = []
        for raw in (independent_user_ids or [])[:50]:
            try:
                uid = int(raw)
            except (TypeError, ValueError):
                continue
            if uid in roster_user_ids:
                cleaned.append(uid)
        session.independent_user_ids = cleaned
        update_fields.append("independent_user_ids")
    session.save(update_fields=update_fields)
    logger.info(
        "material_follow_policy meeting=%s session=%s policy=%s user=%s",
        meeting.uuid,
        session.pk,
        policy,
        user.pk,
    )
    return session


def transfer_material_control(
    *,
    meeting: VideoMeeting,
    user: User,
    to_user_id: int,
    session_id=None,
) -> MeetingMaterialSession:
    """Передать управление материалом соучителю / вернуть себе."""
    access = resolve_access(user, meeting.schedule_event)
    if access.role not in ("teacher", "coteacher", "staff"):
        raise VideoMeetingError("Нет прав", code="forbidden", status=403)
    session = get_active_material_session(meeting)
    if session is None or (session_id and session.pk != int(session_id)):
        raise VideoMeetingError("Нет активной сессии материала", code="no_session", status=404)

    # Передать может текущий controller или владелец урока / staff.
    is_owner = meeting.schedule_event.owner_id == user.pk
    if session.controller_id and session.controller_id != user.pk and not is_owner and access.role != "staff":
        raise VideoMeetingError("Сейчас управляет другой ведущий", code="not_controller", status=403)

    try:
        to_uid = int(to_user_id)
    except (TypeError, ValueError) as exc:
        raise VideoMeetingError("Некорректный user id", code="invalid", status=400) from exc

    target = User.objects.filter(pk=to_uid).first()
    if target is None:
        raise VideoMeetingError("Пользователь не найден", code="not_found", status=404)
    target_access = resolve_access(target, meeting.schedule_event)
    if not target_access.allowed or target_access.role not in ("teacher", "coteacher", "staff"):
        raise VideoMeetingError("Передать управление можно только соучителю", code="invalid_target", status=400)

    session.controller_id = to_uid
    session.save(update_fields=["controller_id", "updated_at"])
    logger.info(
        "material_control_transferred meeting=%s session=%s from=%s to=%s",
        meeting.uuid,
        session.pk,
        user.pk,
        to_uid,
    )
    return session


def apply_material_operation(
    *,
    meeting: VideoMeeting,
    user: User,
    action: str,
    payload: dict | None,
    operation_id: str,
    session_id=None,
    base_version: int | None = None,
) -> dict[str, Any]:
    """Применить операцию. Возвращает результат для рассылки."""
    access = resolve_access(user, meeting.schedule_event)
    if not access.allowed:
        raise VideoMeetingError(access.reason or "Доступ запрещён", code="forbidden", status=403)
    meeting.refresh_from_db(fields=["status"])
    if meeting.status != VideoMeeting.Status.LIVE:
        raise VideoMeetingError("Урок завершён или не начат", code="not_live", status=409)

    action = (action or "").strip()
    operation_id = str(operation_id or "").strip()[:64]
    if not operation_id:
        raise VideoMeetingError("operation_id обязателен", code="invalid", status=400)
    if not action:
        raise VideoMeetingError("action обязателен", code="invalid", status=400)
    if len(str(payload or {})) > 48_000:
        raise VideoMeetingError("Слишком большой payload", code="payload_too_large", status=413)

    # Курсор/указка/предпросмотр штриха не пишутся в БД и не меняют версию —
    # не берём select_for_update() на строку сессии для них: раньше каждое
    # движение курсора вставало в очередь за реальными правками (и другими
    # курсорами) через один и тот же row-lock, из-за чего рисование/курсоры
    # заметно лагали при нескольких участниках.
    if action in EPHEMERAL_ACTIONS:
        session = MeetingMaterialSession.objects.filter(meeting=meeting, is_active=True).first()
        if session is None:
            raise VideoMeetingError("Нет активного материала", code="no_session", status=404)
        if session_id and int(session_id) != session.pk:
            raise VideoMeetingError("Сессия материала не совпадает", code="session_mismatch", status=409)
        role = access.role
        can_collab = user_can_collaborate(session, user, role)
        if role == "student" and action not in ("cursor", "pointer", "student_viewport") and not can_collab:
            raise VideoMeetingError("Режим просмотра: действие запрещено", code="view_only", status=403)
        if role not in ("teacher", "coteacher", "staff", "student"):
            raise VideoMeetingError("Нет прав", code="forbidden", status=403)
        return {
            "duplicate": False,
            "ephemeral": True,
            "session": session,
            "operation": {
                "type": "material.cursor" if action in ("cursor", "pointer") else f"material.{action}",
                "session_id": session.pk,
                "operation_id": operation_id,
                "author_id": user.pk,
                "author_role": role,
                "display_name": (
                    (getattr(getattr(user, "profile", None), "name", None) or "").strip()
                    or f"{getattr(user, 'first_name', '')} {getattr(user, 'last_name', '')}".strip()
                    or getattr(user, "username", "")
                    or "Участник"
                )[:120],
                "action": action,
                "payload": payload if isinstance(payload, dict) else {},
                "base_version": session.version,
                "version": session.version,
            },
            "version": session.version,
        }

    with transaction.atomic():
        session = (
            MeetingMaterialSession.objects.select_for_update()
            .filter(meeting=meeting, is_active=True)
            .first()
        )
        if session is None:
            raise VideoMeetingError("Нет активного материала", code="no_session", status=404)
        if session_id and int(session_id) != session.pk:
            raise VideoMeetingError("Сессия материала не совпадает", code="session_mismatch", status=409)

        recent = list(session.recent_operation_ids or [])
        if operation_id in recent:
            return {
                "duplicate": True,
                "session": session,
                "operation": None,
                "version": session.version,
            }

        role = access.role
        # coteacher действует как teacher для адаптера прав.
        adapter_role = "teacher" if role in ("teacher", "coteacher", "staff") else role
        can_collab = user_can_collaborate(session, user, role)
        can_browse = student_can_navigate_independently(session, user) if role == "student" else True
        adapter = get_adapter(session.resource_kind)
        allowed = adapter.allowed_actions_for(
            role=adapter_role,
            interaction_mode=session.interaction_mode,
            can_collaborate=can_collab,
            can_browse_independently=can_browse,
            collaboration_permission=getattr(session, "collaboration_permission", None) or "annotate",
        )

        if action not in allowed:
            logger.info(
                "material_op_forbidden meeting=%s session=%s user=%s role=%s action=%s mode=%s",
                meeting.uuid,
                session.pk,
                user.pk,
                role,
                action,
                session.interaction_mode,
            )
            raise VideoMeetingError("Действие запрещено", code="forbidden", status=403)

        # Навигация учеником: independent follow / collaborative / персональный whitelist.
        if role == "student" and action in NAVIGATION_ACTIONS:
            if not can_browse and not (session.interaction_mode == "collaborative" and can_collab):
                raise VideoMeetingError("Навигацией управляет преподаватель", code="nav_locked", status=403)

        # Глобальную позицию меняет только текущий controller (учитель/соучитель).
        if adapter_role == "teacher" and action in NAVIGATION_ACTIONS:
            if not user_is_material_controller(session, user, role):
                raise VideoMeetingError(
                    "Сейчас материалом управляет другой ведущий. Запросите передачу управления.",
                    code="not_controller",
                    status=403,
                )

        if base_version is not None and int(base_version) > int(session.version) + 50:
            raise VideoMeetingError("Некорректная base_version", code="version_conflict", status=409)

        clean_payload = adapter.validate_payload(action, payload if isinstance(payload, dict) else {})
        try:
            next_state = adapter.apply_operation(
                session.current_state or {},
                action=action,
                payload=clean_payload,
                author_id=user.pk,
                author_role=role,
            )
        except MaterialCollaborationError as exc:
            raise VideoMeetingError(exc.message, code=exc.code, status=exc.status) from exc

        new_version = int(session.version) + 1
        recent.append(operation_id)
        if len(recent) > MAX_RECENT_OPERATION_IDS:
            recent = recent[-MAX_RECENT_OPERATION_IDS:]

        session.current_state = next_state
        session.version = new_version
        session.recent_operation_ids = recent
        session.save(update_fields=["current_state", "version", "recent_operation_ids", "updated_at"])

        if new_version % PERSIST_EVERY_N_VERSIONS == 0:
            _persist_work(session)

        operation = {
            "type": "material.operation",
            "session_id": session.pk,
            "operation_id": operation_id,
            "author_id": user.pk,
            "author_role": role,
            "action": action,
            "payload": clean_payload,
            "base_version": base_version if base_version is not None else new_version - 1,
            "version": new_version,
        }
        return {
            "duplicate": False,
            "ephemeral": False,
            "session": session,
            "operation": operation,
            "version": new_version,
        }


def finalize_material_sessions_for_meeting(meeting: VideoMeeting) -> None:
    """Вызывается при завершении урока."""
    with transaction.atomic():
        active = MeetingMaterialSession.objects.select_for_update().filter(meeting=meeting, is_active=True)
        now = timezone.now()
        for session in active:
            session.interaction_mode = MeetingMaterialInteractionMode.VIEW_ONLY
            _persist_work(session)
            session.is_active = False
            session.closed_at = now
            session.save(update_fields=["interaction_mode", "is_active", "closed_at", "updated_at"])
            logger.info(
                "material_session_finalized meeting=%s session=%s",
                meeting.uuid,
                session.pk,
            )


def sync_state_payload(meeting: VideoMeeting, user: User) -> dict:
    session = get_active_material_session(meeting)
    access = resolve_access(user, meeting.schedule_event)
    can_collab = bool(
        session and user_can_collaborate(session, user, access.role)
    )
    from .meeting_present import serialize_presented
    from .meeting_screenshare import screenshare_sync_payload

    payload = {
        "type": "material.sync_state",
        "meetingUuid": str(meeting.uuid),
        "role": access.role,
        "canCollaborate": can_collab,
        "server_revision": session.version if session else 0,
        "materialSession": serialize_material_session(session, user=user, include_state=True),
        "presented": serialize_presented(meeting, user=user),
    }
    payload.update(screenshare_sync_payload(meeting))
    return payload
