"""Приглашение коллег-учителей: ссылка, привязка, аудит бонуса «Репетитор»."""

from django.conf import settings
from django.db import models


def ru_days(count: int) -> str:
    """«1 день», «3 дня», «7 дней», «21 день»."""
    number = abs(int(count))
    tail = number % 100
    last = number % 10
    if 10 < tail < 20:
        word = "дней"
    elif last == 1:
        word = "день"
    elif 2 <= last <= 4:
        word = "дня"
    else:
        word = "дней"
    return f"{number} {word}"


class ColleagueInviteSettings(models.Model):
    """Одна строка настроек. Срок бонуса и месячный лимит меняются в админке."""

    bonus_days = models.PositiveSmallIntegerField(
        "Дней тарифа «Репетитор»",
        default=7,
        help_text="Сколько дней тарифа «Репетитор» получает пригласивший после квалификации коллеги.",
    )
    monthly_cap = models.PositiveSmallIntegerField(
        "Приглашений в месяц",
        default=10,
        help_text="Сколько коллег один учитель может пригласить за календарный месяц (Europe/Moscow).",
    )
    fingerprint_window_hours = models.PositiveIntegerField(
        "Окно IP и устройства, часы",
        default=72,
        help_text="Совпадение IP или устройства с пригласившим в этом окне считается самоприглашением. 0 — не проверять.",
    )
    enabled = models.BooleanField("Программа включена", default=True)
    updated_at = models.DateTimeField("Обновлено", auto_now=True)

    class Meta:
        verbose_name = "Настройки приглашения коллег"
        verbose_name_plural = "Настройки приглашения коллег"

    def __str__(self):
        return (
            f"Коллеги: +{ru_days(self.bonus_days)} «Репетитор», "
            f"до {self.monthly_cap} в месяц"
        )

    def save(self, *args, **kwargs):
        self.pk = 1
        super().save(*args, **kwargs)

    @classmethod
    def get_solo(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj


class ColleagueInviteLink(models.Model):
    """Личная ссылка учителя. Код не меняется."""

    owner = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="colleague_invite_link",
        verbose_name="Учитель",
    )
    code = models.CharField("Код", max_length=32, unique=True)
    is_active = models.BooleanField("Активна", default=True)
    last_ip = models.CharField(
        "Последний IP учителя", max_length=64, blank=True, default=""
    )
    last_fingerprint = models.CharField(
        "Отпечаток устройства учителя",
        max_length=64,
        blank=True,
        default="",
    )
    last_seen_at = models.DateTimeField(
        "Учитель открывал ссылку", null=True, blank=True
    )
    created_at = models.DateTimeField("Создана", auto_now_add=True)

    class Meta:
        verbose_name = "Ссылка приглашения коллеги"
        verbose_name_plural = "Ссылки приглашения коллег"

    def __str__(self):
        return f"{self.code} → {self.owner_id}"


