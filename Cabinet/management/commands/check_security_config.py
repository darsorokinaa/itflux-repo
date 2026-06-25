"""python manage.py check_security_config — проверка env без вывода секретов."""

from django.conf import settings
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = "Проверяет, что обязательные переменные окружения заданы (без показа значений)"

    def handle(self, *args, **options):
        debug = settings.DEBUG
        secret_ok = settings.SECRET_KEY and settings.SECRET_KEY != "dev-insecure-secret-key-local-only"
        hosts = list(settings.ALLOWED_HOSTS)
        lesson = bool(getattr(settings, "LESSON_SECRET", ""))

        issues = []
        if not debug:
            if not secret_ok:
                issues.append("SECRET_KEY / DJANGO_SECRET_KEY не задан или dev-заглушка")
            if not hosts or hosts == ["*"]:
                issues.append("DJANGO_ALLOWED_HOSTS не задан")
            if not lesson:
                issues.append("LESSON_SECRET не задан (ссылки на ДЗ/уроки не работают)")

        if issues:
            self.stdout.write(self.style.ERROR("Проблемы конфигурации:"))
            for item in issues:
                self.stdout.write(f"  • {item}")
            return

        self.stdout.write(self.style.SUCCESS("Конфигурация OK"))
        self.stdout.write(f"  DEBUG={debug}")
        self.stdout.write(f"  ALLOWED_HOSTS={', '.join(hosts)}")
        self.stdout.write(f"  SECRET_KEY={'задан' if secret_ok else 'dev'}")
        self.stdout.write(f"  LESSON_SECRET={'задан' if lesson else 'нет'}")
