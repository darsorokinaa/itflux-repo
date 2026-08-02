import uuid

from django.contrib.auth.models import User
from django.core.exceptions import ValidationError
from django.db import models
from django.utils import timezone

from .choices import (
    AssignmentStatus,
    Direction,
    EnrollmentStatus,
    ExamType,
    GroupStatus,
    HomeworkStatus,
    HomeworkTaskType,
    InvitationStatus,
    InteractiveStatus,
    InteractiveType,
    LessonStatus,
    LessonType,
    MaterialStatus,
    MaterialType,
    MeetingProvider,
    NotificationChannel,
    NotificationStatus,
    ParticipantRole,
    ParticipantStatus,
    PlanFormat,
    PlanItemStatus,
    PlanStatus,
    PlanSubject,
    RecurrenceType,
    ReviewPriority,
    ReviewSourceType,
    ReviewStatus,
    ScheduleChangeType,
    ScheduleEventType,
    SeriesStatus,
    StudentStatus,
    StudentSubjectStatus,
    SubmissionStatus,
)


class Profile(models.Model):
    class Role(models.TextChoices):
        STUDENT = "student", "Ученик"
        TEACHER = "teacher", "Учитель"
        PARENT = "parent", "Родитель"

    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name="profile")
    name = models.CharField("Имя", max_length=100, blank=True)
    surname = models.CharField("Фамилия", max_length=100, blank=True)
    display_name = models.CharField("Отображаемое имя", max_length=200, blank=True)
    avatar = models.ImageField(
        "Аватар (legacy)",
        upload_to="cabinet/avatars/",
        blank=True,
        null=True,
        help_text="Устаревшее файловое поле; новые аватары хранятся зашифрованно в avatar_encrypted",
    )
    avatar_encrypted = models.BinaryField(
        "Аватар (зашифрованный)",
        blank=True,
        null=True,
        help_text="JPEG в Fernet-шифре; ключ из SECRET_KEY",
    )
    avatar_content_type = models.CharField(
        "MIME аватара",
        max_length=64,
        blank=True,
        default="",
    )
    avatar_updated_at = models.DateTimeField("Аватар обновлён", null=True, blank=True)
    bio = models.TextField("О себе", blank=True)
    timezone = models.CharField("Часовой пояс", max_length=64, default="Europe/Moscow")
    role = models.CharField(
        "Роль",
        max_length=20,
        choices=Role.choices,
        default=Role.STUDENT,
    )
    account_status = models.CharField("Статус", max_length=32, default="active")
    reg_date = models.DateTimeField("Дата регистрации", auto_now_add=True)
    last_activity = models.DateTimeField("Последняя активность", auto_now=True)
    email_confirmed = models.BooleanField("Email подтверждён", default=False)
    account_active = models.BooleanField("Аккаунт активен", default=True)
    account_blocked = models.BooleanField("Аккаунт заблокирован", default=False)
    date_blocked = models.DateTimeField("Дата блокировки", null=True, blank=True)
    yandex_oauth_token = models.TextField("Yandex OAuth token", blank=True)
    yandex_refresh_token = models.TextField("Yandex refresh token", blank=True)
    yandex_account_email = models.EmailField("Yandex email", blank=True)
    yandex_calendar_layer_ids = models.CharField("Yandex calendar layer_ids", max_length=255, blank=True)
    created_at = models.DateTimeField("Создан", auto_now_add=True, null=True)
    updated_at = models.DateTimeField("Обновлён", auto_now=True, null=True)

    class Meta:
        verbose_name = "Профиль"
        verbose_name_plural = "Профили"

    def __str__(self):
        label = self.get_display_name() or self.user.username
        return f"{label} ({self.get_role_display()})"

    def get_display_name(self):
        if self.display_name:
            return self.display_name
        full = f"{self.name} {self.surname}".strip()
        return full or self.user.get_full_name() or self.user.username

    def has_avatar(self) -> bool:
        if self.avatar_encrypted:
            return True
        return bool(self.avatar)

    def set_encrypted_avatar(self, raw_bytes: bytes, content_type: str = "") -> None:
        from .avatar_crypto import encrypt_avatar_bytes, normalize_avatar_image

        normalized, mime = normalize_avatar_image(raw_bytes, content_type)
        self.avatar_encrypted = encrypt_avatar_bytes(normalized)
        self.avatar_content_type = mime
        self.avatar_updated_at = timezone.now()
        if self.avatar:
            self.avatar.delete(save=False)
            self.avatar = None

    def clear_avatar(self) -> None:
        self.avatar_encrypted = None
        self.avatar_content_type = ""
        self.avatar_updated_at = None
        if self.avatar:
            self.avatar.delete(save=False)
            self.avatar = None

    def get_decrypted_avatar(self) -> tuple[bytes, str] | None:
        from .avatar_crypto import decrypt_avatar_bytes

        if self.avatar_encrypted:
            raw = decrypt_avatar_bytes(bytes(self.avatar_encrypted))
            mime = (self.avatar_content_type or "image/jpeg").strip() or "image/jpeg"
            return raw, mime
        if self.avatar:
            try:
                with self.avatar.open("rb") as fh:
                    return fh.read(), "image/jpeg"
            except (OSError, ValueError, FileNotFoundError):
                return None
        return None

    @property
    def yandex_calendar_connected(self):
        return bool((self.yandex_oauth_token or "").strip())


class Student(models.Model):
    teacher = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="cabinet_students",
        verbose_name="Учитель",
    )
    user = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="teacher_rosters",
        verbose_name="Аккаунт ученика",
        help_text="Привязанный зарегистрированный пользователь",
    )
    first_name = models.CharField("Имя", max_length=100)
    last_name = models.CharField("Фамилия", max_length=100, blank=True)
    email = models.EmailField("Email", blank=True)
    phone = models.CharField("Телефон", max_length=32, blank=True)
    parent_contact = models.CharField("Контакт родителя", max_length=255, blank=True)
    direction = models.CharField(
        "Направление",
        max_length=20,
        choices=Direction.choices,
        default=Direction.OTHER,
    )
    grade = models.PositiveSmallIntegerField("Класс", null=True, blank=True)
    status = models.CharField(
        "Статус",
        max_length=20,
        choices=StudentStatus.choices,
        default=StudentStatus.ACTIVE,
    )
    notes = models.TextField("Заметки", blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Ученик"
        verbose_name_plural = "Ученики"
        ordering = ["last_name", "first_name"]
        constraints = [
            models.UniqueConstraint(
                fields=["teacher", "user"],
                condition=models.Q(user__isnull=False),
                name="cabinet_unique_teacher_student_user",
            ),
        ]

    def __str__(self):
        return self.full_name

    @property
    def full_name(self):
        if self.user_id:
            profile = getattr(self.user, "profile", None)
            if profile:
                return profile.get_display_name()
        return f"{self.first_name} {self.last_name}".strip()

    @property
    def is_registered(self):
        return self.user_id is not None


class StudentSubject(models.Model):
    """
    Направление обучения ученика у конкретного преподавателя.
    Связь идёт через Student (у которого уже есть teacher), поэтому один ученик
    может иметь разные предметы у разных преподавателей.
    """

    student = models.ForeignKey(
        Student,
        on_delete=models.CASCADE,
        related_name="subjects",
        verbose_name="Ученик",
    )
    subject = models.CharField(
        "Предмет",
        max_length=32,
        help_text="Код предмета (как в планах: inf, math, prog, …)",
    )
    title = models.CharField(
        "Название направления",
        max_length=255,
        blank=True,
        help_text="Например: ОГЭ, программирование, школьная программа",
    )
    direction = models.CharField(
        "Направление / уровень",
        max_length=20,
        choices=Direction.choices,
        default=Direction.OTHER,
        blank=True,
    )
    level = models.CharField("Уровень", max_length=100, blank=True)
    status = models.CharField(
        "Статус",
        max_length=20,
        choices=StudentSubjectStatus.choices,
        default=StudentSubjectStatus.ACTIVE,
    )
    notes = models.TextField("Заметки", blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Предмет ученика"
        verbose_name_plural = "Предметы учеников"
        ordering = ["subject", "title", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=["student", "subject", "direction", "title"],
                condition=models.Q(status=StudentSubjectStatus.ACTIVE),
                name="cabinet_unique_active_student_subject",
            ),
        ]

    def __str__(self):
        label = self.display_label
        return f"{self.student} — {label}"

    @property
    def is_active(self):
        return self.status == StudentSubjectStatus.ACTIVE

    @property
    def subject_label(self):
        from .plan_subjects import get_plan_subject_label

        return get_plan_subject_label(self.subject) or self.subject

    @property
    def display_label(self):
        parts = [self.subject_label]
        extra = (self.title or "").strip()
        if not extra and self.direction and self.direction != Direction.OTHER:
            extra = self.get_direction_display()
        if not extra and (self.level or "").strip():
            extra = self.level.strip()
        if extra:
            parts.append(extra)
        return " · ".join(parts)


class StudentGroup(models.Model):
    teacher = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="cabinet_groups",
        verbose_name="Учитель",
    )
    title = models.CharField("Название", max_length=200)
    description = models.TextField("Описание", blank=True)
    direction = models.CharField(
        "Направление",
        max_length=20,
        choices=Direction.choices,
        default=Direction.OTHER,
    )
    exam_type = models.CharField(
        "Тип экзамена",
        max_length=20,
        choices=ExamType.choices,
        default=ExamType.NONE,
    )
    students = models.ManyToManyField(
        Student,
        related_name="groups",
        blank=True,
        verbose_name="Ученики",
    )
    status = models.CharField(
        "Статус",
        max_length=20,
        choices=GroupStatus.choices,
        default=GroupStatus.ACTIVE,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Группа учеников"
        verbose_name_plural = "Группы учеников"
        ordering = ["title"]

    def __str__(self):
        return self.title


class StudentInvitation(models.Model):
    token = models.CharField("Токен", max_length=64, unique=True, db_index=True)
    teacher = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="student_invitations",
        verbose_name="Учитель",
    )
    group = models.ForeignKey(
        "StudentGroup",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="invitations",
        verbose_name="Группа",
    )
    first_name  = models.CharField("Имя ученика", max_length=100, blank=True)
    last_name   = models.CharField("Фамилия ученика", max_length=100, blank=True)
    pre_student = models.OneToOneField(
        "Student",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="invitation",
        verbose_name="Предварительный профиль",
    )
    email = models.EmailField("Email (подсказка)", blank=True)
    direction = models.CharField(
        "Направление",
        max_length=20,
        choices=Direction.choices,
        default=Direction.OTHER,
    )
    grade = models.PositiveSmallIntegerField("Класс", null=True, blank=True)
    message = models.CharField("Сообщение ученику", max_length=255, blank=True)
    status = models.CharField(
        "Статус",
        max_length=20,
        choices=InvitationStatus.choices,
        default=InvitationStatus.PENDING,
    )
    expires_at = models.DateTimeField("Действует до")
    accepted_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="accepted_invitations",
        verbose_name="Принял",
    )
    accepted_at = models.DateTimeField("Принято", null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Приглашение ученика"
        verbose_name_plural = "Приглашения учеников"
        ordering = ["-created_at"]

    def __str__(self):
        target = self.group.title if self.group_id else "индивидуально"
        return f"Приглашение → {target}"


class Material(models.Model):
    owner = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="platform_materials",
        verbose_name="Владелец платформы",
    )
    teacher = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="teacher_materials",
        verbose_name="Учитель",
    )
    title = models.CharField("Название", max_length=255)
    description = models.TextField("Описание", blank=True)
    material_type = models.CharField(
        "Тип",
        max_length=20,
        choices=MaterialType.choices,
        default=MaterialType.FILE,
    )
    direction = models.CharField(
        "Направление",
        max_length=20,
        choices=Direction.choices,
        default=Direction.OTHER,
    )
    exam_type = models.CharField(
        "Тип экзамена",
        max_length=20,
        choices=ExamType.choices,
        default=ExamType.NONE,
    )
    topic = models.CharField("Тема", max_length=255, blank=True)
    subtopic = models.CharField("Подтема", max_length=255, blank=True)
    task_number = models.CharField("Номер задания", max_length=32, blank=True)
    difficulty = models.CharField("Сложность", max_length=32, blank=True)
    file = models.FileField("Файл", upload_to="cabinet/materials/", blank=True, null=True)
    cabinet_file = models.ForeignKey(
        "CabinetFile",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="materials",
        verbose_name="Файл из хранилища",
    )
    external_url = models.URLField("Внешняя ссылка", blank=True)
    content = models.TextField("Содержимое", blank=True)
    is_public = models.BooleanField("Публичный", default=False)
    status = models.CharField(
        "Статус",
        max_length=20,
        choices=MaterialStatus.choices,
        default=MaterialStatus.PUBLISHED,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Материал"
        verbose_name_plural = "Материалы"
        ordering = ["-created_at"]

    def __str__(self):
        return self.title


class TeacherSavedMaterial(models.Model):
    teacher = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="saved_materials",
        verbose_name="Учитель",
    )
    material = models.ForeignKey(
        Material,
        on_delete=models.CASCADE,
        related_name="saved_by",
        verbose_name="Материал",
    )
    saved_at = models.DateTimeField(auto_now_add=True)
    note = models.TextField("Заметка", blank=True)

    class Meta:
        verbose_name = "Сохранённый материал"
        verbose_name_plural = "Сохранённые материалы"
        unique_together = [("teacher", "material")]
        ordering = ["-saved_at"]

    def __str__(self):
        return f"{self.teacher.username} → {self.material.title}"


