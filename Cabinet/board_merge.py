"""Объединение досок одного ученика (или группы) в одну доску tldraw.

Содержимое цели меняется только через sync-сервер (живая комната), поэтому
подключённые клиенты получают листы штатной синхронизацией. Исходные доски
не удаляются: они уходят в архив, их файлы копируются в цель, журнал
объединения пишется в BOARD_MERGE_LOG_DIR, и объединение можно откатить.
"""
from __future__ import annotations

import json
import os
import secrets
import urllib.request
from collections import defaultdict

from django.conf import settings
from django.core.files.base import ContentFile
from django.db import transaction
from django.utils import timezone

from .models import InteractiveBoard, InteractiveBoardAsset

SYNC_URL = os.environ.get("TLDRAW_SYNC_INTERNAL_URL", "http://127.0.0.1:5858")
LOG_DIR = os.environ.get("BOARD_MERGE_LOG_DIR", "/var/lib/itflux/board-merges")


class MergeError(Exception):
    def __init__(self, message, code="merge_failed", status=400):
        super().__init__(message)
        self.message = message
        self.code = code
        self.status = status


def _sync_call(path: str, body: dict, timeout: int = 120) -> dict:
    secret = str(getattr(settings, "TLDRAW_SYNC_SECRET", "") or "").strip()
    if not secret:
        raise MergeError("Сервер доски не настроен.", "sync_unconfigured", 503)
    req = urllib.request.Request(
        f"{SYNC_URL}{path}",
        data=json.dumps(body, ensure_ascii=False, default=str).encode("utf-8"),
        headers={"content-type": "application/json", "x-itflux-sync-secret": secret},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "ignore")[:300]
        raise MergeError(f"Сервер доски отказал: {detail}", "sync_error", 502)
    except OSError as exc:
        raise MergeError(f"Сервер доски недоступен: {exc}", "sync_unavailable", 503)


# r49: число живых элементов считаем в Postgres — раньше suggestions грузил
# scene_data всех досок (десятки МБ JSON, ~5 с на запрос /merge-suggestions/).
LIVE_ELEMENTS_SQL = (
    "SELECT count(*) FROM jsonb_array_elements("
    "CASE WHEN jsonb_typeof(scene_data->'elements') = 'array' "
    "THEN scene_data->'elements' ELSE '[]'::jsonb END) AS e "
    "WHERE jsonb_typeof(e) = 'object' "
    "AND coalesce(e->>'isDeleted', 'false') NOT IN ('true', '1')"
)


def _scene_elements(board) -> int:
    pre = getattr(board, "_live_elements", None)
    if pre is not None:
        return int(pre)
    scene = board.scene_data or {}
    els = scene.get("elements") if isinstance(scene, dict) else None
    if not isinstance(els, list):
        return 0
    return sum(1 for e in els if isinstance(e, dict) and not e.get("isDeleted"))


def classify_boards(boards) -> dict:
    """id -> {"kind": room|excalidraw|empty, "shapes", "elements", "sessions"}."""
    boards = list(boards)
    if not boards:
        return {}
    status = _sync_call("/internal/room-status", {"ids": [str(b.id) for b in boards]}).get("rooms", {})
    out = {}
    for b in boards:
        st = status.get(str(b.id).lower(), {})
        shapes = int(st.get("shapes") or 0)
        elements = _scene_elements(b)
        if shapes > 0:
            kind = "room"
        elif elements > 0:
            kind = "excalidraw"
        else:
            kind = "empty"
        out[str(b.id)] = {
            "kind": kind,
            "shapes": shapes,
            "elements": elements,
            "sessions": int(st.get("sessions") or 0),
        }
    return out


def _date_label(board) -> str:
    return timezone.localtime(board.created_at).strftime("%d.%m.%Y")


def pick_target(boards, kinds) -> InteractiveBoard:
    """Цель: самая свежая доска с живой комнатой tldraw, иначе самая свежая вообще."""
    ordered = sorted(boards, key=lambda b: b.updated_at, reverse=True)
    for b in ordered:
        if kinds[str(b.id)]["kind"] == "room":
            return b
    return ordered[0]


def owner_candidate_groups(owner):
    """Ученики/группы владельца с 2+ активными досками."""
    qs = (
        InteractiveBoard.objects.filter(owner=owner, is_archived=False)
        .defer("scene_data", "thumbnail")
        .select_related("student", "group")
    )
    groups = defaultdict(list)
    for b in qs:
        if b.student_id:
            groups[("student", b.student_id)].append(b)
        elif b.group_id:
            groups[("group", b.group_id)].append(b)
    return {k: v for k, v in groups.items() if len(v) >= 2}


