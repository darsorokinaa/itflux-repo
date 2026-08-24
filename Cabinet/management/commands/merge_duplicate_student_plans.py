"""Объединить дубли автопланов учеников.

По умолчанию dry-run:

    python manage.py merge_duplicate_student_plans
    python manage.py merge_duplicate_student_plans --teacher-id=123
    python manage.py merge_duplicate_student_plans --apply
"""

from __future__ import annotations

from django.core.management.base import BaseCommand

from Cabinet.plan_dedupe import merge_duplicate_student_plans


class Command(BaseCommand):
    help = (
        "Объединяет дубли «План: Ученик — Предмет» в один план ученика. "
        "Пункты, занятия и журнал не удаляются. Лишние планы архивируются."
    )

    def add_arguments(self, parser):
        parser.add_argument("--apply", action="store_true", help="Записать изменения")
        parser.add_argument("--teacher-id", type=int, default=None)

    def handle(self, *args, **options):
        apply = bool(options.get("apply"))
        teacher_id = options.get("teacher_id")
        report = merge_duplicate_student_plans(teacher_id=teacher_id, apply=apply)

        if not report["group_count"]:
            self.stdout.write("Дублей автопланов не найдено.")
            return

        self.stdout.write(
            f"Групп дублей: {report['group_count']}, "
            f"планов к архивации: {report['archived_plans']}, "
            f"пунктов к переносу: {report['moved_items']}"
        )
        for group in report["groups"]:
            self.stdout.write(
                f"  [{group['reason']}] канон #{group['canonical_id']} "
                f"«{group['canonical_title']}» ← {group['duplicate_ids']} "
                f"(тем: {group['moved_items']})"
            )
        if not apply:
            self.stdout.write(self.style.WARNING(
                "dry-run: ничего не изменено. Для записи: --apply"
            ))
        else:
            self.stdout.write(self.style.SUCCESS(
                f"Готово. Архивировано планов: {report['archived_plans']}"
            ))
