from django.contrib import admin
from django.db.models import Q
from django.utils.html import strip_tags
from django_ckeditor_5.widgets import CKEditor5Widget

from .models import (
    Announcement,
    Criteria,
    ErrorReport,
    Level,
    LinkedTaskGroup,
    Mark,
    MarkComment,
    Part,
    PreviewType,
    Subject,
    SubTopic,
    SupportInfo,
    Tag,
    Task,
    TaskGroup,
    TaskGroupMember,
    TaskList,
    TaskPreview,
    Update,
    Variant,
    VariantContent,
    username_for_created_by,
)



class SearchByIdMixin:
    """Миксин: если поисковый запрос — число, ищем также по id."""

    def get_search_results(self, request, queryset, search_term):
        queryset, use_distinct = super().get_search_results(request, queryset, search_term)
        if search_term.strip() and search_term.strip().isdigit():
            q_id = Q(id=int(search_term.strip()))
            queryset = self.model.objects.filter(q_id) | queryset
        return queryset, use_distinct


class SubTopicInline(admin.TabularInline):
    model = SubTopic
    extra = 1
    fields = ("title", "order")


@admin.register(Subject)
class SubjectAdmin(admin.ModelAdmin):
    list_display = ("id", "subject_short", "subject_name")
    list_filter = ("subject_short",)
    search_fields = ("subject_short", "subject_name")
    list_per_page = 50
    show_full_result_count = False


@admin.register(TaskList)
class TaskListAdmin(SearchByIdMixin, admin.ModelAdmin):
    list_display = ("id", "task_number", "task_title", "subject", "level", "part", "subdivision")
    list_filter = ("subject", "level", "part", "subdivision")
    list_editable = ("subdivision",)
    search_fields = ("task_title",)
    list_select_related = ("subject", "level", "part")
    list_per_page = 25
    show_full_result_count = False
    inlines = [SubTopicInline]


@admin.register(Level)
class LevelAdmin(admin.ModelAdmin):
    list_display = ("id", "level", "level_rus")
    list_filter = ("level",)


@admin.register(Task)
class TaskAdmin(SearchByIdMixin, admin.ModelAdmin):
    list_display = ("id", "task_with_title", "task_template_preview", "subtopic", "max_score", "answer_preview", "created_by", "added_at")
    list_filter = ("task__subject", "task__level", "task__part", "subtopic", "created_by", "added_at")
    list_editable = ("subtopic",)
    search_fields = ("answer",)
    date_hierarchy = "added_at"
    list_select_related = ("task__subject", "task__level", "task__part", "subtopic")
    list_per_page = 25
    show_full_result_count = False
    raw_id_fields = ("task",)
    autocomplete_fields = ("subtopic",)
    fieldsets = (
        (None, {"fields": ("task", "subtopic", "task_template", "answer", "max_score", "files", "author", "added_at", "created_by")}),
    )

    def formfield_for_dbfield(self, db_field, request, **kwargs):
        if db_field.name == "answer":
            kwargs["widget"] = CKEditor5Widget(config_name="default")
        return super().formfield_for_dbfield(db_field, request, **kwargs)

    def task_with_title(self, obj):
        if not obj.task:
            return "—"
        return f"№{obj.task.task_number} — {obj.task.task_title}"
    task_with_title.short_description = "Задача"
    task_with_title.admin_order_field = "task__task_number"

    def task_template_preview(self, obj):
        raw = obj.task_template or ""
        plain = strip_tags(raw).strip() if raw else ""
        return (plain[:60] + "…") if len(plain) > 60 else plain
    task_template_preview.short_description = "Условие задачи"

    def answer_preview(self, obj):
        raw = obj.answer or ""
        plain = strip_tags(raw).strip() if raw else ""
        return (plain[:50] + "…") if len(plain) > 50 else plain

    answer_preview.short_description = "Ответ"

    def save_model(self, request, obj, form, change):
        if not change:
            obj.created_by = username_for_created_by(request)
        super().save_model(request, obj, form, change)


