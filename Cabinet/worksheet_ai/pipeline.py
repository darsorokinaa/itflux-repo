"""Этапы генерации листа. Модель не получает банк и не рисует произвольный HTML."""

from __future__ import annotations

import logging
from datetime import timedelta
from decimal import ROUND_HALF_UP, Decimal

from django.db import transaction
from django.utils import timezone

from Cabinet.ai_providers import (
    WORKSHEET_AGENT_MISSING,
    generate_worksheet_background,
    worksheet_text_provider_configured,
)

from .billing import InsufficientTokens, debit, ensure_period_grant, get_account, refund
from .artwork import artwork_requested, fallback_background_svg, illustration_prompt, svg_data_url
from .compose import apply_ai_design, compose_worksheet, design_for
from .integrity import (
    answer_is_unambiguous,
    compare_wording,
    is_themable,
    model_integrity_accepts,
    numeric_answer_holds,
    topic_mentioned,
)
from .llm import LLMError, call_json, current_usage, note_retry, start_usage
from .models import (
    AITaskCandidate,
    KnowledgeInstruction,
    WorksheetAIGeneration,
    WorksheetAIQuote,
    WorksheetDocument,
)
from .params import ParseError, parse_request
from .pricing import get_pricing, lines_for_plan, price_lines
from .quality import adapt_reason, pricing_snapshot, quality_payload, reason_code, task_baseline
from .retrieval import (
    duplicate_hash_exists,
    missing_difficulties,
    reload_snapshot,
    relevant_tasks,
    retrieve_tasks,
    select_tasks,
)
from .textutil import text_hash

logger = logging.getLogger(__name__)

DEFAULT_INSTRUCTION = {
    "code": "platform-default",
    "title": "Общие правила нового задания",
    "kind": KnowledgeInstruction.Kind.GENERAL,
    "priority": 1,
    "body": (
        "Составь одно школьное задание с однозначным ответом. "
        "Условие соответствует указанным предмету, классу, теме и сложности. "
        "Не копируй переданные примеры дословно. "
        "Числа и единицы измерения должны быть согласованы с ответом. "
        "Не добавляй двусмысленных условий. "
        "Для чистого выражения, уравнения, графика или таблицы не придумывай длинный сюжет. "
        "Коротко укажи ход решения, если ответ неочевиден. "
        "В тексте или в решении должно встретиться слово темы."
    ),
}


class PipelineError(Exception):
    def __init__(self, code: str, message: str, status: int = 400, **extra):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status
        self.extra = extra

    def to_dict(self):
        return {"code": self.code, "message": self.message, **self.extra}


def _plan_needs_model(plan: dict) -> bool:
    return bool(
        int(plan.get("ai_tasks_required") or 0)
        or plan.get("adapt_keys")
        or plan.get("rewrite_keys")
        or plan.get("ai_design")
        or plan.get("theory_block")
    )


def _configuration_failure(generation, exc: LLMError):
    _fail_and_refund(generation, exc.message)
    raise PipelineError(
        "AI_NOT_CONFIGURED",
        exc.message,
        503,
        refunded=generation.quoted_cost,
        balance=get_account(generation.user).balance,
    ) from exc


def ensure_default_instruction():
    KnowledgeInstruction.objects.get_or_create(
        code=DEFAULT_INSTRUCTION["code"],
        defaults={
            "title": DEFAULT_INSTRUCTION["title"],
            "kind": DEFAULT_INSTRUCTION["kind"],
            "priority": DEFAULT_INSTRUCTION["priority"],
            "body": DEFAULT_INSTRUCTION["body"],
            "is_active": True,
        },
    )


def _instruction_matches(row: KnowledgeInstruction, params: dict) -> bool:
    if row.subject_id and row.subject_id != params.get("subject_id"):
        return False
    exam = params.get("exam") or ""
    if row.exam and row.exam != exam:
        return False
    grade = params.get("grade")
    if row.grade_from or row.grade_to:
        if not isinstance(grade, int):
            return False
        low = row.grade_from or 1
        high = row.grade_to or 11
        if grade < low or grade > high:
            return False
    elif row.grade and grade and str(row.grade) != str(grade):
        return False
    topic = (params.get("topic") or "").lower()
    if row.topic:
        needle = row.topic.lower()
        if needle not in topic and topic not in needle:
            return False
    if row.subtopic:
        haystack = f"{topic} {' '.join(params.get('subtopics') or [])}".lower()
        if row.subtopic.lower() not in haystack:
            return False
    if row.level_id and params.get("level_id") and row.level_id != params["level_id"]:
        return False
    return True


def _instruction_score(row: KnowledgeInstruction) -> int:
    score = int(row.priority or 0)
    if row.subject_id:
        score += 10
    if row.exam:
        score += 15
    if row.topic:
        score += 20
    if row.subtopic:
        score += 10
    if row.task_type:
        score += 8
    if row.grade_from or row.grade_to or row.grade:
        score += 5
    return score


