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
        private_pem = vapid.private_pem()
        if isinstance(private_pem, bytes):
            private_pem = private_pem.decode("utf-8")

        public_raw = vapid.public_key.public_bytes(
            encoding=serialization.Encoding.X962,
            format=serialization.PublicFormat.UncompressedPoint,
        )
        public_b64 = base64.urlsafe_b64encode(public_raw).decode("utf-8").rstrip("=")

        self.stdout.write(self.style.SUCCESS("Add these lines to your .env:\n"))
        self.stdout.write(f"VAPID_PUBLIC_KEY={public_b64}")
        # pywebpush accepts raw private key string; store PEM escaped or as multiline secret
        one_line = private_pem.replace("\n", "\\n")
        self.stdout.write(f"VAPID_PRIVATE_KEY={one_line}")
        self.stdout.write("VAPID_ADMIN_EMAIL=mailto:admin@itflux.ru")
