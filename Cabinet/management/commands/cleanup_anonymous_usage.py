"""
python manage.py cleanup_anonymous_usage
python manage.py cleanup_anonymous_usage --days 90
"""

from django.core.management.base import BaseCommand

from Cabinet.subscription_access import cleanup_stale_anonymous_usage


class Command(BaseCommand):
    help = "Удаляет устаревшие AnonymousUsage без привязки к пользователю"

    def add_arguments(self, parser):
        parser.add_argument(
            "--days",
            type=int,
            default=180,
            help="Удалить записи старше N дней (по умолчанию 180)",
        )

    def handle(self, *args, **options):
        deleted = cleanup_stale_anonymous_usage(days=options["days"])
        self.stdout.write(self.style.SUCCESS(f"Удалено записей: {deleted}"))
