from django.apps import AppConfig


class CabinetConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "Cabinet"

    def ready(self):
        from . import call_stats_admin, call_stats_models, signals, telemost_models  # noqa: F401
