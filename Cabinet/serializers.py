from calendar import monthrange
from datetime import datetime

from django.db.models import Count, Q
from django.utils import timezone
from rest_framework import serializers

from .choices import (
    EnrollmentStatus,
    InvitationStatus,
    MaterialType,
    PlanItemStatus,
    PlanStatus,
    ReviewStatus,
    StudentStatus,
    SubmissionStatus,
)
from .invitations import invitation_join_path
from .plan_subjects import (
    get_plan_subject_label,
    get_plan_subject_options,
    normalize_plan_subject_id,
)
from .models import (
    FlashcardItem,
    Homework,
    HomeworkSubmission,
    HomeworkTask,
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
    MatchingPair,
    Material,
    OrderingItem,
    QuizQuestion,
    WheelSegment,
    ReviewItem,
    ScheduleEvent,
    ScheduleEventChangeLog,
    ScheduleEventParticipant,
    ScheduleEventSeries,
    Notification,
    Student,
    StudentGroup,
    StudentInvitation,
    TeacherSavedMaterial,
)


class StudentListSerializer(serializers.ModelSerializer):
    full_name = serializers.CharField(read_only=True)
    direction_label = serializers.CharField(source="get_direction_display", read_only=True)
    status_label = serializers.CharField(source="get_status_display", read_only=True)
    group_ids = serializers.SerializerMethodField()
    is_registered = serializers.BooleanField(read_only=True)

    class Meta:
        model = Student
        fields = [
            "id",
            "first_name",
            "last_name",
            "full_name",
            "email",
            "phone",
            "parent_contact",
            "direction",
            "direction_label",
            "grade",
            "status",
            "status_label",
            "notes",
            "group_ids",
            "is_registered",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["created_at", "updated_at"]

    def get_group_ids(self, obj):
        return list(obj.groups.filter(status="active").values_list("id", flat=True))


class StudentDetailSerializer(StudentListSerializer):
    groups = serializers.SerializerMethodField()

    class Meta(StudentListSerializer.Meta):
        fields = StudentListSerializer.Meta.fields + ["groups"]

    def get_groups(self, obj):
        return [
            {"id": g.id, "title": g.title}
            for g in obj.groups.filter(status="active")
        ]


class StudentWriteSerializer(serializers.ModelSerializer):
    class Meta:
        model = Student
        fields = [
            "first_name",
            "last_name",
            "email",
            "phone",
            "parent_contact",
            "direction",
            "grade",
            "status",
            "notes",
        ]

    def validate(self, attrs):
        instance = getattr(self, "instance", None)
        if instance and instance.is_registered:
            blocked = {"first_name", "last_name", "email"}
            if blocked.intersection(attrs.keys()):
                raise serializers.ValidationError(
                    "Имя и email зарегистрированного ученика меняет сам ученик в профиле."
                )
        return attrs


class StudentInvitationSerializer(serializers.ModelSerializer):
    status_label = serializers.CharField(source="get_status_display", read_only=True)
    direction_label = serializers.CharField(source="get_direction_display", read_only=True)
    group_title = serializers.SerializerMethodField()
    join_path = serializers.SerializerMethodField()

    class Meta:
        model = StudentInvitation
        fields = [
            "id",
            "token",
            "first_name",
            "last_name",
            "email",
            "direction",
            "direction_label",
            "grade",
            "message",
            "status",
            "status_label",
            "group",
            "group_title",
            "join_path",
            "expires_at",
            "accepted_at",
            "created_at",
        ]
        read_only_fields = [
            "id",
            "token",
            "status",
            "join_path",
            "accepted_at",
            "created_at",
        ]

    def get_group_title(self, obj):
        return obj.group.title if obj.group_id else None

    def get_join_path(self, obj):
        return invitation_join_path(obj.token)


class StudentInvitationCreateSerializer(serializers.Serializer):
    first_name = serializers.CharField(required=False, allow_blank=True, max_length=100)
    last_name  = serializers.CharField(required=False, allow_blank=True, max_length=100)
    email = serializers.EmailField(required=False, allow_blank=True)
    group_id = serializers.IntegerField(required=False, allow_null=True)
    direction = serializers.ChoiceField(
        choices=[c[0] for c in Student._meta.get_field("direction").choices],
        required=False,
        default="other",
    )
    grade = serializers.IntegerField(required=False, allow_null=True, min_value=1, max_value=11)
    message = serializers.CharField(required=False, allow_blank=True, max_length=255)


class StudentGroupListSerializer(serializers.ModelSerializer):
    direction_label = serializers.CharField(source="get_direction_display", read_only=True)
    exam_type_label = serializers.CharField(source="get_exam_type_display", read_only=True)
    status_label = serializers.CharField(source="get_status_display", read_only=True)
    students_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = StudentGroup
        fields = [
            "id",
            "title",
            "description",
            "direction",
            "direction_label",
            "exam_type",
            "exam_type_label",
            "status",
            "status_label",
            "students_count",
            "created_at",
            "updated_at",
        ]


class StudentGroupDetailSerializer(StudentGroupListSerializer):
    students = StudentListSerializer(many=True, read_only=True)
    student_ids = serializers.PrimaryKeyRelatedField(
        many=True,
        queryset=Student.objects.all(),
        source="students",
        write_only=True,
        required=False,
    )

    class Meta(StudentGroupListSerializer.Meta):
        fields = StudentGroupListSerializer.Meta.fields + ["students", "student_ids"]


class StudentGroupWriteSerializer(serializers.ModelSerializer):
    class Meta:
        model = StudentGroup
        fields = [
            "title",
            "description",
            "direction",
            "exam_type",
            "status",
        ]


class MaterialListSerializer(serializers.ModelSerializer):
    material_type_label = serializers.CharField(source="get_material_type_display", read_only=True)
    direction_label = serializers.CharField(source="get_direction_display", read_only=True)
    is_saved = serializers.SerializerMethodField()
    file_url = serializers.SerializerMethodField()
    is_own = serializers.SerializerMethodField()

    class Meta:
        model = Material
        fields = [
            "id",
            "title",
            "description",
            "material_type",
            "material_type_label",
            "direction",
            "direction_label",
            "exam_type",
            "topic",
            "subtopic",
            "task_number",
            "difficulty",
            "external_url",
            "file_url",
            "is_public",
            "is_own",
            "status",
            "is_saved",
            "created_at",
        ]

    def get_file_url(self, obj):
        return obj.file.url if obj.file else ""

    def get_is_own(self, obj):
        teacher = self.context.get("teacher")
        return bool(teacher and obj.teacher_id == teacher.id)

    def get_is_saved(self, obj):
        teacher = self.context.get("teacher")
        if not teacher:
            return False
        return TeacherSavedMaterial.objects.filter(teacher=teacher, material=obj).exists()


class MaterialDetailSerializer(MaterialListSerializer):
    class Meta(MaterialListSerializer.Meta):
        fields = MaterialListSerializer.Meta.fields + ["content", "file"]


HOMEWORK_MATERIAL_TYPES = {
    MaterialType.FILE,
    MaterialType.LINK,
    MaterialType.PRESENTATION,
    MaterialType.TASK_SET,
    MaterialType.LESSON,
}

LESSON_MATERIAL_TYPES = {
    MaterialType.FILE,
    MaterialType.LINK,
    MaterialType.PRESENTATION,
    MaterialType.TASK_SET,
    MaterialType.LESSON,
}


class MaterialWriteSerializer(serializers.ModelSerializer):
    class Meta:
        model = Material
        fields = [
            "title",
            "description",
            "material_type",
            "external_url",
            "file",
            "topic",
            "subtopic",
        ]

    def validate_material_type(self, value):
        if value not in HOMEWORK_MATERIAL_TYPES:
            raise serializers.ValidationError(
                "Можно добавить файл, ссылку, презентацию, вариант или урок."
            )
        return value

    def validate(self, attrs):
        material_type = attrs.get("material_type") or MaterialType.FILE
        external_url = (attrs.get("external_url") or "").strip()
        uploaded_file = attrs.get("file")
        if material_type in {MaterialType.LINK, MaterialType.TASK_SET, MaterialType.LESSON} and not external_url:
            raise serializers.ValidationError({"external_url": "Укажите ссылку."})
        if material_type in {MaterialType.FILE, MaterialType.PRESENTATION} and not uploaded_file and not external_url:
            raise serializers.ValidationError({"file": "Загрузите файл."})
        return attrs

    def create(self, validated_data):
        teacher = validated_data.pop("teacher", None) or self.context.get("teacher")
        material_type = validated_data.get("material_type")
        external_url = (validated_data.get("external_url") or "").strip()
        if material_type == MaterialType.LESSON and external_url:
            material, _ = Material.objects.get_or_create(
                teacher=teacher,
                material_type=MaterialType.LESSON,
                external_url=external_url,
                defaults={**validated_data, "teacher": teacher},
            )
            return material
        return Material.objects.create(teacher=teacher, **validated_data)


def _interactive_attachment_json(interactive):
    return {
        "id": interactive.id,
        "title": interactive.title,
        "interactiveType": interactive.interactive_type,
        "interactiveTypeLabel": interactive.get_interactive_type_display(),
        "topic": interactive.topic or "",
        "subtopic": interactive.subtopic or "",
    }


def _material_attachment_json(material):
    return {
        "id": material.id,
        "title": material.title,
        "description": material.description or "",
        "material_type": material.material_type,
        "material_type_label": material.get_material_type_display(),
        "topic": material.topic or "",
        "subtopic": material.subtopic or "",
        "external_url": material.external_url or "",
        "file_url": material.file.url if material.file else "",
    }


class LessonListSerializer(serializers.ModelSerializer):
    direction_label = serializers.CharField(source="get_direction_display", read_only=True)
    status_label = serializers.CharField(source="get_status_display", read_only=True)
    lesson_type_label = serializers.CharField(source="get_lesson_type_display", read_only=True)

    class Meta:
        model = Lesson
        fields = [
            "id",
            "title",
            "description",
            "direction",
            "direction_label",
            "exam_type",
            "topic",
            "subtopic",
            "task_number",
            "duration_minutes",
            "status",
            "status_label",
            "lesson_type",
            "lesson_type_label",
            "created_at",
            "updated_at",
        ]


class LessonDetailSerializer(LessonListSerializer):
    material_ids = serializers.PrimaryKeyRelatedField(
        many=True,
        queryset=Material.objects.all(),
        source="materials",
        required=False,
    )

    class Meta(LessonListSerializer.Meta):
        fields = LessonListSerializer.Meta.fields + [
            "theory_content",
            "practice_content",
            "homework_description",
            "material_ids",
        ]


class LessonWriteSerializer(serializers.ModelSerializer):
    material_ids = serializers.PrimaryKeyRelatedField(
        many=True,
        queryset=Material.objects.all(),
        source="materials",
        required=False,
    )

    class Meta:
        model = Lesson
        fields = [
            "title",
            "description",
            "direction",
            "exam_type",
            "topic",
            "subtopic",
            "task_number",
            "duration_minutes",
            "status",
            "lesson_type",
            "theory_content",
            "practice_content",
            "homework_description",
            "material_ids",
        ]


class LessonAssignmentSerializer(serializers.ModelSerializer):
    lesson_title = serializers.CharField(source="lesson.title", read_only=True)
    student_name = serializers.CharField(source="student.full_name", read_only=True)
    group_title = serializers.CharField(source="group.title", read_only=True)

    class Meta:
        model = LessonAssignment
        fields = [
            "id",
            "lesson",
            "lesson_title",
            "student",
            "student_name",
            "group",
            "group_title",
            "assigned_at",
            "due_at",
            "status",
            "comment",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["assigned_at", "created_at", "updated_at"]

    def validate(self, attrs):
        student = attrs.get("student")
        group = attrs.get("group")
        if bool(student) == bool(group):
            raise serializers.ValidationError("Укажите либо ученика, либо группу.")
        return attrs


class LessonPlanItemSerializer(serializers.ModelSerializer):
    status_label = serializers.CharField(source="get_status_display", read_only=True)
    linked_lesson_title = serializers.SerializerMethodField()
    scheduled_event_title = serializers.SerializerMethodField()
    scheduled_event_starts_at = serializers.DateTimeField(
        source="scheduled_event.starts_at",
        read_only=True,
        allow_null=True,
    )
    materials = serializers.SerializerMethodField()
    attached_interactives = serializers.SerializerMethodField()
    homework_materials = serializers.SerializerMethodField()
    homework_interactives = serializers.SerializerMethodField()

    class Meta:
        model = LessonPlanItem
        fields = [
            "id",
            "order",
            "title",
            "topic",
            "subtopic",
            "task_number",
            "goal",
            "planned_results",
            "description",
            "linked_lesson",
            "linked_lesson_title",
            "lesson_materials_notes",
            "materials",
            "attached_interactives",
            "homework_materials",
            "homework_interactives",
            "homework_description",
            "scheduled_event",
            "scheduled_event_title",
            "scheduled_event_starts_at",
            "status",
            "status_label",
            "scheduled_date",
            "completed_at",
            "teacher_comment",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["created_at", "updated_at"]

    def get_linked_lesson_title(self, obj):
        if obj.linked_lesson_id:
            return obj.linked_lesson.title
        return None

    def get_scheduled_event_title(self, obj):
        if obj.scheduled_event_id:
            return obj.scheduled_event.title
        return None

    def get_materials(self, obj):
        return [
            _material_attachment_json(material)
            for material in obj.materials.all()
        ]

    def get_attached_interactives(self, obj):
        return [
            _interactive_attachment_json(interactive)
            for interactive in obj.attached_interactives.all()
        ]

    def get_homework_materials(self, obj):
        return [
            _material_attachment_json(material)
            for material in obj.homework_materials.all()
        ]

    def get_homework_interactives(self, obj):
        return [
            _interactive_attachment_json(interactive)
            for interactive in obj.homework_interactives.all()
        ]


class LessonPlanItemWriteSerializer(serializers.ModelSerializer):
    material_ids = serializers.PrimaryKeyRelatedField(
        many=True,
        queryset=Material.objects.all(),
        source="materials",
        required=False,
    )
    interactive_ids = serializers.PrimaryKeyRelatedField(
        many=True,
        queryset=Interactive.objects.all(),
        source="attached_interactives",
        required=False,
    )
    homework_material_ids = serializers.PrimaryKeyRelatedField(
        many=True,
        queryset=Material.objects.all(),
        source="homework_materials",
        required=False,
    )
    homework_interactive_ids = serializers.PrimaryKeyRelatedField(
        many=True,
        queryset=Interactive.objects.all(),
        source="homework_interactives",
        required=False,
    )

    class Meta:
        model = LessonPlanItem
        fields = [
            "material_ids",
            "interactive_ids",
            "homework_material_ids",
            "homework_interactive_ids",
            "linked_lesson",
            "lesson_materials_notes",
            "homework_description",
            "teacher_comment",
        ]

    def _teacher(self):
        return self.context.get("teacher")

    def _validate_teacher_materials(self, materials, *, allowed_types, label):
        teacher = self._teacher()
        if not teacher or not materials:
            return materials
        requested_ids = [material.pk for material in materials]
        allowed_ids = set(
            Material.objects.filter(
                teacher=teacher,
                material_type__in=allowed_types,
            ).filter(pk__in=requested_ids).values_list("pk", flat=True)
        )
        invalid_ids = [pk for pk in requested_ids if pk not in allowed_ids]
        if invalid_ids:
            raise serializers.ValidationError(
                f"{label}: можно прикреплять только свои материалы допустимых типов."
            )
        return materials

    def _validate_teacher_interactives(self, interactives, *, label):
        teacher = self._teacher()
        if not teacher or not interactives:
            return interactives
        requested_ids = [interactive.pk for interactive in interactives]
        allowed_ids = set(
            Interactive.objects.filter(
                teacher=teacher,
                pk__in=requested_ids,
            ).values_list("pk", flat=True)
        )
        invalid_ids = [pk for pk in requested_ids if pk not in allowed_ids]
        if invalid_ids:
            raise serializers.ValidationError(f"{label}: можно прикреплять только свои интерактивы.")
        return interactives

    def validate_material_ids(self, materials):
        return self._validate_teacher_materials(
            materials,
            allowed_types=LESSON_MATERIAL_TYPES,
            label="Материалы на уроке",
        )

    def validate_homework_material_ids(self, materials):
        return self._validate_teacher_materials(
            materials,
            allowed_types=HOMEWORK_MATERIAL_TYPES,
            label="Материалы к ДЗ",
        )

    def validate_interactive_ids(self, interactives):
        return self._validate_teacher_interactives(interactives, label="Интерактивы на уроке")

    def validate_homework_interactive_ids(self, interactives):
        return self._validate_teacher_interactives(interactives, label="Интерактивы к ДЗ")


class LessonPlanItemEditorSerializer(LessonPlanItemWriteSerializer):
    class Meta(LessonPlanItemWriteSerializer.Meta):
        fields = LessonPlanItemWriteSerializer.Meta.fields + [
            "order",
            "title",
            "topic",
            "subtopic",
            "task_number",
            "goal",
            "planned_results",
            "description",
        ]


class LessonPlanListSerializer(serializers.ModelSerializer):
    direction_label = serializers.CharField(source="get_direction_display", read_only=True)
    subject_label = serializers.SerializerMethodField()
    status_label = serializers.CharField(source="get_status_display", read_only=True)
    progress_percent = serializers.IntegerField(read_only=True)
    items_count = serializers.IntegerField(read_only=True)
    is_public = serializers.SerializerMethodField()

    class Meta:
        model = LessonPlan
        fields = [
            "id",
            "title",
            "description",
            "goal",
            "direction",
            "direction_label",
            "subject",
            "subject_label",
            "exam_type",
            "grade",
            "lessons_count",
            "status",
            "status_label",
            "progress_percent",
            "items_count",
            "is_public",
            "created_at",
            "updated_at",
        ]

    def get_is_public(self, obj):
        return obj.teacher is None

    def get_subject_label(self, obj):
        return get_plan_subject_label(obj.subject)


class LessonPlanDetailSerializer(LessonPlanListSerializer):
    items = LessonPlanItemSerializer(many=True, read_only=True)

    class Meta(LessonPlanListSerializer.Meta):
        fields = LessonPlanListSerializer.Meta.fields + ["items"]


class LessonPlanWriteSerializer(serializers.ModelSerializer):
    is_public = serializers.BooleanField(required=False, write_only=True)
    subject = serializers.CharField(max_length=20)

    class Meta:
        model = LessonPlan
        fields = [
            "id",
            "title",
            "description",
            "goal",
            "direction",
            "subject",
            "exam_type",
            "grade",
            "lessons_count",
            "status",
            "is_public",
        ]
        read_only_fields = ["id"]

    def validate_subject(self, value):
        subject_id = normalize_plan_subject_id(value)
        if not subject_id:
            raise serializers.ValidationError("Выберите предмет.")

        allowed_ids = {item["id"] for item in get_plan_subject_options()}
        if allowed_ids and subject_id not in allowed_ids:
            raise serializers.ValidationError("Выберите предмет из списка базы.")
        return subject_id


class LessonPlanEnrollmentSerializer(serializers.ModelSerializer):
    plan_title = serializers.CharField(source="plan.title", read_only=True)
    student_name = serializers.SerializerMethodField()
    group_name = serializers.SerializerMethodField()
    status_label = serializers.CharField(source="get_status_display", read_only=True)
    format_label = serializers.CharField(source="get_format_display", read_only=True)

    class Meta:
        model = LessonPlanEnrollment
        fields = [
            "id",
            "plan",
            "plan_title",
            "student",
            "student_name",
            "group",
            "group_name",
            "format",
            "format_label",
            "start_date",
            "end_date",
            "frequency",
            "status",
            "status_label",
            "notes",
            "created_at",
            "updated_at",
        ]

    def get_student_name(self, obj):
        if obj.student:
            return f"{obj.student.first_name} {obj.student.last_name}".strip()
        return None

    def get_group_name(self, obj):
        return obj.group.title if obj.group else None


class LessonPlanEnrollmentWriteSerializer(serializers.ModelSerializer):
    class Meta:
        model = LessonPlanEnrollment
        fields = [
            "plan",
            "student",
            "group",
            "format",
            "start_date",
            "end_date",
            "frequency",
            "status",
            "notes",
        ]

    def validate_plan(self, plan):
        if plan.status == PlanStatus.DRAFT:
            raise serializers.ValidationError(
                "Черновик плана нельзя назначить ученику или группе. Сначала опубликуйте план."
            )
        return plan

    def validate(self, data):
        student = data["student"] if "student" in data else getattr(self.instance, "student", None)
        group = data["group"] if "group" in data else getattr(self.instance, "group", None)
        if not student and not group:
            raise serializers.ValidationError("Укажите ученика или группу.")
        if student and group:
            raise serializers.ValidationError("Укажите либо ученика, либо группу.")

        plan = data.get("plan") or getattr(self.instance, "plan", None)
        status = data.get("status", getattr(self.instance, "status", EnrollmentStatus.ACTIVE))
        if (
            plan
            and plan.status == PlanStatus.DRAFT
            and status in (EnrollmentStatus.ACTIVE, EnrollmentStatus.PAUSED)
        ):
            raise serializers.ValidationError({
                "plan": "Черновик плана нельзя назначить ученику или группе. Сначала опубликуйте план.",
            })
        return data


class InteractiveBackgroundSerializer(serializers.ModelSerializer):
    background_image_url = serializers.SerializerMethodField()

    class Meta:
        model = InteractiveBackground
        fields = [
            "id",
            "slug",
            "name",
            "css_background",
            "background_image_url",
            "text_tone",
            "is_default",
        ]

    def get_background_image_url(self, obj):
        if obj.background_image:
            return obj.background_image.url
        return ""


class InteractiveCardStyleSerializer(serializers.ModelSerializer):
    class Meta:
        model = InteractiveCardStyle
        fields = ["id", "slug", "name", "css_class", "description", "is_default"]


class InteractiveSoundPackSerializer(serializers.ModelSerializer):
    sounds = serializers.SerializerMethodField()

    class Meta:
        model = InteractiveSoundPack
        fields = ["id", "slug", "name", "description", "config", "sounds", "is_default"]

    def get_sounds(self, obj):
        mapping = {
            "flip": obj.sound_flip,
            "correct": obj.sound_correct,
            "wrong": obj.sound_wrong,
            "next": obj.sound_next,
            "end": obj.sound_end,
            "background": obj.sound_background,
        }
        result = {}
        for key, field in mapping.items():
            if field:
                result[key] = field.url
        return result


class InteractiveAppearanceCatalogSerializer(serializers.Serializer):
    backgrounds = InteractiveBackgroundSerializer(many=True)
    card_styles = InteractiveCardStyleSerializer(many=True)
    sound_packs = InteractiveSoundPackSerializer(many=True)


class FlashcardItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = FlashcardItem
        fields = [
            "id",
            "front_text",
            "back_text",
            "front_image_url",
            "back_image_url",
            "hint",
            "explanation",
            "order",
        ]


class MatchingPairSerializer(serializers.ModelSerializer):
    class Meta:
        model = MatchingPair
        fields = [
            "id",
            "left_text",
            "right_text",
            "left_image_url",
            "right_image_url",
            "explanation",
            "order",
        ]


class OrderingItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = OrderingItem
        fields = ["id", "text", "image_url", "correct_order", "explanation"]


class QuizQuestionSerializer(serializers.ModelSerializer):
    class Meta:
        model = QuizQuestion
        fields = [
            "id",
            "question_text",
            "image_url",
            "answers",
            "answer_type",
            "explanation",
            "points",
            "order",
        ]


class WheelSegmentSerializer(serializers.ModelSerializer):
    id = serializers.CharField(source="external_id", required=False, allow_blank=True)

    class Meta:
        model = WheelSegment
        fields = ["id", "title", "description", "color", "points", "order"]


class InteractiveListSerializer(serializers.ModelSerializer):
    interactive_type_label = serializers.CharField(source="get_interactive_type_display", read_only=True)
    status_label = serializers.CharField(source="get_status_display", read_only=True)
    items_count = serializers.SerializerMethodField()
    background = InteractiveBackgroundSerializer(read_only=True)
    card_style = InteractiveCardStyleSerializer(read_only=True)
    sound_pack = InteractiveSoundPackSerializer(read_only=True)

    class Meta:
        model = Interactive
        fields = [
            "id",
            "title",
            "description",
            "interactive_type",
            "interactive_type_label",
            "direction",
            "exam_type",
            "topic",
            "subtopic",
            "task_number",
            "difficulty",
            "instruction",
            "background",
            "card_style",
            "sound_pack",
            "sound_enabled",
            "status",
            "status_label",
            "items_count",
            "created_at",
            "updated_at",
        ]

    def get_items_count(self, obj):
        if obj.interactive_type == "flashcards":
            return obj.flashcards.count()
        if obj.interactive_type == "matching":
            return obj.matching_pairs.count()
        if obj.interactive_type == "ordering":
            return obj.ordering_items.count()
        if obj.interactive_type == "quiz":
            return obj.quiz_questions.count()
        if obj.interactive_type == "wheel":
            return obj.wheel_segments.count()
        return 0


class InteractiveDetailSerializer(InteractiveListSerializer):
    flashcards = FlashcardItemSerializer(many=True, read_only=True)
    matching_pairs = MatchingPairSerializer(many=True, read_only=True)
    ordering_items = OrderingItemSerializer(many=True, read_only=True)
    quiz_questions = QuizQuestionSerializer(many=True, read_only=True)
    wheel_segments = WheelSegmentSerializer(many=True, read_only=True)

    class Meta(InteractiveListSerializer.Meta):
        fields = InteractiveListSerializer.Meta.fields + [
            "wheel_settings",
            "flashcards",
            "matching_pairs",
            "ordering_items",
            "quiz_questions",
            "wheel_segments",
        ]


class LenientSlugRelatedField(serializers.SlugRelatedField):
    """Unknown/empty slug values are treated as null for soft-fallbacks."""

    def to_internal_value(self, data):
        if data in (None, ""):
            return None
        if isinstance(data, str) and data.strip() == "":
            return None
        try:
            return super().to_internal_value(data)
        except serializers.ValidationError:
            return None


class InteractiveWriteSerializer(serializers.ModelSerializer):
    flashcards = FlashcardItemSerializer(many=True, required=False)
    matching_pairs = MatchingPairSerializer(many=True, required=False)
    ordering_items = OrderingItemSerializer(many=True, required=False)
    quiz_questions = QuizQuestionSerializer(many=True, required=False)
    wheel_segments = WheelSegmentSerializer(many=True, required=False)
    background_slug = LenientSlugRelatedField(
        slug_field="slug",
        queryset=InteractiveBackground.objects.filter(is_active=True),
        source="background",
        required=False,
        allow_null=True,
    )
    card_style_slug = LenientSlugRelatedField(
        slug_field="slug",
        queryset=InteractiveCardStyle.objects.filter(is_active=True),
        source="card_style",
        required=False,
        allow_null=True,
    )
    sound_pack_slug = LenientSlugRelatedField(
        slug_field="slug",
        queryset=InteractiveSoundPack.objects.filter(is_active=True),
        source="sound_pack",
        required=False,
        allow_null=True,
    )

    class Meta:
        model = Interactive
        fields = [
            "title",
            "description",
            "interactive_type",
            "direction",
            "exam_type",
            "topic",
            "subtopic",
            "task_number",
            "difficulty",
            "instruction",
            "background_slug",
            "card_style_slug",
            "sound_pack_slug",
            "sound_enabled",
            "wheel_settings",
            "status",
            "flashcards",
            "matching_pairs",
            "ordering_items",
            "quiz_questions",
            "wheel_segments",
        ]
        extra_kwargs = {
            "title": {"required": False, "allow_blank": True},
        }

    def validate_title(self, value):
        text = (value or "").strip()
        return text or "Без названия"

    def _save_items(self, interactive, validated_data):
        flashcards = validated_data.pop("flashcards", None)
        matching_pairs = validated_data.pop("matching_pairs", None)
        ordering_items = validated_data.pop("ordering_items", None)
        quiz_questions = validated_data.pop("quiz_questions", None)
        wheel_segments = validated_data.pop("wheel_segments", None)

        if flashcards is not None:
            interactive.flashcards.all().delete()
            for item in flashcards:
                FlashcardItem.objects.create(interactive=interactive, **item)
        if matching_pairs is not None:
            interactive.matching_pairs.all().delete()
            for item in matching_pairs:
                MatchingPair.objects.create(interactive=interactive, **item)
        if ordering_items is not None:
            interactive.ordering_items.all().delete()
            for item in ordering_items:
                OrderingItem.objects.create(interactive=interactive, **item)
        if quiz_questions is not None:
            interactive.quiz_questions.all().delete()
            for item in quiz_questions:
                QuizQuestion.objects.create(interactive=interactive, **item)
        if wheel_segments is not None:
            interactive.wheel_segments.all().delete()
            for item in wheel_segments:
                WheelSegment.objects.create(interactive=interactive, **item)

    def create(self, validated_data):
        self._save_items_placeholder = validated_data
        items_data = {
            "flashcards": validated_data.pop("flashcards", None),
            "matching_pairs": validated_data.pop("matching_pairs", None),
            "ordering_items": validated_data.pop("ordering_items", None),
            "quiz_questions": validated_data.pop("quiz_questions", None),
            "wheel_segments": validated_data.pop("wheel_segments", None),
        }
        interactive = Interactive.objects.create(**validated_data)
        self._save_items(interactive, items_data)
        return interactive

    def update(self, instance, validated_data):
        items_data = {
            "flashcards": validated_data.pop("flashcards", None),
            "matching_pairs": validated_data.pop("matching_pairs", None),
            "ordering_items": validated_data.pop("ordering_items", None),
            "quiz_questions": validated_data.pop("quiz_questions", None),
            "wheel_segments": validated_data.pop("wheel_segments", None),
        }
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        self._save_items(instance, items_data)
        return instance


class InteractiveAssignmentSerializer(serializers.ModelSerializer):
    interactive_title = serializers.CharField(source="interactive.title", read_only=True)

    class Meta:
        model = InteractiveAssignment
        fields = [
            "id",
            "interactive",
            "interactive_title",
            "student",
            "group",
            "lesson",
            "lesson_plan_item",
            "assigned_at",
            "due_at",
            "attempts_allowed",
            "show_result_immediately",
            "status",
            "comment",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["assigned_at", "created_at", "updated_at"]

    def validate(self, attrs):
        student = attrs.get("student")
        group = attrs.get("group")
        if self.instance is None and bool(student) == bool(group):
            raise serializers.ValidationError("Укажите либо ученика, либо группу.")
        return attrs


class InteractiveAttemptSerializer(serializers.ModelSerializer):
    class Meta:
        model = InteractiveAttempt
        fields = [
            "id",
            "assignment",
            "student",
            "started_at",
            "completed_at",
            "score_percent",
            "raw_answers",
            "mistakes",
            "attempts_count",
            "status",
        ]
        read_only_fields = ["started_at"]


class HomeworkTaskSerializer(serializers.ModelSerializer):
    class Meta:
        model = HomeworkTask
        fields = [
            "id",
            "task_type",
            "title",
            "description",
            "interactive",
            "task_id",
            "order",
        ]


class HomeworkListSerializer(serializers.ModelSerializer):
    status_label = serializers.CharField(source="get_status_display", read_only=True)

    class Meta:
        model = Homework
        fields = [
            "id",
            "title",
            "description",
            "lesson",
            "lesson_plan_item",
            "student",
            "group",
            "due_at",
            "status",
            "status_label",
            "created_at",
            "updated_at",
        ]


class HomeworkDetailSerializer(HomeworkListSerializer):
    tasks = HomeworkTaskSerializer(many=True, read_only=True)

    class Meta(HomeworkListSerializer.Meta):
        fields = HomeworkListSerializer.Meta.fields + ["tasks"]


class HomeworkSubmissionSerializer(serializers.ModelSerializer):
    student_name = serializers.CharField(source="student.full_name", read_only=True)
    homework_title = serializers.CharField(source="homework.title", read_only=True)
    attached_file_url = serializers.SerializerMethodField()
    attached_file_name = serializers.SerializerMethodField()

    class Meta:
        model = HomeworkSubmission
        fields = [
            "id",
            "homework",
            "homework_title",
            "student",
            "student_name",
            "submitted_at",
            "answer_text",
            "result_payload",
            "attached_file",
            "attached_file_url",
            "attached_file_name",
            "status",
            "score",
            "teacher_comment",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["created_at", "updated_at"]

    def get_attached_file_url(self, obj):
        if obj.attached_file:
            return obj.attached_file.url
        return ""

    def get_attached_file_name(self, obj):
        if obj.attached_file:
            return obj.attached_file.name.split("/")[-1]
        return ""


class ReviewItemSerializer(serializers.ModelSerializer):
    source_type_label = serializers.CharField(source="get_source_type_display", read_only=True)
    status_label = serializers.CharField(source="get_status_display", read_only=True)
    priority_label = serializers.CharField(source="get_priority_display", read_only=True)
    student_name = serializers.CharField(source="student.full_name", read_only=True)
    homework_submission = serializers.SerializerMethodField()
    homework_review = serializers.SerializerMethodField()

    class Meta:
        model = ReviewItem
        fields = [
            "id",
            "student",
            "student_name",
            "group",
            "source_type",
            "source_type_label",
            "source_id",
            "title",
            "status",
            "status_label",
            "priority",
            "priority_label",
            "created_at",
            "checked_at",
            "teacher_comment",
            "homework_submission",
            "homework_review",
        ]

    def get_homework_submission(self, obj):
        if obj.source_type != "homework":
            return None
        submission = HomeworkSubmission.objects.filter(pk=obj.source_id).select_related(
            "homework", "student"
        ).first()
        if not submission:
            return None
        return HomeworkSubmissionSerializer(submission).data

    def get_homework_review(self, obj):
        if obj.source_type != "homework":
            return None
        submission = HomeworkSubmission.objects.filter(pk=obj.source_id).select_related(
            "homework"
        ).first()
        if not submission or not submission.homework_id:
            return None
        from .homework_api import build_homework_review_context

        return build_homework_review_context(submission.homework)


class ScheduleEventParticipantSerializer(serializers.ModelSerializer):
    role_label = serializers.CharField(source="get_role_display", read_only=True)
    status_label = serializers.CharField(source="get_status_display", read_only=True)

    class Meta:
        model = ScheduleEventParticipant
        fields = [
            "id",
            "user",
            "student",
            "teacher",
            "role",
            "role_label",
            "display_name",
            "contact_email",
            "vk_user_id",
            "notification_enabled",
            "status",
            "status_label",
            "created_at",
        ]
        read_only_fields = ["created_at"]


class ScheduleEventSerializer(serializers.ModelSerializer):
    event_type_label = serializers.CharField(source="get_event_type_display", read_only=True)
    status_label = serializers.CharField(source="get_status_display", read_only=True)
    student_name = serializers.CharField(source="student.full_name", read_only=True)
    group_title = serializers.CharField(source="group.title", read_only=True)
    meeting_url = serializers.URLField(read_only=True)
    participants = ScheduleEventParticipantSerializer(many=True, read_only=True)
    series_id = serializers.IntegerField(read_only=True)

    class Meta:
        model = ScheduleEvent
        fields = [
            "id",
            "title",
            "description",
            "topic",
            "starts_at",
            "ends_at",
            "event_type",
            "event_type_label",
            "format",
            "student",
            "student_name",
            "group",
            "group_title",
            "lesson",
            "lesson_plan_item",
            "homework",
            "timezone",
            "telemost_url",
            "meeting_url",
            "meeting_provider",
            "location",
            "audience",
            "materials",
            "status",
            "status_label",
            "teacher_comment",
            "tags",
            "series",
            "series_id",
            "is_recurring_instance",
            "original_start_at",
            "reminder_minutes",
            "participants",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["created_at", "updated_at"]


class ScheduleEventSeriesSerializer(serializers.ModelSerializer):
    event_type_label = serializers.CharField(source="get_event_type_display", read_only=True)
    status_label = serializers.CharField(source="get_status_display", read_only=True)
    recurrence_type_label = serializers.CharField(source="get_recurrence_type_display", read_only=True)

    class Meta:
        model = ScheduleEventSeries
        fields = [
            "id",
            "title",
            "description",
            "event_type",
            "event_type_label",
            "lesson",
            "lesson_plan_item",
            "group",
            "timezone",
            "start_date",
            "start_time",
            "end_time",
            "recurrence_type",
            "recurrence_type_label",
            "recurrence_interval",
            "recurrence_weekdays",
            "recurrence_until",
            "recurrence_count",
            "status",
            "status_label",
            "meeting_url",
            "meeting_provider",
            "format",
            "topic",
            "teacher_comment",
            "reminder_minutes",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["created_at", "updated_at"]


class ScheduleSeriesCreateSerializer(ScheduleEventSeriesSerializer):
    student_ids = serializers.ListField(
        child=serializers.IntegerField(),
        required=False,
        allow_empty=True,
        write_only=True,
    )
    extra_student_ids = serializers.ListField(
        child=serializers.IntegerField(),
        required=False,
        allow_empty=True,
        write_only=True,
    )
    group_id = serializers.IntegerField(required=False, allow_null=True, write_only=True)
    notify_participants = serializers.BooleanField(default=True, write_only=True)

    class Meta(ScheduleEventSeriesSerializer.Meta):
        fields = ScheduleEventSeriesSerializer.Meta.fields + [
            "student_ids",
            "extra_student_ids",
            "group_id",
            "notify_participants",
        ]


class ScheduleEventChangeLogSerializer(serializers.ModelSerializer):
    change_type_label = serializers.CharField(source="get_change_type_display", read_only=True)
    changed_by_name = serializers.SerializerMethodField()

    class Meta:
        model = ScheduleEventChangeLog
        fields = [
            "id",
            "event",
            "series",
            "changed_by",
            "changed_by_name",
            "change_type",
            "change_type_label",
            "old_data",
            "new_data",
            "message",
            "created_at",
        ]
        read_only_fields = fields

    def get_changed_by_name(self, obj):
        if obj.changed_by:
            return obj.changed_by.get_full_name() or obj.changed_by.username
        return ""


class NotificationSerializer(serializers.ModelSerializer):
    url = serializers.SerializerMethodField()
    message = serializers.SerializerMethodField()

    class Meta:
        model = Notification
        fields = [
            "id",
            "channel",
            "title",
            "message",
            "url",
            "payload",
            "status",
            "is_read",
            "created_at",
            "sent_at",
        ]
        read_only_fields = fields

    def get_message(self, obj):
        from .notification_links import strip_open_path_from_message

        return strip_open_path_from_message(obj.message)

    def get_url(self, obj):
        from .notification_links import resolve_notification_url

        return resolve_notification_url(obj, self.context.get("request"))


class DashboardReviewItemSerializer(serializers.ModelSerializer):
    student_name = serializers.CharField(source="student.full_name", read_only=True)
    source_type_label = serializers.CharField(source="get_source_type_display", read_only=True)

    class Meta:
        model = ReviewItem
        fields = [
            "id",
            "student_name",
            "title",
            "source_type",
            "source_type_label",
            "created_at",
            "priority",
        ]


class DashboardSerializer(serializers.Serializer):
    active_students_count = serializers.IntegerField()
    pending_reviews_count = serializers.IntegerField()
    drafts_count = serializers.IntegerField()
    today_lessons_count = serializers.IntegerField()
    attention_items = serializers.ListField()
    today_events = ScheduleEventSerializer(many=True)
    new_submissions = HomeworkSubmissionSerializer(many=True)
    pending_reviews = DashboardReviewItemSerializer(many=True)
    progress_overview = serializers.ListField()
    upcoming_actions = serializers.ListField()
    calendar_event_days = serializers.ListField(child=serializers.IntegerField())


def build_dashboard_payload(teacher):
    today = timezone.localdate()
    now = timezone.now()
    start_of_day = timezone.make_aware(datetime.combine(today, datetime.min.time()))
    end_of_day = timezone.make_aware(datetime.combine(today, datetime.max.time()))

    active_students = Student.objects.filter(
        teacher=teacher,
        status=StudentStatus.ACTIVE,
    )
    pending_reviews = ReviewItem.objects.filter(
        teacher=teacher,
        status=ReviewStatus.PENDING,
    )
    drafts_count = (
        Lesson.objects.filter(teacher=teacher, status="draft").count()
        + LessonPlan.objects.filter(teacher=teacher, status="draft").count()
        + Interactive.objects.filter(teacher=teacher, status="draft").count()
    )
    today_events_qs = ScheduleEvent.objects.filter(
        owner=teacher,
        starts_at__date=today,
    ).exclude(status=ScheduleEvent.Status.CANCELLED).select_related("student", "group")

    new_submissions = HomeworkSubmission.objects.filter(
        homework__teacher=teacher,
        status=SubmissionStatus.SUBMITTED,
    ).select_related("student", "homework").order_by("-submitted_at", "-id")[:5]

    pending_reviews_list = pending_reviews.select_related("student", "group").order_by("-created_at")[:8]

    groups = StudentGroup.objects.filter(teacher=teacher, status="active").annotate(
        students_count=Count("students")
    )[:4]

    progress_overview = [
        {
            "id": g.id,
            "name": g.title,
            "role": f"{g.get_direction_display()} · {g.students_count} уч.",
            "progress": 0,
            "href": f"/cabinet/students",
        }
        for g in groups
    ]

    attention_items = list(
        pending_reviews.values("id", "title", "source_type", "priority")[:5]
    )

    upcoming_actions = list(
        Homework.objects.filter(
            teacher=teacher,
            due_at__gte=now,
            status="assigned",
        ).values("id", "title", "due_at")[:5]
    )

    month_last_day = monthrange(today.year, today.month)[1]
    month_events_qs = ScheduleEvent.objects.filter(
        owner=teacher,
        starts_at__date__gte=today.replace(day=1),
        starts_at__date__lte=today.replace(day=month_last_day),
    ).exclude(status=ScheduleEvent.Status.CANCELLED)
    calendar_event_days = sorted({
        timezone.localtime(ev.starts_at).day
        for ev in month_events_qs.only("starts_at")
    })

    return {
        "active_students_count": active_students.count(),
        "pending_reviews_count": pending_reviews.count(),
        "drafts_count": drafts_count,
        "today_lessons_count": today_events_qs.count(),
        "attention_items": attention_items,
        "today_events": today_events_qs,
        "new_submissions": new_submissions,
        "pending_reviews": pending_reviews_list,
        "progress_overview": progress_overview,
        "upcoming_actions": upcoming_actions,
        "calendar_event_days": calendar_event_days,
    }
