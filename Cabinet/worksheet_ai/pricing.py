"""Стоимость генерации читается из конфигурации, а не зашита в расчёт."""

from __future__ import annotations

COST_KEYS = (
    "base_worksheet_generation",
    "task_from_bank",
    "task_rewrite",
    "task_theme_adaptation",
    "ai_new_task",
    "ai_design",
    "theory_block",
    "image_generation",
)

COST_LABELS = {
    "base_worksheet_generation": "Сборка листа",
    "task_from_bank": "Задание из банка",
    "task_rewrite": "Переформулировка",
    "task_theme_adaptation": "Адаптация под тему",
    "ai_new_task": "Новое задание",
    "ai_design": "Оформление",
    "theory_block": "Теория",
    "image_generation": "Картинка к заданию",
}

DEFAULT_CONFIG = {
    "costs": {
        "base_worksheet_generation": 0,
        "task_from_bank": 0,
        "task_rewrite": 1,
        "task_theme_adaptation": 1,
        "ai_new_task": 3,
        "ai_design": 5,
        "theory_block": 2,
        "image_generation": 8,
    },
    "cost_labels": dict(COST_LABELS),
    # Месячная выдача на помощь ИИ. Сборка листа токены не тратит.
    "monthly_grant_by_plan": {
        "start": 80,
        "teacher": 400,
        "pro": 800,
        "premium": 1200,
        "school": 2000,
        "default": 20,
    },
    "quote_ttl_minutes": 30,
    "max_tasks": 30,
    "max_new_task_attempts": 3,
    "search_pool_limit": 80,
}


def get_pricing() -> dict:
    from .models import WorksheetAIPricing

    row, _ = WorksheetAIPricing.objects.get_or_create(
        code="default",
        defaults={"config": DEFAULT_CONFIG, "is_active": True},
    )
    config = dict(DEFAULT_CONFIG)
    stored = row.config if isinstance(row.config, dict) else {}
    costs = dict(DEFAULT_CONFIG["costs"])
    costs.update({key: int(value) for key, value in (stored.get("costs") or {}).items() if key in COST_KEYS})
    grants = dict(DEFAULT_CONFIG["monthly_grant_by_plan"])
    grants.update({str(key): int(value) for key, value in (stored.get("monthly_grant_by_plan") or {}).items()})
    labels = dict(DEFAULT_CONFIG["cost_labels"])
    labels.update({
        str(key): str(value)
        for key, value in (stored.get("cost_labels") or {}).items()
        if key in COST_KEYS and str(value).strip()
    })
    config["costs"] = costs
    config["cost_labels"] = labels
    config["monthly_grant_by_plan"] = grants
    for key in ("quote_ttl_minutes", "max_tasks", "max_new_task_attempts", "search_pool_limit"):
        if key in stored:
            config[key] = int(stored[key])
    return config


def price_lines(lines: list[tuple[str, int]], costs: dict | None = None) -> tuple[int, list[dict]]:
    """Универсальный расчёт: список (ключ, количество). Им пользуются и первичная генерация, и будущие точечные операции."""
    table = costs if costs is not None else get_pricing()["costs"]
    total = 0
    detail = []
    for key, qty in lines:
        quantity = max(0, int(qty))
        unit = int(table.get(key, 0))
        amount = unit * quantity
        total += amount
        detail.append({"key": key, "quantity": quantity, "unit": unit, "amount": amount})
    return total, detail


def spend_catalog() -> list[dict]:
    """Расход AI-токенов из конфигурации в базе."""
    pricing = get_pricing()
    costs = pricing["costs"]
    labels = pricing["cost_labels"]
    return [
        {"key": key, "label": labels.get(key, key), "amount": int(costs.get(key, 0))}
        for key in COST_KEYS
    ]


def lines_for_plan(plan: dict) -> list[tuple[str, int]]:
    return [
        ("base_worksheet_generation", 1 if plan.get("charge_base", True) else 0),
        ("task_from_bank", int(plan.get("bank_tasks_selected") or 0)),
        ("task_rewrite", int(plan.get("tasks_to_rewrite") or 0)),
        ("task_theme_adaptation", int(plan.get("tasks_to_adapt") or 0)),
        ("ai_new_task", int(plan.get("ai_tasks_required") or 0)),
        ("ai_design", 1 if plan.get("ai_design") else 0),
        ("theory_block", 1 if plan.get("theory_block") else 0),
    ]