def _key_boards(owner, kind, ref_id, board_ids=None):
    filt = {"owner": owner, "is_archived": False}
    if kind == "student":
        filt["student_id"] = ref_id
    elif kind == "group":
        filt["group_id"] = ref_id
        filt["student__isnull"] = True
    else:
        raise MergeError("Неизвестный тип объединения.")
    qs = InteractiveBoard.objects.filter(**filt)
    if board_ids:
        qs = qs.filter(id__in=board_ids)
    return list(qs)


def _display_name(kind, boards):
    b = boards[0]
    if kind == "student" and b.student:
        return str(getattr(b.student, "full_name", "") or getattr(b.student, "name", "") or b.student)
    if kind == "group" and b.group:
        return str(getattr(b.group, "title", "") or getattr(b.group, "name", "") or b.group)
    return ""


def suggestions_for(owner) -> list:
    groups = owner_candidate_groups(owner)
    if not groups:
        return []
    all_boards = [b for v in groups.values() for b in v]
    # scene_data нужен для классификации, но только для этих досок.
    from django.db.models.expressions import RawSQL

    with_scene = {
        str(b.id): b
        for b in InteractiveBoard.objects.filter(id__in=[b.id for b in all_boards])
        .defer("scene_data", "thumbnail")
        .annotate(_live_elements=RawSQL(LIVE_ELEMENTS_SQL, []))
    }
    kinds = classify_boards(with_scene.values())
    result = []
    for (kind, ref_id), boards in groups.items():
        boards = [with_scene[str(b.id)] for b in boards]
        target = pick_target(boards, kinds)
        mergeable = [b for b in boards if b.id != target.id and kinds[str(b.id)]["kind"] != "empty"]
        empty = [b for b in boards if b.id != target.id and kinds[str(b.id)]["kind"] == "empty"]
        result.append({
            "kind": kind,
            "ref_id": ref_id,
            "name": _display_name(kind, boards),
            "count": len(boards),
            "target_id": str(target.id),
            "target_title": target.title,
            "boards": [
                {
                    "id": str(b.id),
                    "title": b.title,
                    "created_at": b.created_at,
                    "date_label": _date_label(b),
                    "kind": kinds[str(b.id)]["kind"],
                    "connected": kinds[str(b.id)]["sessions"],
                    "is_target": b.id == target.id,
                }
                for b in sorted(boards, key=lambda x: x.created_at)
            ],
            "mergeable_count": len(mergeable),
            "empty_count": len(empty),
        })
    result.sort(key=lambda r: -r["count"])
    return result


def _copy_assets(source, target, user) -> tuple[dict, list]:
    from .boards_api import board_asset_api_path

    url_map, created = {}, []
    for asset in InteractiveBoardAsset.objects.filter(board=source):
        if not asset.file:
            continue
        try:
            asset.file.open("rb")
            try:
                content = asset.file.read()
            finally:
                asset.file.close()
        except OSError:
            continue
        new_asset = InteractiveBoardAsset(
            board=target,
            mime_type=asset.mime_type,
            original_name=asset.original_name,
            content_sha256=asset.content_sha256,
            size_bytes=len(content),
            created_by=user,
        )
        new_asset.file.save(os.path.basename(asset.file.name) or f"{asset.id}.bin", ContentFile(content), save=True)
        created.append(str(new_asset.id))
        new_path = board_asset_api_path(target.id, new_asset.id)
        url_map[board_asset_api_path(source.id, asset.id)] = new_path
        url_map[board_asset_api_path(source.id, asset.id).rstrip("/")] = new_path.rstrip("/")
        url_map[asset.file.url] = new_path
        url_map[f"/media/{asset.file.name}"] = new_path
    return url_map, created


