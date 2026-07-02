from django.contrib import admin
from django.utils.html import format_html

from .models import (
    AIRequestLog,
    AIUsage,
    EventReminderLog,
    LessonPlanEnrollment,
    PromoCode,
    PromoCodeUsage,
    ReferralLink,
    ReferralLinkRegistration,
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
    LessonPlanItem,
    MatchingPair,
    Material,
    Notification,
    NotificationPreference,
    OrderingItem,
    QuizQuestion,
    WheelSegment,
    Payment,
    Profile,
    ReviewItem,
    ScheduleEvent,
    ScheduleEventChangeLog,
    ScheduleEventParticipant,
    ScheduleEventSeries,
    Student,
    StudentGroup,
    StudentInvitation,
    TariffPlan,
    TeacherSavedMaterial,
    TeacherSubscription,
)


@admin.register(Profile)
class ProfileAdmin(admin.ModelAdmin):
    list_display = ("user", "role", "display_name", "account_active", "account_blocked", "reg_date")
    list_filter = ("role", "account_active", "account_blocked", "email_confirmed")
    search_fields = ("user__username", "user__email", "name", "surname", "display_name")
    ordering = ("-reg_date",)


@admin.register(Student)
class StudentAdmin(admin.ModelAdmin):
    list_display = ("full_name", "teacher", "user", "direction", "grade", "status", "created_at")
    list_filter = ("direction", "status", "grade")
    search_fields = ("first_name", "last_name", "email", "phone", "user__username", "user__email")
    ordering = ("last_name", "first_name")


@admin.register(StudentInvitation)
class StudentInvitationAdmin(admin.ModelAdmin):
    list_display = ("token", "teacher", "group", "email", "status", "expires_at", "created_at")
    list_filter = ("status", "direction")
    search_fields = ("token", "email", "teacher__username", "group__title")
    readonly_fields = ("token", "accepted_at", "created_at", "updated_at")
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
    list_display = ("title", "material_type", "direction", "teacher", "is_public", "status")
    list_filter = ("material_type", "direction", "exam_type", "is_public", "status")
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
    list_display = ("title", "teacher", "direction", "lesson_type", "status", "updated_at")
    list_filter = ("direction", "exam_type", "lesson_type", "status")
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
    list_display = ("title", "teacher", "interactive_type", "background", "card_style", "direction", "status")
    list_filter = ("interactive_type", "direction", "status")
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


@admin.register(ReviewItem)
class ReviewItemAdmin(admin.ModelAdmin):
    list_display = ("title", "teacher", "student", "source_type", "status", "priority", "created_at")
    list_filter = ("source_type", "status", "priority")
    search_fields = ("title",)
    ordering = ("-created_at",)


@admin.register(ScheduleEvent)
class ScheduleEventAdmin(admin.ModelAdmin):
    list_display = ("title", "owner", "event_type", "starts_at", "status", "series")
    list_filter = ("event_type", "format", "status", "is_recurring_instance")
    search_fields = ("title", "topic", "audience")
    ordering = ("starts_at",)
    readonly_fields = ("created_at", "updated_at", "original_start_at")


class ScheduleEventParticipantInline(admin.TabularInline):
    model = ScheduleEventParticipant
    extra = 0


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


@admin.register(Notification)
class NotificationAdmin(admin.ModelAdmin):
    list_display = ("title", "recipient_user", "channel", "status", "is_read", "created_at")
    list_filter = ("channel", "status", "is_read")
    search_fields = ("title", "message")
    readonly_fields = ("created_at", "sent_at")


@admin.register(NotificationPreference)
class NotificationPreferenceAdmin(admin.ModelAdmin):
    list_display = ("user", "in_app_enabled", "vk_enabled", "notify_before_lesson_minutes")
    list_filter = ("in_app_enabled", "vk_enabled")


@admin.register(TariffPlan)
class TariffPlanAdmin(admin.ModelAdmin):
    list_display = ("name", "slug", "price_month", "price_year", "max_students", "max_groups", "max_lessons", "max_interactives", "ai_requests_monthly_limit", "is_active", "is_recommended", "sort_order")
    list_filter = ("is_active", "is_recommended", "has_multi_teacher", "has_advanced_notifications")
    search_fields = ("name", "slug", "description")
    ordering = ("sort_order", "price_month")
    fieldsets = (
        (None, {"fields": ("name", "slug", "description", "is_active", "is_recommended", "sort_order")}),
        ("Цены", {"fields": ("price_month", "price_year", "currency")}),
        ("Лимиты", {"fields": ("max_students", "max_groups", "max_lessons", "max_interactives", "ai_requests_monthly_limit", "max_storage_mb")}),
        ("Функции", {"fields": ("has_homework", "has_review", "has_basic_notifications", "has_advanced_notifications", "has_extended_library", "has_multi_teacher", "has_team_roles")}),
    )