def retrieve_knowledge(params: dict) -> list[KnowledgeInstruction]:
    ensure_default_instruction()
    rows = list(
        KnowledgeInstruction.objects.filter(is_active=True).select_related("subject", "level")
    )
    matched = [row for row in rows if _instruction_matches(row, params)]
    matched.sort(key=_instruction_score, reverse=True)
    chosen = matched[:8]
    default = next((row for row in rows if row.code == "platform-default" and row.is_active), None)
    if default and all(row.id != default.id for row in chosen):
        chosen.append(default)
    return chosen


def build_plan(user, params: dict) -> dict:
    config = get_pricing()
    try:
        pool = retrieve_tasks(user, params, limit=int(config["search_pool_limit"]))
    except Exception as exc:
        logger.exception("worksheet bank retrieval failed")
        raise PipelineError("BANK_UNAVAILABLE", "Банк задач временно недоступен. Попробуйте ещё раз.", 503) from exc
    matched = relevant_tasks(pool)
    selected = select_tasks(pool, params)
    wording = params["wording"]
    adapt_ids = []
    rewrite_ids = []
    not_themable = 0
    for item in selected:
        key = _item_key(item)
        if wording == "theme" and params.get("theme"):
            if item.themable:
                adapt_ids.append(key)
            else:
                not_themable += 1
        elif wording == "rephrase":
            rewrite_ids.append(key)
    ai_needed = max(0, params["task_count"] - len(selected))
    plan = {
        "requested_tasks": params["task_count"],
        "bank_tasks_available": len(matched),
        "bank_tasks_selected": len(selected),
        "ai_tasks_required": ai_needed,
        "ai_task_difficulties": missing_difficulties(selected, params),
        "tasks_to_adapt": len(adapt_ids),
        "tasks_to_rewrite": len(rewrite_ids),
        "tasks_left_unchanged": len(selected) - len(adapt_ids) - len(rewrite_ids),
        "tasks_not_themable": not_themable,
        "adapt_keys": adapt_ids,
        "rewrite_keys": rewrite_ids,
        "ai_design": bool(params.get("ai_design")),
        "style_intensity": params.get("style_intensity") or "light",
        "theory_block": bool(params["wants_theory"]),
        "charge_base": False,
        "wording": wording,
    }
    total, breakdown = price_lines(lines_for_plan(plan), config["costs"])
    plan["estimated_cost"] = total
    plan["breakdown"] = breakdown
    return {"plan": plan, "selected": selected, "config": config}


def create_quote(user, raw: dict) -> dict:
    ensure_period_grant(user)
    config = get_pricing()
    try:
        params = parse_request(raw, max_tasks=int(config["max_tasks"]))
    except ParseError as exc:
        raise PipelineError("BAD_REQUEST", exc.message, 400) from exc
    built = build_plan(user, params)
    plan = built["plan"]
    account = get_account(user)
    quote = WorksheetAIQuote.objects.create(
        user=user,
        params=params,
        price=plan["estimated_cost"],
        breakdown=plan["breakdown"],
        selected_tasks=[item.snapshot() for item in built["selected"]],
        plan=plan,
        expires_at=timezone.now() + timedelta(minutes=int(config["quote_ttl_minutes"])),
        status=WorksheetAIQuote.Status.OPEN,
    )
    return _quote_payload(quote, account.balance)


def _replay_generation(generation: WorksheetAIGeneration) -> dict:
    if generation.status == WorksheetAIGeneration.Status.RUNNING:
        raise PipelineError(
            "GENERATION_IN_PROGRESS",
            "Генерация уже выполняется. Не нажимайте кнопку повторно.",
            409,
        )
    if not generation.worksheet_id:
        raise PipelineError(
            "GENERATION_FAILED",
            "Лист не был создан. Рассчитайте его ещё раз.",
            409,
            balance=get_account(generation.user).balance,
        )
    return _generation_payload(generation)


