from django.db.models import Count, Prefetch, Q
from django.core.files.storage import default_storage
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .choices import (
    GroupStatus,
    InvitationStatus,
    PlanItemStatus,
    PlanStatus,
    ReviewStatus,
    StudentStatus,
    SubmissionStatus,
)
from .subscription_service import LimitExceeded, SubscriptionLimitService
from .invitations import (
    accept_student_invitation,
    create_student_invitation,
    get_invitation_by_token,
    invitation_preview_payload,
    mark_expired_invitations,
)
from .models import (
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
    TeacherSavedMaterial,
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
    http_method_names = ["get", "put", "patch", "delete", "head", "options"]

    def get_queryset(self):
        qs = Student.objects.filter(teacher=self.get_teacher()).prefetch_related("groups")
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
        student = self.get_object()
        student.status = StudentStatus.ARCHIVED
        student.save(update_fields=["status", "updated_at"])
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["patch"], url_path="archive")
    def archive(self, request, pk=None):
        student = self.get_object()
        student.status = StudentStatus.ARCHIVED
        student.save(update_fields=["status", "updated_at"])
        return Response(StudentDetailSerializer(student).data)


class StudentInvitationViewSet(TeacherScopedMixin, mixins.ListModelMixin, mixins.CreateModelMixin, viewsets.GenericViewSet):
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


class InvitationPreviewView(APIView):
    permission_classes = [AllowAny]

    def get(self, request, token):
        invitation = get_invitation_by_token(token)
        if invitation is None:
            return Response({"error": "Приглашение недействительно или истекло."}, status=404)
        return Response(invitation_preview_payload(invitation))


class InvitationAcceptView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, token):
        try:
            student, invitation = accept_student_invitation(token, request.user)
        except ValueError as exc:
            return Response({"error": str(exc)}, status=400)
        return Response({
            "ok": True,
            "student_id": student.id,
            "teacher_id": invitation.teacher_id,
            "group_id": invitation.group_id,
        })


