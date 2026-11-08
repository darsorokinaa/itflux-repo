"""Убрать из ВПР информатика 8 (задание 6) фразу «В ответе запишите 4 цифры…».

Ответ, если он не совпадает с таблицей по строкам, переписывается построчно.
Затрагиваются только задания: уровень vpr, предмет inf, номер 6, класс 8,
текст «Заполните таблицу истинности».

    python manage.py fix_vpr_inf8_truth_table_prompts
    python manage.py fix_vpr_inf8_truth_table_prompts --apply

Без --apply ничего не записывает. Повторный запуск после применения ничего не меняет.
Production из этого репозитория командой не запускается.
"""

from __future__ import annotations

from django.core.management.base import BaseCommand
from django.db import transaction

from Generator.vpr_truth_table_tasks import affected_tasks, apply_task, plan_changes


class Command(BaseCommand):
    help = "ВПР инф. 8, задание 6: убрать указание про цифры и записать ответ по строкам таблицы."

    def add_arguments(self, parser):
        parser.add_argument(
            "--apply",
            action="store_true",
            help="Записать изменения. Без флага — только отчёт.",
        )
        parser.add_argument(
            "--task-id",
            type=int,
            action="append",
            dest="task_ids",
            help="Ограничить одним id задания. Можно указать несколько раз.",
        )

    def handle(self, *args, **options):
        qs = affected_tasks()
        ids = options.get("task_ids") or []
        if ids:
            qs = qs.filter(pk__in=ids)
        planned = plan_changes(qs)
        if not planned:
            self.stdout.write("Изменений нет.")
            return
        for task, change in planned:
            if change.get("skip"):
                self.stdout.write(f"id {change['id']}: пропуск — {change['skip']}")
                continue
            bits = []
            if change["text_changed"]:
                bits.append("условие")
            if change["answer_changed"]:
                bits.append(f"ответ {change['old_answer']!r} → {change['new_answer']!r}")
            self.stdout.write(f"id {task.pk}: " + ", ".join(bits))
        if not options["apply"]:
            self.stdout.write(self.style.WARNING(f"Сухой прогон: {len(planned)} заданий, база не изменена."))
            return
        with transaction.atomic():
            for task, change in planned:
                if change.get("skip"):
                    continue
                apply_task(task, change)
        self.stdout.write(self.style.SUCCESS(f"Записано: {len(planned)}."))
