"""Remap repetitor→teacher, seed tariff fields, backfill content access."""

from decimal import Decimal

from django.db import migrations


def remap_and_seed(apps, schema_editor):
    TariffPlan = apps.get_model("Cabinet", "TariffPlan")
    TeacherSubscription = apps.get_model("Cabinet", "TeacherSubscription")
    Material = apps.get_model("Cabinet", "Material")
    Lesson = apps.get_model("Cabinet", "Lesson")
    Interactive = apps.get_model("Cabinet", "Interactive")

    teacher_defaults = {
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
        "cta_type": "checkout",
        "has_basic_notifications": True,
        "has_extended_library": True,
        "is_active": True,
        "is_public": True,
        "is_free": False,
        "sort_order": 1,
    }

    teacher_plan, _ = TariffPlan.objects.get_or_create(
        slug="teacher",
        defaults=teacher_defaults,
    )
    # Ensure key fields even if plan already existed empty.
    for key, value in teacher_defaults.items():
        setattr(teacher_plan, key, value)
    teacher_plan.save()

    legacy = TariffPlan.objects.filter(slug="repetitor").first()
    if legacy:
        TeacherSubscription.objects.filter(plan=legacy).update(plan=teacher_plan)
        # Point scheduled_plan FKs if any
        TeacherSubscription.objects.filter(scheduled_plan=legacy).update(
            scheduled_plan=teacher_plan
        )
        legacy.is_active = False
        legacy.is_public = False
        legacy.save(update_fields=["is_active", "is_public", "updated_at"])

    # Update other plans' public fields / prices without wiping custom admin edits of limits
    # only when slug matches known set.
    plan_updates = {
        "start": {
            "name": "Старт",
            "short_description": "Бесплатно для знакомства с платформой",
            "price_month": Decimal("0"),
            "price_year": Decimal("0"),
            "max_students": 5,
            "content_access_rank": 0,
            "cta_type": "register",
            "is_free": True,
            "is_public": True,
            "is_recommended": False,
            "sort_order": 0,
            "max_variants_monthly": 30,
            "max_workbooks_monthly": 10,
        },
        "pro": {
            "name": "Профи",
            "short_description": "Оптимальный выбор для большинства",
            "badge_text": "Рекомендуем",
            "price_month": Decimal("2990"),
            "price_year": Decimal("29900"),
            "max_students": 40,
            "content_access_rank": 2,
            "cta_type": "checkout",
            "is_recommended": True,
            "is_featured": True,
            "is_public": True,
            "is_free": False,
            "sort_order": 2,
            "monthly_library_promise": True,
            "has_simulators": True,
            "has_analytics": True,
            "has_mass_actions": True,
            "max_variants_monthly": 300,
            "max_workbooks_monthly": 100,
        },
        "school": {
            "name": "Школа / Образовательный центр",
            "short_description": "Для школ и образовательных центров",
            "badge_text": "По запросу",
            "price_month": Decimal("0"),
            "price_year": Decimal("0"),
            "content_access_rank": 4,
            "cta_type": "contact",
            "is_public": True,
            "is_recommended": False,
            "is_featured": False,
            "is_free": False,
            "sort_order": 4,
            "has_multi_teacher": True,
            "has_team_roles": True,
            "monthly_library_promise": True,
        },
    }
    for slug, updates in plan_updates.items():
        plan = TariffPlan.objects.filter(slug=slug).first()
        if not plan:
            continue
        for key, value in updates.items():
            setattr(plan, key, value)
        plan.save()

    premium_defaults = {
        "name": "Премиум",
        "description": "Максимум материалов и приоритетная поддержка.",
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
        "cta_type": "checkout",
        "has_basic_notifications": True,
        "has_advanced_notifications": True,
        "has_extended_library": True,
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
    }
    TariffPlan.objects.update_or_create(slug="premium", defaults=premium_defaults)

    # Content access backfill: unpaid/public → free stays; paid-like already free default.
    # Interactive simulators → professional if still free and type looks advanced.
    Material.objects.filter(access_level="").update(access_level="free")
    Lesson.objects.filter(access_level="").update(access_level="free")
    Interactive.objects.filter(access_level="").update(access_level="free")


def reverse_noop(apps, schema_editor):
    pass


def remap_generator_lessons(apps, schema_editor):
    Lesson = apps.get_model("Generator", "Lesson")
    # paid → professional (simulators/interactives feel), private → corporate
    Lesson.objects.filter(access_level="paid").update(access_level="professional")
    Lesson.objects.filter(access_level="private").update(access_level="corporate")


class Migration(migrations.Migration):

    dependencies = [
        ("Cabinet", "0051_tariffs_subscriptions_access"),
        ("Generator", "0073_tariffs_subscriptions_access"),
    ]

    operations = [
        migrations.RunPython(remap_and_seed, reverse_noop),
        migrations.RunPython(remap_generator_lessons, reverse_noop),
    ]
