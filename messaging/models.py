import uuid

from django.conf import settings
from django.db import models

from .retention import (
    KIND_ACCESS_LOGS,
    KIND_ATTACHMENTS,
    KIND_AUDIT_LOGS,
    KIND_CONSENT_EVIDENCE,
    KIND_CONSENT_LOGS,
    KIND_DELIVERY_METADATA,
    KIND_MESSAGE_CONTENT,
    KIND_MESSAGE_METADATA,
)


class Conversation(models.Model):
    class Kind(models.TextChoices):
        SUPPORT = "support", "Поддержка"
        PLATFORM = "platform", "От разработчика"
        DIRECT = "direct", "Личный"
        COMMUNITY = "community", "Сообщество"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    subject_user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="messaging_conversations",
    )
    kind = models.CharField(max_length=16, choices=Kind.choices)
    # Каноническая пара для личного диалога: меньший id, затем больший. Пусто у служебных.
    pair_key = models.CharField(max_length=64, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Диалог"
        verbose_name_plural = "Диалоги"
        constraints = [
            models.UniqueConstraint(
                fields=["subject_user", "kind"],
                condition=models.Q(kind__in=["support", "platform"]),
                name="messaging_conversation_official_subject_kind",
            ),
            models.UniqueConstraint(
                fields=["pair_key"],
                condition=~models.Q(pair_key=""),
                name="messaging_conversation_direct_pair",
            ),
        ]
        permissions = [
            ("support", "Отвечать в поддержке и вести обращения"),
            ("broadcast", "Запускать массовые рассылки"),
            ("manage", "Администрировать сообщения"),
        ]

    def __str__(self):
        return f"{self.get_kind_display()} · {self.subject_user_id}"


class ConversationParticipant(models.Model):
    class Role(models.TextChoices):
        OWNER = "owner", "Владелец"
        STAFF = "staff", "Сотрудник"

    conversation = models.ForeignKey(
        Conversation,
        on_delete=models.CASCADE,
        related_name="participants",
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="messaging_participations",
    )
    participant_role = models.CharField(max_length=16, choices=Role.choices)
    hidden_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["conversation", "user"],
                name="messaging_participant_conversation_user",
            ),
        ]


class ConversationReadState(models.Model):
    """Курсор доставки и прочтения. Не набор boolean на каждое сообщение."""

    conversation = models.ForeignKey(
        Conversation,
        on_delete=models.CASCADE,
        related_name="read_states",
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="messaging_read_states",
    )
    last_read_message_id = models.PositiveBigIntegerField(null=True, blank=True)
    last_read_at = models.DateTimeField(null=True, blank=True)
    last_delivered_message_id = models.PositiveBigIntegerField(null=True, blank=True)
    last_delivered_at = models.DateTimeField(null=True, blank=True)
    retention_until = models.DateTimeField(null=True, blank=True)
    retention_policy_kind = models.CharField(
        max_length=64,
        default=KIND_DELIVERY_METADATA,
    )

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["conversation", "user"],
                name="messaging_read_state_conversation_user",
            ),
        ]


class SupportTicket(models.Model):
    class Category(models.TextChoices):
        TECHNICAL = "technical", "Техническая проблема"
        BILLING = "billing", "Оплата и тариф"
        MATERIALS = "materials", "Материалы и задания"
        LESSON = "lesson", "Проведение урока"
        ACCOUNT = "account", "Аккаунт"
        SUGGESTION = "suggestion", "Предложение"
        OTHER = "other", "Другое"

    class Status(models.TextChoices):
        NEW = "new", "Новое"
        IN_PROGRESS = "in_progress", "В работе"
        WAITING_USER = "waiting_user", "Ждём ответа пользователя"
        RESOLVED = "resolved", "Решено"

    class Priority(models.TextChoices):
        NORMAL = "normal", "Обычный"
        IMPORTANT = "important", "Важный"
        URGENT = "urgent", "Срочный"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    conversation = models.ForeignKey(
        Conversation,
        on_delete=models.CASCADE,
        related_name="tickets",
    )
    category = models.CharField(max_length=32, choices=Category.choices)
    subject = models.CharField(max_length=200)
    status = models.CharField(max_length=32, choices=Status.choices, default=Status.NEW)
    priority = models.CharField(max_length=16, choices=Priority.choices, default=Priority.NORMAL)
    assigned_to = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="assigned_support_tickets",
    )
    technical_context = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    closed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["status", "assigned_to", "updated_at"]),
        ]


