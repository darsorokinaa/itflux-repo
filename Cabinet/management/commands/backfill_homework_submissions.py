from django.core.management.base import BaseCommand

from Cabinet.homework_backfill import backfill_unsubmitted_homework_with_answers


class Command(BaseCommand):
    help = (
        "Проставить submitted_at и ReviewItem для сдач ДЗ, где есть ответы ученика, "
        "но отправка не была зафиксирована (сбой кнопки «Отправить»)."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Только показать, что будет обновлено, без записи в БД.",
        )

    def handle(self, *args, **options):
        dry_run = bool(options.get("dry_run"))
        stats = backfill_unsubmitted_homework_with_answers(dry_run=dry_run)
        prefix = "DRY-RUN " if dry_run else ""
        self.stdout.write(
            self.style.SUCCESS(
                f"{prefix}scanned={stats['scanned']} with_work={stats['with_work']} "
                f"submitted_at_set={stats['submitted_at_set']} "
                f"review_created={stats['review_created']} "
                f"review_exists={stats['review_exists']} "
                f"live_recovered={stats['live_recovered']} "
                f"skipped_no_work={stats['skipped_no_work']} "
                f"ids={stats['ids']}"
            )
        )
