"""Операции диалогов. Пользовательский API вызывает только эти функции."""

from __future__ import annotations

import logging
from datetime import timedelta

from django.contrib.auth.models import User
from django.db import IntegrityError, transaction
from django.utils import timezone

from .access import (
    can_direct_message,
    can_read_direct_history,
    display_name_of,
    initials_of,
    pair_key,
    peer_section,
    presence_of,
    role_of,
    student_display_name,
    student_line,
    teacher_subject_line,
)
from .attachments import download_headers, is_image_ext, safe_original_name, store_message_file
from .consent_texts import MARKETING_CONSENT_V1, MESSAGING_GATE_V1, consent_snapshot
from .models import (
    ConsentPromptState,
    Conversation,
    ConversationParticipant,
    ConversationReadState,
    Message,
    MessageAttachment,
    MessageRevision,
    MessagingAccessLog,
    MessagingAuditLog,
    SupportTicket,
    UserConsent,
    UserConsentLog,
)
from .purpose import PURPOSE_SUPPORT, assert_purpose_allowed
from .safety import MessageBlocked, assert_internal_route, enforce_text, spam_fanout
from .retention import (
    KIND_ACCESS_LOGS,
    KIND_ATTACHMENTS,
    KIND_AUDIT_LOGS,
    KIND_CONSENT_EVIDENCE,
    KIND_CONSENT_LOGS,
    KIND_DELIVERY_METADATA,
    KIND_MESSAGE_CONTENT,
    KIND_MESSAGE_METADATA,
    retention_until_for,
)

logger = logging.getLogger("messaging")

MAX_TEXT = 8000
EXCERPT = 140
EDIT_WINDOW = timedelta(minutes=15)


class MessagingError(Exception):
    def __init__(self, message: str, code: str = "messaging_error"):
        super().__init__(message)
        self.message = message
        self.code = code


def _clean_text(value: str) -> str:
    text = (value or "").replace("\x00", "").strip()
    if len(text) > MAX_TEXT:
        raise MessagingError("Сообщение слишком длинное", "text_too_long")
    return text


def direct_still_allowed(conversation: Conversation, user) -> bool:
    """Чтение истории. Новая отправка проверяется отдельно."""
    if conversation.kind != Conversation.Kind.DIRECT:
        return True
    peer = _peer_participant(conversation, user)
    return bool(peer and can_read_direct_history(user, peer.user))


def direct_compose_allowed(conversation: Conversation, user) -> bool:
    if conversation.kind != Conversation.Kind.DIRECT:
        return True
    peer = _peer_participant(conversation, user)
    return bool(peer and can_direct_message(user, peer.user))


def get_owned_conversation(user, conversation_id):
    """Диалог доступен только участнику. Чужой id и снятая связь дают пусто."""
    conversation = (
        Conversation.objects.filter(
            pk=conversation_id,
            participants__user=user,
            participants__hidden_at__isnull=True,
        )
        .distinct()
        .first()
    )
    if conversation is None or not direct_still_allowed(conversation, user):
        return None
    if conversation.kind == Conversation.Kind.COMMUNITY:
        from .communities import community_still_allowed
        if not community_still_allowed(conversation, user):
            return None
    return conversation


def conversations_for(user):
    return Conversation.objects.filter(
        participants__user=user,
        participants__hidden_at__isnull=True,
    ).distinct()


def typing_recipient_ids(user, conversation_id):
    """Печатает только тот, кому ещё можно отправить новое сообщение."""
    conversation = get_owned_conversation(user, conversation_id)
    if conversation is None or not direct_compose_allowed(conversation, user):
        return None
    return list(
        ConversationParticipant.objects.filter(
            conversation=conversation,
            hidden_at__isnull=True,
        )
        .exclude(user=user)
        .values_list("user_id", flat=True)
    )


def other_participant_ids(user, conversation_id):
    conversation = get_owned_conversation(user, conversation_id)
    if conversation is None:
        return None
    return list(
        ConversationParticipant.objects.filter(
            conversation=conversation,
            hidden_at__isnull=True,
        )
        .exclude(user=user)
        .values_list("user_id", flat=True)
    )


def ensure_participant(conversation: Conversation, user) -> ConversationParticipant:
    participant, _ = ConversationParticipant.objects.get_or_create(
        conversation=conversation,
        user=user,
        defaults={"participant_role": ConversationParticipant.Role.OWNER},
    )
    return participant


def get_or_create_conversation(user, kind: str) -> Conversation:
    conversation, created = Conversation.objects.get_or_create(
        subject_user=user,
        kind=kind,
    )
    if created:
        ensure_participant(conversation, user)
    if kind in (Conversation.Kind.SUPPORT, Conversation.Kind.PLATFORM):
        attach_platform_admin(conversation)
    return conversation


