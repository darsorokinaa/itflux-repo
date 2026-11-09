"""Поставить inf7u в «Углублённый», не трогая подпись и чужие задачи.

По умолчанию только отчёт. --apply пишет vpr_advanced=True и vpr_basic=False
у информатики 7 класса партии mcko_adv_20261108 с ключом mcko_adv:.
Идентификаторы, попытки, автор и заголовок не меняются. Повтор ничего не пишет.
Подпись остаётся «авторский набор, по материалам МЦКО», без «МЦКО-2026».
"""

import json

from django.core.management.base import BaseCommand

from Generator.models import Task

BATCH = "mcko_adv_20261108"
SOURCE_PREFIX = "mcko_adv:"


def inf7u_tasks():
    return (
        Task.objects.filter(
            import_batch=BATCH,
            source_key__startswith=SOURCE_PREFIX,
            vpr_class=7,
            task__subject__subject_short__iexact="inf",
            task__level__level__iexact="vpr",
        )
        .select_related("task", "task__subject", "task__level")
        .order_by("id")
    )


class Command(BaseCommand):
    help = "Сухой прогон: inf7u партии mcko_adv_20261108 становится углублённым. Запись только с --apply."

    def add_arguments(self, parser):
        parser.add_argument("--apply", action="store_true", help="Записать галочки. Без флага только отчёт.")

    def handle(self, *args, **options):
        rows = inf7u_tasks()
        planned = []
        already = 0
        for task in rows.iterator():
            if task.vpr_advanced and not task.vpr_basic:
                already += 1
                continue
            planned.append({"id": task.pk, "source_key": task.source_key})
            if options["apply"]:
                task.vpr_advanced = True
                task.vpr_basic = False
                task.save(update_fields=["vpr_basic", "vpr_advanced"])
        self.stdout.write(json.dumps({
            "batch": BATCH,
            "applied": bool(options["apply"]),
            "matched": rows.count(),
            "already": already,
            "changed": len(planned),
            "sample": planned[:20],
            "deleted_tasks": 0,
        }, ensure_ascii=False, indent=2))
