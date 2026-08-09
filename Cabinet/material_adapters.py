"""Адаптеры синхронизации материалов видеоурока."""

from __future__ import annotations

from copy import deepcopy
from typing import Any


# Операции навигации: по умолчанию только преподаватель (даже в collaborative).
NAVIGATION_ACTIONS = frozenset({
    "page_changed",
    "scrolled",
    "zoom_changed",
    "tab_changed",
    "viewport_changed",
})

# Эфемерные действия — не повышают версию и не пишутся в БД.
EPHEMERAL_ACTIONS = frozenset({
    "cursor",
    "pointer",
    "drag_preview",
    "annotation_preview",
    "student_viewport",
})

CONTENT_ACTIONS = frozenset({
    "annotation_added",
    "annotation_updated",
    "annotation_deleted",
    "answer_selected",
    "field_changed",
    "item_moved",
    "item_selected",
    "pair_connected",
    "pair_disconnected",
    "state_updated",
    "cards_flipped",
    "text_note_added",
    "text_note_updated",
    "text_note_deleted",
    "cell_updated",
    "sheet_changed",
    "selection_changed",
})

# В режиме следования за учителем ученик может отвечать, но не рисовать
# и не менять глобальную позицию материала.
FOLLOW_MODE_CONTENT_ACTIONS = frozenset({
    "answer_selected",
    "field_changed",
    "item_moved",
    "item_selected",
    "pair_connected",
    "pair_disconnected",
    "cards_flipped",
    "state_updated",
})

COLLAB_PERMISSION_ACTIONS = {
    "answers_only": FOLLOW_MODE_CONTENT_ACTIONS | frozenset({
        "cursor", "pointer", "student_viewport",
    }),
    "annotate": FOLLOW_MODE_CONTENT_ACTIONS | frozenset({
        "annotation_added", "annotation_updated", "annotation_deleted",
        "text_note_added", "text_note_updated", "text_note_deleted",
        "cursor", "pointer", "annotation_preview", "student_viewport",
    }) | NAVIGATION_ACTIONS,
    "edit_content": CONTENT_ACTIONS | NAVIGATION_ACTIONS | EPHEMERAL_ACTIONS | frozenset({
        "cell_updated", "sheet_changed", "selection_changed",
    }),
    "full": CONTENT_ACTIONS | NAVIGATION_ACTIONS | EPHEMERAL_ACTIONS | frozenset({
        "cell_updated", "sheet_changed", "selection_changed",
    }),
}

MAX_ANNOTATIONS = 500
MAX_POINTS_PER_STROKE = 800
MAX_PAYLOAD_BYTES = 48_000
MAX_FIELD_VALUE_LEN = 4000


class MaterialCollaborationError(Exception):
    def __init__(self, message: str, *, code: str = "invalid", status: int = 400):
        super().__init__(message)
        self.message = message
        self.code = code
        self.status = status