def service_desk_user():
    """Кто в кабинете отвечает в поддержку и пишет от разработчика.

    Сначала суперпользователь из MESSAGING_PLATFORM_ADMIN_ID, если у него есть
    роль учителя или ученика. Иначе первый суперпользователь с такой ролью:
    голый admin без профиля в раздел сообщений не входит.
    """
    from django.contrib.auth.models import User

    from .communities import platform_admin_user

    admin = platform_admin_user()
    if admin is not None and role_of(admin) in {"teacher", "student"}:
        return admin
    return (
        User.objects.filter(
            is_superuser=True,
            is_active=True,
            profile__role__in=["teacher", "student"],
            profile__account_active=True,
            profile__account_blocked=False,
        )
        .order_by("id")
        .first()
    )


def is_service_desk(user) -> bool:
    desk = service_desk_user()
    return bool(user and getattr(user, "is_authenticated", False) and desk and desk.id == user.id)


def attach_platform_admin(conversation: Conversation) -> None:
    """Стол поддержки видит чужие «Поддержку» и «От разработчика» в своём кабинете."""
    admin = service_desk_user()
    if admin is None or admin.id == conversation.subject_user_id:
        return
    participant, _created = ConversationParticipant.objects.get_or_create(
        conversation=conversation,
        user=admin,
        defaults={"participant_role": ConversationParticipant.Role.STAFF},
    )
    if participant.hidden_at is not None or participant.participant_role != ConversationParticipant.Role.STAFF:
        participant.hidden_at = None
        participant.participant_role = ConversationParticipant.Role.STAFF
        participant.save(update_fields=["hidden_at", "participant_role"])


def ensure_platform_admin_service_desk(admin) -> None:
    missing = Conversation.objects.filter(
        kind__in=(Conversation.Kind.SUPPORT, Conversation.Kind.PLATFORM),
    ).exclude(subject_user=admin)
    for conversation in missing:
        attach_platform_admin(conversation)


def visible_messages(conversation: Conversation):
    return Message.objects.filter(
        conversation=conversation,
        message_type=Message.MessageType.MESSAGE,
        deleted_at__isnull=True,
    )


def unread_count_for_conversation(conversation: Conversation, user) -> int:
    state = ConversationReadState.objects.filter(conversation=conversation, user=user).first()
    cursor = state.last_read_message_id if state and state.last_read_message_id else 0
    return (
        visible_messages(conversation)
        .filter(id__gt=cursor)
        .exclude(sender=user)
        .count()
    )


def unread_count_for_user(user) -> int:
    total = 0
    for conversation in conversations_for(user):
        total += unread_count_for_conversation(conversation, user)
    return total


def _excerpt(text: str) -> str:
    compact = " ".join((text or "").split())
    if len(compact) <= EXCERPT:
        return compact
    return compact[: EXCERPT - 1].rstrip() + "…"


def _peer_participant(conversation: Conversation, viewer):
    return (
        ConversationParticipant.objects.filter(conversation=conversation)
        .exclude(user=viewer)
        .select_related("user__profile")
        .first()
    )


def author_label(message: Message, viewer) -> str:
    if message.sender_id and message.sender_id == viewer.id:
        return "Вы"
    if message.conversation.kind in (Conversation.Kind.SUPPORT, Conversation.Kind.PLATFORM):
        desk = is_service_desk(viewer) and message.conversation.subject_user_id != viewer.id
        if desk and message.sender_id == message.conversation.subject_user_id and message.sender_id:
            return display_name_of(message.sender)
        if message.conversation.kind == Conversation.Kind.SUPPORT:
            return "Поддержка"
        return "От разработчика"
    if message.sender_id:
        return display_name_of(message.sender)
    peer = _peer_participant(message.conversation, viewer)
    if peer is not None:
        return display_name_of(peer.user)
    return "Собеседник"


def _can_edit(message: Message, viewer) -> bool:
    if message.deleted_at or message.sender_id != getattr(viewer, "id", None):
        return False
    if message.message_type != Message.MessageType.MESSAGE:
        return False
    return timezone.now() - message.created_at <= EDIT_WINDOW


def delivery_status_for(message: Message, viewer) -> str:
    """Галочки только для своих сообщений. Курсор другого участника — источник статуса."""
    if message.sender_id != viewer.id:
        return ""
    other_ids = ConversationParticipant.objects.filter(
        conversation=message.conversation,
    ).exclude(user=viewer).values_list("user_id", flat=True)
    others = ConversationReadState.objects.filter(
        conversation=message.conversation,
        user_id__in=other_ids,
    )
    read_id = 0
    delivered_id = 0
    for state in others:
        if state.last_read_message_id and state.last_read_message_id > read_id:
            read_id = state.last_read_message_id
        if state.last_delivered_message_id and state.last_delivered_message_id > delivered_id:
            delivered_id = state.last_delivered_message_id
    if read_id >= message.id:
        return "read"
    if delivered_id >= message.id:
        return "delivered"
    return "sent"


def serialize_attachment(attachment: MessageAttachment) -> dict:
    return {
        "id": str(attachment.id),
        "name": attachment.original_name,
        "mime_type": attachment.mime_type,
        "size": attachment.size,
        "is_image": is_image_ext(attachment.original_name),
        "scan_status": attachment.scan_status,
    }