def confirm_generation(user, quote_id, idempotency_key: str) -> dict:
    ensure_period_grant(user)
    key = (idempotency_key or f"quote:{quote_id}")[:80]
    try:
        with transaction.atomic():
            existing = (
                WorksheetAIGeneration.objects.select_for_update()
                .filter(user=user, idempotency_key=key)
                .first()
            )
            if existing:
                return _replay_generation(existing)
            quote = (
                WorksheetAIQuote.objects.select_for_update()
                .filter(pk=quote_id, user=user)
                .first()
            )
            if not quote:
                raise PipelineError("QUOTE_NOT_FOUND", "Расчёт не найден. Рассчитайте лист ещё раз.", 404)
            prior = WorksheetAIGeneration.objects.filter(quote=quote).first()
            if quote.status == WorksheetAIQuote.Status.CONSUMED or prior:
                if prior:
                    return _replay_generation(prior)
                raise PipelineError(
                    "QUOTE_CONSUMED",
                    "Этот расчёт уже использован. Рассчитайте лист ещё раз.",
                    409,
                )
            if quote.expires_at <= timezone.now():
                quote.status = WorksheetAIQuote.Status.EXPIRED
                quote.save(update_fields=["status"])
                raise PipelineError("QUOTE_EXPIRED", "Расчёт устарел. Нажмите «Продолжить» ещё раз.", 409)
            price = int(quote.price)
            if _plan_needs_model(quote.plan or {}) and not worksheet_text_provider_configured():
                raise PipelineError("AI_NOT_CONFIGURED", WORKSHEET_AGENT_MISSING, 503)
            try:
                payment = debit(
                    user,
                    price,
                    idempotency_key=f"debit:{quote.id}",
                    description="Генерация рабочего листа",
                    metadata={"quote_id": str(quote.id)},
                )
            except InsufficientTokens as exc:
                raise PipelineError(exc.code, exc.message, exc.status, **exc.extra) from exc
            generation = WorksheetAIGeneration.objects.create(
                user=user,
                quote=quote,
                prompt=_prompt_text(quote.params),
                params=quote.params,
                selected_tasks=quote.selected_tasks,
                quoted_cost=price,
                cost=price,
                status=WorksheetAIGeneration.Status.RUNNING,
                idempotency_key=key,
                metadata={"stages": [{"name": "parse_request"}]},
            )
            quote.status = WorksheetAIQuote.Status.CONSUMED
            quote.save(update_fields=["status"])
            if payment.generation_id != generation.id:
                payment.generation = generation
                payment.save(update_fields=["generation"])
    except PipelineError:
        raise
    try:
        return _execute(user, generation)
    except PipelineError:
        raise
    except Exception as exc:
        logger.exception("worksheet generation crashed quote=%s", quote_id)
        _fail_and_refund(generation, "Генерация прервалась до сохранения листа.")
        raise PipelineError(
            "GENERATION_FAILED",
            "Не удалось создать рабочий лист. AI-токены возвращены.",
            502,
            refunded=generation.quoted_cost,
            balance=get_account(user).balance,
        ) from exc