class StudentGroupViewSet(TeacherScopedMixin, viewsets.ModelViewSet):
    def get_queryset(self):
        qs = StudentGroup.objects.filter(teacher=self.get_teacher()).annotate(
            students_count=Count("students")
        )
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

        return qs.prefetch_related("students").order_by("title")

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
            students_count=Count("students")
        ).first()
        return Response(StudentGroupListSerializer(group).data, status=status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        partial = kwargs.pop("partial", False)
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        group = StudentGroup.objects.filter(pk=instance.pk).annotate(
            students_count=Count("students")
        ).first()
        return Response(StudentGroupListSerializer(group).data)

    @action(detail=True, methods=["post"], url_path="add-student")
    def add_student(self, request, pk=None):
        group = self.get_object()
        student_id = request.data.get("student_id")
        student = get_object_or_404(Student, pk=student_id, teacher=self.get_teacher())
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
        qs = Lesson.objects.filter(teacher=self.get_teacher())
        params = self.request.query_params
        for field in ("direction", "exam_type", "status", "lesson_type"):
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
        ).annotate(items_count=Count("items")).prefetch_related(
            Prefetch(
                "items",
                queryset=LessonPlanItem.objects.select_related(
                    "linked_lesson",
                    "scheduled_event",
                ).prefetch_related("materials").order_by("order", "id"),
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
        serializer.save(teacher=self.get_teacher())

    def update(self, request, *args, **kwargs):
        plan = self.get_object()
        # Нельзя редактировать публичные планы через кабинет учителя
        if plan.teacher is None:
            return Response(
                {"detail": "Публичный план нельзя изменить. Сделайте копию для редактирования."},
                status=status.HTTP_403_FORBIDDEN,
            )
        if plan.teacher_id != self.get_teacher().id:
            return Response({"detail": "Нет доступа."}, status=status.HTTP_403_FORBIDDEN)
        return super().update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        plan = self.get_object()
        if plan.teacher is None or plan.teacher_id != self.get_teacher().id:
            return Response({"detail": "Нет доступа."}, status=status.HTTP_403_FORBIDDEN)
        return super().destroy(request, *args, **kwargs)

    @action(detail=True, methods=["post"], url_path="copy")
    def copy(self, request, pk=None):
        """Сохранить публичный или чужой план в личный кабинет учителя."""
        source = self.get_object()
        teacher = self.get_teacher()
        if source.teacher_id == teacher.id:
            return Response(
                {"detail": "Это уже ваш план."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        new_plan = _copy_lesson_plan(source, teacher)
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
        return Response(LessonPlanItemSerializer(item).data)

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
        for entry in order_map:
            item_id = entry.get("id")
            order = entry.get("order")
            if item_id is None or order is None:
                continue
            LessonPlanItem.objects.filter(
                pk=item_id,
                plan__teacher=self.get_teacher(),
            ).update(order=order)
        return Response({"ok": True})


class LessonPlanEnrollmentViewSet(TeacherScopedMixin, viewsets.ModelViewSet):
    """Назначения планов уроков ученикам / группам."""

    def get_queryset(self):
        qs = LessonPlanEnrollment.objects.filter(
            teacher=self.get_teacher()
        ).select_related("plan", "student", "group")
        plan_id = self.request.query_params.get("plan")
        if plan_id:
            qs = qs.filter(plan_id=plan_id)
        student_id = self.request.query_params.get("student")
        if student_id:
            qs = qs.filter(student_id=student_id)
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
        if student:
            get_object_or_404(Student, pk=student.pk, teacher=self.get_teacher())
        if group:
            get_object_or_404(StudentGroup, pk=group.pk, teacher=self.get_teacher())
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
        qs = Interactive.objects.filter(teacher=self.get_teacher())
        params = self.request.query_params
        for field in ("direction", "exam_type", "status", "interactive_type"):
            value = params.get(field)
            if value:
                qs = qs.filter(**{field: value})
        search = (params.get("search") or "").strip()
        if search:
            qs = qs.filter(title__icontains=search)
        return qs.order_by("-updated_at")

    def get_serializer_class(self):
        if self.action == "retrieve":
            return InteractiveDetailSerializer
        if self.action in ("create", "update", "partial_update"):
            return InteractiveWriteSerializer
        return InteractiveListSerializer

    def create(self, request, *args, **kwargs):
        try:
            SubscriptionLimitService.raise_if_interactive_limit_reached(self.get_teacher())
        except LimitExceeded as exc:
            return Response(exc.to_dict(), status=status.HTTP_403_FORBIDDEN)
        return super().create(request, *args, **kwargs)

    def perform_create(self, serializer):
        serializer.save(teacher=self.get_teacher())

    @action(detail=True, methods=["post"], url_path="publish")
    def publish(self, request, pk=None):
        interactive = self.get_object()
        interactive.status = "published"
        interactive.save(update_fields=["status", "updated_at"])
        return Response(InteractiveDetailSerializer(interactive).data)

    @action(detail=True, methods=["post"], url_path="assign")
    def assign(self, request, pk=None):
        interactive = self.get_object()
        data = {**request.data, "interactive": interactive.pk}
        serializer = InteractiveAssignmentSerializer(data=data)
        serializer.is_valid(raise_exception=True)
        assignment = serializer.save(teacher=self.get_teacher())
        return Response(InteractiveAssignmentSerializer(assignment).data, status=status.HTTP_201_CREATED)


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
        attempt = serializer.save()
        if attempt.score_percent is not None:
            attempt.status = "completed"
            attempt.completed_at = timezone.now()
            attempt.save(update_fields=["status", "completed_at"])


class ReviewViewSet(TeacherScopedMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    serializer_class = ReviewItemSerializer

    def get_queryset(self):
        qs = ReviewItem.objects.filter(teacher=self.get_teacher()).select_related("student", "group")
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
        )
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
        )
        item.refresh_from_db()
        return Response(ReviewItemSerializer(item).data)

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
    ):
        if item.source_type == "homework":
            submission = HomeworkSubmission.objects.filter(pk=item.source_id).first()
            if submission:
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
                if changed_payload:
                    from .homework_api import compute_score_percent

                    submission.result_payload = payload
                    computed = compute_score_percent(payload)
                    if computed is not None:
                        submission.score = computed
                    update_fields.extend(["result_payload", "score"])
                submission.save(update_fields=update_fields)


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

    def perform_create(self, serializer):
        serializer.save(teacher=self.get_teacher())

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
        material = self.get_object()
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
        material = self.get_object()
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


class ReportsOverviewView(TeacherScopedMixin, APIView):
    def get(self, request):
        teacher = request.user
        return Response({
            "students_total": Student.objects.filter(teacher=teacher).count(),
            "groups_total": StudentGroup.objects.filter(teacher=teacher).count(),
            "lessons_total": Lesson.objects.filter(teacher=teacher).count(),
            "homework_assigned": Homework.objects.filter(teacher=teacher, status="assigned").count(),
            "homework_completed": Homework.objects.filter(teacher=teacher, status="completed").count(),
            "pending_reviews": ReviewItem.objects.filter(teacher=teacher, status=ReviewStatus.PENDING).count(),
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
        student_ids = group.students.values_list("id", flat=True)
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
