"""API кабинета родителя и приглашений из карточки ученика."""

from __future__ import annotations

import logging

from django.contrib.auth.models import User
from django.db.models import Prefetch, Q
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .choices import CommentVisibility, ParentInvitationStatus, ParentRelationshipStatus
from .journal_models import AttendanceStatus, RecordPublishStatus, StudentLessonRecord
from .journal_service import build_homework_result_payload, build_journal_entries_feed
from .models import Homework, HomeworkSubmission, Notification, Profile, ScheduleEvent, Student
from .parent_access import (
    ParentAccessError,
    active_relationships_qs,
    get_active_relationship,
    require_permission,
    serialize_child_card,
)
from .parent_invitations import (
    accept_parent_invitation,
    create_parent_invitation,
    get_invitation_by_raw_token,
    invitation_accept_path,
    invitation_is_valid,
    revoke_parent_access,
    revoke_parent_invitation,
    suspend_parent_access,
    update_parent_permissions,
    write_parent_audit,
)
from .parent_models import ParentInvitation, ParentStudentRelationship
from .permissions import IsCabinetParent, IsCabinetTeacher

logger = logging.getLogger(__name__)

_PARENT_HW_SAFE_KEYS = (
    "entry_type",
    "homework_id",
    "title",
    "description",
    "assigned_at",
    "due_at",
    "status",
    "status_label",
    "submitted_at",
    "score_percent",
    "score",
    "max_score",
    "teacher_comment",
    "has_attached_file",
    "has_variant",
    "checked_count",
    "correct_count",
    "attempt_count",
    "is_overdue",
    "review_type",
    "submission_id",
)


def _parent_homework_payload(homework, student) -> dict | None:
    """Результат ДЗ для родителя: без правильных ответов и сырого текста ответов."""
    payload = build_homework_result_payload(
        homework=homework,
        student=student,
        for_student=True,
    )
    if not payload:
        return None
    safe = {k: payload.get(k) for k in _PARENT_HW_SAFE_KEYS}
    # Попытки — только метаданные, без payload ответов
    attempts = []
    for a in payload.get("attempts") or []:
        if isinstance(a, dict):
            attempts.append(
                {
                    k: a.get(k)
                    for k in ("attempt_number", "status", "score", "submitted_at", "created_at")
                    if k in a
                }
            )
    safe["attempts"] = attempts
    safe["tasks"] = []
    safe["answer_text"] = ""
    return safe


def _filter_parent_journal_entries(entries: list, *, rel, include_comments: bool) -> list:
    """Только опубликованные уроки с visible_to_parent; без teacher review_url."""
    out = []
    for entry in entries or []:
        item = dict(entry)
        if item.get("entry_type") == "lesson":
            status_val = item.get("status")
            if status_val not in (
                RecordPublishStatus.PUBLISHED,
                RecordPublishStatus.EDITED_AFTER_PUBLISH,
                "published",
                "edited_after_publish",
            ):
                continue
            # По умолчанию записи скрыты от родителя, пока учитель явно не откроет.
            if item.get("visible_to_parent") is not True:
                continue
            if not include_comments or not rel.has_permission("view_comments"):
                item["comment"] = ""
            elif item.get("comment_visibility") != CommentVisibility.STUDENT_AND_PARENT:
                item["comment"] = ""
        item.pop("private_note", None)
        item.pop("review_url", None)
        # Не отдаём детальные tasks/correct answers в ленте родителя
        if item.get("entry_type") == "homework":
            item["tasks"] = []
            item.pop("answer_text", None)
        out.append(item)
    return out


def _error(exc: Exception):
    if isinstance(exc, ParentAccessError):
        return Response({"error": str(exc), "code": exc.code}, status=exc.status)
    if isinstance(exc, PermissionError):
        return Response({"error": str(exc)}, status=403)
    if isinstance(exc, ValueError):
        return Response({"error": str(exc)}, status=400)
    logger.exception("parent api error")
    return Response({"error": "Внутренняя ошибка"}, status=500)


