from datetime import datetime
from zoneinfo import ZoneInfo

from django.db import migrations, models


def seed_christmas_fundraiser(apps, schema_editor):
    Fundraiser = apps.get_model("Cabinet", "Fundraiser")
    Fundraiser.objects.update_or_create(
        slug="rozhdestvenskiy-sbor",
        defaults={
            "title": "Рождественский сбор",
            # Публичный старт в тексте страницы — 9 ноября. Подписки считаются с 6 ноября,
            # чтобы в сумму вошла оплата 495 ₽ от 2026-11-06.
            "start_date": datetime(2026, 11, 9).date(),
            "manual_adjustment_rub": 3220,
            "include_subscriptions_since": datetime(
                2026, 11, 6, 0, 0, tzinfo=ZoneInfo("Europe/Moscow")
            ),
            "is_active": True,
            "goal_rub": None,
        },
    )


def unseed_christmas_fundraiser(apps, schema_editor):
    Fundraiser = apps.get_model("Cabinet", "Fundraiser")
    Fundraiser.objects.filter(slug="rozhdestvenskiy-sbor").delete()


class Migration(migrations.Migration):
    dependencies = [
        ("Cabinet", "0133_r126_homework_not_limited"),
    ]

    operations = [
        migrations.CreateModel(
            name="Fundraiser",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("slug", models.SlugField(max_length=80, unique=True, verbose_name="Адрес")),
                ("title", models.CharField(max_length=200, verbose_name="Название")),
                (
                    "start_date",
                    models.DateField(
                        help_text="Публичная дата старта. На сумму подписок не влияет.",
                        verbose_name="Дата начала сбора",
                    ),
                ),
                (
                    "manual_adjustment_rub",
                    models.DecimalField(
                        decimal_places=2,
                        default=0,
                        help_text="Переводы и донаты, которых нет среди платежей платформы. Для рождественского сбора: 3 000 ₽ перевод + 220 ₽ VK Donut.",
                        max_digits=12,
                        verbose_name="Ручная поправка, ₽",
                    ),
                ),
                (
                    "include_subscriptions_since",
                    models.DateTimeField(
                        help_text="В сумму входят оплаченные подписки T-Bank (paid_at, часовой пояс Europe/Moscow) начиная с этого момента. Оплата 6 ноября 2026 включена.",
                        verbose_name="Учитывать подписки с",
                    ),
                ),
                (
                    "is_active",
                    models.BooleanField(
                        default=True,
                        help_text="Публичная сумма берётся у одной активной записи — с самой поздней датой начала.",
                        verbose_name="Активен",
                    ),
                ),
                (
                    "goal_rub",
                    models.DecimalField(
                        blank=True,
                        decimal_places=2,
                        max_digits=12,
                        null=True,
                        verbose_name="Цель, ₽",
                    ),
                ),
            ],
            options={
                "verbose_name": "Сбор",
                "verbose_name_plural": "Сборы",
                "ordering": ["-start_date", "-id"],
            },
        ),
        migrations.RunPython(seed_christmas_fundraiser, unseed_christmas_fundraiser),
    ]