class DirectMaterialAssignment(models.Model):
    """Teacher sends a material directly to a student group or individual student."""

    teacher = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="direct_material_assignments",
        verbose_name="Учитель",
    )
    material = models.ForeignKey(
        Material,
        on_delete=models.CASCADE,
        related_name="direct_assignments",
        verbose_name="Материал",
    )
    group = models.ForeignKey(
        "StudentGroup",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="direct_material_assignments",
        verbose_name="Группа",
    )
    student = models.ForeignKey(
        "Student",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="direct_material_assignments",
        verbose_name="Ученик",
    )
    student_subject = models.ForeignKey(
        "StudentSubject",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="direct_material_assignments",
        verbose_name="Предмет ученика",
    )
    message = models.TextField("Сообщение для ученика", blank=True)
    assigned_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Прямая выдача материала"
        verbose_name_plural = "Прямые выдачи материалов"
        ordering = ["-assigned_at"]

    def __str__(self):
        target = self.group or self.student
        return f"{self.teacher.username} → {self.material.title} → {target}"


class Lesson(models.Model):
    teacher = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="cabinet_lessons",
        verbose_name="Учитель",
    )
    title = models.CharField("Название", max_length=255)
    description = models.TextField("Описание", blank=True)
    direction = models.CharField(
        "Направление",
        max_length=20,
        choices=Direction.choices,
        default=Direction.OTHER,
    )
    exam_type = models.CharField(
        "Тип экзамена",
        max_length=20,
        choices=ExamType.choices,
        default=ExamType.NONE,
    )
    topic = models.CharField("Тема", max_length=255, blank=True)
    subtopic = models.CharField("Подтема", max_length=255, blank=True)
    task_number = models.CharField("Номер задания", max_length=32, blank=True)
    duration_minutes = models.PositiveIntegerField("Длительность (мин)", null=True, blank=True)
    status = models.CharField(
        "Статус",
        max_length=20,
        choices=LessonStatus.choices,
        default=LessonStatus.DRAFT,
    )
    lesson_type = models.CharField(
        "Тип урока",
        max_length=20,
        choices=LessonType.choices,
        default=LessonType.TEMPLATE,
    )
    theory_content = models.TextField("Теория", blank=True)
    practice_content = models.TextField("Практика", blank=True)
    homework_description = models.TextField("Домашнее задание", blank=True)
    materials = models.ManyToManyField(
        Material,
        related_name="lessons",
        blank=True,
        verbose_name="Материалы",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Урок"
        verbose_name_plural = "Уроки"
        ordering = ["-updated_at"]

    def __str__(self):
        return self.title


class LessonAssignment(models.Model):
    teacher = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="lesson_assignments",
        verbose_name="Учитель",
    )
    lesson = models.ForeignKey(
        Lesson,
        on_delete=models.CASCADE,
        related_name="assignments",
        verbose_name="Урок",
    )
    student = models.ForeignKey(
        Student,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="lesson_assignments",
        verbose_name="Ученик",
    )
    group = models.ForeignKey(
        StudentGroup,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="lesson_assignments",
        verbose_name="Группа",
    )
    assigned_at = models.DateTimeField("Выдано", auto_now_add=True)
    due_at = models.DateTimeField("Срок", null=True, blank=True)
    status = models.CharField(
        "Статус",
        max_length=20,
        choices=AssignmentStatus.choices,
        default=AssignmentStatus.ASSIGNED,
    )
    comment = models.TextField("Комментарий", blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Выдача урока"
        verbose_name_plural = "Выдачи уроков"
        ordering = ["-assigned_at"]

    def __str__(self):
        target = self.student or self.group
        return f"{self.lesson.title} → {target}"

    def clean(self):
        if bool(self.student) == bool(self.group):
            raise ValidationError("Укажите либо ученика, либо группу.")

    def save(self, *args, **kwargs):
        self.full_clean()
        super().save(*args, **kwargs)


class LessonPlan(models.Model):
    """
    Шаблон плана уроков — методический контент без привязки к ученику/группе.
    teacher=null означает публичный план, доступный всем учителям.
    Для назначения плана конкретному ученику/группе используйте LessonPlanEnrollment.
    """
    teacher = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="lesson_plans",
        verbose_name="Автор",
        help_text="Пусто — публичный план, доступный всем учителям",
    )
    title = models.CharField("Название", max_length=255)
    description = models.TextField("Описание", blank=True)
    goal = models.TextField("Цель", blank=True)
    direction = models.CharField(
        "Направление",
        max_length=20,
        choices=Direction.choices,
        default=Direction.OTHER,
    )
    subject = models.CharField(
        "Предмет",
        max_length=20,
        choices=PlanSubject.choices,
        default=PlanSubject.INFORMATICS,
    )
    exam_type = models.CharField(
        "Тип экзамена",
        max_length=20,
        choices=ExamType.choices,
        default=ExamType.NONE,
    )
    grade = models.CharField(
        "Класс",
        max_length=32,
        blank=True,
        help_text="Например: 9, 10, 11, 10–11",
    )
    lessons_count = models.PositiveIntegerField("Количество занятий", default=0)
    status = models.CharField(
        "Статус",
        max_length=20,
        choices=PlanStatus.choices,
        default=PlanStatus.DRAFT,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "План уроков"
        verbose_name_plural = "Планы уроков"
        ordering = ["-updated_at"]

    def __str__(self):
        return self.title

    @property
    def progress_percent(self):
        items = self.items.all()
        total = items.count()
        if not total:
            return 0
        completed = items.filter(status=PlanItemStatus.COMPLETED).count()
        return round(completed * 100 / total)


class LessonPlanEnrollment(models.Model):
    """
    Назначение плана уроков конкретному ученику или группе.
    Один и тот же план можно назначить нескольким ученикам/группам.
    """
    teacher = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="plan_enrollments",
        verbose_name="Учитель",
    )
    plan = models.ForeignKey(
        LessonPlan,
        on_delete=models.CASCADE,
        related_name="enrollments",
        verbose_name="План уроков",
    )
    student = models.ForeignKey(
        Student,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="plan_enrollments",
        verbose_name="Ученик",
    )
    student_subject = models.ForeignKey(
        "StudentSubject",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="plan_enrollments",
        verbose_name="Предмет ученика",
        help_text="План назначается конкретному предмету ученика",
    )
    group = models.ForeignKey(
        StudentGroup,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="plan_enrollments",
        verbose_name="Группа",
    )
    format = models.CharField(
        "Формат",
        max_length=20,
        choices=PlanFormat.choices,
        default=PlanFormat.INDIVIDUAL,
    )
    start_date = models.DateField("Дата начала", null=True, blank=True)
    end_date = models.DateField("Дата окончания", null=True, blank=True)
    frequency = models.CharField("Частота занятий", max_length=64, blank=True,
                                 help_text="Например: 2 раза в неделю")
    status = models.CharField(
        "Статус",
        max_length=20,
        choices=EnrollmentStatus.choices,
        default=EnrollmentStatus.ACTIVE,
    )
    plan_start_order = models.PositiveIntegerField(
        "Начать с урока плана",
        default=1,
        help_text="Номер урока в плане, с которого начинается прохождение (1 = с первого)",
    )
    notes = models.TextField("Заметки", blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Назначение плана"
        verbose_name_plural = "Назначения планов"
        ordering = ["-created_at"]
        constraints = [
            models.CheckConstraint(
                check=(
                    models.Q(student__isnull=False) |
                    models.Q(group__isnull=False)
                ),
                name="enrollment_has_student_or_group",
            )
        ]

    def __str__(self):
        target = self.student or self.group
        return f"{self.plan.title} → {target}"


class LessonPlanItem(models.Model):
    plan = models.ForeignKey(
        LessonPlan,
        on_delete=models.CASCADE,
        related_name="items",
        verbose_name="План",
    )
    order = models.PositiveIntegerField("Порядок", default=0)
    title = models.CharField("Название", max_length=255)
    topic = models.CharField("Тема", max_length=255, blank=True)
    subtopic = models.CharField("Подтема", max_length=255, blank=True)
    task_number = models.CharField("Номер задания", max_length=32, blank=True)
    goal = models.TextField("Цель занятия", blank=True)
    planned_results = models.TextField(
        "Планируемые результаты",
        blank=True,
        help_text="Что ученик должен знать/уметь после этого занятия",
    )
    description = models.TextField("Описание", blank=True)
    linked_lesson = models.ForeignKey(
        Lesson,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="plan_items",
        verbose_name="Связанный урок",
    )
    lesson_materials_notes = models.TextField(
        "Материалы на уроке",
        blank=True,
        help_text="Описание материалов / ссылки / заметки для этого занятия",
    )
    materials = models.ManyToManyField(
        Material,
        related_name="plan_items",
        blank=True,
        verbose_name="Прикреплённые материалы",
    )
    attached_interactives = models.ManyToManyField(
        "Interactive",
        related_name="plan_items_as_lesson_material",
        blank=True,
        verbose_name="Интерактивы на уроке",
    )
    homework_materials = models.ManyToManyField(
        Material,
        related_name="homework_plan_items",
        blank=True,
        verbose_name="Материалы к ДЗ",
    )
    homework_interactives = models.ManyToManyField(
        "Interactive",
        related_name="plan_items_as_homework",
        blank=True,
        verbose_name="Интерактивы к ДЗ",
    )
    homework_description = models.TextField("Материалы к ДЗ", blank=True)
    scheduled_event = models.ForeignKey(
        "ScheduleEvent",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="plan_items",
        verbose_name="Событие расписания",
    )
    status = models.CharField(
        "Статус",
        max_length=20,
        choices=PlanItemStatus.choices,
        default=PlanItemStatus.NOT_STARTED,
    )
    scheduled_date = models.DateField("Запланированная дата", null=True, blank=True)
    completed_at = models.DateTimeField("Завершено", null=True, blank=True)
    teacher_comment = models.TextField("Комментарий учителя", blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Пункт плана"
        verbose_name_plural = "Пункты плана"
        ordering = ["order", "id"]

    def __str__(self):
        return f"{self.order}. {self.title}"


def interactive_background_upload_to(instance, filename):
    return f"cabinet/interactive-backgrounds/{instance.slug or 'new'}/{filename}"


class InteractiveBackground(models.Model):
    slug = models.SlugField("Код", max_length=40, unique=True)
    name = models.CharField("Название", max_length=120)
    css_background = models.TextField(
        "CSS фона",
        blank=True,
        help_text="Значение для CSS-свойства background (необязательно, если задано изображение)",
    )
    background_image = models.ImageField(
        "Фон-картинка",
        upload_to=interactive_background_upload_to,
        blank=True,
        null=True,
        help_text="Изображение фона (альтернатива CSS)",
    )
    text_tone = models.CharField(
        "Тон текста",
        max_length=10,
        choices=[("dark", "Тёмный"), ("light", "Светлый")],
        default="dark",
    )
    sort_order = models.PositiveSmallIntegerField("Порядок", default=0)
    is_active = models.BooleanField("Активен", default=True)
    is_default = models.BooleanField("По умолчанию", default=False)

    class Meta:
        verbose_name = "Фон интерактива"
        verbose_name_plural = "Фоны интерактивов"
        ordering = ["sort_order", "id"]

    def __str__(self):
        return self.name


class InteractiveCardStyle(models.Model):
    slug = models.SlugField("Код", max_length=40, unique=True)
    name = models.CharField("Название", max_length=120)
    css_class = models.CharField(
        "CSS-класс",
        max_length=80,
        help_text="Класс оформления карточек/полей в плеере",
    )
    description = models.CharField("Описание", max_length=255, blank=True)
    sort_order = models.PositiveSmallIntegerField("Порядок", default=0)
    is_active = models.BooleanField("Активен", default=True)
    is_default = models.BooleanField("По умолчанию", default=False)

    class Meta:
        verbose_name = "Стиль карточек интерактива"
        verbose_name_plural = "Стили карточек интерактивов"
        ordering = ["sort_order", "id"]

    def __str__(self):
        return self.name


def interactive_sound_upload_to(instance, filename):
    return f"cabinet/interactive-sounds/{instance.slug or 'new'}/{filename}"


class InteractiveSoundPack(models.Model):
    slug = models.SlugField("Код", max_length=40, unique=True)
    name = models.CharField("Название", max_length=120)
    description = models.CharField("Описание", max_length=255, blank=True)
    config = models.JSONField(
        "Настройки звуков (синтез)",
        default=dict,
        blank=True,
        help_text="Fallback-профили: flip, correct, wrong, next, end (freq/type/duration/volume)",
    )
    sound_flip = models.FileField(
        "Переворот",
        upload_to=interactive_sound_upload_to,
        blank=True,
        null=True,
    )
    sound_correct = models.FileField(
        "Правильно",
        upload_to=interactive_sound_upload_to,
        blank=True,
        null=True,
    )
    sound_wrong = models.FileField(
        "Неправильно",
        upload_to=interactive_sound_upload_to,
        blank=True,
        null=True,
    )
    sound_next = models.FileField(
        "Следующий",
        upload_to=interactive_sound_upload_to,
        blank=True,
        null=True,
    )
    sound_end = models.FileField(
        "Конец",
        upload_to=interactive_sound_upload_to,
        blank=True,
        null=True,
    )
    sound_background = models.FileField(
        "Фоновый",
        upload_to=interactive_sound_upload_to,
        blank=True,
        null=True,
        help_text="Фоновая музыка или ambient — проигрывается по кругу во время интерактива",
    )
    sort_order = models.PositiveSmallIntegerField("Порядок", default=0)
    is_active = models.BooleanField("Активен", default=True)
    is_default = models.BooleanField("По умолчанию", default=False)

    class Meta:
        verbose_name = "Звуковой пакет интерактива"
        verbose_name_plural = "Звуковые пакеты интерактивов"
        ordering = ["sort_order", "id"]

    def __str__(self):
        return self.name


class Interactive(models.Model):
    teacher = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="interactives",
        verbose_name="Учитель",
    )
    title = models.CharField("Название", max_length=255)
    description = models.TextField("Описание", blank=True)
    interactive_type = models.CharField(
        "Тип",
        max_length=20,
        choices=InteractiveType.choices,
    )
    direction = models.CharField(
        "Направление",
        max_length=20,
        choices=Direction.choices,
        default=Direction.OTHER,
    )
    exam_type = models.CharField(
        "Тип экзамена",
        max_length=20,
        choices=ExamType.choices,
        default=ExamType.NONE,
    )
    topic = models.CharField("Тема", max_length=255, blank=True)
    subtopic = models.CharField("Подтема", max_length=255, blank=True)
    task_number = models.CharField("Номер задания", max_length=32, blank=True)
    difficulty = models.CharField("Сложность", max_length=32, blank=True)
    instruction = models.TextField("Инструкция", blank=True)
    background = models.ForeignKey(
        InteractiveBackground,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="interactives",
        verbose_name="Фон",
    )
    card_style = models.ForeignKey(
        InteractiveCardStyle,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="interactives",
        verbose_name="Стиль карточек",
    )
    sound_pack = models.ForeignKey(
        InteractiveSoundPack,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="interactives",
        verbose_name="Звуковой пакет",
    )
    sound_enabled = models.BooleanField("Звук включён", default=True)
    wheel_settings = models.JSONField(
        "Настройки колеса",
        default=dict,
        blank=True,
    )
    status = models.CharField(
        "Статус",
        max_length=20,
        choices=InteractiveStatus.choices,
        default=InteractiveStatus.DRAFT,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Интерактив"
        verbose_name_plural = "Интерактивы"
        ordering = ["-updated_at"]

    def get_display_title(self, fallback="Без названия"):
        title = (self.title or "").strip()
        if title:
            return title
        if self.interactive_type == "flashcards":
            card = self.flashcards.order_by("order", "id").first()
            if card:
                text = (card.front_text or card.back_text or "").strip()
                if text:
                    return text
        elif self.interactive_type == "matching":
            pair = self.matching_pairs.order_by("order", "id").first()
            if pair:
                text = (pair.left_text or pair.right_text or "").strip()
                if text:
                    return text
        elif self.interactive_type == "quiz":
            question = self.quiz_questions.order_by("order", "id").first()
            if question:
                text = (question.question_text or "").strip()
                if text:
                    return text
        elif self.interactive_type == "wheel":
            segment = self.wheel_segments.order_by("order", "id").first()
            if segment:
                text = (segment.title or "").strip()
                if text:
                    return text
        elif self.interactive_type == "ordering":
            step = self.ordering_items.order_by("correct_order", "id").first()
            if step:
                text = (step.text or "").strip()
                if text:
                    return text
        return fallback

    def __str__(self):
        return self.get_display_title("Интерактив")


class FlashcardItem(models.Model):
    interactive = models.ForeignKey(
        Interactive,
        on_delete=models.CASCADE,
        related_name="flashcards",
        verbose_name="Интерактив",
    )
    front_text = models.TextField("Лицевая сторона")
    back_text = models.TextField("Обратная сторона")
    front_image_url = models.URLField("Картинка на лицевой стороне", max_length=1000, blank=True, default="")
    back_image_url = models.URLField("Картинка на обратной стороне", max_length=1000, blank=True, default="")
    hint = models.CharField("Подсказка", max_length=255, blank=True)
    explanation = models.TextField("Пояснение", blank=True)
    order = models.PositiveIntegerField("Порядок", default=0)

    class Meta:
        verbose_name = "Карточка"
        verbose_name_plural = "Карточки"
        ordering = ["order", "id"]

    def __str__(self):
        return self.front_text[:50]


class MatchingPair(models.Model):
    interactive = models.ForeignKey(
        Interactive,
        on_delete=models.CASCADE,
        related_name="matching_pairs",
        verbose_name="Интерактив",
    )
    left_text = models.TextField("Левая часть")
    right_text = models.TextField("Правая часть")
    left_image_url = models.URLField("Картинка слева", max_length=1000, blank=True, default="")
    right_image_url = models.URLField("Картинка справа", max_length=1000, blank=True, default="")
    explanation = models.TextField("Пояснение", blank=True)
    order = models.PositiveIntegerField("Порядок", default=0)

    class Meta:
        verbose_name = "Пара сопоставления"
        verbose_name_plural = "Пары сопоставления"
        ordering = ["order", "id"]

    def __str__(self):
        return f"{self.left_text} ↔ {self.right_text}"


class OrderingItem(models.Model):
    interactive = models.ForeignKey(
        Interactive,
        on_delete=models.CASCADE,
        related_name="ordering_items",
        verbose_name="Интерактив",
    )
    text = models.TextField("Текст")
    image_url = models.URLField("Картинка", max_length=1000, blank=True, default="")
    correct_order = models.PositiveIntegerField("Правильный порядок")
    explanation = models.TextField("Пояснение", blank=True)

    class Meta:
        verbose_name = "Элемент порядка"
        verbose_name_plural = "Элементы порядка"
        ordering = ["correct_order", "id"]

    def __str__(self):
        return self.text[:50]


class QuizQuestion(models.Model):
    ANSWER_TYPE_SINGLE = "single"
    ANSWER_TYPE_MULTIPLE = "multiple"
    ANSWER_TYPE_CHOICES = [
        (ANSWER_TYPE_SINGLE, "Один правильный"),
        (ANSWER_TYPE_MULTIPLE, "Несколько правильных"),
    ]

    interactive = models.ForeignKey(
        Interactive,
        on_delete=models.CASCADE,
        related_name="quiz_questions",
        verbose_name="Интерактив",
    )
    question_text = models.TextField("Вопрос")
    image_url = models.URLField("Картинка вопроса", max_length=1000, blank=True, default="")
    answers = models.JSONField(
        "Варианты ответов",
        default=list,
        blank=True,
        help_text='[{"id": "a1", "text": "...", "is_correct": true}]',
    )
    answer_type = models.CharField(
        "Тип ответа",
        max_length=10,
        choices=ANSWER_TYPE_CHOICES,
        default=ANSWER_TYPE_SINGLE,
    )
    explanation = models.TextField("Пояснение", blank=True)
    points = models.PositiveSmallIntegerField("Баллы", default=1)
    order = models.PositiveIntegerField("Порядок", default=0)

    class Meta:
        verbose_name = "Вопрос викторины"
        verbose_name_plural = "Вопросы викторины"
        ordering = ["order", "id"]

    def __str__(self):
        return self.question_text[:50]


class WheelSegment(models.Model):
    interactive = models.ForeignKey(
        Interactive,
        on_delete=models.CASCADE,
        related_name="wheel_segments",
        verbose_name="Интерактив",
    )
    external_id = models.CharField("ID сектора", max_length=64, blank=True)
    title = models.CharField("Название", max_length=255)
    description = models.TextField("Описание", blank=True)
    color = models.CharField("Цвет", max_length=20, default="#2563EB")
    points = models.IntegerField("Баллы", default=1)
    order = models.PositiveIntegerField("Порядок", default=0)

    class Meta:
        verbose_name = "Сектор колеса"
        verbose_name_plural = "Сектора колеса"
        ordering = ["order", "id"]

    def __str__(self):
        return self.title[:50]


class InteractiveAssignment(models.Model):
    teacher = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="interactive_assignments",
        verbose_name="Учитель",
    )
    interactive = models.ForeignKey(
        Interactive,
        on_delete=models.CASCADE,
        related_name="assignments",
        verbose_name="Интерактив",
    )
    student = models.ForeignKey(
        Student,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="interactive_assignments",
        verbose_name="Ученик",
    )
    group = models.ForeignKey(
        StudentGroup,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="interactive_assignments",
        verbose_name="Группа",
    )
    lesson = models.ForeignKey(
        Lesson,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="interactive_assignments",
        verbose_name="Урок",
    )
    lesson_plan_item = models.ForeignKey(
        LessonPlanItem,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="interactive_assignments",
        verbose_name="Пункт плана",
    )
    assigned_at = models.DateTimeField(auto_now_add=True)
    due_at = models.DateTimeField(null=True, blank=True)
    attempts_allowed = models.PositiveIntegerField("Попыток", default=3)
    show_result_immediately = models.BooleanField("Показывать результат сразу", default=True)
    status = models.CharField(
        "Статус",
        max_length=20,
        choices=AssignmentStatus.choices,
        default=AssignmentStatus.ASSIGNED,
    )
    comment = models.TextField("Комментарий", blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Выдача интерактива"
        verbose_name_plural = "Выдачи интерактивов"
        ordering = ["-assigned_at"]

    def __str__(self):
        target = self.student or self.group
        return f"{self.interactive.title} → {target}"

    def clean(self):
        if bool(self.student) == bool(self.group):
            raise ValidationError("Укажите либо ученика, либо группу.")

    def save(self, *args, **kwargs):
        self.full_clean()
        super().save(*args, **kwargs)


class InteractiveAttempt(models.Model):
    assignment = models.ForeignKey(
        InteractiveAssignment,
        on_delete=models.CASCADE,
        related_name="attempts",
        verbose_name="Выдача",
    )
    student = models.ForeignKey(
        Student,
        on_delete=models.CASCADE,
        related_name="interactive_attempts",
        verbose_name="Ученик",
    )
    started_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    score_percent = models.DecimalField(
        "Результат %",
        max_digits=5,
        decimal_places=2,
        null=True,
        blank=True,
    )
    raw_answers = models.JSONField("Ответы", default=dict, blank=True)
    mistakes = models.JSONField("Ошибки", default=list, blank=True)
    attempts_count = models.PositiveIntegerField("Номер попытки", default=1)
    status = models.CharField(
        "Статус",
        max_length=20,
        choices=AssignmentStatus.choices,
        default=AssignmentStatus.IN_PROGRESS,
    )

    class Meta:
        verbose_name = "Попытка интерактива"
        verbose_name_plural = "Попытки интерактивов"
        ordering = ["-started_at"]

    def __str__(self):
        return f"{self.student} — {self.assignment.interactive.title}"


class Homework(models.Model):
    teacher = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="homeworks",
        verbose_name="Учитель",
    )
    title = models.CharField("Название", max_length=255)
    description = models.TextField("Описание", blank=True)
    lesson = models.ForeignKey(
        Lesson,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="homeworks",
        verbose_name="Урок",
    )
    lesson_plan_item = models.ForeignKey(
        LessonPlanItem,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="homeworks",
        verbose_name="Пункт плана",
    )
    student = models.ForeignKey(
        Student,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="homeworks",
        verbose_name="Ученик",
    )
    student_subject = models.ForeignKey(
        "StudentSubject",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="homeworks",
        verbose_name="Предмет ученика",
    )
    group = models.ForeignKey(
        StudentGroup,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="homeworks",
        verbose_name="Группа",
    )
    due_at = models.DateTimeField("Срок", null=True, blank=True)
    status = models.CharField(
        "Статус",
        max_length=20,
        choices=HomeworkStatus.choices,
        default=HomeworkStatus.DRAFT,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Домашнее задание"
        verbose_name_plural = "Домашние задания"
        ordering = ["-created_at"]

    def __str__(self):
        return self.title


class HomeworkTask(models.Model):
    homework = models.ForeignKey(
        Homework,
        on_delete=models.CASCADE,
        related_name="tasks",
        verbose_name="Домашнее задание",
    )
    task_type = models.CharField(
        "Тип",
        max_length=20,
        choices=HomeworkTaskType.choices,
        default=HomeworkTaskType.TEXT,
    )
    title = models.CharField("Название", max_length=255)
    description = models.TextField("Описание", blank=True)
    interactive = models.ForeignKey(
        Interactive,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="homework_tasks",
        verbose_name="Интерактив",
    )
    task_id = models.CharField("ID задачи из банка", max_length=64, blank=True)
    order = models.PositiveIntegerField("Порядок", default=0)
    is_active = models.BooleanField(
        "Активно в ДЗ",
        default=True,
        help_text="False — задание исключено из ДЗ без удаления из БД (ответы сохраняются).",
    )

    class Meta:
        verbose_name = "Задание ДЗ"
        verbose_name_plural = "Задания ДЗ"
        ordering = ["order", "id"]

    def __str__(self):
        return self.title


class HomeworkEditHistory(models.Model):
    """Компактная история правок выданного домашнего задания."""

    homework = models.ForeignKey(
        Homework,
        on_delete=models.CASCADE,
        related_name="edit_history",
        verbose_name="Домашнее задание",
    )
    actor = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="homework_edits",
        verbose_name="Кто изменил",
    )
    changed_fields = models.JSONField("Изменённые поля", default=list, blank=True)
    tasks_added = models.JSONField("Добавленные задания", default=list, blank=True)
    tasks_removed = models.JSONField("Удалённые задания", default=list, blank=True)
    old_due_at = models.DateTimeField("Прежний срок", null=True, blank=True)
    new_due_at = models.DateTimeField("Новый срок", null=True, blank=True)
    previous_score = models.DecimalField(
        "Прежний балл",
        max_digits=5,
        decimal_places=2,
        null=True,
        blank=True,
    )
    previous_result_meta = models.JSONField(
        "Снимок результата до правки",
        default=dict,
        blank=True,
        help_text="Компактные метаданные (статус, комментарий, score), без полных файлов.",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "История правки ДЗ"
        verbose_name_plural = "История правок ДЗ"
        ordering = ["-created_at"]

    def __str__(self):
        return f"Правка ДЗ #{self.homework_id} @ {self.created_at}"


class HomeworkSubmission(models.Model):
    homework = models.ForeignKey(
        Homework,
        on_delete=models.CASCADE,
        related_name="submissions",
        verbose_name="Домашнее задание",
    )
    student = models.ForeignKey(
        Student,
        on_delete=models.CASCADE,
        related_name="homework_submissions",
        verbose_name="Ученик",
    )
    submitted_at = models.DateTimeField("Сдано", null=True, blank=True)
    answer_text = models.TextField("Ответ", blank=True)
    result_payload = models.JSONField("Результат варианта", default=dict, blank=True)
    attached_file = models.FileField(
        "Файл",
        upload_to="cabinet/homework/",
        blank=True,
        null=True,
    )
    status = models.CharField(
        "Статус",
        max_length=20,
        choices=SubmissionStatus.choices,
        default=SubmissionStatus.SUBMITTED,
    )
    score = models.DecimalField(
        "Оценка",
        max_digits=5,
        decimal_places=2,
        null=True,
        blank=True,
    )
    teacher_comment = models.TextField("Комментарий учителя", blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Сдача ДЗ"
        verbose_name_plural = "Сдачи ДЗ"
        ordering = ["-submitted_at", "-created_at"]

    def __str__(self):
        return f"{self.student} — {self.homework.title}"


class ReviewItem(models.Model):
    teacher = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="review_items",
        verbose_name="Учитель",
    )
    student = models.ForeignKey(
        Student,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="review_items",
        verbose_name="Ученик",
    )
    group = models.ForeignKey(
        StudentGroup,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="review_items",
        verbose_name="Группа",
    )
    source_type = models.CharField(
        "Тип источника",
        max_length=20,
        choices=ReviewSourceType.choices,
    )
    source_id = models.PositiveIntegerField("ID источника")
    title = models.CharField("Название", max_length=255)
    status = models.CharField(
        "Статус",
        max_length=20,
        choices=ReviewStatus.choices,
        default=ReviewStatus.PENDING,
    )
    priority = models.CharField(
        "Приоритет",
        max_length=20,
        choices=ReviewPriority.choices,
        default=ReviewPriority.NORMAL,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    checked_at = models.DateTimeField(null=True, blank=True)
    teacher_comment = models.TextField("Комментарий", blank=True)

    class Meta:
        verbose_name = "Работа на проверку"
        verbose_name_plural = "Работы на проверку"
        ordering = ["-created_at"]

    def __str__(self):
        return self.title


class ScheduleEvent(models.Model):
    class EventType(models.TextChoices):
        GROUP = "group", "Групповое"
        INDIVIDUAL = "individual", "Индивидуальное"
        HOMEWORK = "homework", "Домашнее задание"
        REVIEW = "review", "Проверка работ"
        INDIVIDUAL_LESSON = "individual_lesson", "Индивидуальный урок"
        GROUP_LESSON = "group_lesson", "Групповой урок"
        HOMEWORK_DEADLINE = "homework_deadline", "Дедлайн ДЗ"
        PERSONAL = "personal", "Личное"

    class Format(models.TextChoices):
        ONLINE = "online", "Онлайн"
        OFFLINE = "offline", "Офлайн"

    class Status(models.TextChoices):
        PLANNED = "planned", "Запланировано"
        DONE = "done", "Завершено"
        COMPLETED = "completed", "Завершено"
        CANCELLED = "cancelled", "Отменено"
        DRAFT = "draft", "Черновик"
        MOVED = "moved", "Перенесено"

    owner = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="schedule_events",
        verbose_name="Учитель",
    )
    title = models.CharField("Название", max_length=200)
    description = models.TextField("Описание", blank=True)
    topic = models.CharField("Тема", max_length=500, blank=True)
    starts_at = models.DateTimeField("Начало")
    ends_at = models.DateTimeField("Окончание")
    event_type = models.CharField(
        "Тип",
        max_length=24,
        choices=EventType.choices,
        default=EventType.GROUP,
    )
    format = models.CharField(
        "Формат",
        max_length=20,
        choices=Format.choices,
        default=Format.ONLINE,
    )
    student = models.ForeignKey(
        Student,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="schedule_events",
        verbose_name="Ученик",
    )
    student_subject = models.ForeignKey(
        "StudentSubject",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="schedule_events",
        verbose_name="Предмет ученика",
        help_text="Предмет занятия для индивидуального ученика",
    )
    group = models.ForeignKey(
        StudentGroup,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="schedule_events",
        verbose_name="Группа",
    )
    lesson = models.ForeignKey(
        Lesson,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="schedule_events",
        verbose_name="Урок",
    )
    lesson_plan_item = models.ForeignKey(
        LessonPlanItem,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="schedule_events_linked",
        verbose_name="Пункт плана",
    )
    homework = models.ForeignKey(
        Homework,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="schedule_events",
        verbose_name="Домашнее задание",
    )
    timezone = models.CharField("Часовой пояс", max_length=64, default="Europe/Moscow")
    telemost_url = models.URLField("Ссылка Телемост", blank=True)
    meeting_provider = models.CharField(
        "Провайдер встречи",
        max_length=24,
        choices=MeetingProvider.choices,
        default=MeetingProvider.NONE,
    )
    location = models.CharField("Место", max_length=255, blank=True)
    audience = models.CharField("Участники", max_length=200, blank=True)
    materials = models.TextField("Материалы", blank=True)
    status = models.CharField(
        "Статус",
        max_length=20,
        choices=Status.choices,
        default=Status.PLANNED,
    )
    teacher_comment = models.TextField("Комментарий", blank=True)
    tags = models.JSONField("Теги", default=list, blank=True)
    series = models.ForeignKey(
        "ScheduleEventSeries",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="events",
        verbose_name="Серия",
    )
    is_recurring_instance = models.BooleanField("Экземпляр серии", default=False)
    original_start_at = models.DateTimeField("Исходное начало", null=True, blank=True)
    reminder_minutes = models.PositiveSmallIntegerField(
        "Напоминание (мин)",
        null=True,
        blank=True,
        help_text="За сколько минут до урока напомнить",
    )
    plan_cancel_action = models.CharField(
        "Действие с темой плана при отмене",
        max_length=8,
        blank=True,
        choices=[
            ("shift", "Перенести тему на следующее занятие"),
            ("skip", "Пропустить тему для ученика"),
        ],
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Урок в расписании"
        verbose_name_plural = "Уроки в расписании"
        ordering = ["starts_at"]

    def __str__(self):
        return f"{self.title} ({self.starts_at:%d.%m.%Y %H:%M})"

    @property
    def meeting_url(self):
        return self.telemost_url


class ScheduleEventSeries(models.Model):
    teacher = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="schedule_series",
        verbose_name="Учитель",
    )
    title = models.CharField("Название", max_length=200)
    description = models.TextField("Описание", blank=True)
    event_type = models.CharField(
        "Тип",
        max_length=24,
        choices=ScheduleEventType.choices,
        default=ScheduleEventType.GROUP_LESSON,
    )
    lesson = models.ForeignKey(
        Lesson,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="schedule_series",
        verbose_name="Урок",
    )
    lesson_plan_item = models.ForeignKey(
        LessonPlanItem,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="schedule_series",
        verbose_name="Пункт плана",
    )
    group = models.ForeignKey(
        StudentGroup,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="schedule_series",
        verbose_name="Группа",
    )
    student_subject = models.ForeignKey(
        "StudentSubject",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="schedule_series",
        verbose_name="Предмет ученика",
    )
    homework = models.ForeignKey(
        Homework,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="schedule_series",
        verbose_name="Домашнее задание",
    )
    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="created_schedule_series",
        verbose_name="Создал",
    )
    timezone = models.CharField("Часовой пояс", max_length=64, default="Europe/Moscow")
    start_date = models.DateField("Дата первого занятия")
    start_time = models.TimeField("Время начала")
    end_time = models.TimeField("Время окончания")
    recurrence_type = models.CharField(
        "Периодичность",
        max_length=24,
        choices=RecurrenceType.choices,
        default=RecurrenceType.NONE,
    )
    recurrence_interval = models.PositiveSmallIntegerField("Интервал", default=1)
    recurrence_weekdays = models.JSONField("Дни недели", default=list, blank=True)
    recurrence_until = models.DateField("Повторять до", null=True, blank=True)
    recurrence_count = models.PositiveIntegerField("Количество занятий", null=True, blank=True)
    status = models.CharField(
        "Статус",
        max_length=20,
        choices=SeriesStatus.choices,
        default=SeriesStatus.ACTIVE,
    )
    meeting_url = models.URLField("Ссылка на встречу", blank=True)
    meeting_provider = models.CharField(
        "Провайдер встречи",
        max_length=24,
        choices=MeetingProvider.choices,
        default=MeetingProvider.NONE,
    )
    format = models.CharField(
        "Формат",
        max_length=20,
        choices=ScheduleEvent.Format.choices,
        default=ScheduleEvent.Format.ONLINE,
    )
    topic = models.CharField("Тема", max_length=500, blank=True)
    teacher_comment = models.TextField("Комментарий", blank=True)
    reminder_minutes = models.PositiveSmallIntegerField(null=True, blank=True)
    notify_on_create = models.BooleanField("Уведомить при создании", default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Серия занятий"
        verbose_name_plural = "Серии занятий"
        ordering = ["-created_at"]

    def __str__(self):
        return self.title


class ScheduleEventParticipant(models.Model):
    event = models.ForeignKey(
        ScheduleEvent,
        on_delete=models.CASCADE,
        related_name="participants",
        verbose_name="Событие",
    )
    user = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="schedule_participations",
        verbose_name="Пользователь",
    )
    student = models.ForeignKey(
        Student,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="schedule_participations",
        verbose_name="Ученик",
    )
    teacher = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="schedule_organizer_participations",
        verbose_name="Учитель",
    )
    role = models.CharField(
        "Роль",
        max_length=20,
        choices=ParticipantRole.choices,
        default=ParticipantRole.STUDENT,
    )
    display_name = models.CharField("Имя", max_length=200, blank=True)
    contact_email = models.EmailField("Email", blank=True)
    vk_user_id = models.CharField("VK user id", max_length=32, blank=True)
    notification_enabled = models.BooleanField("Уведомления", default=True)
    status = models.CharField(
        "Статус",
        max_length=20,
        choices=ParticipantStatus.choices,
        default=ParticipantStatus.INVITED,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Участник занятия"
        verbose_name_plural = "Участники занятий"
        ordering = ["role", "display_name"]

    def __str__(self):
        return self.display_name or str(self.pk)


class ScheduleEventChangeLog(models.Model):
    event = models.ForeignKey(
        ScheduleEvent,
        on_delete=models.CASCADE,
        related_name="change_logs",
        verbose_name="Событие",
    )
    series = models.ForeignKey(
        ScheduleEventSeries,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="change_logs",
        verbose_name="Серия",
    )
    changed_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="schedule_changes",
        verbose_name="Изменил",
    )
    change_type = models.CharField(
        "Тип изменения",
        max_length=32,
        choices=ScheduleChangeType.choices,
    )
    old_data = models.JSONField("Было", default=dict, blank=True)
    new_data = models.JSONField("Стало", default=dict, blank=True)
    message = models.TextField("Сообщение", blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "История изменения"
        verbose_name_plural = "История изменений"
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.get_change_type_display()} — {self.event_id}"


