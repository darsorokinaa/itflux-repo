"""Управленческий учёт оплат репетитора (не SaaS Payment/TariffPlan)."""

from __future__ import annotations

import uuid

from django.conf import settings
from django.db import models


class BillingType(models.TextChoices):
    PER_LESSON = "per_lesson", "За урок"
    PER_MINUTE = "per_minute", "За минуту"
    PER_HOUR = "per_hour", "Почасовая"
    PACKAGE_LESSONS = "package_lessons", "Абонемент (уроки)"
    PACKAGE_MINUTES = "package_minutes", "Абонемент (минуты)"
    MONTHLY_FIXED = "monthly_fixed", "Фикс за месяц"
    MANUAL = "manual", "Вручную"


class PackageUnitType(models.TextChoices):
    LESSON = "lesson", "Уроки"
    MINUTE = "minute", "Минуты"


class PackageStatus(models.TextChoices):
    DRAFT = "draft", "Черновик"
    ACTIVE = "active", "Активен"
    EXHAUSTED = "exhausted", "Исчерпан"
    EXPIRED = "expired", "Истёк"
    FROZEN = "frozen", "Заморожен"
    CANCELLED = "cancelled", "Отменён"


class DeliveryStatus(models.TextChoices):
    PLANNED = "planned", "Запланирован"
    CONDUCTED = "conducted", "Проведён"
    NO_SHOW = "no_show", "Ученик отсутствовал"
    CANCELLED_BY_STUDENT = "cancelled_by_student", "Отменён учеником"
    CANCELLED_BY_TEACHER = "cancelled_by_teacher", "Отменён учителем"
    RESCHEDULED = "rescheduled", "Перенесён"


class FinancialStatus(models.TextChoices):
    NOT_SPECIFIED = "not_specified", "Финансовые данные не указаны"
    NOT_CHARGED = "not_charged", "Не начислен"
    AWAITING_PAYMENT = "awaiting_payment", "Ожидает оплаты"
    PARTIALLY_PAID = "partially_paid", "Частично оплачен"
    PAID = "paid", "Оплачен"
    PAID_FROM_PACKAGE = "paid_from_package", "Оплачен из абонемента"
    NOT_BILLABLE = "not_billable", "Не подлежит оплате"
    REFUNDED = "refunded", "Возвращён"
    NEEDS_DECISION = "needs_decision", "Требует решения"


class PriceSource(models.TextChoices):
    LESSON_OVERRIDE = "lesson_override", "Индивидуальная цена урока"
    STUDENT_SUBJECT = "student_subject", "Цена ученика по предмету"
    STUDENT_DEFAULT = "student_default", "Индивидуальная цена ученика"
    GROUP = "group", "Цена группы"
    SERVICE_RULE = "service_rule", "Цена услуги / типа"
    TEACHER_DEFAULT = "teacher_default", "Общая цена учителя"
    MANUAL = "manual", "Задано вручную"
    FREE_TRIAL = "free_trial", "Бесплатный / пробный"
    PACKAGE = "package", "Абонемент"
    MONTHLY = "monthly", "Включено в месячный тариф"


class TransactionType(models.TextChoices):
    PAYMENT = "payment", "Оплата"
    CHARGE = "charge", "Начисление"
    PACKAGE_PURCHASE = "package_purchase", "Покупка абонемента"
    PACKAGE_CONSUMPTION = "package_consumption", "Списание абонемента"
    PACKAGE_RETURN = "package_return", "Возврат единиц абонемента"
    REFUND = "refund", "Возврат денег"
    DISCOUNT = "discount", "Скидка"
    ADJUSTMENT = "adjustment", "Корректировка"
    WRITE_OFF = "write_off", "Списание"


class PaymentMethod(models.TextChoices):
    TRANSFER = "transfer", "Перевод"
    CASH = "cash", "Наличные"
    CARD = "card", "Банковская карта"
    SBP = "sbp", "СБП"
    OTHER = "other", "Другое"


