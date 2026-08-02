"""Generate VAPID key pair for Web Push."""

from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = "Generate VAPID keys for Web Push"

    def handle(self, *args, **options):
        try:
            from py_vapid import Vapid
        except ImportError as exc:
            raise SystemExit("Install dependencies first: pip install pywebpush") from exc

        import base64
        from cryptography.hazmat.primitives import serialization

        vapid = Vapid()
        vapid.generate_keys()

        # One-line DER (base64url) — удобно для .env, pywebpush/py_vapid это понимают.
        private_der = vapid.private_key.private_bytes(
            encoding=serialization.Encoding.DER,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        )
        private_b64 = base64.urlsafe_b64encode(private_der).decode("utf-8").rstrip("=")

        public_raw = vapid.public_key.public_bytes(
            encoding=serialization.Encoding.X962,
            format=serialization.PublicFormat.UncompressedPoint,
        )
        public_b64 = base64.urlsafe_b64encode(public_raw).decode("utf-8").rstrip("=")

        self.stdout.write(self.style.SUCCESS("Add these lines to your .env:\n"))
        self.stdout.write(f"VAPID_PUBLIC_KEY={public_b64}")
        self.stdout.write(f"VAPID_PRIVATE_KEY={private_b64}")
        self.stdout.write("VAPID_ADMIN_EMAIL=mailto:admin@itflux.ru")
        self.stdout.write("")
        self.stdout.write(
            self.style.WARNING(
                "После смены ключей пользователям нужно заново нажать "
                "«Включить на этом устройстве»."
            )
        )