def serialize_message(message: Message, viewer) -> dict:
    reply = None
    if message.reply_to_id and message.reply_to and message.reply_to.message_type == Message.MessageType.MESSAGE:
        reply = {
            "id": message.reply_to_id,
            "author_label": author_label(message.reply_to, viewer),
            "excerpt": "Сообщение удалено" if message.reply_to.deleted_at else _excerpt(message.reply_to.text),
        }
    ticket = None
    if message.ticket_id and message.ticket:
        ticket = {
            "id": str(message.ticket_id),
            "subject": message.ticket.subject,
            "status": message.ticket.status,
            "status_label": message.ticket.get_status_display(),
            "category": message.ticket.category,
            "category_label": message.ticket.get_category_display(),
        }
    own = bool(message.sender_id and message.sender_id == viewer.id)
    from .library_cards import library_cards_for
    can_moderate = False
    if message.conversation.kind == Conversation.Kind.COMMUNITY and not message.deleted_at:
        from .communities import active_member, community_for_conversation
        community = community_for_conversation(message.conversation)
        member = active_member(community, viewer) if community else None
        can_moderate = bool(member and member.role in ("admin", "moderator"))
    return {
        "id": message.id,
        "conversation_id": str(message.conversation_id),
        "sender_type": message.sender_type,
        "is_own": own,
        "author_user_id": message.sender_id,
        "author_label": author_label(message, viewer),
        "purpose": message.purpose,
        "text": "" if message.deleted_at else message.text,
        "created_at": message.created_at.isoformat(),
        "edited_at": message.edited_at.isoformat() if message.edited_at else None,
        "deleted": bool(message.deleted_at),
        "is_important": bool(message.is_important),
        "reply_disabled": bool(message.reply_disabled),
        "can_edit": _can_edit(message, viewer),
        "can_delete": bool(not message.deleted_at and (own or can_moderate)),
        "can_pin": can_moderate,
        "can_report": bool(not own and not message.deleted_at and message.conversation.kind == Conversation.Kind.COMMUNITY),
        "reply_to": None if message.deleted_at else reply,
        "ticket": ticket,
        "attachments": [] if message.deleted_at else [serialize_attachment(item) for item in message.attachments.all()],
        "materials": [] if message.deleted_at else library_cards_for(message, viewer),
        "delivery_status": delivery_status_for(message, viewer),
        "button_text": message.button_text,
        "button_route": message.button_route,
        "pinned": bool(message.pinned_at),
        "reactions": _reaction_payload(message, viewer),
    }


def _reaction_payload(message: Message, viewer):
    if message.conversation.kind != Conversation.Kind.COMMUNITY or message.deleted_at:
        return []
    from .communities import reaction_summary
    return reaction_summary(message, viewer)


def _public_type(kind: str) -> str:
    if kind == Conversation.Kind.PLATFORM:
        return "developer"
    return kind


def _conversation_peer(conversation: Conversation, user):
    if conversation.kind != Conversation.Kind.DIRECT:
        return None
    return _peer_participant(conversation, user)