class Message(models.Model):
    class SenderType(models.TextChoices):
        USER = "user", "Пользователь"
        STAFF = "staff", "Сотрудник"
        SYSTEM = "system", "Система"

    class MessageType(models.TextChoices):
        MESSAGE = "message", "Сообщение"
        INTERNAL_NOTE = "internal_note", "Внутренняя заметка"
        SYSTEM_EVENT = "system_event", "Системное событие"

    conversation = models.ForeignKey(
        Conversation,
        on_delete=models.CASCADE,
        related_name="messages",
    )
    ticket = models.ForeignKey(
        SupportTicket,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="messages",
    )
    sender = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="messaging_messages",
    )
    sender_type = models.CharField(max_length=16, choices=SenderType.choices)
    message_type = models.CharField(
        max_length=32,
        choices=MessageType.choices,
        default=MessageType.MESSAGE,
    )
    purpose = models.CharField(max_length=32, blank=True)
    text = models.TextField(blank=True)
    reply_to = models.ForeignKey(
        "self",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="replies",
    )
    client_message_id = models.CharField(max_length=64, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    edited_at = models.DateTimeField(null=True, blank=True)
    deleted_at = models.DateTimeField(null=True, blank=True)
    metadata = models.JSONField(default=dict, blank=True)
    content_retention_until = models.DateTimeField(null=True, blank=True)
    content_retention_kind = models.CharField(max_length=64, default=KIND_MESSAGE_CONTENT)
    metadata_retention_until = models.DateTimeField(null=True, blank=True)
    metadata_retention_kind = models.CharField(max_length=64, default=KIND_MESSAGE_METADATA)
    legal_hold = models.BooleanField(default=False)
    archived_at = models.DateTimeField(null=True, blank=True)
    anonymized_at = models.DateTimeField(null=True, blank=True)
    # Связь с будущей рассылкой без таблицы Broadcast на этом этапе.
    broadcast_key = models.CharField(max_length=64, blank=True)
    reply_disabled = models.BooleanField(default=False)
    is_important = models.BooleanField(default=False)
    pinned_at = models.DateTimeField(null=True, blank=True)
    button_text = models.CharField(max_length=80, blank=True)
    button_route = models.CharField(max_length=300, blank=True)
    display_mode = models.CharField(max_length=32, blank=True)

    class Meta:
        ordering = ["id"]
        indexes = [
            models.Index(fields=["conversation", "id"]),
            models.Index(fields=["conversation", "created_at"]),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["conversation", "client_message_id"],
                condition=~models.Q(client_message_id=""),
                name="messaging_message_client_id_unique",
            ),
        ]


class MessageRevision(models.Model):
    message = models.ForeignKey(Message, on_delete=models.CASCADE, related_name="revisions")
    text = models.TextField(blank=True)
    editor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="messaging_revisions",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["id"]


