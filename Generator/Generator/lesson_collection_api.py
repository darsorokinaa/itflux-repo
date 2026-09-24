"""Публичное API наборов готовых уроков."""

from __future__ import annotations

import json

from django.contrib.contenttypes.models import ContentType
from django.db.models import Count, F, Q, Sum
from django.http import JsonResponse
from django.shortcuts import get_object_or_404
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods

from Cabinet.lesson_access import LessonAccessService
from Cabinet.lesson_collection_access import (
    COLLECTION_CLICK_EVENTS,
    COLLECTION_DEMO_OPEN,
    COLLECTION_LESSON_OPEN,
    COLLECTION_VIEW,
    LessonCollectionAccess,
    LessonCollectionPurchaseService,
    _record,
)
from Cabinet.subscription_access import AccessDenied

from .models import CatalogContentViewDedup, Lesson, LessonCollection, LessonCollectionItem


def _user(request):
    user = getattr(request, "user", None)
    if user is not None and getattr(user, "is_authenticated", False):
        return user
    return None


def _staff(request) -> bool:
    return LessonAccessService.is_staff(_user(request))


def _visible_collections(request, *, include_owned=False):
    qs = LessonCollection.objects.all()
    if _staff(request):
        return qs
    published = qs.filter(status=LessonCollection.Status.PUBLISHED)
    if not include_owned:
        return published
    user = _user(request)
    if user is None:
        return published
    from Cabinet.models import CollectionPurchase

    owned = CollectionPurchase.objects.filter(
        user=user,
        status=CollectionPurchase.Status.PAID,
    ).values("collection_id")
    return qs.filter(
        Q(status=LessonCollection.Status.PUBLISHED)
        | Q(
            pk__in=owned,
            status__in=(
                LessonCollection.Status.HIDDEN,
                LessonCollection.Status.ARCHIVED,
            ),
        )
    )


def _ordered_items(collection):
    return (
        LessonCollectionItem.objects.filter(collection=collection)
        .select_related(
            "collection",
            "lesson",
            "interesting_item",
            "material",
            "variant",
            "variant__level",
            "variant__var_subject",
            "section",
        )
        .order_by(F("section__position").asc(nulls_first=True), "position", "id")
    )


def _cover_url(request, obj):
    image = getattr(obj, "cover_image", None) or getattr(obj, "card_background_image", None)
    if not image:
        return None
    try:
        url = image.url
    except Exception:
        return None
    if request is not None:
        try:
            return request.build_absolute_uri(url)
        except Exception:
            return url
    return url


def _viewed_ids(user, objects) -> set[int]:
    objects = [obj for obj in objects if obj is not None]
    if user is None or not objects:
        return set()
    content_type = ContentType.objects.get_for_model(objects[0].__class__)
    return set(
        CatalogContentViewDedup.objects.filter(
            user=user,
            content_type=content_type,
            object_id__in=[obj.pk for obj in objects],
        ).values_list("object_id", flat=True)
    )


def mark_catalog_opened(user, obj):
    """Отмечает открытие файла или варианта в прогрессе набора, без счётчика просмотров."""
    if user is None or not getattr(user, "is_authenticated", False) or obj is None:
        return
    from django.utils import timezone

    content_type = ContentType.objects.get_for_model(obj.__class__)
    CatalogContentViewDedup.objects.get_or_create(
        content_type=content_type,
        object_id=obj.pk,
        user=user,
        visitor_key="",
        defaults={"viewed_at": timezone.now()},
    )


def _extra_open(user, target, grant):
    own_open = False
    if grant not in ("full", "demo") and target is not None:
        from Cabinet.subscription_access import AccessDenied, SubscriptionAccessService

        try:
            SubscriptionAccessService.raise_if_cannot_access_content(user, target)
            own_open = True
        except AccessDenied:
            own_open = False
    can_open = grant in ("full", "demo") or own_open
    if grant == "full":
        access_type = "collection"
    elif grant == "demo":
        access_type = "collection_demo"
    elif own_open:
        access_type = "subscription"
    else:
        access_type = "locked"
    return can_open, access_type


def _viewed_lesson_ids(user, lesson_ids: list[int]) -> set[int]:
    if user is None or not lesson_ids:
        return set()
    content_type = ContentType.objects.get_for_model(Lesson)
    return set(
        CatalogContentViewDedup.objects.filter(
            user=user,
            content_type=content_type,
            object_id__in=lesson_ids,
        ).values_list("object_id", flat=True)
    )


