"""Создать/показать TOTP-устройство для входа в Django admin."""

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError


class Command(BaseCommand):
    help = (
        "Создаёт подтверждённое TOTP-устройство для staff/superuser и печатает "
        "секрет / otpauth URL для приложения-аутентификатора."
    )

    def add_arguments(self, parser):
        parser.add_argument("username", type=str, help="Имя пользователя Django")
        parser.add_argument(
            "--name",
            default="admin",
            help="Имя устройства (по умолчанию admin)",
        )
        parser.add_argument(
            "--replace",
            action="store_true",
            help="Удалить существующие TOTP-устройства пользователя перед созданием",
        )

    def handle(self, *args, **options):
        try:
            from django_otp.plugins.otp_totp.models import TOTPDevice
        except ImportError as exc:
            raise CommandError("Установите django-otp: pip install django-otp qrcode") from exc

        User = get_user_model()
        username = options["username"]
        try:
            user = User.objects.get(username=username)
        except User.DoesNotExist as exc:
            raise CommandError(f"Пользователь {username!r} не найден") from exc

        if not (user.is_staff or user.is_superuser):
            raise CommandError("Пользователь должен быть staff или superuser")

        if options["replace"]:
            deleted, _ = TOTPDevice.objects.filter(user=user).delete()
            self.stdout.write(f"Удалено устройств: {deleted}")

        device = TOTPDevice.objects.create(
            user=user,
            name=options["name"],
            confirmed=True,
        )
        try:
            config_url = device.config_url
        except Exception:
            config_url = ""

        self.stdout.write(self.style.SUCCESS(f"TOTP создан для {username} (device id={device.pk})"))
        self.stdout.write(f"Secret: {device.key}")
        if config_url:
            self.stdout.write(f"otpauth URL:\n{config_url}")
        self.stdout.write(
            "Добавьте секрет в Google Authenticator / Authy, затем войдите в /admin/ с кодом."
        )
