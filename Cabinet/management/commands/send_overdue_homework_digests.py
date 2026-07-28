from django.core.management.base import BaseCommand

from Cabinet.teacher_notifications import send_overdue_homework_digests


class Command(BaseCommand):
    help = "Send overdue homework digests (daily and immediate modes)"

    def add_arguments(self, parser):
        parser.add_argument(
            "--mode",
            choices=["daily", "immediate", "all"],
            default="all",
        )

    def handle(self, *args, **options):
        mode = options["mode"]
        total = 0
        if mode in ("daily", "all"):
            total += send_overdue_homework_digests(mode_filter="daily")
            total += send_overdue_homework_digests(mode_filter="in_app_only")
        if mode in ("immediate", "all"):
            total += send_overdue_homework_digests(mode_filter="immediate")
        self.stdout.write(self.style.SUCCESS(f"Overdue digests sent: {total}"))
