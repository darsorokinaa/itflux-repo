"""API мастера генерации рабочего листа.

GET  /api/cabinet/ai/worksheets/options/
GET  /api/cabinet/ai/worksheets/topics/?subject_id=&q=
GET  /api/cabinet/ai/worksheets/balance/
POST /api/cabinet/ai/worksheets/quote/
POST /api/cabinet/ai/worksheets/generate/
GET  /api/cabinet/ai/worksheets/documents/
POST /api/cabinet/ai/worksheets/documents/
GET  /api/cabinet/ai/worksheets/documents/<uuid>/
PATCH /api/cabinet/ai/worksheets/documents/<uuid>/
DELETE /api/cabinet/ai/worksheets/documents/<uuid>/
POST /api/cabinet/ai/worksheets/documents/<uuid>/duplicate/
"""

import copy
import re

from django.db.models import Count
from rest_framework.parsers import JSONParser
from rest_framework.response import Response
from rest_framework.views import APIView

from Generator.models import Level, Subject, TaskList

from Cabinet.ai_providers import generate_content_image
from Cabinet.worksheet_ai.artwork import content_image_prompt

from .billing import InsufficientTokens, balance_of, debit, ensure_period_grant, refund
from .models import WorksheetDocument
from .pricing import get_pricing, spend_catalog
from .params import BLOCKED
from .pipeline import PipelineError, confirm_generation, create_quote, document_payload
from .quality import record_teacher_edits
from .retrieval import suggest_topics
from Cabinet.permissions import IsCabinetTeacher


class WorksheetAIOptionsView(APIView):
    permission_classes = [IsCabinetTeacher]

    def get(self, request):
        ensure_period_grant(request.user)
        subjects = [
            {"id": row.id, "name": row.subject_name, "short": row.subject_short}
            for row in Subject.objects.order_by("subject_name")
        ]
        levels = [
            {"id": row.id, "code": row.level, "label": row.level_rus or row.level}
            for row in Level.objects.order_by("level")
        ]
        pairs = (
            TaskList.objects.values("subject_id")
            .annotate(total=Count("id"))
            .order_by()
        )
        subject_levels = {}
        for subject_id, level_id in (
            TaskList.objects.order_by().values_list("subject_id", "level_id").distinct()
        ):
            subject_levels.setdefault(str(subject_id), [])
            if level_id not in subject_levels[str(subject_id)]:
                subject_levels[str(subject_id)].append(level_id)
        return Response({
            "balance": balance_of(request.user),
            "subjects": subjects,
            "levels": levels,
            "grades": list(range(1, 12)),
            "subject_levels": subject_levels,
            "subject_task_lists": {str(row["subject_id"]): row["total"] for row in pairs},
        })


class WorksheetAITopicsView(APIView):
    permission_classes = [IsCabinetTeacher]

    def get(self, request):
        try:
            subject_id = int(request.query_params.get("subject_id"))
        except (TypeError, ValueError):
            return Response({"topics": [], "subtopics": []})
        if not Subject.objects.filter(pk=subject_id).exists():
            return Response({"topics": [], "subtopics": []})
        return Response(suggest_topics(subject_id, request.query_params.get("q") or ""))


class WorksheetAIBalanceView(APIView):
    permission_classes = [IsCabinetTeacher]

    def get(self, request):
        ensure_period_grant(request.user)
        return Response({
            "balance": balance_of(request.user),
            "currency": "AI-токены",
            "costs": spend_catalog(),
        })


class WorksheetAIQuoteView(APIView):
    permission_classes = [IsCabinetTeacher]
    parser_classes = [JSONParser]

    def post(self, request):
        data = dict(request.data or {})
        for key in BLOCKED:
            data.pop(key, None)
        try:
            payload = create_quote(request.user, data)
        except PipelineError as exc:
            return Response(exc.to_dict(), status=exc.status)
        return Response(payload)


