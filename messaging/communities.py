"""Закрытые сообщества преподавателей. Ученик не получает ни списка, ни факта существования."""

from __future__ import annotations

import secrets
from datetime import timedelta

from django.contrib.auth.models import User
from django.db import IntegrityError, transaction
from django.utils import timezone
from django.utils.text import slugify

from .access import display_name_of, initials_of, presence_of, role_of, teacher_subject_line
from .models import (
    Community,
    CommunityInvite,
    CommunityMember,
    CommunityReport,
    Conversation,
    ConversationParticipant,
    Message,
    MessageMention,
    MessageReaction,
)

REACTION_EMOJIS = ("👍", "❤️", "🔥", "👏", "💡", "🤔")
MENTION_GAP = timedelta(minutes=8)


class CommunityError(Exception):
    def __init__(self, message: str, code: str = "not_found", status: int = 404):
        super().__init__(message)
        self.message = message
        self.code = code
        self.status = status


def platform_admin_user():
    from django.conf import settings

    configured = getattr(settings, "MESSAGING_PLATFORM_ADMIN_ID", None)
    if configured:
        found = User.objects.filter(pk=configured, is_active=True, is_superuser=True).first()
        if found:
            return found
    return User.objects.filter(is_superuser=True, is_active=True).order_by("id").first()


def is_platform_admin(user) -> bool:
    if not user or not getattr(user, "is_authenticated", False):
        return False
    admin = platform_admin_user()
    return bool(admin and admin.id == user.id)


def can_manage_all_communities(user) -> bool:
    if is_platform_admin(user):
        return True
    from .permissions import user_can_staff_messaging
    return user_can_staff_messaging(user, "manage")


def is_teacher_actor(user) -> bool:
    if is_platform_admin(user):
        return True
    return role_of(user) == "teacher"


def _member(community: Community, user):
    if community is None or user is None:
        return None
    return CommunityMember.objects.filter(community=community, user=user).first()


def active_member(community: Community, user):
    row = _member(community, user)
    if row is None or row.left_at or row.is_banned:
        return None
    return row


def community_for_conversation(conversation: Conversation):
    if conversation is None or conversation.kind != Conversation.Kind.COMMUNITY:
        return None
    return Community.objects.filter(conversation=conversation).first()


def community_still_allowed(conversation: Conversation, user) -> bool:
    if conversation.kind != Conversation.Kind.COMMUNITY:
        return True
    if not is_teacher_actor(user):
        return False
    community = community_for_conversation(conversation)
    member = active_member(community, user)
    if community is None or member is None:
        return False
    if not community.is_active and not is_platform_admin(user):
        return False
    if community.is_archived and member.role != CommunityMember.Role.ADMIN and not is_platform_admin(user):
        return False
    return True


def _sync_participant(conversation: Conversation, user, *, hidden: bool):
    participant, _ = ConversationParticipant.objects.get_or_create(
        conversation=conversation,
        user=user,
        defaults={"participant_role": ConversationParticipant.Role.OWNER},
    )
    participant.hidden_at = timezone.now() if hidden else None
    participant.save(update_fields=["hidden_at"])
    return participant


def _mark_history_read(community: Community, user):
    """Новый участник не получает старую историю как непрочитанную."""
    latest = (
        Message.objects.filter(
            conversation=community.conversation,
            message_type=Message.MessageType.MESSAGE,
        )
        .order_by("-id")
        .values_list("id", flat=True)
        .first()
    )
    if not latest:
        return
    from .models import ConversationReadState
    member = _member(community, user)
    if member is not None and (member.last_read_message_id or 0) < latest:
        member.last_read_message_id = latest
        member.save(update_fields=["last_read_message_id"])
    state, _ = ConversationReadState.objects.get_or_create(
        conversation=community.conversation,
        user=user,
    )
    if (state.last_read_message_id or 0) < latest:
        state.last_read_message_id = latest
        state.last_read_at = timezone.now()
        state.save(update_fields=["last_read_message_id", "last_read_at"])


def _audit(actor, action: str, object_kind: str, object_id, meta=None):
    from .models import MessagingAuditLog
    from .retention import KIND_AUDIT_LOGS, retention_until_for
    MessagingAuditLog.objects.create(
        actor=actor,
        action=action,
        object_kind=object_kind,
        object_id=str(object_id or ""),
        meta=meta or {},
        retention_until=retention_until_for(KIND_AUDIT_LOGS),
    )


