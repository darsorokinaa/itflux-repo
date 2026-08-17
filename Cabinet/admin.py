from django.contrib import admin
from django.contrib.admin.views.decorators import staff_member_required
from django.shortcuts import render
from django.urls import path
from django.utils.html import format_html

from .journal_models import (
    AssessmentCriterion,
    JournalAttentionMarker,
    JournalAuditLog,
    LessonJournal,
    StudentLessonRecord,
)
from .models import (
    AIRequestLog,
    AIUsage,
    AnonymousUsage,
    EventReminderLog,
    LessonPlanEnrollment,
    MeetingAttendance,
    PaymentWebhookEvent,
    PromoCode,
    PromoCodeUsage,
    Receipt,
    ReferralLink,
    ReferralLinkRegistration,
    ReferralReward,
    FlashcardItem,
    Homework,
    HomeworkEditHistory,
    HomeworkSubmission,
    HomeworkSubmissionAttempt,
    HomeworkTask,
    ParentAccessAuditLog,
    ParentInvitation,
    ParentStudentRelationship,
    Interactive,
    InteractiveAssignment,
    InteractiveAttempt,
    InteractiveBackground,
    InteractiveBoard,
    InteractiveBoardAccess,
    InteractiveBoardAsset,
    InteractiveCardStyle,
    InteractiveSoundPack,
    Lesson,
    LessonAssignment,
    LessonPlan,
    LessonPlanItem,
    MatchingPair,
    Material,
    Notification,
    NotificationPreference,
    PushSubscription,
    SeasonalThemePreference,
    OrderingItem,
    QuizQuestion,
    WheelSegment,
    Payment,
    Profile,
    PromoCode,
    PromoCodeUsage,
    Promotion,
    PromotionRedemption,
    Receipt,
    ReviewItem,
    ScheduleEvent,
    ScheduleEventChangeLog,
    ScheduleEventMaterial,
    ScheduleEventParticipant,
    ScheduleEventSeries,
    VideoMeeting,
    Student,
    StudentGroup,
    StudentInvitation,
    StudentNotifyOverride,
    StudentSubject,
    SubscriptionPlanChange,
    TariffPlan,
    TeacherApplication,
    TeacherCommunityFeedback,
    TeacherMonthlyUsage,
    TeacherSavedMaterial,
    TeacherSubscription,
    TelegramConnectToken,
)
from .meeting_screenshare_models import MeetingScreenShareSession


@admin.register(Profile)
class ProfileAdmin(admin.ModelAdmin):
    list_display = ("user", "role", "display_name", "has_avatar_display", "account_active", "account_blocked", "reg_date")
    list_filter = ("role", "account_active", "account_blocked", "email_confirmed")
    search_fields = ("user__username", "user__email", "name", "surname", "display_name")
    ordering = ("-reg_date",)
    readonly_fields = ("avatar_updated_at",)
    exclude = (
        "avatar_encrypted",
        "yandex_oauth_token",
        "yandex_refresh_token",
    )

    @admin.display(boolean=True, description="Аватар")
    def has_avatar_display(self, obj):
        return obj.has_avatar()


@admin.register(TeacherApplication)
class TeacherApplicationAdmin(admin.ModelAdmin):
    list_display = ("name", "contact", "role", "status", "created_at")
    list_filter = ("status", "role", "created_at")
    search_fields = ("name", "contact", "teaches", "comment", "materials_url")
    readonly_fields = ("created_at", "updated_at", "ip_address", "user_agent")
    ordering = ("-created_at",)


@admin.register(TeacherCommunityFeedback)
class TeacherCommunityFeedbackAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "feedback_type",
        "name",
        "contact",
        "subject_area",
        "status",
        "user",
        "created_at",
    )
    list_filter = ("feedback_type", "status", "created_at", "consent_given")
    search_fields = ("name", "contact", "subject_area", "message")
    readonly_fields = ("created_at", "updated_at", "ip_address", "user_agent", "user")
    ordering = ("-created_at",)
    date_hierarchy = "created_at"


@admin.register(Student)
class StudentAdmin(admin.ModelAdmin):
    list_display = ("full_name", "teacher", "user", "direction", "grade", "status", "created_at")
    list_filter = ("direction", "status", "grade")
    search_fields = ("first_name", "last_name", "email", "phone", "user__username", "user__email")
    ordering = ("last_name", "first_name")


@admin.register(StudentSubject)
class StudentSubjectAdmin(admin.ModelAdmin):
    list_display = ("student", "subject", "title", "direction", "status", "created_at")
    list_filter = ("subject", "direction", "status")
    search_fields = (
        "student__first_name",
        "student__last_name",
        "title",
        "subject",
        "level",
    )
    ordering = ("-created_at",)


@admin.register(StudentInvitation)
class StudentInvitationAdmin(admin.ModelAdmin):
    list_display = ("id", "teacher", "group", "email", "status", "expires_at", "created_at")
    list_filter = ("status", "direction")
    search_fields = ("email", "teacher__username", "group__title")
    readonly_fields = ("token", "accepted_at", "created_at", "updated_at")
    ordering = ("-created_at",)


@admin.register(ParentInvitation)
class ParentInvitationAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "student",
        "created_by",
        "invited_name",
        "invited_email",
        "status",
        "expires_at",
        "created_at",
    )
    list_filter = ("status", "relationship_type")
    search_fields = ("invited_email", "invited_name", "short_code", "student__first_name", "student__last_name")
    readonly_fields = ("token_hash", "accepted_at", "created_at", "updated_at")
    ordering = ("-created_at",)


@admin.register(ParentStudentRelationship)
class ParentStudentRelationshipAdmin(admin.ModelAdmin):
    list_display = ("id", "parent", "student", "relationship_type", "status", "confirmed_at", "created_at")
    list_filter = ("status", "relationship_type")
    search_fields = ("parent__username", "parent__email", "student__first_name", "student__last_name")
    ordering = ("-created_at",)


