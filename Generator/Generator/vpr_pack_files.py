"""Файлы пакетов ВПР: только чтение архива и закрытое хранение.

Скрипты check14.py, check15.py и kumir_robot.py не запускаются.
Учительские эталоны не попадают в публичный /media/.
"""

from __future__ import annotations

import hashlib
import re
from pathlib import PurePosixPath

from django.core.files.base import ContentFile
from django.http import FileResponse, HttpResponseForbidden, JsonResponse
from django.views.decorators.http import require_http_methods

from .models import Task, private_media_storage

_SAFE_SUFFIXES = frozenset({
    ".txt", ".svg", ".json", ".docx", ".pptx", ".zip", ".kum", ".py", ".md",
})
_TEACHER_NAME = re.compile(
    r"^(?:ref_.*\.kum|ref14\.docx|ref15\.pptx|field\.json|spec.*\.json|.*\.py)$",
    re.IGNORECASE,
)


def file_role(entry: dict) -> str:
    """teacher, если роль или имя эталона учительские. Сомнение закрываем в сторону учителя."""
    name = str((entry or {}).get("name") or "")
    role = str((entry or {}).get("role") or "")
    if _TEACHER_NAME.match(PurePosixPath(name).name) or "учител" in role.casefold():
        return "teacher"
    if "ученик" in role.casefold():
        return "student"
    return "teacher"


def safe_basename(name: str) -> str:
    base = PurePosixPath(str(name or "").replace("\\", "/")).name
    if not base or base in {".", ".."} or "/" in base or "\\" in base:
        raise ValueError(f"небезопасное имя файла: {name}")
    suffix = PurePosixPath(base).suffix.lower()
    if suffix not in _SAFE_SUFFIXES:
        raise ValueError(f"недопустимый тип файла: {base}")
    return base


def _member_for(entry: dict, names: set[str]) -> str:
    rel = str(entry.get("path") or "").replace("\\", "/").lstrip("/")
    if not rel or rel.startswith("/") or ".." in rel.split("/"):
        raise ValueError(f"небезопасный путь: {entry.get('path')}")
    matches = [name for name in names if name.replace("\\", "/").endswith("/" + rel) or name.replace("\\", "/") == rel]
    if len(matches) != 1:
        raise ValueError(f"файл пакета не найден однозначно: {rel}")
    return matches[0]


def audit_zip_files(archive, items: list[dict]) -> list[str]:
    """Проверяет, что заявленные files[] лежат в архиве и не требуют запуска скриптов."""
    names = set(archive.namelist())
    errors = []
    for item in items:
        files = item.get("files") or []
        if not files:
            continue
        if not isinstance(files, list):
            errors.append(f"{item.get('id')}: files не список")
            continue
        for entry in files:
            if not isinstance(entry, dict):
                errors.append(f"{item.get('id')}: битая запись файла")
                continue
            try:
                member = _member_for(entry, names)
                safe_basename(entry.get("name") or member)
            except ValueError as exc:
                errors.append(f"{item.get('id')}: {exc}")
                continue
            if member.endswith(".py") or str(entry.get("name") or "").endswith(".py"):
                errors.append(f"{item.get('id')}: скрипт приложен как файл задания")
    return errors


def teacher_secret_names(files) -> set[str]:
    names = set()
    for entry in files or []:
        if not isinstance(entry, dict):
            continue
        name = PurePosixPath(str(entry.get("name") or "")).name
        path = str(entry.get("path") or "")
        if file_role(entry) == "teacher" or (name and _TEACHER_NAME.match(name)):
            if name:
                names.add(name)
            if path:
                names.add(path.replace("\\", "/"))
    return names