def _serialize_invitation(inv: ParentInvitation, *, raw_token: str | None = None) -> dict:
    display_status = inv.status
    if inv.status == ParentInvitationStatus.PENDING and inv.expires_at and inv.expires_at < timezone.now():
        display_status = ParentInvitationStatus.EXPIRED
    data = {
        "id": inv.id,
        "student_id": inv.student_id,
        "invited_name": inv.invited_name,
        "invited_email": inv.invited_email,
        "invited_phone": inv.invited_phone,
        "relationship_type": inv.relationship_type,
        "status": display_status,
        "permissions": inv.permissions or {},
        "expires_at": inv.expires_at.isoformat() if inv.expires_at else None,
        "accepted_at": inv.accepted_at.isoformat() if inv.accepted_at else None,
        "revoked_at": inv.revoked_at.isoformat() if inv.revoked_at else None,
        "created_at": inv.created_at.isoformat() if inv.created_at else None,
        "short_code": inv.short_code,
        "accept_path": invitation_accept_path(raw_token) if raw_token else None,
        "invite_url": None,
    }
    if raw_token:
        data["token"] = raw_token
        data["invite_url"] = invitation_accept_path(raw_token)
    return data


def _serialize_relationship(rel: ParentStudentRelationship) -> dict:
    parent = rel.parent
    profile = getattr(parent, "profile", None)
    return {
        "id": rel.id,
        "parent_id": parent.id,
        "parent_name": profile.get_display_name() if profile else parent.get_username(),
        "parent_email": parent.email or "",
        "relationship_type": rel.relationship_type,
        "relationship_type_label": rel.get_relationship_type_display(),
        "status": rel.status,
        "permissions": rel.permissions or {},
        "confirmed_at": rel.confirmed_at.isoformat() if rel.confirmed_at else None,
        "last_activity_at": rel.last_activity_at.isoformat() if rel.last_activity_at else None,
        "revoked_at": rel.revoked_at.isoformat() if rel.revoked_at else None,
    }


# ── Teacher: parents block on student card ───────────────────────────────────


class StudentParentsAccessView(APIView):
    permission_classes = [IsAuthenticated, IsCabinetTeacher]

    def get(self, request, student_id: int):
        student = Student.objects.filter(pk=student_id, teacher=request.user).first()
        if not student:
            return Response({"error": "Ученик не найден"}, status=404)
        relationships = (
            ParentStudentRelationship.objects.filter(student=student)
            .select_related("parent", "parent__profile")
            .order_by("-created_at")
        )
        invitations = (
            ParentInvitation.objects.filter(student=student)
            .order_by("-created_at")[:50]
        )
        return Response(
            {
                "student_id": student.id,
                "student_name": student.full_name,
                "relationships": [_serialize_relationship(r) for r in relationships],
                "invitations": [_serialize_invitation(i) for i in invitations],
            }
        )


class StudentParentInviteCreateView(APIView):
    permission_classes = [IsAuthenticated, IsCabinetTeacher]

    def post(self, request, student_id: int):
        student = Student.objects.filter(pk=student_id, teacher=request.user).first()
        if not student:
            return Response({"error": "Ученик не найден"}, status=404)
        data = request.data if isinstance(request.data, dict) else {}
        try:
            invitation, raw_token = create_parent_invitation(
                request.user,
                student,
                invited_name=data.get("invited_name") or data.get("name") or "",
                invited_email=data.get("invited_email") or data.get("email") or "",
                invited_phone=data.get("invited_phone") or data.get("phone") or "",
                relationship_type=data.get("relationship_type") or "other",
                permissions=data.get("permissions"),
                expires_days=int(data.get("expires_days") or 7),
            )
        except Exception as exc:
            return _error(exc)
        return Response(_serialize_invitation(invitation, raw_token=raw_token), status=201)


class StudentParentInviteRevokeView(APIView):
    permission_classes = [IsAuthenticated, IsCabinetTeacher]

    def post(self, request, student_id: int, invitation_id: int):
        invitation = ParentInvitation.objects.filter(
            pk=invitation_id, student_id=student_id, student__teacher=request.user
        ).first()
        if not invitation:
            return Response({"error": "Приглашение не найдено"}, status=404)
        try:
            revoke_parent_invitation(request.user, invitation)
        except Exception as exc:
            return _error(exc)
        return Response(_serialize_invitation(invitation))