@admin.register(ParentAccessAuditLog)
class ParentAccessAuditLogAdmin(admin.ModelAdmin):
    list_display = ("id", "action", "actor", "student", "created_at")
    list_filter = ("action",)
    search_fields = ("action", "actor__username", "student__first_name")
    readonly_fields = ("created_at",)
    ordering = ("-created_at",)


@admin.register(HomeworkSubmissionAttempt)
class HomeworkSubmissionAttemptAdmin(admin.ModelAdmin):
    list_display = ("id", "submission", "attempt_number", "status", "score", "submitted_at", "is_final")
    list_filter = ("status", "is_final")
    ordering = ("-created_at",)


@admin.register(TelegramConnectToken)
class TelegramConnectTokenAdmin(admin.ModelAdmin):
    list_display = ("id", "user", "expires_at", "used_at", "created_at")
    list_filter = ("used_at",)
    search_fields = ("token", "user__username", "user__email")
    readonly_fields = ("token", "created_at", "used_at")
    ordering = ("-created_at",)


@admin.register(StudentGroup)
class StudentGroupAdmin(admin.ModelAdmin):
    list_display = ("title", "teacher", "direction", "exam_type", "status", "created_at")
    list_filter = ("direction", "exam_type", "status")
    search_fields = ("title", "description")
    filter_horizontal = ("students",)
    ordering = ("title",)


@admin.register(Material)
class MaterialAdmin(admin.ModelAdmin):
    list_display = (
        "title", "material_type", "access_level", "direction",
        "teacher", "is_public", "is_new", "status",
    )
    list_filter = (
        "material_type", "access_level", "direction", "exam_type",
        "is_public", "is_new", "status",
    )
    search_fields = ("title", "topic", "subtopic")
    ordering = ("-created_at",)


@admin.register(TeacherSavedMaterial)
class TeacherSavedMaterialAdmin(admin.ModelAdmin):
    list_display = ("teacher", "material", "saved_at")
    list_filter = ("saved_at",)
    search_fields = ("teacher__username", "material__title")
    ordering = ("-saved_at",)


@admin.register(Lesson)
class LessonAdmin(admin.ModelAdmin):
    list_display = (
        "title", "teacher", "access_level", "direction",
        "lesson_type", "is_new", "status", "updated_at",
    )
    list_filter = ("direction", "exam_type", "lesson_type", "access_level", "is_new", "status")
    search_fields = ("title", "topic", "subtopic")
    filter_horizontal = ("materials",)
    ordering = ("-updated_at",)


@admin.register(LessonAssignment)
class LessonAssignmentAdmin(admin.ModelAdmin):
    list_display = ("lesson", "teacher", "student", "group", "status", "assigned_at")
    list_filter = ("status",)
    search_fields = ("lesson__title", "student__first_name", "group__title")
    ordering = ("-assigned_at",)


class LessonPlanItemInline(admin.StackedInline):
    model = LessonPlanItem
    extra = 0
    ordering = ("order",)
    fields = (
        "order",
        "title",
        "topic",
        "planned_results",
        "lesson_materials_notes",
        "materials",
        "homework_description",
        "teacher_comment",
        "status",
        "scheduled_date",
        "linked_lesson",
        "scheduled_event",
    )
    filter_horizontal = ("materials",)


@admin.register(LessonPlan)
class LessonPlanAdmin(admin.ModelAdmin):
    list_display = ("title", "is_public", "teacher", "subject", "direction", "grade", "exam_type", "status", "lessons_count", "updated_at")
    list_filter = ("subject", "direction", "exam_type", "status")
    search_fields = ("title", "goal", "teacher__username")
    inlines = [LessonPlanItemInline]
    ordering = ("-updated_at",)

    @admin.display(boolean=True, description="Публичный")
    def is_public(self, obj):
        return obj.teacher is None

    fieldsets = (
        (None, {
            "fields": ("teacher", "title", "status"),
            "description": "Оставьте «Учитель» пустым, чтобы план был доступен всем учителям.",
        }),
        ("Параметры", {
            "fields": ("subject", "direction", "exam_type", "grade"),
        }),
        ("Описание", {
            "fields": ("goal", "description"),
        }),
        ("Счётчик", {
            "fields": ("lessons_count",),
        }),
    )


@admin.register(LessonPlanEnrollment)
class LessonPlanEnrollmentAdmin(admin.ModelAdmin):
    list_display = ("plan", "teacher", "student", "group", "format", "status", "start_date", "end_date", "created_at")
    list_filter = ("status", "format")
    search_fields = ("plan__title", "teacher__username", "student__first_name", "group__title")
    raw_id_fields = ("plan", "student", "group")
    ordering = ("-created_at",)
    fieldsets = (
        (None, {"fields": ("teacher", "plan", "status")}),
        ("Кому назначено", {"fields": ("student", "group", "format")}),
        ("Расписание", {"fields": ("start_date", "end_date", "frequency"), "classes": ("collapse",)}),
        ("Заметки", {"fields": ("notes",), "classes": ("collapse",)}),
    )


@admin.register(LessonPlanItem)
class LessonPlanItemAdmin(admin.ModelAdmin):
    list_display = ("plan", "order", "title", "topic", "status", "scheduled_date")
    list_filter = ("status", "plan__direction")
    search_fields = ("title", "topic", "plan__title")
    ordering = ("plan", "order")
    filter_horizontal = ("materials",)
    fieldsets = (
        (None, {
            "fields": ("plan", "order", "title", "topic", "status"),
        }),
        ("Содержание занятия", {
            "fields": ("goal", "planned_results", "description"),
        }),
        ("Материалы", {
            "fields": ("lesson_materials_notes", "materials"),
        }),
        ("Домашнее задание", {
            "fields": ("homework_description",),
        }),
        ("Комментарий и итоги", {
            "fields": ("teacher_comment", "scheduled_date", "completed_at"),
        }),
        ("Связи", {
            "fields": ("linked_lesson", "scheduled_event"),
            "classes": ("collapse",),
        }),
    )