class StudentPaymentStatus(models.TextChoices):
    DRAFT = "draft", "Черновик"
    CONFIRMED = "confirmed", "Подтверждён"
    CANCELLED = "cancelled", "Отменён"
    REFUNDED = "refunded", "Возвращён"
    PARTIALLY_REFUNDED = "partially_refunded", "Частично возвращён"


class PackageBalanceCheckMode(models.TextChoices):
    WARN = "warn", "Только предупреждать"
    BLOCK = "block", "Запрещать при нулевом остатке"
    OFF = "off", "Не проверять"


class LateCancelRule(models.TextChoices):
    NO_CHARGE = "no_charge", "Не списывать"
    FULL = "full", "Списывать полностью"
    PERCENT = "percent", "Списывать процент"


class TeacherBillingSettings(models.Model):
    teacher = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="billing_settings",
        verbose_name="Учитель",
    )
    currency = models.CharField("Валюта", max_length=3, default="RUB")
    default_billing_type = models.CharField(
        max_length=32,
        choices=BillingType.choices,
        default=BillingType.PER_LESSON,
    )
    default_lesson_duration_minutes = models.PositiveIntegerField(default=60)
    default_lesson_price = models.DecimalField(
        max_digits=12, decimal_places=2, null=True, blank=True
    )
    hourly_rate = models.DecimalField(
        max_digits=12, decimal_places=2, null=True, blank=True
    )
    late_cancel_rule = models.CharField(
        max_length=16,
        choices=LateCancelRule.choices,
        default=LateCancelRule.FULL,
    )
    late_cancel_hours = models.PositiveIntegerField(default=24)
    late_cancel_percent = models.DecimalField(
        max_digits=5, decimal_places=2, default=100
    )
    no_show_charge = models.BooleanField(default=True)
    teacher_cancel_return_package = models.BooleanField(default=True)
    auto_charge_after_lesson = models.BooleanField(default=False)
    auto_use_package = models.BooleanField(default=True)
    allow_negative_balance = models.BooleanField(default=True)
    warn_low_balance = models.BooleanField(default=True)
    low_balance_threshold_lessons = models.PositiveIntegerField(null=True, blank=True, default=2)
    low_balance_threshold_minutes = models.PositiveIntegerField(null=True, blank=True, default=120)
    package_balance_check = models.CharField(
        max_length=8,
        choices=PackageBalanceCheckMode.choices,
        default=PackageBalanceCheckMode.WARN,
    )
    show_billing_to_student = models.BooleanField(default=False)
    allow_student_history = models.BooleanField(default=False)
    digest_weekday = models.PositiveSmallIntegerField(
        default=0,
        help_text="0=пн … 6=вс для еженедельной сводки",
    )
    reminder_cooldown_hours = models.PositiveIntegerField(default=48)
    reminder_template = models.TextField(
        blank=True,
        default=(
            "Напоминание об оплате\n\n"
            "Не оплачены занятия на сумму {amount} {currency}.\n"
            "{details}\n\n"
            "Итого: {amount} {currency}"
        ),
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Настройки оплат учителя"
        verbose_name_plural = "Настройки оплат учителей"

    def __str__(self):
        return f"Billing settings: {self.teacher_id}"


class BillingAccount(models.Model):
    teacher = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="billing_accounts",
        verbose_name="Учитель",
    )
    student = models.ForeignKey(
        "Cabinet.Student",
        on_delete=models.CASCADE,
        related_name="billing_accounts",
        verbose_name="Ученик",
    )
    payer_user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="payer_billing_accounts",
        verbose_name="Аккаунт плательщика",
    )
    payer_name = models.CharField(max_length=255, blank=True)
    payer_phone = models.CharField(max_length=50, blank=True)
    payer_email = models.EmailField(blank=True)
    currency = models.CharField(max_length=3, default="RUB")
    notes = models.TextField(blank=True)
    student_billing_notifications = models.BooleanField(
        default=False,
        help_text="Разрешить финансовые Telegram/уведомления ученику",
    )
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Биллинг-аккаунт"
        verbose_name_plural = "Биллинг-аккаунты"
        constraints = [
            models.UniqueConstraint(
                fields=["teacher", "student"],
                name="cabinet_unique_billing_account_teacher_student",
            ),
        ]
        indexes = [
            models.Index(fields=["teacher", "is_active"]),
        ]

    def __str__(self):
        return f"BillingAccount t={self.teacher_id} s={self.student_id}"


