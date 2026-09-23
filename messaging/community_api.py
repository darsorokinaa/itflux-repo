"""HTTP сообщества. Чужое сообщество не отличается от несуществующего."""

import mimetypes

from django.core.files.storage import default_storage
from django.http import FileResponse
from django.utils.dateparse import parse_datetime
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .api import MessagingGateMixin, _allow_action, publish_message_event
from Cabinet.rate_limit import rate_limit_drf_response
from .attachments import store_message_file
from .communities import (
    CommunityError,
    accept_invite,
    can_manage_all_communities,
    community_for_conversation,
    community_still_allowed,
    create_community,
    create_invite,
    decline_invite,
    leave_community,
    mute_member,
    pin_message,
    preview_invite,
    remove_member,
    report_message,
    revoke_invite,
    serialize_community_detail,
    set_member_role,
    set_notifications,
    toggle_reaction,
    update_community,
)
from .models import Community, CommunityInvite, MessageAttachment
from .permissions import IsMessagingParticipant
from .services import get_owned_conversation, serialize_attachment, serialize_message


def _error(exc: CommunityError):
    return Response({"detail": exc.message, "code": exc.code}, status=exc.status)


class CommunityCollectionView(MessagingGateMixin, APIView):
    permission_classes = [IsAuthenticated, IsMessagingParticipant]

    def get(self, request):
        blocked = self._blocked()
        if blocked:
            return blocked
        if not can_manage_all_communities(request.user):
            return Response({"detail": "Не найдено"}, status=404)
        rows = []
        for community in Community.objects.select_related("conversation").order_by("-created_at"):
            rows.append({
                "id": str(community.id),
                "conversation_id": str(community.conversation_id),
                "name": community.name,
                "subject": community.subject,
                "description": community.description,
                "is_active": community.is_active,
                "is_archived": community.is_archived,
                "messages_enabled": community.messages_enabled,
                "member_count": community.members.filter(left_at__isnull=True, is_banned=False).count(),
                "invite_count": community.invites.filter(is_active=True).count(),
                "created_at": community.created_at.isoformat(),
            })
        return Response({"communities": rows})

    def post(self, request):
        blocked = self._blocked()
        if blocked:
            return blocked
        image_key = ""
        upload = request.FILES.get("image")
        if upload:
            try:
                image_key, _, _ = store_message_file(conversation_id="community-icons", uploaded=upload)
            except Exception as exc:
                message = getattr(exc, "message", "Иконка не принята")
                return Response({"detail": message}, status=400)
        try:
            community = create_community(
                request.user,
                name=request.data.get("name") or "",
                description=request.data.get("description") or "",
                subject=request.data.get("subject") or "",
                icon=request.data.get("icon") or "",
                image_key=image_key,
                messages_enabled=str(request.data.get("messages_enabled", "true")).lower() not in {"0", "false", "no", "off"},
                is_active=str(request.data.get("is_active", "true")).lower() not in {"0", "false", "no", "off"},
            )
        except CommunityError as exc:
            return _error(exc)
        return Response(serialize_community_detail(community, request.user), status=201)


class CommunityDetailView(MessagingGateMixin, APIView):
    permission_classes = [IsAuthenticated, IsMessagingParticipant]

    def get(self, request, conversation_id):
        blocked = self._blocked()
        if blocked:
            return blocked
        conversation = get_owned_conversation(request.user, conversation_id)
        community = community_for_conversation(conversation) if conversation else None
        if community is None:
            return Response({"detail": "Не найдено"}, status=404)
        return Response(serialize_community_detail(community, request.user))

    def patch(self, request, conversation_id):
        blocked = self._blocked()
        if blocked:
            return blocked
        conversation = get_owned_conversation(request.user, conversation_id)
        community = community_for_conversation(conversation) if conversation else None
        if community is None and can_manage_all_communities(request.user):
            community = Community.objects.filter(conversation_id=conversation_id).first()
        if community is None:
            return Response({"detail": "Не найдено"}, status=404)
        fields = {}
        for key in ("name", "description", "subject", "icon", "messages_enabled", "is_active", "is_archived"):
            if key in request.data:
                value = request.data.get(key)
                if key in {"messages_enabled", "is_active", "is_archived"}:
                    value = str(value).lower() in {"1", "true", "yes", "on"}
                fields[key] = value
        upload = request.FILES.get("image")
        if upload:
            try:
                image_key, _, _ = store_message_file(conversation_id="community-icons", uploaded=upload)
            except Exception as exc:
                message = getattr(exc, "message", "Картинка не принята")
                return Response({"detail": message}, status=400)
            fields["image_key"] = image_key
        try:
            update_community(request.user, community, **fields)
        except CommunityError as exc:
            return _error(exc)
        return Response(serialize_community_detail(community, request.user))


