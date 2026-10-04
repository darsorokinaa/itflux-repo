"""Give each ASGI connection its own thread-sensitive executor.

Django's HTTP handler already enters asgiref.ThreadSensitiveContext, so one
request's ORM does not share a thread with another request. Channels does not
do this for websockets. Every database_sync_to_async call, and the
close_old_connections call Channels makes before each socket message, then
falls through to one process-wide thread.

ORM stays thread_sensitive=True. Queries for one connection stay on that
connection's thread. A slow query on one socket does not occupy the thread
used by another socket.
"""

from asgiref.sync import ThreadSensitiveContext


class PerConnectionThreadContext:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        async with ThreadSensitiveContext():
            await self.app(scope, receive, send)