def _execute(user, generation: WorksheetAIGeneration) -> dict:
    start_usage()
    quote = generation.quote
    params = quote.params
    plan = quote.plan
    warnings = []
    stages = [{"name": "retrieve_tasks", "selected": len(quote.selected_tasks or [])}]
    selected = reload_snapshot(user, quote.selected_tasks or [])
    if len(selected) < len(quote.selected_tasks or []):
        warnings.append("Часть заданий банка стала недоступна и не вошла в лист.")
    stages.append({"name": "select_tasks", "kept": len(selected)})
    model_name = ""
    adapted = 0
    rewritten = 0
    try:
        prepared, adapt_stats, model_name = _adapt(selected, params, plan)
    except LLMError as exc:
        if exc.configuration:
            _configuration_failure(generation, exc)
        if not selected and plan.get("ai_tasks_required"):
            _fail_and_refund(generation, exc.message)
            raise PipelineError(
                "AI_UNAVAILABLE",
                "AI временно недоступен. AI-токены возвращены.",
                503,
                refunded=generation.quoted_cost,
                balance=get_account(user).balance,
            ) from exc
        prepared = [_public_task(item, item.text, changed=False) for item in selected]
        warnings.append("Не удалось изменить формулировки. Оставлены исходные условия.")
        planned_keys = list(plan.get("adapt_keys") or []) + list(plan.get("rewrite_keys") or [])
        adapt_stats = {
            "adapted": 0,
            "rewritten": 0,
            "rejected": len(planned_keys),
            "proposed": len(planned_keys),
            "fallbacks": len(planned_keys),
            "rejections": [
                {"area": "adaptation", "reason": "json_error", "task_id": key}
                for key in planned_keys
            ],
        }
    adapted = adapt_stats["adapted"]
    rewritten = adapt_stats["rewritten"]
    if adapt_stats.get("rejected"):
        warnings.append("Часть тематических правок отклонена: условие оставлено без изменений.")
    stages.append({"name": "adapt_task_wording", **adapt_stats})

    created = []
    new_rejections = []
    knowledge_ids = []
    if plan.get("ai_tasks_required"):
        instructions = retrieve_knowledge(params)
        if not instructions:
            _fail_and_refund(generation, "База знаний пуста.")
            raise PipelineError(
                "KNOWLEDGE_EMPTY",
                "База знаний не содержит инструкций для новой задачи. AI-токены возвращены.",
                422,
                refunded=generation.quoted_cost,
                balance=get_account(user).balance,
            )
        knowledge_ids = [row.id for row in instructions]
        stages.append({"name": "retrieve_knowledge", "ids": knowledge_ids})
        try:
            created, model_used, new_rejections = _create_missing(
                user,
                generation,
                params,
                plan,
                instructions,
                existing=prepared,
            )
            if model_used:
                model_name = model_used
        except LLMError as exc:
            if exc.configuration:
                _configuration_failure(generation, exc)
            if not prepared:
                _fail_and_refund(generation, exc.message)
                raise PipelineError(
                    "AI_UNAVAILABLE",
                    "AI временно недоступен, а подходящих заданий в банке нет. AI-токены возвращены.",
                    503,
                    refunded=generation.quoted_cost,
                    balance=get_account(user).balance,
                ) from exc
            warnings.append("Не удалось создать все новые задания. В лист вошли найденные в банке.")
        stages.append({"name": "create_missing_tasks", "created": len(created)})
        if len(created) < int(plan.get("ai_tasks_required") or 0):
            warnings.append(
                f"Удалось создать {len(created)} из {plan.get('ai_tasks_required')} новых заданий."
            )
    else:
        stages.append({"name": "create_missing_tasks", "created": 0})

    tasks = prepared + created
    stages.append({"name": "verify_tasks", "count": len(tasks)})
    if not tasks:
        _fail_and_refund(generation, "Нет заданий для листа.")
        raise PipelineError(
            "GENERATION_EMPTY",
            "Не удалось собрать ни одного задания. AI-токены возвращены.",
            502,
            refunded=generation.quoted_cost,
            balance=get_account(user).balance,
        )

    theory = ""
    if plan.get("theory_block"):
        try:
            theory, theory_model = _theory(params, knowledge_ids)
            if theory_model:
                model_name = theory_model
        except LLMError as exc:
            if exc.configuration:
                _configuration_failure(generation, exc)
            theory = ""
            warnings.append("Короткий теоретический блок не добавлен.")
        stages.append({"name": "theory", "added": bool(theory)})

    if params.get("difficulty") == "mixed":
        tasks.sort(key=lambda item: {"basic": 0, "standard": 1, "advanced": 2}.get(item.get("difficulty"), 1))
    design = design_for(params)
    ai_design_done = False
    design_rejections = []
    design_proposed = 0
    if plan.get("ai_design"):
        design_proposed = 1
        try:
            design, design_model = _design_ai(params)
            ai_design_done = True
            if design_model:
                model_name = design_model
        except LLMError as exc:
            if exc.configuration:
                _configuration_failure(generation, exc)
            warnings.append("AI-оформление не выполнено. Использован готовый стиль редактора.")
            design = design_for(params)
            design_rejections.append({"area": "design", "reason": "json_error", "task_id": ""})
    if artwork_requested(params):
        design = _with_background(params, design)
        if design.get("background"):
            ai_design_done = True
    document_body = compose_worksheet(params, tasks, theory=theory, design=design)
    stages.append({"name": "compose_worksheet", "blocks": len(document_body["blocks"])})
    stages.append({"name": "design_worksheet", "style": design.get("style"), "source": design.get("source")})

    delivered = {
        **plan,
        "bank_tasks_selected": len(prepared),
        "tasks_to_adapt": adapted,
        "tasks_to_rewrite": rewritten,
        "ai_tasks_required": len(created),
        "theory_block": bool(theory),
        "ai_design": ai_design_done,
        "charge_base": True,
    }
    frozen_costs = {row["key"]: row["unit"] for row in (quote.breakdown or []) if isinstance(row, dict)}
    actual, actual_breakdown = price_lines(lines_for_plan(delivered), frozen_costs or None)
    actual = min(int(quote.price), actual)
    refunded = int(quote.price) - actual

    worksheet = WorksheetDocument.objects.create(
        teacher=user,
        title=params.get("topic") or "Рабочий лист",
        blocks=document_body["blocks"],
        form=document_body["form"],
        design=document_body["design"],
        status=WorksheetDocument.Status.SAVED,
    )
    status = WorksheetAIGeneration.Status.SUCCEEDED
    if warnings or len(tasks) < int(plan.get("requested_tasks") or 0):
        status = WorksheetAIGeneration.Status.PARTIAL
    generation.worksheet = worksheet
    generation.generated_tasks = created
    generation.knowledge_ids = knowledge_ids
    generation.cost = actual
    generation.model = _apply_usage(generation, model_name)
    generation.status = status
    generation.errors = warnings
    generation.metadata = {"stages": stages, "quoted_price": quote.price, "refunded": refunded}
    generation.pricing_snapshot = pricing_snapshot(
        actual_breakdown,
        charged=actual,
        quoted=int(quote.price),
        quoted_detail=quote.breakdown or [],
    )
    generation.quality = quality_payload(
        bank_tasks=len(prepared),
        adaptations_planned=len(plan.get("adapt_keys") or []) + len(plan.get("rewrite_keys") or []),
        adaptations_accepted=adapted + rewritten,
        adaptations_proposed=int(adapt_stats.get("proposed") or 0),
        fallbacks=int(adapt_stats.get("fallbacks") or 0),
        new_proposed=len(plan.get("ai_task_difficulties") or []),
        new_accepted=len(created),
        design_proposed=design_proposed,
        design_accepted=1 if ai_design_done else 0,
        rejections=list(adapt_stats.get("rejections") or []) + list(new_rejections) + design_rejections,
        baseline=task_baseline(document_body["blocks"]),
    )
    generation.finished_at = timezone.now()
    generation.save()
    if refunded:
        refund(
            user,
            refunded,
            idempotency_key=f"refund:{generation.id}:partial",
            description="Возврат за невыполненную часть генерации",
            generation=generation,
            metadata={"quoted": quote.price, "actual": actual},
        )
    return _generation_payload(generation)


