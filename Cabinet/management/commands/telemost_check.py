import json

from django.core.management.base import BaseCommand

from Cabinet.telemost import diagnose_telemost_config


class Command(BaseCommand):
    help = "Проверка OAuth и доступа к API Яндекс Телемост / CalDAV"

    def handle(self, *args, **options):
        report = diagnose_telemost_config()
        self.stdout.write(json.dumps(report, ensure_ascii=False, indent=2))

        self.stdout.write("")
        api_test = report.get("api_test") or {}
        if api_test.get("ok"):
            self.stdout.write(self.style.SUCCESS("API Телемоста: OK"))
        elif report.get("token_ok"):
            self.stdout.write(self.style.ERROR("API Телемоста: недоступен"))
        else:
            self.stdout.write(self.style.ERROR("OAuth-токен: не получен"))

        for step in report.get("next_steps") or []:
            self.stdout.write(f"→ {step}")
