"""Модели AI-генерации рабочих листов. Баланс AI-токенов не связан с токенами провайдера."""

from __future__ import annotations

import uuid

from django.conf import settings
from django.db import models


class AITokenAccount(models.Model):
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="ai_token_account",
        verbose_name="Пользователь",
    )
    balance = models.PositiveIntegerField("Баланс AI-токенов", default=0)
    updated_at = models.DateTimeField("Обновлён", auto_now=True)

    class Meta:
        verbose_name = "Баланс AI-токенов"
        verbose_name_plural = "Балансы AI-токенов"
        constraints = [
            models.CheckConstraint(condition=models.Q(balance__gte=0), name="ai_token_balance_nonneg"),
        ]

    def __str__(self):
        return f"{self.user_id}: {self.balance}"


class AITransaction(models.Model):
    class Operation(models.TextChoices):
        CREDIT = "credit", "Начисление"
        DEBIT = "debit", "Списание"
        REFUND = "refund", "Возврат"
        ADMIN_ADJUSTMENT = "admin_adjustment", "Корректировка"
        PURCHASE = "purchase", "Покупка"
        SUBSCRIPTION_CREDIT = "subscription_credit", "Начисление по тарифу"

    class Status(models.TextChoices):
        POSTED = "posted", "Проведена"
        VOID = "void", "Аннулирована"

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="ai_token_transactions",
        verbose_name="Пользователь",
    )
    amount = models.PositiveIntegerField("Сумма")
    operation_type = models.CharField("Операция", max_length=32, choices=Operation.choices, db_index=True)
    generation = models.ForeignKey(
        "WorksheetAIGeneration",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="transactions",
        verbose_name="Генерация",
    )
    description = models.CharField("Описание", max_length=255, blank=True)
    balance_before = models.PositiveIntegerField("Баланс до")
    balance_after = models.PositiveIntegerField("Баланс после")
    status = models.CharField(
        "Статус", max_length=16, choices=Status.choices, default=Status.POSTED, db_index=True
    )
    idempotency_key = models.CharField("Ключ идемпотентности", max_length=80, blank=True, default="")
    metadata = models.JSONField("Метаданные", default=dict, blank=True)
    created_at = models.DateTimeField("Создана", auto_now_add=True)

    class Meta:
        verbose_name = "Операция AI-токенов"
        verbose_name_plural = "Журнал AI-токенов"
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["user", "idempotency_key"],
                condition=~models.Q(idempotency_key=""),
                name="ai_tx_user_idem_uniq",
            ),
        ]
        indexes = [
            models.Index(fields=["user", "created_at"], name="ai_tx_user_created_idx"),
        ]

    def __str__(self):
        return f"{self.operation_type} {self.amount} user={self.user_id}"


class WorksheetAIPricing(models.Model):
    """Стоимость и начисления. Меняются из админки, бизнес-логика читает эту запись."""

    code = models.SlugField("Код", max_length=32, unique=True, default="default")
    config = models.JSONField("Конфигурация", default=dict, blank=True)
    is_active = models.BooleanField("Активна", default=True)
    updated_at = models.DateTimeField("Обновлена", auto_now=True)

    class Meta:
        verbose_name = "Стоимость AI-листа"
        verbose_name_plural = "Стоимость AI-листов"

    def __str__(self):
        return self.code


class KnowledgeInstruction(models.Model):
    class Kind(models.TextChoices):
        STRUCTURE = "structure", "Структура задания"
        FIPI = "fipi", "Правила ФИПИ"
        METHOD = "method", "Методика"
        ANSWER = "answer", "Правила ответа"
        AGE = "age", "Возраст"
        FORMAT = "format", "Формат"
        EXAMPLE = "example", "Пример"
        PITFALL = "pitfall", "Типичная ошибка"
        GENERAL = "general", "Общее"

    class Exam(models.TextChoices):
        OGE = "oge", "ОГЭ"
        EGE = "ege", "ЕГЭ"
        EGE_BASE = "ege_base", "ЕГЭ база"
        EGE_PROFILE = "ege_profile", "ЕГЭ профиль"
        VPR = "vpr", "ВПР"

    code = models.SlugField("Код", max_length=64, unique=True)
    subject = models.ForeignKey(
        "Generator.Subject",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="knowledge_instructions",
        verbose_name="Предмет",
    )
    grade = models.CharField("Класс", max_length=16, blank=True, default="")
    grade_from = models.PositiveSmallIntegerField("Класс от", null=True, blank=True)
    grade_to = models.PositiveSmallIntegerField("Класс до", null=True, blank=True)
    exam = models.CharField("Экзамен", max_length=16, choices=Exam.choices, blank=True, default="")
    level = models.ForeignKey(
        "Generator.Level",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="knowledge_instructions",
        verbose_name="Уровень",
    )
    topic = models.CharField("Тема", max_length=255, blank=True, default="")
    subtopic = models.CharField("Подтема", max_length=255, blank=True, default="")
    task_type = models.CharField("Тип задания", max_length=64, blank=True, default="")
    difficulty = models.CharField("Сложность", max_length=32, blank=True, default="")
    kind = models.CharField("Вид", max_length=16, choices=Kind.choices, default=Kind.GENERAL)
    title = models.CharField("Название", max_length=255)
    body = models.TextField("Инструкция")
    is_active = models.BooleanField("Активна", default=True, db_index=True)
    priority = models.PositiveSmallIntegerField("Приоритет", default=0)
    created_at = models.DateTimeField("Создана", auto_now_add=True)
    updated_at = models.DateTimeField("Обновлена", auto_now=True)

    class Meta:
        verbose_name = "Инструкция базы знаний"
        verbose_name_plural = "База знаний для генерации заданий"
        ordering = ["-priority", "title"]

    def __str__(self):
        return self.title