class FlashcardItemInline(admin.TabularInline):
    model = FlashcardItem
    extra = 0


class MatchingPairInline(admin.TabularInline):
    model = MatchingPair
    extra = 0


class OrderingItemInline(admin.TabularInline):
    model = OrderingItem
    extra = 0


class QuizQuestionInline(admin.TabularInline):
    model = QuizQuestion
    extra = 0


class WheelSegmentInline(admin.TabularInline):
    model = WheelSegment
    extra = 0


@admin.register(InteractiveBackground)
class InteractiveBackgroundAdmin(admin.ModelAdmin):
    list_display = ("name", "slug", "text_tone", "has_background_image", "is_default", "is_active", "sort_order")
    list_filter = ("is_active", "is_default", "text_tone")
    ordering = ("sort_order", "id")
    readonly_fields = ("background_image_preview",)

    fieldsets = (
        (None, {
            "fields": ("slug", "name", "text_tone", "sort_order", "is_active", "is_default"),
        }),
        ("Оформление", {
            "fields": ("css_background", "background_image", "background_image_preview"),
        }),
    )

    @admin.display(boolean=True, description="Картинка")
    def has_background_image(self, obj):
        return bool(obj.background_image)

    @admin.display(description="Превью")
    def background_image_preview(self, obj):
        if not obj.background_image:
            return "—"
        return format_html(
            '<img src="{}" style="max-width:320px;max-height:180px;border-radius:8px;" />',
            obj.background_image.url,
        )


@admin.register(InteractiveCardStyle)
class InteractiveCardStyleAdmin(admin.ModelAdmin):
    list_display = ("name", "slug", "css_class", "is_default", "is_active", "sort_order")
    list_filter = ("is_active", "is_default")
    ordering = ("sort_order", "id")


@admin.register(InteractiveSoundPack)
class InteractiveSoundPackAdmin(admin.ModelAdmin):
    list_display = ("name", "slug", "has_sound_files", "is_default", "is_active", "sort_order")
    list_filter = ("is_active", "is_default")
    ordering = ("sort_order", "id")
    fieldsets = (
        (None, {
            "fields": ("slug", "name", "description", "sort_order", "is_active", "is_default"),
        }),
        ("Файлы звуков", {
            "fields": (
                "sound_flip",
                "sound_correct",
                "sound_wrong",
                "sound_next",
                "sound_end",
                "sound_background",
            ),
            "description": (
                "Загрузите mp3, wav или ogg. Если файл задан — он используется вместо синтеза. "
                "События: переворот, правильно, неправильно, следующий, конец, фоновый."
            ),
        }),
        ("Синтез (fallback)", {
            "fields": ("config",),
            "classes": ("collapse",),
            "description": "JSON-профили, если файлы не загружены: flip, correct, wrong, next, end.",
        }),
    )

    @admin.display(boolean=True, description="Есть файлы")
    def has_sound_files(self, obj):
        return any([
            obj.sound_flip,
            obj.sound_correct,
            obj.sound_wrong,
            obj.sound_next,
            obj.sound_end,
            obj.sound_background,
        ])


@admin.register(Interactive)
class InteractiveAdmin(admin.ModelAdmin):
    list_display = (
        "title", "teacher", "interactive_type", "access_level",
        "background", "card_style", "direction", "is_new", "status",
    )
    list_filter = ("interactive_type", "access_level", "is_new", "direction", "status")
    search_fields = ("title", "topic")
    ordering = ("-updated_at",)
    inlines = [
        FlashcardItemInline,
        MatchingPairInline,
        OrderingItemInline,
        QuizQuestionInline,
        WheelSegmentInline,
    ]


@admin.register(InteractiveAssignment)
class InteractiveAssignmentAdmin(admin.ModelAdmin):
    list_display = ("interactive", "teacher", "student", "group", "status", "assigned_at")
    list_filter = ("status",)
    ordering = ("-assigned_at",)


@admin.register(InteractiveAttempt)
class InteractiveAttemptAdmin(admin.ModelAdmin):
    list_display = ("assignment", "student", "score_percent", "status", "started_at")
    list_filter = ("status",)
    ordering = ("-started_at",)


class InteractiveBoardAccessInline(admin.TabularInline):
    model = InteractiveBoardAccess
    extra = 0


@admin.register(InteractiveBoard)
class InteractiveBoardAdmin(admin.ModelAdmin):
    list_display = ("title", "owner", "group", "student", "lesson", "version", "updated_at")
    list_filter = ("is_archived", "allow_export")
    search_fields = ("title", "description")
    ordering = ("-updated_at",)
    readonly_fields = ("id", "created_at", "updated_at", "version")
    inlines = [InteractiveBoardAccessInline]


@admin.register(InteractiveBoardAccess)
class InteractiveBoardAccessAdmin(admin.ModelAdmin):
    list_display = ("board", "user", "permission", "updated_at")
    list_filter = ("permission",)
    ordering = ("-updated_at",)


@admin.register(InteractiveBoardAsset)
class InteractiveBoardAssetAdmin(admin.ModelAdmin):
    list_display = ("id", "board", "original_name", "mime_type", "size_bytes", "created_at")
    ordering = ("-created_at",)


class HomeworkTaskInline(admin.TabularInline):
    model = HomeworkTask
    extra = 0


