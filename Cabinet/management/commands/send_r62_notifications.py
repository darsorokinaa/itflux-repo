"""r62: разовые уведомления в кабинете (Премиум → Старт; старый Профи). Только in-app, без e-mail."""

import csv
import sys

from django.core.management.base import BaseCommand

from Cabinet import r62_notifications as r62


class Command(BaseCommand):
    help = "r62: уведомления в кабинете (N1 — «Премиум», N2 — старый «Профи»), 09–21 МСК, один раз на человека"

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true")
        parser.add_argument("--only", choices=["n1", "n2"], action="append")
        parser.add_argument("--csv", default="")

    def handle(self, *args, **opts):
        only = tuple(opts["only"] or ("n1", "n2"))
        res = r62.run(dry_run=opts["dry_run"], only=only)
        self.stdout.write(f"r62 now={res['now_msk']} window={res['in_window']} dry_run={res['dry_run']} stats={res['stats']}")
        if opts["csv"]:
            out = sys.stdout if opts["csv"] == "-" else open(opts["csv"], "w", newline="", encoding="utf-8")
            w = csv.writer(out)
            w.writerow(["user_id", "notification", "sub_id", "end_date", "consent", "status", "sent_at", "scheduled_for"])
            for row in res["rows"]:
                log = row["log"]
                sent_at = ""
                if log is not None:
                    sent_at = r62.msk(log.created_at).isoformat(timespec="minutes")
                elif row["result"] == "sent":
                    sent_at = res["now_msk"]
                sched = "" if sent_at else row["due_at"].isoformat(timespec="minutes")
                w.writerow([row["user_id"], row["which"].upper(), row["sub_id"], row["end_date"],
                            "yes" if row["consent"] else "no", row["result"], sent_at, sched])
            if out is not sys.stdout:
                out.close()
