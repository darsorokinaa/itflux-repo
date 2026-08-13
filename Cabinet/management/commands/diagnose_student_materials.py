"""Только чтение: диагностика выдачи материалов ученикам."""

from __future__ import annotations

import json

from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = (
        "Аудит выдачи материалов ученикам (только чтение). "
        "Пример: python manage.py diagnose_student_materials --json"
    )

    def add_arguments(self, parser):
        parser.add_argument("--student-id", type=int, default=None)
        parser.add_argument("--teacher-id", type=int, default=None)
        parser.add_argument("--json", action="store_true", help="Вывод в JSON")

    def handle(self, *args, **options):
        from Cabinet.student_materials_audit import build_student_materials_audit

        report = build_student_materials_audit(
            student_id=options.get("student_id"),
            teacher_id=options.get("teacher_id"),
        )
        if options.get("json"):
            self.stdout.write(json.dumps(report, ensure_ascii=False, indent=2, default=str))
            return

        counts = report["counts"]
        self.stdout.write("Student materials audit (read-only)")
        self.stdout.write(
            f"students={counts['students']} direct={counts['direct_assignments']} "
            f"lessons={counts['lesson_assignments']} homework={counts['homeworks']} "
            f"materials={counts['materials']}"
        )
        self.stdout.write(f"types={counts['materials_by_type']}")
        issues = report["issues"]
        if not issues:
            self.stdout.write(self.style.SUCCESS("Замечаний не найдено."))
            return
        for issue in issues:
            self.stdout.write(
                f"[{issue['severity']}] {issue['code']} count={issue['count']} "
                f"sample={issue['sample_ids']}"
            )
            self.stdout.write(f"  {issue['note']}")
