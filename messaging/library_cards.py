"""Карточки материалов из разделов кабинета, а не произвольные ссылки."""

from __future__ import annotations

import re

from Cabinet.files_models import CabinetFile, CabinetFileStatus
from Cabinet.files_services import FileServiceError, get_owned_file
from Cabinet.models import Interactive, InteractiveAssignment, Student
try:
    from Generator.models import InterestingItem, Variant
except ImportError:
    from Generator.Generator.models import InterestingItem, Variant

from .models import ConversationParticipant, Message

_SLUG = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_-]{0,200}$")
_KIND_LABEL = {
    "file": "Мои файлы",
    "interactive": "Интерактив",
    "variant": "Вариант",
    "trainer": "Тренажёр",
}
MAX_LIBRARY_ITEMS = 5


def parse_library_payload(raw) -> list:
    from .services import MessagingError
    if raw in (None, ""):
        return []
    if isinstance(raw, str):
        import json
        try:
            raw = json.loads(raw)
        except (TypeError, ValueError) as exc:
            raise MessagingError("Некорректный материал", "bad_library") from exc
    if not isinstance(raw, list):
        raise MessagingError("Некорректный материал", "bad_library")
    if len(raw) > MAX_LIBRARY_ITEMS:
        raise MessagingError("Можно прикрепить не больше 5 материалов", "too_many_library")
    return raw


def resolve_library_items(sender, conversation, raw_items: list) -> list[dict]:
    from .services import MessagingError
    refs = []
    for item in raw_items:
        if not isinstance(item, dict):
            raise MessagingError("Некорректный материал", "bad_library")
        kind = str(item.get("kind") or "").strip()
        if kind == "file":
            refs.append(_file_ref(sender, item))
        elif kind == "interactive":
            refs.append(_interactive_ref(sender, conversation, item))
        elif kind == "variant":
            refs.append(_variant_ref(sender, item))
        elif kind == "trainer":
            refs.append(_trainer_ref(item))
        else:
            raise MessagingError("Этот раздел пока нельзя прикрепить", "bad_library")
    return refs


def _clip_text(text: str, limit: int = 140) -> str:
    compact = " ".join((text or "").split())
    if len(compact) <= limit:
        return compact
    return compact[: limit - 1].rstrip() + "…"


def _image_url(field) -> str:
    name = getattr(field, "name", "") or ""
    if not name:
        return ""
    try:
        return field.url or ""
    except Exception:
        from django.conf import settings
        base = settings.MEDIA_URL or "/media/"
        return f"{base.rstrip('/')}/{name.lstrip('/')}"


def _card_preview(item: dict) -> dict:
    kind = str(item.get("kind") or "")
    cover_url = ""
    description = ""
    accent = "#1F3A8A"
    if kind == "trainer" and item.get("slug"):
        trainer = InterestingItem.objects.filter(slug=item["slug"]).first()
        if trainer is not None:
            cover_url = _image_url(trainer.cover_image)
            description = _clip_text(trainer.short_description)
            accent = (trainer.accent_color or accent).strip() or accent
    elif kind == "interactive" and item.get("id"):
        interactive = Interactive.objects.filter(pk=item["id"]).first()
        if interactive is not None:
            description = _clip_text(interactive.description)
            cover_url = (getattr(interactive, "custom_background_image_url", "") or "").strip()
    elif kind == "variant" and item.get("id"):
        variant = Variant.objects.filter(pk=item["id"]).select_related("var_subject").first()
        subject = getattr(variant, "var_subject", None) if variant is not None else None
        if subject is not None:
            description = _clip_text(getattr(subject, "subject_short", "") or "")
    return {"cover_url": cover_url, "description": description, "accent": accent}


def library_cards_for(message: Message, viewer) -> list[dict]:
    if message.deleted_at:
        return []
    raw = (message.metadata or {}).get("library") or []
    if not isinstance(raw, list):
        return []
    cards = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        kind = str(item.get("kind") or "")
        title = str(item.get("title") or "").strip() or _KIND_LABEL.get(kind, "Материал")
        preview = _card_preview(item)
        cards.append({
            "kind": kind,
            "title": title,
            "label": _KIND_LABEL.get(kind, "Материал"),
            "href": _href_for(message, viewer, item),
            "cover_url": preview["cover_url"],
            "description": preview["description"],
            "accent": preview["accent"],
        })
    return cards