@admin.register(SubTopic)
class SubTopicAdmin(admin.ModelAdmin):
    list_display = ("id", "task_list", "title", "order")
    list_filter = ("task_list__subject", "task_list__level")
    search_fields = ("title", "task_list__task_title", "task_list__subject__subject_short", "task_list__level__level")
    ordering = ("task_list", "order", "title")


@admin.register(Variant)
class VariantAdmin(SearchByIdMixin, admin.ModelAdmin):
    list_display = ("id", "var_subject", "level", "created_by", "created_at")
    list_filter = ("var_subject", "level", "created_by")
    search_fields = ("created_by",)
    date_hierarchy = "created_at"
    list_select_related = ("var_subject", "level")
    list_per_page = 25
    show_full_result_count = False

    def save_model(self, request, obj, form, change):
        if not change:
            obj.created_by = username_for_created_by(request)
        super().save_model(request, obj, form, change)


@admin.register(VariantContent)
class VariantContentAdmin(admin.ModelAdmin):
    list_display = ("id", "variant", "task", "order")
    list_filter = ("variant__var_subject", "variant__level")
    search_fields = ("variant__var_subject__subject_short",)
    ordering = ("variant", "order")
    list_select_related = ("variant__var_subject", "variant__level", "task")
    list_per_page = 25
    show_full_result_count = False
    raw_id_fields = ("variant", "task")

    def get_search_results(self, request, queryset, search_term):
        if not search_term.strip():
            return super().get_search_results(request, queryset, search_term)
        if search_term.strip().isdigit():
            val = int(search_term.strip())
            q = Q(id=val) | Q(variant_id=val) | Q(task_id=val)
            return self.model.objects.filter(q).distinct(), True
        return super().get_search_results(request, queryset, search_term)


@admin.register(Criteria)
class CriteriaAdmin(admin.ModelAdmin):
    list_display = ("id", "task_number", "criteria_score")
    list_filter = ("task_number__subject", "task_number__level")
    list_editable = ("criteria_score",)
    search_fields = ("criteria_text",)
    list_select_related = ("task_number__subject", "task_number__level")
    raw_id_fields = ("task_number",)
    ordering = ("task_number", "id")

    def formfield_for_dbfield(self, db_field, request, **kwargs):
        if db_field.name == "criteria_text":
            kwargs["widget"] = CKEditor5Widget(config_name="default")
        return super().formfield_for_dbfield(db_field, request, **kwargs)


@admin.register(Part)
class PartAdmin(admin.ModelAdmin):
    list_display = ("id", "part_title")
    list_filter = ("part_title",)


@admin.register(LinkedTaskGroup)
class LinkedTaskGroupAdmin(admin.ModelAdmin):
    list_display = ("subject", "level", "task_numbers")
    list_filter = ("subject", "level")
    list_select_related = ("subject", "level")


class TaskGroupMemberInline(admin.TabularInline):
    model = TaskGroupMember
    extra = 0
    raw_id_fields = ("task",)


@admin.register(TaskGroup)
class TaskGroupAdmin(admin.ModelAdmin):
    list_display = ("id", "subject", "level", "subtopic")
    list_filter = ("subject", "level", "subtopic")
    list_select_related = ("subject", "level", "subtopic")
    list_editable = ("subtopic",)
    inlines = (TaskGroupMemberInline,)
    fields = ("subject", "level", "subtopic")
    autocomplete_fields = ("subtopic",)



@admin.register(Tag)
class TagAdmin(admin.ModelAdmin):
    list_display = ("id", "task", "taskTag")
    list_filter = ("taskTag",)
    list_select_related = ("task", "taskTag")
    raw_id_fields = ("task", "taskTag")


@admin.register(MarkComment)
class MarkCommentAdmin(admin.ModelAdmin):
    list_display = ("id", "mark_level", "comment_preview")
    list_filter = ("mark_level",)
    search_fields = ("comment_text",)

    def comment_preview(self, obj):
        text = obj.comment_text or ""
        return (text[:80] + "…") if len(text) > 80 else text

    comment_preview.short_description = "Комментарий"


