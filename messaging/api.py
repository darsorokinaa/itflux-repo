import json
import logging

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.conf import settings
from django.core.cache import cache
from django.http import FileResponse, HttpResponse
from django.core.files.storage import default_storage
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from Cabinet.rate_limit import rate_limit_drf_response
from Cabinet.upload_validation import UploadValidationError

from .attachments import download_headers, safe_storage_relative
from .checks import messaging_is_blocked
from .models import MessageAttachment
from .permissions import IsMessagingParticipant
from .purpose import PurposeRejected
from .access import role_of, search_contacts
from .permissions import user_can_staff_messaging
from .safety import MessageBlocked
from .services import (
    MessagingError,
    create_support_ticket,
    delete_user_message,
    edit_user_message,
    direct_still_allowed,
    get_owned_conversation,
    list_conversations,
    log_attachment_download,
    mark_delivered,
    mark_read,
    open_direct_conversation,
    page_messages,
    post_user_message,
    serialize_conversation,
    serialize_message,
    unread_count_for_user,
)
from .models import ConversationParticipant, Message

logger = logging.getLogger("messaging")


def _rejected_response(exc, status=400):
    payload = {
        "detail": getattr(exc, "message", "Некорректный запрос"),
        "code": getattr(exc, "code", "invalid"),
    }
    reason = getattr(exc, "reason", "")
    if reason:
        payload["reason"] = reason
    return Response(payload, status=status)


def user_group_name(user_id: int) -> str:
    return f"messaging_user_{user_id}"


def _community_file_allowed(conversation, user) -> bool:
    from .communities import community_still_allowed
    return community_still_allowed(conversation, user)


def publish_message_event(message: Message, event: str) -> None:
    from .communities import active_member, community_for_conversation, should_notify_member
    from .models import MessageMention
    participants = ConversationParticipant.objects.filter(
        conversation_id=message.conversation_id,
        hidden_at__isnull=True,
    ).select_related("user")
    community = community_for_conversation(message.conversation)
    mentioned_ids = set(MessageMention.objects.filter(message=message).values_list("user_id", flat=True))
    for participant in participants:
        notify = True
        if community is not None:
            member = active_member(community, participant.user)
            notify = should_notify_member(member, participant.user_id in mentioned_ids)
        publish_event(participant.user_id, event, {
            "conversation_id": str(message.conversation_id),
            "message": serialize_message(message, participant.user),
            "unread_count": unread_count_for_user(participant.user),
            "notify": notify,
        })


def publish_event(user_id: int, event: str, payload: dict) -> None:
    layer = get_channel_layer()
    if layer is None:
        return
    try:
        async_to_sync(layer.group_send)(
            user_group_name(user_id),
            {"type": "messaging.event", "event": event, "payload": payload},
        )
    except Exception:
        logger.warning("messaging_publish_failed user_id=%s event=%s", user_id, event, exc_info=True)


def _allow_action(user_id: int, bucket: str, limit: int, window: int) -> bool:
    key = f"rl:messaging-{bucket}:{user_id}"
    try:
        count = cache.incr(key)
    except ValueError:
        cache.set(key, 1, timeout=window)
        return True
    if count == 1:
        cache.touch(key, timeout=window)
    return count <= limit


def _allow_send(user_id: int) -> bool:
    return _allow_action(user_id, "send", 30, 60)


class MessagingGateMixin:
    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        if hasattr(response, "__setitem__"):
            response["Cache-Control"] = "private, no-store"
        return response

    def _blocked(self):
        if messaging_is_blocked():
            return Response(
                {
                    "detail": "Раздел сообщений не включён: не заданы сроки хранения или общий Redis.",
                    "code": "messaging_not_ready",
                },
                status=503,
            )
        return None


class MessageSearchView(MessagingGateMixin, APIView):
    permission_classes = [IsAuthenticated, IsMessagingParticipant]

    def get(self, request):
        blocked = self._blocked()
        if blocked:
            return blocked
        if not _allow_action(request.user.id, "search", 30, 60):
            return rate_limit_drf_response()
        needle = (request.query_params.get("q") or "").strip()[:100]
        if len(needle) < 2:
            return Response({"results": []})
        from .models import ConversationParticipant, Message
        owned_ids = ConversationParticipant.objects.filter(
            user=request.user,
            hidden_at__isnull=True,
        ).values_list("conversation_id", flat=True)
        rows = (
            Message.objects.filter(
                conversation_id__in=owned_ids,
                deleted_at__isnull=True,
                message_type=Message.MessageType.MESSAGE,
                text__icontains=needle,
            )
            .select_related("conversation")
            .order_by("-id")[:40]
        )
        results = []
        seen = set()
        for message in rows:
            conversation = get_owned_conversation(request.user, message.conversation_id)
            if conversation is None or conversation.id in seen:
                continue
            seen.add(conversation.id)
            results.append({
                "conversation_id": str(conversation.id),
                "message_id": message.id,
                "excerpt": (message.text or "")[:160],
            })
            if len(results) >= 12:
                break
        return Response({"results": results})