def _item_target(item):
    if item.lesson_id:
        return item.lesson, "lesson"
    if item.interesting_item_id:
        return item.interesting_item, "trainer"
    if item.material_id:
        return item.material, "file"
    if item.variant_id:
        return item.variant, "variant"
    return None, ""


def _item_title(target, kind):
    if target is None:
        return ""
    if kind == "variant":
        number = target.local_number or target.pk
        return f"Вариант №{number}"
    return getattr(target, "title", "") or ""


def _item_description(target, kind):
    if target is None:
        return ""
    if kind == "variant":
        subject = getattr(getattr(target, "var_subject", None), "subject_name", "") or ""
        level = getattr(getattr(target, "level", None), "level", "") or ""
        return " · ".join(part for part in (subject, str(level).upper()) if part)
    if kind == "file":
        return (getattr(target, "description", "") or "")[:280]
    return getattr(target, "short_description", "") or ""


def _item_url(collection_slug, item, target, kind):
    if target is None:
        return ""
    query = f"?collection={collection_slug}"
    if kind == "lesson":
        return f"/lessons/{target.slug}/view{query}"
    if kind == "trainer":
        return f"/interesting/{target.slug}/view{query}"
    if kind == "file":
        return f"/api/lesson-collections/{collection_slug}/files/{item.pk}/"
    if kind == "variant":
        level = (getattr(getattr(target, "level", None), "level", "") or "").strip()
        subject = (getattr(getattr(target, "var_subject", None), "subject_short", "") or "").strip()
        if not level or not subject:
            return ""
        return f"/{level}/{subject}/variant/{target.pk}{query}"
    return ""


def _link_for_item(row, number):
    target, kind = _item_target(row)
    if target is None:
        return None
    slug = getattr(target, "slug", "") or ""
    return {
        "slug": slug,
        "title": _item_title(target, kind),
        "number": number,
        "kind": kind,
        "url": _item_url(row.collection.slug, row, target, kind),
    }


def _lesson_row(request, item, number, can_open: bool, access_type: str, viewed: bool) -> dict:
    target, kind = _item_target(item)
    cover_url = None
    if kind in ("lesson", "trainer") and target is not None:
        cover_url = _cover_url(request, target)
    return {
        "id": target.pk if target is not None else item.pk,
        "item_id": item.pk,
        "kind": kind,
        "slug": getattr(target, "slug", "") or "",
        "title": _item_title(target, kind),
        "short_description": _item_description(target, kind),
        "cover_url": cover_url,
        "duration_minutes": getattr(target, "duration_minutes", None),
        "number": number,
        "position": item.position,
        "section_id": item.section_id,
        "section_title": item.section.title if item.section_id else "",
        "is_demo": bool(item.is_demo),
        "can_open": can_open,
        "access_type": access_type,
        "viewed": viewed,
        "url": _item_url(item.collection.slug, item, target, kind),
    }


def serialize_collection_card(request, collection, access: dict) -> dict:
    return {
        "id": collection.pk,
        "kind": "collection",
        "title": collection.title,
        "slug": collection.slug,
        "short_description": collection.short_description or "",
        "subject": collection.subject or "",
        "grade": collection.grade,
        "level": collection.level or "",
        "exam_type": collection.exam_type or "",
        "author": collection.author or "",
        "status": collection.status,
        "cover_url": _cover_url(request, collection),
        "lessons_count": int(getattr(collection, "lessons_count", 0) or 0),
        "duration_minutes": int(getattr(collection, "duration_minutes", 0) or 0) or None,
        "access": access,
        "url": f"/lessons/collections/{collection.slug}",
    }


def _card_queryset():
    return LessonCollection.objects.annotate(
        lessons_count=Count("items", distinct=True),
        duration_minutes=Sum("items__lesson__duration_minutes"),
    )