class MaterialCollaborationAdapter:
    resource_kind = "file"
    supported_actions: frozenset[str] = frozenset()
    student_content_actions: frozenset[str] = frozenset()
    student_can_navigate = False

    def initial_state(self) -> dict:
        return {
            "page": 1,
            "zoom": 1.0,
            "scroll": 0.0,
            "scrollX": 0.0,
            "tab": "",
            "annotations": [],
            "answers": {},
            "fields": {},
            "items": {},
            "pairs": [],
            "notes": [],
        }

    def allowed_actions_for(
        self,
        *,
        role: str,
        interaction_mode: str,
        can_collaborate: bool,
        can_browse_independently: bool = False,
        collaboration_permission: str = "annotate",
    ) -> frozenset[str]:
        if role in ("teacher", "staff", "coteacher"):
            return self.supported_actions | EPHEMERAL_ACTIONS
        # Follow + ответы; навигация — только при independent / collaborative.
        follow_actions = (FOLLOW_MODE_CONTENT_ACTIONS & self.student_content_actions) | {
            "cursor",
            "pointer",
            "student_viewport",
        }
        allowed = set(follow_actions)
        if interaction_mode == "collaborative" and can_collaborate:
            perm_actions = COLLAB_PERMISSION_ACTIONS.get(
                (collaboration_permission or "annotate").strip().lower(),
                COLLAB_PERMISSION_ACTIONS["annotate"],
            )
            allowed |= set(perm_actions) & (self.supported_actions | EPHEMERAL_ACTIONS | self.student_content_actions)
            if collaboration_permission in ("edit_content", "full", "annotate"):
                allowed |= NAVIGATION_ACTIONS & self.supported_actions
        elif can_browse_independently:
            allowed |= NAVIGATION_ACTIONS & self.supported_actions
        return frozenset(allowed & (self.supported_actions | EPHEMERAL_ACTIONS))

    def validate_payload(self, action: str, payload: dict) -> dict:
        if not isinstance(payload, dict):
            raise MaterialCollaborationError("payload должен быть объектом", code="invalid_payload")
        raw = str(payload)
        if len(raw) > MAX_PAYLOAD_BYTES:
            raise MaterialCollaborationError("Слишком большой payload", code="payload_too_large", status=413)
        return payload

    def apply_operation(
        self,
        state: dict,
        *,
        action: str,
        payload: dict,
        author_id: int,
        author_role: str,
    ) -> dict:
        next_state = deepcopy(state) if state else self.initial_state()
        handler = getattr(self, f"_apply_{action}", None)
        if handler is None:
            raise MaterialCollaborationError(f"Действие не поддерживается: {action}", code="unsupported_action")
        handler(next_state, payload=payload, author_id=author_id, author_role=author_role)
        return next_state

    def _ensure_list(self, state: dict, key: str) -> list:
        value = state.get(key)
        if not isinstance(value, list):
            value = []
            state[key] = value
        return value

    def _ensure_dict(self, state: dict, key: str) -> dict:
        value = state.get(key)
        if not isinstance(value, dict):
            value = {}
            state[key] = value
        return value

    def _apply_page_changed(self, state, *, payload, author_id, author_role):
        page = int(payload.get("page") or 1)
        if page < 1 or page > 10_000:
            raise MaterialCollaborationError("Некорректная страница", code="invalid_page")
        state["page"] = page

    def _apply_scrolled(self, state, *, payload, author_id, author_role):
        scroll = float(payload.get("scroll") or 0)
        scroll_x = float(payload.get("scrollX") or payload.get("scroll_x") or 0)
        state["scroll"] = max(0.0, min(1.0, scroll))
        state["scrollX"] = max(0.0, min(1.0, scroll_x))

    def _apply_zoom_changed(self, state, *, payload, author_id, author_role):
        zoom = float(payload.get("zoom") or 1)
        state["zoom"] = max(0.25, min(4.0, zoom))

    def _apply_tab_changed(self, state, *, payload, author_id, author_role):
        state["tab"] = str(payload.get("tab") or "")[:120]

    def _apply_viewport_changed(self, state, *, payload, author_id, author_role):
        if "page" in payload:
            self._apply_page_changed(state, payload=payload, author_id=author_id, author_role=author_role)
        if "zoom" in payload:
            self._apply_zoom_changed(state, payload=payload, author_id=author_id, author_role=author_role)
        if "scroll" in payload or "scrollX" in payload or "scroll_x" in payload:
            self._apply_scrolled(state, payload=payload, author_id=author_id, author_role=author_role)

    def _normalize_annotation(self, payload: dict, *, author_id: int, author_role: str) -> dict:
        annotation = payload.get("annotation") if isinstance(payload.get("annotation"), dict) else payload
        ann_id = str(annotation.get("id") or "")[:64]
        if not ann_id:
            raise MaterialCollaborationError("annotation.id обязателен", code="invalid_annotation")
        points = annotation.get("points") or []
        if not isinstance(points, list):
            raise MaterialCollaborationError("annotation.points должен быть списком", code="invalid_annotation")
        if len(points) > MAX_POINTS_PER_STROKE:
            raise MaterialCollaborationError("Слишком много точек", code="invalid_annotation", status=413)
        clean_points = []
        for point in points[:MAX_POINTS_PER_STROKE]:
            if not isinstance(point, (list, tuple)) or len(point) < 2:
                continue
            try:
                x = float(point[0])
                y = float(point[1])
            except (TypeError, ValueError):
                continue
            clean_points.append([max(0.0, min(1.0, x)), max(0.0, min(1.0, y))])
        coord_space = annotation.get("coordSpace") or annotation.get("coord_space")
        result = {
            "id": ann_id,
            "tool": str(annotation.get("tool") or "pen")[:32],
            "color": str(annotation.get("color") or "#e11d48")[:32],
            "width": float(annotation.get("width") or 2),
            "points": clean_points,
            "text": str(annotation.get("text") or "")[:500],
            "page": int(annotation.get("page") or 1),
            "author_id": author_id,
            "author_role": author_role,
            "created_at": annotation.get("created_at") or annotation.get("createdAt"),
            "version": int(annotation.get("version") or 1),
        }
        if coord_space:
            result["coordSpace"] = str(coord_space)[:32]
        return result

    def _apply_annotation_added(self, state, *, payload, author_id, author_role):
        annotations = self._ensure_list(state, "annotations")
        if len(annotations) >= MAX_ANNOTATIONS:
            raise MaterialCollaborationError("Слишком много аннотаций", code="too_many_annotations", status=413)
        ann = self._normalize_annotation(payload, author_id=author_id, author_role=author_role)
        annotations[:] = [a for a in annotations if a.get("id") != ann["id"]]
        annotations.append(ann)

    def _apply_annotation_updated(self, state, *, payload, author_id, author_role):
        annotations = self._ensure_list(state, "annotations")
        ann = self._normalize_annotation(payload, author_id=author_id, author_role=author_role)
        found = False
        for idx, existing in enumerate(annotations):
            if existing.get("id") == ann["id"]:
                # Ученик может менять только свои, учитель — любые.
                if author_role == "student" and existing.get("author_id") != author_id:
                    raise MaterialCollaborationError("Нельзя изменить чужую аннотацию", code="forbidden", status=403)
                ann["author_id"] = existing.get("author_id", author_id)
                ann["author_role"] = existing.get("author_role", author_role)
                annotations[idx] = ann
                found = True
                break
        if not found:
            annotations.append(ann)

    def _apply_annotation_deleted(self, state, *, payload, author_id, author_role):
        ann_id = str(payload.get("id") or payload.get("annotation_id") or "")[:64]
        if not ann_id:
            raise MaterialCollaborationError("id аннотации обязателен", code="invalid_annotation")
        annotations = self._ensure_list(state, "annotations")
        kept = []
        for existing in annotations:
            if existing.get("id") != ann_id:
                kept.append(existing)
                continue
            if author_role == "student" and existing.get("author_id") != author_id:
                raise MaterialCollaborationError("Нельзя удалить чужую аннотацию", code="forbidden", status=403)
        state["annotations"] = kept

    def _user_answer_bucket(self, state: dict, key: str, author_id: int) -> dict:
        """
        Per-user бакет answers/fields: state[key][userId][itemId] = row.
        Старый плоский формат state[key][itemId] = {value, author_id} мигрирует на лету.
        """
        root = self._ensure_dict(state, key)
        user_key = str(author_id)

        def _is_row(value: Any) -> bool:
            return isinstance(value, dict) and ("value" in value or "author_id" in value)

        def _is_user_bucket(value: Any) -> bool:
            if not isinstance(value, dict) or not value:
                return isinstance(value, dict)
            # Бакет пользователя: значения — строки ответов; сам бакет не является row.
            sample = next(iter(value.values()), None)
            return isinstance(sample, dict) and _is_row(sample) and "value" in sample

        # Плоский legacy: все top-level значения — row с value.
        if root and all(_is_row(v) for v in root.values()):
            legacy = dict(root)
            root.clear()
            for item_id, row in legacy.items():
                owner = str(row.get("author_id") or author_id)
                root.setdefault(owner, {})[str(item_id)[:64]] = row

        bucket = root.get(user_key)
        if not isinstance(bucket, dict) or _is_row(bucket):
            bucket = {}
            root[user_key] = bucket
        elif not _is_user_bucket(bucket) and bucket and all(_is_row(v) for v in bucket.values()):
            pass  # уже per-item rows
        return bucket

    def _apply_answer_selected(self, state, *, payload, author_id, author_role):
        """Ответы хранятся per-user: answers[userId][questionId]."""
        question_id = str(payload.get("questionId") or payload.get("question_id") or "")[:64]
        if not question_id:
            raise MaterialCollaborationError("questionId обязателен", code="invalid_answer")
        value = payload.get("value")
        if isinstance(value, str):
            value = value[:MAX_FIELD_VALUE_LEN]
        bucket = self._user_answer_bucket(state, "answers", author_id)
        status = str(payload.get("status") or "draft")[:32]
        if status not in ("draft", "submitted", "checked", "needs_revision"):
            status = "draft"
        prev = bucket.get(question_id) if isinstance(bucket.get(question_id), dict) else {}
        bucket[question_id] = {
            "value": value,
            "author_id": author_id,
            "author_role": author_role,
            "status": status,
            "updated_at": payload.get("updated_at") or payload.get("updatedAt"),
            "attempt": int(payload.get("attempt") or prev.get("attempt") or 1),
        }

    def _apply_field_changed(self, state, *, payload, author_id, author_role):
        """Поля хранятся per-user: fields[userId][fieldId]."""
        field_id = str(payload.get("fieldId") or payload.get("field_id") or "")[:64]
        if not field_id:
            raise MaterialCollaborationError("fieldId обязателен", code="invalid_field")
        value = payload.get("value")
        if isinstance(value, str):
            value = value[:MAX_FIELD_VALUE_LEN]
        bucket = self._user_answer_bucket(state, "fields", author_id)
        status = str(payload.get("status") or "draft")[:32]
        if status not in ("draft", "submitted", "checked", "needs_revision"):
            status = "draft"
        bucket[field_id] = {
            "value": value,
            "author_id": author_id,
            "author_role": author_role,
            "status": status,
            "updated_at": payload.get("updated_at") or payload.get("updatedAt"),
        }

    def _apply_item_moved(self, state, *, payload, author_id, author_role):
        items = self._ensure_dict(state, "items")
        item_id = str(payload.get("itemId") or payload.get("item_id") or "")[:64]
        if not item_id:
            raise MaterialCollaborationError("itemId обязателен", code="invalid_item")
        x = float(payload.get("x") or 0)
        y = float(payload.get("y") or 0)
        items[item_id] = {
            "x": max(0.0, min(1.0, x)),
            "y": max(0.0, min(1.0, y)),
            "author_id": author_id,
            "author_role": author_role,
        }

    def _apply_item_selected(self, state, *, payload, author_id, author_role):
        items = self._ensure_dict(state, "items")
        item_id = str(payload.get("itemId") or payload.get("item_id") or "")[:64]
        if not item_id:
            raise MaterialCollaborationError("itemId обязателен", code="invalid_item")
        items[item_id] = {
            **(items.get(item_id) or {}),
            "selected": bool(payload.get("selected", True)),
            "author_id": author_id,
            "author_role": author_role,
        }

    def _apply_pair_connected(self, state, *, payload, author_id, author_role):
        pairs = self._ensure_list(state, "pairs")
        left = str(payload.get("leftId") or payload.get("left_id") or "")[:64]
        right = str(payload.get("rightId") or payload.get("right_id") or "")[:64]
        if not left or not right:
            raise MaterialCollaborationError("leftId и rightId обязательны", code="invalid_pair")
        pairs[:] = [p for p in pairs if not (p.get("leftId") == left and p.get("rightId") == right)]
        pairs.append({
            "leftId": left,
            "rightId": right,
            "author_id": author_id,
            "author_role": author_role,
        })

    def _apply_pair_disconnected(self, state, *, payload, author_id, author_role):
        pairs = self._ensure_list(state, "pairs")
        left = str(payload.get("leftId") or payload.get("left_id") or "")[:64]
        right = str(payload.get("rightId") or payload.get("right_id") or "")[:64]
        state["pairs"] = [
            p for p in pairs
            if not (p.get("leftId") == left and p.get("rightId") == right)
        ]

    def _apply_cards_flipped(self, state, *, payload, author_id, author_role):
        items = self._ensure_dict(state, "items")
        card_id = str(payload.get("cardId") or payload.get("card_id") or "")[:64]
        if not card_id:
            raise MaterialCollaborationError("cardId обязателен", code="invalid_card")
        items[card_id] = {
            **(items.get(card_id) or {}),
            "flipped": bool(payload.get("flipped", True)),
            "author_id": author_id,
            "author_role": author_role,
        }

    def _apply_state_updated(self, state, *, payload, author_id, author_role):
        """Частичное обновление whitelist-ключей (не полная подмена state)."""
        patch = payload.get("patch") if isinstance(payload.get("patch"), dict) else payload
        allowed_keys = {"answers", "fields", "items", "pairs", "tab", "page", "zoom", "scroll", "scrollX"}
        for key, value in patch.items():
            if key not in allowed_keys:
                continue
            if key in ("answers", "fields", "items") and isinstance(value, dict):
                bucket = self._ensure_dict(state, key)
                for sub_key, sub_val in list(value.items())[:200]:
                    if isinstance(sub_val, dict):
                        bucket[str(sub_key)[:64]] = {
                            **sub_val,
                            "author_id": sub_val.get("author_id") or author_id,
                            "author_role": sub_val.get("author_role") or author_role,
                        }
                    else:
                        bucket[str(sub_key)[:64]] = {
                            "value": sub_val if not isinstance(sub_val, str) else sub_val[:MAX_FIELD_VALUE_LEN],
                            "author_id": author_id,
                            "author_role": author_role,
                        }
            elif key == "pairs" and isinstance(value, list):
                state["pairs"] = value[:200]
            elif key in ("page", "zoom", "scroll", "scrollX", "tab"):
                state[key] = value

    def _apply_text_note_added(self, state, *, payload, author_id, author_role):
        notes = self._ensure_list(state, "notes")
        note_id = str(payload.get("id") or "")[:64]
        if not note_id:
            raise MaterialCollaborationError("id заметки обязателен", code="invalid_note")
        text = str(payload.get("text") or "")[:MAX_FIELD_VALUE_LEN]
        notes[:] = [n for n in notes if n.get("id") != note_id]
        notes.append({
            "id": note_id,
            "text": text,
            "x": float(payload.get("x") or 0.5),
            "y": float(payload.get("y") or 0.5),
            "page": int(payload.get("page") or 1),
            "author_id": author_id,
            "author_role": author_role,
        })

    def _apply_text_note_updated(self, state, *, payload, author_id, author_role):
        self._apply_text_note_added(state, payload=payload, author_id=author_id, author_role=author_role)

    def _apply_text_note_deleted(self, state, *, payload, author_id, author_role):
        note_id = str(payload.get("id") or "")[:64]
        notes = self._ensure_list(state, "notes")
        state["notes"] = [n for n in notes if n.get("id") != note_id]

    def _apply_cell_updated(self, state, *, payload, author_id, author_role):
        sheet_id = str(payload.get("sheetId") or payload.get("sheet_id") or "sheet-1")[:64]
        cell = str(payload.get("cell") or "").upper()[:16]
        if not cell:
            raise MaterialCollaborationError("cell обязателен", code="invalid_cell")
        sheets = self._ensure_dict(state, "sheets")
        sheet = sheets.get(sheet_id)
        if not isinstance(sheet, dict):
            sheet = {"cells": {}}
            sheets[sheet_id] = sheet
        cells = sheet.get("cells")
        if not isinstance(cells, dict):
            cells = {}
            sheet["cells"] = cells
        value = payload.get("value")
        if isinstance(value, str):
            value = value[:MAX_FIELD_VALUE_LEN]
        cells[cell] = {
            "value": value,
            "formula": payload.get("formula"),
            "author_id": author_id,
            "author_role": author_role,
            "revision": int(payload.get("revision") or 0),
            "updated_at": payload.get("updated_at") or payload.get("updatedAt"),
        }
        state["activeSheetId"] = sheet_id
        state["activeCell"] = cell

    def _apply_sheet_changed(self, state, *, payload, author_id, author_role):
        state["activeSheetId"] = str(payload.get("sheetId") or payload.get("sheet_id") or "")[:64]

    def _apply_selection_changed(self, state, *, payload, author_id, author_role):
        state["selection"] = payload.get("selection") or payload.get("range")
        state["activeCell"] = str(payload.get("cell") or payload.get("activeCell") or state.get("activeCell") or "")[:16]


