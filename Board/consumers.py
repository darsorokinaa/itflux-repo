from channels.generic.websocket import AsyncWebsocketConsumer


class BoardConsumer(AsyncWebsocketConsumer):
    """
    Legacy board relay. Unauthenticated access is disabled.
    Interactive boards use Cabinet InteractiveBoardConsumer with ACL.
    """

    async def connect(self):
        user = self.scope.get("user")
        if not user or not getattr(user, "is_authenticated", False):
            await self.close(code=4401)
            return
        # Authenticated-only relay still allows any room_name — keep for
        # internal test pages, but never expose anonymously.
        self.room_name = self.scope["url_route"]["kwargs"]["room_name"]
        self.room_group_name = f"board_{self.room_name}"

        await self.channel_layer.group_add(
            self.room_group_name,
            self.channel_name
        )

        await self.accept()

    async def disconnect(self, close_code):
        if getattr(self, "room_group_name", None):
            await self.channel_layer.group_discard(
                self.room_group_name,
                self.channel_name
            )

    async def receive(self, text_data):
        if len(text_data or "") > 256_000:
            return
        await self.channel_layer.group_send(
            self.room_group_name,
            {
                "type": "board_event",
                "message": text_data
            }
        )

    async def board_event(self, event):
        await self.send(text_data=event["message"])