def collection_context_for_lesson(request, lesson, collection_key: str = "", *, interesting=None) -> dict | None:
    """Контекст навигации. Чужой collection_id не даёт доступ и не подменяет набор."""
    user = _user(request)
    target = interesting or lesson
    field = "interesting_item" if interesting is not None else "lesson"
    items = list(
        LessonCollectionItem.objects.filter(**{field: target})
        .filter(
            collection__status__in=(
                LessonCollection.Status.PUBLISHED,
                LessonCollection.Status.HIDDEN,
                LessonCollection.Status.ARCHIVED,
            )
        )
        .select_related("collection", "section")
    )
    if not items and not _staff(request):
        return None
    if _staff(request):
        items = list(
            LessonCollectionItem.objects.filter(**{field: target}).select_related("collection", "section")
        )
    if not items:
        return None

    by_slug = {row.collection.slug: row for row in items}
    by_id = {str(row.collection_id): row for row in items}
    chosen = None
    key = (collection_key or "").strip()
    if key:
        chosen = by_slug.get(key) or by_id.get(key)
        if chosen is None:
            chosen = None
    if chosen is None and interesting is None and getattr(lesson, "primary_collection_id", None):
        chosen = next((row for row in items if row.collection_id == lesson.primary_collection_id), None)
    if chosen is None:
        published = [row for row in items if row.collection.status == LessonCollection.Status.PUBLISHED]
        chosen = published[0] if published else items[0]

    collection = chosen.collection
    ordered = list(_ordered_items(collection))
    index = next((i for i, row in enumerate(ordered) if getattr(row, f"{field}_id") == target.pk), None)
    if index is None:
        return None
    prev_item = ordered[index - 1] if index > 0 else None
    next_item = ordered[index + 1] if index + 1 < len(ordered) else None
    neighbors = []
    for offset, row in enumerate(ordered[index + 1 : index + 4], start=index + 1):
        link = _link_for_item(row, offset + 1)
        if link:
            neighbors.append(link)
    if len(neighbors) < 3:
        for offset in range(index - 1, -1, -1):
            link = _link_for_item(ordered[offset], offset + 1)
            if link:
                neighbors.insert(0, link)
            if len(neighbors) >= 3:
                break
        neighbors = neighbors[:3]

    others = [
        {"slug": row.collection.slug, "title": row.collection.title}
        for row in items
        if row.collection_id != collection.pk and row.collection.status == LessonCollection.Status.PUBLISHED
    ]
    entitled = LessonCollectionAccess.has_entitlement(user, collection)
    if user is not None:
        if chosen.is_demo and not entitled:
            _record(COLLECTION_DEMO_OPEN, user, collection, lesson_id=target.pk)
        elif interesting is None and LessonAccessService.get_access(user, lesson).can_view:
            _record(COLLECTION_LESSON_OPEN, user, collection, lesson_id=lesson.pk)
        elif interesting is not None:
            _record(COLLECTION_LESSON_OPEN, user, collection, lesson_id=target.pk)

    def _link(row, number):
        return _link_for_item(row, number)

    return {
        "id": collection.pk,
        "slug": collection.slug,
        "title": collection.title,
        "lesson_number": index + 1,
        "lessons_count": len(ordered),
        "has_access": entitled,
        "is_demo_lesson": bool(chosen.is_demo),
        "prev": _link(prev_item, index) if prev_item else None,
        "next": _link(next_item, index + 2) if next_item else None,
        "neighbors": neighbors,
        "also_count": len(others),
        "also": others[:3],
        "url": f"/lessons/collections/{collection.slug}",
    }


@require_http_methods(["GET"])
def api_lesson_collections(request):
    qs = _card_queryset().filter(pk__in=_visible_collections(request).values("pk"))
    subject = (request.GET.get("subject") or "").strip()
    if subject:
        qs = qs.filter(subject__iexact=subject)
    grade = (request.GET.get("grade") or "").strip()
    if grade.isdigit():
        qs = qs.filter(grade=int(grade))
    query = (request.GET.get("q") or "").strip()
    if query:
        qs = qs.filter(title__icontains=query)
    collections = list(qs.order_by("-published_at", "-created_at", "id"))
    user = _user(request)
    purchased = LessonCollectionAccess.active_purchase_ids(user, [row.pk for row in collections])
    payload = []
    for collection in collections:
        access = LessonCollectionAccess.describe(
            user,
            collection,
            purchased=collection.pk in purchased,
        )
        payload.append(serialize_collection_card(request, collection, access))
    return JsonResponse({"collections": payload, "total": len(payload)})


