from django.urls import re_path

import Board.routing
import Cabinet.routing as cabinet_routing

from .consumers import LessonConsumer

websocket_urlpatterns = [
    re_path(r"ws/lesson/(?P<room_id>[^/]+)/$", LessonConsumer.as_asgi()),
    *Board.routing.websocket_urlpatterns,
    *cabinet_routing.websocket_urlpatterns,
]