class PdfMaterialAdapter(MaterialCollaborationAdapter):
    resource_kind = "pdf"
    supported_actions = frozenset(NAVIGATION_ACTIONS | {
        "annotation_added", "annotation_updated", "annotation_deleted",
        "text_note_added", "text_note_updated", "text_note_deleted",
    })
    student_content_actions = frozenset({
        "annotation_added", "annotation_updated", "annotation_deleted",
        "text_note_added", "text_note_updated", "text_note_deleted",
    })


class PresentationMaterialAdapter(PdfMaterialAdapter):
    resource_kind = "presentation"


class ImageMaterialAdapter(MaterialCollaborationAdapter):
    resource_kind = "image"
    supported_actions = frozenset({
        "zoom_changed", "scrolled", "viewport_changed",
        "annotation_added", "annotation_updated", "annotation_deleted",
        "text_note_added", "text_note_updated", "text_note_deleted",
    })
    student_content_actions = frozenset({
        "annotation_added", "annotation_updated", "annotation_deleted",
        "text_note_added", "text_note_updated", "text_note_deleted",
    })


class TextMaterialAdapter(MaterialCollaborationAdapter):
    resource_kind = "text"
    supported_actions = frozenset({
        "scrolled", "tab_changed", "field_changed", "annotation_added",
        "annotation_updated", "annotation_deleted", "state_updated",
    })
    student_content_actions = frozenset({
        "field_changed", "annotation_added", "annotation_updated", "annotation_deleted",
    })


