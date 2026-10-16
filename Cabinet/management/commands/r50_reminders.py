"""r50: напоминания об окончании подписки — dry-run CSV, тест на адрес владельца, ручной запуск."""

import csv

from django.core.management.base import BaseCommand, CommandError


class Command(BaseCommand):
    help = "Напоминания r50: --dry-run --csv PATH | --send-test itflux.academy@yandex.ru | --run (только при включённом флаге)"

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true")
        parser.add_argument("--csv", default="")
        parser.add_argument("--send-test", default="")
        parser.add_argument("--run", action="store_true")

    def handle(self, *args, **o):
        from Cabinet import r50_tariffs as R

        if o["send_test"]:
            subjects = R.send_test_reminders(o["send_test"])
            self.stdout.write("sent test: " + "; ".join(subjects))
            return
        if o["run"]:
            if not R.reminders_enabled():
                raise CommandError("SUBSCRIPTION_REMINDERS_R50_ENABLED выключен — реальная отправка запрещена.")
            self.stdout.write(str(R.process_r50_reminders()))
            return
        rows = R.plan_reminders()
        if o["csv"]:
            with open(o["csv"], "w", newline="", encoding="utf-8-sig") as fh:
                w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()) if rows else ["empty"])
                w.writeheader()
                w.writerows(rows)
        self.stdout.write(f"rows={len(rows)} enabled={R.reminders_enabled()}")