class WorksheetDocument(models.Model):
    """Сохранённый лист в формате существующего редактора."""

    class Status(models.TextChoices):
        DRAFT = "draft", "Черновик"
        SAVED = "saved", "Сохранено"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    teacher = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="worksheet_documents",
        verbose_name="Преподаватель",
    )
    title = models.CharField("Название", max_length=255, blank=True)
    blocks = models.JSONField("Блоки", default=list, blank=True)
    form = models.JSONField("Параметры редактора", default=dict, blank=True)
    design = models.JSONField("Оформление", default=dict, blank=True)
    orientation = models.CharField("Ориентация", max_length=16, default="portrait")
    margin_mm = models.PositiveSmallIntegerField("Поля, мм", default=12)
    status = models.CharField(
        "Статус",
        max_length=16,
        choices=Status.choices,
        default=Status.DRAFT,
        db_index=True,
    )
    created_at = models.DateTimeField("Создан", auto_now_add=True)
    updated_at = models.DateTimeField("Обновлён", auto_now=True)

    class Meta:
        verbose_name = "Рабочий лист"
        verbose_name_plural = "Рабочие листы"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["teacher", "created_at"], name="ws_doc_teacher_created_idx"),
        ]

    def __str__(self):
        return self.title or str(self.id)


class WorksheetAIQuote(models.Model):
    class Status(models.TextChoices):
        OPEN = "open", "Открыт"
        CONSUMED = "consumed", "Использован"
        EXPIRED = "expired", "Истёк"
        FAILED = "failed", "Ошибка"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="worksheet_ai_quotes",
        verbose_name="Пользователь",
    )
    params = models.JSONField("Параметры", default=dict, blank=True)
    price = models.PositiveIntegerField("Цена", default=0)
    breakdown = models.JSONField("Расшифровка", default=list, blank=True)
    selected_tasks = models.JSONField("Выбранные задания", default=list, blank=True)
    plan = models.JSONField("План", default=dict, blank=True)
    expires_at = models.DateTimeField("Действует до")
    status = models.CharField(
        "Статус", max_length=16, choices=Status.choices, default=Status.OPEN, db_index=True
    )
    created_at = models.DateTimeField("Создан", auto_now_add=True)

    class Meta:
        verbose_name = "Расчёт генерации листа"
        verbose_name_plural = "Расчёты генерации листов"
        indexes = [
            models.Index(fields=["user", "status"], name="ws_quote_user_status_idx"),
        ]

    def __str__(self):
        return f"{self.id} {self.price}"