class StudentBillingSettings(models.Model):
    billing_account = models.OneToOneField(
        BillingAccount,
        on_delete=models.CASCADE,
        related_name="settings",
    )
    billing_type = models.CharField(
        max_length=32,
        choices=BillingType.choices,
        default=BillingType.PER_LESSON,
    )
    default_lesson_duration_minutes = models.PositiveIntegerField(default=60)
    default_lesson_price = models.DecimalField(
        max_digits=12, decimal_places=2, null=True, blank=True
    )
    hourly_rate = models.DecimalField(
        max_digits=12, decimal_places=2, null=True, blank=True
    )
    per_minute_rate = models.DecimalField(
        max_digits=12, decimal_places=2, null=True, blank=True
    )
    monthly_fee = models.DecimalField(
        max_digits=12, decimal_places=2, null=True, blank=True
    )
    monthly_charge_day = models.PositiveSmallIntegerField(default=1)
    monthly_includes_all_lessons = models.BooleanField(default=True)
    monthly_max_lessons = models.PositiveIntegerField(null=True, blank=True)
    monthly_charge_no_shows = models.BooleanField(default=False)
    monthly_rollover_unused = models.BooleanField(default=False)
    monthly_extra_lesson_price = models.DecimalField(
        max_digits=12, decimal_places=2, null=True, blank=True
    )
    subject_prices = models.JSONField(
        default=dict,
        blank=True,
        help_text='{"oge": "1600", "ege": "1800"}',
    )
    group_lesson_price = models.DecimalField(
        max_digits=12, decimal_places=2, null=True, blank=True
    )
    duration_lesson_coefficients = models.JSONField(
        default=dict,
        blank=True,
        help_text='{"30": "0.5", "60": "1", "90": "1.5"}',
    )
    charge_late_cancellation = models.BooleanField(default=True)
    charge_no_show = models.BooleanField(default=True)
    low_balance_threshold_minutes = models.PositiveIntegerField(null=True, blank=True)
    low_balance_threshold_lessons = models.PositiveIntegerField(null=True, blank=True)
    use_actual_duration_for_package = models.BooleanField(
        default=True,
        help_text="Для минутного абонемента списывать фактическую длительность",
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Тариф ученика"
        verbose_name_plural = "Тарифы учеников"

    def __str__(self):
        return f"StudentBillingSettings ba={self.billing_account_id}"


class TeacherPriceRule(models.Model):
    class Audience(models.TextChoices):
        INDIVIDUAL = "individual", "Индивидуальное"
        GROUP = "group", "Групповое"
        ANY = "any", "Любое"

    teacher = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="price_rules",
    )
    title = models.CharField(max_length=255, blank=True)
    direction = models.CharField(max_length=20, blank=True)
    audience = models.CharField(
        max_length=16, choices=Audience.choices, default=Audience.ANY
    )
    duration_minutes = models.PositiveIntegerField(null=True, blank=True)
    price = models.DecimalField(max_digits=12, decimal_places=2)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Правило цены учителя"
        verbose_name_plural = "Правила цен учителей"
        ordering = ["direction", "duration_minutes"]

    def __str__(self):
        return f"{self.title or self.direction}: {self.price}"


class LessonPackage(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    billing_account = models.ForeignKey(
        BillingAccount,
        on_delete=models.CASCADE,
        related_name="packages",
    )
    title = models.CharField(max_length=255)
    unit_type = models.CharField(max_length=16, choices=PackageUnitType.choices)
    total_units = models.DecimalField(max_digits=12, decimal_places=2)
    remaining_units = models.DecimalField(max_digits=12, decimal_places=2)
    purchase_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    lesson_duration_minutes = models.PositiveIntegerField(
        null=True,
        blank=True,
        help_text="Длительность одного занятия в минутах (для подсказки и фильтрации)",
    )
    starts_at = models.DateField(null=True, blank=True)
    expires_at = models.DateField(null=True, blank=True)
    status = models.CharField(
        max_length=20, choices=PackageStatus.choices, default=PackageStatus.ACTIVE
    )
    auto_use = models.BooleanField(default=True)
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Абонемент"
        verbose_name_plural = "Абонементы"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["billing_account", "status"]),
        ]

    def __str__(self):
        return f"{self.title} ({self.remaining_units}/{self.total_units})"