def merge_boards(owner, kind, ref_id, target_id=None, board_ids=None) -> dict:
    boards = _key_boards(owner, kind, ref_id, board_ids)
    if len(boards) < 2:
        raise MergeError("Для объединения нужно хотя бы две доски.", "not_enough_boards")
    kinds = classify_boards(boards)
    if target_id:
        target = next((b for b in boards if str(b.id) == str(target_id)), None)
        if not target:
            raise MergeError("Целевая доска не найдена среди досок ученика.", "bad_target")
    else:
        target = pick_target(boards, kinds)
    sources = sorted([b for b in boards if b.id != target.id], key=lambda b: b.created_at)
    # Своё старое содержимое цели (если комнаты ещё нет) идёт последним листом перед её листами.
    legacy_target = kinds[str(target.id)]["kind"] == "excalidraw"

    merge_id = timezone.now().strftime("%Y%m%d%H%M%S") + "-" + secrets.token_hex(4)
    url_map, copied_assets, parts, archived, skipped = {}, [], [], [], []
    for b in sources:
        k = kinds[str(b.id)]["kind"]
        if k == "empty":
            archived.append(str(b.id))
            continue
        m, created = _copy_assets(b, target, owner)
        url_map.update(m)
        copied_assets += created
        part = {"source_id": str(b.id), "label": _date_label(b), "kind": k, "_at": b.created_at}
        if k == "excalidraw":
            part["scene"] = b.scene_data
        parts.append(part)
    if legacy_target:
        parts.append({"source_id": str(target.id), "label": _date_label(target), "kind": "excalidraw",
                      "scene": target.scene_data, "self": True, "_at": target.created_at})
    parts.sort(key=lambda p: p["_at"])
    for p in parts:
        p.pop("_at", None)
        # sync-сервер не принимает source == target: передаём сцену как отдельную часть.
    log = {
        "merge_id": merge_id,
        "owner_id": owner.id,
        "kind": kind,
        "ref_id": ref_id,
        "target_id": str(target.id),
        "sources": [{"id": p["source_id"], "label": p["label"], "kind": p["kind"]} for p in parts],
        "archived_empty": archived,
        "copied_assets": copied_assets,
        "created_at": timezone.now().isoformat(),
        "status": "started",
    }
    os.makedirs(LOG_DIR, exist_ok=True)
    log_path = os.path.join(LOG_DIR, f"{merge_id}.json")
    with open(log_path, "w", encoding="utf-8") as fh:
        json.dump(log, fh, ensure_ascii=False, indent=1)

    result = {"pages": 0, "shapes": 0}
    sync_parts = []
    for p in parts:
        q = dict(p)
        if q.pop("self", False):
            # Уникальный псевдо-id: часть не читает комнату, только сцену.
            q["source_id"] = "00000000-0000-4000-8000-" + secrets.token_hex(6)
        sync_parts.append(q)
    if sync_parts:
        result = _sync_call("/internal/merge", {
            "target": str(target.id),
            "merge_id": merge_id,
            "parts": sync_parts,
            "url_map": url_map,
        }, timeout=300)

    merged_ids = [p["source_id"] for p in parts if p["source_id"] != str(target.id)]
    with transaction.atomic():
        InteractiveBoard.objects.filter(id__in=merged_ids + archived, owner=owner).update(is_archived=True)
        # Превью цели пересоберётся при следующем открытии.
        InteractiveBoard.objects.filter(id=target.id).update(updated_at=timezone.now())

    log.update({"status": "done", "result": result, "archived": merged_ids + archived})
    with open(log_path, "w", encoding="utf-8") as fh:
        json.dump(log, fh, ensure_ascii=False, indent=1)
    return {
        "merge_id": merge_id,
        "target_id": str(target.id),
        "pages_added": result.get("pages", 0),
        "shapes_added": result.get("shapes", 0),
        "archived": merged_ids + archived,
        "connected_clients": result.get("sessions", 0),
    }


def undo_merge(owner, merge_id) -> dict:
    if not merge_id or "/" in merge_id or ".." in merge_id:
        raise MergeError("Неверный идентификатор объединения.")
    log_path = os.path.join(LOG_DIR, f"{merge_id}.json")
    if not os.path.isfile(log_path):
        raise MergeError("Объединение не найдено.", "not_found", 404)
    with open(log_path, encoding="utf-8") as fh:
        log = json.load(fh)
    if log.get("owner_id") != owner.id:
        raise MergeError("Объединение не найдено.", "not_found", 404)
    if log.get("status") == "undone":
        raise MergeError("Объединение уже отменено.", "already_undone")
    res = _sync_call("/internal/unmerge", {"target": log["target_id"], "merge_id": merge_id})
    InteractiveBoard.objects.filter(id__in=log.get("archived") or [], owner=owner).update(is_archived=False)
    # Скопированные файлы оставляем: удалять что-либо при откате не нужно.
    log.update({"status": "undone", "undone_at": timezone.now().isoformat(), "undo_result": res})
    with open(log_path, "w", encoding="utf-8") as fh:
        json.dump(log, fh, ensure_ascii=False, indent=1)
    return {"merge_id": merge_id, "restored": log.get("archived") or [], "removed_records": res.get("removed", 0)}