def serialize_conversation(conversation: Conversation, user) -> dict:
    last = (
        Message.objects.filter(
            conversation=conversation,
            message_type=Message.MessageType.MESSAGE,
        )
        .order_by("-id")
        .first()
    )
    viewer_role = role_of(user)
    staff_desk = is_service_desk(user) and conversation.subject_user_id != user.id
    subject_name = display_name_of(conversation.subject_user) if staff_desk else ""
    community_meta = None
    peer = _conversation_peer(conversation, user)
    peer_user = peer.user if peer is not None else None
    peer_role = role_of(peer_user) if peer_user is not None else ""
    if conversation.kind == Conversation.Kind.SUPPORT:
        title = f"Поддержка · {subject_name}" if staff_desk else "Поддержка"
        subtitle = subject_name and "Обращение пользователя" or "Обычно отвечаем в течение рабочего дня"
        section = "service"
        initials = "П"
        presence = ""
    elif conversation.kind == Conversation.Kind.PLATFORM:
        title = f"От разработчика · {subject_name}" if staff_desk else "От разработчика"
        subtitle = subject_name and "Сообщения этому пользователю" or "Официальные сообщения платформы"
        section = "service"
        initials = "D"
        presence = ""
    elif conversation.kind == Conversation.Kind.COMMUNITY:
        from .communities import community_for_conversation, member_count, mention_count_for, active_member
        community = community_for_conversation(conversation)
        title = community.name if community else "Сообщество"
        count = member_count(community) if community else 0
        subtitle = f"Сообщество преподавателей · {count}"
        section = "communities"
        initials = (community.icon if community and community.icon else (title[:1] or "С"))
        presence = ""
        peer_role = ""
        community_meta = community
    else:
        if viewer_role == "teacher" and peer_role == "student" and peer_user is not None:
            title = student_display_name(user, peer_user)
            subtitle = student_line(user, peer_user)
        elif peer_user is not None and peer_role == "teacher":
            title = display_name_of(peer_user)
            student_user = user if viewer_role == "student" else None
            subtitle = teacher_subject_line(peer_user, student_user)
        elif peer_user is not None:
            title = display_name_of(peer_user)
            subtitle = ""
        else:
            title = "Диалог"
            subtitle = ""
        section = peer_section(viewer_role, peer_role) if peer_role else "teachers"
        initials = initials_of(title)
        presence = presence_of(peer_user) if peer_user is not None else ""
    if last is None:
        excerpt = ""
        last_at = None
        last_own = False
        last_status = ""
    elif last.deleted_at:
        excerpt = "Сообщение удалено"
        last_at = last.created_at.isoformat()
        last_own = last.sender_id == user.id
        last_status = delivery_status_for(last, user) if last_own else ""
    else:
        excerpt = _excerpt(last.text) or ("Вложение" if last.attachments.exists() else "")
        if not excerpt:
            library = (last.metadata or {}).get("library") or []
            if library and isinstance(library, list) and isinstance(library[0], dict):
                excerpt = str(library[0].get("title") or "Материал")
        last_at = last.created_at.isoformat()
        last_own = last.sender_id == user.id
        last_status = delivery_status_for(last, user) if last_own else ""
    can_compose = conversation.kind != Conversation.Kind.PLATFORM or staff_desk
    if conversation.kind == Conversation.Kind.DIRECT and peer_user is not None:
        can_compose = can_direct_message(user, peer_user)
    mention_count = 0
    member_total = 0
    my_role = ""
    community_id = ""
    image_url = ""
    if community_meta is not None:
        from .communities import active_member, community_image_path, mention_count_for
        member = active_member(community_meta, user)
        mention_count = mention_count_for(community_meta, user)
        member_total = count
        my_role = member.role if member else ""
        community_id = str(community_meta.id)
        image_url = community_image_path(community_meta)
        if not community_meta.messages_enabled or community_meta.is_archived or not community_meta.is_active:
            can_compose = False
        elif member and member.muted_until and member.muted_until > timezone.now():
            can_compose = False
    read_state = ConversationReadState.objects.filter(conversation=conversation, user=user).first()
    return {
        "id": str(conversation.id),
        "kind": conversation.kind,
        "type": _public_type(conversation.kind),
        "section": section,
        "title": title,
        "subtitle": subtitle,
        "initials": initials,
        "peer_role": peer_role,
        "presence": presence,
        "can_compose": can_compose,
        "last_message_excerpt": excerpt,
        "last_message_at": last_at,
        "last_message_own": last_own,
        "last_delivery_status": last_status,
        "unread_count": unread_count_for_conversation(conversation, user),
        "mention_count": mention_count,
        "member_count": member_total,
        "image_url": image_url,
        "my_role": my_role,
        "community_id": community_id,
        "last_read_message_id": read_state.last_read_message_id if read_state else None,
    }


def list_conversations(user) -> list[dict]:
    from .communities import community_still_allowed, ensure_platform_admin_everywhere, is_platform_admin
    if is_platform_admin(user) or is_service_desk(user):
        ensure_platform_admin_everywhere()
    if is_service_desk(user):
        ensure_platform_admin_service_desk(user)
    for kind in (Conversation.Kind.SUPPORT, Conversation.Kind.PLATFORM):
        get_or_create_conversation(user, kind)
    order = {Conversation.Kind.SUPPORT: 0, Conversation.Kind.PLATFORM: 1, Conversation.Kind.COMMUNITY: 2}
    conversations = [
        item for item in conversations_for(user)
        if direct_still_allowed(item, user) and community_still_allowed(item, user)
    ]
    conversations.sort(
        key=lambda item: (
            order.get(item.kind, 9),
            -(item.updated_at.timestamp() if item.updated_at else 0),
        )
    )
    return [serialize_conversation(conversation, user) for conversation in conversations]


def _advance_cursor(state: ConversationReadState, field_id: str, field_at: str, message_id: int) -> bool:
    current = getattr(state, field_id) or 0
    if message_id <= current:
        return False
    if not visible_messages(state.conversation).filter(id=message_id).exists():
        raise MessagingError("Сообщение не найдено", "message_not_found")
    setattr(state, field_id, message_id)
    setattr(state, field_at, timezone.now())
    if not state.retention_until:
        state.retention_until = retention_until_for(KIND_DELIVERY_METADATA)
    state.save(update_fields=[field_id, field_at, "retention_until", "retention_policy_kind"])
    return True


def mark_read(user, conversation: Conversation, message_id: int) -> None:
    state, _ = ConversationReadState.objects.get_or_create(conversation=conversation, user=user)
    _advance_cursor(state, "last_read_message_id", "last_read_at", message_id)
    delivered, _ = ConversationReadState.objects.get_or_create(conversation=conversation, user=user)
    _advance_cursor(delivered, "last_delivered_message_id", "last_delivered_at", message_id)
    if conversation.kind == Conversation.Kind.COMMUNITY:
        from .communities import sync_read_cursor
        sync_read_cursor(user, conversation, message_id)


