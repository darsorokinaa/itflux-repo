"""r74: денежная оценка исторических списаний из абонементов + распределение оплат.

  python manage.py backfill_package_ledger --dry-run [--teacher ID] [--allocate-payments]
        [--exclude PAIRS] [--report-json PATH]

Что делает (в одной транзакции; при --dry-run — откат в конце):
  1. Для операций package_consumption / package_return (и их сторно) с amount = 0
     ставит денежную сумму по цене единицы абонемента (purchase_amount / total_units),
     последняя единица забирает остаток (сумма по исчерпанному абонементу = purchase_amount).
     Возвраты без урока (бонусные единицы adjust_package) остаются 0.
     Уроки, где одновременно активны денежное начисление и списание абонемента, — пропуск
     (в отчёт «manual»).
  2. --allocate-payments: свободные (не абонементные) подтверждённые оплаты по FIFO
     распределяются на неоплаченные проведённые уроки (только статусы уроков; баланс
     по журналу не меняется).
  Счета из --exclude (по умолчанию ручные кейсы аудита) не трогаются.
Идемпотентно: уже оценённые операции не меняются.
"""

import json
from collections import defaultdict
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand
from django.db import transaction

from Cabinet.billing_models import (
    BillingAccount,
    BillingTransaction,
    LessonPackage,
    StudentPayment,
    StudentPaymentStatus,
    TransactionType,
)
from Cabinet import billing_service as bs

DEFAULT_EXCLUDE = "2:6,2:16,2:53,2:84,50:22"
CONS = TransactionType.PACKAGE_CONSUMPTION
RET = TransactionType.PACKAGE_RETURN


class _DryRun(Exception):
    pass


def _parse_pairs(text):
    pairs = set()
    for chunk in (text or "").split(","):
        chunk = chunk.strip()
        if not chunk:
            continue
        t, s = chunk.split(":")
        pairs.add((int(t), int(s)))
    return pairs


def account_snapshot(teacher_ids):
    out = {}
    for acc in BillingAccount.objects.filter(teacher_id__in=teacher_ids).select_related("student"):
        bal = bs.compute_account_balance(acc)["balance"]
        out[acc.pk] = {
            "teacher_id": acc.teacher_id,
            "student_id": acc.student_id,
            "archived": acc.student.status == "archived",
            "balance": bal,
        }
    return out


def teacher_metrics(teacher, year, month):
    d = bs.dashboard_summary(teacher, year=year, month=month)
    return {k: d[k] for k in ("credit_total", "debt_total", "month_received", "month_charged", "planned_income")}


def value_packages(exclude_accounts, teacher_id=None):
    stats = defaultdict(int)
    manual = []
    pkgs = LessonPackage.objects.all()
    if teacher_id:
        pkgs = pkgs.filter(billing_account__teacher_id=teacher_id)
    pkgs = pkgs.exclude(billing_account_id__in=exclude_accounts)
    charge_records = set(
        bs.BillingTransaction.objects.filter(
            transaction_type=TransactionType.CHARGE, is_reversal=False, amount__gt=0,
        ).exclude(
            pk__in=BillingTransaction.objects.filter(reversed_transaction__isnull=False)
            .values("reversed_transaction_id")
        ).values_list("event_billing_id", flat=True)
    )
    for pkg in pkgs.select_related("billing_account"):
        price = bs.package_unit_price(pkg)
        purchase = bs.D(pkg.purchase_amount or 0)
        if price <= 0:
            continue
        txs = list(
            BillingTransaction.objects.filter(package=pkg, transaction_type__in=(CONS, RET))
            .order_by("occurred_at", "created_at")
        )
        valued = {}
        running = Decimal("0.00")  # чистая стоимость списанного
        units_net = Decimal("0.00")
        for tx in txs:
            amount = bs.D(tx.amount)
            new_amount = None
            if tx.is_reversal:
                orig_amount = valued.get(tx.reversed_transaction_id)
                if orig_amount is None:
                    orig = next((t for t in txs if t.pk == tx.reversed_transaction_id), None)
                    orig_amount = bs.D(orig.amount) if orig else Decimal("0.00")
                if amount == 0 and orig_amount != 0:
                    new_amount = bs.D(-orig_amount)
            elif tx.transaction_type == CONS:
                if amount == 0 and bs.D_units(tx.package_units) > 0:
                    if tx.event_billing_id and tx.event_billing_id in charge_records:
                        manual.append({
                            "reason": "charge_and_package_on_same_lesson",
                            "teacher_id": pkg.billing_account.teacher_id,
                            "student_id": pkg.billing_account.student_id,
                            "record_id": str(tx.event_billing_id),
                        })
                        stats["skipped_double"] += 1
                    else:
                        units_after = units_net + bs.D_units(tx.package_units)
                        left = purchase - running
                        if units_after >= bs.D_units(pkg.total_units):
                            val = left
                        else:
                            val = min(bs.D(price * bs.D_units(tx.package_units)), left)
                        new_amount = bs.D(val if val > 0 else 0)
            elif tx.transaction_type == RET:
                if amount == 0 and tx.event_billing_id and bs.D_units(tx.package_units) > 0:
                    val = min(bs.D(price * bs.D_units(tx.package_units)), running)
                    new_amount = bs.D(val if val > 0 else 0)
            if new_amount is not None and new_amount != amount:
                BillingTransaction.objects.filter(pk=tx.pk).update(amount=new_amount)
                amount = new_amount
                stats[f"valued_{tx.transaction_type}{'_reversal' if tx.is_reversal else ''}"] += 1
                stats["accounts:" + str(pkg.billing_account_id)] = 1
            valued[tx.pk] = amount
            sign = 1 if tx.transaction_type == CONS else -1
            running += sign * amount
            units_net += sign * bs.D_units(tx.package_units)
    return stats, manual