class MessageAttachment(models.Model):
    class ScanStatus(models.TextChoices):
        UNSCANNED = "unscanned", "Не проверен антивирусом"
        SCANNING = "scanning", "Проверяется"
        CLEAN = "clean", "Проверен антивирусом"
        REJECTED = "rejected", "Отклонён проверкой"
        SCAN_FAILED = "scan_failed", "Проверка не выполнена"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    message = models.ForeignKey(
        Message,
        on_delete=models.CASCADE,
        related_name="attachments",
    )
    conversation = models.ForeignKey(
        Conversation,
        on_delete=models.CASCADE,
        related_name="attachments",
    )
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="messaging_attachments",
    )
    original_name = models.CharField(max_length=255)
    mime_type = models.CharField(max_length=127)
    size = models.PositiveIntegerField()
    storage_key = models.CharField(max_length=300, unique=True)
    scan_status = models.CharField(
        max_length=16,
        choices=ScanStatus.choices,
        default=ScanStatus.UNSCANNED,
    )
    checksum = models.CharField(max_length=64, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    retention_until = models.DateTimeField(null=True, blank=True)
    retention_policy_kind = models.CharField(max_length=64, default=KIND_ATTACHMENTS)
    legal_hold = models.BooleanField(default=False)


class RetentionPolicy(models.Model):
    object_kind = models.CharField(max_length=64, unique=True)
    retain_days = models.PositiveIntegerField(null=True, blank=True)
    note = models.CharField(max_length=300, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Срок хранения"
        verbose_name_plural = "Сроки хранения"


class UserConsent(models.Model):
    """Текущее согласие канала. История живёт в UserConsentLog."""

    class Channel(models.TextChoices):
        EMAIL = "email_marketing", "Email"
        INAPP = "inapp_marketing", "Сообщения платформы"
        PERSONAL = "personal_data", "Обработка персональных данных"

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="messaging_consents",
    )
    channel = models.CharField(max_length=32, choices=Channel.choices)
    granted = models.BooleanField(default=False)
    consented_at = models.DateTimeField(null=True, blank=True)
    revoked_at = models.DateTimeField(null=True, blank=True)
    consent_text_version = models.CharField(max_length=64, blank=True)
    text_sha256 = models.CharField(max_length=64, blank=True)
    source = models.CharField(max_length=64, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["user", "channel"], name="messaging_consent_user_channel"),
        ]


