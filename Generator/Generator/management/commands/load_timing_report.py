"""r105: сводка замеров загрузки по хостам (cdn / direct) и дням."""
from collections import defaultdict

from django.core.management.base import BaseCommand

from Generator import load_timing
from Generator.management.commands.cdn_users_report import _parse_since


def pct(values, p):
    vals = sorted(v for v in values if v is not None)
    if not vals:
        return None
    k = (len(vals) - 1) * p / 100.0
    lo = int(k)
    hi = min(lo + 1, len(vals) - 1)
    return round(vals[lo] + (vals[hi] - vals[lo]) * (k - lo))


def _f(v):
    return "-" if v is None else str(v)


class Command(BaseCommand):
    help = "Замеры загрузки страницы: по хосту и дню — n, медиана/p90 TTFB и load, ready, доля сбоев."

    def add_arguments(self, parser):
        parser.add_argument("--since", default="7d", help="ISO-время (UTC) или 24h / 7d. По умолчанию 7d")
        parser.add_argument("--log", default=None, help="Путь к логу (по умолчанию settings.LOAD_TIMING_LOG)")
        parser.add_argument("--by-browser", action="store_true", help="Дополнительно разбивка по браузеру/ОС")

    def handle(self, *args, **opts):
        since = _parse_since(opts["since"])
        path = opts["log"] or load_timing.log_path()
        try:
            fh = open(path, encoding="utf-8", errors="replace")
        except FileNotFoundError:
            self.stdout.write(f"Лог не найден: {path}")
            return
        groups = defaultdict(list)
        with fh:
            for line in fh:
                rec = load_timing.parse_line(line)
                if not rec or rec["ts"] < since:
                    continue
                groups[(rec["host"], f"{rec['ts']:%Y-%m-%d}")].append(rec)
                groups[(rec["host"], "ВСЕГО")].append(rec)
                if opts["by_browser"]:
                    groups[(rec["host"], "ua:" + rec["ua"])].append(rec)
        self.stdout.write(f"Замеры загрузки с {since:%Y-%m-%d %H:%M} UTC")
        hdr = (f"{'host':<7} {'день':<22} {'n':>5} {'ttfb p50':>8} {'p90':>6} {'load p50':>8} {'p90':>6} "
               f"{'ready p50':>9} {'p90':>6} {'fail%':>6} {'switch':>6}")
        self.stdout.write(hdr)
        for (host, day), recs in sorted(groups.items(), key=lambda kv: (kv[0][0], kv[0][1].startswith("ua:"),
                                                                         kv[0][1] == "ВСЕГО", kv[0][1])):
            n = len(recs)
            fails = sum(1 for r in recs if r["ev"] in ("boot_fail", "auto_switch"))
            sw = sum(1 for r in recs if r["ev"] == "auto_switch")
            t = [r["ttfb"] for r in recs]
            ld = [r["load"] for r in recs]
            rd = [r["ready"] for r in recs]
            self.stdout.write(
                f"{host:<7} {day[:22]:<22} {n:>5} {_f(pct(t, 50)):>8} {_f(pct(t, 90)):>6} {_f(pct(ld, 50)):>8} "
                f"{_f(pct(ld, 90)):>6} {_f(pct(rd, 50)):>9} {_f(pct(rd, 90)):>6} {100.0 * fails / n:>5.1f}% {sw:>6}")