class EventBillingRecord(models.Model):
    """Финансовый снимок урока для конкретного ученика."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    event = models.ForeignKey(
        "Cabinet.ScheduleEvent",
        on_delete=models.CASCADE,
        related_name="billing_records",
    )
    student = models.ForeignKey(
        "Cabinet.Student",
        on_delete=models.CASCADE,
        related_name="event_billing_records",
    )
    billing_account = models.ForeignKey(
        BillingAccount,
        on_delete=models.CASCADE,
        related_name="event_records",
    )
    participant = models.ForeignKey(
        "Cabinet.ScheduleEventParticipant",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="billing_records",
    )
    delivery_status = models.CharField(
        max_length=32,
        choices=DeliveryStatus.choices,
        default=DeliveryStatus.PLANNED,
    )
    financial_status = models.CharField(
        max_length=32,
        choices=FinancialStatus.choices,
        default=FinancialStatus.NOT_SPECIFIED,
    )
    billing_type = models.CharField(max_length=32, choices=BillingType.choices, blank=True)
    planned_duration_minutes = models.PositiveIntegerField(default=60)
    actual_duration_minutes = models.PositiveIntegerField(null=True, blank=True)
    rate = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    calculated_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    charged_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    paid_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    currency = models.CharField(max_length=3, default="RUB")
    price_source = models.CharField(
        max_length=64, choices=PriceSource.choices, default=PriceSource.TEACHER_DEFAULT
    )
    price_source_label = models.CharField(max_length=255, blank=True)
    package = models.ForeignKey(
        LessonPackage,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="event_records",
    )
    package_units = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    is_free = models.BooleanField(default=False)
    is_trial = models.BooleanField(default=False)
    discount_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    manual_override = models.BooleanField(default=False)
    comment = models.TextField(blank=True)
    finalized_at = models.DateTimeField(null=True, blank=True)
    idempotency_key = models.CharField(max_length=64, blank=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Финансы урока"
        verbose_name_plural = "Финансы уроков"
        constraints = [
            models.UniqueConstraint(
                fields=["event", "student"],
                name="cabinet_unique_event_student_billing",
            ),
        ]
        indexes = [
            models.Index(fields=["billing_account", "financial_status"]),
            models.Index(fields=["financial_status", "delivery_status"]),
        ]

    def __str__(self):
        return f"EventBilling {self.event_id} / {self.student_id}"


class BillingTransaction(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    billing_account = models.ForeignKey(
        BillingAccount,
        on_delete=models.CASCADE,
        related_name="transactions",
    )
    student = models.ForeignKey(
        "Cabinet.Student",
        on_delete=models.CASCADE,
        related_name="billing_transactions",
    )
    event = models.ForeignKey(
        "Cabinet.ScheduleEvent",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="billing_transactions",
    )
    event_billing = models.ForeignKey(
        EventBillingRecord,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="transactions",
    )
    package = models.ForeignKey(
        LessonPackage,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="transactions",
    )
    student_payment = models.ForeignKey(
        "StudentPayment",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="transactions",
    )
    transaction_type = models.CharField(max_length=32, choices=TransactionType.choices)
    amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    package_units = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    currency = models.CharField(max_length=3, default="RUB")
    occurred_at = models.DateTimeField()
    comment = models.TextField(blank=True)
    metadata = models.JSONField(default=dict, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="billing_transactions_created",
    )
    reversed_transaction = models.ForeignKey(
        "self",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="reversals",
    )
    is_reversal = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Финансовая операция"
        verbose_name_plural = "Финансовые операции"
        ordering = ["-occurred_at", "-created_at"]
        indexes = [
            models.Index(fields=["billing_account", "occurred_at"]),
            models.Index(fields=["transaction_type", "occurred_at"]),
        ]

    def __str__(self):
        return f"{self.transaction_type} {self.amount} {self.currency}"


class StudentPayment(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    billing_account = models.ForeignKey(
        BillingAccount,
        on_delete=models.CASCADE,
        related_name="payments",
    )
    student = models.ForeignKey(
        "Cabinet.Student",
        on_delete=models.CASCADE,
        related_name="student_payments",
    )
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    currency = models.CharField(max_length=3, default="RUB")
    paid_at = models.DateTimeField()
    method = models.CharField(
        max_length=16, choices=PaymentMethod.choices, blank=True, default=""
    )
    purpose = models.CharField(max_length=255, blank=True)
    comment = models.TextField(blank=True)
    status = models.CharField(
        max_length=24,
        choices=StudentPaymentStatus.choices,
        default=StudentPaymentStatus.CONFIRMED,
    )
    package = models.ForeignKey(
        LessonPackage,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="payments",
    )
    refunded_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="student_payments_created",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Оплата ученика"
        verbose_name_plural = "Оплаты учеников"
        ordering = ["-paid_at"]

    def __str__(self):
        return f"StudentPayment {self.amount} {self.currency}"


class StudentPaymentAllocation(models.Model):
    payment = models.ForeignKey(
        StudentPayment,
        on_delete=models.CASCADE,
        related_name="allocations",
    )
    event_billing = models.ForeignKey(
        EventBillingRecord,
        on_delete=models.CASCADE,
        related_name="payment_allocations",
    )
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Распределение оплаты"
        verbose_name_plural = "Распределения оплат"
        constraints = [
            models.UniqueConstraint(
                fields=["payment", "event_billing"],
                name="cabinet_unique_payment_allocation",
            ),
        ]


class BillingAuditLog(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    teacher = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="billing_audit_logs",
    )
    billing_account = models.ForeignKey(
        BillingAccount,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="audit_logs",
    )
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="billing_actions",
    )
    action = models.CharField(max_length=64)
    entity_type = models.CharField(max_length=64, blank=True)
    entity_id = models.CharField(max_length=64, blank=True)
    old_value = models.JSONField(default=dict, blank=True)
    new_value = models.JSONField(default=dict, blank=True)
    reason = models.TextField(blank=True)
    related_transaction = models.ForeignKey(
        BillingTransaction,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="audit_logs",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Аудит биллинга"
        verbose_name_plural = "Аудит биллинга"
        ordering = ["-created_at"]


class PaymentReminderLog(models.Model):
    billing_account = models.ForeignKey(
        BillingAccount,
        on_delete=models.CASCADE,
        related_name="reminder_logs",
    )
    sent_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="payment_reminders_sent",
    )
    channel = models.CharField(max_length=16, default="telegram")
    message = models.TextField()
    amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Напоминание об оплате"
        verbose_name_plural = "Напоминания об оплате"
        ordering = ["-created_at"]


class MonthlyBillingPeriod(models.Model):
    """Начисление фиксированной месячной оплаты."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    billing_account = models.ForeignKey(
        BillingAccount,
        on_delete=models.CASCADE,
        related_name="monthly_periods",
    )
    year = models.PositiveIntegerField()
    month = models.PositiveSmallIntegerField()
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    currency = models.CharField(max_length=3, default="RUB")
    lessons_included = models.PositiveIntegerField(default=0)
    lessons_conducted = models.PositiveIntegerField(default=0)
    lessons_cancelled_teacher = models.PositiveIntegerField(default=0)
    charged_at = models.DateTimeField(null=True, blank=True)
    transaction = models.ForeignKey(
        BillingTransaction,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="monthly_periods",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Месячный период оплаты"
        verbose_name_plural = "Месячные периоды оплаты"
        constraints = [
            models.UniqueConstraint(
                fields=["billing_account", "year", "month"],
                name="cabinet_unique_monthly_billing_period",
            ),
        ]
