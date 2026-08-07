"""Создать/показать TOTP-устройство для входа в Django admin."""

from base64 import b32encode
from pathlib import Path
from urllib.parse import quote, urlencode

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError


class Command(BaseCommand):
    help = (
        "Создаёт подтверждённое TOTP-устройство для staff/superuser и печатает "
        "Base32-секрет, otpauth URL и QR (ASCII + PNG) для Authenticator."
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
            "--show",
            action="store_true",
            help="Только показать секрет/QR существующего устройства (не создавать новое)",
        )
        parser.add_argument(
            "--issuer",
            default="ITFlux",
            help="Имя сервиса в Authenticator (по умолчанию ITFlux)",
        )
        parser.add_argument(
            "--qr-file",
            default="admin-totp-qr.png",
            help="Куда сохранить PNG с QR (по умолчанию ./admin-totp-qr.png)",
        )
        parser.add_argument(
            "--no-qr",
            action="store_true",
            help="Не печатать ASCII QR и не писать PNG",
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

        if options["show"]:
            device = (
                TOTPDevice.objects.filter(user=user, confirmed=True)
                .order_by("-id")
                .first()
            )
            if device is None:
                raise CommandError(
                    "У пользователя нет TOTP-устройства. Запустите без --show "
                    "(или с --replace)."
                )
        else:
            if options["replace"]:
                deleted, _ = TOTPDevice.objects.filter(user=user).delete()
                self.stdout.write(f"Удалено устройств: {deleted}")
            elif TOTPDevice.objects.filter(user=user).exists():
                self.stdout.write(
                    self.style.WARNING(
                        "У пользователя уже есть TOTP. Если старый секрет не подходит — "
                        "повторите с --replace. Или используйте --show."
                    )
                )

            device = TOTPDevice.objects.create(
                user=user,
                name=options["name"],
                confirmed=True,
            )
            self.stdout.write(
                self.style.SUCCESS(f"TOTP создан для {username} (device id={device.pk})")
            )

        # Authenticator apps expect Base32 without '=' padding.
        # device.key is hex — do NOT paste it into Authenticator.
        secret_b32 = b32encode(device.bin_key).decode("ascii").rstrip("=")
        issuer = (options["issuer"] or "ITFlux").replace(":", "")
        label = f"{issuer}:{username}"
        # Build otpauth ourselves so the URL is QR-safe (no wrapped hex, no padding).
        # Use quote (not '+') — Google Authenticator is picky about issuer encoding.
        query = urlencode(
            {
                "secret": secret_b32,
                "issuer": issuer,
                "algorithm": "SHA1",
                "digits": str(device.digits),
                "period": str(device.step),
            },
            quote_via=quote,
        )
        config_url = f"otpauth://totp/{quote(label)}?{query}"

        self.stdout.write("")
        self.stdout.write(self.style.SUCCESS("=== Ручной ввод (предпочтительно) ==="))
        self.stdout.write(f"Аккаунт: {label}")
        self.stdout.write(f"Ключ (Base32): {secret_b32}")
        self.stdout.write("Тип: по времени (Time based), 6 цифр, 30 сек")
        self.stdout.write("")
        self.stdout.write("otpauth URL (одна строка, без переносов):")
        self.stdout.write(config_url)
        self.stdout.write("")

        if not options["no_qr"]:
            self._emit_qr(config_url, options["qr_file"])

        self.stdout.write(
            "Если сканирование QR падает — введите Base32-ключ вручную "
            "(+ → Ввести ключ настройки). Не используйте hex из БД."
        )

    def _emit_qr(self, config_url: str, qr_file: str) -> None:
        try:
            import qrcode
        except ImportError:
            self.stdout.write(
                self.style.WARNING("Пакет qrcode не установлен — PNG/ASCII QR пропущен.")
            )
            return

        qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, border=2)
        qr.add_data(config_url)
        qr.make(fit=True)

        self.stdout.write("=== QR (наведите камеру Authenticator) ===")
        try:
            qr.print_ascii(out=self.stdout, invert=True)
        except Exception:
            self.stdout.write(self.style.WARNING("Не удалось напечатать ASCII QR."))

        out_path = Path(qr_file).expanduser()
        png_ok = False
        try:
            img = self._make_qr_image(qr)
            img.save(out_path)
            png_ok = True
            self.stdout.write(self.style.SUCCESS(f"QR PNG: {out_path.resolve()}"))
        except Exception as exc:
            self.stdout.write(self.style.WARNING(f"PNG недоступен ({exc}); сохраняю SVG."))

        svg_path = out_path.with_suffix(".svg")
        try:
            svg_path.write_text(self._qr_to_svg(qr), encoding="utf-8")
            self.stdout.write(self.style.SUCCESS(f"QR SVG: {svg_path.resolve()}"))
            self.stdout.write(
                "Откройте PNG/SVG на телефоне или другом экране и отсканируйте. "
                "Не копируйте URL в онлайн-генератор QR — перенос строки ломает код."
            )
        except Exception as exc:
            if not png_ok:
                self.stdout.write(self.style.WARNING(f"Не удалось сохранить QR-файл: {exc}"))
        self.stdout.write("")

    @staticmethod
    def _make_qr_image(qr):
        """Prefer Pillow; fall back to pure-Python PNG factory if installed."""
        try:
            return qr.make_image(fill_color="black", back_color="white")
        except Exception:
            import qrcode.image.pure

            return qr.make_image(image_factory=qrcode.image.pure.PyPNGImage)

    @staticmethod
    def _qr_to_svg(qr, scale: int = 8) -> str:
        """Minimal SVG QR — no Pillow/pypng required."""
        matrix = qr.get_matrix()
        n = len(matrix)
        size = n * scale
        parts = [
            f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" '
            f'viewBox="0 0 {n} {n}" shape-rendering="crispEdges">',
            '<rect width="100%" height="100%" fill="#fff"/>',
        ]
        for y, row in enumerate(matrix):
            for x, cell in enumerate(row):
                if cell:
                    parts.append(f'<rect x="{x}" y="{y}" width="1" height="1" fill="#000"/>')
        parts.append("</svg>")
        return "\n".join(parts)
