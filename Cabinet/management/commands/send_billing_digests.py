"""Ежедневные/еженедельные финансовые сводки учителям через Telegram."""

from django.contrib.auth.models import User
from django.core.management.base import BaseCommand
from django.utils import timezone

from Cabinet.billing_notifications import send_teacher_billing_digest
from Cabinet.billing_service import dashboard_summary
from Cabinet.models import NotificationPreference, Profile


class Command(BaseCommand):
    help = "Отправляет финансовые сводки учителям (существующий Telegram-канал)"

    def add_arguments(self, parser):
        parser.add_argument("--weekly", action="store_true")
        parser.add_argument("--force", action="store_true")

    def handle(self, *args, **options):
        weekly = options["weekly"]
        force = options["force"]
        now = timezone.localtime()
        sent = 0
        teachers = User.objects.filter(profile__role=Profile.Role.TEACHER)
        for teacher in teachers:
            prefs = NotificationPreference.objects.filter(user=teacher).first()
            if not prefs:
                continue
            if not force:
                if weekly and not prefs.notify_billing_weekly_digest:
                    continue
                if not weekly and not prefs.notify_billing_daily_digest:
                    continue
                if prefs.digest_hour is not None and prefs.digest_hour != now.hour:
                    continue
            summary = dashboard_summary(teacher)
            if send_teacher_billing_digest(teacher, summary, weekly=weekly):
                sent += 1
        self.stdout.write(self.style.SUCCESS(f"Sent {sent} billing digests"))