def allocate_free_payments(exclude_accounts, teacher_id=None):
    stats = defaultdict(int)
    qs = StudentPayment.objects.filter(status=StudentPaymentStatus.CONFIRMED, package__isnull=True)
    if teacher_id:
        qs = qs.filter(billing_account__teacher_id=teacher_id)
    qs = qs.exclude(billing_account_id__in=exclude_accounts).select_related("billing_account")
    for payment in qs.order_by("paid_at", "created_at"):
        if bs._payment_unallocated_amount(payment) <= 0:
            continue
        used = bs.allocate_payment_to_unpaid_lessons(account=payment.billing_account, payment=payment)
        if used > 0:
            stats["payments_allocated"] += 1
            stats["amount_allocated"] = str(bs.D(Decimal(stats.get("amount_allocated", "0")) + used))
    return stats


class Command(BaseCommand):
    help = "r74: денежная оценка списаний из абонементов (+ распределение свободных оплат)"

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true")
        parser.add_argument("--teacher", type=int)
        parser.add_argument("--allocate-payments", action="store_true")
        parser.add_argument("--exclude", default=DEFAULT_EXCLUDE,
                            help="пары teacher:student через запятую (ручные кейсы)")
        parser.add_argument("--year", type=int)
        parser.add_argument("--month", type=int)
        parser.add_argument("--report-json")

    def handle(self, *args, **o):
        from django.utils import timezone

        now = timezone.localtime()
        year, month = o.get("year") or now.year, o.get("month") or now.month
        pairs = _parse_pairs(o["exclude"])
        exclude_accounts = set()
        for t, s in pairs:
            exclude_accounts.update(
                BillingAccount.objects.filter(teacher_id=t, student_id=s).values_list("pk", flat=True)
            )
        teacher_ids = sorted(set(
            BillingAccount.objects.values_list("teacher_id", flat=True)
        ) if not o.get("teacher") else {o["teacher"]})
        User = get_user_model()
        teachers = {u.pk: u for u in User.objects.filter(pk__in=teacher_ids)}
        report = {"dry_run": bool(o["dry_run"]), "year": year, "month": month}
        try:
            with transaction.atomic():
                before_acc = account_snapshot(teacher_ids)
                before = {tid: teacher_metrics(teachers[tid], year, month) for tid in teacher_ids}
                # 0. привязать «висящие» оплаты к абонементам (раньше делалось при чтении карточки)
                rstats = 0
                acc_qs = BillingAccount.objects.exclude(pk__in=exclude_accounts)
                if o.get("teacher"):
                    acc_qs = acc_qs.filter(teacher_id=o["teacher"])
                for acc in acc_qs:
                    linked_before = StudentPayment.objects.filter(billing_account=acc, package__isnull=False).count()
                    bs.reconcile_package_payments(acc)
                    rstats += StudentPayment.objects.filter(billing_account=acc, package__isnull=False).count() - linked_before
                vstats, manual = value_packages(exclude_accounts, o.get("teacher"))
                astats = allocate_free_payments(exclude_accounts, o.get("teacher")) if o["allocate_payments"] else {}
                after_acc = account_snapshot(teacher_ids)
                after = {tid: teacher_metrics(teachers[tid], year, month) for tid in teacher_ids}
                changed = [
                    {**after_acc[k], "before": str(before_acc[k]["balance"]), "after": str(after_acc[k]["balance"])}
                    for k in after_acc if after_acc[k]["balance"] != before_acc[k]["balance"]
                ]
                for row in changed:
                    row.pop("balance", None)
                report.update({
                    "valuation": {k: v for k, v in vstats.items() if not k.startswith("accounts:")},
                    "allocation": dict(astats),
                    "payments_linked_to_packages": rstats,
                    "manual": manual,
                    "excluded_accounts": sorted(exclude_accounts),
                    "metrics_before": before,
                    "metrics_after": after,
                    "changed_accounts": changed,
                    "changed_teachers": sorted({r["teacher_id"] for r in changed}),
                    "audit_after": __import__(
                        "Cabinet.management.commands.audit_payment_integrity", fromlist=["run_checks"]
                    ).run_checks(o.get("teacher")),
                })
                if o["dry_run"]:
                    raise _DryRun()
        except _DryRun:
            pass
        text = json.dumps(report, ensure_ascii=False, indent=2, default=str)
        if o.get("report_json"):
            with open(o["report_json"], "w") as fh:
                fh.write(text)
        s = report
        self.stdout.write(f"dry_run={s['dry_run']} valuation={s['valuation']} allocation={s['allocation']} linked={s.get('payments_linked_to_packages')}")
        self.stdout.write(f"changed accounts: {len(s['changed_accounts'])}, teachers: {len(s['changed_teachers'])}")
        self.stdout.write(f"manual (skipped): {len(s['manual'])}; excluded accounts: {s['excluded_accounts']}")