class CommunityImageView(MessagingGateMixin, APIView):
    permission_classes = [IsAuthenticated, IsMessagingParticipant]

    def get(self, request, conversation_id):
        blocked = self._blocked()
        if blocked:
            return blocked
        conversation = get_owned_conversation(request.user, conversation_id)
        community = community_for_conversation(conversation) if conversation else None
        if community is None or not community.image_key or not community_still_allowed(conversation, request.user):
            return Response({"detail": "Не найдено"}, status=404)
        if not default_storage.exists(community.image_key):
            return Response({"detail": "Не найдено"}, status=404)
        content_type = mimetypes.guess_type(community.image_key)[0] or "application/octet-stream"
        return FileResponse(default_storage.open(community.image_key, "rb"), content_type=content_type)


class CommunityInviteCreateView(MessagingGateMixin, APIView):
    permission_classes = [IsAuthenticated, IsMessagingParticipant]

    def post(self, request, conversation_id):
        blocked = self._blocked()
        if blocked:
            return blocked
        if not _allow_action(request.user.id, "invite", 20, 3600):
            return rate_limit_drf_response()
        community = _community_or_404(request, conversation_id)
        if community is None:
            return Response({"detail": "Не найдено"}, status=404)
        expires = parse_datetime(request.data.get("expires_at") or "") if request.data.get("expires_at") else None
        try:
            invite = create_invite(
                request.user,
                community,
                invited_user_id=request.data.get("user_id") or None,
                expires_at=expires,
                max_uses=request.data.get("max_uses") or None,
            )
        except CommunityError as exc:
            return _error(exc)
        return Response({
            "id": str(invite.id),
            "token": invite.token,
            "path": f"/community/invite/{invite.token}",
            "invited_user_id": invite.invited_user_id,
            "expires_at": invite.expires_at.isoformat() if invite.expires_at else None,
            "max_uses": invite.max_uses,
            "is_active": invite.is_active,
        }, status=201)


class CommunityInviteRevokeView(MessagingGateMixin, APIView):
    permission_classes = [IsAuthenticated, IsMessagingParticipant]

    def post(self, request, invite_id):
        blocked = self._blocked()
        if blocked:
            return blocked
        invite = CommunityInvite.objects.select_related("community").filter(pk=invite_id).first()
        if invite is None:
            return Response({"detail": "Не найдено"}, status=404)
        try:
            revoke_invite(request.user, invite)
        except CommunityError as exc:
            return _error(exc)
        return Response({"ok": True})


class InvitePreviewView(MessagingGateMixin, APIView):
    permission_classes = [IsAuthenticated, IsMessagingParticipant]

    def get(self, request, token):
        blocked = self._blocked()
        if blocked:
            return blocked
        if not _allow_action(request.user.id, "invite-use", 30, 60):
            return rate_limit_drf_response()
        try:
            return Response(preview_invite(request.user, token))
        except CommunityError as exc:
            return _error(exc)


class InviteAcceptView(MessagingGateMixin, APIView):
    permission_classes = [IsAuthenticated, IsMessagingParticipant]

    def post(self, request):
        blocked = self._blocked()
        if blocked:
            return blocked
        if not _allow_action(request.user.id, "invite-use", 30, 60):
            return rate_limit_drf_response()
        try:
            community = accept_invite(
                request.user,
                token=(request.data.get("token") or "").strip(),
                invite_id=request.data.get("invite_id") or None,
            )
        except CommunityError as exc:
            return _error(exc)
        return Response({
            "conversation_id": str(community.conversation_id),
            "community": serialize_community_detail(community, request.user),
        })


class InviteDeclineView(MessagingGateMixin, APIView):
    permission_classes = [IsAuthenticated, IsMessagingParticipant]

    def post(self, request):
        blocked = self._blocked()
        if blocked:
            return blocked
        try:
            decline_invite(request.user, request.data.get("invite_id"))
        except CommunityError as exc:
            return _error(exc)
        return Response({"ok": True})


class CommunityLeaveView(MessagingGateMixin, APIView):
    permission_classes = [IsAuthenticated, IsMessagingParticipant]

    def post(self, request, conversation_id):
        blocked = self._blocked()
        if blocked:
            return blocked
        community = _member_community(request, conversation_id)
        if community is None:
            return Response({"detail": "Не найдено"}, status=404)
        try:
            leave_community(request.user, community)
        except CommunityError as exc:
            return _error(exc)
        return Response({"ok": True})


