"""Выровнять класс и галочки базовой партии ВПР. Без удаления и без повторного импорта.

По умолчанию только отчёт. Запись — с --apply, и только строки этой партии,
у которых класс задачи не совпал со списком или галочки не «базовый».
"""

import json

from django.core.management.base import BaseCommand, CommandError

from Generator.models import Task


class Command(BaseCommand):
    help = "Сухой прогон выравнивания vpr_class/vpr_basic/vpr_advanced для одной партии."

    def add_arguments(self, parser):
        parser.add_argument("--batch", default="verified-1580")
        parser.add_argument("--apply", action="store_true")

    def handle(self, *args, **options):
        batch = (options["batch"] or "").strip()
        if not batch:
            raise CommandError("нужна метка партии")
        rows = Task.objects.filter(import_batch=batch).exclude(source_key__isnull=True).select_related("task")
        planned = []
        for task in rows.iterator():
            updates = {}
            list_class = task.task.vpr_class if task.task_id else None
            if list_class is not None and task.vpr_class != list_class:
                updates["vpr_class"] = list_class
            if task.vpr_basic is not True:
                updates["vpr_basic"] = True
            if task.vpr_advanced is not False:
                updates["vpr_advanced"] = False
            if updates:
                planned.append({"id": task.pk, "source_key": task.source_key, "fields": sorted(updates)})
                if options["apply"]:
                    for key, value in updates.items():
                        setattr(task, key, value)
                    task.save(update_fields=list(updates))
        self.stdout.write(json.dumps({
            "batch": batch,
            "applied": bool(options["apply"]),
            "matched": rows.count(),
            "changed": len(planned),
            "sample": planned[:20],
        }, ensure_ascii=False, indent=2))
