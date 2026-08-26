"""Сид номеров и тем ЕГЭ по химии в TaskList.

На проде (после migrate, из каталога с manage.py):

    python manage.py seed_ege_chem_tasklists --dry-run
    python manage.py seed_ege_chem_tasklists
"""

from django.core.management.base import BaseCommand
from django.db import transaction

from Generator.ege_chem_tasklists import seed_ege_chem_tasklists
from Generator.models import Level, Part, Subject, TaskList


class Command(BaseCommand):
    help = "Прод-скрипт: создать/обновить TaskList 1–34 для ЕГЭ по химии (chem/ege)"

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Показать, что будет создано/обновлено, без записи в БД",
        )

    def handle(self, *args, **options):
        dry_run = bool(options.get("dry_run"))
        if dry_run:
            result = seed_ege_chem_tasklists(
                Subject, Level, Part, TaskList, dry_run=True
            )
        else:
            with transaction.atomic():
                result = seed_ege_chem_tasklists(Subject, Level, Part, TaskList)

        prefix = "DRY-RUN " if result["dry_run"] else ""
        self.stdout.write(
            self.style.SUCCESS(
                f"{prefix}chem/ege: создать {result['created']}, "
                f"обновить {result['updated']}, без изменений {result['skipped']}, "
                f"всего {result['total']}"
            )
        )
