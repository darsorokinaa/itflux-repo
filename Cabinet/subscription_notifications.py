"""Уведомления о подписке платформы (не биллинг учеников)."""

from __future__ import annotations

import logging
from datetime import timedelta

from django.utils import timezone

logger = logging.getLogger(__name__)


def notify_subscription_expiring(*, days_ahead: int = 3) -> int:
    """Создаёт in-app уведомления учителям, у которых истекает подписка."""
    from .choices import NotificationChannel, NotificationStatus
    from .models import Notification, TeacherSubscription

    now = timezone.now()
    until = now + timedelta(days=days_ahead)
    qs = TeacherSubscription.objects.filter(
        status__in=[
            TeacherSubscription.Status.ACTIVE,
            TeacherSubscription.Status.TRIAL,
        ],
        expires_at__gte=now,
        expires_at__lte=until,
    ).select_related("teacher", "plan")

    created = 0
    for sub in qs:
        event_key = f"subscription_expiring:{sub.pk}:{sub.expires_at.date().isoformat()}"
        title = "Подписка скоро закончится"
        message = (
            f"Тариф «{sub.plan.name}» действует до "
            f"{sub.expires_at.strftime('%d.%m.%Y')}. "
            f"Продлите на странице «Подписка и оплата»."
        )
        _, was_created = Notification.objects.get_or_create(
            recipient_user=sub.teacher,
            channel=NotificationChannel.IN_APP,
            event_key=event_key,
            defaults={
                "recipient_teacher": sub.teacher,
                "event_type": "subscription_expiring",
                "title": title,
                "message": message,
                "status": NotificationStatus.PENDING,
                "payload": {
                    "plan_slug": sub.plan.slug,
                    "expires_at": sub.expires_at.isoformat(),
                    "link": "/cabinet/upgrade",
                },
            },
        )
        if was_created:
            created += 1
    return created
