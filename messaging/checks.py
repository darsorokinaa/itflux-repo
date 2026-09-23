from django.core.checks import Error, Tags, register

from .retention import REQUIRED_RETENTION_KINDS, missing_retention_kinds


def _retention_errors():
    missing = missing_retention_kinds()
    if not missing:
        return []
    return [
        Error(
            "Retention policy is not configured.",
            hint=(
                "Задайте RetentionPolicy.retain_days для: "
                + ", ".join(REQUIRED_RETENTION_KINDS)
                + ". Числа дней берутся из юридического решения, не из кода."
            ),
            id="messaging.E001",
        )
    ]


def _channel_errors():
    from django.conf import settings

    backend = (
        (settings.CHANNEL_LAYERS or {})
        .get("default", {})
        .get("BACKEND", "")
    )
    if "RedisChannelLayer" in backend:
        return []
    return [
        Error(
            "Messaging channel layer is not Redis.",
            hint="Перед production сообщений установите CHANNEL_LAYER_BACKEND=redis. Существующие сокеты досок не переключаются сами.",
            id="messaging.E002",
        )
    ]


def _cache_errors():
    from django.conf import settings

    backend = (
        (settings.CACHES or {})
        .get("default", {})
        .get("BACKEND", "")
    )
    if "locmem" not in backend.lower():
        return []
    return [
        Error(
            "Messaging rate limit cache is process-local.",
            hint="Перед production сообщений используйте общий Redis cache.",
            id="messaging.E003",
        )
    ]


@register(Tags.security, deploy=True)
def messaging_deploy_checks(app_configs, **kwargs):
    return _retention_errors() + _channel_errors() + _cache_errors()


def messaging_is_blocked() -> bool:
    """Раздел открыт и на production.

    Сроки хранения и Redis по-прежнему видны в manage.py check --deploy
    (messaging.E001–E003). Пока сроки не заданы, сообщения не удаляются.
    Один процесс Daphne обслуживает сокеты и без Redis.
    """
    return False
