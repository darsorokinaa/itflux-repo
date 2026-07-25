from django.contrib.auth.models import User
from django.db.models.signals import post_save, pre_save
from django.dispatch import receiver

from .models import HomeworkSubmission, Profile, ReviewItem, ScheduleEvent, Student
from .choices import StudentStatus, SubmissionStatus

# Статус ученика до save: {student_pk: old_status}
_pre_save_student_statuses: dict[int, str] = {}


@receiver(post_save, sender=User)
def ensure_user_profile(sender, instance, created, **kwargs):
    if created:
        Profile.objects.create(user=instance)
    elif hasattr(instance, "profile"):
        instance.profile.save()


@receiver(pre_save, sender=Student)
def capture_student_status_before_save(sender, instance, **kwargs):
    if not instance.pk:
        return
    old = Student.objects.filter(pk=instance.pk).values_list("status", flat=True).first()
    if old is not None:
        _pre_save_student_statuses[instance.pk] = old


@receiver(post_save, sender=Student)
def sync_billing_account_on_student_status(sender, instance, created, **kwargs):
    """Архив скрывает ученика из оплат; восстановление — снова показывает."""
    old_status = _pre_save_student_statuses.pop(instance.pk, None)
    if not created and old_status == instance.status:
        return

    from .billing_models import BillingAccount

    if instance.status == StudentStatus.ARCHIVED:
        BillingAccount.objects.filter(student=instance, teacher_id=instance.teacher_id).update(
            is_active=False
        )
    elif old_status == StudentStatus.ARCHIVED:
        BillingAccount.objects.filter(student=instance, teacher_id=instance.teacher_id).update(
            is_active=True
        )


@receiver(post_save, sender=HomeworkSubmission)
def ensure_review_item_for_submission(sender, instance, created, **kwargs):
    # Только после реальной сдачи. Выдача через «Задать ДЗ» ставит в очередь отдельно.
    if instance.status != SubmissionStatus.SUBMITTED:
        return
    if not instance.submitted_at:
        return
    homework = instance.homework
    from .homework_api import is_live_meeting_homework

    if is_live_meeting_homework(homework):
        return
    ReviewItem.objects.get_or_create(
        teacher=homework.teacher,
        source_type="homework",
        source_id=instance.pk,
        defaults={
            "student": instance.student,
            "group": homework.group,
            "title": f"{homework.title} — {instance.student.full_name}",
            "status": "pending",
            "priority": "normal",
        },
    )


PLAN_SYNC_STATUSES = {"done", "completed"}

# Хранит статус ДО сохранения: {event_pk: old_status}
_pre_save_statuses: dict[int, str] = {}


@receiver(pre_save, sender=ScheduleEvent)
def capture_event_status_before_save(sender, instance, **kwargs):
    """Запоминаем старый статус перед сохранением."""
    if instance.pk:
        _pre_save_statuses[instance.pk] = getattr(instance, "_pre_save_status", None)
        # Получаем актуальный статус из БД только один раз через update_fields
        try:
            old = ScheduleEvent.objects.filter(pk=instance.pk).values_list("status", flat=True).first()
            _pre_save_statuses[instance.pk] = old
        except Exception:
            pass


@receiver(post_save, sender=ScheduleEvent)
def sync_plan_on_event_complete(sender, instance, created, **kwargs):
    """
    Когда событие переходит в done/completed — продвигаем план вперёд.
    Срабатывает только при реальной смене статуса на завершённый.
    """
    if instance.status not in PLAN_SYNC_STATUSES:
        return

    old_status = _pre_save_statuses.pop(instance.pk, None)
    if old_status == instance.status:
        return  # статус не изменился, повторный save — пропускаем

    try:
        from .student_release import StudentReleaseService
        StudentReleaseService.release_for_event(instance)
    except Exception:
        import logging
        logging.getLogger(__name__).exception(
            "Ошибка выдачи материалов ученику для события #%s", instance.pk
        )

    try:
        from .plan_sync import PlanSyncService
        PlanSyncService.on_event_completed(instance)
    except Exception:
        import logging
        logging.getLogger(__name__).exception(
            "Ошибка синхронизации плана для события #%s", instance.pk
        )
