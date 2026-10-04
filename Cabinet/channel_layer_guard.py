"""Refuse a multi-process Daphne with the in-memory channel layer.

One Daphne process can use InMemoryChannelLayer. A second process would not
see its groups. Redis is not started here; the process fails at boot instead.
"""

from __future__ import annotations

import os


def assert_channel_layer_process_model() -> None:
    from django.conf import settings

    backend = str(settings.CHANNEL_LAYERS.get("default", {}).get("BACKEND") or "")
    if not backend.endswith("InMemoryChannelLayer"):
        return
    raw = (os.environ.get("DAPHNE_WORKERS") or os.environ.get("WEB_CONCURRENCY") or "1").strip()
    try:
        workers = int(raw)
    except ValueError:
        workers = 1
    if workers > 1:
        raise RuntimeError(
            "InMemoryChannelLayer cannot fan out across "
            f"{workers} processes (DAPHNE_WORKERS/WEB_CONCURRENCY). "
            "Run one Daphne process, or set CHANNEL_LAYER_BACKEND=redis and run Redis."
        )