def _adapt(selected, params, plan):
    keys = set(plan.get("adapt_keys") or []) | set(plan.get("rewrite_keys") or [])
    prepared_by_key = {}
    pending = []
    for item in selected:
        key = _item_key(item)
        if key in keys:
            pending.append(item)
        else:
            prepared_by_key[key] = _public_task(item, item.text, changed=False)
    stats = {"adapted": 0, "rewritten": 0, "rejected": 0, "proposed": 0, "fallbacks": 0, "rejections": []}
    if not pending:
        prepared = [prepared_by_key[_item_key(item)] for item in selected]
        return prepared, stats, ""
    mode = "theme_adaptation" if params.get("wording") == "theme" else "rephrase"
    model = ""
    by_id = {}
    for offset in range(0, len(pending), 8):
        chunk = pending[offset : offset + 8]
        data, used = call_json(_adapt_payload(chunk, params, mode))
        if used:
            model = used
        for row in data.get("tasks") or []:
            if isinstance(row, dict) and row.get("task_id"):
                by_id[str(row["task_id"])] = row
    for item in pending:
        key = _item_key(item)
        row = by_id.get(key) or {}
        adapted_text = row.get("adapted_text") or item.text
        changed = bool(row.get("changed")) and adapted_text.strip() and adapted_text.strip() != item.text.strip()
        check = compare_wording(item.text, adapted_text)
        kept_original = (
            not changed
            or not check["ok"]
            or not model_integrity_accepts(row.get("integrity_check"))
            or (mode == "theme_adaptation" and not is_themable(item.text, exam_part=item.exam_part))
        )
        if kept_original:
            stats["fallbacks"] += 1
            if not row:
                stats["proposed"] += 1
                stats["rejections"].append({"area": "adaptation", "reason": "json_error", "task_id": key})
            elif changed:
                stats["proposed"] += 1
                stats["rejected"] += 1
                reason = adapt_reason(check, row)
                if check.get("ok") and not model_integrity_accepts(row.get("integrity_check")):
                    reason = "semantic_mismatch"
                stats["rejections"].append({"area": "adaptation", "reason": reason, "task_id": key})
            prepared_by_key[key] = _public_task(item, item.text, changed=False)
            continue
        stats["proposed"] += 1
        if mode == "theme_adaptation":
            stats["adapted"] += 1
        else:
            stats["rewritten"] += 1
        prepared_by_key[key] = _public_task(item, adapted_text, changed=True)
    prepared = [prepared_by_key[_item_key(item)] for item in selected]
    return prepared, stats, model


def _create_missing(user, generation, params, plan, instructions, *, existing):
    needed = list(plan.get("ai_task_difficulties") or [])
    if not needed:
        return [], "", []
    known_hashes = {text_hash(item["text"]) for item in existing}
    created = []
    rejections = []
    model = ""
    attempts_left = {index: int(get_pricing()["max_new_task_attempts"]) for index in range(len(needed))}
    pending = list(enumerate(needed))
    while pending:
        batch = pending[:4]
        pending = pending[4:]
        payload = {
            "action": "create_missing_tasks",
            "subject": params.get("subject_name"),
            "grade": params.get("grade"),
            "level": params.get("level_label"),
            "topic": params.get("topic"),
            "subtopics": params.get("subtopics") or [],
            "theme": params.get("theme") if params.get("wording") == "theme" else "",
            "theme_rule": "Сюжет можно добавить только если числа, единицы и способ решения остаются теми же. Иначе оставь нейтральное условие.",
            "untrusted_teacher_notes": params.get("wishes") or "",
            "knowledge": [{"id": row.id, "title": row.title, "body": row.body[:2000]} for row in instructions],
            "tasks_to_create": [
                {"slot": index, "difficulty": difficulty, "topic": params.get("topic")}
                for index, difficulty in batch
            ],
            "output": {
                "tasks": [{
                    "slot": "номер из tasks_to_create",
                    "text": "условие задания",
                    "answer": "краткий однозначный ответ",
                    "solution": "ход решения",
                    "difficulty": "как в tasks_to_create",
                    "task_type": "short_answer",
                }],
            },
        }
        try:
            data, model = call_json(payload, max_tokens=2800)
        except LLMError as exc:
            if exc.configuration:
                raise
            for index, _difficulty in list(batch) + list(pending):
                rejections.append({"area": "new_tasks", "reason": "json_error", "task_id": str(index)})
            if created or existing:
                pending = []
                break
            raise
        rows = data.get("tasks") if isinstance(data.get("tasks"), list) else []
        normalized = [_normalize_task_row(row) for row in rows if isinstance(row, dict)]
        by_slot = {}
        for row in normalized:
            if row.get("slot") is None:
                continue
            try:
                by_slot[int(row["slot"])] = row
            except (TypeError, ValueError):
                continue
        if not by_slot and len(normalized) == len(batch):
            for (index, _difficulty), row in zip(batch, normalized):
                by_slot[index] = row
        elif len(normalized) == 1 and len(batch) == 1:
            by_slot[batch[0][0]] = normalized[0]
        retry = []
        for index, difficulty in batch:
            row = by_slot.get(index)
            if row is None and len(batch) == 1 and normalized:
                row = normalized[0]
            ok, reason = _accept_new_task(row, params, difficulty, known_hashes)
            if not ok:
                attempts_left[index] -= 1
                if attempts_left[index] > 0:
                    note_retry()
                    retry.append((index, difficulty))
                else:
                    rejections.append({
                        "area": "new_tasks",
                        "reason": reason_code(reason),
                        "task_id": str(index),
                    })
                continue
            saved = _store_candidate(user, generation, params, row, difficulty, instructions)
            known_hashes.add(saved["text_hash"])
            created.append(saved)
        pending = retry + pending
    return created, model, rejections