class CommunityMemberView(MessagingGateMixin, APIView):
    permission_classes = [IsAuthenticated, IsMessagingParticipant]

    def post(self, request, conversation_id, user_id):
        blocked = self._blocked()
        if blocked:
            return blocked
        community = _member_community(request, conversation_id)
        if community is None:
            return Response({"detail": "Не найдено"}, status=404)
        action = (request.data.get("action") or "").strip()
        try:
            if action == "role":
                set_member_role(request.user, community, user_id, request.data.get("role") or "")
            elif action == "remove":
                remove_member(request.user, community, user_id, ban=False)
            elif action == "ban":
                remove_member(request.user, community, user_id, ban=True)
            elif action == "mute":
                mute_member(request.user, community, user_id, minutes=request.data.get("minutes") or 60)
            else:
                return Response({"detail": "Некорректное действие"}, status=400)
        except CommunityError as exc:
            return _error(exc)
        return Response(serialize_community_detail(community, request.user))


class CommunityNotificationsView(MessagingGateMixin, APIView):
    permission_classes = [IsAuthenticated, IsMessagingParticipant]

    def post(self, request, conversation_id):
        blocked = self._blocked()
        if blocked:
            return blocked
        community = _member_community(request, conversation_id)
        if community is None:
            return Response({"detail": "Не найдено"}, status=404)
        try:
            set_notifications(
                request.user,
                community,
                mode=request.data.get("mode") or "all",
                muted_minutes=request.data.get("muted_minutes") or None,
            )
        except CommunityError as exc:
            return _error(exc)
        return Response({"ok": True})


class MessageReactionView(MessagingGateMixin, APIView):
    permission_classes = [IsAuthenticated, IsMessagingParticipant]

    def post(self, request, conversation_id, message_id):
        blocked = self._blocked()
        if blocked:
            return blocked
        if not _allow_action(request.user.id, "reaction", 60, 60):
            return rate_limit_drf_response()
        conversation = get_owned_conversation(request.user, conversation_id)
        if conversation is None:
            return Response({"detail": "Не найдено"}, status=404)
        try:
            message = toggle_reaction(request.user, conversation, message_id, request.data.get("emoji") or "")
        except CommunityError as exc:
            return _error(exc)
        publish_message_event(message, "message.updated")
        return Response({"message": serialize_message(message, request.user)})


class MessagePinView(MessagingGateMixin, APIView):
    permission_classes = [IsAuthenticated, IsMessagingParticipant]

    def post(self, request, conversation_id, message_id):
        blocked = self._blocked()
        if blocked:
            return blocked
        conversation = get_owned_conversation(request.user, conversation_id)
        if conversation is None:
            return Response({"detail": "Не найдено"}, status=404)
        try:
            message = pin_message(
                request.user,
                conversation,
                message_id,
                pinned=str(request.data.get("pinned", True)).lower() not in {"0", "false", "no"},
            )
        except CommunityError as exc:
            return _error(exc)
        publish_message_event(message, "message.updated")
        return Response({"message": serialize_message(message, request.user)})


class MessageReportView(MessagingGateMixin, APIView):
    permission_classes = [IsAuthenticated, IsMessagingParticipant]

    def post(self, request, conversation_id, message_id):
        blocked = self._blocked()
        if blocked:
            return blocked
        if not _allow_action(request.user.id, "report", 10, 3600):
            return rate_limit_drf_response()
        conversation = get_owned_conversation(request.user, conversation_id)
        if conversation is None:
            return Response({"detail": "Не найдено"}, status=404)
        try:
            report_message(
                request.user,
                conversation,
                message_id,
                reason=request.data.get("reason") or "",
                comment=request.data.get("comment") or "",
            )
        except CommunityError as exc:
            return _error(exc)
        return Response({"ok": True}, status=201)


class ConversationFilesView(MessagingGateMixin, APIView):
    permission_classes = [IsAuthenticated, IsMessagingParticipant]

    def get(self, request, conversation_id):
        blocked = self._blocked()
        if blocked:
            return blocked
        conversation = get_owned_conversation(request.user, conversation_id)
        if conversation is None or not community_still_allowed(conversation, request.user):
            return Response({"detail": "Не найдено"}, status=404)
        rows = MessageAttachment.objects.filter(
            conversation=conversation,
            message__deleted_at__isnull=True,
            message__message_type="message",
        ).order_by("-id")[:100]
        return Response({"files": [serialize_attachment(item) for item in rows]})


def _member_community(request, conversation_id):
    conversation = get_owned_conversation(request.user, conversation_id)
    return community_for_conversation(conversation) if conversation else None


def _community_or_404(request, conversation_id):
    community = _member_community(request, conversation_id)
    if community is None and can_manage_all_communities(request.user):
        return Community.objects.filter(conversation_id=conversation_id).first()
    return community


def moderator_delete_message(user, conversation, message_id):
    from .communities import moderator_delete
    from .services import MessagingError
    try:
        return moderator_delete(user, conversation, message_id)
    except CommunityError as exc:
        raise MessagingError(exc.message, exc.code) from exc
