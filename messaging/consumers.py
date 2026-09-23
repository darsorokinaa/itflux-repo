import importlib
import json
import logging

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncWebsocketConsumer
from django.conf import settings
from django.contrib.auth.models import User

from .api import parse_typing_payload, user_group_name
from .checks import messaging_is_blocked
from .permissions import messaging_role_allowed
from .services import typing_recipient_ids

logger = logging.getLogger("messaging")


def connection_still_valid(user, scope) -> bool:
    """Сессия после выхода и заблокированный профиль больше не держат сокет."""
    if user is None or not getattr(user, "is_authenticated", False) or not getattr(user, "is_active", False):
        return False
    fresh = User.objects.filter(pk=user.id, is_active=True).select_related("profile").first()
    if fresh is None or not messaging_role_allowed(fresh):
        return False
    from .services import has_messaging_consent
    if not has_messaging_consent(fresh):
        return False
    session = scope.get("session") if isinstance(scope, dict) else None
    key = getattr(session, "session_key", None) if session is not None else None
    if not key:
        return True
    engine = importlib.import_module(settings.SESSION_ENGINE)
    return engine.SessionStore(session_key=key).exists(key)


class MessagingConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        user = self.scope.get("user")
        if not user or not user.is_authenticated:
            await self.close(code=4401)
            return
        allowed = await database_sync_to_async(connection_still_valid)(user, self.scope)
        blocked = await database_sync_to_async(messaging_is_blocked)()
        if not allowed or blocked:
            await self.close(code=4403)
            return
        self.user = user
        self.group_name = user_group_name(user.id)
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()
        logger.info("messaging_ws_connect user=%s", user.id)

    async def disconnect(self, code):
        if getattr(self, "group_name", None):
            await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def receive(self, text_data=None, bytes_data=None):
        if not text_data:
            return
        if not await database_sync_to_async(connection_still_valid)(self.user, self.scope):
            await self.close(code=4401)
            return
        payload = parse_typing_payload(text_data)
        if payload is None:
            return
        recipient_ids = await database_sync_to_async(typing_recipient_ids)(
            self.user,
            payload["conversation_id"],
        )
        if recipient_ids is None:
            return
        frame = {
            "type": "messaging.event",
            "event": "typing",
            "payload": {
                "conversation_id": payload["conversation_id"],
                "active": payload["active"],
            },
        }
        for user_id in recipient_ids:
            await self.channel_layer.group_send(user_group_name(user_id), frame)

    async def messaging_event(self, event):
        if not await database_sync_to_async(connection_still_valid)(getattr(self, "user", None), self.scope):
            await self.close(code=4401)
            return
        await self.send(text_data=json.dumps({
            "type": event.get("event"),
            "payload": event.get("payload") or {},
        }))