class StudentParentAccessUpdateView(APIView):
    permission_classes = [IsAuthenticated, IsCabinetTeacher]

    def patch(self, request, student_id: int, relationship_id: int):
        rel = ParentStudentRelationship.objects.filter(
            pk=relationship_id, student_id=student_id, student__teacher=request.user
        ).first()
        if not rel:
            return Response({"error": "Связь не найдена"}, status=404)
        data = request.data if isinstance(request.data, dict) else {}
        try:
            if "permissions" in data:
                update_parent_permissions(request.user, rel, data.get("permissions") or {})
            action = (data.get("action") or "").strip()
            if action == "revoke":
                revoke_parent_access(request.user, rel)
            elif action == "suspend":
                suspend_parent_access(request.user, rel)
            elif action == "activate" and rel.status in (
                ParentRelationshipStatus.SUSPENDED,
                ParentRelationshipStatus.REVOKED,
            ):
                rel.status = ParentRelationshipStatus.ACTIVE
                rel.revoked_at = None
                rel.save(update_fields=["status", "revoked_at", "updated_at"])
                write_parent_audit(
                    actor=request.user,
                    action="access_activated",
                    student=rel.student,
                    relationship=rel,
                )
        except Exception as exc:
            return _error(exc)
        rel.refresh_from_db()
        return Response(_serialize_relationship(rel))


# ── Public invite accept ─────────────────────────────────────────────────────


class ParentInvitePreviewView(APIView):
    permission_classes = [AllowAny]

    def get(self, request, token: str):
        invitation = get_invitation_by_raw_token(token)
        if not invitation:
            return Response({"error": "Ссылка недействительна", "code": "invalid"}, status=404)
        if invitation.status == ParentInvitationStatus.ACCEPTED:
            return Response({"error": "Ссылка уже использована", "code": "used", "status": "accepted"}, status=410)
        if invitation.status == ParentInvitationStatus.REVOKED:
            return Response({"error": "Приглашение отозвано", "code": "revoked"}, status=410)
        if not invitation_is_valid(invitation):
            return Response({"error": "Срок действия ссылки истёк", "code": "expired"}, status=410)

        student = invitation.student
        teacher = invitation.created_by
        teacher_profile = getattr(teacher, "profile", None)
        return Response(
            {
                "status": "pending",
                "student_name": student.full_name,
                "teacher_name": teacher_profile.get_display_name() if teacher_profile else teacher.get_username(),
                "relationship_type": invitation.relationship_type,
                "relationship_type_label": invitation.get_relationship_type_display(),
                "permissions": invitation.permissions or {},
                "expires_at": invitation.expires_at.isoformat() if invitation.expires_at else None,
                "invited_name": invitation.invited_name,
            }
        )


class ParentInviteAcceptView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, token: str):
        invitation = get_invitation_by_raw_token(token)
        if not invitation:
            return Response({"error": "Ссылка недействительна", "code": "invalid"}, status=404)
        try:
            rel = accept_parent_invitation(request.user, invitation)
        except ValueError as exc:
            return Response({"error": str(exc)}, status=400)
        except Exception as exc:
            return _error(exc)

        # Notify teacher
        try:
            from .webpush import notify_user_channels

            notify_user_channels(
                invitation.created_by,
                title="Родитель подключился",
                message=f"К ученику {invitation.student.full_name} подключён родительский доступ.",
                payload={
                    "type": "parent_access_connected",
                    "event_type": "parent_access_connected",
                    "student_id": invitation.student_id,
                    "parent_id": request.user.id,
                    "url": f"/cabinet/students?student={invitation.student_id}",
                },
                push_priority="important",
                tag=f"parent-access-{rel.id}",
                dedup_key=f"parent_access_connected:{rel.id}",
            )
        except Exception:
            logger.exception("parent accept notify failed")

        return Response(
            {
                "ok": True,
                "relationship": _serialize_relationship(rel),
                "redirect": "/cabinet/parent",
            }
        )