class ColleagueReferral(models.Model):
    """Один приглашённый — один пригласивший. После регистрации пригласивший не меняется."""

    class Status(models.TextChoices):
        PENDING = "pending", "Ждёт квалификацию"
        GRANTED = "granted", "Бонус начислен"
        DEFERRED = "deferred", "Дни отложены"
        REVOKED = "revoked", "Отозвано"

    class Qualification(models.TextChoices):
        HOMEWORK = "homework", "Первое домашнее задание"
        LESSON = "lesson", "Проведённый урок"

    class Effect(models.TextChoices):
        NONE = "none", "Без изменения подписки"
        ACTIVATED = "activated", "Открыт тариф «Репетитор»"
        EXTENDED = "extended", "Продлён тариф «Репетитор»"
        DEFERRED = "deferred", "Дни ждут окончания другого тарифа"
        ALREADY_COVERED = "already_covered", "Безлимитный «Репетитор» уже есть"

    inviter = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="colleague_referrals_made",
        verbose_name="Пригласивший",
    )
    invited = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="colleague_referral",
        verbose_name="Приглашённый",
    )
    link = models.ForeignKey(
        ColleagueInviteLink,
        on_delete=models.PROTECT,
        related_name="referrals",
        verbose_name="Ссылка",
    )
    status = models.CharField(
        "Статус",
        max_length=20,
        choices=Status.choices,
        default=Status.PENDING,
        db_index=True,
    )
    qualification = models.CharField(
        "Квалификация",
        max_length=20,
        choices=Qualification.choices,
        blank=True,
        default="",
    )
    qualified_at = models.DateTimeField("Квалифицирован", null=True, blank=True)
    granted_at = models.DateTimeField("Бонус начислен", null=True, blank=True)
    revoked_at = models.DateTimeField("Отозвано", null=True, blank=True)
    revoked_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="colleague_referrals_revoked",
        verbose_name="Отозвал",
    )
    revoke_note = models.CharField(
        "Причина отзыва", max_length=255, blank=True, default=""
    )
    email_normalized = models.CharField(
        "Email (нормализованный)", max_length=254, blank=True, default=""
    )
    phone_normalized = models.CharField(
        "Телефон (цифры)", max_length=20, blank=True, default=""
    )
    ip_address = models.CharField(
        "IP регистрации", max_length=64, blank=True, default=""
    )
    device_fingerprint = models.CharField(
        "Отпечаток устройства", max_length=64, blank=True, default=""
    )
    bonus_days = models.PositiveSmallIntegerField("Дней бонуса", default=0)
    effect = models.CharField(
        "Эффект для подписки",
        max_length=32,
        choices=Effect.choices,
        default=Effect.NONE,
    )
    subscription_before = models.JSONField(
        "Подписка до бонуса", default=dict, blank=True
    )
    subscription_after = models.JSONField(
        "Подписка после бонуса", default=dict, blank=True
    )
    created_at = models.DateTimeField("Регистрация", auto_now_add=True)

    class Meta:
        verbose_name = "Приглашение коллеги"
        verbose_name_plural = "Приглашения коллег"
        ordering = ["-created_at"]
        indexes = [
            models.Index(
                fields=["inviter", "created_at"], name="cab_colref_inviter_month"
            ),
        ]

    def __str__(self):
        return f"{self.inviter_id} → {self.invited_id} [{self.status}]"


class ColleagueInviteAudit(models.Model):
    """Журнал привязки, квалификации, начисления и отзыва. Виден в админке."""

    class Action(models.TextChoices):
        BOUND = "bound", "Привязка"
        REJECTED = "rejected", "Отказ"
        GRANTED = "granted", "Бонус начислен"
        DEFERRED = "deferred", "Дни отложены"
        DEFERRED_APPLIED = "deferred_applied", "Отложенные дни применены"
        REVOKED = "revoked", "Отзыв"

    referral = models.ForeignKey(
        ColleagueReferral,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="audit_rows",
        verbose_name="Приглашение",
    )
    inviter = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="colleague_invite_audit_as_inviter",
        verbose_name="Пригласивший",
    )
    invited = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="colleague_invite_audit_as_invited",
        verbose_name="Приглашённый",
    )
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="colleague_invite_audit_actions",
        verbose_name="Кто выполнил",
    )
    action = models.CharField(
        "Событие", max_length=32, choices=Action.choices, db_index=True
    )
    reason = models.CharField("Код причины", max_length=40, blank=True, default="")
    detail = models.CharField("Описание", max_length=255, blank=True, default="")
    bonus_days = models.PositiveSmallIntegerField("Дней", default=0)
    created_at = models.DateTimeField("Когда", auto_now_add=True)

    class Meta:
        verbose_name = "Журнал приглашения коллег"
        verbose_name_plural = "Журнал приглашения коллег"
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.get_action_display()} {self.created_at:%Y-%m-%d %H:%M}"