class Notification(models.Model):
    recipient_user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="cabinet_notifications",
        verbose_name="Получатель",
    )
    recipient_student = models.ForeignKey(
        Student,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="notifications",
        verbose_name="Ученик",
    )
    recipient_teacher = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="teacher_notifications",
        verbose_name="Учитель",
    )
    channel = models.CharField(
        "Канал",
        max_length=16,
        choices=NotificationChannel.choices,
        default=NotificationChannel.IN_APP,
    )
    title = models.CharField("Заголовок", max_length=255)
    message = models.TextField("Сообщение")
    payload = models.JSONField("Данные", default=dict, blank=True)
    status = models.CharField(
        "Статус",
        max_length=16,
        choices=NotificationStatus.choices,
        default=NotificationStatus.PENDING,
    )
    is_read = models.BooleanField("Прочитано", default=False)
    error_message = models.TextField("Ошибка", blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    sent_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        verbose_name = "Уведомление"
        verbose_name_plural = "Уведомления"
        ordering = ["-created_at"]

    def __str__(self):
        return self.title


class NotificationPreference(models.Model):
    user = models.OneToOneField(
        User,
        on_delete=models.CASCADE,
        related_name="notification_preferences",
        verbose_name="Пользователь",
    )
    in_app_enabled = models.BooleanField("В кабинете", default=True)
    email_enabled = models.BooleanField("Email", default=False)
    vk_enabled = models.BooleanField("ВКонтакте", default=False)
    vk_user_id = models.CharField("VK user id", max_length=32, blank=True)
    telegram_enabled = models.BooleanField("Telegram", default=False)
    telegram_chat_id = models.CharField("Telegram chat id", max_length=64, blank=True, db_index=True)
    telegram_username = models.CharField("Telegram username", max_length=64, blank=True)
    telegram_connected_at = models.DateTimeField("Telegram подключён", null=True, blank=True)
    notify_lesson_created = models.BooleanField(default=True)
    notify_lesson_moved = models.BooleanField(default=True)
    notify_lesson_cancelled = models.BooleanField(default=True)
    notify_lesson_updated = models.BooleanField(default=True)
    notify_participants_changed = models.BooleanField(default=True)
    notify_homework = models.BooleanField("Напоминания о заданиях", default=True)
    notify_review = models.BooleanField("Уведомления о проверке", default=True)
    notify_before_lesson_minutes = models.PositiveSmallIntegerField(
        null=True,
        blank=True,
        default=15,
    )
    digest_hour = models.PositiveSmallIntegerField(
        "Час ежедневной сводки",
        default=19,
        help_text="Час локального времени (0–23) для сводки в Telegram",
    )
    # Финансовые уведомления (учёт оплат репетитора)
    notify_payment_received = models.BooleanField("Поступила оплата", default=True)
    notify_package_low = models.BooleanField("Заканчивается абонемент", default=True)
    notify_debt_created = models.BooleanField("Возникла задолженность", default=True)
    notify_billing_daily_digest = models.BooleanField("Ежедневная финансовая сводка", default=False)
    notify_billing_weekly_digest = models.BooleanField("Еженедельная финансовая сводка", default=False)
    notify_student_payment_recorded = models.BooleanField("Ученику: оплата зафиксирована", default=False)
    notify_student_package_low = models.BooleanField("Ученику: мало занятий/минут", default=False)
    notify_student_package_ended = models.BooleanField("Ученику: абонемент закончился", default=False)
    notify_student_unpaid_lesson = models.BooleanField("Ученику: неоплаченный урок", default=False)
    notify_student_payment_due = models.BooleanField("Ученику: приближается срок оплаты", default=False)
    # Журнал успеваемости
    notify_journal_results = models.BooleanField("Итоги урока опубликованы", default=True)
    notify_journal_comment = models.BooleanField("Комментарий учителя (в итогах)", default=True)
    notify_journal_recommendation = models.BooleanField("Новая рекомендация", default=True)
    notify_journal_daily_digest = models.BooleanField("Учителю: ежедневная сводка журнала", default=False)

    # Web Push (общее для учителя и ученика)
    push_enabled = models.BooleanField("Web Push", default=True)
    push_privacy_mode = models.BooleanField(
        "Приватный режим push",
        default=False,
        help_text="Не показывать суммы и чувствительные детали на экране блокировки",
    )
    # Напоминания об уроках: список минут до начала, напр. [1440, 60, 10]
    lesson_reminder_minutes = models.JSONField(
        "Интервалы напоминаний (мин)",
        default=list,
        blank=True,
        help_text="Пустой список — стандарт 24ч / 1ч / 10мин",
    )
    notify_daily_schedule = models.BooleanField("Расписание на день", default=True)
    daily_schedule_hour = models.PositiveSmallIntegerField(
        "Час утреннего расписания",
        null=True,
        blank=True,
        default=8,
        help_text="None / пусто — не отправлять; 0–23 — час локального времени",
    )
    notify_daily_schedule_empty = models.BooleanField(
        "Сообщать, что сегодня уроков нет",
        default=False,
    )
    notify_new_student = models.BooleanField("Новые ученики", default=True)
    notify_homework_resubmitted = models.BooleanField("Исправленные работы", default=True)
    notify_overdue_homework = models.BooleanField("Просроченные задания", default=True)
    notify_student_message = models.BooleanField("Сообщения учеников", default=True)
    notify_student_entered_room = models.BooleanField("Ученик вошёл в комнату", default=False)
    notify_student_absent = models.BooleanField("Ученик не подключился", default=False)
    notify_auto_check_attention = models.BooleanField("Автопроверка требует внимания", default=True)
    notify_system = models.BooleanField("Системные события", default=True)
    homework_review_push_mode = models.CharField(
        "Режим push по работам на проверку",
        max_length=16,
        default="each",
        help_text="each | digest_15 | digest_60 | in_app_only",
    )
    overdue_homework_mode = models.CharField(
        "Режим просроченных ДЗ",
        max_length=16,
        default="daily",
        help_text="immediate | daily | in_app_only | off",
    )
    dnd_enabled = models.BooleanField("Не беспокоить", default=False)
    dnd_start = models.TimeField("Не беспокоить с", null=True, blank=True)
    dnd_end = models.TimeField("Не беспокоить до", null=True, blank=True)
    dnd_allow_urgent = models.BooleanField("Срочные во время тишины", default=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Настройки уведомлений"
        verbose_name_plural = "Настройки уведомлений"
        constraints = [
            models.UniqueConstraint(
                fields=["telegram_chat_id"],
                condition=~models.Q(telegram_chat_id=""),
                name="cabinet_unique_telegram_chat_id",
            ),
        ]

    def __str__(self):
        return f"Уведомления: {self.user}"

    @property
    def telegram_connected(self) -> bool:
        return bool(self.telegram_enabled and self.telegram_chat_id)

    def effective_lesson_reminder_minutes(self) -> list[int]:
        raw = self.lesson_reminder_minutes
        if isinstance(raw, list) and raw:
            out = []
            for item in raw:
                try:
                    minutes = int(item)
                except (TypeError, ValueError):
                    continue
                if 0 < minutes <= 24 * 60 and minutes not in out:
                    out.append(minutes)
            if out:
                return sorted(out, reverse=True)
        # Стандарт: 24ч, 1ч, 10мин
        return [1440, 60, 10]


class PushSubscription(models.Model):
    """Web Push subscription bound to a user and device/browser."""

    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="push_subscriptions",
        verbose_name="Пользователь",
    )
    endpoint = models.URLField("Endpoint", max_length=512, unique=True)
    p256dh = models.CharField("p256dh", max_length=255)
    auth = models.CharField("auth", max_length=255)
    user_agent = models.CharField("User-Agent", max_length=500, blank=True)
    device_label = models.CharField("Устройство", max_length=120, blank=True)
    is_active = models.BooleanField("Активна", default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    last_seen_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        verbose_name = "Push-подписка"
        verbose_name_plural = "Push-подписки"
        ordering = ["-updated_at"]
        indexes = [
            models.Index(fields=["user", "is_active"]),
        ]

    def __str__(self):
        return f"Push {self.user_id} · {self.endpoint[:48]}"


class StudentNotifyOverride(models.Model):
    """Per-student notification refinements on top of teacher global prefs."""

    class Mode(models.TextChoices):
        ALL = "all", "Все события"
        IMPORTANT = "important_only", "Только важные"
        MUTE_OPTIONAL = "mute_optional", "Отключить необязательные"

    student = models.OneToOneField(
        Student,
        on_delete=models.CASCADE,
        related_name="notify_override",
        verbose_name="Ученик",
    )
    mode = models.CharField(
        "Режим",
        max_length=20,
        choices=Mode.choices,
        default=Mode.ALL,
    )
    # null = inherit from teacher NotificationPreference
    notify_homework = models.BooleanField("Работы на проверку", null=True, blank=True)
    notify_messages = models.BooleanField("Сообщения", null=True, blank=True)
    notify_overdue = models.BooleanField("Просроченные задания", null=True, blank=True)
    notify_billing = models.BooleanField("Оплаты", null=True, blank=True)
    notify_attendance = models.BooleanField("Посещаемость", null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Уведомления об ученике"
        verbose_name_plural = "Уведомления об учениках"

    def __str__(self):
        return f"Notify override · student {self.student_id}"


class TelegramConnectToken(models.Model):
    """Короткоживущий одноразовый токен для привязки Telegram (не путать с приглашением)."""

    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="telegram_connect_tokens",
        verbose_name="Пользователь",
    )
    token = models.CharField("Токен", max_length=64, unique=True, db_index=True)
    expires_at = models.DateTimeField("Действует до")
    used_at = models.DateTimeField("Использован", null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Токен подключения Telegram"
        verbose_name_plural = "Токены подключения Telegram"
        ordering = ["-created_at"]

    def __str__(self):
        return f"TG connect → {self.user_id}"

    @property
    def is_active(self) -> bool:
        if self.used_at is not None:
            return False
        return bool(self.expires_at and self.expires_at >= timezone.now())


class EventReminderLog(models.Model):
    event = models.ForeignKey(
        ScheduleEvent,
        on_delete=models.CASCADE,
        related_name="reminder_logs",
        verbose_name="Событие",
    )
    recipient = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="lesson_reminders",
        verbose_name="Получатель",
    )
    reminder_minutes = models.PositiveSmallIntegerField("За сколько минут")
    channel = models.CharField(
        max_length=16,
        choices=NotificationChannel.choices,
        default=NotificationChannel.IN_APP,
    )
    sent_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Лог напоминания"
        verbose_name_plural = "Логи напоминаний"
        unique_together = [("event", "recipient", "reminder_minutes", "channel")]

    def __str__(self):
        return f"Напоминание {self.event_id} → {self.recipient_id}"


# ── Тарифная система ──────────────────────────────────────────────────────────

class TariffPlan(models.Model):
    class BillingCycle(models.TextChoices):
        MONTH = "month", "Месяц"
        YEAR = "year", "Год"

    name = models.CharField("Название", max_length=100)
    slug = models.SlugField("Slug", max_length=50, unique=True)
    description = models.TextField("Описание", blank=True)
    price_month = models.DecimalField("Цена/месяц", max_digits=10, decimal_places=2, default=0)
    price_year = models.DecimalField("Цена/год", max_digits=10, decimal_places=2, default=0)
    currency = models.CharField("Валюта", max_length=8, default="RUB")
    max_students = models.PositiveIntegerField("Макс. учеников", default=5)
    max_groups = models.PositiveIntegerField("Макс. групп", default=2)
    max_lessons = models.PositiveIntegerField("Макс. уроков", default=10)
    max_interactives = models.PositiveIntegerField("Макс. интерактивов", default=5)
    ai_requests_monthly_limit = models.PositiveIntegerField("ИИ-запросы в месяц", default=10)
    max_storage_mb = models.PositiveIntegerField("Хранилище МБ", default=512)
    has_homework = models.BooleanField("Домашние задания", default=True)
    has_review = models.BooleanField("Проверка работ", default=True)
    has_basic_notifications = models.BooleanField("Базовые уведомления", default=False)
    has_advanced_notifications = models.BooleanField("Расширенные уведомления", default=False)
    has_extended_library = models.BooleanField("Расширенная библиотека", default=False)
    has_multi_teacher = models.BooleanField("Несколько учителей", default=False)
    has_team_roles = models.BooleanField("Роли в команде", default=False)
    is_active = models.BooleanField("Активен", default=True)
    is_recommended = models.BooleanField("Рекомендуемый", default=False)
    sort_order = models.PositiveSmallIntegerField("Порядок", default=0)
    created_at = models.DateTimeField("Создан", auto_now_add=True)
    updated_at = models.DateTimeField("Обновлён", auto_now=True)

    class Meta:
        verbose_name = "Тарифный план"
        verbose_name_plural = "Тарифные планы"
        ordering = ["sort_order", "price_month"]

    def __str__(self):
        return self.name


class TeacherSubscription(models.Model):
    class Status(models.TextChoices):
        ACTIVE = "active", "Активна"
        TRIAL = "trial", "Пробная"
        EXPIRED = "expired", "Истекла"
        CANCELLED = "cancelled", "Отменена"
        PENDING = "pending", "Ожидает"

    class BillingPeriod(models.TextChoices):
        MONTH = "month", "Месяц"
        YEAR = "year", "Год"

    teacher = models.OneToOneField(
        User,
        on_delete=models.CASCADE,
        related_name="subscription",
        verbose_name="Учитель",
    )
    plan = models.ForeignKey(
        TariffPlan,
        on_delete=models.PROTECT,
        related_name="subscriptions",
        verbose_name="Тарифный план",
    )
    status = models.CharField("Статус", max_length=20, choices=Status.choices, default=Status.ACTIVE)
    started_at = models.DateTimeField("Начало", auto_now_add=True)
    expires_at = models.DateTimeField("Истекает", null=True, blank=True)
    billing_period = models.CharField(
        "Период",
        max_length=10,
        choices=BillingPeriod.choices,
        default=BillingPeriod.MONTH,
    )
    auto_renew = models.BooleanField("Автопродление", default=True)
    created_at = models.DateTimeField("Создана", auto_now_add=True)
    updated_at = models.DateTimeField("Обновлена", auto_now=True)

    class Meta:
        verbose_name = "Подписка"
        verbose_name_plural = "Подписки"

    def __str__(self):
        return f"{self.teacher.username} — {self.plan.name} ({self.get_status_display()})"

    def is_valid(self):
        from django.utils import timezone as tz
        if self.status not in (self.Status.ACTIVE, self.Status.TRIAL):
            return False
        if self.expires_at and self.expires_at < tz.now():
            return False
        return True


class AIUsage(models.Model):
    teacher = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="ai_usage_records",
        verbose_name="Учитель",
    )
    period_start = models.DateField("Начало периода")
    period_end = models.DateField("Конец периода")
    used_requests = models.PositiveIntegerField("Использовано запросов", default=0)
    limit_requests = models.PositiveIntegerField("Лимит запросов", default=10)
    created_at = models.DateTimeField("Создан", auto_now_add=True)
    updated_at = models.DateTimeField("Обновлён", auto_now=True)

    class Meta:
        verbose_name = "Использование ИИ"
        verbose_name_plural = "Использование ИИ"
        unique_together = [("teacher", "period_start")]

    def __str__(self):
        return f"{self.teacher.username} {self.period_start} — {self.used_requests}/{self.limit_requests}"


class AIRequestLog(models.Model):
    class RequestStatus(models.TextChoices):
        SUCCESS = "success", "Успешно"
        FAILED = "failed", "Ошибка"
        BLOCKED = "blocked", "Заблокирован"

    teacher = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="ai_request_logs",
        verbose_name="Учитель",
    )
    request_type = models.CharField("Тип запроса", max_length=64, blank=True)
    prompt = models.TextField("Запрос", blank=True)
    result = models.TextField("Результат", blank=True)
    cost_units = models.PositiveSmallIntegerField("Стоимость (кредиты)", default=1)
    status = models.CharField("Статус", max_length=20, choices=RequestStatus.choices, default=RequestStatus.SUCCESS)
    error_message = models.TextField("Ошибка", blank=True)
    created_at = models.DateTimeField("Создан", auto_now_add=True)

    class Meta:
        verbose_name = "Лог ИИ-запроса"
        verbose_name_plural = "Логи ИИ-запросов"
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.teacher.username} [{self.get_status_display()}] {self.created_at:%Y-%m-%d %H:%M}"


