"""Безопасный repair приглашений. По умолчанию --dry-run. Не сливает спорные аккаунты."""

from __future__ import annotations

from django.core.management.base import BaseCommand
from django.utils import timezone

from Cabinet.choices import InvitationStatus
from Cabinet.models import StudentInvitation


class Command(BaseCommand):
    help = (
        "Пометить просроченные pending-приглашения как expired. "
        "Не объединяет аккаунты. python manage.py repair_student_auth [--dry-run|--apply]"
    )

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true", default=True)
        parser.add_argument("--apply", action="store_true", help="Применить однозначные правки")

    def handle(self, *args, **options):
        apply = bool(options.get("apply"))
        dry_run = not apply
        now = timezone.now()
        qs = StudentInvitation.objects.filter(
            status=InvitationStatus.PENDING,
            expires_at__lt=now,
        )
        count = qs.count()
        self.stdout.write(f"Просроченных pending-приглашений: {count}")
        if dry_run:
            self.stdout.write(self.style.WARNING("dry-run: ничего не изменено. Для записи: --apply"))
            return
        updated = qs.update(status=InvitationStatus.EXPIRED)
        self.stdout.write(self.style.SUCCESS(f"Помечено expired: {updated}"))
