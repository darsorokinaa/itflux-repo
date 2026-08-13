"""Уведомления для ученика: проверка работ и биллинг (учительские гейты)."""

from __future__ import annotations

import logging

from django.contrib.auth.models import User

from .models import HomeworkSubmission, ReviewItem, Student
from .notification_catalog import NotificationEventType
from .notification_dispatch import NotificationDispatcher, get_or_create_preferences

logger = logging.getLogger("cabinet.notifications")


def notify_student_homework_reviewed(
    *,
    review_item: ReviewItem,
    submission: HomeworkSubmission | None = None,
    checked: bool = True,
    actor: User | None = None,
) -> bool:
    """Ученику: работа проверена или возвращена (prefs.notify_review)."""
    student = review_item.student
    if student is None or not student.user_id:
        return False
    user = student.user
    submission = submission or (
        HomeworkSubmission.objects.filter(pk=review_item.source_id).select_related("homework").first()
        if review_item.source_type == "homework"
        else None
    )
    homework = getattr(submission, "homework", None) if submission else None
    hw_title = (homework.title if homework else "") or review_item.title or "Домашнее задание"
    assignment_id = homework.id if homework else None
    url = (
        f"/cabinet/student/assignments/{assignment_id}?focus=results"
        if assignment_id
        else "/cabinet/student/assignments"
    )

    if checked:
        event_type = NotificationEventType.HOMEWORK_CHECKED
        title = "Работа проверена"
        score = getattr(submission, "score", None) if submission else None
        if score is not None:
            message = f"«{hw_title}» · оценка {score}"
        else:
            message = f"Учитель проверил работу «{hw_title}»."
        comment = (review_item.teacher_comment or "").strip()
        if comment:
            message = f"{message}\nКомментарий: {comment[:160]}"
    else:
        event_type = NotificationEventType.HOMEWORK_RETURNED
        title = "Работа возвращена на доработку"
        message = f"Учитель вернул «{hw_title}» на исправление."
        comment = (review_item.teacher_comment or "").strip()
        if comment:
            message = f"{message}\n{comment[:160]}"

    dedup = f"{event_type}:{review_item.pk}:{user.pk}"
    result = NotificationDispatcher.notify(
        user,
        event_type,
        title=title,
        message=message,
        actor=actor or review_item.teacher,
        related_object=review_item,
        payload={
            "type": event_type,
            "event_type": event_type,
            "review_id": review_item.pk,
            "homework_id": assignment_id,
            "submission_id": submission.pk if submission else None,
            "url": url,
        },
        url=url,
        dedup_key=dedup,
        recipient_student=student,
        skip_actor=True,
        create_telegram=True,
        push_tag=f"hw-review-result-{review_item.pk}",
    )
    return not result.skipped


def _teacher_allows_student_billing(teacher: User, field: str) -> bool:
    prefs = get_or_create_preferences(teacher)
    return bool(getattr(prefs, field, False))


def _account_allows_student(student: Student) -> bool:
    try:
        from .billing_models import BillingAccount

        account = BillingAccount.objects.filter(student=student).first()
        if account is None:
            return False
        return bool(account.student_billing_notifications)
    except Exception:
        return False


def notify_student_payment_recorded(*, teacher: User, student: Student, amount=None, currency: str = "RUB") -> bool:
    if not student.user_id:
        return False
    if not _account_allows_student(student):
        return False
    if not _teacher_allows_student_billing(teacher, "notify_student_payment_recorded"):
        return False
    privacy = get_or_create_preferences(teacher).push_privacy_mode
    title = "Оплата зафиксирована"
    if privacy or amount is None:
        message = "Учитель записал вашу оплату."
    else:
        message = f"Зафиксирована оплата: {amount} {currency}."
    result = NotificationDispatcher.notify(
        student.user,
        NotificationEventType.STUDENT_PAYMENT_RECORDED,
        title=title,
        message=message,
        actor=teacher,
        payload={
            "type": NotificationEventType.STUDENT_PAYMENT_RECORDED,
            "event_type": NotificationEventType.STUDENT_PAYMENT_RECORDED,
            "student_id": student.pk,
            "url": "/cabinet/student",
        },
        url="/cabinet/student",
        dedup_key=f"student_payment_recorded:{student.pk}:{teacher.pk}:{timezone_bucket()}",
        recipient_student=student,
        skip_actor=True,
        push_tag=f"stu-pay-{student.pk}",
    )
    return not result.skipped


