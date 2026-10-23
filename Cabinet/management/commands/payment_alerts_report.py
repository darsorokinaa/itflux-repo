from django.core.management.base import BaseCommand

from Cabinet.payment_alerts import counters


class Command(BaseCommand):
    help = "r101: счётчики алертов по оплатам (webhook не 200, CONFIRMED без webhook, ошибки Init)."

    def add_arguments(self, parser):
        parser.add_argument("--days", type=int, default=7)

    def handle(self, *args, **opts):
        data = counters(opts["days"])
        if not data:
            self.stdout.write("Алертов нет.")
        for day in sorted(data, reverse=True):
            self.stdout.write(day + ": " + ", ".join(f"{k}={v}" for k, v in sorted(data[day].items())))