def mark_delivered(user, conversation: Conversation, message_id: int) -> None:
    state, _ = ConversationReadState.objects.get_or_create(conversation=conversation, user=user)
    _advance_cursor(state, "last_delivered_message_id", "last_delivered_at", message_id)


def page_messages(conversation: Conversation, viewer, *, before=None, after=None, limit=50, query: str = "", author_id=None, has_files="", on_date=""):
    require_messaging_consent(viewer)
    limit = max(1, min(int(limit or 50), 100))
    qs = (
        Message.objects.filter(
            conversation=conversation,
            message_type=Message.MessageType.MESSAGE,
        )
        .select_related("reply_to", "ticket", "conversation", "sender")
        .prefetch_related("attachments", "reactions__user__profile")
    )
    needle = (query or "").strip()[:100]
    if needle:
        qs = qs.filter(deleted_at__isnull=True, text__icontains=needle)
    if author_id:
        qs = qs.filter(sender_id=int(author_id), deleted_at__isnull=True)
    if str(has_files) in {"1", "true", "yes"}:
        qs = qs.filter(deleted_at__isnull=True, attachments__isnull=False).distinct()
    if on_date:
        from datetime import datetime
        day = datetime.strptime(str(on_date)[:10], "%Y-%m-%d").date()
        qs = qs.filter(created_at__date=day)
    if after:
        rows = list(qs.filter(id__gt=int(after)).order_by("id")[: limit + 1])
        has_more = len(rows) > limit
        rows = rows[:limit]
    else:
        filtered = qs.order_by("-id")
        if before:
            filtered = filtered.filter(id__lt=int(before))
        rows = list(filtered[: limit + 1])
        has_more = len(rows) > limit
        rows = list(reversed(rows[:limit]))
    return [serialize_message(row, viewer) for row in rows], has_more


def _store_attachments(message: Message, uploads) -> None:
    from .attachments import MAX_ATTACHMENTS
    files = [item for item in (uploads or []) if item]
    if len(files) > MAX_ATTACHMENTS:
        raise MessagingError("Можно прикрепить не больше 5 файлов", "too_many_files")
    for uploaded in files:
        if not uploaded:
            continue
        key, digest, size = store_message_file(conversation_id=message.conversation_id, uploaded=uploaded)
        MessageAttachment.objects.create(
            message=message,
            conversation=message.conversation,
            uploaded_by=message.sender,
            original_name=safe_original_name(uploaded.name or "file"),
            mime_type=download_headers(uploaded.name or "")[0],
            size=size,
            storage_key=key,
            checksum=digest,
            scan_status=MessageAttachment.ScanStatus.UNSCANNED,
            retention_until=retention_until_for(KIND_ATTACHMENTS),
        )


def _create_message(
    *,
    conversation: Conversation,
    sender,
    sender_type: str,
    text: str,
    purpose: str,
    ticket=None,
    reply_to=None,
    client_message_id: str = "",
    uploads=None,
    button_text: str = "",
    button_route: str = "",
    library=None,
) -> Message:
    from .library_cards import resolve_library_items

    cleaned = _clean_text(text)
    library_refs = resolve_library_items(sender, conversation, library or []) if library else []
    if not cleaned and not uploads and not library_refs:
        raise MessagingError("Введите текст или прикрепите файл", "empty_message")
    assert_internal_route(button_route)
    if sender_type == Message.SenderType.USER and cleaned:
        enforce_text(sender, conversation, cleaned)
        spam_fanout(sender, conversation, cleaned)
    if sender_type == Message.SenderType.USER:
        from .safety import enforce_file
        for uploaded in uploads or []:
            if not uploaded:
                continue
            raw = uploaded.read()
            try:
                uploaded.seek(0)
            except Exception:
                pass
            enforce_file(sender, conversation, getattr(uploaded, "name", "") or "", raw)
    if sender_type != Message.SenderType.USER:
        assert_purpose_allowed(purpose, cleaned, button_text=button_text, button_route=button_route)
    if reply_to is not None:
        if reply_to.conversation_id != conversation.id or reply_to.message_type != Message.MessageType.MESSAGE:
            raise MessagingError("Нельзя ответить на это сообщение", "bad_reply")
    if client_message_id:
        existing = Message.objects.filter(conversation=conversation, client_message_id=client_message_id).first()
        if existing:
            return existing
    try:
        with transaction.atomic():
            message = Message.objects.create(
                conversation=conversation,
                ticket=ticket,
                sender=sender,
                sender_type=sender_type,
                message_type=Message.MessageType.MESSAGE,
                purpose=purpose,
                text=cleaned,
                reply_to=reply_to,
                client_message_id=client_message_id[:64],
                content_retention_until=retention_until_for(KIND_MESSAGE_CONTENT),
                metadata_retention_until=retention_until_for(KIND_MESSAGE_METADATA),
                button_text=button_text[:80],
                button_route=button_route[:300],
                metadata={"library": library_refs} if library_refs else {},
            )
            _store_attachments(message, uploads)
    except IntegrityError:
        if client_message_id:
            found = Message.objects.filter(conversation=conversation, client_message_id=client_message_id).first()
            if found:
                return found
        raise
    conversation.updated_at = timezone.now()
    conversation.save(update_fields=["updated_at"])
    logger.info(
        "messaging_message_created message_id=%s conversation_id=%s sender_type=%s",
        message.id,
        conversation.id,
        sender_type,
    )
    return message