class Payment(models.Model):
    class Status(models.TextChoices):
        PENDING = "pending", "Ожидает"
        PAID = "paid", "Оплачен"
        FAILED = "failed", "Ошибка"
        REFUNDED = "refunded", "Возврат"

    teacher = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="payments",
        verbose_name="Учитель",
    )
    subscription = models.ForeignKey(
        TeacherSubscription,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="payments",
        verbose_name="Подписка",
    )
    amount = models.DecimalField("Сумма", max_digits=10, decimal_places=2)
    currency = models.CharField("Валюта", max_length=8, default="RUB")
    status = models.CharField("Статус", max_length=20, choices=Status.choices, default=Status.PENDING)
    provider = models.CharField("Провайдер", max_length=50, default="mock")
    provider_payment_id = models.CharField("ID платежа провайдера", max_length=255, blank=True)
    paid_at = models.DateTimeField("Оплачен", null=True, blank=True)
    created_at = models.DateTimeField("Создан", auto_now_add=True)
    updated_at = models.DateTimeField("Обновлён", auto_now=True)

    class Meta:
        verbose_name = "Платёж"
        verbose_name_plural = "Платежи"
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.teacher.username} {self.amount} {self.currency} [{self.get_status_display()}]"


class PromoCode(models.Model):
    class DiscountType(models.TextChoices):
        PERCENT = "percent", "Скидка %"
        FIXED = "fixed", "Фиксированная скидка ₽"
        FREE_MONTHS = "free_months", "Бесплатные месяцы"

    code = models.CharField("Промокод", max_length=64, unique=True)
    discount_type = models.CharField(
        "Тип скидки", max_length=20, choices=DiscountType.choices, default=DiscountType.PERCENT
    )
    discount_value = models.DecimalField(
        "Значение скидки", max_digits=10, decimal_places=2,
        help_text="Процент (0–100), сумма ₽ или кол-во месяцев",
    )
    applicable_plans = models.ManyToManyField(
        TariffPlan,
        blank=True,
        related_name="promo_codes",
        verbose_name="Применимо к тарифам",
        help_text="Пусто — применяется ко всем тарифам",
    )
    max_uses = models.PositiveIntegerField(
        "Макс. активаций", null=True, blank=True,
        help_text="Пусто — без ограничений",
    )
    max_uses_per_user = models.PositiveSmallIntegerField("Макс. на пользователя", default=1)
    uses_count = models.PositiveIntegerField("Использован раз", default=0, editable=False)
    valid_from = models.DateTimeField("Действует с", null=True, blank=True)
    valid_until = models.DateTimeField("Действует до", null=True, blank=True)
    is_active = models.BooleanField("Активен", default=True)
    description = models.CharField("Описание (внутр.)", max_length=255, blank=True)
    created_at = models.DateTimeField("Создан", auto_now_add=True)
    updated_at = models.DateTimeField("Обновлён", auto_now=True)

    class Meta:
        verbose_name = "Промокод"
        verbose_name_plural = "Промокоды"
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.code} ({self.get_discount_type_display()}: {self.discount_value})"

    def is_valid_now(self) -> bool:
        from django.utils import timezone as tz
        if not self.is_active:
            return False
        now = tz.now()
        if self.valid_from and now < self.valid_from:
            return False
        if self.valid_until and now > self.valid_until:
            return False
        if self.max_uses is not None and self.uses_count >= self.max_uses:
            return False
        return True


