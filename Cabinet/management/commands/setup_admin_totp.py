"""Создать/показать TOTP-устройство для входа в Django admin."""

from __future__ import annotations

import base64
from pathlib import Path
from urllib.parse import quote, urlencode

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError


def _otpauth_url(*, issuer: str, account: str, secret_b32: str) -> str:
    """URL, который нормально сканируют Google Authenticator / Authy / Яндекс.Ключ.

    django-otp по умолчанию отдаёт otpauth://totp/admin?secret=... без issuer —
    многие приложения отвечают «не удалось отсканировать код».
    """
    label = f"{issuer}:{account}"
    query = urlencode(
        {
            "secret": secret_b32,
            "issuer": issuer,
            "algorithm": "SHA1",
            "digits": "6",
            "period": "30",
        }
    )
    return f"otpauth://totp/{quote(label)}?{query}"


class Command(BaseCommand):
    help = (
        "Создаёт подтверждённое TOTP-устройство для staff/superuser, печатает "
        "base32-секрет и сохраняет PNG с QR для сканирования."
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
        parser.add_argument(
            "--issuer",
            default="itflux-admin",
            help="Issuer в Authenticator (по умолчанию itflux-admin)",
        )
        parser.add_argument(
            "--ensure-staff",
            action="store_true",
            help="Если пользователь не staff — выдать is_staff=True (нужно для /admin/)",
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
            if options["ensure_staff"]:
                user.is_staff = True
                user.save(update_fields=["is_staff"])
                self.stdout.write(self.style.WARNING(f"Выдан is_staff пользователю {username}"))
            else:
                raise CommandError(
                    "Пользователь должен быть staff или superuser. "
                    "Передайте --ensure-staff, чтобы выдать доступ в /admin/."
                )

        allowed = getattr(settings, "ADMIN_OTP_ALLOWED_USERNAMES", None)
        if allowed is not None and username.strip().lower() not in allowed:
            self.stdout.write(
                self.style.WARNING(
                    f"Username {username!r} нет в ADMIN_OTP_ALLOWED_USERNAMES "
                    f"({', '.join(sorted(allowed))}). После создания TOTP вход будет "
                    "разрешён по confirmed-устройству. Чтобы не зависеть от этого, "
                    "добавьте имя в /etc/itflux/itflux.env и перезапустите itflux:\n"
                    f"  ADMIN_OTP_ALLOWED_USERNAMES={','.join(sorted(allowed))},{username}"
                )
            )

        if options["replace"]:
            deleted, _ = TOTPDevice.objects.filter(user=user).delete()
            self.stdout.write(f"Удалено устройств: {deleted}")

        device = TOTPDevice.objects.create(
            user=user,
            name=options["name"],
            confirmed=True,
        )
        secret_b32 = base64.b32encode(device.bin_key).decode("ascii").rstrip("=")
        config_url = _otpauth_url(
            issuer=options["issuer"],
            account=username,
            secret_b32=secret_b32,
        )

        out_dir = Path(settings.BASE_DIR) / "tmp" / "otp"
        out_dir.mkdir(parents=True, exist_ok=True)
        qr_path = out_dir / f"totp-{username}.png"

        try:
            import qrcode
        except ImportError as exc:
            raise CommandError("Установите qrcode: pip install qrcode[pil]") from exc

        img = qrcode.make(config_url)
        img.save(qr_path)

        self.stdout.write(self.style.SUCCESS(f"TOTP создан для {username} (device id={device.pk})"))
        self.stdout.write("")
        self.stdout.write(self.style.WARNING("Способ 1 — отсканировать QR:"))
        self.stdout.write(f"  откройте файл: {qr_path}")
        self.stdout.write("")
        self.stdout.write(self.style.WARNING("Способ 2 — ручной ввод в Authenticator:"))
        self.stdout.write(f"  Account: {username}")
        self.stdout.write(f"  Key / Secret (base32): {secret_b32}")
        self.stdout.write("  Type: Time based | Digits: 6 | Period: 30")
        self.stdout.write("")
        self.stdout.write(f"otpauth URL:\n{config_url}")
        self.stdout.write("")
        self.stdout.write(
            "После добавления войдите в /admin/ с логином, паролем и 6-значным кодом из приложения."
        )