@admin.register(Homework)
class HomeworkAdmin(admin.ModelAdmin):
    list_display = ("title", "teacher", "student", "group", "status", "due_at")
    list_filter = ("status",)
    search_fields = ("title",)
    inlines = [HomeworkTaskInline]
    ordering = ("-created_at",)


@admin.register(HomeworkSubmission)
class HomeworkSubmissionAdmin(admin.ModelAdmin):
    list_display = ("homework", "student", "status", "score", "submitted_at")
    list_filter = ("status",)
    search_fields = ("student__first_name", "homework__title")
    ordering = ("-submitted_at",)


@admin.register(HomeworkEditHistory)
class HomeworkEditHistoryAdmin(admin.ModelAdmin):
    list_display = ("homework", "actor", "created_at", "old_due_at", "new_due_at")
    list_filter = ("created_at",)
    search_fields = ("homework__title",)
    ordering = ("-created_at",)
    readonly_fields = (
        "homework",
        "actor",
        "changed_fields",
        "tasks_added",
        "tasks_removed",
        "old_due_at",
        "new_due_at",
        "previous_score",
        "previous_result_meta",
        "created_at",
    )


@admin.register(ReviewItem)
class ReviewItemAdmin(admin.ModelAdmin):
    list_display = ("title", "teacher", "student", "source_type", "status", "priority", "created_at")
    list_filter = ("source_type", "status", "priority")
    search_fields = ("title",)
    ordering = ("-created_at",)


class ScheduleEventMaterialInline(admin.TabularInline):
    model = ScheduleEventMaterial
    extra = 0
    autocomplete_fields = ("material", "interactive")


@admin.register(ScheduleEvent)
class ScheduleEventAdmin(admin.ModelAdmin):
    list_display = (
        "title",
        "owner",
        "event_type",
        "starts_at",
        "status",
        "plan_sync_enabled",
        "content_source",
        "series",
    )
    list_filter = (
        "event_type",
        "format",
        "status",
        "is_recurring_instance",
        "plan_sync_enabled",
        "content_source",
    )
    search_fields = ("title", "topic", "audience")
    ordering = ("starts_at",)
    readonly_fields = ("created_at", "updated_at", "original_start_at", "plan_synced_at")
    inlines = [ScheduleEventMaterialInline]


class ScheduleEventParticipantInline(admin.TabularInline):
    model = ScheduleEventParticipant
    extra = 0


@admin.register(ScheduleEventMaterial)
class ScheduleEventMaterialAdmin(admin.ModelAdmin):
    list_display = ("event", "material", "interactive", "source", "order")
    list_filter = ("source",)
    search_fields = ("event__title", "material__title")
    ordering = ("event", "order", "id")


@admin.register(ScheduleEventSeries)
class ScheduleEventSeriesAdmin(admin.ModelAdmin):
    list_display = ("title", "teacher", "recurrence_type", "start_date", "status")
    list_filter = ("recurrence_type", "status", "event_type")
    search_fields = ("title", "topic")
    ordering = ("-created_at",)


@admin.register(ScheduleEventParticipant)
class ScheduleEventParticipantAdmin(admin.ModelAdmin):
    list_display = ("event", "display_name", "role", "status", "notification_enabled")
    list_filter = ("role", "status")
    search_fields = ("display_name", "contact_email")


@admin.register(ScheduleEventChangeLog)
class ScheduleEventChangeLogAdmin(admin.ModelAdmin):
    list_display = ("event", "change_type", "changed_by", "created_at")
    list_filter = ("change_type",)
    readonly_fields = ("event", "series", "changed_by", "change_type", "old_data", "new_data", "message", "created_at")
    ordering = ("-created_at",)


class MeetingAttendanceInline(admin.TabularInline):
    model = MeetingAttendance
    extra = 0
    readonly_fields = (
        "user",
        "joined_at",
        "left_at",
        "duration_seconds",
        "jitsi_participant_id",
        "created_at",
    )
    can_delete = False


@admin.register(VideoMeeting)
class VideoMeetingAdmin(admin.ModelAdmin):
    list_display = (
        "uuid",
        "schedule_event",
        "teacher_name",
        "status",
        "room_name",
        "planned_starts_at",
        "actual_started_at",
        "actual_finished_at",
        "attendance_count",
        "created_at",
    )
    list_filter = ("status", "created_at")
    search_fields = (
        "uuid",
        "room_name",
        "schedule_event__title",
        "schedule_event__owner__username",
        "created_by__username",
    )
    readonly_fields = (
        "uuid",
        "room_name",
        "created_at",
        "updated_at",
        "actual_started_at",
        "actual_finished_at",
    )
    inlines = [MeetingAttendanceInline]
    ordering = ("-created_at",)

    @admin.display(description="Учитель")
    def teacher_name(self, obj):
        owner = obj.schedule_event.owner
        profile = getattr(owner, "profile", None)
        if profile:
            return profile.get_display_name()
        return owner.get_full_name() or owner.username

    @admin.display(description="Плановое время", ordering="schedule_event__starts_at")
    def planned_starts_at(self, obj):
        return obj.schedule_event.starts_at

    @admin.display(description="Подключений")
    def attendance_count(self, obj):
        return obj.attendance_sessions.count()


@admin.register(MeetingScreenShareSession)
class MeetingScreenShareSessionAdmin(admin.ModelAdmin):
    list_display = (
        "uuid",
        "meeting",
        "presenter_user",
        "is_active",
        "participants_can_annotate",
        "version",
        "started_at",
        "ended_at",
    )
    list_filter = ("is_active", "participants_can_annotate")
    search_fields = ("uuid", "meeting__uuid", "presenter_jitsi_id")
    readonly_fields = ("uuid", "started_at", "updated_at")


