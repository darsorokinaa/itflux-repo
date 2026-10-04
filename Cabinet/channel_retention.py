"""Drop expired in-memory channel messages without waiting for the next socket."""

from __future__ import annotations


def channel_layer_stats(layer=None) -> dict:
    if layer is None:
        from channels.layers import get_channel_layer

        layer = get_channel_layer()
    channels = getattr(layer, "channels", None) or {}
    groups = getattr(layer, "groups", None) or {}
    queued = 0
    for queue in channels.values():
        queued += int(getattr(queue, "qsize", lambda: 0)())
    return {
        "channel_queues": len(channels),
        "channel_queued_messages": queued,
        "channel_groups": len(groups),
    }


def clean_expired_channels(layer=None) -> dict:
    if layer is None:
        from channels.layers import get_channel_layer

        layer = get_channel_layer()
    cleaner = getattr(layer, "_clean_expired", None)
    if callable(cleaner):
        cleaner()
    return channel_layer_stats(layer)
