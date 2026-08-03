"""Ежедневные/еженедельные финансовые сводки учителям через Telegram."""

from django.contrib.auth.models import User
from django.core.management.base import BaseCommand

from Cabinet.billing_notifications import send_teacher_billing_digest
from Cabinet.billing_service import dashboard_summary
from Cabinet.models import NotificationPreference, Profile
from Cabinet.notification_time import user_local_now


class Command(BaseCommand):
    help = "Отправляет финансовые сводки учителям (существующий Telegram-канал)"

    def add_arguments(self, parser):
        parser.add_argument("--weekly", action="store_true")
        parser.add_argument("--force", action="store_true")

    def handle(self, *args, **options):
        weekly = options["weekly"]
        force = options["force"]
        sent = 0
        teachers = User.objects.filter(profile__role=Profile.Role.TEACHER).select_related("profile")
        for teacher in teachers:
            prefs = NotificationPreference.objects.filter(user=teacher).first()
            if not prefs:
                continue
            if not force:
                if weekly and not prefs.notify_billing_weekly_digest:
                    continue
                if not weekly and not prefs.notify_billing_daily_digest:
                    continue
                local_now = user_local_now(teacher)
                if weekly and local_now.weekday() != 0:  # понедельник
                    continue
                if prefs.digest_hour is not None and prefs.digest_hour != local_now.hour:
                    continue
            summary = dashboard_summary(teacher)
            if send_teacher_billing_digest(teacher, summary, weekly=weekly):
                sent += 1
        self.stdout.write(self.style.SUCCESS(f"Sent {sent} billing digests"))
