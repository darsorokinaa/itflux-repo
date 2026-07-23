from django.urls import re_path

from .boards_consumers import InteractiveBoardConsumer
from .meeting_consumers import VideoMeetingConsumer

websocket_urlpatterns = [
    re_path(
        r"ws/interactive-boards/(?P<board_id>[0-9a-fA-F-]{36})/$",
        InteractiveBoardConsumer.as_asgi(),
    ),
    re_path(
        r"ws/video-meetings/(?P<meeting_uuid>[0-9a-fA-F-]{36})/$",
        VideoMeetingConsumer.as_asgi(),
    ),
]