def _normalize_task_row(row: dict) -> dict:
    """Модель часто называет условие question, а не text."""
    data = dict(row)
    if not str(data.get("text") or "").strip():
        for key in ("question", "condition", "statement", "task_text", "prompt"):
            value = str(data.get(key) or "").strip()
            if value:
                data["text"] = value
                break
    if not str(data.get("answer") or "").strip():
        for key in ("result", "correct_answer"):
            value = str(data.get(key) or "").strip()
            if value:
                data["answer"] = value
                break
    if not str(data.get("solution") or "").strip():
        for key in ("explanation", "reasoning", "solution_text"):
            value = str(data.get(key) or "").strip()
            if value:
                data["solution"] = value
                break
    return data


def _accept_new_task(row, params, difficulty, known_hashes) -> tuple[bool, str]:
    if not isinstance(row, dict):
        return False, "пустой ответ"
    text = str(row.get("text") or "").strip()
    answer = str(row.get("answer") or "").strip()
    if len(text) < 8:
        return False, "пустое условие"
    if not answer_is_unambiguous(answer):
        return False, "нет однозначного ответа"
    if not topic_mentioned(f"{text}\n{row.get('solution') or ''}", params.get("topic") or ""):
        return False, "не соответствует теме"
    returned = row.get("difficulty") or difficulty
    if params.get("difficulty") != "mixed" and returned not in {params.get("difficulty"), difficulty, "standard"}:
        return False, "сложность"
    holds, reason = numeric_answer_holds(text, answer)
    if not holds:
        return False, reason
    if duplicate_hash_exists(text, extra_hashes=known_hashes):
        return False, "дубликат"
    return True, ""


def _store_candidate(user, generation, params, row, difficulty, instructions) -> dict:
    text = str(row.get("text") or "").strip()
    answer = str(row.get("answer") or "").strip()
    solution = str(row.get("solution") or "").strip()
    task_type = row.get("task_type") if row.get("task_type") in {"short_answer", "solution", "single_choice"} else "short_answer"
    candidate = AITaskCandidate.objects.create(
        subject_id=params["subject_id"],
        grade=str(params.get("grade") or ""),
        level_id=params.get("level_id"),
        topic=params.get("topic") or "",
        subtopic=(params.get("subtopics") or [""])[0],
        difficulty=difficulty,
        task_type=task_type,
        text=text,
        structured_content={"options": row.get("options") or []},
        answer=answer,
        solution=solution,
        skill=str(row.get("skill") or "")[:255],
        metadata={"generation_id": str(generation.id)},
        source="ai_generated",
        review_status=AITaskCandidate.Review.PENDING_REVIEW,
        text_hash=text_hash(text),
        generation=generation,
        knowledge_ids=[row.id for row in instructions],
        owner=user,
    )
    return {
        "origin": "ai_generated",
        "candidate_id": candidate.id,
        "bank_task_id": None,
        "text": text,
        "answer": answer,
        "solution": solution,
        "difficulty": difficulty,
        "task_type": task_type,
        "skill": candidate.skill,
        "options": row.get("options") or [],
        "needs_work": task_type == "solution",
        "text_hash": candidate.text_hash,
    }


def _theory(params, knowledge_ids) -> tuple[str, str]:
    data, model = call_json(
        {
            "action": "theory_block",
            "subject": params.get("subject_name"),
            "grade": params.get("grade"),
            "topic": params.get("topic"),
            "format": params.get("format"),
            "untrusted_teacher_notes": params.get("wishes") or "",
            "instruction": (
                "Это первое знакомство с темой. Напиши теорию для ученика: "
                "что это такое, главное правило или формула и один короткий пример. "
                "Не длиннее 500 символов. Без новых заданий и без приветствия."
            ),
        },
        max_tokens=600,
    )
    text = str(data.get("text") or "").strip()
    if len(text) < 20:
        raise LLMError("Пустая теория.")
    return text[:700], model


