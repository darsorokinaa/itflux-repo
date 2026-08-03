"""Диагностика системы уведомлений."""

from __future__ import annotations

from collections import Counter
from pathlib import Path

from django.conf import settings
from django.contrib.auth.models import User
from django.core.management.base import BaseCommand, CommandError
from django.db.models import Count, Q

from Cabinet.models import (
    Notification,
    NotificationPreference,
    PushDeliveryLog,
    PushSubscription,
)
from Cabinet.notification_catalog import (
    PREFERENCE_EVENT_MAP,
    UI_PREFERENCE_FIELDS,
    iter_catalog,
    orphan_ui_preference_fields,
)
from Cabinet.notification_dispatch import (
    NotificationPreferenceService,
    get_or_create_preferences,
    user_role,
)
from Cabinet.webpush import vapid_public_key, webpush_configured


# Известные точки вызова (для сопоставления с каталогом)
CODE_EVENT_HANDLERS = {
    "lesson_created": "Cabinet/notifications.py / schedule_service",
    "lesson_moved": "Cabinet/notifications.py / schedule_service",
    "lesson_cancelled": "Cabinet/notifications.py / schedule_service",
    "lesson_updated": "Cabinet/notifications.py / schedule_service",
    "lesson_participants": "Cabinet/notifications.py / schedule_service",
    "lesson_reminder": "send_lesson_reminders",
    "daily_schedule": "send_daily_schedule_digests",
    "homework_assigned": "homework_from_review",
    "homework_updated": "homework_api",
    "homework_edited": "homework_edit",
    "homework_submitted": "teacher_notifications",
    "homework_resubmitted": "teacher_notifications",
    "homework_checked": "student_notifications / ReviewViewSet.check",
    "homework_returned": "student_notifications / ReviewViewSet.return_work",
    "homework_review_digest": "send_homework_review_digests",
    "overdue_homework_digest": "send_overdue_homework_digests",
    "auto_check_attention": "teacher_notifications",
    "new_student": "invitations",
    "student_message": "teacher_notifications",
    "student_entered_room": "teacher_notifications",
    "student_absent": "send_student_absent_alerts",
    "journal_results": "journal_notifications",
    "journal_comment": "journal_notifications / journal_service.update_student_record",
    "journal_recommendation": "journal_notifications / journal_service.update_student_record",
    "journal_daily_digest": "send_daily_schedule_digests / journal_notifications",
    "billing_payment": "billing_notifications",
    "billing_package_low": "teacher_notifications",
    "billing_unpaid_lesson": "teacher_notifications",
    "billing_digest": "send_billing_digests",
    "student_payment_recorded": "student_notifications",
    "student_package_low": "student_notifications",
    "student_package_ended": "student_notifications",
    "student_unpaid_lesson": "student_notifications",
    "student_payment_due": "billing reminder (prefs gate)",
    "billing_reminder": "billing_notifications",
    "system_announcement": "NotificationDispatcher (prefs.notify_system)",
    "push_test": "push_api.PushTestView",
}


