from django.core.management.base import BaseCommand

from Cabinet.onboarding_notifications import send_onboarding_nudges


class Command(BaseCommand):
    help = (
        "Send in-app onboarding nudges to recently registered teachers "
        "who have not finished activation. Idempotent via Notification.event_key."
    )

    def handle(self, *args, **options):
        stats = send_onboarding_nudges()
        self.stdout.write(
            self.style.SUCCESS(
                f"Onboarding nudges: sent={stats['sent']} skipped={stats['skipped']}"
            )
        )