def create_support_ticket(user, *, category: str, subject: str, text: str, uploads=None, client_message_id: str = ""):
    require_messaging_consent(user)
    if category not in SupportTicket.Category.values:
        raise MessagingError("Выберите категорию", "bad_category")
    subject_clean = _clean_text(subject)
    if not subject_clean:
        raise MessagingError("Укажите тему", "subject_required")
    if len(subject_clean) > 200:
        raise MessagingError("Тема слишком длинная", "subject_too_long")
    conversation = get_or_create_conversation(user, Conversation.Kind.SUPPORT)
    enforce_text(user, conversation, f"{subject_clean}\n{text}")
    with transaction.atomic():
        ticket = SupportTicket.objects.create(
            conversation=conversation,
            category=category,
            subject=subject_clean[:200],
            status=SupportTicket.Status.NEW,
        )
        message = _create_message(
            conversation=conversation,
            sender=user,
            sender_type=Message.SenderType.USER,
            text=text,
            purpose=PURPOSE_SUPPORT,
            ticket=ticket,
            client_message_id=client_message_id,
            uploads=uploads,
        )
        if message.ticket_id != ticket.id:
            message.ticket = ticket
            message.save(update_fields=["ticket"])
    return conversation, ticket, message


def post_user_message(
    user,
    conversation: Conversation,
    *,
    text: str,
    reply_to_id=None,
    client_message_id: str = "",
    uploads=None,
    mention_user_ids=None,
    library=None,
):
    require_messaging_consent(user)
    reply = None
    if reply_to_id:
        reply = (
            Message.objects.filter(
                conversation=conversation,
                id=reply_to_id,
                message_type=Message.MessageType.MESSAGE,
                deleted_at__isnull=True,
            )
            .first()
        )
        if reply is None:
            raise MessagingError("Исходное сообщение не найдено", "bad_reply")
    if conversation.kind == Conversation.Kind.PLATFORM:
        staff_desk = is_service_desk(user) and conversation.subject_user_id != user.id
        if not staff_desk and (reply is None or reply.reply_disabled or reply.sender_id == user.id):
            raise MessagingError(
                "Ответить можно только на сообщение, где это разрешено",
                "reply_closed",
            )
    if conversation.kind == Conversation.Kind.DIRECT and not direct_compose_allowed(conversation, user):
        raise MessagingError("Новые сообщения в этом диалоге недоступны", "forbidden")
    if conversation.kind == Conversation.Kind.COMMUNITY:
        from .communities import CommunityError, assert_can_post
        try:
            assert_can_post(user, conversation)
        except CommunityError as exc:
            raise MessagingError(exc.message, exc.code) from exc
    purpose = PURPOSE_SUPPORT if conversation.kind == Conversation.Kind.SUPPORT else ""
    ticket = None
    if conversation.kind == Conversation.Kind.SUPPORT:
        ticket = (
            SupportTicket.objects.filter(conversation=conversation)
            .exclude(status=SupportTicket.Status.RESOLVED)
            .order_by("-created_at")
            .first()
        )
    message = _create_message(
        conversation=conversation,
        sender=user,
        sender_type=Message.SenderType.USER,
        text=text,
        purpose=purpose,
        ticket=ticket,
        reply_to=reply,
        client_message_id=client_message_id,
        uploads=uploads,
        library=library,
    )
    if conversation.kind == Conversation.Kind.COMMUNITY and mention_user_ids:
        from .communities import store_mentions
        store_mentions(message, mention_user_ids)
    return message


def open_direct_conversation(user, target_id) -> Conversation:
    require_messaging_consent(user)
    try:
        target_pk = int(target_id)
    except (TypeError, ValueError):
        raise MessagingError("Диалог недоступен", "not_found")
    target = User.objects.filter(pk=target_pk).select_related("profile").first()
    if target is None or not can_direct_message(user, target):
        raise MessagingError("Диалог недоступен", "not_found")
    key = pair_key(user.id, target.id)
    existing = Conversation.objects.filter(kind=Conversation.Kind.DIRECT, pair_key=key).first()
    if existing:
        ensure_participant(existing, user)
        ensure_participant(existing, target)
        return existing
    try:
        with transaction.atomic():
            conversation = Conversation.objects.create(
                subject_user_id=min(user.id, target.id),
                kind=Conversation.Kind.DIRECT,
                pair_key=key,
            )
            ensure_participant(conversation, user)
            ensure_participant(conversation, target)
            return conversation
    except IntegrityError:
        conversation = Conversation.objects.get(kind=Conversation.Kind.DIRECT, pair_key=key)
        ensure_participant(conversation, user)
        ensure_participant(conversation, target)
        return conversation