class WorksheetAIGenerateView(APIView):
    permission_classes = [IsCabinetTeacher]
    parser_classes = [JSONParser]

    def post(self, request):
        data = dict(request.data or {})
        for key in BLOCKED:
            data.pop(key, None)
        quote_id = data.get("generation_quote_id") or data.get("quote_id")
        if not quote_id:
            return Response({"code": "BAD_REQUEST", "message": "Нет расчёта генерации."}, status=400)
        idem = (
            request.headers.get("Idempotency-Key")
            or request.headers.get("X-Idempotency-Key")
            or ""
        )
        try:
            payload = confirm_generation(request.user, quote_id, str(idem))
        except PipelineError as exc:
            return Response(exc.to_dict(), status=exc.status)
        return Response(payload)


class WorksheetAIImageView(APIView):
    """Отдельная иллюстрация для задания. Списывает image_generation и возвращает картинку."""

    permission_classes = [IsCabinetTeacher]
    parser_classes = [JSONParser]

    def post(self, request):
        prompt = str((request.data or {}).get("prompt") or "").strip()
        if len(prompt) < 3:
            return Response({"code": "BAD_REQUEST", "message": "Опишите, что нарисовать."}, status=400)
        if len(prompt) > 500:
            prompt = prompt[:500]
        idem = str(
            request.headers.get("Idempotency-Key")
            or request.headers.get("X-Idempotency-Key")
            or ""
        ).strip()
        if not idem:
            return Response({"code": "BAD_REQUEST", "message": "Нет ключа запроса."}, status=400)
        ensure_period_grant(request.user)
        price = int(get_pricing()["costs"].get("image_generation") or 0)
        try:
            debit(
                request.user,
                price,
                idempotency_key=idem[:80],
                description="Иллюстрация для задания",
                metadata={"kind": "image_generation"},
            )
        except InsufficientTokens as exc:
            return Response(exc.to_dict(), status=exc.status)
        image = generate_content_image(content_image_prompt(prompt))
        if not image:
            refund(
                request.user,
                price,
                idempotency_key=f"{idem[:70]}:refund",
                description="Возврат: иллюстрация не создана",
            )
            return Response(
                {
                    "code": "AI_UNAVAILABLE",
                    "message": "Не удалось нарисовать изображение. Токены возвращены.",
                    "balance": balance_of(request.user),
                },
                status=502,
            )
        return Response({
            "image": image,
            "charged": price,
            "balance": balance_of(request.user),
        })


def _plain(value) -> str:
    text = re.sub(r"<[^>]+>", " ", str(value or ""))
    return " ".join(text.split())


def _preview_lines(blocks, limit=4) -> list:
    lines = []
    for block in blocks or []:
        if not isinstance(block, dict):
            continue
        if block.get("type") == "task":
            task = block.get("task") if isinstance(block.get("task"), dict) else {}
            text = _plain(task.get("question") or task.get("q") or "")
        else:
            text = _plain(block.get("text") or "")
        if text:
            lines.append(text[:160])
        if len(lines) >= limit:
            break
    return lines


def _document_summary(document: WorksheetDocument) -> dict:
    form = document.form if isinstance(document.form, dict) else {}
    blocks = document.blocks if isinstance(document.blocks, list) else []
    title = document.title or str(form.get("topic") or "").strip() or "Без названия"
    return {
        "id": str(document.id),
        "title": title,
        "status": document.status,
        "subject": str(form.get("subject") or ""),
        "grade": str(form.get("grade") or ""),
        "task_count": sum(1 for block in blocks if isinstance(block, dict) and block.get("type") == "task"),
        "preview": _preview_lines(blocks),
        "updated_at": document.updated_at.isoformat(),
    }


def _copy_title(document: WorksheetDocument) -> str:
    raw = (document.title or "").strip()
    if not raw and isinstance(document.form, dict):
        raw = str(document.form.get("topic") or "").strip()
    base = raw or "Без названия"
    suffix = " (копия)"
    if base.endswith(suffix):
        base = base[: -len(suffix)].strip() or "Без названия"
    return f"{base[: 255 - len(suffix)].rstrip()}{suffix}"


