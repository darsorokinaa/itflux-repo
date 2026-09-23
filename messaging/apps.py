from django.apps import AppConfig


class MessagingConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "messaging"
    verbose_name = "Сообщения"

    def ready(self):
        from . import checks  # noqa: F401