class ConversationListView(MessagingGateMixin, APIView):
    permission_classes = [IsAuthenticated, IsMessagingParticipant]

    def get(self, request):
        blocked = self._blocked()
        if blocked:
            return blocked
        from .communities import can_manage_all_communities, list_my_invites
        return Response({
            "viewer_role": role_of(request.user),
            "can_manage_communities": can_manage_all_communities(request.user),
            "invitations": list_my_invites(request.user),
            "conversations": list_conversations(request.user),
        })


class UnreadCountView(MessagingGateMixin, APIView):
    permission_classes = [IsAuthenticated, IsMessagingParticipant]

    def get(self, request):
        blocked = self._blocked()
        if blocked:
            return blocked
        return Response({"unread_count": unread_count_for_user(request.user)})


class SupportTicketCreateView(MessagingGateMixin, APIView):
    permission_classes = [IsAuthenticated, IsMessagingParticipant]

    def post(self, request):
        blocked = self._blocked()
        if blocked:
            return blocked
        if not _allow_send(request.user.id):
            return rate_limit_drf_response()
        uploads = request.FILES.getlist("files")
        try:
            conversation, ticket, message = create_support_ticket(
                request.user,
                category=(request.data.get("category") or "").strip(),
                subject=request.data.get("subject") or "",
                text=request.data.get("text") or "",
                uploads=uploads,
                client_message_id=(request.data.get("client_message_id") or "").strip(),
            )
        except (MessagingError, MessageBlocked, UploadValidationError) as exc:
            return _rejected_response(exc)
        payload = serialize_message(message, request.user)
        publish_event(request.user.id, "ticket.created", {
            "conversation_id": str(conversation.id),
            "ticket_id": str(ticket.id),
            "message": payload,
            "unread_count": unread_count_for_user(request.user),
        })
        publish_message_event(message, "message.new")
        return Response(
            {
                "conversation": serialize_conversation(conversation, request.user),
                "ticket_id": str(ticket.id),
                "message": payload,
            },
            status=201,
        )


class MessageListCreateView(MessagingGateMixin, APIView):
    permission_classes = [IsAuthenticated, IsMessagingParticipant]

    def get(self, request, conversation_id):
        blocked = self._blocked()
        if blocked:
            return blocked
        conversation = get_owned_conversation(request.user, conversation_id)
        if conversation is None:
            return Response({"detail": "Диалог не найден"}, status=404)
        try:
            messages, has_more = page_messages(
                conversation,
                request.user,
                before=request.query_params.get("before") or None,
                after=request.query_params.get("after") or None,
                limit=request.query_params.get("limit") or 50,
                query=request.query_params.get("q") or "",
                author_id=request.query_params.get("author") or None,
                has_files=request.query_params.get("has_files") or "",
                on_date=request.query_params.get("date") or "",
            )
        except (TypeError, ValueError):
            return Response({"detail": "Некорректная страница"}, status=400)
        return Response({
            "conversation": serialize_conversation(conversation, request.user),
            "messages": messages,
            "has_more": has_more,
        })

    def post(self, request, conversation_id):
        blocked = self._blocked()
        if blocked:
            return blocked
        if not _allow_send(request.user.id):
            return rate_limit_drf_response()
        conversation = get_owned_conversation(request.user, conversation_id)
        if conversation is None:
            return Response({"detail": "Диалог не найден"}, status=404)
        reply_raw = request.data.get("reply_to")
        try:
            reply_to = int(reply_raw) if reply_raw else None
        except (TypeError, ValueError):
            return Response({"detail": "Некорректный ответ"}, status=400)
        try:
            raw_mentions = request.data.get("mention_user_ids") or []
            if isinstance(raw_mentions, str):
                raw_mentions = [part for part in raw_mentions.split(",") if part]
            mention_ids = []
            for item in raw_mentions:
                try:
                    mention_ids.append(int(item))
                except (TypeError, ValueError):
                    continue
            message = post_user_message(
                request.user,
                conversation,
                text=request.data.get("text") or "",
                reply_to_id=reply_to,
                client_message_id=(request.data.get("client_message_id") or "").strip(),
                uploads=request.FILES.getlist("files"),
                mention_user_ids=mention_ids,
            )
        except (MessagingError, MessageBlocked, UploadValidationError, PurposeRejected) as exc:
            return _rejected_response(exc)
        publish_message_event(message, "message.new")
        return Response({"message": serialize_message(message, request.user)}, status=201)