@admin.register(MeetingAttendance)
class MeetingAttendanceAdmin(admin.ModelAdmin):
    list_display = (
        "user",
        "meeting_lesson",
        "joined_at",
        "left_at",
        "duration_seconds",
        "jitsi_participant_id",
    )
    list_filter = ("joined_at", "meeting__status")
    search_fields = (
        "user__username",
        "user__email",
        "user__first_name",
        "user__last_name",
        "meeting__room_name",
        "meeting__schedule_event__title",
        "jitsi_participant_id",
    )
    readonly_fields = ("created_at", "duration_seconds")
    ordering = ("-joined_at",)

    @admin.display(description="Урок")
    def meeting_lesson(self, obj):
        return obj.meeting.schedule_event.title


@admin.register(Notification)
class NotificationAdmin(admin.ModelAdmin):
    list_display = ("title", "recipient_user", "channel", "status", "is_read", "created_at")
    list_filter = ("channel", "status", "is_read")
    search_fields = ("title", "message")
    readonly_fields = ("created_at", "sent_at")


@admin.register(NotificationPreference)
class NotificationPreferenceAdmin(admin.ModelAdmin):
    list_display = (
        "user",
        "in_app_enabled",
        "push_enabled",
        "vk_enabled",
        "telegram_enabled",
        "telegram_chat_id",
        "notify_before_lesson_minutes",
    )
    list_filter = ("in_app_enabled", "push_enabled", "vk_enabled", "telegram_enabled")
    search_fields = ("user__username", "user__email", "telegram_chat_id", "telegram_username")


@admin.register(SeasonalThemePreference)
class SeasonalThemePreferenceAdmin(admin.ModelAdmin):
    list_display = ("user", "mode", "selected_theme", "animations_enabled", "updated_at")
    list_filter = ("mode", "animations_enabled")
    search_fields = ("user__username", "user__email")
    raw_id_fields = ("user", "selected_theme")
    readonly_fields = ("created_at", "updated_at")


@admin.register(PushSubscription)
class PushSubscriptionAdmin(admin.ModelAdmin):
    list_display = ("user", "device_label", "is_active", "disabled_by_user", "last_seen_at", "created_at")
    list_filter = ("is_active", "disabled_by_user")
    search_fields = ("user__username", "user__email", "endpoint", "device_label")
    readonly_fields = ("created_at", "updated_at", "last_seen_at")


@admin.register(StudentNotifyOverride)
class StudentNotifyOverrideAdmin(admin.ModelAdmin):
    list_display = (
        "student",
        "mode",
        "notify_homework",
        "notify_messages",
        "notify_overdue",
        "notify_billing",
        "notify_attendance",
        "updated_at",
    )
    list_filter = ("mode",)
    search_fields = ("student__first_name", "student__last_name", "student__email")
    readonly_fields = ("created_at", "updated_at")


@admin.register(TariffPlan)
class TariffPlanAdmin(admin.ModelAdmin):
    list_display = (
        "name", "slug", "price_month", "price_year", "max_students",
        "content_access_rank", "cta_type", "is_public", "is_active",
        "is_recommended", "sort_order",
    )
    list_filter = ("is_active", "is_public", "is_recommended", "cta_type", "has_multi_teacher")
    search_fields = ("name", "slug", "description", "short_description")
    ordering = ("sort_order", "price_month")
    fieldsets = (
        (None, {
            "fields": (
                "name", "slug", "short_description", "description", "badge_text",
                "is_active", "is_public", "is_free", "is_recommended", "is_featured",
                "cta_type", "sort_order",
            ),
        }),
        ("Цены", {"fields": ("price_month", "price_year", "currency")}),
        ("Лимиты", {
            "fields": (
                "max_students", "max_groups", "max_lessons", "max_interactives",
                "max_variants_monthly", "max_workbooks_monthly",
                "content_access_rank", "max_storage_mb",
            ),
        }),
        ("Функции", {
            "fields": (
                "has_homework", "has_review", "has_basic_notifications",
                "has_advanced_notifications", "has_extended_library",
                "has_simulators", "has_analytics", "has_mass_actions",
                "has_priority_support", "has_multi_teacher", "has_team_roles",
                "monthly_library_promise",
            ),
        }),
        ("ИИ (скрыто с витрины)", {
            "classes": ("collapse",),
            "fields": ("ai_requests_monthly_limit",),
        }),
    )


@admin.register(TeacherSubscription)
class TeacherSubscriptionAdmin(admin.ModelAdmin):
    list_display = (
        "teacher", "plan", "status", "source", "billing_period",
        "started_at", "expires_at", "auto_renew",
    )
    list_filter = ("status", "source", "billing_period", "auto_renew", "plan", "is_legacy_promo")
    search_fields = ("teacher__username", "teacher__email")
    readonly_fields = ("started_at", "created_at", "updated_at")
    ordering = ("-created_at",)
    fieldsets = (
        (None, {"fields": ("teacher", "plan", "status", "source", "billing_period", "auto_renew")}),
        ("Сроки", {
            "fields": (
                "started_at", "expires_at",
                "current_period_start", "current_period_end",
                "promo_started_at", "promo_ends_at", "is_legacy_promo",
                "cancelled_at",
            ),
        }),
        ("Платёжный метод (T-Bank COF)", {
            "fields": (
                "tbank_customer_key",
                "tbank_rebill_id",
                "payment_method_mask",
                "last_renewal_attempt_at",
                "last_renewal_error",
            ),
        }),
        ("Отложенная смена", {
            "fields": ("scheduled_plan", "scheduled_change_at", "prepaid_until"),
        }),
        ("Служебное", {"fields": ("created_at", "updated_at")}),
    )


