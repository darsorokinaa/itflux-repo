"""Поиск по банку без передачи всего банка в модель."""

from __future__ import annotations

from dataclasses import asdict, dataclass

from django.db.models import Q

from Generator.models import SubTopic, Task, TaskList

from .integrity import is_themable
from .textutil import pictures_of, plain_text, text_hash, tokens


DIFFICULTY_RANK = {"basic": 0, "standard": 1, "advanced": 2}
RELEVANCE_FLOOR = 40


@dataclass
class RetrievedTask:
    source: str
    bank_task_id: int | None
    candidate_id: int | None
    text: str
    answer: str
    solution: str
    difficulty: str
    topic: str
    subtopic: str
    grade: str
    task_type: str
    skill: str
    score: int
    themable: bool
    exam_part: int | None = None
    images: tuple[str, ...] = ()

    def snapshot(self) -> dict:
        data = asdict(self)
        data.pop("score", None)
        return data


def difficulty_of_task(task: Task) -> str:
    if task.vpr_advanced:
        return "advanced"
    if task.vpr_basic:
        return "basic"
    titles = []
    cache = getattr(task, "_prefetched_objects_cache", {})
    options = cache.get("tag_options")
    if options is None:
        options = task.tag_options.all()
    for option in options:
        titles.append((option.title or "").lower())
    blob = " ".join(titles)
    if any(mark in blob for mark in ("баз", "легк", "лёгк")):
        return "basic"
    if any(mark in blob for mark in ("повыш", "сложн", "высок")):
        return "advanced"
    return "standard"


def _task_text(task: Task) -> str:
    return plain_text(task.task_template)


def _grade_distance(task: Task, grade: int | None) -> int | None:
    if not grade or not task.vpr_class:
        return None
    return abs(int(task.vpr_class) - int(grade))


def score_task(task: Task, params: dict, *, used_ids: set[int]) -> int:
    text = _task_text(task)
    title = ""
    level_id = None
    if task.task_id:
        title = task.task.task_title or ""
        level_id = task.task.level_id
    sub_title = task.subtopic.title if task.subtopic_id and task.subtopic else ""
    blob = f"{title} {sub_title} {text}".lower().replace("ё", "е")
    topic = (params.get("topic") or "").lower().replace("ё", "е")
    score = 0
    if topic and topic == title.lower().replace("ё", "е"):
        score += 100
    elif topic and topic in title.lower().replace("ё", "е"):
        score += 80
    elif topic and topic in sub_title.lower().replace("ё", "е"):
        score += 70
    elif topic and topic in blob:
        score += 50
    topic_tokens = tokens(topic)
    overlap = sum(1 for token in topic_tokens if token in blob)
    score += min(40, overlap * 12)
    requested_subs = [item.lower().replace("ё", "е") for item in params.get("subtopics") or []]
    if requested_subs and any(item in sub_title.lower().replace("ё", "е") or item in blob for item in requested_subs):
        score += 30
    distance = _grade_distance(task, params.get("grade"))
    if distance == 0:
        score += 25
    elif distance == 1:
        score += 10
    elif distance is None:
        score += 4
    if params.get("level_id") and level_id == params["level_id"]:
        score += 20
    wanted = params.get("difficulty") or "standard"
    actual = difficulty_of_task(task)
    if wanted != "mixed" and actual == wanted:
        score += 15
    elif wanted == "mixed":
        score += 8
    if task.id not in used_ids:
        score += 4
    return score


def _base_queryset(user, subject_id: int):
    return (
        Task.objects.filter(is_active=True, status=Task.Status.READY, task__subject_id=subject_id)
        .filter(Q(scope=Task.Scope.GLOBAL) | Q(scope=Task.Scope.TEACHER, owner_teacher=user))
        .select_related("task", "task__level", "subtopic")
        .prefetch_related("tag_options")
    )


def _used_ids(user) -> set[int]:
    from .models import WorksheetAIGeneration

    used = set()
    rows = (
        WorksheetAIGeneration.objects.filter(user=user)
        .order_by("-created_at")
        .values_list("selected_tasks", flat=True)[:40]
    )
    for row in rows:
        for item in row or []:
            if isinstance(item, dict) and item.get("bank_task_id"):
                used.add(int(item["bank_task_id"]))
    return used