class WorksheetAIGeneration(models.Model):
    class Status(models.TextChoices):
        RUNNING = "running", "Выполняется"
        SUCCEEDED = "succeeded", "Готово"
        PARTIAL = "partial", "Частично"
        FAILED = "failed", "Ошибка"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="worksheet_ai_generations",
        verbose_name="Пользователь",
    )
    worksheet = models.ForeignKey(
        WorksheetDocument,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="ai_generations",
        verbose_name="Рабочий лист",
    )
    quote = models.OneToOneField(
        WorksheetAIQuote,
        on_delete=models.PROTECT,
        related_name="generation",
        verbose_name="Расчёт",
    )
    prompt = models.TextField("Запрос преподавателя", blank=True)
    params = models.JSONField("Параметры", default=dict, blank=True)
    selected_tasks = models.JSONField("Задания из банка", default=list, blank=True)
    generated_tasks = models.JSONField("Созданные задания", default=list, blank=True)
    knowledge_ids = models.JSONField("Инструкции", default=list, blank=True)
    quoted_cost = models.PositiveIntegerField("Цена расчёта", default=0)
    cost = models.PositiveIntegerField("Списано", default=0)
    model = models.CharField("Модель", max_length=128, blank=True, default="")
    input_tokens = models.PositiveIntegerField("Входные токены провайдера", default=0)
    output_tokens = models.PositiveIntegerField("Выходные токены провайдера", default=0)
    provider_calls = models.PositiveSmallIntegerField("Вызовов провайдера", default=0)
    provider_cost = models.DecimalField(
        "Стоимость провайдера, ₽", max_digits=12, decimal_places=4, default=0
    )
    latency_ms = models.PositiveIntegerField("Задержка, мс", default=0)
    retry_count = models.PositiveSmallIntegerField("Повторы", default=0)
    status = models.CharField(
        "Статус", max_length=16, choices=Status.choices, default=Status.RUNNING, db_index=True
    )
    errors = models.JSONField("Ошибки", default=list, blank=True)
    metadata = models.JSONField("Метаданные", default=dict, blank=True)
    pricing_snapshot = models.JSONField("Снимок цены", default=dict, blank=True)
    quality = models.JSONField("Качество генерации", default=dict, blank=True)
    idempotency_key = models.CharField("Ключ идемпотентности", max_length=80, blank=True, default="")
    created_at = models.DateTimeField("Создана", auto_now_add=True)
    finished_at = models.DateTimeField("Завершена", null=True, blank=True)

    class Meta:
        verbose_name = "AI-генерация рабочего листа"
        verbose_name_plural = "AI-генерации рабочих листов"
        constraints = [
            models.UniqueConstraint(
                fields=["user", "idempotency_key"],
                condition=~models.Q(idempotency_key=""),
                name="ws_gen_user_idem_uniq",
            ),
        ]
        indexes = [
            models.Index(fields=["user", "created_at"], name="ws_gen_user_created_idx"),
        ]

    def __str__(self):
        return f"{self.id} {self.status}"


class AITaskCandidate(models.Model):
    class Review(models.TextChoices):
        AI_GENERATED = "ai_generated", "Создано AI"
        PENDING_REVIEW = "pending_review", "Ожидает проверки"
        APPROVED = "approved", "Одобрено"
        REJECTED = "rejected", "Отклонено"

    subject = models.ForeignKey(
        "Generator.Subject",
        on_delete=models.PROTECT,
        related_name="ai_task_candidates",
        verbose_name="Предмет",
    )
    grade = models.CharField("Класс", max_length=16, blank=True, default="")
    level = models.ForeignKey(
        "Generator.Level",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="ai_task_candidates",
        verbose_name="Уровень",
    )
    topic = models.CharField("Тема", max_length=255, blank=True, default="")
    subtopic = models.CharField("Подтема", max_length=255, blank=True, default="")
    difficulty = models.CharField("Сложность", max_length=32, blank=True, default="standard")
    task_type = models.CharField("Тип", max_length=64, blank=True, default="short_answer")
    text = models.TextField("Условие")
    structured_content = models.JSONField("Структура", default=dict, blank=True)
    answer = models.TextField("Ответ", blank=True)
    solution = models.TextField("Решение", blank=True)
    skill = models.CharField("Навык", max_length=255, blank=True, default="")
    metadata = models.JSONField("Метаданные", default=dict, blank=True)
    source = models.CharField("Источник", max_length=32, default="ai_generated")
    review_status = models.CharField(
        "Статус проверки",
        max_length=32,
        choices=Review.choices,
        default=Review.PENDING_REVIEW,
        db_index=True,
    )
    text_hash = models.CharField("Хеш условия", max_length=64, blank=True, default="", db_index=True)
    generation = models.ForeignKey(
        WorksheetAIGeneration,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="candidates",
        verbose_name="Генерация",
    )
    knowledge_ids = models.JSONField("Инструкции", default=list, blank=True)
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="ai_task_candidates",
        verbose_name="Автор запроса",
    )
    promoted_task = models.ForeignKey(
        "Generator.Task",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="ai_candidate_sources",
        verbose_name="Задача банка после одобрения",
    )
    created_at = models.DateTimeField("Создана", auto_now_add=True)

    class Meta:
        verbose_name = "AI-задание"
        verbose_name_plural = "AI-задания на проверке"
        indexes = [
            models.Index(fields=["review_status", "subject"], name="ai_cand_status_subj_idx"),
        ]

    def __str__(self):
        return f"{self.review_status}: {self.topic}"
