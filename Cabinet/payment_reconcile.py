"""r101: сверка «зависших» pending-платежей с Т-Банком (GetState).

* CONFIRMED → активация через PaymentProviderService.sync_payment_from_provider (идемпотентно,
  тот же путь, что webhook); если настоящего уведомления банка не было — алерт confirmed_without_webhook.
* DEADLINE_EXPIRED / CANCELED / REVERSED → cancelled, REJECTED / AUTH_FAIL → failed;
  error_code = статус банка (или ErrorCode), error_message = Message.
  Отдельного статуса «expired» у Payment нет — истёкшая форма = cancelled + error_code=DEADLINE_EXPIRED.
* pending без PaymentId (Init не прошёл) → failed, error_code=init_no_payment_id.
* NEW / FORM_SHOWED / AUTHORIZED / 3DS… — не трогаем.
dry_run=True (по умолчанию) — только GetState (read-only) и отчёт, без записи в БД.
"""
from __future__ import annotations

import logging
from collections import Counter
from datetime import timedelta

from django.utils import timezone

from .payment_alerts import record_alert

logger = logging.getLogger(__name__)

MIN_AGE = timedelta(minutes=30)


def _has_bank_webhook(payment) -> bool:
    from .models import PaymentWebhookEvent

    return (
        PaymentWebhookEvent.objects.filter(payment=payment)
        .exclude(event_id__startswith="sync_")
        .exclude(event_id__startswith="reconcile_")
        .exists()
    )


def reconcile(*, dry_run: bool = True, now=None, min_age=MIN_AGE, limit: int | None = None, get_state=None):
    from .models import Payment
    from .payment_service import PaymentProviderService
    from .tbank_payment import get_state_raw, map_tbank_status

    get_state = get_state or get_state_raw
    now = now or timezone.now()
    qs = Payment.objects.filter(
        status=Payment.Status.PENDING, provider__in=("tbank", "tinkoff"), created_at__lte=now - min_age
    ).order_by("created_at")
    if limit:
        qs = qs[:limit]
    summary = Counter()
    rows = []
    for p in qs:
        summary["checked"] += 1
        row = {"payment_id": p.pk, "created_at": p.created_at.isoformat(), "bank_status": "", "action": ""}
        rows.append(row)
        if not p.provider_payment_id:
            row["action"] = "fail_no_payment_id"
            summary[row["action"]] += 1
            if not dry_run:
                PaymentProviderService.handle_webhook(
                    {"payment_id": p.pk, "status": "failed", "event_id": f"reconcile_{p.pk}_no_payment_id",
                     "error_code": "init_no_payment_id",
                     "error_message": "Init не вернул PaymentId (r101 reconcile)"},
                    provider_name="tbank", skip_provider_parse=True,
                )
            continue
        try:
            st = get_state(p.provider_payment_id)
        except Exception as exc:
            row["action"] = "getstate_error"
            summary["getstate_error"] += 1
            logger.warning("reconcile GetState failed payment_id=%s: %s", p.pk, type(exc).__name__)
            continue
        status = (st.get("Status") or "").upper()
        row["bank_status"] = status
        if not st.get("Success") and not status:
            row["action"] = "getstate_error"
            summary["getstate_error"] += 1
            continue
        mapped = map_tbank_status(status)
        if mapped == "paid":
            had_webhook = _has_bank_webhook(p)
            row["action"] = "activate" + ("" if had_webhook else "_no_webhook")
            summary["confirmed"] += 1
            if not had_webhook:
                summary["confirmed_without_webhook"] += 1
                record_alert("confirmed_without_webhook", payment_id=p.pk, dry_run=dry_run)
            if not dry_run:
                res = PaymentProviderService.sync_payment_from_provider(p)
                if not res.get("ok"):
                    summary["activate_error"] += 1
                    row["action"] += "_error"
        elif mapped in ("failed", "cancelled", "refunded"):
            row["action"] = f"mark_{mapped}"
            summary[row["action"]] += 1
            if not dry_run:
                code = st.get("ErrorCode") if st.get("ErrorCode") not in ("", "0") else status
                PaymentProviderService.handle_webhook(
                    {"payment_id": p.pk, "status": mapped,
                     "event_id": f"sync_tbank_{p.provider_payment_id}_{status}",
                     "provider_payment_id": p.provider_payment_id,
                     "error_code": code, "error_message": st.get("Message") or status},
                    provider_name="tbank", skip_provider_parse=True,
                )
        else:
            row["action"] = "keep_pending"
            summary["keep_pending"] += 1
    logger.info("reconcile_pending_payments dry_run=%s %s", dry_run, dict(summary))
    return {"summary": dict(summary), "rows": rows, "dry_run": dry_run}
