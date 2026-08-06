"""API управленческого учёта оплат репетитора."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal, InvalidOperation

from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .billing_models import (
    BillingAccount,
    BillingTransaction,
    EventBillingRecord,
    LessonPackage,
    PackageStatus,
    StudentPayment,
)
from .billing_service import (
    BillingError,
    adjust_package,
    apply_cancel_billing,
    apply_no_show,
    build_reminder_text,
    charge_lesson_from_package,
    charge_multiple_lessons_from_package,
    check_package_for_planning,
    create_adjustment,
    cancel_package,
    create_package,
    create_refund,
    dashboard_planned_income_details,
    dashboard_received_details,
    dashboard_summary,
    ensure_event_billing_records,
    event_billing_badge,
    export_transactions_csv,
    export_transactions_xlsx,
    extend_package,
    finalize_event_billing,
    find_available_packages_for_charge,
    freeze_package,
    get_or_create_billing_account,
    get_or_create_teacher_settings,
    legacy_backfill_apply,
    legacy_backfill_preview,
    mark_lesson_as_paid_manually,
    preview_charge_lessons_from_package,
    preview_finalize,
    refund_lesson_package_charge,
    register_payment,
    reports,
    reverse_transaction,
    send_payment_reminder,
    serialize_account,
    serialize_event_billing,
    serialize_package,
    serialize_teacher_settings,
    serialize_transaction,
    student_billing_view,
    unfinalize_event_billing,
    unfreeze_package,
    unresolved_lessons,
    update_student_settings,
    update_teacher_settings,
    visible_billing_accounts,
)
from .choices import StudentStatus
from .models import Profile, ScheduleEvent, Student
from .permissions import IsCabinetStudent, IsCabinetTeacher


def _parse_dt(value):
    if not value:
        return None
    if isinstance(value, datetime):
        return value
    dt = parse_datetime(value)
    if dt:
        if timezone.is_naive(dt):
            dt = timezone.make_aware(dt, timezone.get_current_timezone())
        return dt
    d = parse_date(value)
    if d:
        return timezone.make_aware(
            datetime.combine(d, datetime.min.time()),
            timezone.get_current_timezone(),
        )
    return None


def _dec(value, default=None):
    if value is None or value == "":
        return default
    try:
        return Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise BillingError("INVALID_DECIMAL", f"Некорректное число: {value}") from exc


def _err(exc: BillingError) -> Response:
    return Response({"detail": exc.message, "code": exc.code}, status=exc.status)


class BillingDashboardView(APIView):
    permission_classes = [IsAuthenticated, IsCabinetTeacher]

    def get(self, request):
        year = request.query_params.get("year")
        month = request.query_params.get("month")
        try:
            year = int(year) if year else None
            month = int(month) if month else None
        except (TypeError, ValueError):
            year, month = None, None
        detail = (request.query_params.get("detail") or "").strip().lower()
        if detail == "planned":
            return Response(dashboard_planned_income_details(request.user, year=year, month=month))
        if detail == "received":
            return Response(dashboard_received_details(request.user, year=year, month=month))
        return Response(dashboard_summary(request.user, year=year, month=month))


class TeacherBillingSettingsView(APIView):
    permission_classes = [IsAuthenticated, IsCabinetTeacher]

    def get(self, request):
        settings = get_or_create_teacher_settings(request.user)
        return Response(serialize_teacher_settings(settings))

    def patch(self, request):
        try:
            settings = update_teacher_settings(request.user, request.data or {})
        except BillingError as exc:
            return _err(exc)
        return Response(serialize_teacher_settings(settings))


class BillingAccountsView(APIView):
    permission_classes = [IsAuthenticated, IsCabinetTeacher]

    def get(self, request):
        # Ensure accounts exist for all active students
        for student in Student.objects.filter(teacher=request.user, status="active"):
            get_or_create_billing_account(request.user, student)
        qs = visible_billing_accounts(request.user).select_related("student", "settings")
        debt_only = request.query_params.get("debt") == "1"
        low_package = request.query_params.get("low_package") == "1"
        no_package = request.query_params.get("no_package") == "1"
        billing_type = request.query_params.get("billing_type")
        q = (request.query_params.get("q") or "").strip().lower()

        rows = []
        for acc in qs:
            data = serialize_account(acc)
            if q and q not in (data["student_name"] or "").lower() and q not in (
                data.get("payer_name") or ""
            ).lower():
                continue
            if debt_only and Decimal(data.get("unpaid_lessons_amount") or data["balance"]["debt"]) <= 0:
                continue
            if billing_type and data["billing_type"] != billing_type:
                continue
            if no_package and data.get("package"):
                continue
            if low_package and data.get("status_label") != "заканчивается абонемент":
                continue
            rows.append(data)
        return Response(rows)


class BillingAccountDetailView(APIView):
    permission_classes = [IsAuthenticated, IsCabinetTeacher]

    def get(self, request, account_id):
        account = get_object_or_404(BillingAccount, pk=account_id, teacher=request.user)
        return Response(serialize_account(account, include_history=True))


class BillingAccountSettingsView(APIView):
    permission_classes = [IsAuthenticated, IsCabinetTeacher]

    def patch(self, request, account_id):
        account = get_object_or_404(BillingAccount, pk=account_id, teacher=request.user)
        try:
            update_student_settings(request.user, account, request.data or {})
        except BillingError as exc:
            return _err(exc)
        return Response(serialize_account(account, include_history=True))


class BillingAccountByStudentView(APIView):
    permission_classes = [IsAuthenticated, IsCabinetTeacher]

    def get(self, request, student_id):
        student = get_object_or_404(Student, pk=student_id, teacher=request.user)
        try:
            account = get_or_create_billing_account(request.user, student)
        except BillingError as exc:
            return _err(exc)
        return Response(serialize_account(account, include_history=True))


class BillingTransactionsView(APIView):
    permission_classes = [IsAuthenticated, IsCabinetTeacher]

    def get(self, request):
        from django.db.models import Exists, OuterRef

        qs = BillingTransaction.objects.filter(
            billing_account__teacher=request.user
        ).select_related("student", "created_by").annotate(
            _is_reversed=Exists(
                BillingTransaction.objects.filter(reversed_transaction_id=OuterRef("pk"))
            )
        )
        student_id = request.query_params.get("student_id")
        tx_type = request.query_params.get("type")
        date_from = _parse_dt(request.query_params.get("from"))
        date_to = _parse_dt(request.query_params.get("to"))
        only_reversals = request.query_params.get("reversals") == "1"
        only_adjustments = request.query_params.get("adjustments") == "1"
        if student_id:
            qs = qs.filter(student_id=student_id)
        if tx_type:
            qs = qs.filter(transaction_type=tx_type)
        if date_from:
            qs = qs.filter(occurred_at__gte=date_from)
        if date_to:
            qs = qs.filter(occurred_at__lte=date_to)
        if only_reversals:
            qs = qs.filter(is_reversal=True)
        if only_adjustments:
            qs = qs.filter(transaction_type="adjustment")
        return Response([serialize_transaction(t) for t in qs.order_by("-occurred_at")[:500]])


class BillingPaymentsView(APIView):
    permission_classes = [IsAuthenticated, IsCabinetTeacher]

    def post(self, request):
        data = request.data or {}
        student_id = data.get("student_id")
        student = get_object_or_404(Student, pk=student_id, teacher=request.user)
        try:
            package_payload = data.get("package")
            if data.get("package_id") and not package_payload:
                package_payload = {"package_id": data.get("package_id")}
            payment = register_payment(
                teacher=request.user,
                student=student,
                amount=_dec(data.get("amount")),
                paid_at=_parse_dt(data.get("paid_at")),
                method=data.get("method") or "",
                purpose=data.get("purpose") or "",
                comment=data.get("comment") or "",
                package_payload=package_payload,
                event_billing_ids=data.get("event_billing_ids") or data.get("lesson_ids"),
            )
        except BillingError as exc:
            return _err(exc)
        return Response(
            {
                "id": str(payment.id),
                "amount": str(payment.amount),
                "currency": payment.currency,
                "status": payment.status,
                "package_id": str(payment.package_id) if payment.package_id else None,
            },
            status=201,
        )


class BillingRefundsView(APIView):
    permission_classes = [IsAuthenticated, IsCabinetTeacher]

    def post(self, request):
        data = request.data or {}
        student = get_object_or_404(Student, pk=data.get("student_id"), teacher=request.user)
        try:
            tx = create_refund(
                teacher=request.user,
                student=student,
                amount=_dec(data.get("amount")),
                comment=data.get("comment") or "",
                payment_id=data.get("payment_id"),
            )
        except BillingError as exc:
            return _err(exc)
        return Response(serialize_transaction(tx), status=201)


class BillingAdjustmentsView(APIView):
    permission_classes = [IsAuthenticated, IsCabinetTeacher]

    def post(self, request):
        data = request.data or {}
        student = get_object_or_404(Student, pk=data.get("student_id"), teacher=request.user)
        try:
            tx = create_adjustment(
                teacher=request.user,
                student=student,
                amount=_dec(data.get("amount")),
                comment=data.get("comment") or "",
            )
        except BillingError as exc:
            return _err(exc)
        return Response(serialize_transaction(tx), status=201)


class BillingTransactionReverseView(APIView):
    permission_classes = [IsAuthenticated, IsCabinetTeacher]

    def post(self, request, tx_id):
        tx = get_object_or_404(
            BillingTransaction, pk=tx_id, billing_account__teacher=request.user
        )
        try:
            rev = reverse_transaction(
                teacher=request.user,
                tx=tx,
                comment=(request.data or {}).get("comment") or "",
            )
        except BillingError as exc:
            return _err(exc)
        return Response(serialize_transaction(rev), status=201)


class BillingPackagesView(APIView):
    permission_classes = [IsAuthenticated, IsCabinetTeacher]

    def get(self, request):
        qs = LessonPackage.objects.filter(
            billing_account__teacher=request.user
        ).exclude(
            billing_account__student__status=StudentStatus.ARCHIVED,
        ).select_related("billing_account__student")
        status = request.query_params.get("status")
        if status:
            qs = qs.filter(status=status)
        else:
            qs = qs.exclude(status=PackageStatus.CANCELLED)
        return Response([serialize_package(p) for p in qs.order_by("-created_at")[:300]])

    def post(self, request):
        data = request.data or {}
        student = get_object_or_404(Student, pk=data.get("student_id"), teacher=request.user)
        try:
            await_payment = bool(data.get("await_payment")) or data.get("create_payment") is False
            package = create_package(
                teacher=request.user,
                student=student,
                title=data.get("title") or "Абонемент",
                unit_type=data.get("unit_type") or "lesson",
                total_units=_dec(data.get("total_units")),
                purchase_amount=_dec(data.get("purchase_amount"), Decimal("0")),
                starts_at=parse_date(data["starts_at"]) if data.get("starts_at") else None,
                expires_at=parse_date(data["expires_at"]) if data.get("expires_at") else None,
                auto_use=bool(data.get("auto_use", True)),
                created_by=request.user,
                bonus_units=_dec(data.get("bonus_units"), Decimal("0")),
                create_payment_tx=not await_payment,
                notes=data.get("notes") or data.get("comment") or "",
                lesson_duration_minutes=(
                    int(data["lesson_duration_minutes"])
                    if data.get("lesson_duration_minutes") not in (None, "")
                    else None
                ),
            )
        except BillingError as exc:
            return _err(exc)
        return Response(serialize_package(package), status=201)


class BillingPackageDetailView(APIView):
    permission_classes = [IsAuthenticated, IsCabinetTeacher]

    def get(self, request, package_id):
        package = get_object_or_404(
            LessonPackage, pk=package_id, billing_account__teacher=request.user
        )
        return Response(serialize_package(package))

    def patch(self, request, package_id):
        package = get_object_or_404(
            LessonPackage, pk=package_id, billing_account__teacher=request.user
        )
        data = request.data or {}
        for key in ("title", "auto_use", "notes"):
            if key in data:
                setattr(package, key, data[key])
        if "expires_at" in data:
            package.expires_at = parse_date(data["expires_at"]) if data["expires_at"] else None
        package.save()
        return Response(serialize_package(package))

    def delete(self, request, package_id):
        package = get_object_or_404(
            LessonPackage, pk=package_id, billing_account__teacher=request.user
        )
        try:
            package = cancel_package(request.user, package)
        except BillingError as exc:
            return _err(exc)
        return Response(serialize_package(package))


class BillingPackageFreezeView(APIView):
    permission_classes = [IsAuthenticated, IsCabinetTeacher]

    def post(self, request, package_id):
        package = get_object_or_404(
            LessonPackage, pk=package_id, billing_account__teacher=request.user
        )
        try:
            package = freeze_package(request.user, package)
        except BillingError as exc:
            return _err(exc)
        return Response(serialize_package(package))


class BillingPackageUnfreezeView(APIView):
    permission_classes = [IsAuthenticated, IsCabinetTeacher]

    def post(self, request, package_id):
        package = get_object_or_404(
            LessonPackage, pk=package_id, billing_account__teacher=request.user
        )
        try:
            package = unfreeze_package(request.user, package)
        except BillingError as exc:
            return _err(exc)
        return Response(serialize_package(package))


class BillingPackageExtendView(APIView):
    permission_classes = [IsAuthenticated, IsCabinetTeacher]

    def post(self, request, package_id):
        package = get_object_or_404(
            LessonPackage, pk=package_id, billing_account__teacher=request.user
        )
        data = request.data or {}
        expires = parse_date(data["expires_at"]) if data.get("expires_at") else None
        try:
            package = extend_package(
                request.user, package, expires, comment=data.get("comment") or ""
            )
        except BillingError as exc:
            return _err(exc)
        return Response(serialize_package(package))


class BillingPackageAdjustView(APIView):
    permission_classes = [IsAuthenticated, IsCabinetTeacher]

    def post(self, request, package_id):
        package = get_object_or_404(
            LessonPackage, pk=package_id, billing_account__teacher=request.user
        )
        data = request.data or {}
        try:
            package = adjust_package(
                teacher=request.user,
                package=package,
                units_delta=_dec(data.get("units_delta")),
                comment=data.get("comment") or "",
            )
        except BillingError as exc:
            return _err(exc)
        return Response(serialize_package(package))


class BillingPackageSettleUnpaidView(APIView):
    """Погасить неоплаченные уроки из абонемента (в т.ч. задним числом)."""

    permission_classes = [IsAuthenticated, IsCabinetTeacher]

    def post(self, request, package_id):
        package = get_object_or_404(
            LessonPackage, pk=package_id, billing_account__teacher=request.user
        )
        account = package.billing_account
        data = request.data or {}
        preview_only = bool(data.get("preview"))
        try:
            if preview_only:
                result = preview_charge_lessons_from_package(
                    teacher=request.user,
                    account=account,
                    package=package,
                    event_billing_ids=data.get("event_billing_ids") or data.get("lesson_ids"),
                    select_earliest=bool(data.get("select_earliest")),
                )
                return Response(result)
            result = charge_multiple_lessons_from_package(
                teacher=request.user,
                account=account,
                package=package,
                event_billing_ids=data.get("event_billing_ids") or data.get("lesson_ids"),
                select_earliest=bool(data.get("select_earliest")),
                comment=data.get("comment") or "",
                idempotency_key=data.get("idempotency_key")
                or request.headers.get("X-Idempotency-Key", ""),
            )
        except BillingError as exc:
            return _err(exc)
        return Response(
            {
                "message": result["message"],
                "charged_count": result["charged_count"],
                "remaining_units": str(result["remaining_units"]),
                "package": serialize_package(result["package"]),
                "items": [
                    serialize_event_billing(row["record"]) for row in result["results"]
                ],
                "account": serialize_account(account, include_history=True),
            }
        )


class BillingAccountChargeFromPackageView(APIView):
    """Списать выбранные неоплаченные уроки ученика из абонемента."""

    permission_classes = [IsAuthenticated, IsCabinetTeacher]

    def get(self, request, account_id):
        account = get_object_or_404(BillingAccount, pk=account_id, teacher=request.user)
        packages = find_available_packages_for_charge(account)
        return Response(
            {
                "account": serialize_account(account, include_history=False),
                "packages": [serialize_package(p, include_history=False) for p in packages],
            }
        )

    def post(self, request, account_id):
        account = get_object_or_404(BillingAccount, pk=account_id, teacher=request.user)
        data = request.data or {}
        package_id = data.get("package_id")
        if not package_id:
            return _err(BillingError("NO_PACKAGE", "Выберите абонемент"))
        package = get_object_or_404(
            LessonPackage, pk=package_id, billing_account=account
        )
        preview_only = bool(data.get("preview"))
        try:
            if preview_only:
                result = preview_charge_lessons_from_package(
                    teacher=request.user,
                    account=account,
                    package=package,
                    event_billing_ids=data.get("event_billing_ids") or data.get("lesson_ids"),
                    select_earliest=bool(data.get("select_earliest")),
                )
                return Response(result)
            result = charge_multiple_lessons_from_package(
                teacher=request.user,
                account=account,
                package=package,
                event_billing_ids=data.get("event_billing_ids") or data.get("lesson_ids"),
                select_earliest=bool(data.get("select_earliest")),
                comment=data.get("comment") or "",
                idempotency_key=data.get("idempotency_key")
                or request.headers.get("X-Idempotency-Key", ""),
            )
        except BillingError as exc:
            return _err(exc)
        return Response(
            {
                "message": result["message"],
                "charged_count": result["charged_count"],
                "remaining_units": str(result["remaining_units"]),
                "package": serialize_package(result["package"]),
                "items": [
                    serialize_event_billing(row["record"]) for row in result["results"]
                ],
                "account": serialize_account(account, include_history=True),
            }
        )


class BillingEventBillingChargeFromPackageView(APIView):
    """Списать один конкретный урок из абонемента."""

    permission_classes = [IsAuthenticated, IsCabinetTeacher]

    def post(self, request, record_id):
        record = get_object_or_404(
            EventBillingRecord,
            pk=record_id,
            billing_account__teacher=request.user,
        )
        data = request.data or {}
        try:
            result = charge_lesson_from_package(
                teacher=request.user,
                event_billing=record,
                package_id=data.get("package_id"),
                comment=data.get("comment") or "",
                idempotency_key=data.get("idempotency_key")
                or request.headers.get("X-Idempotency-Key", ""),
            )
        except BillingError as exc:
            return _err(exc)
        return Response(
            {
                "message": result["message"],
                "before_package_payment": result.get("before_package_payment"),
                "remaining_units": str(result["remaining_units"]),
                "item": serialize_event_billing(result["record"]),
                "transaction": serialize_transaction(result["transaction"]),
                "package": serialize_package(result["package"]),
                "account": serialize_account(
                    result["record"].billing_account, include_history=True
                ),
            }
        )


class BillingEventBillingRefundPackageView(APIView):
    """Отменить списание урока из абонемента."""

    permission_classes = [IsAuthenticated, IsCabinetTeacher]

    def post(self, request, record_id):
        record = get_object_or_404(
            EventBillingRecord,
            pk=record_id,
            billing_account__teacher=request.user,
        )
        data = request.data or {}
        try:
            result = refund_lesson_package_charge(
                teacher=request.user,
                event_billing=record,
                comment=data.get("comment") or "",
            )
        except BillingError as exc:
            return _err(exc)
        return Response(
            {
                "message": result["message"],
                "item": serialize_event_billing(result["record"]),
                "transaction": serialize_transaction(result["reversal"]),
                "account": serialize_account(
                    result["record"].billing_account, include_history=True
                ),
            }
        )


class BillingEventBillingMarkPaidView(APIView):
    """Отметить урок оплаченным отдельно (без абонемента)."""

    permission_classes = [IsAuthenticated, IsCabinetTeacher]

    def post(self, request, record_id):
        record = get_object_or_404(
            EventBillingRecord,
            pk=record_id,
            billing_account__teacher=request.user,
        )
        data = request.data or {}
        try:
            payment = mark_lesson_as_paid_manually(
                teacher=request.user,
                event_billing=record,
                amount=_dec(data.get("amount"), Decimal("0")),
                paid_at=_parse_dt(data.get("paid_at")),
                method=data.get("method") or "",
                comment=data.get("comment") or "",
            )
        except BillingError as exc:
            return _err(exc)
        record.refresh_from_db()
        return Response(
            {
                "message": "Оплата урока отмечена",
                "payment_id": str(payment.id),
                "item": serialize_event_billing(record),
                "account": serialize_account(
                    record.billing_account, include_history=True
                ),
            },
            status=201,
        )


class BillingUnresolvedLessonsView(APIView):
    permission_classes = [IsAuthenticated, IsCabinetTeacher]

    def get(self, request):
        return Response(unresolved_lessons(request.user))


class BillingEventPreviewView(APIView):
    permission_classes = [IsAuthenticated, IsCabinetTeacher]

    def post(self, request, event_id):
        event = get_object_or_404(ScheduleEvent, pk=event_id, owner=request.user)
        student_id = (request.data or {}).get("student_id")
        student = None
        if student_id:
            student = get_object_or_404(Student, pk=student_id, teacher=request.user)
        payload = {"items": preview_finalize(event, request.user, student)}
        # Интеграция с журналом: подсказка delivery_status из академической посещаемости
        from .journal_models import LessonJournal
        from .journal_service import attendance_to_delivery_status

        journal = LessonJournal.objects.filter(schedule_event=event).prefetch_related(
            "student_records"
        ).first()
        if journal is not None:
            suggestions = {}
            for record in journal.student_records.all():
                suggestions[str(record.student_id)] = {
                    "attendance_status": record.attendance_status,
                    "suggested_delivery_status": attendance_to_delivery_status(
                        record.attendance_status
                    ),
                }
            payload["journal_attendance"] = suggestions
            if len(suggestions) == 1:
                only = next(iter(suggestions.values()))
                payload["suggested_delivery_status"] = only["suggested_delivery_status"]
                payload["journal_attendance_status"] = only["attendance_status"]
            if journal.actual_duration_minutes:
                payload["journal_actual_duration_minutes"] = journal.actual_duration_minutes
        return Response(payload)


class BillingEventFinalizeView(APIView):
    permission_classes = [IsAuthenticated, IsCabinetTeacher]

    def post(self, request, event_id):
        event = get_object_or_404(ScheduleEvent, pk=event_id, owner=request.user)
        data = request.data or {}
        student = None
        if data.get("student_id"):
            student = get_object_or_404(Student, pk=data["student_id"], teacher=request.user)
        try:
            records = finalize_event_billing(
                event=event,
                teacher=request.user,
                student=student,
                delivery_status=data.get("delivery_status") or "conducted",
                actual_duration_minutes=data.get("actual_duration_minutes"),
                financial_action=data.get("financial_action") or "charge",
                amount=_dec(data.get("amount")) if data.get("amount") is not None else None,
                package_id=data.get("package_id"),
                comment=data.get("comment") or "",
                idempotency_key=data.get("idempotency_key")
                or request.headers.get("X-Idempotency-Key", ""),
                discount_amount=_dec(data.get("discount_amount"), Decimal("0")),
                charge_percent=_dec(data.get("charge_percent"))
                if data.get("charge_percent") is not None
                else None,
            )
        except BillingError as exc:
            return _err(exc)
        return Response({"items": [serialize_event_billing(r) for r in records]})


class BillingEventUnfinalizeView(APIView):
    permission_classes = [IsAuthenticated, IsCabinetTeacher]

    def post(self, request, event_id):
        event = get_object_or_404(ScheduleEvent, pk=event_id, owner=request.user)
        data = request.data or {}
        try:
            records = unfinalize_event_billing(
                event=event,
                teacher=request.user,
                comment=data.get("comment") or "",
                reset_event_status=bool(data.get("reset_event_status", True)),
            )
        except BillingError as exc:
            return _err(exc)
        return Response({"items": [serialize_event_billing(r) for r in records]})


class BillingEventCancelFinanceView(APIView):
    permission_classes = [IsAuthenticated, IsCabinetTeacher]

    def post(self, request, event_id):
        event = get_object_or_404(ScheduleEvent, pk=event_id, owner=request.user)
        data = request.data or {}
        try:
            records = apply_cancel_billing(
                event=event,
                teacher=request.user,
                cancelled_by=data.get("cancelled_by") or "student",
                financial_action=data.get("financial_action") or "skip",
                amount=_dec(data.get("amount")) if data.get("amount") is not None else None,
                charge_percent=_dec(data.get("charge_percent"))
                if data.get("charge_percent") is not None
                else None,
                comment=data.get("comment") or "",
                idempotency_key=data.get("idempotency_key") or "",
            )
        except BillingError as exc:
            return _err(exc)
        return Response({"items": [serialize_event_billing(r) for r in records]})


class BillingEventNoShowView(APIView):
    permission_classes = [IsAuthenticated, IsCabinetTeacher]

    def post(self, request, event_id):
        event = get_object_or_404(ScheduleEvent, pk=event_id, owner=request.user)
        data = request.data or {}
        try:
            records = apply_no_show(
                event=event,
                teacher=request.user,
                financial_action=data.get("financial_action") or "charge",
                amount=_dec(data.get("amount")) if data.get("amount") is not None else None,
                comment=data.get("comment") or "",
                idempotency_key=data.get("idempotency_key") or "",
            )
        except BillingError as exc:
            return _err(exc)
        return Response({"items": [serialize_event_billing(r) for r in records]})


class BillingEventBadgeView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, event_id):
        event = get_object_or_404(ScheduleEvent, pk=event_id)
        profile = getattr(request.user, "profile", None)
        student_ids = None
        if profile and profile.role == Profile.Role.TEACHER:
            if event.owner_id != request.user.id:
                return Response({"detail": "Нет доступа"}, status=403)
        elif profile and profile.role == Profile.Role.STUDENT:
            if not event.participants.filter(user=request.user).exists() and (
                not event.student_id or event.student.user_id != request.user.id
            ):
                return Response({"detail": "Нет доступа"}, status=403)
            # Ученик видит только свои биллинговые записи, не одногруппников.
            from .models import Student

            student_ids = list(
                Student.objects.filter(user=request.user).values_list("id", flat=True)
            )
        else:
            return Response({"detail": "Нет доступа"}, status=403)
        ensure_event_billing_records(event)
        return Response({"badges": event_billing_badge(event, student_ids=student_ids)})


class BillingBulkFinalizeView(APIView):
    permission_classes = [IsAuthenticated, IsCabinetTeacher]

    def post(self, request):
        data = request.data or {}
        record_ids = data.get("record_ids") or []
        action = data.get("financial_action") or "charge"
        items = []
        total = Decimal("0")
        preview_only = bool(data.get("preview"))
        for rid in record_ids:
            record = EventBillingRecord.objects.filter(
                pk=rid, billing_account__teacher=request.user
            ).select_related("event").first()
            if not record:
                continue
            total += record.calculated_amount or Decimal("0")
            if preview_only:
                items.append(serialize_event_billing(record))
                continue
            try:
                rows = finalize_event_billing(
                    event=record.event,
                    teacher=request.user,
                    student=record.student,
                    delivery_status=data.get("delivery_status") or "conducted",
                    financial_action=action,
                    idempotency_key=f"bulk:{rid}",
                )
                items.extend([serialize_event_billing(r) for r in rows])
            except BillingError:
                continue
        return Response(
            {
                "count": len(record_ids),
                "total_amount": str(total),
                "items": items,
                "preview": preview_only,
            }
        )


class BillingPlanCheckView(APIView):
    permission_classes = [IsAuthenticated, IsCabinetTeacher]

    def post(self, request):
        data = request.data or {}
        student = get_object_or_404(Student, pk=data.get("student_id"), teacher=request.user)
        duration = int(data.get("duration_minutes") or 60)
        return Response(check_package_for_planning(request.user, student, duration))


class BillingReportsView(APIView):
    permission_classes = [IsAuthenticated, IsCabinetTeacher]

    def get(self, request):
        return Response(
            reports(
                request.user,
                date_from=_parse_dt(request.query_params.get("from")),
                date_to=_parse_dt(request.query_params.get("to")),
            )
        )


class BillingExportView(APIView):
    permission_classes = [IsAuthenticated, IsCabinetTeacher]

    def get(self, request):
        fmt = (request.query_params.get("format") or "csv").lower()
        date_from = _parse_dt(request.query_params.get("from"))
        date_to = _parse_dt(request.query_params.get("to"))
        if fmt == "xlsx":
            content = export_transactions_xlsx(
                request.user, date_from=date_from, date_to=date_to
            )
            resp = HttpResponse(
                content,
                content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
            resp["Content-Disposition"] = 'attachment; filename="billing.xlsx"'
            return resp
        content = export_transactions_csv(
            request.user, date_from=date_from, date_to=date_to
        )
        resp = HttpResponse(content, content_type="text/csv; charset=utf-8")
        resp["Content-Disposition"] = 'attachment; filename="billing.csv"'
        return resp


class BillingReminderPreviewView(APIView):
    permission_classes = [IsAuthenticated, IsCabinetTeacher]

    def post(self, request):
        data = request.data or {}
        account = get_object_or_404(
            BillingAccount, pk=data.get("account_id"), teacher=request.user
        )
        built = build_reminder_text(account, data.get("template") or "")
        return Response(
            {
                "text": built["text"],
                "amount": str(built["amount"]),
                "lessons_count": built["lessons_count"],
            }
        )


class BillingReminderSendView(APIView):
    permission_classes = [IsAuthenticated, IsCabinetTeacher]

    def post(self, request):
        data = request.data or {}
        account = get_object_or_404(
            BillingAccount, pk=data.get("account_id"), teacher=request.user
        )
        try:
            log = send_payment_reminder(
                teacher=request.user,
                account=account,
                message=data.get("message") or "",
                channel=data.get("channel") or "telegram",
            )
        except BillingError as exc:
            return _err(exc)
        return Response(
            {
                "ok": True,
                "id": log.id,
                "amount": str(log.amount),
                "created_at": log.created_at.isoformat(),
            }
        )


class BillingLegacyBackfillView(APIView):
    permission_classes = [IsAuthenticated, IsCabinetTeacher]

    def post(self, request):
        data = request.data or {}
        date_from = _parse_dt(data.get("from"))
        date_to = _parse_dt(data.get("to"))
        if not date_from or not date_to:
            return Response({"detail": "Укажите период from/to"}, status=400)
        if data.get("apply"):
            count = legacy_backfill_apply(
                request.user,
                data.get("record_ids") or [],
                financial_action=data.get("financial_action") or "charge",
            )
            return Response({"applied": count})
        return Response(legacy_backfill_preview(request.user, date_from, date_to))


class StudentBillingView(APIView):
    permission_classes = [IsAuthenticated, IsCabinetStudent]

    def get(self, request):
        return Response({"accounts": student_billing_view(request.user)})
