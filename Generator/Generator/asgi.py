import os

import django

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "Generator.settings")
django.setup()

from Cabinet.channel_layer_guard import assert_channel_layer_process_model
from Cabinet.large_json import install_large_json_log
from Cabinet.loop_log import protect_logger
from Cabinet.notification_delivery import start_background_delivery
from Cabinet.process_snapshot import start_process_snapshots
from Cabinet.realtime_db import RealtimeDbScope, install_realtime_db_pool
from Cabinet.thread_sensitive_shutdown import install_nonblocking_executor_shutdown

# Daphne's working directory is Generator/, so this module is the process
# that serves sockets. QueueHandler has to be installed here. The other
# asgi.py is not imported.
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

install_nonblocking_executor_shutdown()
install_large_json_log()
assert_channel_layer_process_model()
start_background_delivery()
install_realtime_db_pool()
start_process_snapshots()

from channels.auth import AuthMiddlewareStack
from channels.routing import ProtocolTypeRouter, URLRouter
from django.core.asgi import get_asgi_application

import Generator.routing
import messaging.routing

application = ProtocolTypeRouter({
    "http": get_asgi_application(),
    "websocket": RealtimeDbScope(
        AuthMiddlewareStack(
            URLRouter(
                Generator.routing.websocket_urlpatterns
                + messaging.routing.websocket_urlpatterns
            )
        )
    ),
})
