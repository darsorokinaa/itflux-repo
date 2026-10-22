"""r95: качество звонков cdn vs direct по MeetingTechnicalEvent + автопереходы (CdnSwitchEvent).

Маршрут сессии берётся из metadata.route, который сервер ставит по Host (с r95).
События до r95 маршрута не имеют -> строка "unknown".
"""
from collections import Counter, defaultdict
from datetime import timedelta

from django.core.management.base import BaseCommand
from django.db.models import Count, Max, Min
from django.utils import timezone

DROP_TYPES = ("connection_reconnecting", "connection_failed")
JOIN_TIMEOUT_REASON = "jitsi_join_fatal_timeout"


def session_stats(since, until=None):
    from Cabinet.models import MeetingTechnicalEvent as E
    qs = E.objects.filter(occurred_at__gte=since).exclude(call_session_id="")
    if until:
        qs = qs.filter(occurred_at__lt=until)
    s = defaultdict(lambda: {"routes": Counter(), "ua": Counter(), "types": Counter(), "jt": 0,
                             "first": None, "last": None, "joined_at": None, "users": set()})
    for row in qs.values("call_session_id").annotate(a=Min("occurred_at"), b=Max("occurred_at")):
        s[row["call_session_id"]]["first"], s[row["call_session_id"]]["last"] = row["a"], row["b"]
    for row in (qs.exclude(metadata__route=None).values("call_session_id", "metadata__route", "metadata__uaFamily")
                .annotate(c=Count("id"))):
        x = s[row["call_session_id"]]
        x["routes"][row["metadata__route"]] += row["c"]
        if row["metadata__uaFamily"]:
            x["ua"][row["metadata__uaFamily"]] += row["c"]
    for row in (qs.exclude(event_type="participant_count").values("call_session_id", "event_type", "reason", "user_id")
                .annotate(c=Count("id"), a=Min("occurred_at"))):
        x = s[row["call_session_id"]]
        x["types"][row["event_type"]] += row["c"]
        if row["user_id"]:
            x["users"].add(row["user_id"])
        if row["event_type"] == "conference_failed" and row["reason"] == JOIN_TIMEOUT_REASON:
            x["jt"] += row["c"]
        if row["event_type"] == "conference_joined":
            x["joined_at"] = min(filter(None, [x["joined_at"], row["a"]]))
    out = {}
    for sid, x in s.items():
        route = x["routes"].most_common(1)[0][0] if x["routes"] else "unknown"
        if route not in ("cdn", "direct"):
            route = "unknown"
        dur = (x["last"] - x["joined_at"]).total_seconds() if x["joined_at"] and x["last"] else 0.0
        out[sid] = {"route": route, "ua": x["ua"].most_common(1)[0][0] if x["ua"] else "-",
                    "joined": x["types"]["conference_joined"] > 0, "join_timeout": x["jt"] > 0,
                    "drops": sum(x["types"][t] for t in DROP_TYPES),
                    "reconnects": x["types"]["connection_reconnecting"],
                    "restored": x["types"]["connection_restored"],
                    "peer_fail": x["types"]["peer_connection_failure"],
                    "seconds": max(dur, 0.0), "users": x["users"]}
    return out


def aggregate(sessions):
    agg = defaultdict(lambda: Counter())
    for v in sessions.values():
        a = agg[v["route"]]
        a["sessions"] += 1
        a["joined"] += v["joined"]
        a["join_timeout"] += v["join_timeout"]
        a["drops"] += v["drops"]
        a["reconnects"] += v["reconnects"]
        a["restored"] += v["restored"]
        a["peer_fail"] += v["peer_fail"]
        a["seconds"] += v["seconds"]
        a["with_drop"] += v["drops"] > 0
    return agg


def switch_stats(since):
    from Cabinet.cdn_handoff_models import CdnSwitchEvent
    qs = CdnSwitchEvent.objects.filter(created_at__gte=since)
    return {"total": qs.count(), "users": qs.values("user_id").distinct().count(),
            "redeemed": qs.exclude(redeemed_at=None).count(),
            "by": sorted((r["reason"], r["via"], r["c"]) for r in qs.values("reason", "via").annotate(c=Count("id")))}


class Command(BaseCommand):
    help = "Сравнение звонков cdn vs direct: сессии, таймауты входа, обрывы/час, автопереходы."

    def add_arguments(self, parser):
        parser.add_argument("--days", type=float, default=7)
        parser.add_argument("--by-ua", action="store_true", help="разбивка по браузеру/ОС")

    def handle(self, *args, **o):
        since = timezone.now() - timedelta(days=o["days"])
        sessions = session_stats(since)
        agg = aggregate(sessions)
        w = self.stdout.write
        w(f"Звонки с {since:%Y-%m-%d %H:%M} UTC ({o['days']:g} дн.), сессий {len(sessions)}")
        w(f"{'route':<8} {'sess':>5} {'joined':>6} {'join_to':>7} {'drop%':>6} {'drops':>5} "
          f"{'reconn':>6} {'restor':>6} {'peerF':>5} {'hours':>7} {'drops/h':>7}")
        for route in ("cdn", "direct", "unknown"):
            a = agg.get(route)
            if not a:
                continue
            h = a["seconds"] / 3600
            pct = 100 * a["with_drop"] / a["sessions"] if a["sessions"] else 0
            w(f"{route:<8} {a['sessions']:>5} {a['joined']:>6} {a['join_timeout']:>7} {pct:>5.0f}% {a['drops']:>5} "
              f"{a['reconnects']:>6} {a['restored']:>6} {a['peer_fail']:>5} {h:>7.1f} "
              f"{(a['drops'] / h if h else 0):>7.2f}")
        if o["by_ua"]:
            ua = defaultdict(Counter)
            for v in sessions.values():
                c = ua[(v["route"], v["ua"])]
                c["n"] += 1
                c["drops"] += v["drops"]
                c["jt"] += v["join_timeout"]
                c["s"] += v["seconds"]
            w("route    ua                         sess  join_to drops drops/h")
            for (r, u), c in sorted(ua.items(), key=lambda kv: (kv[0][0], -kv[1]["n"])):
                h = c["s"] / 3600
                w(f"{r:<8} {u:<26} {c['n']:>4} {c['jt']:>8} {c['drops']:>5} {(c['drops'] / h if h else 0):>7.2f}")
        try:
            sw = switch_stats(since)
            w(f"Автопереходы на cdn: {sw['total']} (пользователей {sw['users']}, токен погашен {sw['redeemed']})")
            for reason, via, c in sw["by"]:
                w(f"  {reason:<13} via={via:<8} {c}")
        except Exception as exc:  # noqa: BLE001  (до миграции 0131)
            w(f"Автопереходы: таблица недоступна ({exc.__class__.__name__})")