class WorkbookMaterialAdapter(MaterialCollaborationAdapter):
    resource_kind = "workbook"
    supported_actions = frozenset(CONTENT_ACTIONS | NAVIGATION_ACTIONS)
    student_content_actions = frozenset(CONTENT_ACTIONS - {"state_updated"}) | frozenset({"state_updated"})


class InteractiveMaterialAdapter(MaterialCollaborationAdapter):
    resource_kind = "interactive"
    supported_actions = frozenset(CONTENT_ACTIONS | NAVIGATION_ACTIONS | {
        "cards_flipped", "pair_connected", "pair_disconnected", "item_selected", "item_moved",
    })
    student_content_actions = frozenset({
        "answer_selected", "field_changed", "item_moved", "item_selected",
        "pair_connected", "pair_disconnected", "cards_flipped", "state_updated",
        "annotation_added", "annotation_updated", "annotation_deleted",
    })


class CardsMaterialAdapter(InteractiveMaterialAdapter):
    resource_kind = "cards"


class TestMaterialAdapter(MaterialCollaborationAdapter):
    resource_kind = "test"
    supported_actions = frozenset({
        "answer_selected", "field_changed", "item_moved", "tab_changed",
        "scrolled", "state_updated",
    })
    student_content_actions = frozenset({
        "answer_selected", "field_changed", "item_moved", "state_updated",
    })


