import os

import django

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "Generator.settings")
django.setup()

from channels.auth import AuthMiddlewareStack
from channels.routing import ProtocolTypeRouter, URLRouter
from django.core.asgi import get_asgi_application

import Generator.routing
import messaging.routing

application = ProtocolTypeRouter({
    "http": get_asgi_application(),
    "websocket": AuthMiddlewareStack(
        URLRouter(
            Generator.routing.websocket_urlpatterns
            + messaging.routing.websocket_urlpatterns
        )
    ),
})