class MessageReadView(MessagingGateMixin, APIView):
    permission_classes = [IsAuthenticated, IsMessagingParticipant]

    def post(self, request, conversation_id):
        blocked = self._blocked()
        if blocked:
            return blocked
        conversation = get_owned_conversation(request.user, conversation_id)
        if conversation is None:
            return Response({"detail": "Диалог не найден"}, status=404)
        try:
            message_id = int(request.data.get("message_id"))
        except (TypeError, ValueError):
            return Response({"detail": "Не указано сообщение"}, status=400)
        try:
            mark_read(request.user, conversation, message_id)
        except MessagingError as exc:
            return Response({"detail": exc.message, "code": exc.code}, status=404)
        for user_id in ConversationParticipant.objects.filter(
            conversation=conversation,
            hidden_at__isnull=True,
        ).values_list("user_id", flat=True):
            publish_event(user_id, "message.read", {
                "conversation_id": str(conversation.id),
                "message_id": message_id,
                "unread_count": unread_count_for_user(request.user) if user_id == request.user.id else None,
            })
        publish_event(request.user.id, "unread.updated", {
            "unread_count": unread_count_for_user(request.user),
        })
        return Response({"ok": True, "unread_count": unread_count_for_user(request.user)})


class MessageDeliveredView(MessagingGateMixin, APIView):
    permission_classes = [IsAuthenticated, IsMessagingParticipant]

    def post(self, request, conversation_id):
        blocked = self._blocked()
        if blocked:
            return blocked
        conversation = get_owned_conversation(request.user, conversation_id)
        if conversation is None:
            return Response({"detail": "Диалог не найден"}, status=404)
        try:
            message_id = int(request.data.get("message_id"))
        except (TypeError, ValueError):
            return Response({"detail": "Не указано сообщение"}, status=400)
        try:
            mark_delivered(request.user, conversation, message_id)
        except MessagingError as exc:
            return Response({"detail": exc.message, "code": exc.code}, status=404)
        publish_event(request.user.id, "message.delivered", {
            "conversation_id": str(conversation.id),
            "message_id": message_id,
        })
        return Response({"ok": True})


class AttachmentDownloadView(MessagingGateMixin, APIView):
    permission_classes = [IsAuthenticated, IsMessagingParticipant]

    def get(self, request, attachment_id):
        blocked = self._blocked()
        if blocked:
            return blocked
        attachment = (
            MessageAttachment.objects.select_related("conversation", "message")
            .filter(
                pk=attachment_id,
                conversation__participants__user=request.user,
                conversation__participants__hidden_at__isnull=True,
            )
            .first()
        )
        if (
            attachment is None
            or attachment.message.message_type != "message"
            or attachment.message.deleted_at
            or not direct_still_allowed(attachment.conversation, request.user)
            or not _community_file_allowed(attachment.conversation, request.user)
        ):
            return Response({"detail": "Файл не найден"}, status=404)
        try:
            relative = safe_storage_relative(attachment.storage_key)
        except UploadValidationError:
            return Response({"detail": "Файл не найден"}, status=404)
        if not default_storage.exists(attachment.storage_key):
            return Response({"detail": "Файл не найден"}, status=404)
        log_attachment_download(actor=request.user, attachment=attachment)
        mime, disposition = download_headers(attachment.original_name)
        if getattr(settings, "MESSAGING_USE_X_ACCEL", False):
            response = HttpResponse()
            prefix = getattr(settings, "MESSAGING_X_ACCEL_PREFIX", "/internal-messaging-files/")
            response["X-Accel-Redirect"] = prefix + relative
            response["Content-Type"] = mime
            response["Content-Disposition"] = disposition
            response["X-Content-Type-Options"] = "nosniff"
            response["Cache-Control"] = "private, no-store"
            return response
        handle = default_storage.open(attachment.storage_key, "rb")
        response = FileResponse(handle, content_type=mime)
        response["Content-Disposition"] = disposition
        response["X-Content-Type-Options"] = "nosniff"
        response["Cache-Control"] = "private, no-store"
        return response


