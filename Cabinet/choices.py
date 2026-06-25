from django.db import models


class Direction(models.TextChoices):
    OGE = "oge", "ОГЭ"
    EGE = "ege", "ЕГЭ"
    PYTHON = "python", "Python"
    SCHOOL = "school", "Школьная база"
    OTHER = "other", "Другое"


class ExamType(models.TextChoices):
    OGE = "oge", "ОГЭ"
    EGE = "ege", "ЕГЭ"
    NONE = "none", "Нет"


class StudentStatus(models.TextChoices):
    ACTIVE = "active", "Активен"
    PAUSED = "paused", "На паузе"
    ARCHIVED = "archived", "В архиве"


class InvitationStatus(models.TextChoices):
    PENDING = "pending", "Ожидает"
    ACCEPTED = "accepted", "Принято"
    EXPIRED = "expired", "Истекло"
    CANCELLED = "cancelled", "Отменено"


class GroupStatus(models.TextChoices):
    ACTIVE = "active", "Активна"
    ARCHIVED = "archived", "В архиве"


class LessonStatus(models.TextChoices):
    DRAFT = "draft", "Черновик"
    PLANNED = "planned", "Запланирован"
    PUBLISHED = "published", "Опубликован"
    COMPLETED = "completed", "Завершён"
    ARCHIVED = "archived", "В архиве"


class LessonType(models.TextChoices):
    INDIVIDUAL = "individual", "Индивидуальный"
    GROUP = "group", "Групповой"
    TEMPLATE = "template", "Шаблон"


class AssignmentStatus(models.TextChoices):
    ASSIGNED = "assigned", "Выдано"
    IN_PROGRESS = "in_progress", "В работе"
    COMPLETED = "completed", "Выполнено"
    OVERDUE = "overdue", "Просрочено"
    CHECKED = "checked", "Проверено"


class PlanFormat(models.TextChoices):
    INDIVIDUAL = "individual", "Индивидуальный"
    GROUP = "group", "Групповой"


class PlanStatus(models.TextChoices):
    DRAFT = "draft", "Черновик"
    PUBLISHED = "published", "Опубликован"
    ARCHIVED = "archived", "В архиве"


class EnrollmentStatus(models.TextChoices):
    ACTIVE = "active", "Активно"
    PAUSED = "paused", "На паузе"
    COMPLETED = "completed", "Завершено"
    CANCELLED = "cancelled", "Отменено"


class PlanItemStatus(models.TextChoices):
    NOT_STARTED = "not_started", "Не начато"
    PLANNED = "planned", "Запланировано"
    COMPLETED = "completed", "Завершено"
    SKIPPED = "skipped", "Пропущено"
    REPEAT_NEEDED = "repeat_needed", "Нужно повторить"


class InteractiveType(models.TextChoices):
    FLASHCARDS = "flashcards", "Карточки"
    MATCHING = "matching", "Сопоставление"
    ORDERING = "ordering", "Собери порядок"
    QUIZ = "quiz", "Викторина"
    WHEEL = "wheel", "Случайное колесо"


class InteractiveStatus(models.TextChoices):
    DRAFT = "draft", "Черновик"
    PUBLISHED = "published", "Опубликован"
    ARCHIVED = "archived", "В архиве"


class HomeworkStatus(models.TextChoices):
    DRAFT = "draft", "Черновик"
    ASSIGNED = "assigned", "Выдано"
    COMPLETED = "completed", "Выполнено"
    OVERDUE = "overdue", "Просрочено"
    CHECKED = "checked", "Проверено"
    ARCHIVED = "archived", "В архиве"


class HomeworkTaskType(models.TextChoices):
    TEXT = "text", "Текст"
    FILE = "file", "Файл"
    INTERACTIVE = "interactive", "Интерактив"
    GENERATED_TASK = "generated_task", "Задача из банка"
    EXTERNAL_LINK = "external_link", "Внешняя ссылка"


class SubmissionStatus(models.TextChoices):
    SUBMITTED = "submitted", "Сдано"
    CHECKED = "checked", "Проверено"
    RETURNED = "returned", "Возвращено"
    NEEDS_REVISION = "needs_revision", "Нужна доработка"