@admin.register(SubscriptionPlanChange)
class SubscriptionPlanChangeAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "teacher",
        "from_plan",
        "to_plan",
        "status",
        "reason",
        "effective_at",
        "requested_at",
        "applied_at",
    )
    list_filter = ("status", "reason", "to_plan", "from_plan")
    search_fields = ("teacher__username", "teacher__email")
    readonly_fields = (
        "teacher",
        "subscription",
        "from_plan",
        "to_plan",
        "requested_at",
        "created_at",
        "updated_at",
        "selected_student_ids",
        "selected_group_ids",
        "metadata",
        "payment",
    )
    ordering = ("-requested_at",)
    date_hierarchy = "requested_at"


@admin.register(AIUsage)
class AIUsageAdmin(admin.ModelAdmin):
    list_display = ("teacher", "period_start", "used_requests", "limit_requests", "updated_at")
    list_filter = ("period_start",)
    search_fields = ("teacher__username", "teacher__email")
    readonly_fields = ("created_at", "updated_at")
    ordering = ("-period_start",)


@admin.register(AIRequestLog)
class AIRequestLogAdmin(admin.ModelAdmin):
    list_display = ("teacher", "request_type", "cost_units", "status", "created_at")
    list_filter = ("status", "request_type")
    search_fields = ("teacher__username", "teacher__email", "prompt")
    readonly_fields = ("teacher", "request_type", "prompt", "result", "cost_units", "status", "error_message", "created_at")
    ordering = ("-created_at",)


class PromoCodeUsageInline(admin.TabularInline):
    model = PromoCodeUsage
    extra = 0
    readonly_fields = ("teacher", "payment", "discount_applied", "applied_at")


@admin.register(PromoCode)
class PromoCodeAdmin(admin.ModelAdmin):
    list_display = (
        "code", "discount_type", "discount_value", "is_active",
        "valid_from", "valid_until", "uses_display", "created_at",
    )
    list_filter = ("discount_type", "is_active", "first_payment_only", "stackable_with_referral")
    search_fields = ("code", "description")
    filter_horizontal = ("applicable_plans",)
    readonly_fields = ("uses_count", "created_at", "updated_at")
    fieldsets = (
        (None, {"fields": ("code", "description", "is_active")}),
        ("Скидка", {
            "fields": (
                "discount_type", "discount_value", "bonus_days",
                "first_payment_only", "stackable_with_referral", "applicable_plans",
            ),
        }),
        ("Ограничения", {"fields": ("max_uses", "max_uses_per_user", "valid_from", "valid_until")}),
        ("Статистика", {"fields": ("uses_count", "created_at", "updated_at")}),
    )
    inlines = [PromoCodeUsageInline]

    @admin.display(description="Used / Limit")
    def uses_display(self, obj):
        limit = obj.max_uses if obj.max_uses is not None else "∞"
        return f"{obj.uses_count} / {limit}"


@admin.register(PromoCodeUsage)
class PromoCodeUsageAdmin(admin.ModelAdmin):
    list_display = ("promo_code", "teacher", "status", "discount_applied", "applied_at")
    list_filter = ("status", "applied_at")
    search_fields = ("promo_code__code", "teacher__username", "teacher__email")
    readonly_fields = ("promo_code", "teacher", "payment", "discount_applied", "applied_at")
    ordering = ("-applied_at",)


class PromotionStatusFilter(admin.SimpleListFilter):
    title = "Статус"
    parameter_name = "computed_status"

    def lookups(self, request, model_admin):
        return (
            ("active", "Действует"),
            ("scheduled", "Запланирована"),
            ("ended", "Завершена"),
            ("disabled", "Выключена"),
            ("limit_reached", "Лимит исчерпан"),
        )

    def queryset(self, request, queryset):
        from django.utils import timezone as tz

        from .promotion_service import redemption_count

        now = tz.now()
        value = self.value()
        if value == "disabled":
            return queryset.filter(is_active=False)
        qs = queryset.filter(is_active=True)
        if value == "scheduled":
            return qs.filter(starts_at__gt=now)
        if value == "ended":
            return qs.filter(ends_at__lte=now)
        if value == "active":
            return qs.filter(starts_at__lte=now, ends_at__gt=now)
        if value == "limit_reached":
            ids = [
                obj.pk
                for obj in qs.filter(starts_at__lte=now, ends_at__gt=now, max_redemptions__isnull=False)
                if redemption_count(obj) >= obj.max_redemptions
            ]
            return qs.filter(pk__in=ids)
        return queryset


class PromotionRedemptionInline(admin.TabularInline):
    model = PromotionRedemption
    extra = 0
    can_delete = False
    readonly_fields = (
        "teacher", "plan", "payment", "original_price", "final_price",
        "benefit_type", "free_months", "status", "created_at",
    )


