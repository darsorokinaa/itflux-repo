"""
python manage.py seed_tariffs

Создаёт или обновляет тарифные планы.
Безопасно запускать повторно — обновляет по slug, не дублирует.
"""

from decimal import Decimal

from django.core.management.base import BaseCommand

from Cabinet.models import TariffPlan

TARIFFS = [
    {
        "slug": "start",
        "name": "Старт",
        "description": "Бесплатный старт для одного учителя",
        "price_month": Decimal("0"),
        "price_year": Decimal("0"),
        "max_students": 5,
        "max_groups": 2,
        "max_lessons": 10,
        "max_interactives": 5,
        "ai_requests_monthly_limit": 10,
        "max_storage_mb": 256,
        "has_homework": True,
        "has_review": True,
        "has_basic_notifications": False,
        "has_advanced_notifications": False,
        "has_extended_library": False,
        "has_multi_teacher": False,
        "has_team_roles": False,
        "is_active": True,
        "is_recommended": False,
        "sort_order": 0,
    },
    {
        "slug": "repetitor",
        "name": "Репетитор",
        "description": "Для частного репетитора с активной базой учеников",
        "price_month": Decimal("990"),
        "price_year": Decimal("9900"),
        "max_students": 20,
        "max_groups": 5,
        "max_lessons": 50,
        "max_interactives": 30,
        "ai_requests_monthly_limit": 150,
        "max_storage_mb": 2048,
        "has_homework": True,
        "has_review": True,
        "has_basic_notifications": True,
        "has_advanced_notifications": False,
        "has_extended_library": True,
        "has_multi_teacher": False,
        "has_team_roles": False,
        "is_active": True,
        "is_recommended": True,
        "sort_order": 1,
    },
    {
        "slug": "pro",
        "name": "Профи",
        "description": "Для опытных преподавателей с большой нагрузкой",
        "price_month": Decimal("1990"),
        "price_year": Decimal("19900"),
        "max_students": 60,
        "max_groups": 15,
        "max_lessons": 200,
        "max_interactives": 150,
        "ai_requests_monthly_limit": 700,
        "max_storage_mb": 10240,
        "has_homework": True,
        "has_review": True,
        "has_basic_notifications": True,
        "has_advanced_notifications": True,
        "has_extended_library": True,
        "has_multi_teacher": False,
        "has_team_roles": False,
        "is_active": True,
        "is_recommended": False,
        "sort_order": 2,
    },
    {
        "slug": "school",
        "name": "Мини-школа",
        "description": "Командный тариф для онлайн-школы",
        "price_month": Decimal("3990"),
        "price_year": Decimal("39900"),
        "max_students": 200,
        "max_groups": 50,
        "max_lessons": 1000,
        "max_interactives": 1000,
        "ai_requests_monthly_limit": 3000,
        "max_storage_mb": 51200,
        "has_homework": True,
        "has_review": True,
        "has_basic_notifications": True,
        "has_advanced_notifications": True,
        "has_extended_library": True,
        "has_multi_teacher": True,
        "has_team_roles": True,
        "is_active": True,
        "is_recommended": False,
        "sort_order": 3,
    },
]


class Command(BaseCommand):
    help = "Создаёт или обновляет тарифные планы"

    def handle(self, *args, **kwargs):
        for data in TARIFFS:
            slug = data.pop("slug")
            plan, created = TariffPlan.objects.update_or_create(
                slug=slug,
                defaults=data,
            )
            data["slug"] = slug  # restore for next run
            action = "Создан" if created else "Обновлён"
            self.stdout.write(f"  {action}: {plan.name} ({slug})")

        self.stdout.write(self.style.SUCCESS(f"\nГотово: {len(TARIFFS)} тарифов."))