def _orientation(value) -> str:
    return value if value in ("portrait", "landscape") else "portrait"


def _margin(value) -> int:
    try:
        margin = int(value)
    except (TypeError, ValueError):
        margin = 12
    return max(0, min(margin, 40))


class WorksheetAIDocumentListView(APIView):
    permission_classes = [IsCabinetTeacher]
    parser_classes = [JSONParser]

    def get(self, request):
        documents = WorksheetDocument.objects.filter(teacher=request.user).order_by("-updated_at")
        return Response({"documents": [_document_summary(row) for row in documents]})

    def post(self, request):
        blocks = request.data.get("blocks")
        if not isinstance(blocks, list):
            blocks = []
        form = request.data.get("form") if isinstance(request.data.get("form"), dict) else {}
        title = str(request.data.get("title") or form.get("topic") or "Черновик").strip()[:255] or "Черновик"
        document = WorksheetDocument.objects.create(
            teacher=request.user,
            title=title,
            blocks=blocks,
            form=form,
            orientation=_orientation(request.data.get("orientation")),
            margin_mm=_margin(request.data.get("margin_mm")),
            status=WorksheetDocument.Status.DRAFT,
        )
        return Response(document_payload(document), status=201)


class WorksheetAIDocumentView(APIView):
    permission_classes = [IsCabinetTeacher]
    parser_classes = [JSONParser]

    def get(self, request, document_id):
        document = self._document(request, document_id)
        if not document:
            return Response({"code": "NOT_FOUND", "message": "Рабочий лист не найден."}, status=404)
        return Response(document_payload(document))

    def patch(self, request, document_id):
        document = self._document(request, document_id)
        if not document:
            return Response({"code": "NOT_FOUND", "message": "Рабочий лист не найден."}, status=404)
        blocks = request.data.get("blocks")
        if not isinstance(blocks, list):
            return Response({"code": "BAD_REQUEST", "message": "Нет блоков листа."}, status=400)
        document.blocks = blocks
        if isinstance(request.data.get("form"), dict):
            document.form = request.data["form"]
            topic = str(document.form.get("topic") or "").strip()
            if topic:
                document.title = topic[:255]
        if "orientation" in request.data:
            document.orientation = _orientation(request.data.get("orientation"))
        if "margin_mm" in request.data:
            document.margin_mm = _margin(request.data.get("margin_mm"))
        document.save(update_fields=["blocks", "form", "title", "orientation", "margin_mm", "updated_at"])
        generation = document.ai_generations.order_by("-created_at").first()
        teacher_edits = record_teacher_edits(generation, blocks) if generation else 0
        return Response({"id": str(document.id), "teacher_edits": teacher_edits})

    def delete(self, request, document_id):
        document = self._document(request, document_id)
        if not document:
            return Response({"code": "NOT_FOUND", "message": "Рабочий лист не найден."}, status=404)
        document.delete()
        return Response(status=204)

    def _document(self, request, document_id):
        return WorksheetDocument.objects.filter(pk=document_id, teacher=request.user).first()


class WorksheetAIDocumentDuplicateView(APIView):
    permission_classes = [IsCabinetTeacher]
    parser_classes = [JSONParser]

    def post(self, request, document_id):
        source = WorksheetDocument.objects.filter(pk=document_id, teacher=request.user).first()
        if not source:
            return Response({"code": "NOT_FOUND", "message": "Рабочий лист не найден."}, status=404)
        copy_row = WorksheetDocument.objects.create(
            teacher=request.user,
            title=_copy_title(source),
            blocks=copy.deepcopy(source.blocks) if isinstance(source.blocks, list) else [],
            form=copy.deepcopy(source.form) if isinstance(source.form, dict) else {},
            design=copy.deepcopy(source.design) if isinstance(source.design, dict) else {},
            orientation=_orientation(source.orientation),
            margin_mm=_margin(source.margin_mm),
            status=source.status if source.status in WorksheetDocument.Status.values else WorksheetDocument.Status.DRAFT,
        )
        return Response(_document_summary(copy_row), status=201)
