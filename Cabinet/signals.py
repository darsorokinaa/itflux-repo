from django.contrib.auth.models import User
from django.db.models.signals import post_save, pre_save
from django.dispatch import receiver

from Generator.models import Task
from .models import HomeworkSubmission, Profile, ScheduleEvent, Student
from .choices import StudentStatus

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


@receiver(pre_save, sender=Task)
def remember_task_content(sender, instance, **kwargs):
    """Запоминает ответ и текст до сохранения, чтобы разослать правку дальше."""
    instance._itflux_task_before = None
    if kwargs.get("raw") or not instance.pk:
        return
    update_fields = kwargs.get("update_fields")
    if update_fields is not None and not {"answer", "task_template"}.intersection(update_fields):
        return
    instance._itflux_task_before = (
        Task.objects.filter(pk=instance.pk).values("answer", "task_template").first()
    )


@receiver(post_save, sender=Task)
def propagate_task_content_on_save(sender, instance, created, **kwargs):
    if created or kwargs.get("raw"):
        return
    before = getattr(instance, "_itflux_task_before", None)
    instance._itflux_task_before = None
    if not before:
        return
    answer_changed = str(before.get("answer") or "") != str(instance.answer or "")
    text_changed = str(before.get("task_template") or "") != str(instance.task_template or "")
    if not answer_changed and not text_changed:
        return
    from .task_answer_sync import propagate_task_content

    propagate_task_content(instance)


@receiver(post_save, sender=HomeworkSubmission)
def ensure_review_item_for_submission(sender, instance, created, **kwargs):
    # Карточка появляется только после фактической сдачи, не в момент выдачи.
    from .homework_api import _ensure_review_item

    _ensure_review_item(instance)


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
    old_status = _pre_save_statuses.pop(instance.pk, None)
    if instance.status not in PLAN_SYNC_STATUSES:
        return
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
