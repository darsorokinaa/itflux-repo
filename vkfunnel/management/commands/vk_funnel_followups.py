from django.core.management.base import BaseCommand

from vkfunnel import funnel


class Command(BaseCommand):
    help = "VK-воронка: дожимы через 1 и 3–4 дня (только при VK_FUNNEL_ENABLED=1)"

    def add_arguments(self, parser):
        parser.add_argument("--limit", type=int, default=200)
        parser.add_argument("--dry-run", action="store_true")

    def handle(self, *a, **o):
        if not funnel.enabled() and not o["dry_run"]:
            self.stdout.write("VK_FUNNEL_ENABLED=0 — пропуск")
            return
        self.stdout.write(str(funnel.run_followups(limit=o["limit"], dry_run=o["dry_run"])))