def notify_student_package_low(*, teacher: User, student: Student, remaining, unit_label: str = "занятий") -> bool:
    if not student.user_id:
        return False
    if not _account_allows_student(student):
        return False
    if not _teacher_allows_student_billing(teacher, "notify_student_package_low"):
        return False
    title = "Заканчивается абонемент"
    message = f"Осталось мало {unit_label}: {remaining}."
    result = NotificationDispatcher.notify(
        student.user,
        NotificationEventType.STUDENT_PACKAGE_LOW,
        title=title,
        message=message,
        actor=teacher,
        payload={
            "type": NotificationEventType.STUDENT_PACKAGE_LOW,
            "event_type": NotificationEventType.STUDENT_PACKAGE_LOW,
            "student_id": student.pk,
            "url": "/cabinet/student",
        },
        url="/cabinet/student",
        dedup_key=f"student_package_low:{student.pk}:{remaining}",
        recipient_student=student,
        skip_actor=True,
        push_tag=f"stu-pkg-low-{student.pk}",
    )
    return not result.skipped


def notify_student_package_ended(*, teacher: User, student: Student) -> bool:
    if not student.user_id:
        return False
    if not _account_allows_student(student):
        return False
    if not _teacher_allows_student_billing(teacher, "notify_student_package_ended"):
        return False
    result = NotificationDispatcher.notify(
        student.user,
        NotificationEventType.STUDENT_PACKAGE_ENDED,
        title="Абонемент закончился",
        message="Занятия в текущем абонементе закончились.",
        actor=teacher,
        payload={
            "type": NotificationEventType.STUDENT_PACKAGE_ENDED,
            "event_type": NotificationEventType.STUDENT_PACKAGE_ENDED,
            "student_id": student.pk,
            "url": "/cabinet/student",
        },
        url="/cabinet/student",
        dedup_key=f"student_package_ended:{student.pk}:{timezone_bucket(day=True)}",
        recipient_student=student,
        skip_actor=True,
        push_tag=f"stu-pkg-end-{student.pk}",
    )
    return not result.skipped


def notify_student_unpaid_lesson(*, teacher: User, student: Student, when_label: str = "") -> bool:
    if not student.user_id:
        return False
    if not _account_allows_student(student):
        return False
    if not _teacher_allows_student_billing(teacher, "notify_student_unpaid_lesson"):
        return False
    message = "Есть неоплаченное занятие."
    if when_label:
        message = f"{message} {when_label}"
    result = NotificationDispatcher.notify(
        student.user,
        NotificationEventType.STUDENT_UNPAID_LESSON,
        title="Неоплаченный урок",
        message=message,
        actor=teacher,
        payload={
            "type": NotificationEventType.STUDENT_UNPAID_LESSON,
            "event_type": NotificationEventType.STUDENT_UNPAID_LESSON,
            "student_id": student.pk,
            "url": "/cabinet/student",
        },
        url="/cabinet/student",
        dedup_key=f"student_unpaid:{student.pk}:{when_label or timezone_bucket(day=True)}",
        recipient_student=student,
        skip_actor=True,
        push_tag=f"stu-unpaid-{student.pk}",
    )
    return not result.skipped


def timezone_bucket(*, day: bool = False) -> str:
    from django.utils import timezone

    now = timezone.localtime()
    if day:
        return now.strftime("%Y%m%d")
    return now.strftime("%Y%m%d%H%M")