def _public_task(item, text: str, *, changed: bool) -> dict:
    return {
        "origin": "bank" if item.bank_task_id else "ai_approved",
        "bank_task_id": item.bank_task_id,
        "candidate_id": item.candidate_id,
        "text": text,
        "answer": item.answer,
        "solution": item.solution,
        "difficulty": item.difficulty,
        "task_type": item.task_type or ("solution" if len(item.answer) > 80 else "short_answer"),
        "skill": item.skill,
        "needs_work": item.task_type == "solution",
        "changed": changed,
        "text_hash": text_hash(text),
    }


def _item_key(item) -> str:
    if item.bank_task_id:
        return f"bank:{item.bank_task_id}"
    return f"candidate:{item.candidate_id}"


def _prompt_text(params: dict) -> str:
    return (
        f"{params.get('subject_name')} / {params.get('grade') or params.get('level_label')} / "
        f"{params.get('topic')}\n{params.get('wishes') or ''}"
    )


INTENSITY_RULE = {
    "light": "Интенсивность лёгкая: одна короткая тематическая подводка. Само условие оставь почти дословно.",
    "medium": "Интенсивность средняя: встрой сюжет в условие. Числа, формулы, единицы и ответ не меняй.",
    "vivid": "Интенсивность яркая: задания можно связать одним сценарием. Математические данные каждого задания остаются прежними.",
}


def _adapt_payload(chunk, params, mode) -> dict:
    rules = [
        "Не меняй числа, формулы, единицы измерения и математические отношения.",
        "Если сюжет нельзя добавить без искажения, верни исходный текст и changed=false.",
        "Не превращай уравнение, выражение, график или таблицу в историю.",
        "Верни все задания одним массивом tasks.",
    ]
    if mode == "theme_adaptation":
        rules.append(INTENSITY_RULE.get(params.get("style_intensity") or "light", INTENSITY_RULE["light"]))
    return {
        "action": "adapt_task_wording",
        "change_type": mode,
        "theme": params.get("theme") or "",
        "style_intensity": params.get("style_intensity") or "light",
        "rules": rules,
        "untrusted_teacher_notes": params.get("wishes") or "",
        "tasks": [
            {
                "task_id": _item_key(item),
                "original_text": item.text,
                "preserve_numbers": True,
                "preserve_units": True,
                "preserve_formulas": True,
            }
            for item in chunk
        ],
    }


def _design_ai(params: dict) -> tuple[dict, str]:
    data, model = call_json(
        {
            "action": "design_worksheet",
            "allowed_style": ["whiteboard", "minimal", "exam", "textbook"],
            "allowed_density": ["обычная", "плотная"],
            "requested_style": params.get("style") or "",
            "theme": params.get("theme") or "",
            "custom_style": params.get("custom_style") or "",
            "format": params.get("format") or "",
            "rules": [
                "Выбери только стиль, плотность, число строк для решения, короткий intro и до четырёх заголовков sections.",
                "Не придумывай задания и не меняй условия.",
                "intro — вводная фраза для ученика в духе запрошенного оформления, без новых математических фактов.",
                "custom_style — промпт преподавателя: фон, рамка, акценты и то, что он хочет видеть на листе.",
            ],
            "untrusted_teacher_notes": params.get("wishes") or "",
        },
        max_tokens=700,
    )
    return apply_ai_design(design_for(params), data), model


def _with_background(params: dict, design: dict) -> dict:
    """Рисунок фона: орнамент и иллюстрации по краям, середина листа пустая."""
    prompt = "\n".join(
        part for part in (
            str(params.get("custom_style") or "").strip(),
            str(params.get("theme") or "").strip(),
            str(params.get("wishes") or "").strip(),
        ) if part
    )
    picture = generate_worksheet_background(illustration_prompt(prompt))
    if picture:
        painted = dict(design)
        painted["background"] = picture
        painted["source"] = "ai"
        return painted
    svg = ""
    try:
        data, _model = call_json(
            {
                "action": "design_background",
                "canvas": "794x1123",
                "subject": params.get("subject_name") or "",
                "topic": params.get("topic") or "",
                "untrusted_teacher_notes": prompt,
                "rules": [
                    "Верни JSON с полем svg: один элемент <svg viewBox=\"0 0 794 1123\">.",
                    "Это только фон учебного плаката, как иллюстрация к листу: текстура бумаги, орнаментальная рамка, рисунки в углах, в шапке и в подвале.",
                    "Центр листа, примерно x от 80 до 710 и y от 200 до 980, оставь пустым и светлым. Там будут задания.",
                    "Не пиши буквы, цифры, слова и формулы. Без script, без ссылок и без foreignObject.",
                    "По промпту преподавателя выбери манеру: гравюра на старой бумаге или плоская яркая инфографика.",
                ],
            },
            max_tokens=4000,
        )
        svg = str(data.get("svg") or "")
    except Exception:
        logger.exception("worksheet background art failed")
        svg = ""
    url = svg_data_url(svg)
    if not url:
        url = svg_data_url(fallback_background_svg(prompt))
    if not url:
        return design
    painted = dict(design)
    painted["background"] = url
    if svg_data_url(svg):
        painted["source"] = "ai"
    return painted