def scrub_teacher_links(html: str, files) -> str:
    """Убирает ссылки и имена учительских эталонов из HTML ученика. Сам SVG не вырезает."""
    teacher = teacher_secret_names(files)
    if not html:
        return ""
    if not teacher and "vpr_pack/" not in html and "ref_" not in html and "field.json" not in html:
        return html

    def replace(match):
        url = match.group(4)
        base = PurePosixPath(url.split("?", 1)[0].split("#", 1)[0]).name
        if base in teacher or _TEACHER_NAME.match(base) or "vpr_pack/" in url:
            return ""
        return match.group(0)

    cleaned = re.sub(
        r"(href|src)(\s*=\s*)([\"'])(.*?)\3",
        replace,
        html,
        flags=re.IGNORECASE,
    )
    for secret in sorted(teacher, key=len, reverse=True):
        cleaned = cleaned.replace(secret, "")
    cleaned = re.sub(r"vpr_pack/[A-Za-z0-9_./-]+", "", cleaned)
    return cleaned


def student_file_descriptors(task) -> list[dict]:
    spec = getattr(task, "answer_spec", None) or {}
    rows = []
    for entry in spec.get("files") or []:
        if not isinstance(entry, dict) or file_role(entry) != "student":
            continue
        name = str(entry.get("name") or "")
        if not name:
            continue
        rows.append({
            "name": name,
            "url": f"/api/tasks/{task.pk}/pack-file/?name={name}",
        })
    return rows


def _stored_row(task, name: str) -> dict | None:
    spec = getattr(task, "answer_spec", None) or {}
    for entry in spec.get("stored_files") or []:
        if isinstance(entry, dict) and entry.get("name") == name:
            return entry
    return None


def store_item_files(archive, item: dict, *, batch: str) -> list[dict]:
    """Кладёт байты в private_media. Публичный URL не создаётся. Скрипты не исполняются."""
    names = set(archive.namelist())
    stored = []
    source = str(item.get("id") or "").strip()
    for entry in item.get("files") or []:
        if not isinstance(entry, dict):
            continue
        member = _member_for(entry, names)
        base = safe_basename(entry.get("name") or member)
        blob = archive.read(member)
        digest = hashlib.sha256(blob).hexdigest()
        key = f"vpr_pack/{batch}/{source}/{base}"
        if private_media_storage.exists(key):
            private_media_storage.delete(key)
        private_media_storage.save(key, ContentFile(blob))
        stored.append({
            "name": base,
            "role": file_role(entry),
            "storage": key,
            "sha256": digest,
            "size": len(blob),
        })
    return stored


def viewer_may_see_teacher_files(request) -> bool:
    user = getattr(request, "user", None)
    if user is not None and getattr(user, "is_authenticated", False):
        if getattr(user, "is_staff", False) or getattr(user, "is_superuser", False):
            return True
    from .teacher_task_bank import request_teacher

    return request_teacher(request) is not None


@require_http_methods(["GET"])
def api_task_pack_file(request, task_id: int):
    """Скачивание файла пакета. Учительский эталон анониму и ученику не отдаётся."""
    task = Task.objects.filter(pk=task_id).first()
    if task is None or (not task.is_active and not viewer_may_see_teacher_files(request)):
        return JsonResponse({"ok": False, "error": "Задача не найдена"}, status=404)
    try:
        name = safe_basename((request.GET.get("name") or "").strip())
    except ValueError:
        return JsonResponse({"ok": False, "error": "Файл не найден"}, status=404)
    row = _stored_row(task, name)
    if row is None:
        return JsonResponse({"ok": False, "error": "Файл не найден"}, status=404)
    if row.get("role") == "teacher" and not viewer_may_see_teacher_files(request):
        return HttpResponseForbidden("Файл только для учителя")
    storage_key = str(row.get("storage") or "")
    if not storage_key.startswith("vpr_pack/") or ".." in storage_key.split("/"):
        return JsonResponse({"ok": False, "error": "Файл не найден"}, status=404)
    if not private_media_storage.exists(storage_key):
        return JsonResponse({"ok": False, "error": "Файл не найден"}, status=404)
    handle = private_media_storage.open(storage_key, "rb")
    response = FileResponse(handle, content_type="application/octet-stream")
    response["Content-Disposition"] = f'attachment; filename="{name}"'
    response["X-Content-Type-Options"] = "nosniff"
    response["Cache-Control"] = "private, no-store"
    return response
