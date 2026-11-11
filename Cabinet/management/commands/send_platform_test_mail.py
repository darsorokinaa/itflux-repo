from django.conf import settings
from django.contrib.auth.models import User
from django.core.management.base import BaseCommand, CommandError

from Cabinet.platform_mail import send_confirmation_email
from Cabinet.views import _send_password_reset_email


class Command(BaseCommand):
    help = (
        "Отправить на указанный адрес тестовое письмо восстановления пароля "
        "и тестовое письмо подтверждения почты через настроенный SMTP."
    )

    def add_arguments(self, parser):
        parser.add_argument("email", help="Адрес существующего пользователя")

    def handle(self, *args, **options):
        email = str(options["email"] or "").strip()
        if not email:
            raise CommandError("Укажите email")
        if not str(getattr(settings, "EMAIL_HOST_USER", "") or "").strip():
            raise CommandError(
                "SMTP не настроен: задайте EMAIL_HOST, EMAIL_PORT, EMAIL_USE_SSL, "
                "EMAIL_HOST_USER, EMAIL_HOST_PASSWORD и DEFAULT_FROM_EMAIL"
            )
        user = User.objects.filter(email__iexact=email).first()
        if user is None:
            raise CommandError(f"Пользователь с email {email} не найден")
        reset_ok = _send_password_reset_email(None, user)
        confirm_ok = send_confirmation_email(user, force=True)
        if not reset_ok or not confirm_ok:
            raise CommandError(
                "Не удалось отправить одно из писем. Проверьте EMAIL_* и логи сервера."
            )
        self.stdout.write(self.style.SUCCESS(
            f"Отправлены письма восстановления пароля и подтверждения почты на {email} "
            f"с адреса {settings.DEFAULT_FROM_EMAIL} через {settings.EMAIL_HOST}:{settings.EMAIL_PORT}"
        ))