class PromoCodeUsage(models.Model):
    promo_code = models.ForeignKey(
        PromoCode, on_delete=models.CASCADE, related_name="usages", verbose_name="Промокод"
    )
    teacher = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name="promo_usages", verbose_name="Учитель"
    )
    payment = models.ForeignKey(
        Payment, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="promo_usages", verbose_name="Платёж"
    )
    discount_applied = models.DecimalField(
        "Скидка применена", max_digits=10, decimal_places=2, default=0
    )
    applied_at = models.DateTimeField("Применён", auto_now_add=True)

    class Meta:
        verbose_name = "Использование промокода"
        verbose_name_plural = "Использования промокодов"
        ordering = ["-applied_at"]

    def __str__(self):
        return f"{self.promo_code.code} → {self.teacher.username} {self.applied_at:%Y-%m-%d}"


class ReferralLink(models.Model):
    code = models.CharField(
        "Код ссылки",
        max_length=64,
        unique=True,
        help_text="Используется в URL: /cabinet/login?ref=КОД",
    )
    title = models.CharField("Название", max_length=120, blank=True)
    owner = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="referral_links",
        verbose_name="Владелец",
    )
    reward_plan = models.ForeignKey(
        TariffPlan,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="referral_links",
        verbose_name="Тариф при регистрации",
        help_text="Пусто — тариф «Профи»",
    )
    reward_months = models.PositiveSmallIntegerField(
        "Месяцев подписки",
        default=3,
    )
    max_registrations = models.PositiveIntegerField(
        "Макс. регистраций",
        null=True,
        blank=True,
        help_text="Пусто — без ограничений",
    )
    registrations_count = models.PositiveIntegerField(
        "Регистраций",
        default=0,
        editable=False,
    )
    valid_from = models.DateTimeField("Действует с", null=True, blank=True)
    valid_until = models.DateTimeField("Действует до", null=True, blank=True)
    is_active = models.BooleanField("Активна", default=True)
    description = models.CharField("Описание (внутр.)", max_length=255, blank=True)
    created_at = models.DateTimeField("Создана", auto_now_add=True)
    updated_at = models.DateTimeField("Обновлена", auto_now=True)

    class Meta:
        verbose_name = "Реферальная ссылка"
        verbose_name_plural = "Реферальные ссылки"
        ordering = ["-created_at"]

    def __str__(self):
        label = self.title or self.code
        return f"{label} ({self.registrations_count} рег.)"

    def is_valid_now(self) -> bool:
        from django.utils import timezone as tz
        if not self.is_active:
            return False
        now = tz.now()
        if self.valid_from and now < self.valid_from:
            return False
        if self.valid_until and now > self.valid_until:
            return False
        if self.max_registrations is not None and self.registrations_count >= self.max_registrations:
            return False
        return True