class ReviewSourceType(models.TextChoices):
    HOMEWORK = "homework", "Домашнее задание"
    INTERACTIVE = "interactive", "Интерактив"
    LESSON = "lesson", "Урок"
    VARIANT = "variant", "Вариант"
    TASK = "task", "Задание"


class ReviewStatus(models.TextChoices):
    PENDING = "pending", "Ожидает"
    CHECKED = "checked", "Проверено"
    RETURNED = "returned", "Возвращено"
    IGNORED = "ignored", "Пропущено"


class ReviewPriority(models.TextChoices):
    LOW = "low", "Низкий"
    NORMAL = "normal", "Обычный"
    HIGH = "high", "Высокий"


class MaterialType(models.TextChoices):
    LESSON = "lesson", "Урок"
    WORKSHEET = "worksheet", "Рабочий лист"
    PRESENTATION = "presentation", "Презентация"
    METHODIC = "methodic", "Методичка"
    FILE = "file", "Файл"
    LINK = "link", "Ссылка"
    TASK_SET = "task_set", "Набор задач"


class MaterialStatus(models.TextChoices):
    DRAFT = "draft", "Черновик"
    PUBLISHED = "published", "Опубликован"
    ARCHIVED = "archived", "В архиве"


class MeetingProvider(models.TextChoices):
    YANDEX_TELEMOST = "yandex_telemost", "Яндекс Телемост"
    MANUAL = "manual", "Вручную"
    NONE = "none", "Нет"


class ScheduleEventType(models.TextChoices):
    INDIVIDUAL_LESSON = "individual_lesson", "Индивидуальный урок"
    GROUP_LESSON = "group_lesson", "Групповой урок"
    CONSULTATION = "consultation", "Консультация"
    HOMEWORK_DEADLINE = "homework_deadline", "Дедлайн ДЗ"
    REVIEW = "review", "Проверка работ"
    OTHER = "other", "Другое"


class RecurrenceType(models.TextChoices):
    NONE = "none", "Не повторять"
    DAILY = "daily", "Каждый день"
    WEEKLY = "weekly", "Каждую неделю"
    WEEKDAYS = "weekdays", "По будням"
    CUSTOM_WEEKDAYS = "custom_weekdays", "По выбранным дням"
    BIWEEKLY = "biweekly", "Каждые 2 недели"
    MONTHLY = "monthly", "Каждый месяц"
    CUSTOM = "custom", "Настроить вручную"


class SeriesStatus(models.TextChoices):
    ACTIVE = "active", "Активна"
    COMPLETED = "completed", "Завершена"
    CANCELLED = "cancelled", "Отменена"
    ARCHIVED = "archived", "В архиве"


class ParticipantRole(models.TextChoices):
    ORGANIZER = "organizer", "Организатор"
    STUDENT = "student", "Ученик"
    PARENT = "parent", "Родитель"
    GUEST = "guest", "Гость"


class ParticipantStatus(models.TextChoices):
    INVITED = "invited", "Приглашён"
    ACCEPTED = "accepted", "Принято"
    DECLINED = "declined", "Отклонено"
    REMOVED = "removed", "Удалён"


class ScheduleChangeType(models.TextChoices):
    CREATED = "created", "Создано"
    MOVED = "moved", "Перенесено"
    CANCELLED = "cancelled", "Отменено"
    UPDATED = "updated", "Изменено"
    PARTICIPANTS_CHANGED = "participants_changed", "Изменены участники"
    RESTORED = "restored", "Восстановлено"


class NotificationChannel(models.TextChoices):
    IN_APP = "in_app", "В кабинете"
    EMAIL = "email", "Email"
    VK = "vk", "ВКонтакте"
    TELEGRAM = "telegram", "Telegram"
    SMS = "sms", "SMS"


class NotificationStatus(models.TextChoices):
    PENDING = "pending", "Ожидает"
    SENT = "sent", "Отправлено"
    FAILED = "failed", "Ошибка"
    SKIPPED = "skipped", "Пропущено"
