"""Заморозить прежний вид попыток без снимка после смены максимумов в банке (r69).

У старых попыток нет tasks_snapshot/grading_snapshot, поэтому их итог считается по
текущему банку. После смены максимумов (r68) часть таких попыток стала выглядеть иначе.
Команда записывает снимок состава, построенный по ПРЕЖНИМ значениям TaskList/Task
из CSV-бэкапа, и метку legacy_view_snapshot. Баллы учителя (scores, score) и checked
не трогаются, scoring не записывается.

Повторный запуск ничего не меняет: попытки с меткой или со снимком пропускаются.
"""

from __future__ import annotations

import csv

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

LEGACY_VIEW_KEY = "legacy_view_snapshot"


def _read_csv(path):
    with open(path, newline="", encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


def _int_or_none(value):
    if value in (None, ""):
        return None
    return int(value)


class Command(BaseCommand):
    help = "Записать снимок прежнего вида попыткам без снимка, чей итог изменился после правки банка."

    def add_arguments(self, parser):
        parser.add_argument("--tasklist-csv", required=True)
        parser.add_argument("--task-csv", required=True)
        parser.add_argument("--tag", default="r69")
        parser.add_argument("--apply", action="store_true", help="Без флага — только показать список.")

    def handle(self, *args, **opts):
        from Cabinet.homework_api import _variant_id_for_homework
        from Cabinet.models import HomeworkSubmission, HomeworkSubmissionAttempt
        from Generator.models import Part, Variant
        from Generator.variant_scoring import (
            grading_task_snapshot,
            load_variant_tasks_for_scoring,
            public_task_snapshot,
            score_variant_attempt,
            _answers_from_payload,
            _attachment_ids,
        )

        old_lists = {int(r["id"]): r for r in _read_csv(opts["tasklist_csv"])}
        old_tasks = {int(r["id"]): r for r in _read_csv(opts["task_csv"])}
        if not old_lists or not old_tasks:
            raise CommandError("Пустой CSV")
        part_titles = {p.pk: p.part_title for p in Part.objects.all()}

        variants = {}

        def variant_info(vid):
            if vid not in variants:
                v = Variant.objects.select_related("level", "var_subject").filter(pk=vid).first()
                live = load_variant_tasks_for_scoring(vid) if v else []
                old = []
                touched = False
                if v:
                    from Generator.models import VariantContent

                    list_of = dict(
                        VariantContent.objects.filter(variant_id=vid).values_list("task_id", "task__task_id")
                    )
                    for row in live:
                        row = dict(row)
                        tl = old_lists.get(list_of.get(row["id"]))
                        tk = old_tasks.get(row["id"])
                        if tl is not None:
                            touched = True
                            max_score = _int_or_none(tl["max_score"])
                            if max_score is None and tk is not None:
                                max_score = _int_or_none(tk["max_score"])
                            row["max_score"] = 1 if max_score is None else max_score
                            row["part"] = _int_or_none(tl["part_id"])
                            row["part_title"] = part_titles.get(row["part"]) if row["part"] else None
                            row["subdivision"] = tl.get("subdivision") or ""
                        if tk is not None:
                            row["exam_part"] = _int_or_none(tk.get("exam_part"))
                        old.append(row)
                variants[vid] = (
                    (v.level.level, v.var_subject.subject_short) if v else ("", ""),
                    live,
                    old if touched else None,
                )
            return variants[vid]

        def summary(tasks, payload, level, subject):
            scores = payload.get("scores") if isinstance(payload.get("scores"), dict) else {}
            checked = payload.get("checked") if isinstance(payload.get("checked"), dict) else {}
            return score_variant_attempt(
                tasks=tasks, level=level, subject=subject,
                answers=_answers_from_payload(payload, tasks), scores=scores,
                checked=checked, attachment_ids=_attachment_ids(payload),
            )

        targets = []
        for kind, qs in (
            ("sub", HomeworkSubmission.objects.select_related("homework")),
            ("att", HomeworkSubmissionAttempt.objects.select_related("submission__homework")),
        ):
            for obj in qs:
                payload = obj.result_payload if isinstance(obj.result_payload, dict) else None
                if not payload or payload.get(LEGACY_VIEW_KEY):
                    continue
                if any(payload.get(k) for k in ("tasks_snapshot", "grading_snapshot", "scoring")):
                    continue
                hw = obj.homework if kind == "sub" else obj.submission.homework
                vid = _variant_id_for_homework(hw)
                if not vid:
                    continue
                (level, subject), live, old = variant_info(vid)
                if not old:
                    continue
                if summary(live, payload, level, subject) == summary(old, payload, level, subject):
                    continue
                targets.append((kind, obj, old))

        self.stdout.write(f"targets={len(targets)} " + " ".join(f"{k}:{o.pk}" for k, o, _ in targets))
        if not opts["apply"]:
            return
        with transaction.atomic():
            for kind, obj, old in targets:
                model = type(obj)
                fresh = model.objects.select_for_update().get(pk=obj.pk)
                payload = dict(fresh.result_payload or {})
                if payload.get(LEGACY_VIEW_KEY):
                    continue
                payload["tasks_snapshot"] = [public_task_snapshot(t) for t in old]
                payload["grading_snapshot"] = [grading_task_snapshot(t) for t in old]
                payload[LEGACY_VIEW_KEY] = opts["tag"]
                model.objects.filter(pk=obj.pk).update(result_payload=payload)
        self.stdout.write(f"frozen={len(targets)}")
