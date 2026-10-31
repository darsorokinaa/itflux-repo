"""r129: «Мои варианты» — варианты, созданные учителем: переименование (номер остаётся), live-ссылки."""
from __future__ import annotations

from django.db.models import Count, Q
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from Generator.models import Variant

from .models import VariantLiveSession
from .variant_live import LiveSolveError, _guard, is_teacher, serialize_session

TITLE_MAX = 120


def variant_display_title(variant_id, custom_title: str = "") -> str:
    """Название для журнала/live: «Своё название (№ 1955)» или «Вариант №1955»."""
    t = (custom_title or "").strip()
    return f"{t} (№ {variant_id})" if t else f"Вариант №{variant_id}"


def live_session_title(session) -> str:
    custom = Variant.objects.filter(pk=session.variant_id).values_list("title", flat=True).first() or ""
    if custom.strip():
        return variant_display_title(session.variant_id, custom)
    return session.title or f"Вариант №{session.variant_id}"


def teacher_variants_qs(user):
    names = [n for n in {getattr(user, "username", ""), getattr(user, "email", "")} if n]
    return Variant.objects.filter(Q(owner_teacher=user) | Q(created_by__in=names)).distinct()


def variant_url(v) -> str:
    return f"/{v.level.level}/{v.var_subject.subject_short}/variant/{v.pk}"


def serialize_variant(v, sessions=None) -> dict:
    return {
        "id": v.pk,
        "number": v.pk,
        "localNumber": v.local_number,
        "title": v.title or "",
        "displayTitle": variant_display_title(v.pk, v.title),
        "level": v.level.level,
        "levelName": v.level.level_rus or v.level.level.upper(),
        "subject": v.var_subject.subject_short,
        "subjectName": v.var_subject.subject_name,
        "tasksCount": getattr(v, "tasks_count", None),
        "createdAt": v.created_at.isoformat() if v.created_at else None,
        "url": variant_url(v),
        "liveSessions": sessions or [],
    }


class MyVariantsView(APIView):
    permission_classes = [IsAuthenticated]

    @_guard
    def get(self, request):
        if not is_teacher(request.user):
            raise LiveSolveError("Только для преподавателя.", code="forbidden", status=403)
        qs = (
            teacher_variants_qs(request.user)
            .select_related("level", "var_subject")
            .annotate(tasks_count=Count("variantcontent"))
        )
        subj = (request.query_params.get("subject") or "").strip()
        if subj:
            qs = qs.filter(var_subject__subject_short=subj)
        q = (request.query_params.get("q") or "").strip()
        if q:
            cond = Q(title__icontains=q)
            if q.lstrip("№ ").isdigit():
                cond |= Q(pk=int(q.lstrip("№ ")))
            qs = qs.filter(cond)
        order = "created_at" if request.query_params.get("sort") == "old" else "-created_at"
        variants = list(qs.order_by(order, "-pk")[:300])
        by_variant: dict[int, list] = {}
        if variants:
            ss = (
                VariantLiveSession.objects.filter(teacher=request.user, variant_id__in=[v.pk for v in variants])
                .select_related("student")
                .order_by("-created_at")
            )
            for s in ss:
                by_variant.setdefault(s.variant_id, []).append(serialize_session(s))
        subjects = (
            teacher_variants_qs(request.user)
            .values("var_subject__subject_short", "var_subject__subject_name")
            .distinct()
        )
        return Response(
            {
                "variants": [serialize_variant(v, by_variant.get(v.pk)) for v in variants],
                "subjects": sorted(
                    {(s["var_subject__subject_short"], s["var_subject__subject_name"]) for s in subjects},
                    key=lambda x: x[1],
                ),
            }
        )


class MyVariantDetailView(APIView):
    permission_classes = [IsAuthenticated]

    @_guard
    def patch(self, request, variant_id):
        if not is_teacher(request.user):
            raise LiveSolveError("Только для преподавателя.", code="forbidden", status=403)
        v = teacher_variants_qs(request.user).select_related("level", "var_subject").filter(pk=variant_id).first()
        if v is None:
            raise LiveSolveError("Вариант не найден среди ваших.", code="not_found", status=404)
        data = request.data if isinstance(request.data, dict) else {}
        title = " ".join(str(data.get("title") or "").split())[:TITLE_MAX]
        v.title = title
        v.save(update_fields=["title"])
        return Response({"variant": serialize_variant(v)})
