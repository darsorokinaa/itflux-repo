"""Запись пакета в текущую базу. Вызывается только с явным --apply.

Задачи создаются неактивными. Скрипты архива не исполняются.
"""

from __future__ import annotations

import json
import zipfile

from django.db import transaction

from .models import Criteria, Level, Subject, Task, TaskList
from .vpr_answer_spec import APPLY_READY_PACKS, dry_run_zip, storage_from_item
from .vpr_pack_files import store_item_files


def _level_and_subject(item: dict):
    short = storage_from_item(item)["subject_short"]
    subject = Subject.objects.filter(subject_short__iexact=short).first()
    level = Level.objects.filter(level__iexact="vpr").first()
    if subject is None or level is None:
        raise RuntimeError(
            f"в базе нет предмета {short!r} или уровня vpr — пакет не записан"
        )
    return subject, level


def _task_list(item: dict, stored: dict, subject, level) -> TaskList:
    grade = stored["vpr_class"]
    number = stored["task_number"]
    row = TaskList.objects.filter(
        subject=subject,
        level=level,
        task_number=number,
        vpr_class=grade,
    ).first()
    title = f"ВПР {grade} №{number}"
    if row is None:
        row = TaskList.objects.create(
            subject=subject,
            level=level,
            task_number=number,
            task_title=title,
            max_score=stored["max_score"],
            vpr_class=grade,
            part=None,
        )
    else:
        row.max_score = stored["max_score"]
        row.task_title = title
        row.save(update_fields=["max_score", "task_title"])
    Criteria.objects.filter(task_number=row).delete()
    for pair in stored.get("criteria") or []:
        if not isinstance(pair, (list, tuple)) or len(pair) < 2:
            continue
        Criteria.objects.create(
            task_number=row,
            criteria_score=int(pair[0]),
            criteria_text=str(pair[1]),
        )
    return row


def _save_task(item: dict, stored: dict, task_list: TaskList, *, batch: str, stored_files: list) -> str:
    spec = dict(stored["answer_spec"])
    spec["stored_files"] = stored_files
    spec["max_score_numeric"] = stored["max_score"]
    defaults = {
        "task": task_list,
        "task_template": stored["task_template"],
        "answer": stored["answer"],
        "solution": stored["solution"],
        "answer_spec": spec,
        "author": stored["author"] or "Цифровой поток",
        "max_score": stored["max_score"],
        "vpr_class": stored["vpr_class"],
        "vpr_basic": True,
        "vpr_advanced": False,
        "truth_table_enabled": False,
        "is_active": False,
        "status": Task.Status.DRAFT,
        "scope": Task.Scope.GLOBAL,
        "import_batch": batch,
        "created_by": f"vpr-import:{batch}"[:100],
    }
    existing = Task.objects.filter(source_key=stored["source_key"]).first()
    if existing is None:
        Task.objects.create(source_key=stored["source_key"], **defaults)
        return "created"
    for field, value in defaults.items():
        setattr(existing, field, value)
    existing.save()
    return "updated"


@transaction.atomic
def apply_zip(path: str, *, batch: str) -> dict:
    report = dry_run_zip(path)
    if not report.get("ok") or not report.get("apply_ready"):
        raise RuntimeError("пакет не прошёл dry-run и не записан")
    archive = zipfile.ZipFile(path)
    written = {"created": 0, "updated": 0, "files": 0, "pack": []}
    for name in archive.namelist():
        if not name.endswith("_bank.json") or "packs/" not in name.replace("\\", "/"):
            continue
        payload = json.loads(archive.read(name))
        pack = str(payload.get("pack") or "")
        if pack not in APPLY_READY_PACKS:
            raise RuntimeError(f"пакет {pack} не разрешён к записи")
        subject, level = _level_and_subject(payload["items"][0])
        for item in payload["items"]:
            stored = storage_from_item(item)
            if stored["author"] != "Цифровой поток":
                raise RuntimeError(f"{stored['source_key']}: автор не «Цифровой поток»")
            task_list = _task_list(item, stored, subject, level)
            files = store_item_files(archive, item, batch=batch)
            kind = _save_task(item, stored, task_list, batch=batch, stored_files=files)
            written[kind] += 1
            written["files"] += len(files)
        written["pack"].append(pack)
    if sum(written[key] for key in ("created", "updated")) != report["count"]:
        raise RuntimeError("число записей не совпало с dry-run, транзакция отменена")
    return written
