"""One live board scene per room, not a queue of full copies.

scene_live and snapshot_response carry the whole element array. The in-memory
channel layer deep-copies every send into a queue of 100. A few 15 MB scenes
fill that queue and stay there until some socket reads again. The queue now
carries a short stub. The scene itself is replaced in one slot.
"""

from __future__ import annotations

_SLOTS: dict[tuple[str, str, str], dict] = {}


def _key(group: str, payload: dict) -> tuple[str, str, str] | None:
    kind = str(payload.get("type") or "")
    if kind == "scene_live":
        return (str(group), kind, "")
    if kind == "snapshot_response":
        return (str(group), kind, str(payload.get("target_client_id") or ""))
    return None


def stage_board_event(group: str, event: dict) -> dict:
    payload = event.get("payload") if isinstance(event, dict) else None
    if not isinstance(payload, dict):
        return event
    key = _key(group, payload)
    if key is None:
        return event
    _SLOTS[key] = event
    stub = {
        "type": payload.get("type"),
        "client_id": payload.get("client_id"),
        "scene_slot": "|".join(key),
    }
    if payload.get("target_client_id"):
        stub["target_client_id"] = payload.get("target_client_id")
    return {"type": event.get("type") or "board.collab", "payload": stub}


def resolve_board_event(event: dict) -> dict:
    payload = event.get("payload") if isinstance(event, dict) else None
    if not isinstance(payload, dict):
        return event
    raw = payload.get("scene_slot")
    if not raw:
        return event
    parts = str(raw).split("|", 2)
    if len(parts) != 3:
        return event
    staged = _SLOTS.get((parts[0], parts[1], parts[2]))
    return staged if isinstance(staged, dict) else event


def drop_board_scenes(group: str) -> None:
    for key in list(_SLOTS):
        if key[0] == group:
            _SLOTS.pop(key, None)


def staged_scene_count() -> int:
    return len(_SLOTS)


def reset_board_scenes_for_tests() -> None:
    _SLOTS.clear()
