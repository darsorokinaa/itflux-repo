from django.apps import apps


LEGACY_LEVEL_LABELS = {
    "vpr": "ВПР",
    "oge": "ОГЭ",
    "ege": "ЕГЭ",
    "school": "Школьная программа",
    "python": "Python",
    "other": "Другое",
}

_LEVEL_SORT_ORDER = {
    "oge": 0,
    "ege": 1,
    "school": 2,
    "vpr": 3,
    "python": 4,
    "other": 5,
}


def _normalize_level_id(value):
    return (str(value or "")).strip().lower()


def get_plan_level_options():
    """Уровни/направления для планов уроков из БД Generator.Level."""
    try:
        level_model = apps.get_model("Generator", "Level")
    except LookupError:
        level_model = None

    options = []
    seen = set()
    if level_model is not None:
        field_names = {field.name for field in level_model._meta.fields}
        if "level_rus" in field_names:
            rows = level_model.objects.order_by("level").values_list("level", "level_rus")
        else:
            rows = ((row, "") for row in level_model.objects.order_by("level").values_list("level", flat=True))

        for level_slug, level_rus in rows:
            level_id = _normalize_level_id(level_slug)
            if not level_id or level_id in seen:
                continue
            seen.add(level_id)
            label = (level_rus or "").strip() or LEGACY_LEVEL_LABELS.get(level_id) or level_slug
            options.append({"id": level_id, "label": label})

    if options:
        options.sort(key=lambda item: (_LEVEL_SORT_ORDER.get(item["id"], 99), item["label"], item["id"]))
        return options

    return [{"id": key, "label": label} for key, label in LEGACY_LEVEL_LABELS.items()]


def normalize_plan_level_id(value):
    level_id = _normalize_level_id(value)
    if not level_id:
        return level_id

    options = {item["id"] for item in get_plan_level_options()}

    if level_id in ("впр",) and "vpr" in options:
        return "vpr"
    if level_id in ("огэ",) and "oge" in options:
        return "oge"
    if level_id in ("егэ", "ёгэ") and "ege" in options:
        return "ege"
    if level_id in ("школа", "школьная программа", "школьная база") and "school" in options:
        return "school"

    return level_id


def get_plan_level_label(value):
    level_id = _normalize_level_id(value)
    if not level_id:
        return ""
    normalized = normalize_plan_level_id(level_id)
    for item in get_plan_level_options():
        if item["id"] == normalized or item["id"] == level_id:
            return item["label"]
    return LEGACY_LEVEL_LABELS.get(normalized) or LEGACY_LEVEL_LABELS.get(level_id) or value