@admin.register(TeacherSubscription)
class TeacherSubscriptionAdmin(admin.ModelAdmin):
    list_display = ("teacher", "plan", "status", "billing_period", "started_at", "expires_at", "auto_renew")
    list_filter = ("status", "billing_period", "auto_renew", "plan")
    search_fields = ("teacher__username", "teacher__email")
    readonly_fields = ("started_at", "created_at", "updated_at")
    ordering = ("-created_at",)


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
    list_display = ("code", "discount_type", "discount_value", "uses_count", "max_uses", "is_active", "valid_from", "valid_until", "created_at")
    list_filter = ("discount_type", "is_active")
    search_fields = ("code", "description")
    filter_horizontal = ("applicable_plans",)
    readonly_fields = ("uses_count", "created_at", "updated_at")
    fieldsets = (
        (None, {"fields": ("code", "description", "is_active")}),
        ("Скидка", {"fields": ("discount_type", "discount_value", "applicable_plans")}),
        ("Ограничения", {"fields": ("max_uses", "max_uses_per_user", "valid_from", "valid_until")}),
        ("Статистика", {"fields": ("uses_count", "created_at", "updated_at")}),
    )
    inlines = [PromoCodeUsageInline]


@admin.register(PromoCodeUsage)
class PromoCodeUsageAdmin(admin.ModelAdmin):
    list_display = ("promo_code", "teacher", "discount_applied", "applied_at")
    list_filter = ("applied_at",)
    search_fields = ("promo_code__code", "teacher__username", "teacher__email")
    readonly_fields = ("promo_code", "teacher", "payment", "discount_applied", "applied_at")
    ordering = ("-applied_at",)


@admin.register(Payment)
class PaymentAdmin(admin.ModelAdmin):
    list_display = ("teacher", "subscription", "amount", "currency", "status", "provider", "paid_at", "created_at")
    list_filter = ("status", "provider", "currency")
    search_fields = ("teacher__username", "teacher__email", "provider_payment_id")
    readonly_fields = ("created_at", "updated_at")
    ordering = ("-created_at",)


class ReferralLinkRegistrationInline(admin.TabularInline):
    model = ReferralLinkRegistration
    extra = 0
    readonly_fields = ("user", "reward_plan", "reward_months", "expires_at", "registered_at")
    can_delete = False


@admin.register(ReferralLink)
class ReferralLinkAdmin(admin.ModelAdmin):
    list_display = (
        "code", "title", "reward_plan", "reward_months",
        "registrations_count", "max_registrations", "is_active", "valid_until", "created_at",
    )
    list_filter = ("is_active", "reward_plan")
    search_fields = ("code", "title", "description", "owner__username", "owner__email")
    readonly_fields = ("registrations_count", "created_at", "updated_at")
    fieldsets = (
        (None, {"fields": ("code", "title", "owner", "description", "is_active")}),
        ("Бонус", {"fields": ("reward_plan", "reward_months")}),
        ("Ограничения", {"fields": ("max_registrations", "valid_from", "valid_until")}),
        ("Статистика", {"fields": ("registrations_count", "created_at", "updated_at")}),
    )
    inlines = [ReferralLinkRegistrationInline]


@admin.register(ReferralLinkRegistration)
class ReferralLinkRegistrationAdmin(admin.ModelAdmin):
    list_display = ("referral_link", "user", "reward_plan", "reward_months", "expires_at", "registered_at")
    list_filter = ("reward_plan", "registered_at")
    search_fields = ("referral_link__code", "user__username", "user__email")
    readonly_fields = ("referral_link", "user", "reward_plan", "reward_months", "expires_at", "registered_at")
    ordering = ("-registered_at",)


@admin.register(EventReminderLog)
class EventReminderLogAdmin(admin.ModelAdmin):
    list_display = ("event", "recipient", "reminder_minutes", "channel", "sent_at")
    list_filter = ("channel",)
    readonly_fields = ("sent_at",)