def _grant_membership(community: Community, user, role: str) -> CommunityMember:
    member, created = CommunityMember.objects.get_or_create(
        community=community,
        user=user,
        defaults={"role": role},
    )
    if member.is_banned:
        raise CommunityError("Участие в сообществе недоступно", "banned", 404)
    rejoined = bool(member.left_at)
    if is_platform_admin(user):
        member.role = CommunityMember.Role.ADMIN
    else:
        member.role = role
    member.left_at = None
    member.is_banned = False
    member.banned_at = None
    member.save()
    _sync_participant(community.conversation, user, hidden=False)
    if created or rejoined:
        _mark_history_read(community, user)
    return member


def ensure_platform_admin_member(community: Community):
    admin = platform_admin_user()
    if admin is None:
        return None
    member, _ = CommunityMember.objects.get_or_create(
        community=community,
        user=admin,
        defaults={"role": CommunityMember.Role.ADMIN},
    )
    member.role = CommunityMember.Role.ADMIN
    member.left_at = None
    member.is_banned = False
    member.banned_at = None
    member.save()
    _sync_participant(community.conversation, admin, hidden=False)
    return member


def ensure_platform_admin_everywhere():
    admin = platform_admin_user()
    if admin is None:
        return
    for community in Community.objects.all().select_related("conversation"):
        ensure_platform_admin_member(community)


def _unique_slug(name: str) -> str:
    base = slugify(name, allow_unicode=True)[:120] or "community"
    slug = base
    index = 2
    while Community.objects.filter(slug=slug).exists():
        slug = f"{base}-{index}"
        index += 1
    return slug


def create_community(actor, *, name: str, description: str = "", subject: str = "", icon: str = "", image_key: str = "", messages_enabled=True, is_active=True):
    if not can_manage_all_communities(actor):
        raise CommunityError("Недостаточно прав", "forbidden", 403)
    cleaned = (name or "").strip()
    if not cleaned:
        raise CommunityError("Укажите название", "name_required", 400)
    admin = platform_admin_user() or actor
    with transaction.atomic():
        conversation = Conversation.objects.create(
            subject_user=admin,
            kind=Conversation.Kind.COMMUNITY,
        )
        community = Community.objects.create(
            conversation=conversation,
            name=cleaned[:120],
            slug=_unique_slug(cleaned),
            description=(description or "").strip(),
            subject=(subject or "").strip()[:80],
            icon=(icon or "").strip()[:16],
            image_key=image_key or "",
            messages_enabled=bool(messages_enabled),
            is_active=bool(is_active),
            created_by=actor,
        )
        ensure_platform_admin_member(community)
        if actor.id != getattr(admin, "id", None):
            _grant_membership(community, actor, CommunityMember.Role.ADMIN)
    _audit(actor, "community_created", "community", community.id, {"name": community.name[:80]})
    return community


def update_community(actor, community: Community, **fields):
    member = active_member(community, actor)
    if member is None or member.role != CommunityMember.Role.ADMIN:
        if not is_platform_admin(actor):
            raise CommunityError("Недостаточно прав", "forbidden", 403)
    for key in ("name", "description", "subject", "icon", "is_active", "is_archived", "messages_enabled", "image_key"):
        if key in fields and fields[key] is not None:
            setattr(community, key, fields[key])
    if community.name:
        community.name = community.name.strip()[:120]
    community.save()
    _audit(actor, "community_updated", "community", community.id, {
        "archived": community.is_archived,
        "active": community.is_active,
        "messages_enabled": community.messages_enabled,
    })
    return community


def assert_can_post(user, conversation: Conversation):
    community = community_for_conversation(conversation)
    member = active_member(community, user) if community else None
    if community is None or member is None or not community_still_allowed(conversation, user):
        raise CommunityError("Диалог недоступен", "not_found", 404)
    if not community.messages_enabled or community.is_archived or not community.is_active:
        raise CommunityError("В этом сообществе сейчас нельзя писать", "writes_closed", 403)
    if member.muted_until and member.muted_until > timezone.now():
        raise CommunityError("Вам временно нельзя писать в этом сообществе", "muted", 403)


def member_count(community: Community) -> int:
    return community.members.filter(left_at__isnull=True, is_banned=False).count()


def mention_count_for(community: Community, user) -> int:
    member = active_member(community, user)
    if member is None:
        return 0
    cursor = member.last_read_message_id or 0
    return MessageMention.objects.filter(
        user=user,
        message__conversation=community.conversation,
        message__id__gt=cursor,
        message__deleted_at__isnull=True,
    ).exclude(message__sender=user).count()


