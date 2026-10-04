import os
import django

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "Generator.settings")

django.setup()

from Cabinet.http_db_budget import HttpDbBudget
from Cabinet.loop_log import protect_logger
from Cabinet.process_snapshot import start_process_snapshots
from Cabinet.realtime_db import RealtimeDbScope, install_realtime_db_pool

for _async_logger in (
    "itflux.realtime_db",
    "itflux.ws",
    "Cabinet.boards_consumers",
    "Cabinet.meeting_consumers",
    "Cabinet.meeting_material_session",
    "messaging",
    "Generator.consumers",
    "Generator.Generator.consumers",
    "django.request",
    "django.server",
    "daphne",
    "daphne.server",
):
    protect_logger(_async_logger)
protect_logger("")

install_realtime_db_pool()
start_process_snapshots()

from channels.routing import ProtocolTypeRouter, URLRouter
from channels.auth import AuthMiddlewareStack
from django.core.asgi import get_asgi_application
import Board.routing
import Cabinet.routing as cabinet_routing
import messaging.routing as messaging_routing
from Generator.Generator import routing as lesson_routing

_ws_patterns = (
    Board.routing.websocket_urlpatterns
    + cabinet_routing.websocket_urlpatterns
    + lesson_routing.websocket_urlpatterns
    + messaging_routing.websocket_urlpatterns
)

application = ProtocolTypeRouter({
    "http": HttpDbBudget(get_asgi_application()),
    "websocket": RealtimeDbScope(
        AuthMiddlewareStack(
            URLRouter(_ws_patterns)
        )
    ),
})
