from django.db.models import Count, Prefetch, Q
from django.core.files.storage import default_storage
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .choices import (
    EnrollmentStatus,
    GroupStatus,
    InvitationStatus,
    PlanItemStatus,
    PlanStatus,
    ReviewStatus,
    StudentStatus,
    StudentSubjectStatus,
    SubmissionStatus,
)
from .subscription_service import LimitExceeded, SubscriptionLimitService
from .plan_catalog import can_publish_catalog_lesson_plan
from .plan_levels import get_plan_level_options
from .plan_subjects import get_plan_subject_options
from .invitations import (
    accept_student_invitation,
    create_student_invitation,
    get_invitation_by_token,
    invite_accept_api_payload,
    invitation_preview_payload,
    mark_expired_invitations,
    resolve_invitation_for_user,
)
from .models import (
    DirectMaterialAssignment,
    Homework,
    HomeworkSubmission,
    Interactive,
    InteractiveAssignment,
    InteractiveAttempt,
    InteractiveBackground,
    InteractiveCardStyle,
    InteractiveSoundPack,
    Lesson,
    LessonAssignment,
    LessonPlan,
    LessonPlanEnrollment,
    LessonPlanItem,
    Material,
    ReviewItem,
    ScheduleEvent,
    Student,
    StudentGroup,
    StudentInvitation,
    StudentSubject,
    TeacherSavedMaterial,
)
from .student_subjects import (
    archive_student_subject,
    student_subject_has_history,
    subjects_compatible,
)
from .permissions import IsCabinetTeacher
from .serializers import (
    DashboardSerializer,
    HomeworkDetailSerializer,
    HomeworkListSerializer,
    HomeworkSubmissionSerializer,
    InteractiveAssignmentSerializer,
    InteractiveAttemptSerializer,
    InteractiveBackgroundSerializer,
    InteractiveCardStyleSerializer,
    InteractiveDetailSerializer,
    InteractiveListSerializer,
    InteractiveSoundPackSerializer,
    InteractiveWriteSerializer,
    LessonAssignmentSerializer,
    LessonDetailSerializer,
    LessonListSerializer,
    LessonPlanDetailSerializer,
    LessonPlanEnrollmentSerializer,
    LessonPlanEnrollmentWriteSerializer,
    LessonPlanItemEditorSerializer,
    LessonPlanItemSerializer,
    LessonPlanItemWriteSerializer,
    LessonPlanListSerializer,
    LessonPlanWriteSerializer,
    LessonWriteSerializer,
    MaterialDetailSerializer,
    MaterialListSerializer,
    MaterialWriteSerializer,
    ReviewItemSerializer,
    ScheduleEventSerializer,
    StudentDetailSerializer,
    StudentGroupDetailSerializer,
    StudentGroupListSerializer,
    StudentGroupWriteSerializer,
    StudentInvitationCreateSerializer,
    StudentInvitationSerializer,
    StudentListSerializer,
    StudentSubjectSerializer,
    StudentSubjectWriteSerializer,
    StudentWriteSerializer,
    build_dashboard_payload,
)


class TeacherScopedMixin:
    permission_classes = [IsCabinetTeacher]

    def get_teacher(self):
        return self.request.user

    def filter_by_teacher(self, qs):
        return qs.filter(teacher=self.get_teacher())