@admin.register(Mark)
class MarkAdmin(admin.ModelAdmin):
    list_display = ("id", "subject", "level", "score", "score_exam", "comment")
    list_filter = ("subject", "level")
    list_select_related = ("subject", "level", "comment")
    raw_id_fields = ("comment",)


@admin.register(SupportInfo)
class SupportInfoAdmin(admin.ModelAdmin):
    list_display = ("id", "info_preview", "subject", "level")
    list_filter = ("subject", "level")
    list_select_related = ("subject", "level")

    def formfield_for_dbfield(self, db_field, request, **kwargs):
        if db_field.name == "info_text":
            kwargs["widget"] = CKEditor5Widget(config_name="default")
        return super().formfield_for_dbfield(db_field, request, **kwargs)

    def info_preview(self, obj):
        text = obj.info_text or ""
        plain = strip_tags(text).strip() if text else ""
        return (plain[:50] + "…") if len(plain) > 50 else plain

    info_preview.short_description = "Текст"


@admin.register(PreviewType)
class PreviewTypeAdmin(admin.ModelAdmin):
    list_display = ("id", "preview_type_text")
    search_fields = ("preview_type_text",)


@admin.register(TaskPreview)
class TaskPreviewAdmin(admin.ModelAdmin):
    list_display = ("id", "preview_preview", "subject", "level", "part", "preview_type")
    list_filter = ("subject", "level", "part", "preview_type")
    list_select_related = ("subject", "level", "part", "preview_type")

    def formfield_for_dbfield(self, db_field, request, **kwargs):
        if db_field.name == "task_preview_text":
            kwargs["widget"] = CKEditor5Widget(config_name="default")
        return super().formfield_for_dbfield(db_field, request, **kwargs)

    def preview_preview(self, obj):
        text = obj.task_preview_text or ""
        plain = strip_tags(text).strip() if text else ""
        return (plain[:50] + "…") if len(plain) > 50 else plain

    preview_preview.short_description = "Текст перед задачами"


@admin.register(Update)
class UpdateAdmin(admin.ModelAdmin):
    list_display = ("id", "created", "title", "show")
    list_editable = ("show",)
    list_filter = ("show",)
    search_fields = ("title", "description")
    date_hierarchy = "created"
    ordering = ["-created"]
    readonly_fields = ("created",)


@admin.register(ErrorReport)
class ErrorReportAdmin(admin.ModelAdmin):
    list_display = ("id", "task_number", "task_id", "subject", "level", "error_type", "variant_id", "comment_preview", "created_at", "is_fixed", "digest_sent")
    list_filter = ("subject", "level", "error_type", "is_fixed", "digest_sent")
    list_editable = ("is_fixed",)
    search_fields = ("comment",)
    date_hierarchy = "created_at"
    ordering = ["-created_at"]
    list_per_page = 50
    readonly_fields = ("created_at", "digest_sent")

    def comment_preview(self, obj):
        text = obj.comment or ""
        return (text[:60] + "…") if len(text) > 60 else text or "—"
    comment_preview.short_description = "Комментарий"


@admin.register(Announcement)
class AnnouncementAdmin(admin.ModelAdmin):
    list_display = ("id", "sort_order", "title", "background", "show", "created")
    list_editable = ("sort_order", "show")
    list_filter = ("show",)
    search_fields = ("title", "body")
    ordering = ["sort_order", "-created"]
    readonly_fields = ("created",)
    fieldsets = (
        (None, {"fields": ("title", "body", "corner_image", "background")}),
        ("Кнопка (необязательно)", {"fields": ("button_label", "button_url")}),
        ("Тематическое оформление", {
            "fields": ("theme_overlay", "theme_header_bg", "theme_logo", "theme_decor", "theme_worksheet_bg"),
            "classes": ("collapse",),
        }),
        ("Публикация", {"fields": ("show", "sort_order", "created")}),
    )