class UserConsentLog(models.Model):
    class Action(models.TextChoices):
        GRANTED = "granted", "Выдано"
        REVOKED = "revoked", "Отозвано"

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="messaging_consent_logs",
    )
    consent_type = models.CharField(max_length=64)
    channel = models.CharField(max_length=32)
    action = models.CharField(max_length=16, choices=Action.choices)
    consent_text_version = models.CharField(max_length=64)
    text_sha256 = models.CharField(max_length=64)
    source = models.CharField(max_length=64)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.CharField(max_length=300, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    log_retention_until = models.DateTimeField(null=True, blank=True)
    log_retention_kind = models.CharField(max_length=64, default=KIND_CONSENT_LOGS)
    evidence_retention_until = models.DateTimeField(null=True, blank=True)
    evidence_retention_kind = models.CharField(max_length=64, default=KIND_CONSENT_EVIDENCE)

    class Meta:
        ordering = ["id"]


class ConsentPromptState(models.Model):
    """Факт показа и выбора на экране. Не является согласием."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="messaging_prompt_states",
    )
    prompt_key = models.CharField(max_length=64)
    shown_at = models.DateTimeField()
    decided_at = models.DateTimeField(null=True, blank=True)
    consent_text_version = models.CharField(max_length=64)
    text_sha256 = models.CharField(max_length=64)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["user", "prompt_key"],
                name="messaging_prompt_user_key",
            ),
        ]


class MessagingAuditLog(models.Model):
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="messaging_audit_actions",
    )
    action = models.CharField(max_length=64)
    object_kind = models.CharField(max_length=64)
    object_id = models.CharField(max_length=64, blank=True)
    meta = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    retention_until = models.DateTimeField(null=True, blank=True)
    retention_policy_kind = models.CharField(max_length=64, default=KIND_AUDIT_LOGS)

    class Meta:
        ordering = ["-id"]


class MessagingAccessLog(models.Model):
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="messaging_access_logs",
    )
    conversation = models.ForeignKey(
        Conversation,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="access_logs",
    )
    attachment_id = models.UUIDField(null=True, blank=True)
    action = models.CharField(max_length=64)
    created_at = models.DateTimeField(auto_now_add=True)
    retention_until = models.DateTimeField(null=True, blank=True)
    retention_policy_kind = models.CharField(max_length=64, default=KIND_ACCESS_LOGS)

    class Meta:
        ordering = ["-id"]


class Community(models.Model):
    """Закрытый групповой чат преподавателей. Создаётся администратором, не каталогом."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    conversation = models.OneToOneField(
        Conversation,
        on_delete=models.CASCADE,
        related_name="community",
    )
    name = models.CharField(max_length=120)
    slug = models.SlugField(max_length=140, unique=True, allow_unicode=True)
    description = models.TextField(blank=True)
    subject = models.CharField(max_length=80, blank=True)
    icon = models.CharField(max_length=16, blank=True)
    image_key = models.CharField(max_length=300, blank=True)
    is_active = models.BooleanField(default=True)
    is_archived = models.BooleanField(default=False)
    messages_enabled = models.BooleanField(default=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="created_communities",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class CommunityMember(models.Model):
    class Role(models.TextChoices):
        ADMIN = "admin", "Администратор"
        MODERATOR = "moderator", "Модератор"
        MEMBER = "member", "Участник"

    class Notifications(models.TextChoices):
        ALL = "all", "Все сообщения"
        MENTIONS = "mentions", "Только упоминания"
        OFF = "off", "Выключены"

    community = models.ForeignKey(Community, on_delete=models.CASCADE, related_name="members")
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="community_memberships",
    )
    role = models.CharField(max_length=16, choices=Role.choices, default=Role.MEMBER)
    joined_at = models.DateTimeField(auto_now_add=True)
    left_at = models.DateTimeField(null=True, blank=True)
    is_muted = models.BooleanField(default=False)
    muted_until = models.DateTimeField(null=True, blank=True)
    notifications_mode = models.CharField(
        max_length=16,
        choices=Notifications.choices,
        default=Notifications.ALL,
    )
    notifications_muted_until = models.DateTimeField(null=True, blank=True)
    last_read_message_id = models.PositiveBigIntegerField(null=True, blank=True)
    is_banned = models.BooleanField(default=False)
    banned_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["community", "user"],
                name="messaging_community_member_unique",
            ),
        ]


class CommunityInvite(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    community = models.ForeignKey(Community, on_delete=models.CASCADE, related_name="invites")
    token = models.CharField(max_length=64, unique=True)
    invited_user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="community_invites",
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="community_invites_created",
    )
    expires_at = models.DateTimeField(null=True, blank=True)
    max_uses = models.PositiveIntegerField(null=True, blank=True)
    uses_count = models.PositiveIntegerField(default=0)
    is_active = models.BooleanField(default=True)
    declined_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]


class MessageReaction(models.Model):
    message = models.ForeignKey(Message, on_delete=models.CASCADE, related_name="reactions")
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="message_reactions",
    )
    emoji = models.CharField(max_length=8)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["message", "user", "emoji"],
                name="messaging_reaction_unique",
            ),
        ]


class MessageMention(models.Model):
    message = models.ForeignKey(Message, on_delete=models.CASCADE, related_name="mentions")
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="message_mentions",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["message", "user"],
                name="messaging_mention_unique",
            ),
        ]


class CommunityReport(models.Model):
    class Reason(models.TextChoices):
        SPAM = "spam", "Спам"
        INSULT = "insult", "Оскорбление"
        INAPPROPRIATE = "inappropriate", "Неподходящий контент"
        OTHER = "other", "Другое"

    community = models.ForeignKey(Community, on_delete=models.CASCADE, related_name="reports")
    message = models.ForeignKey(Message, on_delete=models.CASCADE, related_name="reports")
    reporter = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="community_reports",
    )
    reason = models.CharField(max_length=32, choices=Reason.choices)
    comment = models.CharField(max_length=500, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    reviewed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-id"]