# ── Parent cabinet ───────────────────────────────────────────────────────────


class ParentChildrenView(APIView):
    permission_classes = [IsAuthenticated, IsCabinetParent]

    def get(self, request):
        rels = active_relationships_qs(request.user)
        return Response({"children": [serialize_child_card(r) for r in rels]})


class ParentDashboardView(APIView):
    permission_classes = [IsAuthenticated, IsCabinetParent]

    def get(self, request):
        student_id = request.query_params.get("student_id")
        if student_id:
            try:
                rel = get_active_relationship(request.user, int(student_id))
            except (TypeError, ValueError):
                return Response({"error": "Некорректный student_id"}, status=400)
            except ParentAccessError as exc:
                return _error(exc)
            rels = list(active_relationships_qs(request.user))
        else:
            rels = list(active_relationships_qs(request.user))
            if not rels:
                return Response(
                    {
                        "children": [],
                        "empty_reason": "no_children",
                        "message": "К вашему аккаунту пока не привязан ученик. Приглашение отправляет преподаватель или администратор из карточки ученика.",
                    }
                )
            rel = rels[0]
        student = rel.student
        now = timezone.now()

        next_lesson = None
        if rel.has_permission("view_schedule"):
            event = (
                ScheduleEvent.objects.filter(
                    owner=student.teacher_id,
                    starts_at__gte=now,
                )
                .filter(Q(student=student) | Q(group__students=student))
                .exclude(status__in=["cancelled", "draft"])
                .select_related("group")
                .order_by("starts_at")
                .first()
            )
            if event:
                next_lesson = {
                    "id": event.id,
                    "title": event.title or event.topic or "Урок",
                    "starts_at": event.starts_at.isoformat(),
                    "ends_at": event.ends_at.isoformat() if event.ends_at else None,
                    "format": event.format,
                    "status": event.status,
                    "teacher_name": serialize_child_card(rel)["teachers"][0]["name"],
                }

        homework_attention = []
        if rel.has_permission("view_homework"):
            hw_qs = (
                Homework.objects.filter(teacher=student.teacher_id)
                .filter(Q(student=student) | Q(group__students=student))
                .exclude(status="draft")
                .distinct()
                .order_by("-created_at")[:30]
            )
            for hw in hw_qs:
                payload = _parent_homework_payload(hw, student)
                if not payload:
                    continue
                st = payload.get("status")
                if st in {"not_submitted", "overdue", "submitted", "returned", "needs_revision"} or payload.get("is_overdue"):
                    homework_attention.append(
                        {
                            **{k: payload.get(k) for k in (
                                "homework_id", "title", "due_at", "status", "status_label",
                                "score_percent", "is_overdue", "submitted_at", "attempt_count", "teacher_comment",
                            )},
                            "badge": "ДЗ",
                        }
                    )
                if len(homework_attention) >= 8:
                    break

        recent_results = []
        if rel.has_permission("view_results") or rel.has_permission("view_journal"):
            feed = build_journal_entries_feed(
                student.teacher,
                student_id=student.id,
                limit=12,
            )
            recent_results = _filter_parent_journal_entries(
                feed.get("entries") or [],
                rel=rel,
                include_comments=rel.has_permission("view_comments"),
            )

        attendance = None
        if rel.has_permission("view_attendance"):
            records = StudentLessonRecord.objects.filter(
                student=student,
                journal__teacher=student.teacher_id,
                publish_status__in=[
                    RecordPublishStatus.PUBLISHED,
                    RecordPublishStatus.EDITED_AFTER_PUBLISH,
                ],
            ).exclude(attendance_status=AttendanceStatus.NOT_MARKED)
            total = records.count()
            present_like = records.filter(
                attendance_status__in=[
                    AttendanceStatus.PRESENT,
                    AttendanceStatus.LATE,
                    AttendanceStatus.LEFT_EARLY,
                    AttendanceStatus.PARTIAL,
                ]
            ).count()
            cancelled = records.filter(
                attendance_status__in=[
                    AttendanceStatus.CANCELLED_BY_TEACHER,
                    AttendanceStatus.TECHNICAL_ISSUE,
                ]
            ).count()
            denom = max(total - cancelled, 0)
            attendance = {
                "total": total,
                "present_like": present_like,
                "cancelled_excluded": cancelled,
                "rate_percent": round(present_like * 100 / denom, 1) if denom else None,
            }

        billing = None
        if rel.has_permission("view_billing"):
            billing = _parent_billing_payload(student, rel)

        notifications = []
        if rel.has_permission("receive_notifications"):
            notifications = list(
                Notification.objects.filter(recipient_user=request.user)
                .order_by("-created_at")[:8]
                .values("id", "title", "message", "is_read", "created_at", "event_type", "payload")
            )
            for n in notifications:
                if n.get("created_at"):
                    n["created_at"] = n["created_at"].isoformat()

        return Response(
            {
                "children": [serialize_child_card(r) for r in rels],
                "active_child": serialize_child_card(rel),
                "next_lesson": next_lesson,
                "homework_attention": homework_attention,
                "recent_results": recent_results[:10],
                "attendance": attendance,
                "billing": billing,
                "notifications": notifications,
            }
        )


