from datetime import timedelta

from django.core.management.base import BaseCommand

from Cabinet.payment_reconcile import reconcile


class Command(BaseCommand):
    help = "r101: сверка pending-платежей старше N минут с Т-Банком (GetState). По умолчанию --dry-run."

    def add_arguments(self, parser):
        g = parser.add_mutually_exclusive_group()
        g.add_argument("--dry-run", action="store_true", default=True)
        g.add_argument("--apply", action="store_true")
        parser.add_argument("--min-age-minutes", type=int, default=30)
        parser.add_argument("--limit", type=int, default=None)

    def handle(self, *args, **o):
        res = reconcile(dry_run=not o["apply"], min_age=timedelta(minutes=o["min_age_minutes"]), limit=o["limit"])
        mode = "DRY-RUN (ничего не записано)" if res["dry_run"] else "APPLY"
        self.stdout.write(f"{mode}: {res['summary']}")
        for r in res["rows"]:
            self.stdout.write(f"  #{r['payment_id']} {r['created_at'][:16]} {r['bank_status'] or '-'} → {r['action']}")