class StudentViewSet(TeacherScopedMixin, viewsets.ModelViewSet):
    http_method_names = ["get", "post", "put", "patch", "delete", "head", "options"]

    def get_queryset(self):
        qs = Student.objects.filter(teacher=self.get_teacher()).prefetch_related(
            "groups",
            "subjects",
        )
        # Detail/custom actions must see archived students (restore / permanent delete).
        if getattr(self, "action", None) != "list":
            return qs.order_by("last_name", "first_name")

        params = self.request.query_params

        direction = params.get("direction")
        if direction:
            qs = qs.filter(direction=direction)

        exam_type = params.get("exam_type")
        if exam_type:
            qs = qs.filter(groups__exam_type=exam_type)

        status_param = params.get("status")
        if status_param:
            qs = qs.filter(status=status_param)
        else:
            qs = qs.exclude(status=StudentStatus.ARCHIVED)

        group_id = params.get("group")
        if group_id:
            qs = qs.filter(groups__id=group_id)

        search = (params.get("search") or "").strip()
        if search:
            qs = qs.filter(
                Q(first_name__icontains=search)
                | Q(last_name__icontains=search)
                | Q(email__icontains=search)
            )

        return qs.distinct().order_by("last_name", "first_name")

    def get_serializer_class(self):
        if self.action == "retrieve":
            return StudentDetailSerializer
        if self.action in ("update", "partial_update"):
            return StudentWriteSerializer
        return StudentListSerializer

    def create(self, request, *args, **kwargs):
        return Response(
            {"detail": "Новых учеников добавляйте через приглашение."},
            status=status.HTTP_405_METHOD_NOT_ALLOWED,
        )

    def update(self, request, *args, **kwargs):
        partial = kwargs.pop("partial", False)
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(StudentListSerializer(instance).data)

    def destroy(self, request, *args, **kwargs):
        """Безвозвратное удаление ученика (со всеми связанными данными)."""
        student = self.get_object()
        student_id = student.pk
        student.delete()
        return Response({"ok": True, "deleted_id": student_id}, status=status.HTTP_200_OK)

    @action(detail=True, methods=["get", "post"], url_path="subjects")
    def subjects(self, request, pk=None):
        student = self.get_object()
        if request.method == "GET":
            include_archived = (request.query_params.get("include_archived") or "").lower() in (
                "1", "true", "yes",
            )
            qs = student.subjects.all().prefetch_related("plan_enrollments__plan")
            if not include_archived:
                qs = qs.filter(status=StudentSubjectStatus.ACTIVE)
            return Response(
                StudentSubjectSerializer(qs.order_by("subject", "title", "id"), many=True).data
            )

        serializer = StudentSubjectWriteSerializer(
            data=request.data,
            context={"student": student, "request": request},
        )
        serializer.is_valid(raise_exception=True)
        plan_id = serializer.validated_data.pop("plan_id", None)
        subject = serializer.save(student=student)
        if plan_id:
            plan = get_object_or_404(LessonPlan, pk=plan_id)
            if plan.teacher_id not in (None, self.get_teacher().id) and plan.status != PlanStatus.PUBLISHED:
                return Response({"detail": "План не найден."}, status=status.HTTP_404_NOT_FOUND)
            if plan.status == PlanStatus.DRAFT:
                return Response(
                    {"detail": "Черновик плана нельзя назначить. Сначала опубликуйте план."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if not subjects_compatible(plan.subject, subject.subject):
                return Response(
                    {"detail": "Предмет плана не совпадает с предметом ученика."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            LessonPlanEnrollment.objects.create(
                teacher=self.get_teacher(),
                plan=plan,
                student=student,
                student_subject=subject,
                format="individual",
                status=EnrollmentStatus.ACTIVE,
            )
        return Response(
            StudentSubjectSerializer(subject).data,
            status=status.HTTP_201_CREATED,
        )

    @action(
        detail=True,
        methods=["get", "patch", "delete"],
        url_path=r"subjects/(?P<subject_id>[0-9]+)",
    )
    def subject_detail(self, request, pk=None, subject_id=None):
        student = self.get_object()
        subject = get_object_or_404(StudentSubject, pk=subject_id, student=student)
        if request.method == "GET":
            return Response(StudentSubjectSerializer(subject).data)

        if request.method == "DELETE":
            force = (request.query_params.get("force") or "").lower() in ("1", "true", "yes")
            if student_subject_has_history(subject) and not force:
                archive_student_subject(subject)
                return Response({
                    "ok": True,
                    "archived": True,
                    "detail": (
                        "По предмету есть связанные данные. Предмет переведён в архив; "
                        "история уроков и отчётов сохранена."
                    ),
                    "subject": StudentSubjectSerializer(subject).data,
                })
            if force and student_subject_has_history(subject):
                archive_student_subject(subject)
                return Response({
                    "ok": True,
                    "archived": True,
                    "subject": StudentSubjectSerializer(subject).data,
                })
            subject_id_val = subject.pk
            subject.delete()
            return Response({"ok": True, "deleted_id": subject_id_val})

        serializer = StudentSubjectWriteSerializer(
            subject,
            data=request.data,
            partial=True,
            context={"student": student, "request": request},
        )
        serializer.is_valid(raise_exception=True)
        serializer.validated_data.pop("plan_id", None)
        # plan_id is optional on patch; only handle if explicitly provided
        plan_provided = "plan_id" in request.data
        raw_plan = request.data.get("plan_id")
        subject = serializer.save()
        if plan_provided:
            if raw_plan in (None, "", 0, "0"):
                LessonPlanEnrollment.objects.filter(
                    student_subject=subject,
                    status__in=[EnrollmentStatus.ACTIVE, EnrollmentStatus.PAUSED],
                ).update(status=EnrollmentStatus.CANCELLED)
            else:
                plan = get_object_or_404(LessonPlan, pk=raw_plan)
                if plan.status == PlanStatus.DRAFT:
                    return Response(
                        {"detail": "Черновик плана нельзя назначить."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                if not subjects_compatible(plan.subject, subject.subject):
                    return Response(
                        {"detail": "Предмет плана не совпадает с предметом ученика."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                enrollment = LessonPlanEnrollment.objects.filter(
                    student_subject=subject,
                    status__in=[EnrollmentStatus.ACTIVE, EnrollmentStatus.PAUSED],
                ).first()
                if enrollment:
                    enrollment.plan = plan
                    enrollment.save(update_fields=["plan", "updated_at"])
                else:
                    LessonPlanEnrollment.objects.create(
                        teacher=self.get_teacher(),
                        plan=plan,
                        student=student,
                        student_subject=subject,
                        format="individual",
                        status=EnrollmentStatus.ACTIVE,
                    )
        return Response(StudentSubjectSerializer(subject).data)

    @action(detail=True, methods=["patch"], url_path="archive")
    def archive(self, request, pk=None):
        student = self.get_object()
        student.status = StudentStatus.ARCHIVED
        student.save(update_fields=["status", "updated_at"])
        # Скрываем из вкладки «Оплаты».
        from .billing_models import BillingAccount

        BillingAccount.objects.filter(student=student, teacher=self.get_teacher()).update(is_active=False)
        return Response(StudentDetailSerializer(student).data)

    @action(detail=True, methods=["patch"], url_path="restore")
    def restore(self, request, pk=None):
        student = self.get_object()
        student.status = StudentStatus.ACTIVE
        student.save(update_fields=["status", "updated_at"])
        from .billing_models import BillingAccount

        BillingAccount.objects.filter(student=student, teacher=self.get_teacher()).update(is_active=True)
        return Response(StudentDetailSerializer(student).data)

    @action(detail=True, methods=["get", "patch"], url_path="notify-settings")
    def notify_settings(self, request, pk=None):
        """Per-student notification overrides for the teacher."""
        from .models import StudentNotifyOverride

        student = self.get_object()
        override, _ = StudentNotifyOverride.objects.get_or_create(student=student)

        if request.method == "GET":
            return Response({
                "mode": override.mode,
                "notify_homework": override.notify_homework,
                "notify_messages": override.notify_messages,
                "notify_overdue": override.notify_overdue,
                "notify_billing": override.notify_billing,
                "notify_attendance": override.notify_attendance,
            })

        data = request.data or {}
        if "mode" in data:
            mode = str(data.get("mode") or "").strip()
            if mode not in StudentNotifyOverride.Mode.values:
                return Response({"error": "Некорректный режим"}, status=status.HTTP_400_BAD_REQUEST)
            override.mode = mode
        for field in (
            "notify_homework",
            "notify_messages",
            "notify_overdue",
            "notify_billing",
            "notify_attendance",
        ):
            if field not in data:
                continue
            raw = data.get(field)
            if raw is None or raw == "" or raw == "inherit":
                setattr(override, field, None)
            else:
                setattr(override, field, bool(raw))
        override.save()
        return Response({
            "ok": True,
            "mode": override.mode,
            "notify_homework": override.notify_homework,
            "notify_messages": override.notify_messages,
            "notify_overdue": override.notify_overdue,
            "notify_billing": override.notify_billing,
            "notify_attendance": override.notify_attendance,
        })

    @action(detail=True, methods=["get"], url_path="check-variant-tasks")
    def check_variant_tasks(self, request, pk=None):
        """GET /api/cabinet/students/{id}/check-variant-tasks/?variant_id=X
        Возвращает список Generator task ID, которые уже выдавались этому ученику
        и присутствуют в указанном варианте.
        """
        student = self.get_object()
        variant_id_raw = (request.query_params.get("variant_id") or "").strip()
        if not variant_id_raw or not variant_id_raw.isdigit():
            return Response({"error": "Передайте параметр variant_id"}, status=status.HTTP_400_BAD_REQUEST)

        from .student_release import check_variant_tasks_overlap

        duplicates = check_variant_tasks_overlap(student=student, variant_id=int(variant_id_raw))
        return Response({"duplicate_task_ids": duplicates})

    @action(detail=True, methods=["get"], url_path="homework-options")
    def homework_options(self, request, pk=None):
        """Пункты плана с ДЗ, доступные для выдачи ученику."""
        student = self.get_object()
        from .models import ScheduleEvent
        from .student_release import (
            _subject_for_event,
            homework_options_for_student,
            suggest_homework_due_at,
        )

        schedule_event_id = (
            request.query_params.get("schedule_event_id")
            or request.query_params.get("schedule_event")
        )
        ss_id = (
            request.query_params.get("student_subject_id")
            or request.query_params.get("student_subject")
        )
        event = None
        if schedule_event_id:
            event = ScheduleEvent.objects.filter(
                pk=schedule_event_id,
                owner=self.get_teacher(),
            ).select_related(
                "lesson_plan_item",
                "lesson_plan_item__plan",
                "student_subject",
            ).first()
            if event is not None and not ss_id and event.student_subject_id:
                ss_id = event.student_subject_id

        payload = homework_options_for_student(
            teacher=self.get_teacher(),
            student=student,
            student_subject_id=ss_id,
            schedule_event=event,
        )
        if event is not None:
            subject = _subject_for_event(event) or payload.get("plan_subject") or None
            suggested = suggest_homework_due_at(
                teacher=self.get_teacher(),
                student=student,
                subject=subject or None,
                after=event.ends_at or event.starts_at or timezone.now(),
                exclude_event_id=event.pk,
                group=event.group if event.group_id else None,
            )
            payload["suggested_due_at"] = suggested.isoformat() if suggested else None
            payload["suggested_due_source"] = "next_lesson" if suggested else None
            if subject:
                payload["plan_subject"] = subject
        return Response(payload)

    @action(detail=True, methods=["post"], url_path="assign-homework")
    def assign_homework(self, request, pk=None):
        """Выдать ДЗ ученику из плана или дополнительное задание."""
        student = self.get_object()
        from .models import ScheduleEvent
        from .student_release import (
            _normalize_subject,
            _subject_for_event,
            assign_custom_homework,
            assign_homework_manually,
            student_can_receive_plan_item_homework,
            suggest_homework_due_at,
        )

        due_at_raw = request.data.get("due_at")
        due_at = None
        if due_at_raw:
            due_at = parse_datetime(str(due_at_raw))
            if due_at is None:
                date_val = parse_date(str(due_at_raw))
                if date_val:
                    due_at = timezone.make_aware(
                        timezone.datetime.combine(date_val, timezone.datetime.min.time().replace(hour=23, minute=59)),
                        timezone.get_current_timezone(),
                    )
            elif timezone.is_naive(due_at):
                due_at = timezone.make_aware(due_at, timezone.get_current_timezone())

        schedule_event_id = request.data.get("schedule_event_id")
        after = timezone.now()
        exclude_event_id = None
        subject = None
        event = None
        ss_id = request.data.get("student_subject_id") or request.data.get("student_subject")
        if schedule_event_id:
            event = ScheduleEvent.objects.filter(
                pk=schedule_event_id,
                owner=self.get_teacher(),
            ).select_related(
                "lesson_plan_item",
                "lesson_plan_item__plan",
                "student_subject",
            ).first()
            if event is not None:
                after = event.ends_at or event.starts_at or after
                exclude_event_id = event.pk
                subject = _subject_for_event(event) or None
                if not ss_id and event.student_subject_id:
                    ss_id = event.student_subject_id

        plan_item_id = request.data.get("plan_item_id")
        try:
            if plan_item_id:
                plan_item = get_object_or_404(
                    LessonPlanItem.objects.select_related("plan"),
                    pk=plan_item_id,
                )
                if not student_can_receive_plan_item_homework(
                    teacher=self.get_teacher(),
                    student=student,
                    plan_item=plan_item,
                    student_subject_id=ss_id,
                ):
                    return Response(
                        {"detail": "Пункт не принадлежит плану, назначенному ученику."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                if due_at is None:
                    subject = subject or _normalize_subject(getattr(plan_item.plan, "subject", "") or "") or None
                    due_at = suggest_homework_due_at(
                        teacher=self.get_teacher(),
                        student=student,
                        subject=subject,
                        after=after,
                        exclude_event_id=exclude_event_id,
                    )
                homework = assign_homework_manually(
                    teacher=self.get_teacher(),
                    student=student,
                    plan_item=plan_item,
                    due_at=due_at,
                )
            else:
                if due_at is None:
                    due_at = suggest_homework_due_at(
                        teacher=self.get_teacher(),
                        student=student,
                        subject=subject,
                        after=after,
                        exclude_event_id=exclude_event_id,
                    )
                homework = assign_custom_homework(
                    teacher=self.get_teacher(),
                    student=student,
                    title=request.data.get("title"),
                    description=request.data.get("description", ""),
                    material_ids=request.data.get("material_ids"),
                    interactive_ids=request.data.get("interactive_ids"),
                    due_at=due_at,
                )
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except PermissionError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_403_FORBIDDEN)

        if ss_id:
            from .student_subjects import get_teacher_student_subject

            ss = get_teacher_student_subject(
                teacher=self.get_teacher(),
                student_subject_id=ss_id,
                student=student,
            )
            if ss is None:
                return Response(
                    {"detail": "Предмет не принадлежит выбранному ученику."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            homework.student_subject = ss
            homework.save(update_fields=["student_subject", "updated_at"])

        # Привязываем выдачу к уроку в расписании — иначе карточка урока не видит ДЗ.
        if event is not None and event.homework_id != homework.id:
            event.homework = homework
            event.save(update_fields=["homework", "updated_at"])

        from .serializers import HomeworkListSerializer

        return Response(HomeworkListSerializer(homework).data, status=status.HTTP_201_CREATED)


class StudentInvitationViewSet(TeacherScopedMixin, mixins.ListModelMixin, mixins.CreateModelMixin, mixins.DestroyModelMixin, viewsets.GenericViewSet):
    def get_queryset(self):
        mark_expired_invitations()
        qs = StudentInvitation.objects.filter(teacher=self.get_teacher()).select_related("group")
        status_param = self.request.query_params.get("status")
        if status_param:
            qs = qs.filter(status=status_param)
        else:
            qs = qs.filter(status=InvitationStatus.PENDING)
        group_id = self.request.query_params.get("group")
        if group_id:
            qs = qs.filter(group_id=group_id)
        return qs.order_by("-created_at")

    def get_serializer_class(self):
        if self.action == "create":
            return StudentInvitationCreateSerializer
        return StudentInvitationSerializer

    def create(self, request, *args, **kwargs):
        # Проверяем лимит учеников перед созданием приглашения
        try:
            SubscriptionLimitService.raise_if_student_limit_reached(self.get_teacher())
        except LimitExceeded as exc:
            return Response(exc.to_dict(), status=status.HTTP_403_FORBIDDEN)

        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        group = None
        group_id = data.get("group_id")
        if group_id:
            group = get_object_or_404(StudentGroup, pk=group_id, teacher=self.get_teacher())

        try:
            invitation = create_student_invitation(
                self.get_teacher(),
                group=group,
                first_name=data.get("first_name") or "",
                last_name=data.get("last_name") or "",
                email=data.get("email") or "",
                direction=data.get("direction") or "other",
                grade=data.get("grade"),
                message=data.get("message") or "",
            )
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        return Response(
            StudentInvitationSerializer(invitation).data,
            status=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=["post"], url_path="cancel")
    def cancel(self, request, pk=None):
        invitation = get_object_or_404(
            StudentInvitation,
            pk=pk,
            teacher=self.get_teacher(),
            status=InvitationStatus.PENDING,
        )
        invitation.status = InvitationStatus.CANCELLED
        invitation.save(update_fields=["status", "updated_at"])
        return Response(StudentInvitationSerializer(invitation).data)

    def destroy(self, request, pk=None):
        """Hard-delete an invitation (any status). Also removes unregistered pre-profile student."""
        invitation = get_object_or_404(
            StudentInvitation,
            pk=pk,
            teacher=self.get_teacher(),
        )
        # Remove unregistered pre-profile student if still unlinked
        if invitation.pre_student_id:
            try:
                pre = invitation.pre_student
                if pre and pre.user_id is None:
                    pre.delete()
            except Exception:
                pass
        invitation.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class InvitationPreviewView(APIView):
    permission_classes = [AllowAny]

    def get(self, request, token):
        user = request.user if request.user.is_authenticated else None
        payload = resolve_invitation_for_user(token, user)
        if payload is None:
            return Response({"error": "Приглашение недействительно или истекло."}, status=404)
        return Response(payload)


class InvitationAcceptView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, token):
        try:
            student, invitation = accept_student_invitation(token, request.user)
        except ValueError as exc:
            return Response({"error": str(exc)}, status=400)
        return Response(invite_accept_api_payload(student, invitation, request.user))


class StudentGroupViewSet(TeacherScopedMixin, viewsets.ModelViewSet):
    def get_queryset(self):
        qs = StudentGroup.objects.filter(teacher=self.get_teacher()).annotate(
            students_count=Count(
                "students",
                filter=~Q(students__status=StudentStatus.ARCHIVED),
            )
        )
        # Detail/update must see archived groups (restore from archive).
        if getattr(self, "action", None) != "list":
            return qs.prefetch_related(
                Prefetch(
                    "students",
                    queryset=Student.objects.exclude(status=StudentStatus.ARCHIVED).order_by(
                        "last_name", "first_name"
                    ),
                )
            ).order_by("title")

        params = self.request.query_params

        direction = params.get("direction")
        if direction:
            qs = qs.filter(direction=direction)

        exam_type = params.get("exam_type")
        if exam_type:
            qs = qs.filter(exam_type=exam_type)

        status_param = params.get("status")
        if status_param:
            qs = qs.filter(status=status_param)
        else:
            qs = qs.exclude(status=GroupStatus.ARCHIVED)

        search = (params.get("search") or "").strip()
        if search:
            qs = qs.filter(title__icontains=search)

        return qs.prefetch_related(
            Prefetch(
                "students",
                queryset=Student.objects.exclude(status=StudentStatus.ARCHIVED).order_by(
                    "last_name", "first_name"
                ),
            )
        ).order_by("title")

    def get_serializer_class(self):
        if self.action == "retrieve":
            return StudentGroupDetailSerializer
        if self.action in ("create", "update", "partial_update"):
            return StudentGroupWriteSerializer
        return StudentGroupListSerializer

    def perform_create(self, serializer):
        serializer.save(teacher=self.get_teacher())

    def create(self, request, *args, **kwargs):
        try:
            SubscriptionLimitService.raise_if_group_limit_reached(self.get_teacher())
        except LimitExceeded as exc:
            return Response(exc.to_dict(), status=status.HTTP_403_FORBIDDEN)

        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        group = StudentGroup.objects.filter(pk=serializer.instance.pk).annotate(
            students_count=Count(
                "students",
                filter=~Q(students__status=StudentStatus.ARCHIVED),
            )
        ).first()
        return Response(StudentGroupListSerializer(group).data, status=status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        partial = kwargs.pop("partial", False)
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        group = StudentGroup.objects.filter(pk=instance.pk).annotate(
            students_count=Count(
                "students",
                filter=~Q(students__status=StudentStatus.ARCHIVED),
            )
        ).first()
        return Response(StudentGroupListSerializer(group).data)

    @action(detail=True, methods=["post"], url_path="add-student")
    def add_student(self, request, pk=None):
        group = self.get_object()
        student_id = request.data.get("student_id")
        student = get_object_or_404(Student, pk=student_id, teacher=self.get_teacher())
        if student.status == StudentStatus.ARCHIVED:
            return Response(
                {"detail": "Нельзя добавить ученика из архива."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        group.students.add(student)
        return Response(StudentGroupDetailSerializer(group).data)

    @action(detail=True, methods=["post"], url_path="remove-student")
    def remove_student(self, request, pk=None):
        group = self.get_object()
        student_id = request.data.get("student_id")
        student = get_object_or_404(Student, pk=student_id, teacher=self.get_teacher())
        group.students.remove(student)
        return Response(StudentGroupDetailSerializer(group).data)


class LessonViewSet(TeacherScopedMixin, viewsets.ModelViewSet):
    def get_queryset(self):
        from .choices import LessonStatus

        qs = Lesson.objects.filter(teacher=self.get_teacher())
        params = self.request.query_params
        status_value = params.get("status")
        if status_value:
            qs = qs.filter(status=status_value)
        else:
            # Служебные уроки автоматериалов занятия создаются как archived —
            # не показываем их в списке/библиотеке по умолчанию.
            qs = qs.exclude(status=LessonStatus.ARCHIVED)
        for field in ("direction", "exam_type", "lesson_type"):
            value = params.get(field)
            if value:
                qs = qs.filter(**{field: value})
        search = (params.get("search") or "").strip()
        if search:
            qs = qs.filter(Q(title__icontains=search) | Q(topic__icontains=search))
        return qs.order_by("-updated_at")

    def get_serializer_class(self):
        if self.action == "retrieve":
            return LessonDetailSerializer
        if self.action in ("create", "update", "partial_update"):
            return LessonWriteSerializer
        return LessonListSerializer

    def create(self, request, *args, **kwargs):
        try:
            SubscriptionLimitService.raise_if_lesson_limit_reached(self.get_teacher())
        except LimitExceeded as exc:
            return Response(exc.to_dict(), status=status.HTTP_403_FORBIDDEN)
        return super().create(request, *args, **kwargs)

    def perform_create(self, serializer):
        serializer.save(teacher=self.get_teacher())

    @action(detail=True, methods=["post"], url_path="assign")
    def assign(self, request, pk=None):
        lesson = self.get_object()
        data = {**request.data, "lesson": lesson.pk}
        serializer = LessonAssignmentSerializer(data=data)
        serializer.is_valid(raise_exception=True)
        assignment = serializer.save(teacher=self.get_teacher())
        return Response(LessonAssignmentSerializer(assignment).data, status=status.HTTP_201_CREATED)


def _copy_lesson_plan(source, teacher):
    """Создаёт личную копию плана (обычно из публичного каталога)."""
    new_plan = LessonPlan.objects.create(
        teacher=teacher,
        title=source.title,
        description=source.description,
        goal=source.goal,
        direction=source.direction,
        subject=source.subject,
        exam_type=source.exam_type,
        grade=source.grade,
        lessons_count=0,
        status=PlanStatus.DRAFT,
    )
    teacher_interactive_ids = set(
        Interactive.objects.filter(teacher=teacher).values_list("pk", flat=True)
    )
    for item in source.items.all().order_by("order", "id"):
        new_item = LessonPlanItem.objects.create(
            plan=new_plan,
            order=item.order,
            title=item.title,
            topic=item.topic,
            subtopic=item.subtopic,
            task_number=item.task_number,
            goal=item.goal,
            planned_results=item.planned_results,
            description=item.description,
            lesson_materials_notes=item.lesson_materials_notes,
            homework_description=item.homework_description,
            status=PlanItemStatus.NOT_STARTED,
        )
        new_item.materials.set(item.materials.all())
        new_item.homework_materials.set(item.homework_materials.all())
        new_item.attached_interactives.set(
            item.attached_interactives.filter(pk__in=teacher_interactive_ids)
        )
        new_item.homework_interactives.set(
            item.homework_interactives.filter(pk__in=teacher_interactive_ids)
        )
    new_plan.lessons_count = new_plan.items.count()
    new_plan.save(update_fields=["lessons_count", "updated_at"])
    return new_plan


class LessonPlanViewSet(TeacherScopedMixin, viewsets.ModelViewSet):
    def get_queryset(self):
        teacher = self.get_teacher()
        # Личные планы учителя + общедоступные (teacher=None)
        qs = LessonPlan.objects.filter(
            Q(teacher=teacher) | Q(teacher__isnull=True)
        ).exclude(
            # Служебные черновики под материалы урока «вне плана» — не в списке планов.
            description="Автосоздано для материалов занятия",
        ).annotate(items_count=Count("items")).prefetch_related(
            Prefetch(
                "items",
                queryset=LessonPlanItem.objects.select_related(
                    "linked_lesson",
                    "scheduled_event",
                ).prefetch_related(
                    "materials",
                    "attached_interactives",
                    "homework_materials",
                    "homework_interactives",
                ).order_by("order", "id"),
            )
        )
        status_param = self.request.query_params.get("status")
        if status_param:
            qs = qs.filter(status=status_param)
        if self.request.query_params.get("catalog") == "true":
            qs = qs.filter(teacher__isnull=True, status=PlanStatus.PUBLISHED)
        elif self.request.query_params.get("mine") == "true":
            qs = qs.filter(teacher=teacher)
        return qs.order_by("-updated_at")

    def get_serializer_class(self):
        if self.action == "retrieve":
            return LessonPlanDetailSerializer
        if self.action in ("create", "update", "partial_update"):
            return LessonPlanWriteSerializer
        return LessonPlanListSerializer

    def perform_create(self, serializer):
        is_public = serializer.validated_data.pop("is_public", False)
        teacher = self.get_teacher()
        if is_public and not can_publish_catalog_lesson_plan(teacher):
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied("Нет прав на публикацию шаблона в каталог.")
        if is_public:
            plan = serializer.save(teacher=None, status=PlanStatus.PUBLISHED)
        else:
            plan = serializer.save(teacher=teacher)
        return plan

    def perform_update(self, serializer):
        is_public = serializer.validated_data.pop("is_public", None)
        teacher = self.get_teacher()
        if is_public is True and not can_publish_catalog_lesson_plan(teacher):
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied("Нет прав на публикацию шаблона в каталог.")
        plan = serializer.instance
        if is_public is True:
            serializer.save(teacher=None, status=PlanStatus.PUBLISHED)
        elif is_public is False and plan.teacher is None:
            serializer.save(teacher=teacher, status=PlanStatus.DRAFT)
        else:
            serializer.save()

    def update(self, request, *args, **kwargs):
        plan = self.get_object()
        publisher = can_publish_catalog_lesson_plan(self.get_teacher())
        if plan.teacher is None:
            if not publisher:
                return Response(
                    {"detail": "Публичный план нельзя изменить. Сделайте копию для редактирования."},
                    status=status.HTTP_403_FORBIDDEN,
                )
        elif plan.teacher_id != self.get_teacher().id:
            return Response({"detail": "Нет доступа."}, status=status.HTTP_403_FORBIDDEN)
        return super().update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        plan = self.get_object()
        publisher = can_publish_catalog_lesson_plan(self.get_teacher())
        if plan.teacher is None:
            if not publisher:
                return Response({"detail": "Нет доступа."}, status=status.HTTP_403_FORBIDDEN)
        elif plan.teacher_id != self.get_teacher().id:
            return Response({"detail": "Нет доступа."}, status=status.HTTP_403_FORBIDDEN)
        return super().destroy(request, *args, **kwargs)

    @action(detail=True, methods=["post"], url_path="copy")
    def copy(self, request, pk=None):
        """Скопировать план: свой — дубликат с «(копия)», чужой/публичный — в личный кабинет."""
        source = self.get_object()
        teacher = self.get_teacher()
        new_plan = _copy_lesson_plan(source, teacher)
        if source.teacher_id == teacher.id:
            base_title = (source.title or "").strip() or "План уроков"
            if not base_title.endswith("(копия)"):
                new_plan.title = f"{base_title} (копия)"
                new_plan.save(update_fields=["title", "updated_at"])
        new_plan = self.get_queryset().filter(pk=new_plan.pk).first() or new_plan
        return Response(
            LessonPlanDetailSerializer(new_plan).data,
            status=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=["post"], url_path="enroll")
    def enroll(self, request, pk=None):
        """Назначить план ученику или группе → создаёт LessonPlanEnrollment."""
        plan = self.get_object()
        data = {**request.data, "plan": plan.pk}
        serializer = LessonPlanEnrollmentWriteSerializer(data=data)
        serializer.is_valid(raise_exception=True)

        # Проверяем, что ученик/группа принадлежат учителю
        student = serializer.validated_data.get("student")
        group = serializer.validated_data.get("group")
        if student:
            get_object_or_404(Student, pk=student.pk, teacher=self.get_teacher())
        if group:
            get_object_or_404(StudentGroup, pk=group.pk, teacher=self.get_teacher())

        enrollment = serializer.save(teacher=self.get_teacher())
        return Response(LessonPlanEnrollmentSerializer(enrollment).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="items")
    def add_item(self, request, pk=None):
        plan = self.get_object()
        if plan.teacher is None or plan.teacher_id != self.get_teacher().id:
            return Response(
                {"detail": "Нельзя изменять публичный или чужой план."},
                status=status.HTTP_403_FORBIDDEN,
            )
        data = {**request.data}
        if "order" not in data:
            data["order"] = plan.items.count() + 1
        serializer = LessonPlanItemEditorSerializer(
            data=data,
            context={"teacher": self.get_teacher()},
        )
        serializer.is_valid(raise_exception=True)
        item = serializer.save(plan=plan)
        plan.lessons_count = plan.items.count()
        plan.save(update_fields=["lessons_count", "updated_at"])
        return Response(LessonPlanItemSerializer(item).data, status=status.HTTP_201_CREATED)


class LessonPlanSubjectOptionsView(TeacherScopedMixin, APIView):
    def get(self, request):
        return Response({"subjects": get_plan_subject_options()})


class LessonPlanLevelOptionsView(TeacherScopedMixin, APIView):
    def get(self, request):
        return Response({"levels": get_plan_level_options()})


class LessonPlanItemViewSet(
    TeacherScopedMixin,
    mixins.RetrieveModelMixin,
    mixins.UpdateModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    def get_queryset(self):
        teacher = self.get_teacher()
        return LessonPlanItem.objects.filter(
            Q(plan__teacher=teacher) | Q(plan__teacher__isnull=True)
        ).select_related(
            "plan",
            "linked_lesson",
            "scheduled_event",
        ).prefetch_related(
            "materials",
            "attached_interactives",
            "homework_materials",
            "homework_interactives",
        )

    serializer_class = LessonPlanItemSerializer

    def get_serializer_class(self):
        if self.action in ("update", "partial_update"):
            return LessonPlanItemEditorSerializer
        return LessonPlanItemSerializer

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        ctx["teacher"] = self.get_teacher()
        return ctx

    def update(self, request, *args, **kwargs):
        item = self.get_object()
        plan = item.plan
        if plan.teacher is None:
            return Response(
                {"detail": "Публичный план нельзя изменить. Сделайте копию для редактирования."},
                status=status.HTTP_403_FORBIDDEN,
            )
        if plan.teacher_id != self.get_teacher().id:
            return Response({"detail": "Нет доступа."}, status=status.HTTP_403_FORBIDDEN)
        response = super().update(request, *args, **kwargs)
        item.refresh_from_db()
        # После M2M-обновления не полагаемся на устаревший prefetch.
        if hasattr(item, "_prefetched_objects_cache"):
            item._prefetched_objects_cache.clear()
        from .lesson_plan_content_sync import LessonLearningPlanSyncService
        sync_result = LessonLearningPlanSyncService.sync_plan_item_to_lessons(
            item, teacher=self.get_teacher(), update_source="plan",
        )
        data = LessonPlanItemSerializer(item).data
        data["synced_events"] = sync_result
        return Response(data)

    def destroy(self, request, *args, **kwargs):
        item = self.get_object()
        plan = item.plan
        if plan.teacher is None:
            return Response(
                {"detail": "Публичный план нельзя изменить."},
                status=status.HTTP_403_FORBIDDEN,
            )
        if plan.teacher_id != self.get_teacher().id:
            return Response({"detail": "Нет доступа."}, status=status.HTTP_403_FORBIDDEN)
        plan_id = plan.pk
        response = super().destroy(request, *args, **kwargs)
        plan = LessonPlan.objects.get(pk=plan_id)
        plan.lessons_count = plan.items.count()
        plan.save(update_fields=["lessons_count", "updated_at"])
        return response

    @action(detail=True, methods=["post"], url_path="schedule")
    def schedule(self, request, pk=None):
        item = self.get_object()
        event_id = request.data.get("schedule_event_id")
        scheduled_date = request.data.get("scheduled_date")
        if event_id:
            event = get_object_or_404(
                ScheduleEvent,
                pk=event_id,
                owner=self.get_teacher(),
            )
            item.scheduled_event = event
        if scheduled_date:
            item.scheduled_date = scheduled_date
        item.status = PlanItemStatus.PLANNED
        item.save()
        return Response(LessonPlanItemSerializer(item).data)

    @action(detail=False, methods=["post"], url_path="reorder")
    def reorder(self, request):
        order_map = request.data.get("items") or []
        plan_ids = set()
        for entry in order_map:
            item_id = entry.get("id")
            order = entry.get("order")
            if item_id is None or order is None:
                continue
            updated = LessonPlanItem.objects.filter(
                pk=item_id,
                plan__teacher=self.get_teacher(),
            )
            for item in updated:
                plan_ids.add(item.plan_id)
            updated.update(order=order)

        from .choices import EnrollmentStatus
        from .lesson_plan_content_sync import LessonLearningPlanSyncService
        from .models import LessonPlanEnrollment

        warnings = []
        updated_event_ids = []
        for plan_id in plan_ids:
            enrollments = LessonPlanEnrollment.objects.filter(
                plan_id=plan_id,
                teacher=self.get_teacher(),
            ).exclude(status__in=[EnrollmentStatus.COMPLETED, EnrollmentStatus.CANCELLED])
            for enrollment in enrollments:
                result = LessonLearningPlanSyncService.reorder_future_lessons_from_plan(
                    enrollment, teacher=self.get_teacher(),
                )
                updated_event_ids.extend(result.get("updated_event_ids") or [])
                if result.get("warning"):
                    warnings.append(result["warning"])

        return Response({
            "ok": True,
            "warning": warnings[0] if warnings else None,
            "warnings": warnings,
            "updated_event_ids": list(dict.fromkeys(updated_event_ids)),
        })


class LessonPlanEnrollmentViewSet(TeacherScopedMixin, viewsets.ModelViewSet):
    """Назначения планов уроков ученикам / группам."""

    def get_queryset(self):
        qs = LessonPlanEnrollment.objects.filter(
            teacher=self.get_teacher()
        ).select_related("plan", "student", "student_subject", "group")
        plan_id = self.request.query_params.get("plan")
        if plan_id:
            qs = qs.filter(plan_id=plan_id)
        student_id = self.request.query_params.get("student")
        if student_id:
            qs = qs.filter(student_id=student_id)
        student_subject_id = self.request.query_params.get("student_subject")
        if student_subject_id:
            qs = qs.filter(student_subject_id=student_subject_id)
        group_id = self.request.query_params.get("group")
        if group_id:
            qs = qs.filter(group_id=group_id)
        status_param = self.request.query_params.get("status")
        if status_param:
            qs = qs.filter(status=status_param)
        return qs.order_by("-created_at")

    def get_serializer_class(self):
        if self.action in ("create", "update", "partial_update"):
            return LessonPlanEnrollmentWriteSerializer
        return LessonPlanEnrollmentSerializer

    def perform_create(self, serializer):
        student = serializer.validated_data.get("student")
        group = serializer.validated_data.get("group")
        student_subject = serializer.validated_data.get("student_subject")
        if student:
            get_object_or_404(Student, pk=student.pk, teacher=self.get_teacher())
        if group:
            get_object_or_404(StudentGroup, pk=group.pk, teacher=self.get_teacher())
        if student_subject:
            get_object_or_404(
                StudentSubject,
                pk=student_subject.pk,
                student=student,
                student__teacher=self.get_teacher(),
            )
        enrollment = serializer.save(teacher=self.get_teacher())
        # Помечаем первый пункт плана как PLANNED
        from .plan_sync import PlanSyncService
        from .choices import PlanItemStatus
        first_item = enrollment.plan.items.order_by("order").first()
        if first_item and first_item.status == PlanItemStatus.NOT_STARTED:
            first_item.status = PlanItemStatus.PLANNED
            first_item.save(update_fields=["status"])

    @action(detail=True, methods=["get"], url_path="progress")
    def progress(self, request, pk=None):
        """Прогресс выполнения плана для данного назначения."""
        enrollment = self.get_object()
        from .plan_sync import PlanSyncService
        data = PlanSyncService.get_enrollment_progress(enrollment)
        return Response(data)

    @action(detail=True, methods=["post"], url_path="advance")
    def advance(self, request, pk=None):
        """Вручную отметить текущий пункт выполненным и перейти к следующему."""
        enrollment = self.get_object()
        from .plan_sync import PlanSyncService
        current = PlanSyncService.get_current_item(enrollment)
        if not current:
            return Response({"detail": "Все пункты плана выполнены.", "finished": True})
        PlanSyncService.sync_enrollment(enrollment)
        data = PlanSyncService.get_enrollment_progress(enrollment)
        return Response({**data, "advanced_item": {"id": current.pk, "title": current.title}})

    @action(detail=True, methods=["post"], url_path="sync-event")
    def sync_event(self, request, pk=None):
        """Синхронизировать с конкретным событием расписания."""
        enrollment = self.get_object()
        event_id = request.data.get("event_id")
        if not event_id:
            return Response({"detail": "Укажите event_id."}, status=400)
        event = get_object_or_404(ScheduleEvent, pk=event_id, owner=self.get_teacher())
        from .plan_sync import PlanSyncService
        advanced = PlanSyncService.on_event_completed(event)
        return Response({
            "ok": True,
            "advanced_count": len(advanced),
            "progress": PlanSyncService.get_enrollment_progress(enrollment),
        })


class InteractiveAppearanceView(TeacherScopedMixin, APIView):
    """Каталог фонов, стилей карточек и звуковых пакетов для интерактивов."""

    def get(self, request):
        return Response({
            "backgrounds": InteractiveBackgroundSerializer(
                InteractiveBackground.objects.filter(is_active=True),
                many=True,
            ).data,
            "card_styles": InteractiveCardStyleSerializer(
                InteractiveCardStyle.objects.filter(is_active=True),
                many=True,
            ).data,
            "sound_packs": InteractiveSoundPackSerializer(
                InteractiveSoundPack.objects.filter(is_active=True),
                many=True,
            ).data,
        })


class InteractiveViewSet(TeacherScopedMixin, viewsets.ModelViewSet):
    def get_queryset(self):
        qs = Interactive.objects.filter(teacher=self.get_teacher()).select_related(
            "background",
            "card_style",
            "sound_pack",
        )
        params = self.request.query_params
        for field in ("direction", "exam_type", "status", "interactive_type"):
            value = params.get(field)
            if value:
                qs = qs.filter(**{field: value})
        search = (params.get("search") or "").strip()
        if search:
            qs = qs.filter(title__icontains=search)
        if self.action == "retrieve":
            qs = qs.prefetch_related(
                "flashcards",
                "matching_pairs",
                "ordering_items",
                "quiz_questions",
                "wheel_segments",
            )
        return qs.order_by("-updated_at")

    def get_serializer_class(self):
        if self.action == "retrieve":
            return InteractiveDetailSerializer
        if self.action in ("create", "update", "partial_update"):
            return InteractiveWriteSerializer
        return InteractiveListSerializer

    def _detail_response(self, interactive, status_code=status.HTTP_200_OK, headers=None):
        """Create/update must return Detail shape (incl. id), not WriteSerializer."""
        data = InteractiveDetailSerializer(interactive, context=self.get_serializer_context()).data
        return Response(data, status=status_code, headers=headers or {})

    def create(self, request, *args, **kwargs):
        try:
            SubscriptionLimitService.raise_if_interactive_limit_reached(self.get_teacher())
        except LimitExceeded as exc:
            return Response(exc.to_dict(), status=status.HTTP_403_FORBIDDEN)
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        headers = self.get_success_headers({"pk": serializer.instance.pk})
        return self._detail_response(
            serializer.instance,
            status_code=status.HTTP_201_CREATED,
            headers=headers,
        )

    def update(self, request, *args, **kwargs):
        partial = kwargs.pop("partial", False)
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)
        self.perform_update(serializer)
        return self._detail_response(serializer.instance)

    def perform_create(self, serializer):
        serializer.save(teacher=self.get_teacher())

    @action(detail=True, methods=["post"], url_path="publish")
    def publish(self, request, pk=None):
        interactive = self.get_object()
        interactive.status = "published"
        update_fields = ["status", "updated_at"]
        if interactive.published_at is None:
            interactive.published_at = timezone.now()
            update_fields.append("published_at")
        interactive.save(update_fields=update_fields)
        return Response(InteractiveDetailSerializer(interactive, context=self.get_serializer_context()).data)

    @action(detail=True, methods=["post"], url_path="assign")
    def assign(self, request, pk=None):
        interactive = self.get_object()
        data = {**request.data, "interactive": interactive.pk}
        serializer = InteractiveAssignmentSerializer(data=data)
        serializer.is_valid(raise_exception=True)
        assignment = serializer.save(teacher=self.get_teacher())
        return Response(InteractiveAssignmentSerializer(assignment).data, status=status.HTTP_201_CREATED)

    @action(
        detail=False,
        methods=["post"],
        url_path="upload-image",
        parser_classes=[MultiPartParser, FormParser],
    )
    def upload_image(self, request):
        import uuid

        from .homework_api import _safe_upload_filename
        from .upload_validation import UploadValidationError, validate_uploaded_image

        uploaded = request.FILES.get("file")
        if not uploaded:
            return Response({"error": "file required"}, status=status.HTTP_400_BAD_REQUEST)

        try:
            validate_uploaded_image(uploaded)
        except UploadValidationError as exc:
            return Response({"error": exc.message, "code": exc.code}, status=status.HTTP_400_BAD_REQUEST)

        safe_name = _safe_upload_filename(uploaded.name)
        uid = uuid.uuid4().hex[:12]
        rel_path = f"cabinet/interactives/uploads/{self.get_teacher().pk}/{uid}_{safe_name}"
        saved_path = default_storage.save(rel_path, uploaded)
        file_url = default_storage.url(saved_path)
        # Keep relative /media/... URLs stable across hosts; CharField accepts them on save.
        if file_url and not file_url.startswith(("http://", "https://", "/")):
            file_url = request.build_absolute_uri(file_url)
        return Response({"ok": True, "url": file_url, "filename": safe_name}, status=status.HTTP_201_CREATED)


class InteractiveAssignmentViewSet(TeacherScopedMixin, mixins.ListModelMixin, viewsets.GenericViewSet):
    serializer_class = InteractiveAssignmentSerializer

    def get_queryset(self):
        return InteractiveAssignment.objects.filter(
            teacher=self.get_teacher()
        ).select_related("interactive", "student", "group")


class InteractiveAttemptViewSet(TeacherScopedMixin, mixins.CreateModelMixin, viewsets.GenericViewSet):
    serializer_class = InteractiveAttemptSerializer

    def get_queryset(self):
        return InteractiveAttempt.objects.filter(
            assignment__teacher=self.get_teacher()
        )

    def perform_create(self, serializer):
        teacher = self.get_teacher()
        assignment = serializer.validated_data.get("assignment")
        student = serializer.validated_data.get("student")
        if assignment is None or assignment.teacher_id != teacher.id:
            raise ValidationError({"assignment": "Нет доступа к назначению."})
        if student is not None and student.teacher_id != teacher.id:
            raise ValidationError({"student": "Нет доступа к ученику."})
        attempt = serializer.save()
        if attempt.score_percent is not None:
            attempt.status = "completed"
            attempt.completed_at = timezone.now()
            attempt.save(update_fields=["status", "completed_at"])


class ReviewViewSet(TeacherScopedMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    serializer_class = ReviewItemSerializer

    def list(self, request, *args, **kwargs):
        from .homework_api import sync_assigned_homework_into_review_queue

        # Подтянуть выданные ДЗ без ReviewItem (авто-выдача после урока).
        sync_assigned_homework_into_review_queue(self.get_teacher())
        return super().list(request, *args, **kwargs)

    def get_queryset(self):
        from .homework_api import exclude_live_meeting_review_items

        qs = ReviewItem.objects.filter(teacher=self.get_teacher()).select_related("student", "group")
        qs = exclude_live_meeting_review_items(qs)
        qs = qs.exclude(student__status=StudentStatus.ARCHIVED)
        status_param = self.request.query_params.get("status")
        if status_param:
            qs = qs.filter(status=status_param)
        return qs.order_by("-created_at")

    @action(detail=True, methods=["post"], url_path="check")
    def check(self, request, pk=None):
        item = self.get_object()
        item.status = ReviewStatus.CHECKED
        item.checked_at = timezone.now()
        item.teacher_comment = request.data.get("teacher_comment", item.teacher_comment)
        item.save()
        self._sync_source(
            item,
            checked=True,
            comment=item.teacher_comment,
            scores=request.data.get("scores"),
            checked_tasks=request.data.get("checked"),
            comments_by_task_id=request.data.get("comments_by_task_id"),
            manual_stats=request.data.get("manual_stats"),
        )
        try:
            from .student_notifications import notify_student_homework_reviewed

            notify_student_homework_reviewed(
                review_item=item,
                checked=True,
                actor=request.user,
            )
        except Exception:
            logger = __import__("logging").getLogger("cabinet.notifications")
            logger.exception("Failed to notify student about checked review %s", item.pk)
        item.refresh_from_db()
        return Response(ReviewItemSerializer(item).data)

    @action(detail=True, methods=["post"], url_path="return")
    def return_work(self, request, pk=None):
        item = self.get_object()
        item.status = ReviewStatus.RETURNED
        item.checked_at = timezone.now()
        item.teacher_comment = request.data.get("teacher_comment", item.teacher_comment)
        item.save()
        self._sync_source(
            item,
            checked=False,
            comment=item.teacher_comment,
            comments_by_task_id=request.data.get("comments_by_task_id"),
            manual_stats=request.data.get("manual_stats"),
        )
        try:
            from .student_notifications import notify_student_homework_reviewed

            notify_student_homework_reviewed(
                review_item=item,
                checked=False,
                actor=request.user,
            )
        except Exception:
            logger = __import__("logging").getLogger("cabinet.notifications")
            logger.exception("Failed to notify student about returned review %s", item.pk)
        item.refresh_from_db()
        return Response(ReviewItemSerializer(item).data)

    @action(detail=True, methods=["get"], url_path="create-homework-preview")
    def create_homework_preview(self, request, pk=None):
        """Превью формы «Задать ДЗ» из проверки."""
        from .homework_from_review import HomeworkFromReviewError, prepare_homework_from_review

        item = self.get_object()
        try:
            data = prepare_homework_from_review(teacher=request.user, review_item=item)
        except HomeworkFromReviewError as exc:
            return Response(
                {"detail": exc.message, "code": exc.code},
                status=exc.status,
            )
        return Response(data)

    @action(detail=True, methods=["post"], url_path="create-homework")
    def create_homework(self, request, pk=None):
        """Создать ДЗ для ученика из проверяемой работы (черновик или выдача)."""
        from .homework_from_review import HomeworkFromReviewError, create_homework_from_review

        item = self.get_object()
        data = request.data if isinstance(request.data, dict) else {}
        mode = (data.get("mode") or "assign").strip().lower()
        if mode not in ("assign", "draft"):
            mode = "assign"

        try:
            result = create_homework_from_review(
                teacher=request.user,
                review_item=item,
                title=data.get("title") or "",
                description=data.get("description") or "",
                due_at=data.get("due_at"),
                mode=mode,
                generator_task_ids=data.get("generator_task_ids") or data.get("task_ids"),
                include_incorrect=bool(data.get("include_incorrect")),
                include_partial=bool(data.get("include_partial")),
                source_homework_task_ids=data.get("source_homework_task_ids"),
                material_ids=data.get("material_ids"),
                interactive_ids=data.get("interactive_ids"),
                comment=data.get("comment") or "",
                idempotency_key=data.get("idempotency_key")
                or request.headers.get("X-Idempotency-Key", ""),
            )
        except HomeworkFromReviewError as exc:
            return Response(
                {"detail": exc.message, "code": exc.code},
                status=exc.status,
            )

        homework = result["homework"]
        due_label = ""
        if homework.due_at:
            local = timezone.localtime(homework.due_at)
            months = (
                "", "января", "февраля", "марта", "апреля", "мая", "июня",
                "июля", "августа", "сентября", "октября", "ноября", "декабря",
            )
            due_label = f"{local.day} {months[local.month]}, {local.strftime('%H:%M')}"

        if mode == "draft":
            message = "Черновик домашнего задания сохранён"
        elif due_label:
            message = f"Домашнее задание выдано ученику. Срок: {due_label}"
        else:
            message = "Домашнее задание выдано ученику"

        return Response(
            {
                "ok": True,
                "created": result.get("created", True),
                "idempotent": result.get("idempotent", False),
                "homework_id": homework.id,
                "homework_url": f"/cabinet/homework/{homework.id}/edit",
                "status": homework.status,
                "due_at": homework.due_at.isoformat() if homework.due_at else None,
                "due_label": due_label,
                "message": message,
                "tasks_count": result.get("tasks_count", 0),
                "notified": result.get("notified", 0),
                "homework": HomeworkListSerializer(homework).data,
            },
            status=status.HTTP_201_CREATED if result.get("created") else status.HTTP_200_OK,
        )

    @action(
        detail=True,
        methods=["post", "delete"],
        url_path="upload-feedback",
        parser_classes=[MultiPartParser, FormParser],
    )
    def upload_feedback(self, request, pk=None):
        if request.method == "DELETE":
            return self._delete_review_feedback(request, pk)

        import uuid

        from .homework_api import (
            _safe_upload_filename,
            append_teacher_feedback_attachment,
        )

        item = self.get_object()
        if item.status != ReviewStatus.PENDING:
            return Response(
                {"error": "Работа уже проверена."},
                status=status.HTTP_403_FORBIDDEN,
            )
        if item.source_type != "homework":
            return Response(
                {"error": "Неподдерживаемый тип работы."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        uploaded = request.FILES.get("file")
        if not uploaded:
            return Response({"error": "file required"}, status=status.HTTP_400_BAD_REQUEST)

        from .upload_validation import UploadValidationError, validate_uploaded_file

        try:
            validate_uploaded_file(uploaded)
        except UploadValidationError as exc:
            return Response({"error": exc.message, "code": exc.code}, status=status.HTTP_400_BAD_REQUEST)

        task_number = str(
            request.data.get("task_number") or request.POST.get("task_number") or ""
        ).strip()
        if not task_number:
            return Response({"error": "task_number required"}, status=status.HTTP_400_BAD_REQUEST)

        task_id = str(request.data.get("task_id") or request.POST.get("task_id") or "").strip()

        submission = HomeworkSubmission.objects.filter(pk=item.source_id).first()
        if not submission:
            return Response({"error": "Submission not found."}, status=status.HTTP_404_NOT_FOUND)

        safe_name = _safe_upload_filename(uploaded.name)
        uid = uuid.uuid4().hex[:12]
        task_key = task_id or task_number
        rel_path = (
            f"cabinet/homework/review_feedback/{item.pk}/{task_key}_{uid}_{safe_name}"
        )
        saved_path = default_storage.save(rel_path, uploaded)
        file_url = default_storage.url(saved_path)

        payload = dict(submission.result_payload or {})
        append_teacher_feedback_attachment(
            payload,
            task_id=task_id,
            task_number=task_number,
            file_url=file_url,
            filename=safe_name,
        )
        HomeworkSubmission.objects.filter(pk=submission.pk).update(
            result_payload=payload,
            updated_at=timezone.now(),
        )

        return Response({"ok": True, "url": file_url, "filename": safe_name})

    def _delete_review_feedback(self, request, pk=None):
        from .homework_api import _delete_attachment_file, _remove_teacher_attachment_from_payload

        item = self.get_object()
        if item.status != ReviewStatus.PENDING:
            return Response(
                {"error": "Работа уже проверена."},
                status=status.HTTP_403_FORBIDDEN,
            )
        if item.source_type != "homework":
            return Response(
                {"error": "Неподдерживаемый тип работы."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        file_url = str(
            request.query_params.get("url")
            or request.data.get("url")
            or ""
        ).strip()
        if not file_url:
            return Response({"error": "url required"}, status=status.HTTP_400_BAD_REQUEST)

        task_number = str(
            request.query_params.get("task_number")
            or request.data.get("task_number")
            or ""
        ).strip()
        task_id = str(
            request.query_params.get("task_id")
            or request.data.get("task_id")
            or ""
        ).strip()

        submission = HomeworkSubmission.objects.filter(pk=item.source_id).first()
        if not submission:
            return Response({"error": "Submission not found."}, status=status.HTTP_404_NOT_FOUND)

        payload = dict(submission.result_payload or {})
        if not _remove_teacher_attachment_from_payload(
            payload,
            file_url=file_url,
            task_id=task_id,
            task_number=task_number,
        ):
            return Response({"error": "Файл не найден."}, status=status.HTTP_404_NOT_FOUND)

        _delete_attachment_file(file_url)
        HomeworkSubmission.objects.filter(pk=submission.pk).update(
            result_payload=payload,
            updated_at=timezone.now(),
        )
        return Response({"ok": True})

    def _sync_source(
        self,
        item,
        *,
        checked,
        comment,
        scores=None,
        checked_tasks=None,
        comments_by_task_id=None,
        manual_stats=None,
    ):
        if item.source_type != "homework":
            return
        submission = HomeworkSubmission.objects.filter(pk=item.source_id).first()
        if not submission:
            return

        submission.status = SubmissionStatus.CHECKED if checked else SubmissionStatus.RETURNED
        submission.teacher_comment = comment or ""
        update_fields = ["status", "teacher_comment", "updated_at"]
        payload = dict(submission.result_payload or {})
        changed_payload = False

        if isinstance(scores, dict) and scores:
            merged = dict(payload.get("scores") or {})
            for key, value in scores.items():
                try:
                    merged[str(key)] = float(value)
                except (TypeError, ValueError):
                    continue
            payload["scores"] = merged
            changed_payload = True
        if isinstance(checked_tasks, dict) and checked_tasks:
            merged = dict(payload.get("checked") or {})
            for key, value in checked_tasks.items():
                merged[str(key)] = bool(value)
            payload["checked"] = merged
            changed_payload = True
        if isinstance(comments_by_task_id, dict) and comments_by_task_id:
            payload["comments_by_task_id"] = {
                str(key): str(value).strip()
                for key, value in comments_by_task_id.items()
                if str(value).strip()
            }
            changed_payload = True
        if comment:
            payload["teacher_comment"] = comment
            payload["review_comment"] = comment
            changed_payload = True

        if isinstance(manual_stats, dict):
            cleaned = {}
            for key in ("correct", "incorrect", "total", "unsolved"):
                raw = manual_stats.get(key)
                if raw is None or raw == "":
                    continue
                try:
                    cleaned[key] = max(0, int(raw))
                except (TypeError, ValueError):
                    continue
            if cleaned:
                payload["manual_stats"] = cleaned
                changed_payload = True
                total = cleaned.get("total") or 0
                correct = cleaned.get("correct") or 0
                if total > 0:
                    submission.score = round(correct * 100 / total, 2)
                    update_fields.append("score")

        if changed_payload:
            from .homework_api import compute_score_percent

            submission.result_payload = payload
            if "score" not in update_fields:
                computed = compute_score_percent(payload)
                if computed is not None:
                    submission.score = computed
                    update_fields.append("score")
            update_fields.append("result_payload")

        # unique update_fields
        seen = set()
        update_fields = [f for f in update_fields if not (f in seen or seen.add(f))]
        submission.save(update_fields=update_fields)
        try:
            from .homework_attempts import snapshot_on_review

            snapshot_on_review(submission, checked=checked)
        except Exception:
            pass
        try:
            from .journal_service import sync_previous_homework_status_from_submission

            sync_previous_homework_status_from_submission(submission)
        except Exception:
            # Сводка успеваемости подтянет актуальный статус и без записи в журнал.
            pass


class ScheduleViewSet(TeacherScopedMixin, viewsets.ModelViewSet):
    serializer_class = ScheduleEventSerializer

    def get_queryset(self):
        qs = ScheduleEvent.objects.filter(owner=self.get_teacher()).select_related(
            "student", "group", "lesson"
        )
        params = self.request.query_params
        date_from = params.get("date_from")
        date_to = params.get("date_to")
        if date_from:
            qs = qs.filter(ends_at__date__gte=date_from)
        if date_to:
            qs = qs.filter(starts_at__date__lte=date_to)
        for field in ("event_type", "status"):
            value = params.get(field)
            if value:
                qs = qs.filter(**{field: value})
        student_id = params.get("student")
        if student_id:
            qs = qs.filter(student_id=student_id)
        group_id = params.get("group")
        if group_id:
            qs = qs.filter(group_id=group_id)
        return qs.order_by("starts_at")

    def perform_create(self, serializer):
        serializer.save(owner=self.get_teacher())

    @action(detail=True, methods=["post"], url_path="cancel")
    def cancel(self, request, pk=None):
        event = self.get_object()
        event.status = ScheduleEvent.Status.CANCELLED
        event.save(update_fields=["status", "updated_at"])
        return Response(ScheduleEventSerializer(event).data)

    @action(detail=True, methods=["post"], url_path="complete")
    def complete(self, request, pk=None):
        event = self.get_object()
        event.status = ScheduleEvent.Status.DONE
        event.save(update_fields=["status", "updated_at"])
        return Response(ScheduleEventSerializer(event).data)

    @action(detail=True, methods=["post"], url_path="move")
    def move(self, request, pk=None):
        event = self.get_object()
        starts_at = request.data.get("starts_at")
        ends_at = request.data.get("ends_at")
        if starts_at:
            event.starts_at = starts_at
        if ends_at:
            event.ends_at = ends_at
        event.status = ScheduleEvent.Status.MOVED
        event.save()
        return Response(ScheduleEventSerializer(event).data)


class MaterialViewSet(
    TeacherScopedMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.CreateModelMixin,
    viewsets.GenericViewSet,
):
    def get_queryset(self):
        teacher = self.get_teacher()
        qs = Material.objects.filter(
            Q(is_public=True) | Q(teacher=teacher) | Q(teacher__isnull=True, is_public=True)
        )
        params = self.request.query_params
        for field in ("direction", "exam_type", "material_type", "status"):
            value = params.get(field)
            if value:
                qs = qs.filter(**{field: value})
        search = (params.get("search") or "").strip()
        if search:
            qs = qs.filter(Q(title__icontains=search) | Q(topic__icontains=search))
        if params.get("mine") == "true":
            qs = qs.filter(teacher=teacher)
        return qs.order_by("-created_at")

    def get_serializer_class(self):
        if self.action == "create":
            return MaterialWriteSerializer
        if self.action == "retrieve":
            return MaterialDetailSerializer
        return MaterialListSerializer

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        ctx["teacher"] = self.get_teacher()
        return ctx

    def retrieve(self, request, *args, **kwargs):
        from .subscription_access import AccessDenied, SubscriptionAccessService

        material = self.get_object()
        try:
            SubscriptionAccessService.raise_if_cannot_access_content(request.user, material)
        except AccessDenied as exc:
            return Response(exc.to_dict(), status=status.HTTP_403_FORBIDDEN)
        serializer = self.get_serializer(material)
        return Response(serializer.data)

    def perform_create(self, serializer):
        serializer.save(teacher=self.get_teacher())

    def _serve_material_file(self, request, *, inline: bool):
        import mimetypes

        from django.http import FileResponse

        from .files_storage import content_disposition
        from .subscription_access import AccessDenied, SubscriptionAccessService

        material = self.get_object()
        try:
            SubscriptionAccessService.raise_if_cannot_access_content(request.user, material)
        except AccessDenied as exc:
            return Response(exc.to_dict(), status=status.HTTP_403_FORBIDDEN)
        if not material.file:
            return Response({"detail": "Файл не найден."}, status=status.HTTP_404_NOT_FOUND)
        try:
            fh = material.file.open("rb")
        except Exception:
            return Response({"detail": "Файл недоступен."}, status=status.HTTP_404_NOT_FOUND)
        name = material.file.name.split("/")[-1] or "file"
        content_type = mimetypes.guess_type(name)[0] or "application/octet-stream"
        if content_type in (
            "text/html",
            "image/svg+xml",
            "text/javascript",
            "application/javascript",
        ):
            inline = False
            content_type = "application/octet-stream"
        response = FileResponse(fh, content_type=content_type)
        response["Content-Disposition"] = content_disposition(name, inline=inline)
        response["X-Content-Type-Options"] = "nosniff"
        response["Cache-Control"] = "private, no-store"
        return response

    @action(detail=True, methods=["get"], url_path="file")
    def download_file(self, request, pk=None):
        return self._serve_material_file(request, inline=False)

    @action(detail=True, methods=["get"], url_path="preview")
    def preview_file(self, request, pk=None):
        return self._serve_material_file(request, inline=True)

    def create(self, request, *args, **kwargs):
        write_serializer = MaterialWriteSerializer(
            data=request.data,
            context=self.get_serializer_context(),
        )
        write_serializer.is_valid(raise_exception=True)
        self.perform_create(write_serializer)
        output = MaterialListSerializer(
            write_serializer.instance,
            context=self.get_serializer_context(),
        )
        return Response(output.data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="save")
    def save_material(self, request, pk=None):
        from .subscription_access import AccessDenied, SubscriptionAccessService

        material = self.get_object()
        try:
            SubscriptionAccessService.raise_if_cannot_access_content(request.user, material)
        except AccessDenied as exc:
            return Response(exc.to_dict(), status=status.HTTP_403_FORBIDDEN)
        note = request.data.get("note", "")
        saved, _ = TeacherSavedMaterial.objects.get_or_create(
            teacher=self.get_teacher(),
            material=material,
            defaults={"note": note},
        )
        if note:
            saved.note = note
            saved.save(update_fields=["note"])
        return Response({"ok": True, "saved_at": saved.saved_at})

    @action(detail=True, methods=["post"], url_path="attach")
    def attach(self, request, pk=None):
        from .subscription_access import AccessDenied, SubscriptionAccessService

        material = self.get_object()
        try:
            SubscriptionAccessService.raise_if_cannot_access_content(request.user, material)
        except AccessDenied as exc:
            return Response(exc.to_dict(), status=status.HTTP_403_FORBIDDEN)
        target_type = request.data.get("target_type")
        target_id = request.data.get("target_id")
        if target_type == "lesson":
            lesson = get_object_or_404(Lesson, pk=target_id, teacher=self.get_teacher())
            lesson.materials.add(material)
        elif target_type == "plan_item":
            item = get_object_or_404(
                LessonPlanItem,
                pk=target_id,
                plan__teacher=self.get_teacher(),
            )
            item.materials.add(material)
        return Response({"ok": True})


class DashboardView(TeacherScopedMixin, APIView):
    def get(self, request):
        payload = build_dashboard_payload(request.user)
        serializer = DashboardSerializer(payload)
        return Response(serializer.data)


class NavCountsView(TeacherScopedMixin, APIView):
    """Лёгкие счётчики для пунктов меню кабинета учителя."""

    def get(self, request):
        from .homework_api import exclude_live_meeting_review_items, review_items_ready_to_check

        teacher = self.get_teacher()
        students_count = Student.objects.filter(
            teacher=teacher,
            status=StudentStatus.ACTIVE,
        ).count()
        reviews_count = review_items_ready_to_check(
            exclude_live_meeting_review_items(
                ReviewItem.objects.filter(
                    teacher=teacher,
                    status=ReviewStatus.PENDING,
                )
            )
        ).count()
        return Response({
            "students_count": students_count,
            "reviews_count": reviews_count,
        })


class ReportsOverviewView(TeacherScopedMixin, APIView):
    def get(self, request):
        from .homework_api import exclude_live_meeting_review_items, review_items_ready_to_check

        teacher = request.user
        return Response({
            "students_total": Student.objects.filter(teacher=teacher)
            .exclude(status=StudentStatus.ARCHIVED)
            .count(),
            "groups_total": StudentGroup.objects.filter(teacher=teacher).count(),
            "lessons_total": Lesson.objects.filter(teacher=teacher).count(),
            "homework_assigned": Homework.objects.filter(teacher=teacher, status="assigned").count(),
            "homework_completed": Homework.objects.filter(teacher=teacher, status="completed").count(),
            "pending_reviews": review_items_ready_to_check(
                exclude_live_meeting_review_items(
                    ReviewItem.objects.filter(teacher=teacher, status=ReviewStatus.PENDING)
                )
            ).count(),
        })


class ReportsStudentView(TeacherScopedMixin, APIView):
    def get(self, request, student_id):
        student = get_object_or_404(Student, pk=student_id, teacher=request.user)
        submissions = HomeworkSubmission.objects.filter(student=student)
        total = submissions.count()
        checked = submissions.filter(status=SubmissionStatus.CHECKED).count()
        return Response({
            "student": StudentDetailSerializer(student).data,
            "assignments_total": total,
            "assignments_completed": checked,
            "completion_percent": round(checked * 100 / total) if total else 0,
            "average_score": submissions.filter(score__isnull=False).aggregate(
                avg=Count("score")
            ),
        })


class ReportsGroupView(TeacherScopedMixin, APIView):
    def get(self, request, group_id):
        group = get_object_or_404(StudentGroup, pk=group_id, teacher=request.user)
        student_ids = group.students.exclude(status=StudentStatus.ARCHIVED).values_list(
            "id", flat=True
        )
        submissions = HomeworkSubmission.objects.filter(student_id__in=student_ids)
        total = submissions.count()
        checked = submissions.filter(status=SubmissionStatus.CHECKED).count()
        return Response({
            "group": StudentGroupDetailSerializer(group).data,
            "assignments_total": total,
            "assignments_completed": checked,
            "completion_percent": round(checked * 100 / total) if total else 0,
        })


class ReportsLessonView(TeacherScopedMixin, APIView):
    def get(self, request, lesson_id):
        lesson = get_object_or_404(Lesson, pk=lesson_id, teacher=request.user)
        assignments = LessonAssignment.objects.filter(lesson=lesson)
        return Response({
            "lesson": LessonDetailSerializer(lesson).data,
            "assignments_total": assignments.count(),
            "assignments_completed": assignments.filter(status="completed").count(),
        })


class ReportsTopicsView(TeacherScopedMixin, APIView):
    def get(self, request):
        teacher = request.user
        weak_items = LessonPlanItem.objects.filter(
            plan__teacher=teacher,
            status=PlanItemStatus.REPEAT_NEEDED,
        ).values("topic").annotate(count=Count("id")).order_by("-count")[:10]
        return Response({"weak_topics": list(weak_items)})


class ReportsParentSummaryView(TeacherScopedMixin, APIView):
    def get(self, request):
        student_id = request.query_params.get("student_id")
        if not student_id:
            return Response({"error": "Укажите student_id"}, status=400)
        student = get_object_or_404(Student, pk=student_id, teacher=request.user)
        return Response({
            "student_name": student.full_name,
            "grade": student.grade,
            "direction": student.get_direction_display(),
            "summary": f"Ученик {student.full_name} занимается по направлению {student.get_direction_display()}.",
        })


class HomeworkDetailView(TeacherScopedMixin, APIView):
    """Просмотр для редактирования / сохранение правок / удаление выданного ДЗ."""

    def _get_homework(self, request, homework_id):
        from .homework_edit import teacher_can_edit_homework

        homework = (
            Homework.objects.filter(pk=homework_id)
            .select_related("student", "group", "teacher")
            .prefetch_related("tasks", "submissions")
            .first()
        )
        if homework is None:
            return None, Response({"detail": "Не найдено."}, status=status.HTTP_404_NOT_FOUND)
        if not teacher_can_edit_homework(request.user, homework):
            return None, Response(
                {"detail": "Нет доступа к этому домашнему заданию."},
                status=status.HTTP_403_FORBIDDEN,
            )
        return homework, None

    def get(self, request, homework_id):
        from .homework_edit import serialize_homework_for_edit

        homework, err = self._get_homework(request, homework_id)
        if err:
            return err
        return Response(serialize_homework_for_edit(homework))

    def patch(self, request, homework_id):
        from .homework_edit import (
            HomeworkEditConflict,
            HomeworkEditNeedsConfirm,
            update_issued_homework,
        )

        homework, err = self._get_homework(request, homework_id)
        if err:
            return err
        data = request.data if isinstance(request.data, dict) else {}
        try:
            result = update_issued_homework(
                homework=homework,
                teacher=request.user,
                data=data,
            )
        except HomeworkEditConflict as exc:
            return Response(
                {"detail": str(exc), "code": "conflict"},
                status=status.HTTP_409_CONFLICT,
            )
        except HomeworkEditNeedsConfirm as exc:
            return Response(
                {"detail": exc.message, "code": exc.code},
                status=status.HTTP_409_CONFLICT,
            )
        except PermissionError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_403_FORBIDDEN)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(result, status=status.HTTP_200_OK)

    def delete(self, request, homework_id):
        from .choices import SubmissionStatus

        homework, err = self._get_homework(request, homework_id)
        if err:
            return err
        # Staff/admin могут удалять чужие только если teacher_can_edit; для обычного
        # учителя оставляем прежнюю жёсткую привязку к владельцу.
        if homework.teacher_id != request.user.id and not (
            getattr(request.user, "is_staff", False)
            or getattr(request.user, "is_superuser", False)
        ):
            return Response(
                {"detail": "Нет доступа к этому домашнему заданию."},
                status=status.HTTP_403_FORBIDDEN,
            )

        # Проверенное и принятое ДЗ удалять нельзя.
        submission_ids = list(homework.submissions.values_list("id", flat=True))
        if homework.submissions.filter(status=SubmissionStatus.CHECKED).exists():
            return Response(
                {"detail": "Нельзя удалить проверенное и принятое домашнее задание."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if submission_ids and ReviewItem.objects.filter(
            source_type="homework",
            source_id__in=submission_ids,
            status="checked",
        ).exists():
            return Response(
                {"detail": "Нельзя удалить проверенное и принятое домашнее задание."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # ReviewItem ссылается на HomeworkSubmission через целочисленное поле source_id (не FK),
        # поэтому каскад БД не срабатывает — удаляем связанные ReviewItem вручную.
        if submission_ids:
            ReviewItem.objects.filter(
                source_type="homework", source_id__in=submission_ids
            ).delete()

        homework.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


# Обратная совместимость имени
HomeworkDeleteView = HomeworkDetailView


class HomeworkTasksAddView(TeacherScopedMixin, APIView):
    """Добавить задание в уже выданное ДЗ и оповестить учеников."""

    def post(self, request, homework_id):
        from .homework_api import add_tasks_to_homework

        homework = get_object_or_404(Homework, pk=homework_id, teacher=request.user)
        data = request.data if isinstance(request.data, dict) else {}
        try:
            result = add_tasks_to_homework(
                homework=homework,
                teacher=request.user,
                material_ids=data.get("material_ids") or [],
                interactive_ids=data.get("interactive_ids") or [],
                text=data.get("text") or data.get("description") or "",
                text_title=data.get("text_title") or data.get("title") or "",
            )
        except PermissionError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_403_FORBIDDEN)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(result, status=status.HTTP_200_OK)


class HomeworkCopyView(TeacherScopedMixin, APIView):
    """Скопировать ДЗ и назначить другим ученикам."""

    def post(self, request, homework_id):
        from .choices import StudentStatus
        from .models import Student, StudentGroup
        from .serializers import HomeworkListSerializer
        from .student_release import copy_homework_to_students

        homework = get_object_or_404(
            Homework.objects.prefetch_related("tasks"),
            pk=homework_id,
            teacher=request.user,
        )
        data = request.data if isinstance(request.data, dict) else {}

        student_ids = list(data.get("student_ids") or [])
        if data.get("student_id") is not None:
            student_ids.append(data.get("student_id"))

        group_id = data.get("group_id")
        if group_id:
            group = StudentGroup.objects.filter(pk=group_id, teacher=request.user).first()
            if not group:
                return Response({"detail": "Группа не найдена."}, status=status.HTTP_404_NOT_FOUND)
            student_ids.extend(
                list(
                    group.students.filter(status=StudentStatus.ACTIVE).values_list("id", flat=True)
                )
            )

        # Не копируем самому себе по умолчанию — можно явно оставить в списке
        exclude_source = data.get("include_source_student") not in (True, "1", "true", "yes")
        if exclude_source and homework.student_id:
            student_ids = [sid for sid in student_ids if int(sid) != int(homework.student_id)]

        keep_due = data.get("keep_due_at") in (True, "1", "true", "yes")
        due_at = data.get("due_at") if "due_at" in data else None

        try:
            result = copy_homework_to_students(
                teacher=request.user,
                source_homework=homework,
                students=student_ids,
                due_at=due_at,
                keep_due_at=keep_due,
            )
        except PermissionError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_403_FORBIDDEN)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        created = result.get("homeworks") or []
        return Response(
            {
                "ok": True,
                "created_count": len(created),
                "homeworks": HomeworkListSerializer(created, many=True).data,
                "errors": result.get("errors") or [],
            },
            status=status.HTTP_201_CREATED,
        )


class HomeworkSubmissionAttachedFileView(TeacherScopedMixin, APIView):
    """Скачивание файла ответа ученика учителем (без публичного /media/)."""

    def get(self, request, submission_id):
        import mimetypes

        from django.http import FileResponse

        from .files_storage import content_disposition

        submission = get_object_or_404(
            HomeworkSubmission.objects.select_related("homework"),
            pk=submission_id,
            homework__teacher=request.user,
        )
        if not submission.attached_file:
            return Response({"error": "Файл не найден."}, status=status.HTTP_404_NOT_FOUND)
        try:
            fh = submission.attached_file.open("rb")
        except Exception:
            return Response({"error": "Файл недоступен."}, status=status.HTTP_404_NOT_FOUND)
        name = submission.attached_file.name.split("/")[-1] or "file"
        content_type = mimetypes.guess_type(name)[0] or "application/octet-stream"
        response = FileResponse(fh, content_type=content_type)
        response["Content-Disposition"] = content_disposition(name, inline=False)
        return response


class DirectMaterialAssignView(TeacherScopedMixin, APIView):
    """Teacher assigns a material directly to a group or student."""

    def get(self, request):
        teacher = self.get_teacher()
        qs = DirectMaterialAssignment.objects.filter(
            teacher=teacher
        ).select_related("material", "group", "student", "student_subject").order_by("-assigned_at")
        items = []
        for da in qs:
            items.append({
                "id": da.id,
                "material_id": da.material_id,
                "material_title": da.material.title,
                "material_type_label": da.material.get_material_type_display(),
                "group_id": da.group_id,
                "group_title": da.group.title if da.group else None,
                "student_id": da.student_id,
                "student_name": str(da.student) if da.student else None,
                "student_subject_id": da.student_subject_id,
                "student_subject_label": (
                    da.student_subject.display_label if da.student_subject_id else None
                ),
                "message": da.message,
                "assigned_at": da.assigned_at.isoformat(),
            })
        return Response({"items": items})

    def post(self, request):
        teacher = self.get_teacher()
        material_id = request.data.get("material_id")
        group_id = request.data.get("group_id")
        student_id = request.data.get("student_id")
        student_subject_id = request.data.get("student_subject_id") or request.data.get("student_subject")
        message = (request.data.get("message") or "").strip()

        if not material_id:
            return Response({"error": "material_id обязателен."}, status=status.HTTP_400_BAD_REQUEST)
        if not group_id and not student_id:
            return Response({"error": "Укажите group_id или student_id."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            material = Material.objects.get(
                pk=material_id,
                teacher=teacher,
            )
        except Material.DoesNotExist:
            return Response({"error": "Материал не найден."}, status=status.HTTP_404_NOT_FOUND)

        group = None
        student = None
        student_subject = None
        if group_id:
            try:
                group = StudentGroup.objects.get(pk=group_id, teacher=teacher)
            except StudentGroup.DoesNotExist:
                return Response({"error": "Группа не найдена."}, status=status.HTTP_404_NOT_FOUND)
        if student_id:
            try:
                student = Student.objects.get(pk=student_id, teacher=teacher)
            except Student.DoesNotExist:
                return Response({"error": "Ученик не найден."}, status=status.HTTP_404_NOT_FOUND)
            from .student_subjects import resolve_student_subject_for_write
            try:
                student_subject = resolve_student_subject_for_write(
                    teacher=teacher,
                    student=student,
                    student_subject_id=student_subject_id,
                    allow_empty=not student.subjects.filter(status=StudentSubjectStatus.ACTIVE).exists(),
                )
            except ValueError as exc:
                return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        da = DirectMaterialAssignment.objects.create(
            teacher=teacher,
            material=material,
            group=group,
            student=student,
            student_subject=student_subject,
            message=message,
        )
        return Response({"id": da.id, "ok": True}, status=status.HTTP_201_CREATED)

    def delete(self, request, pk=None):
        teacher = self.get_teacher()
        try:
            da = DirectMaterialAssignment.objects.get(pk=pk, teacher=teacher)
        except DirectMaterialAssignment.DoesNotExist:
            return Response({"error": "Не найдено."}, status=status.HTTP_404_NOT_FOUND)
        da.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
