"""Публичные шаблоны планов обучения (каталог «Готовые планы»).

Чтобы добавить новый план:
1. Создайте файл Cabinet/catalog_plans/<key>.py со словарём PLAN.
2. Импортируйте его в ALL_PLANS ниже.
3. Запустите: python manage.py seed_catalog_lesson_plans
   или дождитесь миграции, которая вызывает sync_all_catalog_plans().
"""

from .inf_ege import PLAN as INF_EGE_PLAN
from .inf_oge import PLAN as INF_OGE_PLAN
from .math_ege import PLAN as MATH_EGE_PLAN
from .math_oge import PLAN as MATH_OGE_PLAN
from .phys_oge import PLAN as PHYS_OGE_PLAN
from .rus_oge import PLAN as RUS_OGE_PLAN
from .sync import sync_all_catalog_plans, sync_catalog_plan

ALL_PLANS = (
    MATH_OGE_PLAN,
    MATH_EGE_PLAN,
    PHYS_OGE_PLAN,
    INF_OGE_PLAN,
    INF_EGE_PLAN,
    RUS_OGE_PLAN,
)

__all__ = [
    "ALL_PLANS",
    "INF_EGE_PLAN",
    "INF_OGE_PLAN",
    "MATH_EGE_PLAN",
    "MATH_OGE_PLAN",
    "PHYS_OGE_PLAN",
    "RUS_OGE_PLAN",
    "sync_all_catalog_plans",
    "sync_catalog_plan",
]