class ExerciseMaterialAdapter(WorkbookMaterialAdapter):
    resource_kind = "exercise"


class FileMaterialAdapter(PdfMaterialAdapter):
    resource_kind = "file"


class EmbedMaterialAdapter(MaterialCollaborationAdapter):
    resource_kind = "embed"
    supported_actions = frozenset({
        "scrolled", "tab_changed", "annotation_added", "annotation_updated", "annotation_deleted",
    })
    student_content_actions = frozenset({
        "annotation_added", "annotation_updated", "annotation_deleted",
    })


class NotesMaterialAdapter(TextMaterialAdapter):
    resource_kind = "notes"


class LinkMaterialAdapter(EmbedMaterialAdapter):
    resource_kind = "link"


class SpreadsheetMaterialAdapter(MaterialCollaborationAdapter):
    resource_kind = "spreadsheet"
    supported_actions = frozenset({
        "cell_updated", "sheet_changed", "selection_changed",
        "annotation_added", "annotation_updated", "annotation_deleted",
        "viewport_changed", "scrolled", "zoom_changed",
    })
    student_content_actions = frozenset({
        "cell_updated", "sheet_changed", "selection_changed",
        "annotation_added", "annotation_updated", "annotation_deleted",
    })

    def initial_state(self) -> dict:
        state = super().initial_state()
        state["sheets"] = {"sheet-1": {"cells": {}}}
        state["activeSheetId"] = "sheet-1"
        state["activeCell"] = ""
        state["selection"] = None
        return state