def edit_user_message(user, conversation: Conversation, message_id: int, text: str) -> Message:
    if conversation.kind == Conversation.Kind.DIRECT and not direct_compose_allowed(conversation, user):
        raise MessagingError("Новые сообщения в этом диалоге недоступны", "forbidden")
    message = (
        Message.objects.filter(
            conversation=conversation,
            id=message_id,
            message_type=Message.MessageType.MESSAGE,
        )
        .first()
    )
    if message is None or message.sender_id != user.id:
        raise MessagingError("Сообщение не найдено", "message_not_found")
    if not _can_edit(message, user):
        raise MessagingError("Редактировать можно только в течение 15 минут", "edit_window")
    cleaned = _clean_text(text)
    if not cleaned and not message.attachments.exists():
        raise MessagingError("Введите текст или прикрепите файл", "empty_message")
    if cleaned == message.text:
        return message
    enforce_text(user, conversation, cleaned)
    MessageRevision.objects.create(message=message, text=message.text, editor=user)
    message.text = cleaned
    message.edited_at = timezone.now()
    message.save(update_fields=["text", "edited_at", "updated_at"])
    return message


def delete_user_message(user, conversation: Conversation, message_id: int) -> Message:
    if conversation.kind == Conversation.Kind.DIRECT and not direct_compose_allowed(conversation, user):
        raise MessagingError("Новые сообщения в этом диалоге недоступны", "forbidden")
    message = (
        Message.objects.filter(
            conversation=conversation,
            id=message_id,
            message_type=Message.MessageType.MESSAGE,
        )
        .first()
    )
    if message is None or message.sender_id != user.id or message.deleted_at:
        raise MessagingError("Сообщение не найдено", "message_not_found")
    message.deleted_at = timezone.now()
    message.save(update_fields=["deleted_at", "updated_at"])
    return message


def set_message_purpose(*, actor, message: Message, purpose: str) -> None:
    """Смена назначения сотрудником. Пишет audit и не подменяет тип молча."""
    previous = message.purpose
    assert_purpose_allowed(
        purpose,
        message.text,
        button_text=message.button_text,
        button_route=message.button_route,
    )
    if previous == purpose:
        return
    message.purpose = purpose
    message.save(update_fields=["purpose", "updated_at"])
    MessagingAuditLog.objects.create(
        actor=actor,
        action="message_purpose_changed",
        object_kind="message",
        object_id=str(message.id),
        meta={"from": previous, "to": purpose},
        retention_until=retention_until_for(KIND_AUDIT_LOGS),
    )


def log_attachment_download(*, actor, attachment: MessageAttachment) -> None:
    MessagingAccessLog.objects.create(
        actor=actor,
        conversation_id=attachment.conversation_id,
        attachment_id=attachment.id,
        action="attachment_download",
        retention_until=retention_until_for(KIND_ACCESS_LOGS),
    )


def record_prompt_decision(
    *,
    user,
    email_opt_in: bool,
    inapp_opt_in: bool,
    source: str,
    version: str = MARKETING_CONSENT_V1,
    ip_address=None,
    user_agent: str = "",
) -> ConsentPromptState:
    """Пустой выбор фиксирует только экран. Согласие появляется при включённой галочке."""
    definition, digest = consent_snapshot(version)
    now = timezone.now()
    state, _ = ConsentPromptState.objects.get_or_create(
        user=user,
        prompt_key=definition["prompt_key"],
        defaults={
            "shown_at": now,
            "consent_text_version": version,
            "text_sha256": digest,
        },
    )
    if state.decided_at is None:
        state.decided_at = now
        state.consent_text_version = version
        state.text_sha256 = digest
        state.save(update_fields=["decided_at", "consent_text_version", "text_sha256"])
    if email_opt_in:
        _grant_channel(
            user=user,
            channel=UserConsent.Channel.EMAIL,
            version=version,
            digest=digest,
            source=source,
            ip_address=ip_address,
            user_agent=user_agent,
        )
    if inapp_opt_in:
        _grant_channel(
            user=user,
            channel=UserConsent.Channel.INAPP,
            version=version,
            digest=digest,
            source=source,
            ip_address=ip_address,
            user_agent=user_agent,
        )
    return state


def _grant_channel(*, user, channel: str, version: str, digest: str, source: str, ip_address, user_agent: str, consent_type: str = "marketing"):
    now = timezone.now()
    consent, _ = UserConsent.objects.get_or_create(user=user, channel=channel)
    consent.granted = True
    consent.consented_at = now
    consent.revoked_at = None
    consent.consent_text_version = version
    consent.text_sha256 = digest
    consent.source = source
    consent.save()
    UserConsentLog.objects.create(
        user=user,
        consent_type=consent_type,
        channel=channel,
        action=UserConsentLog.Action.GRANTED,
        consent_text_version=version,
        text_sha256=digest,
        source=source,
        ip_address=ip_address,
        user_agent=(user_agent or "")[:300],
        log_retention_until=retention_until_for(KIND_CONSENT_LOGS),
        evidence_retention_until=retention_until_for(KIND_CONSENT_EVIDENCE),
    )