def _invite_usable(invite: CommunityInvite) -> bool:
    if invite is None or not invite.is_active or invite.declined_at:
        return False
    if invite.expires_at and invite.expires_at <= timezone.now():
        return False
    if invite.max_uses is not None and invite.uses_count >= invite.max_uses:
        return False
    community = invite.community
    if not community.is_active or community.is_archived:
        return False
    return True


def create_invite(actor, community: Community, *, invited_user_id=None, expires_at=None, max_uses=None):
    member = active_member(community, actor)
    if member is None or member.role not in {CommunityMember.Role.ADMIN, CommunityMember.Role.MODERATOR}:
        if not is_platform_admin(actor):
            raise CommunityError("Недостаточно прав", "forbidden", 403)
    invited = None
    if invited_user_id:
        invited = User.objects.filter(pk=invited_user_id).first()
        if invited is None or role_of(invited) != "teacher" or invited.id == actor.id:
            raise CommunityError("Пригласить можно только преподавателя", "bad_invite", 400)
        if active_member(community, invited):
            raise CommunityError("Преподаватель уже в сообществе", "already_member", 400)
    if max_uses is not None:
        max_uses = int(max_uses)
        if max_uses < 1 or max_uses > 1000:
            raise CommunityError("Некорректный лимит", "bad_invite", 400)
    if invited is None and (member is None or member.role != CommunityMember.Role.ADMIN) and not is_platform_admin(actor):
        raise CommunityError("Ссылку может создать только администратор сообщества", "forbidden", 403)
    invite = CommunityInvite.objects.create(
        community=community,
        token=secrets.token_urlsafe(18),
        invited_user=invited,
        created_by=actor,
        expires_at=expires_at,
        max_uses=1 if invited is not None and max_uses is None else max_uses,
    )
    _audit(actor, "invite_created", "community_invite", invite.id, {
        "community_id": str(community.id),
        "personal": invited is not None,
    })
    return invite


def revoke_invite(actor, invite: CommunityInvite):
    member = active_member(invite.community, actor)
    if member is None or member.role not in {CommunityMember.Role.ADMIN, CommunityMember.Role.MODERATOR}:
        if not is_platform_admin(actor):
            raise CommunityError("Недостаточно прав", "forbidden", 403)
    invite.is_active = False
    invite.save(update_fields=["is_active"])
    _audit(actor, "invite_revoked", "community_invite", invite.id, {"community_id": str(invite.community_id)})
    return invite


def preview_invite(user, token: str) -> dict:
    if not is_teacher_actor(user):
        raise CommunityError("Приглашение недоступно", "not_found", 404)
    invite = CommunityInvite.objects.select_related("community", "created_by__profile").filter(token=token).first()
    if not _invite_usable(invite):
        raise CommunityError("Приглашение недоступно", "not_found", 404)
    if invite.invited_user_id and invite.invited_user_id != user.id:
        raise CommunityError("Приглашение недоступно", "not_found", 404)
    community = invite.community
    return {
        "token": invite.token,
        "name": community.name,
        "description": community.description,
        "subject": community.subject,
        "icon": community.icon or "#",
        "member_count": member_count(community),
        "already_member": active_member(community, user) is not None,
        "conversation_id": str(community.conversation_id) if active_member(community, user) else None,
    }


def accept_invite(user, *, token: str = "", invite_id=None):
    if not is_teacher_actor(user):
        raise CommunityError("Приглашение недоступно", "not_found", 404)
    invite = None
    if token:
        invite = CommunityInvite.objects.select_related("community__conversation").filter(token=token).first()
    elif invite_id:
        invite = CommunityInvite.objects.select_related("community__conversation").filter(
            pk=invite_id,
            invited_user=user,
        ).first()
    if not _invite_usable(invite):
        raise CommunityError("Приглашение недоступно", "not_found", 404)
    if invite.invited_user_id and invite.invited_user_id != user.id:
        raise CommunityError("Приглашение недоступно", "not_found", 404)
    existing = _member(invite.community, user)
    if existing and existing.is_banned:
        raise CommunityError("Приглашение недоступно", "not_found", 404)
    with transaction.atomic():
        locked = CommunityInvite.objects.select_for_update().get(pk=invite.pk)
        if not _invite_usable(locked):
            raise CommunityError("Приглашение недоступно", "not_found", 404)
        _grant_membership(locked.community, user, CommunityMember.Role.MEMBER)
        locked.uses_count += 1
        if locked.invited_user_id or (locked.max_uses is not None and locked.uses_count >= locked.max_uses):
            locked.is_active = False
        locked.save(update_fields=["uses_count", "is_active"])
    return locked.community


