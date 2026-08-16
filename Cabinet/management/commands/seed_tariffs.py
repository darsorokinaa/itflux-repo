"""
python manage.py seed_tariffs

Создаёт или обновляет тарифные планы по ТЗ.
Безопасно запускать повторно — обновляет по slug, не дублирует.

Позиционирование:
  Старт   — ознакомительный тариф («Мне вообще подходит Поток?»)
  Учитель — полноценный кабинет для регулярной работы
  Профи   — без лимитов + основная библиотека
  Премиум — весь контент и максимум возможностей
"""

from decimal import Decimal

from django.core.management.base import BaseCommand

from Cabinet.models import TariffPlan

TARIFFS = [
    {
        "slug": "start",
        "name": "Старт",
        "description": (
            "Бесплатный ознакомительный тариф: несколько учеников, "
            "домашние задания, проверка работ и пробные лимиты генератора и тетрадей. "
            "Рабочая платформа начинается с тарифа «Учитель»."
        ),
        "short_description": "Для знакомства с платформой",
        "badge_text": "",
        "price_month": Decimal("0"),
        "price_year": Decimal("0"),
        "max_students": 5,
        "max_groups": 2,
        "max_lessons": 10,
        "max_interactives": 3,
        "max_variants_monthly": 20,
        "max_workbooks_monthly": 5,
        "content_access_rank": 0,
        "monthly_library_promise": False,
        "cta_type": TariffPlan.CtaType.REGISTER,
        "ai_requests_monthly_limit": 10,
        "max_storage_mb": 512,
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
            "Полноценный кабинет преподавателя: расписание, журнал, "
            "видеозанятия и регулярная работа с учениками."
        ),
        "short_description": "Для регулярной работы с учениками",
        "badge_text": "",
        "price_month": Decimal("1990"),
        "price_year": Decimal("19900"),
        "max_students": 10,
        "max_groups": 5,
        "max_lessons": 50,
        "max_interactives": 10,
        "max_variants_monthly": 100,
        "max_workbooks_monthly": 30,
        "content_access_rank": 1,
        "monthly_library_promise": True,
        "cta_type": TariffPlan.CtaType.CHECKOUT,
        "ai_requests_monthly_limit": 150,
        "max_storage_mb": 1024,
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
            "Активная работа без лимитов на генератор, тетради и интерактивы "
            "плюс полная основная библиотека и симуляторы."
        ),
        "short_description": "Для активной работы без лимитов",
        "badge_text": "Рекомендуем",
        "price_month": Decimal("2990"),
        "price_year": Decimal("29900"),
        "max_students": 20,
        "max_groups": 10,
        "max_lessons": 200,
        "max_interactives": None,
        "max_variants_monthly": None,
        "max_workbooks_monthly": None,
        "content_access_rank": 2,
        "monthly_library_promise": True,
        "cta_type": TariffPlan.CtaType.CHECKOUT,
        "ai_requests_monthly_limit": 700,
        "max_storage_mb": 3072,
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
            "Весь контент платформы: Premium-материалы, межпредметные проекты "
            "и максимальные возможности кабинета."
        ),
        "short_description": "Весь контент и максимум возможностей",
        "badge_text": "",
        "price_month": Decimal("3990"),
        "price_year": Decimal("39900"),
        "max_students": 30,
        "max_groups": None,
        "max_lessons": 500,
        "max_interactives": None,
        "max_variants_monthly": None,
        "max_workbooks_monthly": None,
        "content_access_rank": 3,
        "monthly_library_promise": True,
        "cta_type": TariffPlan.CtaType.CHECKOUT,
        "ai_requests_monthly_limit": 2000,
        "max_storage_mb": 10240,
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
        "max_groups": None,
        "max_lessons": 2000,
        "max_interactives": None,
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


REQUIRED_PUBLIC_SLUGS = ("start", "teacher", "pro", "premium")


def apply_tariff_catalog() -> list[tuple[str, bool]]:
    """Создаёт или обновляет каталог тарифов. Не мутирует TARIFFS."""
    results = []
    for raw in TARIFFS:
        slug = raw["slug"]
        defaults = {key: value for key, value in raw.items() if key != "slug"}
        _, created = TariffPlan.objects.update_or_create(slug=slug, defaults=defaults)
        results.append((slug, created))
    for legacy_slug in ("repetitor", "profi"):
        legacy = TariffPlan.objects.filter(slug=legacy_slug).first()
        if legacy:
            legacy.is_active = False
            legacy.is_public = False
            legacy.save(update_fields=["is_active", "is_public", "updated_at"])
    return results


def ensure_default_tariff_plans() -> int:
    """Если нет полного набора публичных тарифов — заполняет каталог."""
    existing = set(
        TariffPlan.objects.filter(slug__in=REQUIRED_PUBLIC_SLUGS).values_list("slug", flat=True)
    )
    if existing.issuperset(REQUIRED_PUBLIC_SLUGS):
        return 0
    return len(apply_tariff_catalog())


class Command(BaseCommand):
    help = "Создаёт или обновляет тарифные планы"

    def handle(self, *args, **kwargs):
        for slug, created in apply_tariff_catalog():
            plan = TariffPlan.objects.get(slug=slug)
            action = "Создан" if created else "Обновлён"
            self.stdout.write(f"  {action}: {plan.name} ({slug})")

        self.stdout.write(self.style.SUCCESS(f"\nГотово: {len(TARIFFS)} тарифов."))
