from django.core.management.base import BaseCommand

from Cabinet.homework_backfill import (
    backfill_unsubmitted_homework_with_answers,
    cleanup_live_meeting_review_items,
)


class Command(BaseCommand):
    help = (
        "Проставить submitted_at и ReviewItem для сдач ДЗ, где есть ответы ученика, "
        "но отправка не была зафиксирована (сбой кнопки «Отправить»). "
        "Варианты с урока (live-meeting) пропускаются."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Только показать, что будет обновлено, без записи в БД.",
        )
        parser.add_argument(
            "--cleanup-live",
            action="store_true",
            help="Удалить ReviewItem по live-вариантам с урока из очереди «Проверка».",
        )

    def handle(self, *args, **options):
        dry_run = bool(options.get("dry_run"))
        prefix = "DRY-RUN " if dry_run else ""
        if options.get("cleanup_live"):
            cleaned = cleanup_live_meeting_review_items(dry_run=dry_run)
            self.stdout.write(
                self.style.SUCCESS(
                    f"{prefix}cleanup_live deleted={cleaned['deleted']} "
                    f"review_ids={cleaned['review_ids']}"
                )
            )
            return

        stats = backfill_unsubmitted_homework_with_answers(dry_run=dry_run)
        self.stdout.write(
            self.style.SUCCESS(
                f"{prefix}scanned={stats['scanned']} with_work={stats['with_work']} "
                f"submitted_at_set={stats['submitted_at_set']} "
                f"review_created={stats['review_created']} "
                f"review_exists={stats['review_exists']} "
                f"skipped_live={stats['skipped_live']} "
                f"skipped_no_work={stats['skipped_no_work']} "
                f"ids={stats['ids']}"
            )
        )