def retrieve_tasks(user, params: dict, *, limit: int = 80) -> list[RetrievedTask]:
    subject_id = params["subject_id"]
    topic = params.get("topic") or ""
    base = _base_queryset(user, subject_id)
    used = _used_ids(user)
    grade = params.get("grade")
    stages: list = []
    topic_q = Q()
    if topic:
        topic_q = (
            Q(task__task_title__icontains=topic)
            | Q(subtopic__title__icontains=topic)
            | Q(task_template__icontains=topic)
        )
    if topic and grade:
        stages.append(base.filter(topic_q, vpr_class=grade))
    if topic:
        stages.append(base.filter(topic_q))
    if grade:
        stages.append(base.filter(vpr_class__in=[grade - 1, grade, grade + 1]))
    if params.get("level_id"):
        stages.append(base.filter(task__level_id=params["level_id"]))
    subtopics = params.get("subtopics") or []
    if subtopics:
        stages.append(base.filter(subtopic__title__in=subtopics))
    stages.append(base.order_by("-added_at"))

    pool: list[RetrievedTask] = []
    seen: set[int] = set()
    for stage in stages:
        if len(pool) >= limit:
            break
        for task in stage.order_by("-added_at")[: limit]:
            if task.id in seen:
                continue
            seen.add(task.id)
            text = _task_text(task)
            if not text:
                continue
            title = task.task.task_title if task.task_id else ""
            sub_title = task.subtopic.title if task.subtopic_id and task.subtopic else ""
            difficulty = difficulty_of_task(task)
            pool.append(
                RetrievedTask(
                    source="bank",
                    bank_task_id=task.id,
                    candidate_id=None,
                    text=text,
                    answer=plain_text(task.answer),
                    solution="",
                    difficulty=difficulty,
                    topic=title,
                    subtopic=sub_title,
                    grade=str(task.vpr_class or ""),
                    task_type="short_answer",
                    skill="",
                    score=score_task(task, params, used_ids=used),
                    themable=is_themable(text, exam_part=task.exam_part),
                    exam_part=task.exam_part,
                )
            )
            if len(pool) >= limit:
                break
    pool.extend(_approved_candidates(params, limit=limit))
    pool.sort(key=lambda item: item.score, reverse=True)
    return pool[:limit]


def _approved_candidates(params: dict, *, limit: int) -> list[RetrievedTask]:
    from .models import AITaskCandidate

    qs = AITaskCandidate.objects.filter(
        review_status=AITaskCandidate.Review.APPROVED,
        promoted_task__isnull=True,
        subject_id=params["subject_id"],
    )
    topic = (params.get("topic") or "").lower()
    found = []
    for row in qs.order_by("-created_at")[:limit]:
        blob = f"{row.topic} {row.subtopic} {row.text}".lower()
        if topic and topic not in blob and not any(token in blob for token in tokens(topic)):
            continue
        found.append(
            RetrievedTask(
                source="ai_approved",
                bank_task_id=None,
                candidate_id=row.id,
                text=plain_text(row.text),
                answer=plain_text(row.answer),
                solution=plain_text(row.solution),
                difficulty=row.difficulty or "standard",
                topic=row.topic,
                subtopic=row.subtopic,
                grade=row.grade,
                task_type=row.task_type or "short_answer",
                skill=row.skill,
                score=60,
                themable=is_themable(row.text, row.task_type),
            )
        )
    return found


def relevant_tasks(pool: list[RetrievedTask]) -> list[RetrievedTask]:
    return [item for item in pool if item.score >= RELEVANCE_FLOOR]


def select_tasks(pool: list[RetrievedTask], params: dict) -> list[RetrievedTask]:
    wanted = int(params["task_count"])
    difficulty = params.get("difficulty") or "standard"
    ranked = relevant_tasks(pool)
    if difficulty == "mixed":
        bands = {"basic": [], "standard": [], "advanced": []}
        for item in ranked:
            bands.get(item.difficulty, bands["standard"]).append(item)
        basic_n = max(1, round(wanted * 0.3)) if wanted >= 3 else 0
        advanced_n = max(1, round(wanted * 0.3)) if wanted >= 3 else 0
        standard_n = max(0, wanted - basic_n - advanced_n)
        chosen: list[RetrievedTask] = []
        chosen.extend(bands["basic"][:basic_n])
        chosen.extend(bands["standard"][:standard_n])
        chosen.extend(bands["advanced"][:advanced_n])
        if len(chosen) < wanted:
            seen = {id(item) for item in chosen}
            for item in ranked:
                if id(item) in seen:
                    continue
                chosen.append(item)
                if len(chosen) >= wanted:
                    break
        chosen = chosen[:wanted]
        chosen.sort(key=lambda item: DIFFICULTY_RANK.get(item.difficulty, 1))
        return chosen

    preferred = [item for item in ranked if item.difficulty == difficulty]
    rest = [item for item in ranked if item.difficulty != difficulty]
    return (preferred + rest)[:wanted]


