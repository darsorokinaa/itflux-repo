"""
python manage.py seed_catalog_lesson_plans
python manage.py seed_catalog_lesson_plans --key math-oge
python manage.py seed_catalog_lesson_plans --key phys-oge
python manage.py seed_catalog_lesson_plans --key inf-oge
python manage.py seed_catalog_lesson_plans --key rus-oge

Создаёт или обновляет публичные шаблоны в «Готовых планах».
Повторный запуск безопасен: дубли не создаются, темы синхронизируются по порядку.
"""

from django.core.management.base import BaseCommand, CommandError

from Cabinet.catalog_plans import ALL_PLANS, sync_all_catalog_plans


class Command(BaseCommand):
    help = "Создаёт или обновляет публичные планы обучения (каталог)"

    def add_arguments(self, parser):
        parser.add_argument(
            "--key",
            action="append",
            dest="keys",
            default=[],
            help="Ключ плана (можно несколько). Сейчас доступны: math-oge, phys-oge, inf-oge, rus-oge",
        )

    def handle(self, *args, **options):
        keys = options.get("keys") or []
        known = {spec["key"] for spec in ALL_PLANS}
        unknown = [key for key in keys if key not in known]
        if unknown:
            raise CommandError(
                f"Неизвестный ключ: {', '.join(unknown)}. Известные: {', '.join(sorted(known))}"
            )

        results = sync_all_catalog_plans(keys=keys or None)
        if not results:
            self.stdout.write(self.style.WARNING("Нечего синхронизировать."))
            return

        for plan, created in results:
            action = "Создан" if created else "Обновлён"
            self.stdout.write(
                f"  {action}: {plan.title} · {plan.items.count()} занятий · is_public={plan.is_public}"
            )
        self.stdout.write(self.style.SUCCESS(f"Готово: {len(results)} план(ов)."))