def library_file_for_participant(user, message_id: int, file_id) -> CabinetFile | None:
    message = (
        Message.objects.filter(pk=message_id, deleted_at__isnull=True)
        .select_related("conversation")
        .first()
    )
    if message is None:
        return None
    member = ConversationParticipant.objects.filter(
        conversation_id=message.conversation_id,
        user=user,
        hidden_at__isnull=True,
    ).exists()
    if not member:
        return None
    raw = (message.metadata or {}).get("library") or []
    if not any(
        isinstance(item, dict) and item.get("kind") == "file" and str(item.get("id")) == str(file_id)
        for item in raw
    ):
        return None
    file_obj = CabinetFile.objects.filter(pk=file_id).first()
    if file_obj is None or file_obj.status == CabinetFileStatus.TRASHED:
        return None
    return file_obj


def _file_ref(sender, item) -> dict:
    from .services import MessagingError
    try:
        file_obj = get_owned_file(sender, item.get("id"))
    except FileServiceError as exc:
        raise MessagingError("Файл не найден в «Моих файлах»", "bad_library") from exc
    title = (file_obj.display_name or file_obj.original_name or "Файл").strip()
    return {"kind": "file", "id": str(file_obj.id), "title": title[:255]}


def _interactive_ref(sender, conversation, item) -> dict:
    from .services import MessagingError
    try:
        interactive_id = int(item.get("id"))
    except (TypeError, ValueError) as exc:
        raise MessagingError("Интерактив не найден", "bad_library") from exc
    interactive = Interactive.objects.filter(pk=interactive_id, teacher=sender).first()
    if interactive is None:
        raise MessagingError("Интерактив не найден", "bad_library")
    if interactive.status != "published":
        raise MessagingError("Сначала опубликуйте интерактив", "bad_library")
    assignments = {}
    peer_ids = ConversationParticipant.objects.filter(
        conversation=conversation,
        hidden_at__isnull=True,
    ).exclude(user_id=sender.id).values_list("user_id", flat=True)
    rosters = Student.objects.filter(teacher=sender, user_id__in=peer_ids, status="active")
    for roster in rosters:
        assignment, _created = InteractiveAssignment.objects.get_or_create(
            teacher=sender,
            interactive=interactive,
            student=roster,
            defaults={
                "attempts_allowed": 3,
                "show_result_immediately": True,
            },
        )
        assignments[str(roster.user_id)] = assignment.id
    title = (interactive.title or interactive.get_display_title() or "Интерактив").strip()
    return {
        "kind": "interactive",
        "id": interactive.id,
        "title": title[:255],
        "assignments": assignments,
    }


def _variant_ref(sender, item) -> dict:
    from .services import MessagingError
    try:
        variant_id = int(item.get("id"))
    except (TypeError, ValueError) as exc:
        raise MessagingError("Введите номер варианта", "bad_library") from exc
    variant = (
        Variant.objects.filter(pk=variant_id)
        .select_related("var_subject", "level")
        .first()
    )
    if variant is None:
        raise MessagingError(f"Вариант №{variant_id} не найден", "bad_library")
    if variant.owner_teacher_id and variant.owner_teacher_id != sender.id:
        raise MessagingError("Этот вариант вам недоступен", "bad_library")
    level = getattr(variant.level, "level", "") or ""
    subject = getattr(variant.var_subject, "subject_short", "") or ""
    if not level or not subject:
        raise MessagingError("Не удалось открыть вариант", "bad_library")
    return {
        "kind": "variant",
        "id": variant.id,
        "level": str(level),
        "subject": str(subject),
        "title": f"Вариант №{variant.id}",
    }


def _trainer_ref(item) -> dict:
    from .services import MessagingError
    slug = str(item.get("slug") or "").strip()
    if not _SLUG.match(slug):
        raise MessagingError("Тренажёр не найден", "bad_library")
    trainer = InterestingItem.objects.filter(slug=slug, status=InterestingItem.Status.PUBLISHED).first()
    if trainer is None:
        raise MessagingError("Тренажёр не найден", "bad_library")
    return {"kind": "trainer", "slug": trainer.slug, "title": (trainer.title or "Тренажёр")[:255]}


def _href_for(message: Message, viewer, item: dict) -> str:
    kind = item.get("kind")
    if kind == "file" and item.get("id"):
        return f"/api/cabinet/messages/library-files/{message.id}/{item['id']}/"
    if kind == "interactive":
        assignment_id = (item.get("assignments") or {}).get(str(getattr(viewer, "id", "")))
        if assignment_id:
            return f"/cabinet/student/interactives/{assignment_id}/play"
        if item.get("id"):
            owned = Interactive.objects.filter(pk=item["id"], teacher_id=getattr(viewer, "id", None)).exists()
            if owned:
                return f"/cabinet/interactives/{item['id']}/play"
        return ""
    if kind == "variant" and item.get("level") and item.get("subject") and item.get("id"):
        return f"/{item['level']}/{item['subject']}/variant/{item['id']}"
    if kind == "trainer" and item.get("slug") and _SLUG.match(str(item["slug"])):
        return f"/interesting/{item['slug']}/view"
    return ""