ADAPTERS: dict[str, MaterialCollaborationAdapter] = {
    "pdf": PdfMaterialAdapter(),
    "presentation": PresentationMaterialAdapter(),
    "image": ImageMaterialAdapter(),
    "text": TextMaterialAdapter(),
    "workbook": WorkbookMaterialAdapter(),
    "interactive": InteractiveMaterialAdapter(),
    "cards": CardsMaterialAdapter(),
    "test": TestMaterialAdapter(),
    "exercise": ExerciseMaterialAdapter(),
    "file": FileMaterialAdapter(),
    "embed": EmbedMaterialAdapter(),
    "notes": NotesMaterialAdapter(),
    "link": LinkMaterialAdapter(),
    "spreadsheet": SpreadsheetMaterialAdapter(),
}

EXCLUDED_PRESENT_KINDS = frozenset({"board", "variant"})


def get_adapter(resource_kind: str) -> MaterialCollaborationAdapter:
    kind = (resource_kind or "").strip().lower()
    adapter = ADAPTERS.get(kind)
    if adapter is None:
        raise MaterialCollaborationError(
            f"Неизвестный тип материала: {resource_kind}",
            code="unsupported_kind",
            status=400,
        )
    return adapter


def infer_resource_kind(
    *,
    row_kind: str = "",
    material_type: str = "",
    interactive_type: str = "",
    url: str = "",
    has_text: bool = False,
) -> str | None:
    """Определить kind для синхронизации. None — материал исключён (board/variant)."""
    rk = (row_kind or "").strip().lower()
    if rk in EXCLUDED_PRESENT_KINDS:
        return None
    mt = (material_type or "").strip().lower()
    if mt == "task_set" or rk == "variant":
        return None
    if rk == "board":
        return None

    it = (interactive_type or "").strip().lower()
    if rk == "interactive" or it:
        if it == "flashcards":
            return "cards"
        if it == "quiz":
            return "test"
        if it in ("matching", "ordering"):
            return "exercise"
        return "interactive"

    if rk == "notes" or has_text and not url:
        return "notes" if rk == "notes" else "text"

    url_l = (url or "").lower().split("?")[0]
    if url_l.endswith(".pdf") or "/pdf" in url_l:
        return "pdf"
    if any(url_l.endswith(ext) for ext in (".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg")):
        return "image"
    if any(url_l.endswith(ext) for ext in (".ppt", ".pptx", ".odp", ".key")):
        return "presentation"
    if any(url_l.endswith(ext) for ext in (".xls", ".xlsx", ".ods", ".csv")):
        return "spreadsheet"

    if mt == "presentation":
        return "presentation"
    if mt == "spreadsheet" or rk == "spreadsheet":
        return "spreadsheet"
    if mt == "worksheet":
        return "workbook"
    if mt == "lesson":
        return "embed"
    if mt == "link" or rk == "link":
        return "link"
    if rk in ("library_lesson", "linked_lesson"):
        return "embed"
    if rk == "file" or mt == "file":
        return "file"
    if rk == "material":
        return "file" if url else "text"
    return "embed" if url else "text"
