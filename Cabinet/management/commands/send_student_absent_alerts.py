from django.core.management.base import BaseCommand

from Cabinet.teacher_notifications import send_student_absent_alerts


class Command(BaseCommand):
    help = "Notify teachers when students have not joined a LIVE meeting"

    def add_arguments(self, parser):
        parser.add_argument("--after-minutes", type=int, default=5)

    def handle(self, *args, **options):
        sent = send_student_absent_alerts(after_minutes=options["after_minutes"])
        self.stdout.write(self.style.SUCCESS(f"Student-absent alerts sent: {sent}"))
