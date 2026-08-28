"""API интерактивных досок Excalidraw."""

from __future__ import annotations

import base64
import binascii
import copy
import hashlib
import json
import os
import re
import uuid
from typing import Any

from django.contrib.auth.models import User
from django.core.files.base import ContentFile
from django.db import transaction
from django.db.models import Q
from django.http import FileResponse, Http404
from django.shortcuts import get_object_or_404
from rest_framework import serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import (
    InteractiveBoard,
    InteractiveBoardAccess,
    InteractiveBoardAsset,
    Lesson,
    Profile,
    ScheduleEvent,
    Student,
    StudentGroup,
    empty_board_scene,
)
from .schedule_events import parse_local_event_id
from .upload_validation import UploadValidationError, validate_uploaded_image


def _parse_optional_pk(value):
    """Parse query/body pk; supports local-{id} schedule event ids."""
    if value is None or value == "":
        return None
    if isinstance(value, int):
        return value
    text = str(value).strip()
    if text.startswith("local-"):
        return parse_local_event_id(text)
    if text.isdigit():
        return int(text)
    try:
        n = int(text)
        return n
    except (TypeError, ValueError):
        return None

MAX_SCENE_JSON_BYTES = 15 * 1024 * 1024
MAX_BOARD_IMAGE_BYTES = 5 * 1024 * 1024
MAX_THUMBNAIL_CHARS = 200_000

# SVG намеренно запрещён (XSS). Только растровые форматы.
ALLOWED_BOARD_IMAGE_EXTENSIONS = frozenset({".png", ".jpg", ".jpeg", ".webp"})
ALLOWED_BOARD_IMAGE_CONTENT_TYPES = frozenset({
    "image/png",
    "image/jpeg",
    "image/webp",
})

TRANSIENT_APP_STATE_KEYS = frozenset({
    "collaborators",
    "currentChartType",
    "cursorButton",
    "editingGroupId",
    "editingLinearElement",
    "activeTool",
    "multiElement",
    "selectedElementIds",
    "previousSelectedElementIds",
    "selectedGroupIds",
    "editingTextElement",
    "isBindingEnabled",
    "suggestedBindings",
    "isRotating",
    "isResizing",
    "openMenu",
    "openPopup",
    "openSidebar",
    "openDialog",
    "contextMenu",
    "showHyperlinkPopup",
    "toast",
    "zenModeEnabled",
    "viewModeEnabled",
    "pendingImageElementId",
    "newElement",
    "resizingElement",
    "selectionElement",
    "scrollX",
    "scrollY",
    "zoom",
    "offsetLeft",
    "offsetTop",
    "width",
    "height",
    "userToFollow",
    "followedBy",
})

ASSET_URL_RE = re.compile(
    r"/api/cabinet/interactive-boards/"
    r"(?P<board_id>[0-9a-f-]{36})/assets/(?P<asset_id>[0-9a-f-]{36})/?",
    re.I,
)


