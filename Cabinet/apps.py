from django.apps import AppConfig


class CabinetConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "Cabinet"

    def ready(self):
        from . import signals  # noqa: F401