def _detail_payload(request, collection) -> dict:
    user = _user(request)
    items = list(_ordered_items(collection))
    lessons = [row.lesson for row in items if row.lesson_id]
    trainers = [row.interesting_item for row in items if row.interesting_item_id]
    materials = [row.material for row in items if row.material_id]
    variants = [row.variant for row in items if row.variant_id]
    access_map = LessonAccessService.serialize_list(user, lessons)
    trainer_grants = LessonCollectionAccess.grants_for_interesting(user, [row.pk for row in trainers])
    material_grants = LessonCollectionAccess.grants_for_materials(user, [row.pk for row in materials])
    variant_grants = LessonCollectionAccess.grants_for_variants(user, [row.pk for row in variants])
    viewed_lessons = _viewed_lesson_ids(user, [lesson.pk for lesson in lessons])
    viewed_trainers = _viewed_ids(user, trainers)
    viewed_materials = _viewed_ids(user, materials)
    viewed_variants = _viewed_ids(user, variants)
    rows = []
    for index, item in enumerate(items, start=1):
        if item.lesson_id:
            access = access_map.get(item.lesson_id)
            can_open = bool(access and access.can_view)
            access_type = access.access_type if access else "locked"
            viewed = item.lesson_id in viewed_lessons
        elif item.interesting_item_id:
            can_open, access_type = _extra_open(user, item.interesting_item, trainer_grants.get(item.interesting_item_id))
            viewed = item.interesting_item_id in viewed_trainers
        elif item.material_id:
            can_open, access_type = _extra_open(user, item.material, material_grants.get(item.material_id))
            viewed = item.material_id in viewed_materials
        else:
            grant = variant_grants.get(item.variant_id)
            can_open = grant in ("full", "demo")
            access_type = "collection" if grant == "full" else "collection_demo" if grant == "demo" else "locked"
            viewed = item.variant_id in viewed_variants
        rows.append(_lesson_row(request, item, index, can_open, access_type, viewed))
    sections = []
    section_ids = []
    for item in items:
        if item.section_id and item.section_id not in section_ids:
            section_ids.append(item.section_id)
            sections.append({
                "id": item.section_id,
                "title": item.section.title,
                "lessons": [],
            })
    by_section = {section["id"]: section for section in sections}
    unsectioned = []
    for row, item in zip(rows, items):
        if item.section_id and item.section_id in by_section:
            by_section[item.section_id]["lessons"].append(row)
        else:
            unsectioned.append(row)
    purchased = LessonCollectionAccess.has_purchase(user, collection)
    access = LessonCollectionAccess.describe(user, collection, purchased=purchased)
    duration = sum(
        int(getattr(target, "duration_minutes", 0) or 0)
        for row in items
        if (target := (_item_target(row)[0])) is not None
    )
    next_collection = None
    nxt = collection.next_collection if collection.next_collection_id else None
    if nxt and (nxt.status == LessonCollection.Status.PUBLISHED or _staff(request)):
        next_collection = {"slug": nxt.slug, "title": nxt.title, "url": f"/lessons/collections/{nxt.slug}"}
    if user is not None:
        _record(COLLECTION_VIEW, user, collection)
    first_open = next((row for row in rows if row["can_open"] and not row["viewed"]), None)
    continue_row = next((row for row in rows if row["can_open"] and not row["viewed"]), None)
    started = any(row["viewed"] for row in rows)
    return {
        **serialize_collection_card(
            request,
            collection,
            access,
        ),
        "description": collection.description or "",
        "lessons_count": len(rows),
        "duration_minutes": duration or None,
        "progress": {
            "viewed": sum(1 for row in rows if row["viewed"]),
            "total": len(rows),
        },
        "continue_lesson": (continue_row or (rows[0] if rows and access["has_access"] else None)),
        "has_started": started,
        "first_open_slug": (first_open or {}).get("slug") if first_open else (rows[0]["slug"] if rows and access["has_access"] else ""),
        "sections": sections,
        "unsectioned": unsectioned,
        "lessons": rows,
        "next_collection": next_collection,
    }


@require_http_methods(["GET"])
def api_lesson_collection_detail(request, slug):
    base = get_object_or_404(_visible_collections(request, include_owned=True), slug=slug)
    collection = get_object_or_404(_card_queryset().select_related("next_collection"), pk=base.pk)
    return JsonResponse({"collection": _detail_payload(request, collection)})