def estimate_json_bytes(payload: Any) -> int:
    try:
        return len(json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
    except (TypeError, ValueError):
        return MAX_SCENE_JSON_BYTES + 1


def sanitize_app_state(app_state: Any) -> dict:
    if not isinstance(app_state, dict):
        return {}
    cleaned = {}
    for key, value in app_state.items():
        if key in TRANSIENT_APP_STATE_KEYS:
            continue
        if key.startswith("pending") or key.startswith("isBinding"):
            continue
        cleaned[key] = value
    cleaned.pop("collaborators", None)
    return cleaned


def normalize_scene_data(raw: Any) -> dict:
    if not isinstance(raw, dict):
        return empty_board_scene()
    elements = raw.get("elements")
    if not isinstance(elements, list):
        elements = []
    files = raw.get("files")
    if not isinstance(files, dict):
        files = {}
    return {
        "elements": elements,
        "appState": sanitize_app_state(raw.get("appState")),
        "files": files,
    }


def _is_bulky_deleted_element(el: dict) -> bool:
    if not el.get("isDeleted"):
        return False
    points = el.get("points")
    if isinstance(points, list) and len(points) > 1:
        return True
    pressures = el.get("pressures")
    if isinstance(pressures, list) and len(pressures) > 1:
        return True
    for key in ("text", "originalText", "rawText"):
        value = el.get(key)
        if isinstance(value, str) and value:
            return True
    return False


def _compact_deleted_element(el: dict) -> dict:
    next_el = dict(el)
    next_el["isDeleted"] = True
    points = next_el.get("points")
    if isinstance(points, list) and len(points) > 1:
        next_el["points"] = [[0, 0]]
        points = next_el["points"]
    pressures = next_el.get("pressures")
    if isinstance(pressures, list) and len(pressures) > 1:
        n = len(points) if isinstance(points, list) else 0
        next_el["pressures"] = [0.5] * n
    for key in ("text", "originalText", "rawText"):
        if isinstance(next_el.get(key), str) and next_el.get(key):
            next_el[key] = ""
    return next_el


def _referenced_file_ids(elements: list) -> set[str]:
    ids: set[str] = set()
    for raw in elements:
        if not isinstance(raw, dict):
            continue
        file_id = raw.get("fileId")
        if isinstance(file_id, str) and file_id:
            ids.add(file_id)
    return ids


def compact_scene_data(scene: dict) -> tuple[dict, bool]:
    """
    Идемпотентно сжимает сцену: tombstones вместо геометрии deleted-элементов
    и удаление files без ссылок. Живые элементы не меняются.
    """
    if not isinstance(scene, dict):
        return empty_board_scene(), False
    elements_in = scene.get("elements")
    if not isinstance(elements_in, list):
        elements_in = []
    files_in = scene.get("files")
    if not isinstance(files_in, dict):
        files_in = {}

    changed = False
    elements = []
    for raw in elements_in:
        if isinstance(raw, dict) and _is_bulky_deleted_element(raw):
            elements.append(_compact_deleted_element(raw))
            changed = True
        else:
            elements.append(raw)

    used = _referenced_file_ids(elements)
    files = {}
    for file_id, meta in files_in.items():
        if str(file_id) in used:
            files[file_id] = meta
        else:
            changed = True

    if not changed:
        return scene, False
    return {
        **scene,
        "elements": elements,
        "appState": scene.get("appState") if isinstance(scene.get("appState"), dict) else {},
        "files": files,
    }, True


def scene_size_stats(scene: dict) -> dict:
    elements = scene.get("elements") if isinstance(scene, dict) else None
    files = scene.get("files") if isinstance(scene, dict) else None
    if not isinstance(elements, list):
        elements = []
    if not isinstance(files, dict):
        files = {}
    deleted = 0
    for el in elements:
        if isinstance(el, dict) and el.get("isDeleted"):
            deleted += 1
    used = _referenced_file_ids(elements)
    unused = sum(1 for fid in files if str(fid) not in used)
    return {
        "element_count": len(elements),
        "deleted_count": deleted,
        "live_count": len(elements) - deleted,
        "file_count": len(files),
        "unused_file_count": unused,
        "elements_bytes": estimate_json_bytes(elements),
        "files_bytes": estimate_json_bytes(files),
        "scene_bytes": estimate_json_bytes(scene),
    }


def _element_owner_id(el: dict) -> int | None:
    data = el.get("customData") if isinstance(el, dict) else None
    if not isinstance(data, dict):
        return None
    raw = data.get("itfluxOwnerId")
    try:
        n = int(raw)
    except (TypeError, ValueError):
        return None
    return n if n > 0 else None


def _element_ownership(el: dict) -> str:
    data = el.get("customData") if isinstance(el, dict) else None
    if not isinstance(data, dict):
        return "shared"
    return str(data.get("itfluxOwnership") or "shared")


def _is_newer_element(a: dict, b: dict) -> bool:
    av, bv = int(a.get("version") or 0), int(b.get("version") or 0)
    if av != bv:
        return av > bv
    an, bn = int(a.get("versionNonce") or 0), int(b.get("versionNonce") or 0)
    if an != bn:
        return an > bn
    return int(a.get("updated") or 0) > int(b.get("updated") or 0)


def enforce_element_ownership(
    prev_scene: dict,
    next_scene: dict,
    *,
    user_id: int,
    is_owner: bool,
) -> dict:
    """
    Ученик не может менять/удалять элементы учителя.
    Владелец доски (учитель) — без ограничений.
    """
    if is_owner:
        return next_scene
    prev_els = {
        str(el.get("id")): el
        for el in (prev_scene.get("elements") or [])
        if isinstance(el, dict) and el.get("id")
    }
    out_elements = []
    seen = set()
    for el in next_scene.get("elements") or []:
        if not isinstance(el, dict) or not el.get("id"):
            continue
        eid = str(el["id"])
        seen.add(eid)
        prev = prev_els.get(eid)
        if prev is None:
            # Новый элемент — проставляем владельца, если нет.
            data = el.get("customData") if isinstance(el.get("customData"), dict) else {}
            if "itfluxOwnerId" not in data:
                data = {
                    **data,
                    "itfluxOwnerId": user_id,
                    "itfluxOwnerRole": "student",
                    "itfluxOwnership": "student",
                }
                el = {**el, "customData": data}
            out_elements.append(el)
            continue
        ownership = _element_ownership(prev)
        owner_id = _element_owner_id(prev)
        if ownership == "teacher" or (owner_id and owner_id != user_id and ownership != "shared"):
            # Сохраняем предыдущую версию (запрет мутации чужого).
            out_elements.append(prev)
            continue
        out_elements.append(el)
    # Нельзя удалить чужой элемент, просто исключив его.
    for eid, prev in prev_els.items():
        if eid in seen:
            continue
        ownership = _element_ownership(prev)
        owner_id = _element_owner_id(prev)
        if ownership == "teacher" or (owner_id and owner_id != user_id and ownership != "shared"):
            out_elements.append(prev)
    return {
        **next_scene,
        "elements": out_elements,
        "appState": next_scene.get("appState") or {},
        "files": next_scene.get("files") or {},
    }


def detect_raster_mime(content: bytes) -> str | None:
    if not content or len(content) < 12:
        return None
    if content.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if content.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if content[:4] == b"RIFF" and content[8:12] == b"WEBP":
        return "image/webp"
    head = content[:256].lstrip().lower()
    if head.startswith(b"<svg") or b"<svg" in head[:64] or head.startswith(b"<?xml"):
        return None  # SVG запрещён
    return None


def validate_board_image_bytes(content: bytes, declared_mime: str = "") -> str:
    if len(content) > MAX_BOARD_IMAGE_BYTES:
        raise UploadValidationError("Изображение слишком большое (макс. 5 МБ)", "FILE_TOO_LARGE")
    mime = detect_raster_mime(content)
    if not mime:
        raise UploadValidationError(
            "Допустимы только PNG, JPEG и WebP. SVG не поддерживается.",
            "FILE_TYPE_NOT_ALLOWED",
        )
    declared = (declared_mime or "").split(";", 1)[0].strip().lower()
    if declared and declared not in ALLOWED_BOARD_IMAGE_CONTENT_TYPES:
        raise UploadValidationError(
            "Допустимы только PNG, JPEG и WebP. SVG не поддерживается.",
            "FILE_TYPE_NOT_ALLOWED",
        )
    return mime


def validate_board_image_upload(uploaded) -> None:
    if not uploaded:
        raise UploadValidationError("Файл не передан", "FILE_REQUIRED")

    size = getattr(uploaded, "size", None)
    if size is not None and size > MAX_BOARD_IMAGE_BYTES:
        raise UploadValidationError("Изображение слишком большое (макс. 5 МБ)", "FILE_TOO_LARGE")

    name = getattr(uploaded, "name", "") or "file"
    ext = os.path.splitext(name)[1].lower()
    if ext == ".svg":
        raise UploadValidationError(
            "Допустимы только PNG, JPEG и WebP. SVG не поддерживается.",
            "FILE_TYPE_NOT_ALLOWED",
        )
    if ext not in ALLOWED_BOARD_IMAGE_EXTENSIONS:
        raise UploadValidationError(
            "Допустимы только PNG, JPEG и WebP. SVG не поддерживается.",
            "FILE_TYPE_NOT_ALLOWED",
        )

    content_type = (getattr(uploaded, "content_type", "") or "").split(";", 1)[0].strip().lower()
    if content_type == "image/svg+xml":
        raise UploadValidationError(
            "Допустимы только PNG, JPEG и WebP. SVG не поддерживается.",
            "FILE_TYPE_NOT_ALLOWED",
        )
    if content_type and content_type not in ALLOWED_BOARD_IMAGE_CONTENT_TYPES:
        raise UploadValidationError("Недопустимый тип изображения", "FILE_TYPE_NOT_ALLOWED")

    pos = uploaded.tell() if hasattr(uploaded, "tell") else None
    raw = uploaded.read(MAX_BOARD_IMAGE_BYTES + 1)
    if hasattr(uploaded, "seek") and pos is not None:
        uploaded.seek(pos)
    elif hasattr(uploaded, "seek"):
        uploaded.seek(0)
    validate_board_image_bytes(raw, content_type)

    try:
        validate_uploaded_image(uploaded)
    except UploadValidationError:
        raise UploadValidationError(
            "Допустимы только PNG, JPEG и WebP. SVG не поддерживается.",
            "FILE_TYPE_NOT_ALLOWED",
        )


def board_asset_api_path(board_id, asset_id) -> str:
    return f"/api/cabinet/interactive-boards/{board_id}/assets/{asset_id}/"


def board_asset_content_sha256(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def get_or_create_board_asset(
    board: InteractiveBoard,
    *,
    content: bytes,
    mime: str,
    file_id: str,
    user: User | None,
) -> tuple[InteractiveBoardAsset, bool]:
    """Один blob на доску не создаёт новый asset при каждом autosave."""
    digest = board_asset_content_sha256(content)
    existing = (
        InteractiveBoardAsset.objects.filter(board=board, content_sha256=digest)
        .order_by("created_at")
        .first()
    )
    if existing is not None:
        return existing, False

    ext = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp"}.get(mime, ".bin")
    original_name = f"{file_id}{ext}"
    legacy = (
        InteractiveBoardAsset.objects.filter(
            board=board,
            original_name=original_name,
            size_bytes=len(content),
            content_sha256="",
        )
        .order_by("created_at")
        .first()
    )
    if legacy is not None:
        legacy.content_sha256 = digest
        legacy.save(update_fields=["content_sha256"])
        return legacy, False

    asset = InteractiveBoardAsset(
        board=board,
        mime_type=mime,
        original_name=original_name,
        content_sha256=digest,
        size_bytes=len(content),
        created_by=user,
    )
    asset.file.save(original_name, ContentFile(content), save=True)
    return asset, True


def _data_url_payload(data_url: str) -> tuple[str, bytes] | None:
    if not isinstance(data_url, str) or not data_url.startswith("data:") or "," not in data_url:
        return None
    header, _, b64 = data_url.partition(",")
    mime = "application/octet-stream"
    if ";" in header:
        mime = header[5:].split(";", 1)[0] or mime
    try:
        content = base64.b64decode(b64, validate=False)
    except (binascii.Error, ValueError):
        return None
    return mime, content


def persist_large_scene_files(board: InteractiveBoard, scene: dict, user: User) -> dict:
    """dataURL → private asset + защищённый API URL. SVG отклоняется."""
    files = scene.get("files")
    if not isinstance(files, dict) or not files:
        return scene

    updated_files = {}
    changed = False
    for file_id, meta in files.items():
        if not isinstance(meta, dict):
            continue
        data_url = meta.get("dataURL") or meta.get("url") or ""
        if not isinstance(data_url, str):
            updated_files[file_id] = meta
            continue

        # Уже защищённый URL — оставляем
        if ASSET_URL_RE.search(data_url):
            updated_files[file_id] = meta
            continue

        # Старые публичные media-ссылки на ассеты этой доски → защищённый URL
        if "/media/cabinet/boards" in data_url:
            name = data_url.rsplit("/", 1)[-1].split("?", 1)[0]
            asset = board.assets.filter(file__endswith=name).first()
            if asset:
                new_meta = dict(meta)
                path = board_asset_api_path(board.id, asset.id)
                new_meta["dataURL"] = path
                new_meta["url"] = path
                updated_files[file_id] = new_meta
                changed = True
                continue

        if not data_url.startswith("data:"):
            updated_files[file_id] = meta
            continue

        parsed = _data_url_payload(data_url)
        if not parsed:
            updated_files[file_id] = meta
            continue
        declared_mime, content = parsed

        # Маленькие растровые dataURL можно оставить inline; SVG — никогда
        try:
            mime = validate_board_image_bytes(content, declared_mime)
        except UploadValidationError as exc:
            raise serializers.ValidationError({"scene_data": exc.message}) from exc

        # dataURL всегда выносим в asset — inline base64 раздувает PATCH «иногда».
        asset, _created = get_or_create_board_asset(
            board,
            content=content,
            mime=mime,
            file_id=str(file_id),
            user=user,
        )
        path = board_asset_api_path(board.id, asset.id)
        new_meta = dict(meta)
        new_meta["dataURL"] = path
        new_meta["mimeType"] = mime
        new_meta["url"] = path
        updated_files[file_id] = new_meta
        changed = True

    if changed:
        scene = {**scene, "files": updated_files}
    return scene


def _scene_asset_lookups(board: InteractiveBoard, files: dict) -> tuple[dict, dict]:
    """Только ассеты, на которые ссылается текущая scene — не assets.all()."""
    asset_ids = []
    media_names = []
    for meta in files.values():
        if not isinstance(meta, dict):
            continue
        data_url = meta.get("dataURL") or meta.get("url") or ""
        if not isinstance(data_url, str):
            continue
        match = ASSET_URL_RE.search(data_url)
        if match:
            try:
                asset_ids.append(uuid.UUID(match.group("asset_id")))
            except (ValueError, TypeError):
                continue
            continue
        if "/media/cabinet/boards" in data_url:
            media_names.append(data_url.rsplit("/", 1)[-1].split("?", 1)[0])

    by_id = {}
    if asset_ids:
        for asset in board.assets.filter(pk__in=asset_ids):
            by_id[asset.id] = asset

    by_name = {}
    for name in set(media_names):
        if not name:
            continue
        asset = board.assets.filter(file__endswith=name).first()
        if asset is not None:
            by_name[name] = asset
    return by_id, by_name


def rewrite_scene_asset_urls(board: InteractiveBoard, scene: dict) -> dict:
    """На чтении подменяем старые /media/... на защищённые API URL."""
    files = scene.get("files")
    if not isinstance(files, dict) or not files:
        return scene
    _by_id, by_name = _scene_asset_lookups(board, files)

    updated = {}
    changed = False
    for file_id, meta in files.items():
        if not isinstance(meta, dict):
            updated[file_id] = meta
            continue
        data_url = meta.get("dataURL") or meta.get("url") or ""
        if isinstance(data_url, str) and "/media/cabinet/boards" in data_url:
            name = data_url.rsplit("/", 1)[-1].split("?", 1)[0]
            asset = by_name.get(name)
            if asset:
                path = board_asset_api_path(board.id, asset.id)
                new_meta = dict(meta)
                new_meta["dataURL"] = path
                new_meta["url"] = path
                updated[file_id] = new_meta
                changed = True
                continue
        updated[file_id] = meta
    if not changed:
        return scene
    return {**scene, "files": updated}


def copy_board_assets(source: InteractiveBoard, clone: InteractiveBoard) -> dict:
    """Копирует файлы ассетов и возвращает scene_data с новыми URL."""
    scene = copy.deepcopy(normalize_scene_data(source.scene_data))
    files = scene.get("files")
    if not isinstance(files, dict):
        return scene

    source_assets = list(source.assets.all())
    path_to_asset = {}
    for asset in source_assets:
        path_to_asset[board_asset_api_path(source.id, asset.id)] = asset
        if asset.file:
            path_to_asset[asset.file.url] = asset
            path_to_asset[f"/media/{asset.file.name}"] = asset

    updated = {}
    for file_id, meta in files.items():
        if not isinstance(meta, dict):
            updated[file_id] = meta
            continue
        data_url = meta.get("dataURL") or meta.get("url") or ""
        asset = path_to_asset.get(data_url) if isinstance(data_url, str) else None
        if not asset and isinstance(data_url, str):
            m = ASSET_URL_RE.search(data_url)
            if m and str(m.group("board_id")) == str(source.id):
                asset = next((a for a in source_assets if str(a.id) == m.group("asset_id")), None)
        if not asset or not asset.file:
            updated[file_id] = meta
            continue
        asset.file.open("rb")
        try:
            content = asset.file.read()
        finally:
            asset.file.close()
        new_asset = InteractiveBoardAsset(
            board=clone,
            mime_type=asset.mime_type,
            original_name=asset.original_name,
            size_bytes=len(content),
            created_by=clone.owner,
        )
        new_asset.file.save(os.path.basename(asset.file.name) or f"{file_id}.bin", ContentFile(content), save=True)
        path = board_asset_api_path(clone.id, new_asset.id)
        new_meta = dict(meta)
        new_meta["dataURL"] = path
        new_meta["url"] = path
        updated[file_id] = new_meta
    scene["files"] = updated
    return scene


def version_conflict_response(server_version: int) -> Response:
    return Response(
        {
            "detail": (
                "Доска была изменена в другом окне. "
                "Обновите страницу или сохраните свою версию как копию."
            ),
            "code": "VERSION_CONFLICT",
            "server_version": server_version,
        },
        status=status.HTTP_409_CONFLICT,
    )


def ensure_linked_student_edit_access(board: InteractiveBoard) -> None:
    """Даёт привязанному ученику право совместного редактирования."""
    student = board.student
    if not student or not student.user_id:
        return
    InteractiveBoardAccess.objects.update_or_create(
        board=board,
        user=student.user,
        defaults={"permission": InteractiveBoardAccess.EDIT},
    )


def board_collab_group_name(board_id) -> str:
    return f"interactive_board_{board_id}"


def broadcast_board_collab_event(board_id, payload: dict) -> None:
    """Рассылка события комнаты совместного редактирования (best-effort)."""
    try:
        from asgiref.sync import async_to_sync
        from channels.layers import get_channel_layer
    except Exception:
        return
    channel_layer = get_channel_layer()
    if channel_layer is None:
        return
    try:
        async_to_sync(channel_layer.group_send)(
            board_collab_group_name(board_id),
            {"type": "board.collab", "payload": payload},
        )
    except Exception:
        # Redis/inmemory недоступен — сохранение REST всё равно работает.
        return


class InteractiveBoardListSerializer(serializers.ModelSerializer):
    owner_name = serializers.SerializerMethodField()
    group_title = serializers.CharField(source="group.title", read_only=True, default=None)
    student_name = serializers.SerializerMethodField()
    lesson_title = serializers.CharField(source="lesson.title", read_only=True, default=None)
    schedule_event_title = serializers.CharField(
        source="schedule_event.title", read_only=True, default=None
    )
    permission = serializers.SerializerMethodField()
    can_edit = serializers.SerializerMethodField()
    can_export = serializers.SerializerMethodField()
    collaborative_edit = serializers.SerializerMethodField()

    class Meta:
        model = InteractiveBoard
        fields = [
            "id",
            "title",
            "description",
            "owner",
            "owner_name",
            "group",
            "group_title",
            "student",
            "student_name",
            "lesson",
            "lesson_title",
            "schedule_event",
            "schedule_event_title",
            "thumbnail",
            "allow_export",
            "version",
            "is_archived",
            "created_at",
            "updated_at",
            "permission",
            "can_edit",
            "can_export",
            "collaborative_edit",
        ]
        read_only_fields = fields

    def get_owner_name(self, obj):
        profile = getattr(obj.owner, "profile", None)
        if profile and (profile.display_name or profile.name):
            return profile.display_name or profile.name
        full = obj.owner.get_full_name()
        return full or obj.owner.username

    def get_student_name(self, obj):
        if not obj.student_id:
            return None
        return obj.student.full_name

    def get_permission(self, obj):
        request = self.context.get("request")
        if not request:
            return None
        return obj.get_permission_for(request.user)

    def get_can_edit(self, obj):
        perm = self.get_permission(obj)
        return perm in ("owner", InteractiveBoardAccess.EDIT)

    def get_can_export(self, obj):
        perm = self.get_permission(obj)
        return bool(obj.allow_export or perm == "owner")

    def get_collaborative_edit(self, obj):
        student = obj.student
        if student and student.user_id:
            return True
        # Совместная работа также при явном edit-доступе (после «Показать» на уроке и т.п.).
        return obj.access_records.filter(permission=InteractiveBoardAccess.EDIT).exists()


class InteractiveBoardDetailSerializer(InteractiveBoardListSerializer):
    scene_data = serializers.SerializerMethodField()
    access = serializers.SerializerMethodField()

    class Meta(InteractiveBoardListSerializer.Meta):
        fields = InteractiveBoardListSerializer.Meta.fields + ["scene_data", "access"]

    def get_scene_data(self, obj):
        scene = normalize_scene_data(obj.scene_data)
        scene = rewrite_scene_asset_urls(obj, scene)
        request = self.context.get("request")
        # Зрителю без права экспорта всё равно нужна сцена для просмотра;
        # флаг allow_export учитывается на клиенте. Здесь не вырезаем files.
        return scene

    def get_access(self, obj):
        request = self.context.get("request")
        if not request or obj.owner_id != request.user.id:
            return []
        rows = obj.access_records.select_related("user", "user__profile").all()
        result = []
        for row in rows:
            profile = getattr(row.user, "profile", None)
            name = ""
            if profile:
                name = profile.display_name or profile.name or ""
            if not name:
                name = row.user.get_full_name() or row.user.username
            result.append({
                "id": row.pk,
                "user_id": row.user_id,
                "username": row.user.username,
                "name": name,
                "permission": row.permission,
            })
        return result


class InteractiveBoardWriteSerializer(serializers.ModelSerializer):
    group_id = serializers.IntegerField(required=False, allow_null=True)
    student_id = serializers.IntegerField(required=False, allow_null=True)
    lesson_id = serializers.IntegerField(required=False, allow_null=True)
    schedule_event_id = serializers.IntegerField(required=False, allow_null=True)

    class Meta:
        model = InteractiveBoard
        fields = [
            "title",
            "description",
            "group_id",
            "student_id",
            "lesson_id",
            "schedule_event_id",
            "allow_export",
            "is_archived",
            "thumbnail",
        ]

    def validate_title(self, value):
        title = (value or "").strip()
        if not title:
            return "Новая доска"
        return title[:255]

    def validate_thumbnail(self, value):
        if value and len(value) > MAX_THUMBNAIL_CHARS:
            raise serializers.ValidationError("Превью слишком большое.")
        return value or ""


class InteractiveBoardSceneSerializer(serializers.Serializer):
    scene_data = serializers.JSONField(required=False)
    title = serializers.CharField(required=False, allow_blank=True, max_length=255)
    description = serializers.CharField(required=False, allow_blank=True)
    thumbnail = serializers.CharField(required=False, allow_blank=True)
    allow_export = serializers.BooleanField(required=False)
    version = serializers.IntegerField(required=False, min_value=1)
    group_id = serializers.IntegerField(required=False, allow_null=True)
    student_id = serializers.IntegerField(required=False, allow_null=True)
    lesson_id = serializers.IntegerField(required=False, allow_null=True)
    schedule_event_id = serializers.IntegerField(required=False, allow_null=True)
    is_archived = serializers.BooleanField(required=False)

    def validate_thumbnail(self, value):
        if value and len(value) > MAX_THUMBNAIL_CHARS:
            raise serializers.ValidationError("Превью слишком большое.")
        return value or ""


class InteractiveBoardAccessSerializer(serializers.Serializer):
    user_id = serializers.IntegerField(required=False)
    student_id = serializers.IntegerField(required=False)
    permission = serializers.ChoiceField(
        choices=[InteractiveBoardAccess.VIEW, InteractiveBoardAccess.EDIT],
        default=InteractiveBoardAccess.VIEW,
    )

    def validate(self, attrs):
        if not attrs.get("user_id") and not attrs.get("student_id"):
            raise serializers.ValidationError("Укажите user_id или student_id.")
        return attrs


def user_accessible_boards_qs(user: User):
    owned = Q(owner=user)
    explicit = Q(access_records__user=user)
    as_student = Q(student__user=user)
    via_group = Q(group__students__user=user)
    return (
        InteractiveBoard.objects.filter(owned | explicit | as_student | via_group)
        .distinct()
        .select_related("owner", "owner__profile", "group", "student", "lesson", "schedule_event")
    )


def resolve_related_for_teacher(teacher: User, data: dict) -> dict:
    resolved = {}
    group_id = data.get("group_id", serializers.empty)
    if group_id is not serializers.empty:
        if group_id is None:
            resolved["group"] = None
        else:
            resolved["group"] = get_object_or_404(StudentGroup, pk=group_id, teacher=teacher)

    student_id = data.get("student_id", serializers.empty)
    if student_id is not serializers.empty:
        if student_id is None:
            resolved["student"] = None
        else:
            resolved["student"] = get_object_or_404(Student, pk=student_id, teacher=teacher)

    lesson_id = data.get("lesson_id", serializers.empty)
    if lesson_id is not serializers.empty:
        if lesson_id is None:
            resolved["lesson"] = None
        else:
            resolved["lesson"] = get_object_or_404(Lesson, pk=lesson_id, teacher=teacher)

    schedule_event_id = data.get("schedule_event_id", serializers.empty)
    if schedule_event_id is not serializers.empty:
        if schedule_event_id is None or schedule_event_id == "":
            resolved["schedule_event"] = None
        else:
            pk = parse_local_event_id(schedule_event_id)
            if pk is None:
                raise Http404("Занятие не найдено")
            event = get_object_or_404(ScheduleEvent, pk=pk, owner=teacher)
            resolved["schedule_event"] = event
            # Автоматически привязываем ученика/группу урока к доске.
            if student_id is serializers.empty and event.student_id:
                resolved["student"] = event.student
            if group_id is serializers.empty and event.group_id:
                resolved["group"] = event.group
    return resolved


class InteractiveBoardViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated]
    lookup_field = "id"
    parser_classes = [JSONParser, MultiPartParser, FormParser]
    http_method_names = ["get", "post", "put", "patch", "delete", "head", "options"]

    def get_queryset(self):
        qs = user_accessible_boards_qs(self.request.user)
        params = self.request.query_params

        # Список: архив скрыт, detail/actions — архив доступен владельцу/имеющим доступ
        if self.action == "list" and params.get("include_archived") != "1":
            qs = qs.filter(is_archived=False)

        search = (params.get("search") or "").strip()
        if search:
            qs = qs.filter(title__icontains=search)

        group_id = _parse_optional_pk(params.get("group"))
        if params.get("group") and group_id is None:
            return qs.none()
        if group_id is not None:
            qs = qs.filter(group_id=group_id)

        student_id = _parse_optional_pk(params.get("student"))
        if params.get("student") and student_id is None:
            return qs.none()
        if student_id is not None:
            qs = qs.filter(student_id=student_id)

        lesson_id = _parse_optional_pk(params.get("lesson"))
        if params.get("lesson") and lesson_id is None:
            return qs.none()
        if lesson_id is not None:
            qs = qs.filter(lesson_id=lesson_id)

        raw_schedule_event = params.get("schedule_event")
        schedule_event_id = _parse_optional_pk(raw_schedule_event)
        if raw_schedule_event and schedule_event_id is None:
            return qs.none()
        if schedule_event_id is not None:
            qs = qs.filter(schedule_event_id=schedule_event_id)

        return qs.order_by("-updated_at")

    def get_serializer_class(self):
        if self.action == "create":
            return InteractiveBoardWriteSerializer
        if self.action in ("update", "partial_update"):
            return InteractiveBoardSceneSerializer
        if self.action == "retrieve":
            return InteractiveBoardDetailSerializer
        return InteractiveBoardListSerializer

    def create(self, request, *args, **kwargs):
        profile = getattr(request.user, "profile", None)
        if not profile or profile.role != Profile.Role.TEACHER:
            return Response(
                {"detail": "Создавать доски могут только учителя."},
                status=status.HTTP_403_FORBIDDEN,
            )

        serializer = InteractiveBoardWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        related = resolve_related_for_teacher(
            request.user,
            {
                "group_id": request.data.get("group_id", serializers.empty),
                "student_id": request.data.get("student_id", serializers.empty),
                "lesson_id": request.data.get("lesson_id", serializers.empty),
                "schedule_event_id": request.data.get("schedule_event_id", serializers.empty),
            },
        )

        title = data.get("title") or "Новая доска"
        board = InteractiveBoard.objects.create(
            owner=request.user,
            title=title,
            description=data.get("description") or "",
            scene_data=empty_board_scene(),
            allow_export=data.get("allow_export", True),
            **related,
        )

        ensure_linked_student_edit_access(board)

        out = InteractiveBoardDetailSerializer(board, context={"request": request})
        return Response(out.data, status=status.HTTP_201_CREATED)

    def retrieve(self, request, *args, **kwargs):
        board = self.get_object()
        perm = board.get_permission_for(request.user)
        if not perm:
            return Response({"detail": "Доска не найдена."}, status=status.HTTP_404_NOT_FOUND)
        data = InteractiveBoardDetailSerializer(board, context={"request": request}).data
        data["permission"] = perm
        data["can_edit"] = perm in ("owner", InteractiveBoardAccess.EDIT)
        data["can_manage"] = perm == "owner"
        data["can_export"] = bool(board.allow_export or perm == "owner")
        data["viewer_user_id"] = request.user.id
        data["viewer_role"] = "teacher" if perm == "owner" else ("student" if perm == InteractiveBoardAccess.EDIT else "viewer")
        return Response(data)

    def update(self, request, *args, **kwargs):
        kwargs["partial"] = True
        return self.partial_update(request, *args, **kwargs)

    def partial_update(self, request, *args, **kwargs):
        board = self.get_object()
        perm = board.get_permission_for(request.user)
        if not perm:
            return Response({"detail": "Доска не найдена."}, status=status.HTTP_404_NOT_FOUND)

        serializer = InteractiveBoardSceneSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        meta_fields = {"title", "description", "allow_export", "is_archived", "thumbnail"}
        relation_fields = {"group_id", "student_id", "lesson_id", "schedule_event_id"}
        touches_scene = "scene_data" in data

        if touches_scene and perm not in ("owner", InteractiveBoardAccess.EDIT):
            return Response(
                {"detail": "Недостаточно прав для редактирования доски."},
                status=status.HTTP_403_FORBIDDEN,
            )
        if perm != "owner":
            allowed_editor_meta = {"thumbnail"}
            if set(data.keys()) - allowed_editor_meta - {"scene_data", "version"}:
                return Response(
                    {"detail": "Только владелец может менять настройки доски."},
                    status=status.HTTP_403_FORBIDDEN,
                )

        saved_scene = None
        try:
            with transaction.atomic():
                locked = InteractiveBoard.objects.select_for_update().get(pk=board.pk)

                if touches_scene:
                    client_version = data.get("version")
                    if client_version is None:
                        return Response(
                            {
                                "detail": "Для сохранения сцены укажите version.",
                                "code": "VERSION_REQUIRED",
                            },
                            status=status.HTTP_400_BAD_REQUEST,
                        )
                    if int(client_version) != locked.version:
                        return version_conflict_response(locked.version)

                    scene = normalize_scene_data(data["scene_data"])
                    scene = enforce_element_ownership(
                        normalize_scene_data(locked.scene_data),
                        scene,
                        user_id=request.user.id,
                        is_owner=(perm == "owner"),
                    )
                    scene, _compacted = compact_scene_data(scene)
                    try:
                        scene = persist_large_scene_files(locked, scene, request.user)
                    except serializers.ValidationError as exc:
                        return Response(exc.detail, status=status.HTTP_400_BAD_REQUEST)
                    size = estimate_json_bytes(scene)
                    if size > MAX_SCENE_JSON_BYTES:
                        return Response(
                            {
                                "detail": (
                                    "Данные доски слишком большие. "
                                    "Уменьшите число изображений или их размер."
                                ),
                                "code": "SCENE_TOO_LARGE",
                            },
                            status=status.HTTP_400_BAD_REQUEST,
                        )

                    saved_scene = scene
                    locked.scene_data = scene
                    locked.version = locked.version + 1

                if "title" in data and perm == "owner":
                    title = (data["title"] or "").strip() or "Новая доска"
                    locked.title = title[:255]
                if "description" in data and perm == "owner":
                    locked.description = data["description"] or ""
                if "allow_export" in data and perm == "owner":
                    locked.allow_export = data["allow_export"]
                if "is_archived" in data and perm == "owner":
                    locked.is_archived = data["is_archived"]
                if "thumbnail" in data and perm in ("owner", InteractiveBoardAccess.EDIT):
                    locked.thumbnail = data["thumbnail"] or ""

                if perm == "owner":
                    related = resolve_related_for_teacher(
                        request.user,
                        {
                            "group_id": data["group_id"] if "group_id" in data else serializers.empty,
                            "student_id": data["student_id"] if "student_id" in data else serializers.empty,
                            "lesson_id": data["lesson_id"] if "lesson_id" in data else serializers.empty,
                            "schedule_event_id": (
                                data["schedule_event_id"]
                                if "schedule_event_id" in data
                                else serializers.empty
                            ),
                        },
                    )
                    for key, value in related.items():
                        setattr(locked, key, value)

                locked.save()
                board = locked
                if perm == "owner" and (
                    "student_id" in data or "schedule_event_id" in data
                ):
                    ensure_linked_student_edit_access(board)
        except InteractiveBoard.DoesNotExist:
            return Response({"detail": "Доска не найдена."}, status=status.HTTP_404_NOT_FOUND)

        if touches_scene:
            elements = saved_scene.get("elements") if isinstance(saved_scene, dict) else None
            element_count = len(elements) if isinstance(elements, list) else 0
            # Lite: пиры уже на live-ops — не гоняем полный JSON сцены/files по WS.
            # Полный snapshot остаётся в REST; reconnect делает snapshot_request/fetch.
            broadcast_board_collab_event(
                board.id,
                {
                    "type": "scene_saved",
                    "board_id": str(board.id),
                    "version": board.version,
                    "lite": True,
                    "element_count": element_count,
                    "user_id": request.user.id,
                    "display_name": (
                        getattr(getattr(request.user, "profile", None), "display_name", None)
                        or getattr(getattr(request.user, "profile", None), "name", None)
                        or request.user.get_full_name()
                        or request.user.username
                    ),
                },
            )

        permission = board.get_permission_for(request.user)
        if touches_scene:
            # Autosave не должен получать полный scene_data — ответ в мегабайты
            # на каждый PATCH во время урока. GET detail по-прежнему отдаёт сцену.
            return Response(
                {
                    "id": str(board.id),
                    "version": board.version,
                    "updated_at": board.updated_at,
                    "permission": permission,
                    "can_edit": permission in ("owner", InteractiveBoardAccess.EDIT),
                    "can_manage": permission == "owner",
                    "can_export": bool(board.allow_export or permission == "owner"),
                }
            )

        out = InteractiveBoardDetailSerializer(board, context={"request": request}).data
        out["permission"] = permission
        out["can_edit"] = permission in ("owner", InteractiveBoardAccess.EDIT)
        out["can_manage"] = permission == "owner"
        out["can_export"] = bool(board.allow_export or permission == "owner")
        return Response(out)

    def destroy(self, request, *args, **kwargs):
        board = self.get_object()
        if board.owner_id != request.user.id:
            return Response(
                {"detail": "Удалять доску может только владелец."},
                status=status.HTTP_403_FORBIDDEN,
            )
        board.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["post"], url_path="duplicate")
    def duplicate(self, request, id=None):
        board = self.get_object()
        perm = board.get_permission_for(request.user)
        if not perm:
            return Response({"detail": "Доска не найдена."}, status=status.HTTP_404_NOT_FOUND)

        profile = getattr(request.user, "profile", None)
        if profile and profile.role == Profile.Role.TEACHER:
            owner = request.user
        elif board.owner_id == request.user.id:
            owner = request.user
        else:
            return Response(
                {"detail": "Создавать копию могут учителя."},
                status=status.HTTP_403_FORBIDDEN,
            )

        student_id = request.data.get("student_id")
        for_student = None
        if student_id is not None:
            for_student = get_object_or_404(Student, pk=student_id, teacher=owner)

        with transaction.atomic():
            clone = InteractiveBoard.objects.create(
                owner=owner,
                title=f"{board.title} (копия)",
                description=board.description,
                group=board.group if for_student is None else None,
                student=for_student,
                lesson=board.lesson,
                schedule_event=board.schedule_event,
                scene_data=empty_board_scene(),
                thumbnail=board.thumbnail[:MAX_THUMBNAIL_CHARS] if board.thumbnail else "",
                allow_export=board.allow_export,
                version=1,
            )
            clone.scene_data = copy_board_assets(board, clone)
            clone.save(update_fields=["scene_data", "updated_at"])
            if for_student and for_student.user_id:
                InteractiveBoardAccess.objects.create(
                    board=clone,
                    user=for_student.user,
                    permission=InteractiveBoardAccess.EDIT
                    if request.data.get("permission") == InteractiveBoardAccess.EDIT
                    else InteractiveBoardAccess.VIEW,
                )

        out = InteractiveBoardDetailSerializer(clone, context={"request": request}).data
        return Response(out, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="clear")
    def clear(self, request, id=None):
        board = self.get_object()
        perm = board.get_permission_for(request.user)
        if perm not in ("owner", InteractiveBoardAccess.EDIT):
            return Response(
                {"detail": "Недостаточно прав для очистки доски."},
                status=status.HTTP_403_FORBIDDEN,
            )
        client_version = request.data.get("version")
        if client_version is None:
            return Response(
                {"detail": "Для очистки укажите version.", "code": "VERSION_REQUIRED"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        with transaction.atomic():
            locked = InteractiveBoard.objects.select_for_update().get(pk=board.pk)
            if int(client_version) != locked.version:
                return version_conflict_response(locked.version)
            locked.scene_data = empty_board_scene()
            locked.version = locked.version + 1
            locked.thumbnail = ""
            locked.save(update_fields=["scene_data", "version", "thumbnail", "updated_at"])
            board = locked
        # Пиры должны сразу очистить холст — раньше clear не вещал в WS-группу.
        # Флаг cleared обязателен: пустой elements[] при element-level merge
        # иначе оставляет локальные элементы пира («воскрешение» после очистки).
        broadcast_board_collab_event(
            board.id,
            {
                "type": "scene_saved",
                "board_id": str(board.id),
                "version": board.version,
                "cleared": True,
                "scene": rewrite_scene_asset_urls(board, normalize_scene_data(board.scene_data)),
                "user_id": request.user.id,
                "display_name": (
                    getattr(getattr(request.user, "profile", None), "display_name", None)
                    or getattr(getattr(request.user, "profile", None), "name", None)
                    or request.user.get_full_name()
                    or request.user.username
                ),
            },
        )
        return Response({
            "id": str(board.id),
            "version": board.version,
            "scene_data": board.scene_data,
        })

    @action(detail=True, methods=["get", "put"], url_path="access")
    def access(self, request, id=None):
        board = self.get_object()
        if board.owner_id != request.user.id:
            return Response(
                {"detail": "Настройки доступа доступны только владельцу."},
                status=status.HTTP_403_FORBIDDEN,
            )

        if request.method == "GET":
            data = InteractiveBoardDetailSerializer(board, context={"request": request}).data
            return Response({"access": data["access"], "allow_export": board.allow_export})

        items = request.data.get("access")
        if items is None:
            items = [request.data] if request.data else []
        if not isinstance(items, list):
            return Response({"detail": "Ожидается список access."}, status=status.HTTP_400_BAD_REQUEST)

        # replace по умолчанию True, если передан полный список access
        replace = request.data.get("replace")
        if replace is None:
            replace = "access" in request.data

        with transaction.atomic():
            keep_user_ids = set()
            for raw in items:
                ser = InteractiveBoardAccessSerializer(data=raw)
                ser.is_valid(raise_exception=True)
                payload = ser.validated_data
                if payload.get("student_id"):
                    student = get_object_or_404(
                        Student, pk=payload["student_id"], teacher=request.user
                    )
                    if not student.user_id:
                        return Response(
                            {
                                "detail": (
                                    f"У ученика «{student.full_name}» нет аккаунта для доступа."
                                )
                            },
                            status=status.HTTP_400_BAD_REQUEST,
                        )
                    user = student.user
                else:
                    user = get_object_or_404(User, pk=payload["user_id"])
                    if user.id == request.user.id:
                        continue
                    owns_student = Student.objects.filter(teacher=request.user, user=user).exists()
                    if not owns_student:
                        return Response(
                            {"detail": "Можно выдавать доступ только своим ученикам."},
                            status=status.HTTP_403_FORBIDDEN,
                        )

                keep_user_ids.add(user.id)
                InteractiveBoardAccess.objects.update_or_create(
                    board=board,
                    user=user,
                    defaults={"permission": payload["permission"]},
                )

            if replace:
                board.access_records.exclude(user_id__in=keep_user_ids).delete()

        if "allow_export" in request.data:
            board.allow_export = bool(request.data.get("allow_export"))
            board.save(update_fields=["allow_export", "updated_at"])

        data = InteractiveBoardDetailSerializer(board, context={"request": request}).data
        return Response({"access": data["access"], "allow_export": board.allow_export})

    @action(detail=True, methods=["post"], url_path="upload-image")
    def upload_image(self, request, id=None):
        board = self.get_object()
        perm = board.get_permission_for(request.user)
        if perm not in ("owner", InteractiveBoardAccess.EDIT):
            return Response(
                {"detail": "Недостаточно прав для загрузки изображений."},
                status=status.HTTP_403_FORBIDDEN,
            )

        uploaded = request.FILES.get("file") or request.FILES.get("image")
        try:
            validate_board_image_upload(uploaded)
        except UploadValidationError as exc:
            return Response(
                {"detail": exc.message, "code": exc.code},
                status=status.HTTP_400_BAD_REQUEST,
            )

        file_id = request.data.get("id") or str(uuid.uuid4())
        raw = uploaded.read()
        try:
            mime = validate_board_image_bytes(
                raw,
                (getattr(uploaded, "content_type", "") or "").split(";", 1)[0],
            )
        except UploadValidationError as exc:
            return Response(
                {"detail": exc.message, "code": exc.code},
                status=status.HTTP_400_BAD_REQUEST,
            )

        asset, _created = get_or_create_board_asset(
            board,
            content=raw,
            mime=mime,
            file_id=str(file_id),
            user=request.user,
        )
        path = board_asset_api_path(board.id, asset.id)

        return Response({
            "id": file_id,
            "asset_id": str(asset.id),
            "mimeType": mime,
            "dataURL": path,
            "url": path,
            "created": int(asset.created_at.timestamp() * 1000),
        }, status=status.HTTP_201_CREATED)

    @action(
        detail=True,
        methods=["get"],
        url_path=r"assets/(?P<asset_id>[0-9a-f-]{36})",
    )
    def download_asset(self, request, id=None, asset_id=None):
        board = self.get_object()
        perm = board.get_permission_for(request.user)
        if not perm:
            return Response({"detail": "Доска не найдена."}, status=status.HTTP_404_NOT_FOUND)
        asset = get_object_or_404(InteractiveBoardAsset, pk=asset_id, board=board)
        if not asset.file:
            raise Http404()
        return FileResponse(
            asset.file.open("rb"),
            content_type=asset.mime_type or "application/octet-stream",
            as_attachment=False,
            filename=asset.original_name or os.path.basename(asset.file.name),
        )


class StudentInteractiveBoardsView(APIView):
    """Список досок, доступных ученику."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        profile = getattr(request.user, "profile", None)
        if not profile or profile.role != Profile.Role.STUDENT:
            return Response({"detail": "Доступ только для учеников."}, status=status.HTTP_403_FORBIDDEN)

        qs = user_accessible_boards_qs(request.user).filter(is_archived=False).order_by("-updated_at")
        data = InteractiveBoardListSerializer(qs, many=True, context={"request": request}).data
        return Response({"results": data})