class ReferralLinkRegistration(models.Model):
    referral_link = models.ForeignKey(
        ReferralLink,
        on_delete=models.CASCADE,
        related_name="registrations",
        verbose_name="Реферальная ссылка",
    )
    user = models.OneToOneField(
        User,
        on_delete=models.CASCADE,
        related_name="referral_registration",
        verbose_name="Пользователь",
    )
    reward_plan = models.ForeignKey(
        TariffPlan,
        on_delete=models.PROTECT,
        related_name="referral_registrations",
        verbose_name="Выданный тариф",
    )
    reward_months = models.PositiveSmallIntegerField("Выдано месяцев")
    expires_at = models.DateTimeField("Подписка до", null=True, blank=True)
    registered_at = models.DateTimeField("Зарегистрирован", auto_now_add=True)

    class Meta:
        verbose_name = "Регистрация по реферальной ссылке"
        verbose_name_plural = "Регистрации по реферальным ссылкам"
        ordering = ["-registered_at"]

    def __str__(self):
        return f"{self.referral_link.code} → {self.user.username}"


class StudentTaskHistory(models.Model):
    """Хранит, какие задачи из банка (по ID в Generator) уже выдавались ученику.
    Позволяет предупреждать учителя о повторных заданиях при выдаче варианта.
    """

    student = models.ForeignKey(
        "Student",
        on_delete=models.CASCADE,
        related_name="task_history",
        verbose_name="Ученик",
    )
    teacher = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        related_name="+",
        verbose_name="Учитель",
    )
    generator_task_id = models.IntegerField("ID задачи в банке", db_index=True)
    homework = models.ForeignKey(
        "Homework",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="task_history_entries",
        verbose_name="ДЗ",
    )
    assigned_at = models.DateTimeField("Выдано", auto_now_add=True)

    class Meta:
        verbose_name = "История выданных задач"
        verbose_name_plural = "История выданных задач"
        unique_together = [("student", "generator_task_id")]

    def __str__(self):
        return f"Ученик {self.student_id} · задача {self.generator_task_id}"


