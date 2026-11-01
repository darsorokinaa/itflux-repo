"""r131: публичный API разборов (без входа, только опубликованные)."""
from django.http import JsonResponse
from django.views.decorators.http import require_http_methods

from .razbor_models import Razbor


def _item(r):
    return {"exam": r.exam, "exam_name": r.exam_name, "subject": r.subject, "subject_name": r.subject_name,
            "number": r.number, "title": r.title, "url": r.path, "updated_at": r.updated_at.isoformat()}


def _json(data, status=200):
    resp = JsonResponse(data, status=status, json_dumps_params={"ensure_ascii": False})
    resp["Cache-Control"] = "public, max-age=120"
    return resp


@require_http_methods(["GET"])
def api_razbor_list(request):
    qs = Razbor.objects.filter(published=True).defer("content_md")
    exam = (request.GET.get("exam") or "").strip().lower()
    subject = (request.GET.get("subject") or "").strip().lower()
    if exam:
        qs = qs.filter(exam=exam)
    if subject:
        qs = qs.filter(subject=subject)
    return _json({"items": [_item(r) for r in qs.order_by("exam", "subject", "number")]})


@require_http_methods(["GET"])
def api_razbor_detail(request, exam, subject, number):
    r = Razbor.objects.filter(published=True, exam=exam.lower(), subject=subject.lower(), number=number).first()
    if r is None:
        return _json({"ok": False, "error": "Разбор не найден"}, status=404)
    siblings = list(Razbor.objects.filter(published=True, exam=r.exam, subject=r.subject)
                    .order_by("number").values_list("number", flat=True))
    i = siblings.index(r.number)
    data = _item(r)
    data.update(ok=True, content_md=r.content_md, numbers=siblings,
                prev=siblings[i - 1] if i > 0 else None,
                next=siblings[i + 1] if i + 1 < len(siblings) else None)
    return _json(data)