def _parent_billing_payload(student: Student, rel: ParentStudentRelationship) -> dict | None:
    from .billing_models import TeacherBillingSettings
    from .billing_service import get_or_create_account, serialize_account

    teacher_settings = TeacherBillingSettings.objects.filter(teacher_id=student.teacher_id).first()
    teacher_allows = bool(teacher_settings and teacher_settings.show_billing_to_parent)
    invite_allows = rel.has_permission("view_billing")
    if not (teacher_allows or invite_allows):
        return {"allowed": False, "reason": "disabled_by_teacher"}
    if not teacher_allows and invite_allows:
        # invite can enable only if teacher also allows globally OR we honour invite override
        # Product: invite permission is enough when teacher set it at invite time.
        pass
    account = get_or_create_account(student.teacher, student)
    data = serialize_account(account, include_history=True)
    return {"allowed": True, "account": data}


class ParentHomeworkView(APIView):
    permission_classes = [IsAuthenticated, IsCabinetParent]

    def get(self, request):
        try:
            rel = get_active_relationship(request.user, int(request.query_params["student_id"]))
            require_permission(rel, "view_homework")
        except (KeyError, ValueError, ParentAccessError) as exc:
            return _error(exc if isinstance(exc, ParentAccessError) else ParentAccessError("Укажите student_id"))
        student = rel.student
        hw_qs = (
            Homework.objects.filter(teacher=student.teacher_id)
            .filter(Q(student=student) | Q(group__students=student))
            .exclude(status="draft")
            .distinct()
            .order_by("-created_at")[:100]
        )
        items = []
        for hw in hw_qs:
            payload = _parent_homework_payload(hw, student)
            if payload:
                items.append(payload)
        return Response({"items": items})


class ParentJournalView(APIView):
    permission_classes = [IsAuthenticated, IsCabinetParent]

    def get(self, request):
        try:
            student_id = int(request.query_params["student_id"])
            rel = get_active_relationship(request.user, student_id)
            # Результаты требуют view_results; полный журнал — view_journal.
            want_results = request.query_params.get("results_only") in {"1", "true"}
            if want_results:
                require_permission(rel, "view_results")
            else:
                require_permission(rel, "view_journal")
        except (KeyError, ValueError, ParentAccessError) as exc:
            return _error(exc if isinstance(exc, (ParentAccessError,)) else ParentAccessError("Укажите student_id"))
        feed = build_journal_entries_feed(
            rel.student.teacher,
            student_id=rel.student.id,
            date_from=request.query_params.get("date_from"),
            date_to=request.query_params.get("date_to"),
            entry_type=request.query_params.get("entry_type"),
            homework_only=request.query_params.get("homework_only") in {"1", "true"},
            limit=int(request.query_params.get("limit") or 100),
        )
        feed["entries"] = _filter_parent_journal_entries(
            feed.get("entries") or [],
            rel=rel,
            include_comments=rel.has_permission("view_comments"),
        )
        return Response(feed)


