import os
import django

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "Generator.settings")

django.setup()

from channels.routing import ProtocolTypeRouter, URLRouter
from channels.auth import AuthMiddlewareStack
from django.core.asgi import get_asgi_application
import Board.routing
import Cabinet.routing as cabinet_routing
from Generator.Generator import routing as lesson_routing

_ws_patterns = (
    Board.routing.websocket_urlpatterns
    + cabinet_routing.websocket_urlpatterns
    + lesson_routing.websocket_urlpatterns
)

application = ProtocolTypeRouter({
    "http": get_asgi_application(),
    "websocket": AuthMiddlewareStack(
        URLRouter(_ws_patterns)
    ),
})
