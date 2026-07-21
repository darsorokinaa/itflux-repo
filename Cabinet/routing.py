from django.urls import re_path

from .boards_consumers import InteractiveBoardConsumer

websocket_urlpatterns = [
    re_path(
        r"ws/interactive-boards/(?P<board_id>[0-9a-fA-F-]{36})/$",
        InteractiveBoardConsumer.as_asgi(),
    ),
]