class ParentScheduleView(APIView):
    permission_classes = [IsAuthenticated, IsCabinetParent]

    def get(self, request):
        try:
            rel = get_active_relationship(request.user, int(request.query_params["student_id"]))
            require_permission(rel, "view_schedule")
        except (KeyError, ValueError, ParentAccessError) as exc:
            return _error(exc if isinstance(exc, ParentAccessError) else ParentAccessError("Укажите student_id"))
        student = rel.student
        events = (
            ScheduleEvent.objects.filter(owner=student.teacher_id)
            .filter(Q(student=student) | Q(group__students=student))
            .exclude(status="draft")
            .order_by("starts_at")[:80]
        )
        return Response(
            {
                "items": [
                    {
                        "id": e.id,
                        "title": e.title or e.topic or "Урок",
                        "starts_at": e.starts_at.isoformat(),
                        "ends_at": e.ends_at.isoformat() if e.ends_at else None,
                        "status": e.status,
                        "format": e.format,
                        "can_join_video": False,
                    }
                    for e in events
                ]
            }
        )


class ParentBillingView(APIView):
    permission_classes = [IsAuthenticated, IsCabinetParent]

    def get(self, request):
        try:
            rel = get_active_relationship(request.user, int(request.query_params["student_id"]))
            require_permission(rel, "view_billing")
        except (KeyError, ValueError, ParentAccessError) as exc:
            return _error(exc if isinstance(exc, ParentAccessError) else ParentAccessError("Укажите student_id"))
        payload = _parent_billing_payload(rel.student, rel)
        if not payload or not payload.get("allowed"):
            return Response({"allowed": False, "reason": "disabled_by_teacher"})
        return Response(payload)


class ParentPaymentClaimView(APIView):
    """Родитель уведомляет преподавателя, что оплата отправлена — проверить вручную."""

    permission_classes = [IsAuthenticated, IsCabinetParent]

    def post(self, request):
        data = request.data if isinstance(request.data, dict) else {}
        try:
            rel = get_active_relationship(request.user, int(data.get("student_id")))
            require_permission(rel, "view_billing")
        except (TypeError, ValueError, ParentAccessError) as exc:
            return _error(exc if isinstance(exc, ParentAccessError) else ParentAccessError("Укажите student_id"))

        student = rel.student
        teacher = student.teacher
        amount = data.get("amount")
        note = (data.get("note") or data.get("message") or "").strip()[:500]
        parent_profile = getattr(request.user, "profile", None)
        parent_name = parent_profile.get_display_name() if parent_profile else request.user.get_username()

        from .models import NotificationPreference
        from .webpush import notify_user_channels

        prefs, _ = NotificationPreference.objects.get_or_create(user=teacher)
        if not getattr(prefs, "notify_payment_claim", True):
            return Response({"ok": True, "delivered": False, "reason": "teacher_disabled"})

        amount_part = f" на сумму {amount}" if amount not in (None, "") else ""
        title = "Родитель сообщил об оплате"
        message = (
            f"{parent_name} просит проверить оплату по ученику {student.full_name}{amount_part}."
            + (f"\nКомментарий: {note}" if note else "")
        )
        notify_user_channels(
            teacher,
            title=title,
            message=message,
            payload={
                "type": "billing_payment_claim",
                "event_type": "billing_payment_claim",
                "student_id": student.id,
                "parent_id": request.user.id,
                "amount": amount,
                "note": note,
                "url": f"/cabinet/payments?student={student.id}",
            },
            push_priority="important",
            tag=f"payment-claim-{student.id}-{timezone.now().strftime('%Y%m%d%H')}",
            dedup_key=f"billing_payment_claim:{student.id}:{request.user.id}:{timezone.now().strftime('%Y%m%d%H')}",
        )
        write_parent_audit(
            actor=request.user,
            action="payment_claim",
            student=student,
            relationship=rel,
            meta={"amount": amount, "note": note},
        )
        return Response({"ok": True, "delivered": True})
