"""Запись пакета в текущую базу. Вызывается только с явным --apply.

Задачи создаются неактивными. Скрипты архива не исполняются.
"""

from __future__ import annotations

import json
import zipfile

from django.db import transaction
from django.db.models import Q

from .models import (
    Criteria,
    Level,
    Subject,
    Task,
    TaskAttachment,
    TaskGroupMember,
    TaskList,
    VariantContent,
    private_media_storage,
)
from .vpr_answer_spec import APPLY_READY_PACKS, dry_run_zip, storage_from_item
from .vpr_pack_files import store_item_files

# Ставится при первой активации и больше не снимается. После этого партию
# можно только выключить: удаление срывает варианты и чужие ссылки по id.
_ACTIVATED_PREFIX = "vpr-activated:"


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


def _activated_marker(batch: str) -> str:
    return f"{_ACTIVATED_PREFIX}{batch}"[:100]


def _was_activated(row) -> bool:
    return str(getattr(row, "created_by", "") or "").startswith(_ACTIVATED_PREFIX)


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
    if _was_activated(existing):
        defaults.pop("is_active", None)
        defaults.pop("status", None)
        defaults.pop("created_by", None)
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


def _batch_tasks(batch: str):
    label = (batch or "").strip()
    if not label:
        raise RuntimeError("нужна метка партии")
    return Task.objects.filter(import_batch=label).exclude(source_key__isnull=True).exclude(source_key="")


@transaction.atomic
def activate_batch(batch: str) -> dict:
    """Включает только задачи этой партии. Чужие строки не меняет."""
    rows = _batch_tasks(batch)
    total = rows.count()
    if total == 0:
        raise RuntimeError(f"партия {batch!r} не найдена")
    activated = rows.update(
        is_active=True,
        status=Task.Status.READY,
        created_by=_activated_marker(batch),
    )
    return {"batch": batch, "matched": total, "activated": activated}


@transaction.atomic
def deactivate_batch(batch: str) -> dict:
    """Выключает партию, не удаляя задачи, файлы и списки."""
    rows = _batch_tasks(batch)
    total = rows.count()
    if total == 0:
        raise RuntimeError(f"партия {batch!r} не найдена")
    deactivated = rows.update(is_active=False, status=Task.Status.DRAFT)
    return {
        "batch": batch,
        "matched": total,
        "deactivated": deactivated,
        "deleted_tasks": 0,
    }


def _usage_reasons(ids: list[int]) -> list[str]:
    if not ids:
        return []
    reasons = []
    if VariantContent.objects.filter(task_id__in=ids).exists():
        reasons.append("варианты")
    if TaskGroupMember.objects.filter(task_id__in=ids).exists():
        reasons.append("группы")
    if TaskAttachment.objects.filter(task_id__in=ids).exists():
        reasons.append("вложения")
    if Task.objects.filter(source_task_id__in=ids).exists():
        reasons.append("копии")
    from django.apps import apps

    if apps.is_installed("Cabinet"):
        homework = apps.get_model("Cabinet", "HomeworkTask")
        if homework.objects.filter(task_id__in=[str(item) for item in ids]).exists():
            reasons.append("домашние задания")
        history = apps.get_model("Cabinet", "StudentTaskHistory")
        if history.objects.filter(generator_task_id__in=ids).exists():
            reasons.append("история выдачи")
    return reasons


@transaction.atomic
def rollback_batch(batch: str) -> dict:
    """Удаляет черновик партии, который ещё не активировали и никуда не включили.

    После активации удаление запрещено: варианты и выдача хранят id задачи.
    Обратный шаг для такой партии — deactivate_batch.
    """
    rows_qs = _batch_tasks(batch)
    if not rows_qs.exists():
        raise RuntimeError(f"партия {batch!r} не найдена")
    activated = rows_qs.filter(
        Q(is_active=True)
        | Q(status=Task.Status.READY)
        | Q(created_by__startswith=_ACTIVATED_PREFIX)
    )
    if activated.exists():
        raise RuntimeError(
            f"партия {batch!r} уже активировалась: удаление запрещено, "
            "доступно только --deactivate-batch"
        )
    ids = list(rows_qs.values_list("pk", flat=True))
    usage = _usage_reasons(ids)
    if usage:
        raise RuntimeError(
            f"партия {batch!r} уже используется ({', '.join(usage)}): "
            "удаление запрещено, доступно только --deactivate-batch"
        )
    rows = list(rows_qs.only("id", "task_id", "answer_spec", "source_key"))
    list_ids = {row.task_id for row in rows if row.task_id}
    removed_files = 0
    for row in rows:
        for entry in (row.answer_spec or {}).get("stored_files") or []:
            key = str((entry or {}).get("storage") or "")
            if not key.startswith(f"vpr_pack/{batch}/") or ".." in key.split("/"):
                continue
            if private_media_storage.exists(key):
                private_media_storage.delete(key)
                removed_files += 1
    deleted, _details = Task.objects.filter(pk__in=[row.pk for row in rows]).delete()
    removed_lists = 0
    for list_id in list_ids:
        if Task.objects.filter(task_id=list_id).exists():
            continue
        task_list = TaskList.objects.filter(pk=list_id, vpr_class__isnull=False).first()
        if task_list is None:
            continue
        Criteria.objects.filter(task_number=task_list).delete()
        task_list.delete()
        removed_lists += 1
    return {
        "batch": batch,
        "deleted_tasks": len(rows),
        "deleted_rows": deleted,
        "removed_files": removed_files,
        "removed_lists": removed_lists,
    }