@admin.register(Promotion)
class PromotionAdmin(admin.ModelAdmin):
    list_display = (
        "name", "title", "plan", "plan_price", "benefit_display",
        "starts_at", "ends_at", "is_active", "status_display",
        "eligibility_type", "uses_display", "priority",
    )
    list_filter = (
        PromotionStatusFilter,
        "is_active",
        "benefit_type",
        "eligibility_type",
        "plan",
        "allow_promo_codes",
    )
    search_fields = ("name", "title", "code", "short_description")
    filter_horizontal = ("eligible_users",)
    readonly_fields = ("created_at", "updated_at", "status_display", "uses_display")
    inlines = [PromotionRedemptionInline]
    fieldsets = (
        ("Основное", {
            "fields": ("code", "name", "title", "short_description", "description"),
        }),
        ("Предложение", {
            "fields": ("plan", "benefit_type", "promo_price", "free_months", "pricing_duration"),
        }),
        ("Сроки", {
            "fields": ("starts_at", "ends_at", "display_starts_at", "display_ends_at"),
        }),
        ("Аудитория", {
            "fields": (
                "eligibility_type", "registered_from", "registered_until", "eligible_users",
            ),
        }),
        ("Ограничения", {
            "fields": (
                "max_redemptions", "max_redemptions_per_user", "allow_promo_codes", "claim_mode",
            ),
        }),
        ("Отображение", {
            "fields": ("how_to_get", "terms", "button_text", "priority"),
        }),
        ("Системное", {
            "fields": ("is_active", "status_display", "uses_display", "created_at", "updated_at"),
        }),
    )

    def get_fieldsets(self, request, obj=None):
        fieldsets = super().get_fieldsets(request, obj)
        if obj is None or obj.code != "launch-premium":
            return fieldsets
        result = []
        for name, opts in fieldsets:
            if name == "Основное":
                opts = {**opts, "description": (
                    "Стартовая акция при регистрации. Сейчас выключена: новые учителя "
                    "получают «Старт». Чтобы снова выдавать Premium — включите «Активна» "
                    "и проверьте даты. Уже выданные Premium не отзываются. "
                    "Код launch-premium не меняйте."
                )}
            result.append((name, opts))
        return result

    def save_model(self, request, obj, form, change):
        obj.full_clean()
        super().save_model(request, obj, form, change)

    def has_delete_permission(self, request, obj=None):
        if obj is None:
            return super().has_delete_permission(request, obj)
        if obj.redemptions.filter(status="applied").exists():
            return False
        return super().has_delete_permission(request, obj)

    @admin.display(description="Цена тарифа")
    def plan_price(self, obj):
        if not obj.plan_id:
            return "—"
        return obj.plan.price_month

    @admin.display(description="Выгода")
    def benefit_display(self, obj):
        if obj.benefit_type == Promotion.BenefitType.FREE_PERIOD:
            return f"{obj.free_months or 0} мес. бесплатно"
        if obj.promo_price is not None:
            return f"{obj.promo_price} ₽"
        return "—"

    @admin.display(description="Статус")
    def status_display(self, obj):
        from .promotion_service import compute_status

        if obj.pk is None:
            return "—"
        labels = {
            "active": "Действует",
            "scheduled": "Запланирована",
            "ended": "Завершена",
            "disabled": "Выключена",
            "limit_reached": "Лимит исчерпан",
        }
        key = compute_status(obj)
        return labels.get(key, key)

    @admin.display(description="Использований")
    def uses_display(self, obj):
        if obj.pk is None:
            return "—"
        used = obj.redemptions.filter(status="applied").count()
        reserved = obj.redemptions.filter(status="reserved").count()
        limit = obj.max_redemptions if obj.max_redemptions is not None else "∞"
        extra = f" (+{reserved} резерв)" if reserved else ""
        return f"{used} / {limit}{extra}"


@admin.register(PromotionRedemption)
class PromotionRedemptionAdmin(admin.ModelAdmin):
    list_display = (
        "promotion", "teacher", "plan", "status",
        "original_price", "final_price", "payment", "created_at",
    )
    list_filter = ("status", "benefit_type", "created_at")
    search_fields = (
        "promotion__code", "promotion__name",
        "teacher__username", "teacher__email",
    )
    readonly_fields = (
        "promotion", "teacher", "plan", "payment", "subscription",
        "original_price", "final_price", "benefit_type", "free_months",
        "status", "created_at",
    )
    ordering = ("-created_at",)

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False


@admin.register(Payment)
class PaymentAdmin(admin.ModelAdmin):
    list_display = (
        "teacher", "plan", "final_amount", "amount", "currency",
        "status", "provider", "promotion", "is_recurrent", "billing_period", "paid_at", "created_at",
    )
    list_filter = ("status", "provider", "currency", "billing_period", "is_recurrent")
    search_fields = (
        "teacher__username", "teacher__email",
        "provider_payment_id", "idempotency_key", "order_id", "rebill_id",
    )
    readonly_fields = ("created_at", "updated_at", "idempotency_key")
    ordering = ("-created_at",)


@admin.register(Receipt)
class ReceiptAdmin(admin.ModelAdmin):
    list_display = ("payment", "status", "fiscal_number", "created_at")
    search_fields = ("payment__provider_payment_id", "fiscal_number", "provider_receipt_id")
    readonly_fields = ("created_at", "updated_at")


@admin.register(PaymentWebhookEvent)
class PaymentWebhookEventAdmin(admin.ModelAdmin):
    list_display = ("provider", "event_id", "payment", "processed", "created_at")
    list_filter = ("provider", "processed")
    search_fields = ("event_id",)
    readonly_fields = ("created_at", "processed_at")


@admin.register(AnonymousUsage)
class AnonymousUsageAdmin(admin.ModelAdmin):
    list_display = (
        "anonymous_id", "variants_created", "workbooks_created",
        "registered_user", "last_seen_at",
    )
    search_fields = ("anonymous_id", "session_key", "registered_user__username")
    readonly_fields = ("first_seen_at", "last_seen_at")


@admin.register(TeacherMonthlyUsage)
class TeacherMonthlyUsageAdmin(admin.ModelAdmin):
    list_display = (
        "teacher", "period_start", "variants_created", "workbooks_created",
        "interactives_created", "updated_at",
    )
    list_filter = ("period_start",)
    search_fields = ("teacher__username", "teacher__email")


@admin.register(ReferralReward)
class ReferralRewardAdmin(admin.ModelAdmin):
    list_display = (
        "referrer", "referred_user", "reward_type", "reward_days",
        "status", "granted_at", "applied_at", "created_at",
    )
    list_filter = ("status", "reward_type")
    search_fields = ("referrer__username", "referred_user__username")
    readonly_fields = ("created_at", "granted_at", "applied_at")