def _estimate_provider_cost(input_tokens: int, output_tokens: int) -> Decimal:
    try:
        from Cabinet.models import AIPlatformSettings

        rates = AIPlatformSettings.get_solo()
        input_rate = Decimal(rates.input_token_cost)
        output_rate = Decimal(rates.output_token_cost)
    except Exception:
        input_rate = Decimal("0.03")
        output_rate = Decimal("0.12")
    cost = (Decimal(input_tokens) / Decimal(1000)) * input_rate
    cost += (Decimal(output_tokens) / Decimal(1000)) * output_rate
    return cost.quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)


def _apply_usage(generation: WorksheetAIGeneration, model_name: str) -> str:
    ledger = current_usage()
    if ledger is None:
        return model_name
    generation.input_tokens = ledger.input_tokens
    generation.output_tokens = ledger.output_tokens
    generation.provider_calls = ledger.calls
    generation.retry_count = ledger.retries
    generation.latency_ms = ledger.latency_ms
    generation.provider_cost = _estimate_provider_cost(ledger.input_tokens, ledger.output_tokens)
    if ledger.models:
        joined = ", ".join(ledger.models)
        return joined[:128]
    return model_name


def _fail_and_refund(generation: WorksheetAIGeneration, message: str):
    if generation.status == WorksheetAIGeneration.Status.FAILED or generation.worksheet_id:
        return
    refunded = int(generation.quoted_cost or generation.cost or 0)
    if refunded:
        refund(
            generation.user,
            refunded,
            idempotency_key=f"refund:{generation.id}:full",
            description="Возврат: генерация не завершилась",
            generation=generation,
        )
    generation.status = WorksheetAIGeneration.Status.FAILED
    generation.cost = 0
    generation.model = _apply_usage(generation, generation.model)
    generation.errors = [message]
    generation.finished_at = timezone.now()
    generation.save(update_fields=[
        "status", "cost", "errors", "finished_at", "model",
        "input_tokens", "output_tokens", "provider_calls", "provider_cost",
        "latency_ms", "retry_count",
    ])


def _quote_payload(quote: WorksheetAIQuote, balance: int) -> dict:
    plan = quote.plan or {}
    params = quote.params or {}
    price = int(quote.price)
    return {
        "generation_quote_id": str(quote.id),
        "expires_at": quote.expires_at.isoformat(),
        "requested_tasks": plan.get("requested_tasks"),
        "bank_tasks_available": plan.get("bank_tasks_available"),
        "bank_tasks_selected": plan.get("bank_tasks_selected"),
        "ai_tasks_required": plan.get("ai_tasks_required"),
        "tasks_to_adapt": plan.get("tasks_to_adapt"),
        "tasks_to_rewrite": plan.get("tasks_to_rewrite"),
        "tasks_left_unchanged": plan.get("tasks_left_unchanged"),
        "tasks_not_themable": plan.get("tasks_not_themable"),
        "ai_design": bool(plan.get("ai_design")),
        "layout_included": True,
        "theory_block": bool(plan.get("theory_block")),
        "estimated_cost": price,
        "balance": balance,
        "balance_after": balance - price if balance >= price else None,
        "shortage": max(0, price - balance),
        "can_generate": balance >= price,
        "breakdown": quote.breakdown,
        "summary": {
            "subject": params.get("subject_name"),
            "grade": params.get("grade"),
            "level": params.get("level_label"),
            "topic": params.get("topic"),
            "difficulty": params.get("difficulty"),
            "wording": params.get("wording"),
            "format": params.get("format"),
            "style_intensity": params.get("style_intensity") or "light",
            "ai_design": bool(plan.get("ai_design")),
        },
    }


def _generation_payload(generation: WorksheetAIGeneration) -> dict:
    account = get_account(generation.user)
    refunded = max(0, int(generation.quoted_cost or 0) - int(generation.cost or 0))
    if generation.status == WorksheetAIGeneration.Status.FAILED:
        refunded = int(generation.quoted_cost or 0)
    return {
        "generation_id": str(generation.id),
        "worksheet_id": str(generation.worksheet_id) if generation.worksheet_id else None,
        "status": generation.status,
        "charged": int(generation.cost or 0),
        "quoted_cost": int(generation.quoted_cost or 0),
        "refunded": refunded,
        "balance": account.balance,
        "warnings": generation.errors or [],
        "model": generation.model,
    }


def document_payload(document: WorksheetDocument) -> dict:
    return {
        "id": str(document.id),
        "title": document.title,
        "blocks": document.blocks,
        "form": document.form,
        "design": document.design,
        "orientation": document.orientation,
        "margin_mm": document.margin_mm,
        "status": document.status,
        "updated_at": document.updated_at.isoformat(),
    }