class VideoMeeting(models.Model):
    """Видеоконференция Jitsi, привязанная к событию расписания (одному уроку)."""

    class Status(models.TextChoices):
        SCHEDULED = "scheduled", "Запланирована"
        LIVE = "live", "Идёт сейчас"
        FINISHED = "finished", "Завершена"
        CANCELLED = "cancelled", "Отменена"

    uuid = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    schedule_event = models.OneToOneField(
        ScheduleEvent,
        on_delete=models.CASCADE,
        related_name="video_meeting",
        verbose_name="Урок в расписании",
    )
    room_name = models.CharField("Название комнаты", max_length=255, unique=True, editable=False)
    status = models.CharField(
        "Статус",
        max_length=20,
        choices=Status.choices,
        default=Status.SCHEDULED,
    )
    created_by = models.ForeignKey(
        User,
        on_delete=models.PROTECT,
        related_name="created_video_meetings",
        verbose_name="Создал",
    )
    actual_started_at = models.DateTimeField("Фактическое начало", null=True, blank=True)
    actual_finished_at = models.DateTimeField("Фактическое завершение", null=True, blank=True)
    # Что учитель сейчас показывает ученику (доска / вариант) — остальное скрыто.
    presented_kind = models.CharField(
        "Показанный ресурс",
        max_length=20,
        blank=True,
        default="",
        help_text="board | variant | пусто",
    )
    presented_payload = models.JSONField("Данные показанного ресурса", default=dict, blank=True)
    presented_at = models.DateTimeField("Показано в", null=True, blank=True)
    presented_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="presented_video_meetings",
        verbose_name="Показал",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Видеоконференция"
        verbose_name_plural = "Видеоконференции"
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.schedule_event_id}: {self.room_name} ({self.status})"