def decline_invite(user, invite_id):
    if not is_teacher_actor(user):
        raise CommunityError("Приглашение недоступно", "not_found", 404)
    invite = CommunityInvite.objects.filter(pk=invite_id, invited_user=user, is_active=True).first()
    if invite is None:
        raise CommunityError("Приглашение недоступно", "not_found", 404)
    invite.is_active = False
    invite.declined_at = timezone.now()
    invite.save(update_fields=["is_active", "declined_at"])
    return invite


def list_my_invites(user) -> list[dict]:
    if not is_teacher_actor(user):
        return []
    rows = CommunityInvite.objects.filter(
        invited_user=user,
        is_active=True,
        declined_at__isnull=True,
    ).select_related("community", "created_by__profile")
    payload = []
    for invite in rows:
        if not _invite_usable(invite):
            continue
        payload.append({
            "id": str(invite.id),
            "name": invite.community.name,
            "description": invite.community.description,
            "subject": invite.community.subject,
            "icon": invite.community.icon or "#",
            "member_count": member_count(invite.community),
            "invited_by": display_name_of(invite.created_by) if invite.created_by_id else "",
        })
    return payload


def leave_community(user, community: Community):
    if is_platform_admin(user):
        raise CommunityError("Главный администратор остаётся в сообществах платформы", "cannot_leave", 400)
    member = active_member(community, user)
    if member is None:
        raise CommunityError("Диалог недоступен", "not_found", 404)
    member.left_at = timezone.now()
    member.save(update_fields=["left_at"])
    _sync_participant(community.conversation, user, hidden=True)


def set_member_role(actor, community: Community, user_id: int, role: str):
    actor_member = active_member(community, actor)
    if actor_member is None or actor_member.role != CommunityMember.Role.ADMIN:
        if not is_platform_admin(actor):
            raise CommunityError("Недостаточно прав", "forbidden", 403)
    if role not in CommunityMember.Role.values:
        raise CommunityError("Некорректная роль", "bad_role", 400)
    target = _member(community, User.objects.filter(pk=user_id).first())
    if target is None or target.left_at or target.is_banned:
        raise CommunityError("Участник не найден", "not_found", 404)
    if is_platform_admin(target.user) and role != CommunityMember.Role.ADMIN:
        raise CommunityError("Нельзя изменить роль главного администратора", "forbidden", 403)
    target.role = role
    target.save(update_fields=["role"])
    _audit(actor, "member_role_changed", "community_member", target.id, {
        "community_id": str(community.id),
        "user_id": target.user_id,
        "role": role,
    })
    return target


def remove_member(actor, community: Community, user_id: int, *, ban: bool = False):
    actor_member = active_member(community, actor)
    if actor_member is None or actor_member.role not in {CommunityMember.Role.ADMIN, CommunityMember.Role.MODERATOR}:
        if not is_platform_admin(actor):
            raise CommunityError("Недостаточно прав", "forbidden", 403)
    target_user = User.objects.filter(pk=user_id).first()
    target = _member(community, target_user)
    if target is None or target.left_at:
        raise CommunityError("Участник не найден", "not_found", 404)
    if is_platform_admin(target.user):
        raise CommunityError("Нельзя исключить главного администратора", "forbidden", 403)
    if actor_member and actor_member.role == CommunityMember.Role.MODERATOR and target.role != CommunityMember.Role.MEMBER:
        raise CommunityError("Недостаточно прав", "forbidden", 403)
    target.left_at = timezone.now()
    if ban and (is_platform_admin(actor) or (actor_member and actor_member.role == CommunityMember.Role.ADMIN)):
        target.is_banned = True
        target.banned_at = timezone.now()
    target.save(update_fields=["left_at", "is_banned", "banned_at"])
    _sync_participant(community.conversation, target.user, hidden=True)
    _audit(actor, "member_banned" if target.is_banned else "member_removed", "community_member", target.id, {
        "community_id": str(community.id),
        "user_id": target.user_id,
    })
    return target


