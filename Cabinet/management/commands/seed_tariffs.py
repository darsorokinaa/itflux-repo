"""
python manage.py seed_tariffs

Создаёт или обновляет тарифные планы по ТЗ.
Безопасно запускать повторно — обновляет по slug, не дублирует.
"""

from decimal import Decimal

from django.core.management.base import BaseCommand

from Cabinet.models import TariffPlan

TARIFFS = [
    {
        "slug": "start",
        "name": "Старт",
        "description": (
            "Бесплатный старт: кабинет, базовые материалы, ученики и группы "
            "в пределах лимита."
        ),
        "short_description": "Бесплатно для знакомства с платформой",
        "badge_text": "",
        "price_month": Decimal("0"),
        "price_year": Decimal("0"),
        "max_students": 5,
        "max_groups": 2,
        "max_lessons": 10,
        "max_interactives": 5,
        "max_variants_monthly": 30,
        "max_workbooks_monthly": 10,
        "content_access_rank": 0,
        "monthly_library_promise": False,
        "cta_type": TariffPlan.CtaType.REGISTER,
        "ai_requests_monthly_limit": 10,
        "max_storage_mb": 256,
        "has_homework": True,
        "has_review": True,
        "has_basic_notifications": False,
        "has_advanced_notifications": False,
        "has_extended_library": False,
        "has_multi_teacher": False,
        "has_team_roles": False,
        "has_mass_actions": False,
        "has_priority_support": False,
        "has_analytics": False,
        "has_simulators": False,
        "is_active": True,
        "is_public": True,
        "is_recommended": False,
        "is_featured": False,
        "is_free": True,
        "sort_order": 0,
    },
    {
        "slug": "teacher",
        "name": "Учитель",
        "description": (
            "Для репетитора и школьного учителя: больше учеников, "
            "библиотека уровня «Учитель», уведомления."
        ),
        "short_description": "Для активной практики с учениками",
        "badge_text": "",
        "price_month": Decimal("1990"),
        "price_year": Decimal("19900"),
        "max_students": 10,
        "max_groups": 5,
        "max_lessons": 50,
        "max_interactives": 30,
        "max_variants_monthly": 100,
        "max_workbooks_monthly": 40,
        "content_access_rank": 1,
        "monthly_library_promise": True,
        "cta_type": TariffPlan.CtaType.CHECKOUT,
        "ai_requests_monthly_limit": 150,
        "max_storage_mb": 2048,
        "has_homework": True,
        "has_review": True,
        "has_basic_notifications": True,
        "has_advanced_notifications": False,
        "has_extended_library": True,
        "has_multi_teacher": False,
        "has_team_roles": False,
        "has_mass_actions": False,
        "has_priority_support": False,
        "has_analytics": False,
        "has_simulators": False,
        "is_active": True,
        "is_public": True,
        "is_recommended": False,
        "is_featured": False,
        "is_free": False,
        "sort_order": 1,
    },
    {
        "slug": "pro",
        "name": "Профи",
        "description": (
            "Для опытных преподавателей: расширенная библиотека, симуляторы, "
            "аналитика и больше лимитов."
        ),
        "short_description": "Оптимальный выбор для большинства",
        "badge_text": "Рекомендуем",
        "price_month": Decimal("2990"),
        "price_year": Decimal("29900"),
        "max_students": 40,
        "max_groups": 15,
        "max_lessons": 200,
        "max_interactives": 150,
        "max_variants_monthly": 300,
        "max_workbooks_monthly": 100,
        "content_access_rank": 2,
        "monthly_library_promise": True,
        "cta_type": TariffPlan.CtaType.CHECKOUT,
        "ai_requests_monthly_limit": 700,
        "max_storage_mb": 10240,
        "has_homework": True,
        "has_review": True,
        "has_basic_notifications": True,
        "has_advanced_notifications": True,
        "has_extended_library": True,
        "has_multi_teacher": False,
        "has_team_roles": False,
        "has_mass_actions": True,
        "has_priority_support": False,
        "has_analytics": True,
        "has_simulators": True,
        "is_active": True,
        "is_public": True,
        "is_recommended": True,
        "is_featured": True,
        "is_free": False,
        "sort_order": 2,
    },
    {
        "slug": "premium",
        "name": "Премиум",
        "description": (
            "Максимум материалов и приоритетная поддержка для тех, "
            "кто ведёт большую нагрузку."
        ),
        "short_description": "Полный доступ к библиотеке",
        "badge_text": "",
        "price_month": Decimal("4990"),
        "price_year": Decimal("49900"),
        "max_students": 100,
        "max_groups": 30,
        "max_lessons": 500,
        "max_interactives": 400,
        "max_variants_monthly": None,
        "max_workbooks_monthly": None,
        "content_access_rank": 3,
        "monthly_library_promise": True,
        "cta_type": TariffPlan.CtaType.CHECKOUT,
        "ai_requests_monthly_limit": 2000,
        "max_storage_mb": 30720,
        "has_homework": True,
        "has_review": True,
        "has_basic_notifications": True,
        "has_advanced_notifications": True,
        "has_extended_library": True,
        "has_multi_teacher": False,
        "has_team_roles": False,
        "has_mass_actions": True,
        "has_priority_support": True,
        "has_analytics": True,
        "has_simulators": True,
        "is_active": True,
        "is_public": True,
        "is_recommended": False,
        "is_featured": False,
        "is_free": False,
        "sort_order": 3,
    },
    {
        "slug": "school",
        "name": "Школа / Образовательный центр",
        "description": (
            "Командный тариф: несколько учителей, роли, корпоративный доступ "
            "к материалам. Оформляется по заявке."
        ),
        "short_description": "Для школ и образовательных центров",
        "badge_text": "По запросу",
        "price_month": Decimal("0"),
        "price_year": Decimal("0"),
        "max_students": 500,
        "max_groups": 100,
        "max_lessons": 2000,
        "max_interactives": 2000,
        "max_variants_monthly": None,
        "max_workbooks_monthly": None,
        "content_access_rank": 4,
        "monthly_library_promise": True,
        "cta_type": TariffPlan.CtaType.CONTACT,
        "ai_requests_monthly_limit": 5000,
        "max_storage_mb": 102400,
        "has_homework": True,
        "has_review": True,
        "has_basic_notifications": True,
        "has_advanced_notifications": True,
        "has_extended_library": True,
        "has_multi_teacher": True,
        "has_team_roles": True,
        "has_mass_actions": True,
        "has_priority_support": True,
        "has_analytics": True,
        "has_simulators": True,
        "is_active": True,
        "is_public": True,
        "is_recommended": False,
        "is_featured": False,
        "is_free": False,
        "sort_order": 4,
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
            data["slug"] = slug
            action = "Создан" if created else "Обновлён"
            self.stdout.write(f"  {action}: {plan.name} ({slug})")

        # Deactivate legacy repetitor if still present (subscriptions remapped in migration).
        legacy = TariffPlan.objects.filter(slug="repetitor").first()
        if legacy:
            legacy.is_active = False
            legacy.is_public = False
            legacy.save(update_fields=["is_active", "is_public", "updated_at"])
            self.stdout.write("  Деактивирован legacy: repetitor")

        self.stdout.write(self.style.SUCCESS(f"\nГотово: {len(TARIFFS)} тарифов."))