class MeetingAttendance(models.Model):
    """
    Сессия участия в видеоконференции.

    Повторное подключение после выхода создаёт новую сессию (left_at уже заполнен).
    Повторный join при открытой сессии (left_at is null) идемпотентно возвращает её.
    """

    meeting = models.ForeignKey(
        VideoMeeting,
        on_delete=models.CASCADE,
        related_name="attendance_sessions",
        verbose_name="Конференция",
    )
    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="meeting_attendance_sessions",
        verbose_name="Пользователь",
    )
    joined_at = models.DateTimeField("Вход")
    left_at = models.DateTimeField("Выход", null=True, blank=True)
    duration_seconds = models.PositiveIntegerField("Длительность (сек)", default=0)
    jitsi_participant_id = models.CharField("Jitsi participant id", max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Посещаемость видеоконференции"
        verbose_name_plural = "Посещаемость видеоконференций"
        ordering = ["-joined_at"]
        indexes = [
            models.Index(fields=["meeting", "user", "left_at"]),
        ]

    def __str__(self):
        return f"{self.user_id} @ {self.meeting_id} ({self.joined_at})"


def empty_board_scene():
    return {"elements": [], "appState": {}, "files": {}}


class InteractiveBoard(models.Model):
    """Интерактивная доска Excalidraw для кабинета учителя."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    title = models.CharField("Название", max_length=255, default="Новая доска")
    description = models.TextField("Описание", blank=True)

    owner = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="interactive_boards",
        verbose_name="Владелец",
    )

    group = models.ForeignKey(
        StudentGroup,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="interactive_boards",
        verbose_name="Группа",
    )
    student = models.ForeignKey(
        Student,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="interactive_boards",
        verbose_name="Ученик",
    )
    lesson = models.ForeignKey(
        Lesson,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="interactive_boards",
        verbose_name="Урок",
    )
    schedule_event = models.ForeignKey(
        "ScheduleEvent",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="interactive_boards",
        verbose_name="Событие расписания",
    )

    scene_data = models.JSONField("Данные сцены", default=empty_board_scene)
    thumbnail = models.TextField("Превью", blank=True)
    allow_export = models.BooleanField("Разрешить экспорт зрителям", default=True)
    version = models.PositiveIntegerField("Версия", default=1)

    is_archived = models.BooleanField("В архиве", default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Интерактивная доска"
        verbose_name_plural = "Интерактивные доски"
        ordering = ["-updated_at"]
        indexes = [
            models.Index(fields=["owner", "-updated_at"]),
            models.Index(fields=["group"]),
            models.Index(fields=["student"]),
            models.Index(fields=["lesson"]),
            models.Index(fields=["schedule_event"]),
        ]

    def __str__(self):
        return self.title or "Доска"

    def is_linked_student_user(self, user) -> bool:
        """True, если user — аккаунт ученика, к которому привязана доска."""
        if user is None or not getattr(user, "is_authenticated", False):
            return False
        if not self.student_id:
            return False
        student = self.student
        return bool(student and student.user_id == user.id)

    def get_permission_for(self, user) -> str | None:
        """Возвращает 'owner' | 'edit' | 'view' | None."""
        if user is None or not user.is_authenticated:
            return None
        if self.owner_id == user.id:
            return "owner"

        # Привязанный ученик всегда может совместно редактировать доску.
        if self.is_linked_student_user(user):
            return InteractiveBoardAccess.EDIT

        access = self.access_records.filter(user=user).first()
        if access:
            return access.permission

        if self.group_id and self.group:
            roster = Student.objects.filter(user=user, groups=self.group).exists()
            if roster:
                return InteractiveBoardAccess.VIEW

        return None


class InteractiveBoardAccess(models.Model):
    VIEW = "view"
    EDIT = "edit"

    PERMISSION_CHOICES = [
        (VIEW, "Просмотр"),
        (EDIT, "Редактирование"),
    ]

    board = models.ForeignKey(
        InteractiveBoard,
        on_delete=models.CASCADE,
        related_name="access_records",
        verbose_name="Доска",
    )
    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="interactive_board_access",
        verbose_name="Пользователь",
    )
    permission = models.CharField(
        "Право",
        max_length=10,
        choices=PERMISSION_CHOICES,
        default=VIEW,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Доступ к интерактивной доске"
        verbose_name_plural = "Доступы к интерактивным доскам"
        constraints = [
            models.UniqueConstraint(
                fields=["board", "user"],
                name="unique_interactive_board_user_access",
            ),
        ]

    def __str__(self):
        return f"{self.user_id} → {self.board_id} ({self.permission})"


class InteractiveBoardAsset(models.Model):
    """Крупные изображения доски, вынесенные в media storage."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    board = models.ForeignKey(
        InteractiveBoard,
        on_delete=models.CASCADE,
        related_name="assets",
        verbose_name="Доска",
    )
    file = models.FileField("Файл", upload_to="cabinet/boards/%Y/%m/")
    mime_type = models.CharField("MIME-тип", max_length=64, blank=True)
    original_name = models.CharField("Исходное имя", max_length=255, blank=True)
    size_bytes = models.PositiveIntegerField("Размер", default=0)
    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="uploaded_board_assets",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Файл интерактивной доски"
        verbose_name_plural = "Файлы интерактивных досок"
        ordering = ["-created_at"]

    def __str__(self):
        return self.original_name or str(self.id)


class TeacherApplication(models.Model):
    """Заявка со страницы «Для учителей» (legacy-форма авторского участия)."""

    class Status(models.TextChoices):
        NEW = "new", "Новая"
        IN_PROGRESS = "in_progress", "В работе"
        DONE = "done", "Обработана"
        SPAM = "spam", "Спам"

    name = models.CharField("Имя", max_length=200)
    contact = models.CharField("Контакт", max_length=255)
    role = models.CharField("Кто вы", max_length=64, blank=True)
    teaches = models.CharField("Чему учите", max_length=500, blank=True)
    help_topics = models.JSONField("Чем можете помочь", default=list, blank=True)
    comment = models.TextField("Комментарий", blank=True)
    materials_url = models.URLField("Ссылка на материалы", blank=True, max_length=500)
    status = models.CharField(
        "Статус",
        max_length=20,
        choices=Status.choices,
        default=Status.NEW,
    )
    ip_address = models.GenericIPAddressField("IP", null=True, blank=True)
    user_agent = models.CharField("User-Agent", max_length=512, blank=True)
    created_at = models.DateTimeField("Создана", auto_now_add=True)
    updated_at = models.DateTimeField("Обновлена", auto_now=True)

    class Meta:
        verbose_name = "Заявка учителя"
        verbose_name_plural = "Заявки учителей"
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.name} — {self.contact}"


class TeacherCommunityFeedback(models.Model):
    """Обращение со страницы сообщества учителей."""

    class FeedbackType(models.TextChoices):
        REVIEW = "review", "Отзыв о платформе"
        FEATURE = "feature", "Предложение новой функции"
        BUG = "bug", "Сообщение об ошибке"
        TESTING = "testing", "Участие в тестировании"
        DEVELOPMENT = "development", "Хочу помочь с разработкой"
        METHODOLOGY = "methodology", "Методическое сотрудничество"
        OTHER = "other", "Другое"

    class Status(models.TextChoices):
        NEW = "new", "Новое"
        REVIEWED = "reviewed", "Просмотрено"
        PLANNED = "planned", "В планах"
        COMPLETED = "completed", "Выполнено"
        DECLINED = "declined", "Отклонено"

    feedback_type = models.CharField(
        "Тип обращения",
        max_length=32,
        choices=FeedbackType.choices,
    )
    name = models.CharField("Имя", max_length=200, blank=True)
    contact = models.CharField("Контакт", max_length=255, blank=True)
    subject_area = models.CharField("Предмет / направление", max_length=200, blank=True)
    message = models.TextField("Сообщение")
    user = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="teacher_community_feedback",
        verbose_name="Пользователь",
    )
    consent_given = models.BooleanField("Согласие на обработку данных", default=False)
    status = models.CharField(
        "Статус",
        max_length=20,
        choices=Status.choices,
        default=Status.NEW,
    )
    ip_address = models.GenericIPAddressField("IP", null=True, blank=True)
    user_agent = models.CharField("User-Agent", max_length=512, blank=True)
    created_at = models.DateTimeField("Создано", auto_now_add=True)
    updated_at = models.DateTimeField("Обновлено", auto_now=True)

    class Meta:
        verbose_name = "Обращение сообщества учителей"
        verbose_name_plural = "Обращения сообщества учителей"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["feedback_type", "status"]),
            models.Index(fields=["-created_at"]),
        ]

    def __str__(self):
        label = self.get_feedback_type_display()
        who = self.name or self.contact or "аноним"
        return f"{label} — {who}"


# ── Учёт оплат репетитора (см. billing_models.py; не SaaS Payment) ────────────
from .billing_models import (  # noqa: E402
    BillingAccount,
    BillingAuditLog,
    BillingTransaction,
    BillingType,
    DeliveryStatus,
    EventBillingRecord,
    FinancialStatus,
    LateCancelRule,
    LessonPackage,
    MonthlyBillingPeriod,
    PackageBalanceCheckMode,
    PackageStatus,
    PackageUnitType,
    PaymentMethod,
    PaymentReminderLog,
    PriceSource,
    StudentBillingSettings,
    StudentPayment,
    StudentPaymentAllocation,
    StudentPaymentStatus,
    TeacherBillingSettings,
    TeacherPriceRule,
    TransactionType,
)

# ── Журнал успеваемости (см. journal_models.py) ───────────────────────────────
from .journal_models import (  # noqa: E402
    AssessmentCriterion,
    AssessmentTemplate,
    AssessmentTemplateCriterion,
    AttendanceStatus,
    JournalAttentionMarker,
    JournalAuditLog,
    JournalEditLock,
    JournalStatus,
    JournalTag,
    JournalTeacherSettings,
    LessonJournal,
    OverallScoreMode,
    RecordPublishStatus,
    StudentCriterionScore,
    StudentLessonRecord,
    StudentLessonRecordTag,
)

# ── Личное файловое хранилище (см. files_models.py) ───────────────────────────
from .files_models import (  # noqa: E402
    CabinetFile,
    CabinetFileAuditAction,
    CabinetFileAuditLog,
    CabinetFilePermission,
    CabinetFilePermissionLevel,
    CabinetFileRelation,
    CabinetFileRelationType,
    CabinetFileStatus,
    CabinetFileVersion,
    CabinetFolder,
    UserStorageQuota,
)

# ── Синхронные материалы видеоурока (см. meeting_material_models.py) ──────────
from .meeting_material_models import (  # noqa: E402
    MeetingMaterialCollaborativeScope,
    MeetingMaterialInteractionMode,
    MeetingMaterialSession,
    MeetingMaterialWork,
)
