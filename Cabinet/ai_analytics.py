"""Агрегаты для админки «AI / Использование»."""

from __future__ import annotations

from decimal import Decimal

from django.db.models import Count, Sum
from django.utils import timezone

from .ai_service import usage_snapshot
from .models import AIRequestLog, AIUsage, TariffPlan, TeacherSubscription


SUCCESS = AIRequestLog.RequestStatus.SUCCESS


def _percentiles(values: list[int]) -> dict:
    if not values:
        return {"median": 0, "p75": 0, "p90": 0, "p95": 0}
    ordered = sorted(values)
    def at(p):
        idx = min(len(ordered) - 1, max(0, int(round((p / 100) * (len(ordered) - 1)))))
        return ordered[idx]
    return {"median": at(50), "p75": at(75), "p90": at(90), "p95": at(95)}


def build_ai_report() -> dict:
    now = timezone.now()
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    success = AIRequestLog.objects.filter(status=SUCCESS)
    today_qs = success.filter(created_at__gte=today)
    month_qs = success.filter(created_at__gte=month_start)
    billed = success.exclude(operation_type=AIRequestLog.OperationType.OPEN)

    def pack(qs):
        agg = qs.aggregate(
            requests=Count("id"),
            tokens=Sum("total_tokens"),
            images=Sum("image_count"),
            cost=Sum("actual_cost"),
            users=Count("teacher_id", distinct=True),
        )
        return {
            "requests": agg["requests"] or 0,
            "tokens": agg["tokens"] or 0,
            "images": agg["images"] or 0,
            "cost": str(agg["cost"] or Decimal("0")),
            "users": agg["users"] or 0,
        }

    today_pack = pack(today_qs.exclude(operation_type=AIRequestLog.OperationType.OPEN))
    month_pack = pack(month_qs.exclude(operation_type=AIRequestLog.OperationType.OPEN))
    active_users = month_pack["users"]
    avg_cost = Decimal("0")
    if active_users:
        avg_cost = (Decimal(month_pack["cost"]) / Decimal(active_users)).quantize(Decimal("0.01"))

    opened = AIRequestLog.objects.filter(
        operation_type=AIRequestLog.OperationType.OPEN,
        created_at__gte=month_start,
    ).values("teacher_id").distinct().count()
    sent = billed.filter(created_at__gte=month_start).values("teacher_id").distinct().count()

    per_user = list(
        billed.filter(created_at__gte=month_start)
        .values("teacher_id")
        .annotate(n=Count("id"))
        .values_list("n", flat=True)
    )
    pct = _percentiles([int(x) for x in per_user])

    by_plan = []
    for plan in TariffPlan.objects.filter(is_active=True).order_by("sort_order"):
        teacher_ids = list(
            TeacherSubscription.objects.filter(plan=plan).values_list("teacher_id", flat=True)
        )
        qs = billed.filter(created_at__gte=month_start, teacher_id__in=teacher_ids)
        row = pack(qs)
        row["plan"] = plan.name
        row["slug"] = plan.slug
        row["users"] = len(set(teacher_ids))
        by_plan.append(row)

    intents = list(
        billed.filter(created_at__gte=month_start)
        .exclude(intent="")
        .values("intent")
        .annotate(n=Count("id"))
        .order_by("-n")
    )

    users_rows = []
    for usage in (
        AIUsage.objects.select_related("teacher")
        .filter(period_end__gte=now.date())
        .order_by("-used_requests")[:80]
    ):
        try:
            snap = usage_snapshot(usage.teacher)
        except Exception:
            continue
        users_rows.append({
            "user": usage.teacher.get_username(),
            "email": usage.teacher.email,
            "plan": snap["plan"]["name"],
            "text_used": snap["text"]["used"],
            "text_limit": snap["text"]["limit"],
            "images_used": snap["images"]["used"],
            "images_limit": snap["images"]["limit"],
            "credits": snap["credits"]["used"],
            "cost": str(
                billed.filter(teacher=usage.teacher, created_at__gte=month_start)
                .aggregate(s=Sum("actual_cost"))
                .get("s") or Decimal("0")
            ),
        })

    hit_50 = hit_80 = hit_100 = 0
    for usage in AIUsage.objects.filter(period_end__gte=now.date(), used_requests__gt=0):
        limit = usage.limit_requests or 1
        ratio = usage.used_requests / limit
        if ratio >= 0.5:
            hit_50 += 1
        if ratio >= 0.8:
            hit_80 += 1
        if ratio >= 1:
            hit_100 += 1

    return {
        "generated_at": now.isoformat(),
        "today": today_pack,
        "month": month_pack,
        "avg_cost_per_user": str(avg_cost),
        "opened_users": opened,
        "sent_users": sent,
        "percentiles": pct,
        "by_plan": by_plan,
        "intents": intents,
        "users": users_rows,
        "limit_reach": {"p50": hit_50, "p80": hit_80, "p100": hit_100},
    }
