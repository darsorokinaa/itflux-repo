"""r130: открытая проверка ответа задачи из публичного банка (без регистрации, без сохранения)."""
import json

from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods

from Cabinet.rate_limit import rate_limit_check, rate_limit_json_response

from .truth_table_check import answer_matches_model
from .models import Task
from .teacher_task_bank import owned_ready_q, public_bank_q, request_teacher

ANON_CHECK_LIMIT = 60  # проверок на IP
AUTH_CHECK_LIMIT = 300
CHECK_WINDOW_SEC = 600
ANON_BANK_MAX_PER_PAGE = 50


def _is_auth(request) -> bool:
    user = getattr(request, "user", None)
    return bool(user is not None and getattr(user, "is_authenticated", False))


@csrf_exempt
@require_http_methods(["POST"])
def api_task_check_answer(request, task_id):
    authed = _is_auth(request)
    scope = "task_check_auth" if authed else "task_check_anon"
    limit = AUTH_CHECK_LIMIT if authed else ANON_CHECK_LIMIT
    if not rate_limit_check(request, scope, limit, CHECK_WINDOW_SEC):
        return rate_limit_json_response(scope)

    visible = public_bank_q()
    teacher = request_teacher(request) if authed else None
    if teacher is not None:
        visible = visible | owned_ready_q(teacher)
    task = (
        Task.objects.filter(visible, pk=task_id)
        .select_related("task__subject")
        .first()
    )
    if task is None:
        return JsonResponse({"ok": False, "error": "Задача не найдена"}, status=404)

    try:
        data = json.loads(request.body.decode("utf-8") or "{}")
    except (TypeError, ValueError, UnicodeDecodeError):
        data = {}
    if not isinstance(data, dict):
        data = {}
    answer = str(data.get("answer") or "")[:4000]
    spec = getattr(task, "answer_spec", None)
    if isinstance(spec, dict) and spec.get("answer_format"):
        from .vpr_answer_spec import score_vpr_spec

        from .variant_scoring import resolved_task_max_score

        maximum = resolved_task_max_score(task, task.task)
        graded = score_vpr_spec(spec, answer, max_score=maximum)
        status = graded["status"]
        correct = True if status == "correct" else False if status == "incorrect" else None
        resp = JsonResponse(
            {
                "ok": True,
                "correct": correct,
                "status": status,
                "points": graded["points"],
                "max_points": graded["max_points"],
                "saved": False,
                "authenticated": authed,
            }
        )
        resp["Cache-Control"] = "private, no-store"
        return resp
    expected = (task.answer or "").strip()
    if not expected:
        return JsonResponse({"ok": True, "correct": None, "no_answer": True, "saved": False})
    subject = (getattr(getattr(getattr(task, "task", None), "subject", None), "subject_short", None) or "").lower()
    correct = answer_matches_model(answer, task, subject=subject)
    resp = JsonResponse(
        {
            "ok": True,
            "correct": bool(correct),
            "status": "correct" if correct else "incorrect",
            "saved": False,
            "authenticated": authed,
        }
    )
    resp["Cache-Control"] = "private, no-store"
    return resp
