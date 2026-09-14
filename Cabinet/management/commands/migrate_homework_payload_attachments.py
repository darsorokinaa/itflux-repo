from django.core.management.base import BaseCommand

from Cabinet.homework_task_files import migrate_submission_payload_attachments
from Cabinet.models import HomeworkSubmission


class Command(BaseCommand):
    help = "Переносит вложения из HomeworkSubmission.result_payload в таблицу HomeworkAttachment."

    def add_arguments(self, parser):
        parser.add_argument("--submission-id", type=int, default=None)
        parser.add_argument("--dry-run", action="store_true")

    def handle(self, *args, **options):
        qs = HomeworkSubmission.objects.all().order_by("id")
        if options.get("submission_id"):
            qs = qs.filter(pk=options["submission_id"])
        total_created = 0
        total_skipped = 0
        ambiguous = []
        scanned = 0
        dry = bool(options.get("dry_run"))
        for submission in qs.iterator():
            payload = submission.result_payload if isinstance(submission.result_payload, dict) else {}
            if not any(
                payload.get(key)
                for key in (
                    "attachments_by_task_id",
                    "attachments_by_number",
                    "teacher_attachments_by_task_id",
                    "teacher_attachments_by_number",
                    "teacher_comment_attachments",
                )
            ):
                continue
            scanned += 1
            if dry:
                continue
            report = migrate_submission_payload_attachments(submission)
            total_created += report["created"]
            total_skipped += report["skipped_existing"]
            for item in report["ambiguous"]:
                ambiguous.append({"submission_id": submission.pk, **item})
            for item in report.get("notes") or []:
                self.stdout.write(
                    f"KEPT submission={submission.pk} number={item.get('task_number')} "
                    f"task_key={item.get('task_key')} reason={item.get('reason')} "
                    f"count={item.get('count')}"
                )
        self.stdout.write(
            f"submissions_with_json={scanned} created={total_created} "
            f"skipped_existing={total_skipped} ambiguous={len(ambiguous)}"
        )
        for item in ambiguous:
            self.stdout.write(f"AMBIGUOUS {item}")
