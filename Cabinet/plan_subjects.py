from django.apps import apps


LEGACY_SUBJECT_LABELS = {
    "informatics": "Информатика",
    "inf": "Информатика",
    "math": "Математика",
    "math_base": "Математика базовая",
    "prog": "Программирование",
    "rus": "Русский язык",
    "other": "Другое",
}


def _normalize_subject_id(value):
    return (str(value or "")).strip().lower()


def get_plan_subject_options():
    """Предметы для планов уроков из БД предметов Generator.Subject."""
    try:
        subject_model = apps.get_model("Generator", "Subject")
    except LookupError:
        subject_model = None

    options = []
    seen = set()
    if subject_model is not None:
        rows = subject_model.objects.order_by("subject_name", "subject_short").values_list(
            "subject_short", "subject_name"
        )
        for subject_short, subject_name in rows:
            subject_id = _normalize_subject_id(subject_short)
            if not subject_id or subject_id in seen:
                continue
            seen.add(subject_id)
            options.append(
                {
                    "id": subject_id,
                    "label": (subject_name or subject_short or "").strip() or subject_id,
                }
            )

    if options:
        return options

    return [{"id": key, "label": label} for key, label in LEGACY_SUBJECT_LABELS.items()]


def normalize_plan_subject_id(value):
    subject_id = _normalize_subject_id(value)
    if subject_id == "informatics":
        options = {item["id"] for item in get_plan_subject_options()}
        if "inf" in options:
            return "inf"
    return subject_id


def get_plan_subject_label(value):
    subject_id = _normalize_subject_id(value)
    if not subject_id:
        return ""
    for item in get_plan_subject_options():
        if item["id"] == subject_id:
            return item["label"]
    return LEGACY_SUBJECT_LABELS.get(subject_id, value)