def missing_difficulties(selected: list[RetrievedTask], params: dict) -> list[str]:
    missing = int(params["task_count"]) - len(selected)
    if missing <= 0:
        return []
    difficulty = params.get("difficulty") or "standard"
    if difficulty != "mixed":
        return [difficulty] * missing
    have = [item.difficulty for item in selected]
    target = []
    wanted = int(params["task_count"])
    basic_n = max(1, round(wanted * 0.3)) if wanted >= 3 else 0
    advanced_n = max(1, round(wanted * 0.3)) if wanted >= 3 else 0
    standard_n = wanted - basic_n - advanced_n
    for name, count in (("basic", basic_n), ("standard", standard_n), ("advanced", advanced_n)):
        already = have.count(name)
        target.extend([name] * max(0, count - already))
    while len(target) < missing:
        target.append("standard")
    return target[:missing]


def suggest_topics(subject_id: int, query: str, *, limit: int = 12) -> dict:
    q = (query or "").strip()
    titles = TaskList.objects.filter(subject_id=subject_id)
    subs = SubTopic.objects.filter(task_list__subject_id=subject_id)
    if q:
        titles = titles.filter(task_title__icontains=q)
        subs = subs.filter(title__icontains=q)
    topics = list(dict.fromkeys(titles.order_by("task_title").values_list("task_title", flat=True)[:limit]))
    subtopics = list(dict.fromkeys(subs.order_by("title").values_list("title", flat=True)[:limit]))
    return {"topics": topics, "subtopics": subtopics}


def reload_snapshot(user, snapshot: list[dict]) -> list[RetrievedTask]:
    """Повторно читает только id из расчёта. Чужие и неактивные задания отбрасываются."""
    bank_ids = [int(item["bank_task_id"]) for item in snapshot if item.get("bank_task_id")]
    candidate_ids = [int(item["candidate_id"]) for item in snapshot if item.get("candidate_id")]
    tasks = {
        task.id: task
        for task in Task.objects.filter(id__in=bank_ids, is_active=True, status=Task.Status.READY)
        .filter(Q(scope=Task.Scope.GLOBAL) | Q(scope=Task.Scope.TEACHER, owner_teacher=user))
        .select_related("task", "subtopic")
    }
    from .models import AITaskCandidate

    candidates = {
        row.id: row
        for row in AITaskCandidate.objects.filter(
            id__in=candidate_ids,
            review_status=AITaskCandidate.Review.APPROVED,
        )
    }
    loaded = []
    for item in snapshot:
        if item.get("bank_task_id"):
            task = tasks.get(int(item["bank_task_id"]))
            if not task:
                continue
            loaded.append(
                RetrievedTask(
                    source="bank",
                    bank_task_id=task.id,
                    candidate_id=None,
                    text=plain_text(task.task_template),
                    answer=plain_text(task.answer),
                    solution="",
                    difficulty=item.get("difficulty") or difficulty_of_task(task),
                    topic=item.get("topic") or "",
                    subtopic=item.get("subtopic") or "",
                    grade=item.get("grade") or "",
                    task_type=item.get("task_type") or "short_answer",
                    skill=item.get("skill") or "",
                    score=0,
                    themable=is_themable(plain_text(task.task_template), exam_part=task.exam_part),
                    exam_part=task.exam_part,
                    images=pictures_of(task),
                )
            )
        elif item.get("candidate_id"):
            row = candidates.get(int(item["candidate_id"]))
            if not row:
                continue
            loaded.append(
                RetrievedTask(
                    source="ai_approved",
                    bank_task_id=None,
                    candidate_id=row.id,
                    text=plain_text(row.text),
                    answer=plain_text(row.answer),
                    solution=plain_text(row.solution),
                    difficulty=row.difficulty or "standard",
                    topic=row.topic,
                    subtopic=row.subtopic,
                    grade=row.grade,
                    task_type=row.task_type or "short_answer",
                    skill=row.skill,
                    score=0,
                    themable=is_themable(row.text, row.task_type),
                )
            )
    return loaded


def duplicate_hash_exists(value: str, *, extra_hashes: set[str] | None = None) -> bool:
    from .models import AITaskCandidate

    digest = text_hash(value)
    if extra_hashes and digest in extra_hashes:
        return True
    return AITaskCandidate.objects.filter(text_hash=digest).exists()