def mute_member(actor, community: Community, user_id: int, *, minutes: int):
    actor_member = active_member(community, actor)
    if actor_member is None or actor_member.role not in {CommunityMember.Role.ADMIN, CommunityMember.Role.MODERATOR}:
        if not is_platform_admin(actor):
            raise CommunityError("Недостаточно прав", "forbidden", 403)
    target = _member(community, User.objects.filter(pk=user_id).first())
    if target is None or not active_member(community, target.user):
        raise CommunityError("Участник не найден", "not_found", 404)
    if is_platform_admin(target.user) or target.role == CommunityMember.Role.ADMIN:
        raise CommunityError("Недостаточно прав", "forbidden", 403)
    if actor_member and actor_member.role == CommunityMember.Role.MODERATOR and target.role != CommunityMember.Role.MEMBER:
        raise CommunityError("Недостаточно прав", "forbidden", 403)
    try:
        minutes = int(minutes)
    except (TypeError, ValueError):
        raise CommunityError("Некорректный срок", "bad_mute", 400)
    target.muted_until = timezone.now() + timedelta(minutes=max(1, min(minutes, 10080)))
    target.is_muted = True
    target.save(update_fields=["muted_until", "is_muted"])
    return target


def set_notifications(user, community: Community, *, mode: str, muted_minutes=None):
    member = active_member(community, user)
    if member is None:
        raise CommunityError("Диалог недоступен", "not_found", 404)
    if mode not in CommunityMember.Notifications.values:
        raise CommunityError("Некорректный режим", "bad_mode", 400)
    member.notifications_mode = mode
    if muted_minutes:
        try:
            minutes = int(muted_minutes)
        except (TypeError, ValueError):
            raise CommunityError("Некорректный срок", "bad_mute", 400)
        member.notifications_muted_until = timezone.now() + timedelta(minutes=max(1, min(minutes, 10080)))
    elif mode == CommunityMember.Notifications.OFF:
        member.notifications_muted_until = None
    else:
        member.notifications_muted_until = None
    member.save(update_fields=["notifications_mode", "notifications_muted_until"])
    return member


def should_notify_member(member: CommunityMember, mentioned: bool) -> bool:
    if member is None:
        return False
    if member.notifications_muted_until and member.notifications_muted_until > timezone.now():
        return False
    if member.notifications_mode == CommunityMember.Notifications.OFF:
        return False
    if member.notifications_mode == CommunityMember.Notifications.MENTIONS:
        return mentioned
    return True


def store_mentions(message: Message, user_ids) -> list[int]:
    community = community_for_conversation(message.conversation)
    if community is None:
        return []
    allowed = set(
        CommunityMember.objects.filter(
            community=community,
            user_id__in=list(user_ids or []),
            left_at__isnull=True,
            is_banned=False,
        ).values_list("user_id", flat=True)
    )
    allowed.discard(message.sender_id)
    for user_id in allowed:
        MessageMention.objects.get_or_create(message=message, user_id=user_id)
    return list(allowed)


def toggle_reaction(user, conversation: Conversation, message_id: int, emoji: str):
    if emoji not in REACTION_EMOJIS:
        raise CommunityError("Такой реакции нет", "bad_reaction", 400)
    if not community_still_allowed(conversation, user):
        raise CommunityError("Диалог недоступен", "not_found", 404)
    message = Message.objects.filter(
        conversation=conversation,
        id=message_id,
        message_type=Message.MessageType.MESSAGE,
        deleted_at__isnull=True,
    ).first()
    if message is None:
        raise CommunityError("Сообщение не найдено", "not_found", 404)
    existing = MessageReaction.objects.filter(message=message, user=user, emoji=emoji).first()
    if existing:
        existing.delete()
    else:
        try:
            MessageReaction.objects.create(message=message, user=user, emoji=emoji)
        except IntegrityError:
            pass
    return message


def reaction_summary(message: Message, viewer) -> list[dict]:
    rows = list(message.reactions.select_related("user__profile"))
    grouped = {}
    for row in rows:
        bucket = grouped.setdefault(row.emoji, {"emoji": row.emoji, "count": 0, "mine": False, "users": []})
        bucket["count"] += 1
        if row.user_id == getattr(viewer, "id", None):
            bucket["mine"] = True
        bucket["users"].append({"user_id": row.user_id, "name": display_name_of(row.user)})
    return list(grouped.values())


