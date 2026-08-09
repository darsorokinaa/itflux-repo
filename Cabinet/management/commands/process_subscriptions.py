"""Периодическая обработка подписок: reminders, auto-renew, expire→Start."""

from django.core.management.base import BaseCommand

from Cabinet.subscription_lifecycle import run_subscription_maintenance


class Command(BaseCommand):
    help = (
        "Напоминания 7/3/1, автопродление по RebillId, переход истёкших на «Старт»"
    )

    def add_arguments(self, parser):
        parser.add_argument("--no-remind", action="store_true")
        parser.add_argument("--no-renew", action="store_true")
        parser.add_argument("--no-expire", action="store_true")

    def handle(self, *args, **options):
        result = run_subscription_maintenance(
            remind=not options["no_remind"],
            renew=not options["no_renew"],
            expire=not options["no_expire"],
        )
        self.stdout.write(self.style.SUCCESS(str(result)))
