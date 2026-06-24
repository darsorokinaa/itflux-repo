from django.core.management.base import BaseCommand

from Cabinet.interactive_appearance import seed_interactive_appearance


class Command(BaseCommand):
    help = "Создаёт пресеты фонов, стилей карточек и звуков для интерактивов"

    def handle(self, *args, **options):
        seed_interactive_appearance()
        self.stdout.write(self.style.SUCCESS("Пресеты оформления интерактивов обновлены"))