def pin_message(actor, conversation: Conversation, message_id: int, *, pinned: bool):
    community = community_for_conversation(conversation)
    member = active_member(community, actor) if community else None
    if member is None or member.role not in {CommunityMember.Role.ADMIN, CommunityMember.Role.MODERATOR}:
        raise CommunityError("Недостаточно прав", "forbidden", 403)
    message = Message.objects.filter(
        conversation=conversation,
        id=message_id,
        deleted_at__isnull=True,
        message_type=Message.MessageType.MESSAGE,
    ).first()
    if message is None:
        raise CommunityError("Сообщение не найдено", "not_found", 404)
    message.pinned_at = timezone.now() if pinned else None
    message.save(update_fields=["pinned_at", "updated_at"])
    return message


def moderator_delete(actor, conversation: Conversation, message_id: int) -> Message:
    community = community_for_conversation(conversation)
    member = active_member(community, actor) if community else None
    message = Message.objects.filter(conversation=conversation, id=message_id, message_type=Message.MessageType.MESSAGE).first()
    if message is None or message.deleted_at:
        raise CommunityError("Сообщение не найдено", "not_found", 404)
    own = message.sender_id == actor.id
    if not own:
        if member is None or member.role not in {CommunityMember.Role.ADMIN, CommunityMember.Role.MODERATOR}:
            raise CommunityError("Недостаточно прав", "forbidden", 403)
    message.deleted_at = timezone.now()
    message.save(update_fields=["deleted_at", "updated_at"])
    if not own:
        _audit(actor, "message_deleted", "message", message.id, {"community_id": str(community.id) if community else ""})
    return message


def report_message(user, conversation: Conversation, message_id: int, *, reason: str, comment: str = ""):
    community = community_for_conversation(conversation)
    if not community_still_allowed(conversation, user):
        raise CommunityError("Диалог недоступен", "not_found", 404)
    if reason not in CommunityReport.Reason.values:
        raise CommunityError("Укажите причину", "bad_reason", 400)
    message = Message.objects.filter(conversation=conversation, id=message_id, deleted_at__isnull=True).first()
    if message is None or message.sender_id == user.id:
        raise CommunityError("Сообщение не найдено", "not_found", 404)
    existing = CommunityReport.objects.filter(message=message, reporter=user).first()
    if existing:
        return existing
    return CommunityReport.objects.create(
        community=community,
        message=message,
        reporter=user,
        reason=reason,
        comment=(comment or "")[:500],
    )


def serialize_members(community: Community) -> list[dict]:
    rows = community.members.filter(left_at__isnull=True, is_banned=False).select_related("user__profile")
    payload = []
    for row in rows[:300]:
        payload.append({
            "user_id": row.user_id,
            "name": display_name_of(row.user),
            "initials": initials_of(display_name_of(row.user)),
            "role": row.role,
            "subtitle": teacher_subject_line(row.user),
            "role_label": "Администратор" if row.role == CommunityMember.Role.ADMIN else (
                "Модератор" if row.role == CommunityMember.Role.MODERATOR else ""
            ),
            "presence": presence_of(row.user),
            "is_platform_admin": is_platform_admin(row.user),
        })
    payload.sort(key=lambda item: ({"admin": 0, "moderator": 1, "member": 2}.get(item["role"], 9), item["name"]))
    return payload


def serialize_community_detail(community: Community, user) -> dict:
    member = active_member(community, user)
    return {
        "id": str(community.id),
        "conversation_id": str(community.conversation_id),
        "name": community.name,
        "description": community.description,
        "subject": community.subject,
        "icon": community.icon or "#",
        "member_count": member_count(community),
        "messages_enabled": community.messages_enabled,
        "is_archived": community.is_archived,
        "is_active": community.is_active,
        "my_role": member.role if member else "",
        "can_leave": bool(member) and not is_platform_admin(user),
        "notifications_mode": member.notifications_mode if member else "all",
        "members": serialize_members(community),
        "pinned": [
            {
                "id": message.id,
                "text": (message.text or "")[:180],
                "author_label": display_name_of(message.sender) if message.sender_id else "",
            }
            for message in community.conversation.messages.filter(
                pinned_at__isnull=False,
                deleted_at__isnull=True,
                message_type=Message.MessageType.MESSAGE,
            ).select_related("sender__profile").order_by("-pinned_at")[:8]
        ],
    }


def sync_read_cursor(user, conversation: Conversation, message_id: int):
    community = community_for_conversation(conversation)
    member = active_member(community, user) if community else None
    if member is None:
        return
    if (member.last_read_message_id or 0) >= message_id:
        return
    member.last_read_message_id = message_id
    member.save(update_fields=["last_read_message_id"])
