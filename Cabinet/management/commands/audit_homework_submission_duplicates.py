"""Read-only: дубли HomeworkSubmission по (homework, student)."""

from __future__ import annotations

import json
from pathlib import Path

from django.core.management.base import BaseCommand
from django.db.models import Count
from django.utils import timezone

from Cabinet.models import HomeworkSubmission, HomeworkSubmissionAttempt


class Command(BaseCommand):
    help = (
        "Поиск дублей сдач ДЗ (homework+student). Только чтение. "
        "python manage.py audit_homework_submission_duplicates [--output=dups.json]"
    )

    def add_arguments(self, parser):
        parser.add_argument("--output", type=str, default="", help="Путь к JSON-отчёту")

    def handle(self, *args, **options):
        report = self._build_report()
        self._print_summary(report)
        output = (options.get("output") or "").strip()
        if output:
            path = Path(output)
            path.write_text(
                json.dumps(report, ensure_ascii=False, indent=2, default=str),
                encoding="utf-8",
            )
            self.stdout.write(self.style.SUCCESS(f"Отчёт сохранён: {path}"))

    def _build_report(self) -> dict:
        groups = list(
            HomeworkSubmission.objects.values("homework_id", "student_id")
            .annotate(c=Count("id"))
            .filter(c__gt=1)
            .order_by("-c", "homework_id")
        )
        details = []
        different_answers = 0
        with_attempts = 0
        for group in groups[:200]:
            rows = list(
                HomeworkSubmission.objects.filter(
                    homework_id=group["homework_id"],
                    student_id=group["student_id"],
                ).order_by("id")
            )
            answers = {(row.answer_text or "").strip() for row in rows}
            payloads = {_payload_key(row.result_payload) for row in rows}
            statuses = [row.status for row in rows]
            attempt_count = HomeworkSubmissionAttempt.objects.filter(
                submission__in=rows
            ).count()
            if len(answers) > 1 or len(payloads) > 1:
                different_answers += 1
            if attempt_count:
                with_attempts += 1
            details.append({
                "homework_id": group["homework_id"],
                "student_id": group["student_id"],
                "count": group["c"],
                "ids": [row.id for row in rows],
                "statuses": statuses,
                "submitted": [bool(row.submitted_at) for row in rows],
                "unique_answers": len(answers),
                "unique_payloads": len(payloads),
                "attempt_rows": attempt_count,
            })
        return {
            "generated_at": timezone.now().isoformat(),
            "submissions_total": HomeworkSubmission.objects.count(),
            "duplicate_groups": len(groups),
            "groups_with_different_content": different_answers,
            "groups_with_attempt_history": with_attempts,
            "groups": details,
            "note": "Только чтение. Дубли не удаляются. Repair нужен отдельный флаг.",
        }

    def _print_summary(self, report: dict) -> None:
        self.stdout.write("Аудит дублей HomeworkSubmission (данные не изменены)")
        self.stdout.write(f"  submissions_total: {report['submissions_total']}")
        self.stdout.write(f"  duplicate_groups: {report['duplicate_groups']}")
        self.stdout.write(
            f"  groups_with_different_content: {report['groups_with_different_content']}"
        )
        for row in (report.get("groups") or [])[:20]:
            self.stdout.write(
                f"    hw={row['homework_id']} student={row['student_id']} "
                f"count={row['count']} statuses={row['statuses']}"
            )
        self.stdout.write("Repair не запускался.")


def _payload_key(payload) -> str:
    if not isinstance(payload, dict):
        return ""
    by_id = payload.get("by_task_id")
    if not isinstance(by_id, dict):
        return ""
    items = tuple(sorted((str(k), str(v)) for k, v in by_id.items()))
    return repr(items)