def broadcast_audience(actor) -> dict:
    """Списки для рассылки «От разработчика». Доступны только столу поддержки."""
    if not is_service_desk(actor):
        raise MessagingError("Рассылка недоступна", "forbidden")
    from Cabinet.choices import GroupStatus, StudentStatus
    from Cabinet.models import StudentGroup

    groups = []
    rows = (
        StudentGroup.objects.filter(status=GroupStatus.ACTIVE)
        .select_related("teacher", "teacher__profile")
        .prefetch_related("students")
        .order_by("title")
    )
    for group in rows:
        linked = sum(1 for student in group.students.all() if student.user_id and student.status == StudentStatus.ACTIVE)
        teacher = display_name_of(group.teacher) if group.teacher_id else ""
        groups.append({
            "id": group.id,
            "title": group.title,
            "teacher_name": teacher,
            "students_count": linked,
        })
    return {"groups": groups}


def _broadcast_recipients() -> list:
    """Все активные аккаунты, которые согласились и на рассылку, и на персональные данные."""
    from django.db.models import Count

    channels = (
        UserConsent.Channel.PERSONAL,
        UserConsent.Channel.EMAIL,
        UserConsent.Channel.INAPP,
    )
    consented_ids = (
        UserConsent.objects.filter(
            channel__in=channels,
            granted=True,
            consented_at__isnull=False,
        )
        .values("user_id")
        .annotate(channels_granted=Count("channel", distinct=True))
        .filter(channels_granted=len(channels))
        .values_list("user_id", flat=True)
    )
    return list(
        User.objects.filter(
            id__in=consented_ids,
            is_active=True,
            profile__account_active=True,
            profile__account_blocked=False,
        ).order_by("id")
    )


def broadcast_developer_message(actor, *, text: str, audience: str, group_ids=None, uploads=None, library=None) -> dict:
    """То же сообщение, что в обычном диалоге: текст, файлы и материалы библиотеки."""
    if not is_service_desk(actor):
        raise MessagingError("Рассылка недоступна", "forbidden")
    require_messaging_consent(actor)
    recipients = [user for user in _broadcast_recipients() if user.id != actor.id]
    if not recipients:
        raise MessagingError("Некому отправить: нет аккаунтов в этой выборке", "empty_audience")
    from .api import publish_message_event

    files = [item for item in (uploads or []) if item]
    sent = 0
    for user in recipients:
        for uploaded in files:
            try:
                uploaded.seek(0)
            except Exception:
                pass
        conversation = get_or_create_conversation(user, Conversation.Kind.PLATFORM)
        message = post_user_message(
            actor,
            conversation,
            text=text,
            uploads=files,
            library=library or [],
        )
        publish_message_event(message, "message.new")
        sent += 1
    return {"sent": sent, "audience": "consented"}


MESSAGING_GATE_CHANNELS = (
    UserConsent.Channel.PERSONAL,
    UserConsent.Channel.EMAIL,
    UserConsent.Channel.INAPP,
)


def messaging_agreement_payload() -> dict:
    definition, _digest = consent_snapshot(MESSAGING_GATE_V1)
    return {
        "version": definition["version"],
        "title": definition["title"],
        "updated": definition["updated"],
        "body": definition["body"],
        "checkbox_label": definition["checkbox_label"],
    }


def has_messaging_consent(user) -> bool:
    rows = {
        row.channel: row
        for row in UserConsent.objects.filter(user=user, channel__in=MESSAGING_GATE_CHANNELS)
    }
    return all(
        (row := rows.get(channel)) and row.granted and row.consented_at
        for channel in MESSAGING_GATE_CHANNELS
    )


def require_messaging_consent(user) -> None:
    if not has_messaging_consent(user):
        raise MessagingError(
            "Чтобы писать и получать сообщения, примите соглашение",
            "consent_required",
        )


def accept_messaging_consent(user, *, source: str, ip_address=None, user_agent: str = "") -> dict:
    definition, digest = consent_snapshot(MESSAGING_GATE_V1)
    for channel, consent_type in (
        (UserConsent.Channel.PERSONAL, "personal_data"),
        (UserConsent.Channel.EMAIL, "marketing"),
        (UserConsent.Channel.INAPP, "marketing"),
    ):
        _grant_channel(
            user=user,
            channel=channel,
            version=MESSAGING_GATE_V1,
            digest=digest,
            source=source,
            ip_address=ip_address,
            user_agent=user_agent,
            consent_type=consent_type,
        )
    personal = UserConsent.objects.get(user=user, channel=UserConsent.Channel.PERSONAL)
    return {
        "accepted": True,
        "consented_at": personal.consented_at.isoformat(),
        "agreement": {
            "version": definition["version"],
            "title": definition["title"],
        },
    }
