"""Пересчёт размеров пользовательских файлов по фактическому содержимому storage."""

from django.contrib.auth.models import User
from django.core.management.base import BaseCommand

from Cabinet.storage_usage import calc_usage_bytes, storage_limit_bytes, sync_recorded_sizes


class Command(BaseCommand):
    help = (
        "Пересчитывает size существующих файлов по реальному объёму в storage. "
        "storage_used не хранится отдельно — после команды API считает сумму уникальных файлов."
    )

    def add_arguments(self, parser):
        parser.add_argument("--user-id", type=int, default=None, help="Только этот пользователь")
        parser.add_argument("--dry-run", action="store_true", help="Только показать объём, не писать size")

    def handle(self, *args, **options):
        user = None
        user_id = options.get("user_id")
        if user_id:
            user = User.objects.get(pk=user_id)

        if options.get("dry_run"):
            users = [user] if user is not None else User.objects.filter(cabinet_files__isnull=False).distinct()
            for row in users:
                used = calc_usage_bytes(row)
                limit = storage_limit_bytes(row)
                self.stdout.write(f"user={row.pk} used={used} limit={limit}")
            return

        stats = sync_recorded_sizes(user=user)
        self.stdout.write(
            self.style.SUCCESS(
                "updated files={files} versions={versions} "
                "homework={homework_attachments} boards={board_assets}".format(**stats)
            )
        )
        if user is not None:
            self.stdout.write(f"user={user.pk} used={calc_usage_bytes(user)} limit={storage_limit_bytes(user)}")
