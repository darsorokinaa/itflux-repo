from django.core.management.base import BaseCommand

from Cabinet.teacher_notifications import send_homework_review_digests


class Command(BaseCommand):
    help = "Send teacher homework-review push digests (15m / 60m modes)"

    def handle(self, *args, **options):
        n15 = send_homework_review_digests(window_minutes=15)
        n60 = send_homework_review_digests(window_minutes=60)
        self.stdout.write(self.style.SUCCESS(
            f"Homework review digests: 15m={n15}, 60m={n60}"
        ))