class Command(BaseCommand):
    help = "Audit notification types, preferences, push subscriptions and delivery"

    def add_arguments(self, parser):
        parser.add_argument("--user-id", type=int, default=None)

    def handle(self, *args, **options):
        user_id = options.get("user_id")
        if user_id:
            self._audit_user(user_id)
            return
        self._audit_global()

    def _audit_global(self):
        catalog = list(iter_catalog())
        self.stdout.write(self.style.NOTICE("=== Notification catalog ==="))
        self.stdout.write(f"Catalog event types: {len(catalog)}")
        self.stdout.write(f"UI preference fields: {len(UI_PREFERENCE_FIELDS)}")
        orphans = orphan_ui_preference_fields()
        self.stdout.write(f"UI fields without catalog mapping: {orphans or 'none'}")

        self.stdout.write(self.style.NOTICE("\n=== Settings ↔ handlers ==="))
        for field in UI_PREFERENCE_FIELDS:
            events = PREFERENCE_EVENT_MAP.get(field, ())
            handlers = [CODE_EVENT_HANDLERS.get(code, "?") for code in events] if events else ["(meta/mode)"]
            self.stdout.write(f"  {field}: events={list(events) or '-'} handlers={handlers}")

        unused = [d.code for d in catalog if d.code not in CODE_EVENT_HANDLERS]
        self.stdout.write(f"\nCatalog types without known handlers: {unused or 'none'}")

        self.stdout.write(self.style.NOTICE("\n=== Stored notifications by type ==="))
        by_type = (
            Notification.objects.exclude(event_type="")
            .values("event_type")
            .annotate(c=Count("id"))
            .order_by("-c")[:30]
        )
        if not by_type:
            # fallback to payload type for legacy rows
            payload_types = Notification.objects.filter(channel="in_app").values_list(
                "payload", flat=True
            )[:5000]
            counter = Counter()
            for payload in payload_types:
                if isinstance(payload, dict):
                    counter[payload.get("type") or payload.get("event_type") or "(empty)"] += 1
            for key, count in counter.most_common(20):
                self.stdout.write(f"  {key}: {count}")
        else:
            for row in by_type:
                self.stdout.write(f"  {row['event_type']}: {row['c']}")

        total_in_app = Notification.objects.filter(channel="in_app").count()
        unread = Notification.objects.filter(channel="in_app", is_read=False).count()
        self.stdout.write(f"\nIn-app total: {total_in_app}, unread: {unread}")

        self.stdout.write(self.style.NOTICE("\n=== Web Push ==="))
        active = PushSubscription.objects.filter(is_active=True).count()
        inactive = PushSubscription.objects.filter(is_active=False).count()
        multi = (
            PushSubscription.objects.filter(is_active=True)
            .values("user_id")
            .annotate(c=Count("id"))
            .filter(c__gt=1)
            .count()
        )
        self.stdout.write(f"Active subscriptions: {active}")
        self.stdout.write(f"Inactive/stale subscriptions: {inactive}")
        self.stdout.write(f"Users with multiple active devices: {multi}")

        gone = PushDeliveryLog.objects.filter(status=PushDeliveryLog.DeliveryStatus.GONE).count()
        failed = PushDeliveryLog.objects.filter(status=PushDeliveryLog.DeliveryStatus.FAILED).count()
        sent = PushDeliveryLog.objects.filter(status=PushDeliveryLog.DeliveryStatus.SENT).count()
        self.stdout.write(f"Delivery logs — sent: {sent}, failed: {failed}, gone: {gone}")

        configured = webpush_configured()
        public = ""
        if configured:
            try:
                public = vapid_public_key()
                public = f"{public[:8]}…{public[-4:]}" if public else "(empty)"
            except Exception:
                public = "(error deriving public key)"
        self.stdout.write(f"VAPID configured: {configured}")
        self.stdout.write(f"VAPID public (masked): {public or 'n/a'}")
        self.stdout.write(
            f"VAPID private present: {bool((getattr(settings, 'VAPID_PRIVATE_KEY', '') or '').strip())}"
        )

        sw_path = Path(settings.BASE_DIR).parent / "frontend" / "public" / "sw.js"
        if not sw_path.exists():
            sw_path = Path(settings.BASE_DIR) / "frontend" / "public" / "sw.js"
        # Also check common project layout
        candidates = [
            Path("/Users/darsorokina/Projects/itflux/frontend/public/sw.js"),
            Path(settings.BASE_DIR) / ".." / "frontend" / "public" / "sw.js",
            Path(settings.BASE_DIR) / "static" / "sw.js",
        ]
        sw_ok = any(p.resolve().exists() for p in candidates if p)
        self.stdout.write(f"Service worker file present: {sw_ok}")

        self.stdout.write(self.style.NOTICE("\n=== Reminder / digest commands ==="))
        for name in (
            "send_lesson_reminders",
            "send_daily_schedule_digests",
            "send_homework_review_digests",
            "send_overdue_homework_digests",
            "send_student_absent_alerts",
            "send_billing_digests",
        ):
            self.stdout.write(f"  management command: {name}")

        prefs_count = NotificationPreference.objects.count()
        self.stdout.write(f"\nUsers with NotificationPreference rows: {prefs_count}")
        self.stdout.write(self.style.SUCCESS("\nAudit complete."))

    def _audit_user(self, user_id: int):
        try:
            user = User.objects.get(pk=user_id)
        except User.DoesNotExist as exc:
            raise CommandError(f"User {user_id} not found") from exc

        prefs = get_or_create_preferences(user)
        role = user_role(user)
        self.stdout.write(self.style.NOTICE(f"=== User {user_id} ({user.username}) ==="))
        self.stdout.write(f"Role: {role}")
        self.stdout.write(f"in_app_enabled: {prefs.in_app_enabled}")
        self.stdout.write(f"push_enabled: {prefs.push_enabled}")
        self.stdout.write(f"telegram_connected: {prefs.telegram_connected}")

        self.stdout.write(self.style.NOTICE("\nPreference toggles:"))
        for field in UI_PREFERENCE_FIELDS:
            if hasattr(prefs, field):
                self.stdout.write(f"  {field} = {getattr(prefs, field)}")

        self.stdout.write(self.style.NOTICE("\nEvent enablement sample:"))
        for defn in list(iter_catalog())[:12]:
            enabled, reason = NotificationPreferenceService.is_event_enabled(
                user, defn.code, prefs=prefs, definition=defn
            )
            self.stdout.write(f"  {defn.code}: enabled={enabled} ({reason})")

        devices = PushSubscription.objects.filter(user=user).order_by("-updated_at")[:10]
        self.stdout.write(self.style.NOTICE(f"\nDevices ({devices.count()} shown):"))
        for d in devices:
            self.stdout.write(
                f"  id={d.pk} active={d.is_active} label={d.device_label!r} "
                f"endpoint=…{d.endpoint[-24:]}"
            )

        notes = Notification.objects.filter(
            recipient_user=user, channel="in_app"
        ).order_by("-created_at")[:15]
        self.stdout.write(self.style.NOTICE("\nRecent in-app notifications:"))
        for n in notes:
            self.stdout.write(
                f"  [{n.created_at:%Y-%m-%d %H:%M}] type={n.event_type or n.payload.get('type')} "
                f"read={n.is_read} key={n.event_key or '-'} title={n.title[:60]}"
            )

        deliveries = PushDeliveryLog.objects.filter(user=user).order_by("-created_at")[:15]
        self.stdout.write(self.style.NOTICE("\nRecent push delivery attempts:"))
        for d in deliveries:
            self.stdout.write(
                f"  [{d.created_at:%Y-%m-%d %H:%M}] {d.event_type} status={d.status} "
                f"http={d.http_status} err={d.error_message[:80]}"
            )

        self.stdout.write(self.style.SUCCESS("\nUser audit complete."))