@csrf_exempt
@require_http_methods(["POST"])
def api_lesson_collection_purchase(request, slug):
    if _user(request) is None:
        return JsonResponse({"code": "AUTH_REQUIRED", "message": "Войдите, чтобы купить набор."}, status=401)
    collection = get_object_or_404(_visible_collections(request), slug=slug)
    try:
        payload = json.loads(request.body or b"{}")
    except json.JSONDecodeError:
        payload = {}
    try:
        result = LessonCollectionPurchaseService.create_checkout(
            request.user,
            collection,
            idempotency_key=(payload.get("idempotency_key") or "").strip() or None,
        )
    except AccessDenied as exc:
        return JsonResponse(exc.to_dict(), status=403)
    except (ValueError, NotImplementedError) as exc:
        return JsonResponse({"detail": str(exc), "code": "PAYMENT_UNAVAILABLE"}, status=503)
    return JsonResponse(result, status=201)


@csrf_exempt
@require_http_methods(["POST"])
def api_lesson_collection_event(request, slug):
    user = _user(request)
    if user is None:
        return JsonResponse({"ok": False}, status=401)
    collection = get_object_or_404(_visible_collections(request), slug=slug)
    try:
        payload = json.loads(request.body or b"{}")
    except json.JSONDecodeError:
        payload = {}
    event_name = str(payload.get("event_name") or "").strip()
    if event_name not in COLLECTION_CLICK_EVENTS:
        return JsonResponse({"code": "event_not_allowed"}, status=403)
    lesson_id = payload.get("lesson_id")
    try:
        lesson_id = int(lesson_id) if lesson_id not in (None, "") else None
    except (TypeError, ValueError):
        lesson_id = None
    if lesson_id and not LessonCollectionItem.objects.filter(collection=collection).filter(
        Q(lesson_id=lesson_id)
        | Q(interesting_item_id=lesson_id)
        | Q(material_id=lesson_id)
        | Q(variant_id=lesson_id)
    ).exists():
        return JsonResponse({"code": "lesson_not_in_collection"}, status=403)
    _record(event_name, user, collection, lesson_id=lesson_id)
    return JsonResponse({"ok": True})


def _material_can_open(user, material) -> bool:
    grant = LessonCollectionAccess.grant_for_material(user, material)
    can_open, _access_type = _extra_open(user, material, grant)
    return can_open


@require_http_methods(["GET"])
def api_lesson_collection_file(request, slug, item_id):
    """Отдаёт файл из набора. Чужой набор и чужой item_id файл не открывают."""
    import mimetypes

    from django.http import FileResponse

    from Cabinet.files_storage import content_disposition

    collection = get_object_or_404(_visible_collections(request, include_owned=True), slug=slug)
    item = get_object_or_404(
        LessonCollectionItem.objects.select_related("material", "material__cabinet_file"),
        pk=item_id,
        collection=collection,
        material__isnull=False,
    )
    user = _user(request)
    if not _material_can_open(user, item.material):
        return JsonResponse(
            {"code": "CONTENT_ACCESS_DENIED", "message": "Файл доступен в составе набора."},
            status=403,
        )
    material = item.material
    fh = None
    name = "file"
    if material.file:
        try:
            fh = material.file.open("rb")
            name = material.file.name.split("/")[-1] or "file"
        except Exception:
            fh = None
    if fh is None and material.cabinet_file_id:
        try:
            from Cabinet.files_storage import open_file

            fh = open_file(material.cabinet_file.storage_key, "rb")
            name = material.cabinet_file.original_name or "file"
        except Exception:
            fh = None
    if fh is None:
        return JsonResponse({"detail": "Файл не найден."}, status=404)
    content_type = mimetypes.guess_type(name)[0] or "application/octet-stream"
    inline = True
    if content_type in ("text/html", "image/svg+xml", "text/javascript", "application/javascript"):
        inline = False
        content_type = "application/octet-stream"
    mark_catalog_opened(user, material)
    response = FileResponse(fh, content_type=content_type)
    response["Content-Disposition"] = content_disposition(name, inline=inline)
    response["X-Content-Type-Options"] = "nosniff"
    response["Cache-Control"] = "private, no-store"
    return response
