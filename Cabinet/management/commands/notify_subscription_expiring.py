"""Уведомления об истечении подписки платформы (14/7/3/1 день)."""

from django.core.management.base import BaseCommand

from Cabinet.subscription_notifications import notify_subscription_expiring


class Command(BaseCommand):
    help = "Создаёт in-app уведомления учителям о скором окончании подписки"

    def add_arguments(self, parser):
        parser.add_argument(
            "--days",
            type=int,
            nargs="+",
            default=[14, 7, 3, 1],
            help="За сколько дней до окончания уведомлять (можно несколько)",
        )

    def handle(self, *args, **options):
        total = 0
        for days in options["days"]:
            created = notify_subscription_expiring(days_ahead=int(days))
            self.stdout.write(f"days={days}: created={created}")
            total += created
        self.stdout.write(self.style.SUCCESS(f"Total created: {total}"))
