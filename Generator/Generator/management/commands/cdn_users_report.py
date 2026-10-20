"""r90: сводка по пользователям cdn.itflux-academy.ru (логины маскируются)."""
from collections import defaultdict
from datetime import datetime, timedelta, timezone

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError

from Generator import cdn_users


def _parse_since(raw: str) -> datetime:
    raw = (raw or "").strip()
    if raw[-1:] in "hd" and raw[:-1].isdigit():
        n = int(raw[:-1])
        return datetime.now(timezone.utc) - (timedelta(hours=n) if raw[-1] == "h" else timedelta(days=n))
    try:
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError as exc:
        raise CommandError(f"--since: ожидается ISO-время или 24h/7d, получено {raw!r}") from exc
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


class Command(BaseCommand):
    help = "Счётчики заходов через cdn.itflux-academy.ru по пользователям с момента --since (UTC)."

    def add_arguments(self, parser):
        parser.add_argument("--since", default="7d", help="ISO-время (UTC) или 24h / 7d. По умолчанию 7d")
        parser.add_argument("--log", default=None, help="Путь к логу (по умолчанию settings.CDN_USERS_LOG)")

    def handle(self, *args, **opts):
        since = _parse_since(opts["since"])
        path = opts["log"] or cdn_users.log_path()
        stats = defaultdict(lambda: {"n": 0, "role": "-", "last": None, "ips": set(), "ua": "-"})
        try:
            fh = open(path, encoding="utf-8", errors="replace")
        except FileNotFoundError:
            self.stdout.write(f"Лог не найден: {path}")
            return
        with fh:
            for line in fh:
                rec = cdn_users.parse_line(line)
                if not rec or rec["ts"] < since:
                    continue
                s = stats[rec["uid"]]
                s["n"] += 1
                s["role"] = rec["role"]
                s["last"] = rec["ts"]
                s["ips"].add(rec["ip"])
                s["ua"] = rec["ua"]
        users = {u.pk: u for u in get_user_model().objects.filter(pk__in=list(stats))}
        self.stdout.write(f"cdn.itflux-academy.ru с {since:%Y-%m-%d %H:%M} UTC: пользователей {len(stats)}, "
                          f"записей {sum(s['n'] for s in stats.values())}")
        self.stdout.write(f"{'uid':>7}  {'логин':<22} {'роль':<8} {'n':>4}  {'посл. (UTC)':<16} {'IP':>3}  UA")
        for uid, s in sorted(stats.items(), key=lambda kv: (-kv[1]["n"], kv[0])):
            u = users.get(uid)
            login = cdn_users.mask_login((u.email or u.username) if u else "") if u else "(удалён)"
            self.stdout.write(f"{uid:>7}  {login:<22} {s['role']:<8} {s['n']:>4}  "
                              f"{s['last']:%Y-%m-%d %H:%M} {len(s['ips']):>3}  {s['ua']}")