class ReferralLinkRegistrationInline(admin.TabularInline):
    model = ReferralLinkRegistration
    extra = 0
    readonly_fields = (
        "user", "invitee_discount_eligible", "invitee_discount_percent",
        "registered_at",
    )
    can_delete = False


@admin.register(ReferralLink)
class ReferralLinkAdmin(admin.ModelAdmin):
    list_display = (
        "code", "title", "owner",
        "registrations_count", "max_registrations", "is_active", "valid_until", "created_at",
    )
    list_filter = ("is_active",)
    search_fields = ("code", "title", "description", "owner__username", "owner__email")
    readonly_fields = ("registrations_count", "created_at", "updated_at")
    fieldsets = (
        (None, {"fields": ("code", "title", "owner", "description", "is_active")}),
        ("Legacy", {"fields": ("reward_plan", "reward_months"), "classes": ("collapse",)}),
        ("Ограничения", {"fields": ("max_registrations", "valid_from", "valid_until")}),
        ("Статистика", {"fields": ("registrations_count", "created_at", "updated_at")}),
    )
    inlines = [ReferralLinkRegistrationInline]


@admin.register(ReferralLinkRegistration)
class ReferralLinkRegistrationAdmin(admin.ModelAdmin):
    list_display = (
        "referral_link", "user", "invitee_discount_eligible",
        "invitee_discount_percent", "registered_at",
    )
    list_filter = ("invitee_discount_eligible", "registered_at")
    search_fields = ("referral_link__code", "user__username", "user__email")
    readonly_fields = (
        "referral_link", "user", "reward_plan", "reward_months", "expires_at",
        "invitee_discount_percent", "invitee_discount_eligible",
        "invitee_discount_used_at", "invitee_discount_payment", "registered_at",
    )
    ordering = ("-registered_at",)


@admin.register(EventReminderLog)
class EventReminderLogAdmin(admin.ModelAdmin):
    list_display = ("event", "recipient", "reminder_minutes", "channel", "sent_at")
    list_filter = ("channel",)
    readonly_fields = ("sent_at",)


@admin.register(LessonJournal)
class LessonJournalAdmin(admin.ModelAdmin):
    list_display = ("id", "lesson_date", "teacher", "status", "actual_topic", "group", "student")
    list_filter = ("status",)
    search_fields = ("actual_topic", "planned_topic")
    raw_id_fields = ("schedule_event", "teacher", "group", "student", "homework")


@admin.register(StudentLessonRecord)
class StudentLessonRecordAdmin(admin.ModelAdmin):
    list_display = ("id", "journal", "student", "attendance_status", "overall_score", "publish_status")
    list_filter = ("attendance_status", "publish_status")
    raw_id_fields = ("journal", "student")


@admin.register(AssessmentCriterion)
class AssessmentCriterionAdmin(admin.ModelAdmin):
    list_display = ("title", "teacher", "scale_type", "is_active", "sort_order")
    list_filter = ("scale_type", "is_active")


@admin.register(JournalAttentionMarker)
class JournalAttentionMarkerAdmin(admin.ModelAdmin):
    list_display = ("student", "teacher", "reason", "is_active", "updated_at")
    list_filter = ("reason", "is_active")


@admin.register(JournalAuditLog)
class JournalAuditLogAdmin(admin.ModelAdmin):
    list_display = ("action", "journal", "actor", "field_name", "created_at")
    list_filter = ("action",)
    readonly_fields = ("created_at",)


# ── Учёт оплат репетитора ────────────────────────────────────────────────────
from .billing_models import (  # noqa: E402
    BillingAccount,
    BillingTransaction,
    EventBillingRecord,
    LessonPackage,
    StudentPayment,
    TeacherBillingSettings,
)


@admin.register(TeacherBillingSettings)
class TeacherBillingSettingsAdmin(admin.ModelAdmin):
    list_display = ("teacher", "currency", "default_billing_type", "default_lesson_price", "updated_at")
    search_fields = ("teacher__username", "teacher__email")


@admin.register(BillingAccount)
class BillingAccountAdmin(admin.ModelAdmin):
    list_display = ("id", "teacher", "student", "payer_name", "currency", "is_active")
    list_filter = ("is_active", "currency")
    search_fields = ("student__first_name", "student__last_name", "payer_name")


@admin.register(LessonPackage)
class LessonPackageAdmin(admin.ModelAdmin):
    list_display = ("title", "billing_account", "unit_type", "remaining_units", "total_units", "status")
    list_filter = ("status", "unit_type")


@admin.register(BillingTransaction)
class BillingTransactionAdmin(admin.ModelAdmin):
    list_display = ("occurred_at", "student", "transaction_type", "amount", "package_units", "is_reversal")
    list_filter = ("transaction_type", "is_reversal")
    readonly_fields = ("created_at",)


@admin.register(EventBillingRecord)
class EventBillingRecordAdmin(admin.ModelAdmin):
    list_display = ("event", "student", "financial_status", "charged_amount", "paid_amount")
    list_filter = ("financial_status", "delivery_status")


@admin.register(StudentPayment)
class StudentPaymentAdmin(admin.ModelAdmin):
    list_display = ("paid_at", "student", "amount", "method", "status")
    list_filter = ("status", "method")


@staff_member_required
def activation_metrics_view(request):
    from .activation_analytics import build_activation_report

    report = build_activation_report()
    return render(
        request,
        "admin/cabinet/activation_metrics.html",
        {
            **admin.site.each_context(request),
            "title": "Activation",
            "report": report,
        },
    )


_original_admin_get_urls = admin.site.get_urls


def _admin_urls_with_activation():
    custom = [
        path(
            "cabinet/activation/",
            admin.site.admin_view(activation_metrics_view),
            name="cabinet_activation_metrics",
        ),
    ]
    return custom + _original_admin_get_urls()


admin.site.get_urls = _admin_urls_with_activation
