"""Статистика качества звонка: приём снимков из браузера и сводка по встрече.

Браузер присылает только числа WebRTC (RTT, потери, джиттер, битрейт, кадры
демонстрации, тип соединения). Всё остальное отбрасывается.
"""

from __future__ import annotations

import math
from typing import Any

from django.db.models import Avg, Count, Max, Min, Q

from .call_stats_models import CallStatsSample

MAX_BODY_BYTES = 2048

_INT_FIELDS = {
    "rtt_ms": 60_000,
    "jitter_ms": 60_000,
    "bitrate_in_kbps": 100_000,
    "bitrate_out_kbps": 100_000,
    "audio_out_kbps": 1_000,
    "share_width": 8_192,
    "share_height": 8_192,
    "reconnects": 1_000,
}
_FLOAT_FIELDS = {
    "loss_in_pct": 100.0,
    "loss_out_pct": 100.0,
    "share_fps": 120.0,
}
_CHOICE_FIELDS = {
    "provider": frozenset({"livekit", "jitsi"}),
    "share_direction": frozenset({"send", "recv"}),
    "quality_limitation": frozenset({"none", "bandwidth", "cpu", "other"}),
    "connection_type": frozenset({"direct", "relay"}),
    "transport": frozenset({"udp", "tcp", "tls"}),
    "connection_quality": frozenset({"excellent", "good", "poor", "lost", "unknown"}),
}


def _number(value: Any, ceiling: float) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    if not math.isfinite(value) or value < 0:
        return None
    return min(float(value), ceiling)


def _choice(value: Any, allowed: frozenset) -> str:
    text = str(value or "").strip().lower()[:16]
    return text if text in allowed else ""


def clean_call_stats(data: Any) -> dict:
    """Белый список полей. Неизвестные ключи и мусорные значения выбрасываются."""
    if not isinstance(data, dict):
        return {}
    cleaned: dict = {}
    for name, ceiling in _INT_FIELDS.items():
        number = _number(data.get(name), ceiling)
        if number is not None:
            cleaned[name] = round(number)
    for name, ceiling in _FLOAT_FIELDS.items():
        number = _number(data.get(name), ceiling)
        if number is not None:
            cleaned[name] = round(number, 2)
    for name, allowed in _CHOICE_FIELDS.items():
        choice = _choice(data.get(name), allowed)
        if choice:
            cleaned[name] = choice
    return cleaned


def has_metrics(cleaned: dict) -> bool:
    return any(
        name in cleaned
        for name in (*_INT_FIELDS, *_FLOAT_FIELDS)
        if name != "reconnects"
    )


def record_call_stats(*, meeting, user, role: str, cleaned: dict) -> CallStatsSample:
    return CallStatsSample.objects.create(
        meeting=meeting,
        user=user,
        role=str(role or "")[:16],
        **cleaned,
    )


def _rounded(value, digits=1):
    return None if value is None else round(float(value), digits)


def meeting_call_stats_summary(meeting) -> list[dict]:
    """По участнику: число снимков, средние/худшие значения, доля relay."""
    rows = (
        CallStatsSample.objects.filter(meeting=meeting)
        .values("user_id", "role", "provider")
        .annotate(
            samples=Count("id"),
            rtt_avg=Avg("rtt_ms"),
            rtt_max=Max("rtt_ms"),
            jitter_avg=Avg("jitter_ms"),
            loss_in_avg=Avg("loss_in_pct"),
            loss_out_avg=Avg("loss_out_pct"),
            loss_max=Max("loss_in_pct"),
            in_avg=Avg("bitrate_in_kbps"),
            out_avg=Avg("bitrate_out_kbps"),
            share_fps_min=Min("share_fps"),
            share_fps_avg=Avg("share_fps"),
            share_height_max=Max("share_height"),
            relay=Count("id", filter=Q(connection_type="relay")),
            bandwidth_limited=Count("id", filter=Q(quality_limitation="bandwidth")),
            reconnects=Max("reconnects"),
            first=Min("created_at"),
            last=Max("created_at"),
        )
        .order_by("user_id", "provider")
    )
    summary = []
    for row in rows:
        samples = row["samples"] or 1
        summary.append(
            {
                "userId": row["user_id"],
                "role": row["role"],
                "provider": row["provider"],
                "samples": row["samples"],
                "rttAvgMs": _rounded(row["rtt_avg"], 0),
                "rttMaxMs": row["rtt_max"],
                "jitterAvgMs": _rounded(row["jitter_avg"], 0),
                "lossInAvgPct": _rounded(row["loss_in_avg"]),
                "lossOutAvgPct": _rounded(row["loss_out_avg"]),
                "lossInMaxPct": _rounded(row["loss_max"]),
                "bitrateInAvgKbps": _rounded(row["in_avg"], 0),
                "bitrateOutAvgKbps": _rounded(row["out_avg"], 0),
                "shareFpsMin": _rounded(row["share_fps_min"]),
                "shareFpsAvg": _rounded(row["share_fps_avg"]),
                "shareHeightMax": row["share_height_max"],
                "relaySharePct": round(100.0 * row["relay"] / samples, 1),
                "bandwidthLimitedPct": round(
                    100.0 * row["bandwidth_limited"] / samples, 1
                ),
                "reconnects": row["reconnects"] or 0,
                "first": row["first"].isoformat() if row["first"] else None,
                "last": row["last"].isoformat() if row["last"] else None,
            }
        )
    return summary