class ContactSearchView(MessagingGateMixin, APIView):
    permission_classes = [IsAuthenticated, IsMessagingParticipant]

    def get(self, request):
        blocked = self._blocked()
        if blocked:
            return blocked
        if not _allow_action(request.user.id, "contacts", 60, 60):
            return rate_limit_drf_response()
        return Response({
            "viewer_role": role_of(request.user),
            "contacts": search_contacts(request.user, (request.query_params.get("q") or "")[:100]),
        })


class DirectConversationView(MessagingGateMixin, APIView):
    permission_classes = [IsAuthenticated, IsMessagingParticipant]

    def post(self, request):
        blocked = self._blocked()
        if blocked:
            return blocked
        if not _allow_send(request.user.id):
            return rate_limit_drf_response()
        try:
            conversation = open_direct_conversation(request.user, request.data.get("user_id"))
        except MessagingError as exc:
            status = 404 if exc.code == "not_found" else 400
            return Response({"detail": exc.message, "code": exc.code}, status=status)
        return Response({"conversation": serialize_conversation(conversation, request.user)})


class MessageDetailView(MessagingGateMixin, APIView):
    permission_classes = [IsAuthenticated, IsMessagingParticipant]

    def patch(self, request, conversation_id, message_id):
        blocked = self._blocked()
        if blocked:
            return blocked
        if not _allow_action(request.user.id, "edit", 30, 60):
            return rate_limit_drf_response()
        conversation = get_owned_conversation(request.user, conversation_id)
        if conversation is None:
            return Response({"detail": "Диалог не найден"}, status=404)
        try:
            message = edit_user_message(
                request.user,
                conversation,
                int(message_id),
                request.data.get("text") or "",
            )
        except (MessagingError, MessageBlocked, ValueError) as exc:
            if isinstance(exc, MessageBlocked):
                return _rejected_response(exc)
            code = getattr(exc, "code", "invalid")
            status = 404 if code == "message_not_found" else 400
            return _rejected_response(exc, status=status)
        publish_message_event(message, "message.updated")
        return Response({"message": serialize_message(message, request.user)})

    def delete(self, request, conversation_id, message_id):
        blocked = self._blocked()
        if blocked:
            return blocked
        if not _allow_action(request.user.id, "delete", 30, 60):
            return rate_limit_drf_response()
        conversation = get_owned_conversation(request.user, conversation_id)
        if conversation is None:
            return Response({"detail": "Диалог не найден"}, status=404)
        try:
            if conversation.kind == "community":
                from .community_api import moderator_delete_message
                message = moderator_delete_message(request.user, conversation, int(message_id))
            else:
                message = delete_user_message(request.user, conversation, int(message_id))
        except (MessagingError, ValueError) as exc:
            return Response({"detail": getattr(exc, "message", "Не найдено"), "code": getattr(exc, "code", "invalid")}, status=404)
        publish_message_event(message, "message.deleted")
        return Response({"message": serialize_message(message, request.user)})


class MessageImportantView(MessagingGateMixin, APIView):
    permission_classes = [IsAuthenticated, IsMessagingParticipant]

    def post(self, request, conversation_id, message_id):
        blocked = self._blocked()
        if blocked:
            return blocked
        if not (request.user.is_staff or request.user.is_superuser or user_can_staff_messaging(request.user, "manage")):
            return Response({"detail": "Недостаточно прав"}, status=403)
        conversation = get_owned_conversation(request.user, conversation_id)
        if conversation is None:
            return Response({"detail": "Сообщение не найдено"}, status=404)
        message = Message.objects.filter(
            conversation=conversation,
            id=message_id,
            message_type=Message.MessageType.MESSAGE,
            deleted_at__isnull=True,
        ).first()
        if message is None:
            return Response({"detail": "Сообщение не найдено"}, status=404)
        message.is_important = bool(request.data.get("is_important"))
        message.save(update_fields=["is_important", "updated_at"])
        publish_message_event(message, "message.updated")
        return Response({"message": serialize_message(message, request.user)})


def parse_typing_payload(raw: str) -> dict | None:
    try:
        data = json.loads(raw)
    except (TypeError, ValueError):
        return None
    if not isinstance(data, dict) or data.get("type") != "typing":
        return None
    conversation_id = str(data.get("conversation_id") or "")
    if not conversation_id:
        return None
    return {"conversation_id": conversation_id, "active": bool(data.get("active"))}
