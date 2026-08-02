"""
Единый каталог типов уведомлений.

Системный код, поле настроек, роли, каналы и шаблоны живут здесь.
Эмиттеры и UI не должны дублировать эти строки произвольно.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Iterable


class NotificationEventType:
    """Стабильные системные коды (совместимы с payload.type в БД)."""

    # Schedule
    LESSON_CREATED = "lesson_created"
    LESSON_MOVED = "lesson_moved"
    LESSON_CANCELLED = "lesson_cancelled"
    LESSON_UPDATED = "lesson_updated"
    LESSON_PARTICIPANTS = "lesson_participants"
    LESSON_REMINDER = "lesson_reminder"
    DAILY_SCHEDULE = "daily_schedule"

    # Homework / review
    HOMEWORK_ASSIGNED = "homework_assigned"
    HOMEWORK_UPDATED = "homework_updated"
    HOMEWORK_EDITED = "homework_edited"
    HOMEWORK_SUBMITTED = "homework_submitted"
    HOMEWORK_RESUBMITTED = "homework_resubmitted"
    HOMEWORK_CHECKED = "homework_checked"
    HOMEWORK_RETURNED = "homework_returned"
    HOMEWORK_REVIEW_DIGEST = "homework_review_digest"
    OVERDUE_HOMEWORK_DIGEST = "overdue_homework_digest"
    AUTO_CHECK_ATTENTION = "auto_check_attention"

    # Classroom
    NEW_STUDENT = "new_student"
    STUDENT_MESSAGE = "student_message"
    STUDENT_ENTERED_ROOM = "student_entered_room"
    STUDENT_ABSENT = "student_absent"

    # Journal
    JOURNAL_RESULTS = "journal_results"
    JOURNAL_DAILY_DIGEST = "journal_daily_digest"

    # Billing (teacher)
    BILLING_PAYMENT = "billing_payment"
    BILLING_PACKAGE_LOW = "billing_package_low"
    BILLING_UNPAID_LESSON = "billing_unpaid_lesson"
    BILLING_DIGEST = "billing_digest"

    # Billing (student, teacher-gated)
    STUDENT_PAYMENT_RECORDED = "student_payment_recorded"
    STUDENT_PACKAGE_LOW = "student_package_low"
    STUDENT_PACKAGE_ENDED = "student_package_ended"
    STUDENT_UNPAID_LESSON = "student_unpaid_lesson"
    STUDENT_PAYMENT_DUE = "student_payment_due"
    BILLING_REMINDER = "billing_reminder"

    # System
    SYSTEM_ANNOUNCEMENT = "system_announcement"
    PUSH_TEST = "push_test"

    # Legacy schedule payload type (stored as schedule_event + change_type)
    SCHEDULE_EVENT = "schedule_event"


ROLE_TEACHER = "teacher"
ROLE_STUDENT = "student"
ROLE_PARENT = "parent"
ROLE_ALL = frozenset({ROLE_TEACHER, ROLE_STUDENT, ROLE_PARENT})

CHANNEL_IN_APP = "in_app"
CHANNEL_PUSH = "push"
CHANNEL_TELEGRAM = "telegram"
CHANNEL_VK = "vk"


@dataclass(frozen=True)
class EventDefinition:
    code: str
    label: str
    description: str
    preference_field: str | None
    roles: frozenset[str]
    channels: frozenset[str] = field(
        default_factory=lambda: frozenset({CHANNEL_IN_APP, CHANNEL_PUSH})
    )
    default_enabled: bool = True
    can_disable: bool = True
    priority: str = "important"  # critical | important | normal
    urgent: bool = False
    group: str = "system"
    # Legacy payload.type values that map to this event
    legacy_aliases: tuple[str, ...] = ()
    url_default: str = "/cabinet"


# Preference field → event codes (one setting may cover several events)
PREFERENCE_EVENT_MAP: dict[str, tuple[str, ...]] = {}

EVENT_DEFINITIONS: dict[str, EventDefinition] = {}


def _reg(defn: EventDefinition) -> EventDefinition:
    EVENT_DEFINITIONS[defn.code] = defn
    if defn.preference_field:
        existing = PREFERENCE_EVENT_MAP.get(defn.preference_field, ())
        PREFERENCE_EVENT_MAP[defn.preference_field] = existing + (defn.code,)
    for alias in defn.legacy_aliases:
        EVENT_DEFINITIONS.setdefault(alias, defn)
    return defn


def _init_catalog() -> None:
    if EVENT_DEFINITIONS:
        return

    defs: list[EventDefinition] = [
        EventDefinition(
            code=NotificationEventType.LESSON_CREATED,
            label="Новые занятия",
            description="Сообщать о создании нового урока в расписании.",
            preference_field="notify_lesson_created",
            roles=ROLE_ALL,
            channels=frozenset({CHANNEL_IN_APP, CHANNEL_PUSH, CHANNEL_TELEGRAM, CHANNEL_VK}),
            group="schedule",
            url_default="/cabinet/schedule",
            legacy_aliases=("schedule_event",),
        ),
        EventDefinition(
            code=NotificationEventType.LESSON_MOVED,
            label="Перенос занятия",
            description="Сообщать, когда урок переносят на другое время.",
            preference_field="notify_lesson_moved",
            roles=ROLE_ALL,
            channels=frozenset({CHANNEL_IN_APP, CHANNEL_PUSH, CHANNEL_TELEGRAM, CHANNEL_VK}),
            priority="important",
            urgent=True,
            group="schedule",
            url_default="/cabinet/schedule",
        ),
        EventDefinition(
            code=NotificationEventType.LESSON_CANCELLED,
            label="Отмена занятия",
            description="Сообщать об отмене урока.",
            preference_field="notify_lesson_cancelled",
            roles=ROLE_ALL,
            channels=frozenset({CHANNEL_IN_APP, CHANNEL_PUSH, CHANNEL_TELEGRAM, CHANNEL_VK}),
            priority="important",
            urgent=True,
            group="schedule",
            url_default="/cabinet/schedule",
        ),
        EventDefinition(
            code=NotificationEventType.LESSON_UPDATED,
            label="Изменение занятия",
            description="Сообщать об изменении темы, ссылки или других деталей урока.",
            preference_field="notify_lesson_updated",
            roles=ROLE_ALL,
            channels=frozenset({CHANNEL_IN_APP, CHANNEL_PUSH, CHANNEL_TELEGRAM, CHANNEL_VK}),
            priority="normal",
            group="schedule",
            url_default="/cabinet/schedule",
        ),
        EventDefinition(
            code=NotificationEventType.LESSON_PARTICIPANTS,
            label="Изменение участников",
            description="Сообщать, когда вас добавляют или убирают с занятия.",
            preference_field="notify_participants_changed",
            roles=ROLE_ALL,
            channels=frozenset({CHANNEL_IN_APP, CHANNEL_PUSH, CHANNEL_TELEGRAM, CHANNEL_VK}),
            priority="normal",
            group="schedule",
            url_default="/cabinet/schedule",
        ),
        EventDefinition(
            code=NotificationEventType.LESSON_REMINDER,
            label="Напоминание об уроке",
            description="Напоминание за выбранное время до начала занятия.",
            preference_field=None,  # controlled by lesson_reminder_minutes list
            roles=ROLE_ALL,
            channels=frozenset({CHANNEL_IN_APP, CHANNEL_PUSH, CHANNEL_TELEGRAM, CHANNEL_VK}),
            can_disable=True,
            priority="important",
            group="schedule",
            url_default="/cabinet/schedule",
        ),
        EventDefinition(
            code=NotificationEventType.DAILY_SCHEDULE,
            label="Расписание на день",
            description="Утренняя сводка занятий на сегодня.",
            preference_field="notify_daily_schedule",
            roles=frozenset({ROLE_TEACHER}),
            priority="normal",
            group="schedule",
            url_default="/cabinet/schedule",
        ),
        EventDefinition(
            code=NotificationEventType.HOMEWORK_ASSIGNED,
            label="Новое домашнее задание",
            description="Сообщать ученику, когда выдано новое задание.",
            preference_field="notify_homework",
            roles=frozenset({ROLE_STUDENT, ROLE_PARENT}),
            channels=frozenset({CHANNEL_IN_APP, CHANNEL_PUSH, CHANNEL_TELEGRAM}),
            group="homework",
            url_default="/cabinet/student/assignments",
        ),
        EventDefinition(
            code=NotificationEventType.HOMEWORK_UPDATED,
            label="Обновление домашнего задания",
            description="Сообщать, когда в задании появились новые материалы.",
            preference_field="notify_homework",
            roles=frozenset({ROLE_STUDENT, ROLE_PARENT}),
            channels=frozenset({CHANNEL_IN_APP, CHANNEL_PUSH, CHANNEL_TELEGRAM}),
            group="homework",
            url_default="/cabinet/student/assignments",
        ),
        EventDefinition(
            code=NotificationEventType.HOMEWORK_EDITED,
            label="Домашнее задание изменено",
            description="Сообщать об изменении условий или срока задания.",
            preference_field="notify_homework",
            roles=frozenset({ROLE_STUDENT, ROLE_PARENT}),
            channels=frozenset({CHANNEL_IN_APP, CHANNEL_PUSH, CHANNEL_TELEGRAM}),
            group="homework",
            url_default="/cabinet/student/assignments",
        ),
        EventDefinition(
            code=NotificationEventType.HOMEWORK_SUBMITTED,
            label="Ученик сдал работу",
            description="Сообщать, когда работа ученика готова к проверке.",
            preference_field="notify_homework",
            roles=frozenset({ROLE_TEACHER}),
            group="homework",
            url_default="/cabinet/review",
        ),
        EventDefinition(
            code=NotificationEventType.HOMEWORK_RESUBMITTED,
            label="Ученик сдал исправленную работу",
            description="Сообщать о повторной сдаче после доработки.",
            preference_field="notify_homework_resubmitted",
            roles=frozenset({ROLE_TEACHER}),
            group="homework",
            url_default="/cabinet/review",
        ),
        EventDefinition(
            code=NotificationEventType.HOMEWORK_CHECKED,
            label="Результат проверки",
            description="Сообщать ученику, когда работа проверена.",
            preference_field="notify_review",
            roles=frozenset({ROLE_STUDENT, ROLE_PARENT}),
            channels=frozenset({CHANNEL_IN_APP, CHANNEL_PUSH, CHANNEL_TELEGRAM}),
            group="review",
            url_default="/cabinet/student/assignments",
        ),
        EventDefinition(
            code=NotificationEventType.HOMEWORK_RETURNED,
            label="Работа возвращена на доработку",
            description="Сообщать, когда учитель вернул работу на исправление.",
            preference_field="notify_review",
            roles=frozenset({ROLE_STUDENT, ROLE_PARENT}),
            channels=frozenset({CHANNEL_IN_APP, CHANNEL_PUSH, CHANNEL_TELEGRAM}),
            group="review",
            url_default="/cabinet/student/assignments",
        ),
        EventDefinition(
            code=NotificationEventType.HOMEWORK_REVIEW_DIGEST,
            label="Сводка работ на проверку",
            description="Периодическая сводка новых работ вместо мгновенных push.",
            preference_field="notify_homework",
            roles=frozenset({ROLE_TEACHER}),
            group="homework",
            url_default="/cabinet/review",
        ),
        EventDefinition(
            code=NotificationEventType.OVERDUE_HOMEWORK_DIGEST,
            label="Просроченные задания",
            description="Сводка просроченных домашних заданий.",
            preference_field="notify_overdue_homework",
            roles=frozenset({ROLE_TEACHER}),
            priority="normal",
            group="homework",
            url_default="/cabinet/review",
        ),
        EventDefinition(
            code=NotificationEventType.AUTO_CHECK_ATTENTION,
            label="Автопроверка требует внимания",
            description="Сообщать, когда автоматическая проверка не завершилась полностью.",
            preference_field="notify_auto_check_attention",
            roles=frozenset({ROLE_TEACHER}),
            group="review",
            url_default="/cabinet/review",
        ),
        EventDefinition(
            code=NotificationEventType.NEW_STUDENT,
            label="Новые ученики",
            description="Сообщать, когда ученик присоединился по приглашению.",
            preference_field="notify_new_student",
            roles=frozenset({ROLE_TEACHER}),
            group="classroom",
            url_default="/cabinet/students",
        ),
        EventDefinition(
            code=NotificationEventType.STUDENT_MESSAGE,
            label="Сообщения учеников",
            description="Сообщать о текстовых сообщениях учеников к заданиям.",
            preference_field="notify_student_message",
            roles=frozenset({ROLE_TEACHER}),
            priority="normal",
            group="classroom",
            url_default="/cabinet/review",
        ),
        EventDefinition(
            code=NotificationEventType.STUDENT_ENTERED_ROOM,
            label="Ученик вошёл в комнату",
            description="Сообщать, когда ученик зашёл в комнату урока.",
            preference_field="notify_student_entered_room",
            roles=frozenset({ROLE_TEACHER}),
            priority="normal",
            default_enabled=False,
            group="classroom",
            url_default="/cabinet/meetings",
        ),
        EventDefinition(
            code=NotificationEventType.STUDENT_ABSENT,
            label="Ученик не подключился",
            description="Сообщать, если ученик не зашёл в комнату после начала урока.",
            preference_field="notify_student_absent",
            roles=frozenset({ROLE_TEACHER}),
            priority="important",
            default_enabled=False,
            group="classroom",
            url_default="/cabinet/meetings",
        ),
        EventDefinition(
            code=NotificationEventType.JOURNAL_RESULTS,
            label="Итоги урока опубликованы",
            description="Сообщать ученику об опубликованных итогах занятия.",
            preference_field="notify_journal_results",
            roles=frozenset({ROLE_STUDENT, ROLE_PARENT}),
            group="review",
            url_default="/cabinet/student",
        ),
        EventDefinition(
            code=NotificationEventType.JOURNAL_DAILY_DIGEST,
            label="Ежедневная сводка журнала",
            description="Сводка по журналу успеваемости за день.",
            preference_field="notify_journal_daily_digest",
            roles=frozenset({ROLE_TEACHER}),
            default_enabled=False,
            priority="normal",
            group="review",
            url_default="/cabinet/journal",
            channels=frozenset({CHANNEL_IN_APP, CHANNEL_PUSH, CHANNEL_TELEGRAM}),
        ),
        EventDefinition(
            code=NotificationEventType.BILLING_PAYMENT,
            label="Оплата получена",
            description="Сообщать о зарегистрированной оплате.",
            preference_field="notify_payment_received",
            roles=frozenset({ROLE_TEACHER}),
            group="billing",
            url_default="/cabinet/payments",
        ),
        EventDefinition(
            code=NotificationEventType.BILLING_PACKAGE_LOW,
            label="Заканчивается абонемент",
            description="Сообщать, когда у ученика осталось мало занятий или минут.",
            preference_field="notify_package_low",
            roles=frozenset({ROLE_TEACHER}),
            group="billing",
            url_default="/cabinet/payments",
        ),
        EventDefinition(
            code=NotificationEventType.BILLING_UNPAID_LESSON,
            label="Нет оплаты / задолженность",
            description="Сообщать о проведённом уроке без оплаты.",
            preference_field="notify_debt_created",
            roles=frozenset({ROLE_TEACHER}),
            group="billing",
            url_default="/cabinet/payments",
        ),
        EventDefinition(
            code=NotificationEventType.BILLING_DIGEST,
            label="Финансовая сводка",
            description="Ежедневная или еженедельная сводка по оплатам.",
            preference_field="notify_billing_daily_digest",
            roles=frozenset({ROLE_TEACHER}),
            default_enabled=False,
            priority="normal",
            group="billing",
            url_default="/cabinet/payments",
        ),
        EventDefinition(
            code=NotificationEventType.STUDENT_PAYMENT_RECORDED,
            label="Оплата зафиксирована",
            description="Сообщать ученику, что оплата записана.",
            preference_field="notify_student_payment_recorded",
            roles=frozenset({ROLE_STUDENT, ROLE_PARENT}),
            default_enabled=False,
            group="billing_student",
            url_default="/cabinet/student",
        ),
        EventDefinition(
            code=NotificationEventType.STUDENT_PACKAGE_LOW,
            label="Мало занятий или минут",
            description="Сообщать ученику, что абонемент почти закончился.",
            preference_field="notify_student_package_low",
            roles=frozenset({ROLE_STUDENT, ROLE_PARENT}),
            default_enabled=False,
            group="billing_student",
            url_default="/cabinet/student",
        ),
        EventDefinition(
            code=NotificationEventType.STUDENT_PACKAGE_ENDED,
            label="Абонемент закончился",
            description="Сообщать ученику, что занятий в абонементе больше нет.",
            preference_field="notify_student_package_ended",
            roles=frozenset({ROLE_STUDENT, ROLE_PARENT}),
            default_enabled=False,
            group="billing_student",
            url_default="/cabinet/student",
        ),
        EventDefinition(
            code=NotificationEventType.STUDENT_UNPAID_LESSON,
            label="Неоплаченный урок",
            description="Сообщать ученику о неоплаченном занятии.",
            preference_field="notify_student_unpaid_lesson",
            roles=frozenset({ROLE_STUDENT, ROLE_PARENT}),
            default_enabled=False,
            group="billing_student",
            url_default="/cabinet/student",
        ),
        EventDefinition(
            code=NotificationEventType.STUDENT_PAYMENT_DUE,
            label="Приближается срок оплаты",
            description="Напоминание ученику о приближающемся сроке оплаты.",
            preference_field="notify_student_payment_due",
            roles=frozenset({ROLE_STUDENT, ROLE_PARENT}),
            default_enabled=False,
            group="billing_student",
            url_default="/cabinet/student",
        ),
        EventDefinition(
            code=NotificationEventType.BILLING_REMINDER,
            label="Напоминание об оплате",
            description="Персональное напоминание об оплате от учителя.",
            preference_field="notify_student_payment_due",
            roles=frozenset({ROLE_STUDENT, ROLE_PARENT}),
            default_enabled=False,
            group="billing_student",
            url_default="/cabinet/student",
        ),
        EventDefinition(
            code=NotificationEventType.SYSTEM_ANNOUNCEMENT,
            label="Системные события",
            description="Важные сообщения платформы и технические оповещения.",
            preference_field="notify_system",
            roles=frozenset({ROLE_TEACHER, ROLE_STUDENT}),
            can_disable=True,
            priority="important",
            group="system",
            url_default="/cabinet",
        ),
        EventDefinition(
            code=NotificationEventType.PUSH_TEST,
            label="Тестовое уведомление",
            description="Проверка доставки Web Push на текущее устройство.",
            preference_field=None,
            roles=ROLE_ALL,
            channels=frozenset({CHANNEL_PUSH}),
            can_disable=False,
            priority="important",
            group="system",
            url_default="/cabinet",
        ),
    ]
    for d in defs:
        _reg(d)


_init_catalog()


# UI toggles that must map to at least one catalog event
UI_PREFERENCE_FIELDS: tuple[str, ...] = (
    "notify_lesson_created",
    "notify_lesson_moved",
    "notify_lesson_cancelled",
    "notify_lesson_updated",
    "notify_participants_changed",
    "notify_daily_schedule",
    "notify_daily_schedule_empty",
    "notify_homework",
    "notify_homework_resubmitted",
    "notify_overdue_homework",
    "notify_review",
    "notify_journal_results",
    "notify_journal_comment",
    "notify_journal_recommendation",
    "notify_journal_daily_digest",
    "notify_auto_check_attention",
    "notify_new_student",
    "notify_student_message",
    "notify_student_entered_room",
    "notify_student_absent",
    "notify_system",
    "notify_payment_received",
    "notify_package_low",
    "notify_debt_created",
    "notify_billing_daily_digest",
    "notify_billing_weekly_digest",
    "notify_student_payment_recorded",
    "notify_student_package_low",
    "notify_student_package_ended",
    "notify_student_unpaid_lesson",
    "notify_student_payment_due",
)

# Fields shown in UI that are modes/meta rather than event toggles
UI_META_FIELDS: tuple[str, ...] = (
    "push_enabled",
    "push_privacy_mode",
    "in_app_enabled",
    "lesson_reminder_minutes",
    "homework_review_push_mode",
    "overdue_homework_mode",
    "digest_hour",
    "daily_schedule_hour",
    "dnd_enabled",
    "dnd_allow_urgent",
    "dnd_start",
    "dnd_end",
)


def get_event_definition(event_type: str) -> EventDefinition | None:
    return EVENT_DEFINITIONS.get(event_type)


def resolve_event_type(payload_type: str | None, change_type: str | None = None) -> str:
    """Map stored payload.type (+ optional change_type) to catalog code."""
    if not payload_type:
        return ""
    if payload_type == NotificationEventType.SCHEDULE_EVENT and change_type:
        mapping = {
            "created": NotificationEventType.LESSON_CREATED,
            "moved": NotificationEventType.LESSON_MOVED,
            "cancelled": NotificationEventType.LESSON_CANCELLED,
            "updated": NotificationEventType.LESSON_UPDATED,
            "participants_changed": NotificationEventType.LESSON_PARTICIPANTS,
            "reminder": NotificationEventType.LESSON_REMINDER,
        }
        return mapping.get(change_type, payload_type)
    defn = EVENT_DEFINITIONS.get(payload_type)
    return defn.code if defn else payload_type


def iter_catalog() -> Iterable[EventDefinition]:
    seen = set()
    for code, defn in EVENT_DEFINITIONS.items():
        if defn.code in seen:
            continue
        if code != defn.code:
            continue
        seen.add(defn.code)
        yield defn


def preference_fields_for_role(role: str) -> list[str]:
    fields: list[str] = []
    for defn in iter_catalog():
        if defn.preference_field and role in defn.roles:
            if defn.preference_field not in fields:
                fields.append(defn.preference_field)
    # Meta schedule empties only for teacher
    if role == ROLE_TEACHER:
        for extra in (
            "notify_daily_schedule_empty",
            "notify_billing_weekly_digest",
            "notify_journal_comment",
            "notify_journal_recommendation",
        ):
            if extra not in fields:
                fields.append(extra)
    return fields


def orphan_ui_preference_fields() -> list[str]:
    """UI fields without catalog mapping (excluding known meta/mode fields)."""
    orphans = []
    for field_name in UI_PREFERENCE_FIELDS:
        if field_name in (
            "notify_daily_schedule_empty",
            "notify_billing_weekly_digest",
            "notify_journal_comment",
            "notify_journal_recommendation",
        ):
            # Bound to sibling events / digest modes
            continue
        if field_name not in PREFERENCE_EVENT_MAP:
            orphans.append(field_name)
    return orphans
