from django.contrib import admin
from django.db.models import Q
from django import forms
from django.utils.html import strip_tags
from django_ckeditor_5.widgets import CKEditor5Widget

from .models import (
    Announcement,
    Criteria,
    ErrorReport,
    Level,
    Lesson,
    LinkedTaskGroup,
    Mark,
    MarkComment,
    Part,
    PedagogicalRecommendation,
    PreviewType,
    ReportConclusionTemplate,
    ReportNextStepTemplate,
    Subject,
    SubTopic,
    SupportInfo,
    Tag,
    TagOption,
    TagType,
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
    class TaskAdminForm(forms.ModelForm):
        class Meta:
            model = Task
            fields = "__all__"
            widgets = {
                "task_template": CKEditor5Widget(
                    config_name="default",
                    attrs={
                        "data-upload-url": "/ckeditor/upload/",
                        "data-ckeditor-custom-adapter": "1",
                        "title": (
                            "Условие в HTML (CKEditor). Для заданий с вариантами 1) 2) … "
                            "оставляйте таблицы из импорта — на сайте они отобразятся карточками автоматически."
                        ),
                    },
                ),
                "answer": CKEditor5Widget(config_name="default"),
            }

        class Media:
            js = ("js/ckeditor5_upload_adapter.js",)

    form = TaskAdminForm

    list_display = (
        "id",
        "quick_level",
        "task",
        "vpr_class",
        "answer_preview",
        "is_active",
        "vpr_basic",
        "vpr_advanced",
        "subtopic",
        "max_score",
        "task_template_preview",
        "created_by",
        "added_at",
    )
    list_filter = (
        ("task", admin.RelatedOnlyFieldListFilter),
        "is_active",
        "quick_level",
        "task__subject",
        "task__level",
        "task__part",
        "vpr_class",
        "vpr_advanced",
        "vpr_basic",
        "subtopic",
        "created_by",
        "added_at",
    )
    list_editable = ("quick_level", "task", "vpr_class", "is_active", "vpr_basic", "vpr_advanced", "subtopic")
    search_fields = ("answer", "task__task_title", "task_template")
    date_hierarchy = "added_at"
    list_select_related = ("task__subject", "task__level", "task__part", "subtopic", "quick_level")
    list_display_links = ("id",)
    list_per_page = 25
    show_full_result_count = False
    raw_id_fields = ("task",)
    autocomplete_fields = ("subtopic",)
    fieldsets = (
        (None, {"fields": ("task", "subtopic", "is_active", "task_template", "answer", "max_score", "files", "author", "added_at", "created_by")}),
        ("ВПР", {"fields": ("vpr_class", "vpr_basic", "vpr_advanced", "truth_table_enabled")}),
    )

    def save_model(self, request, obj, form, change):
        if not change:
            obj.created_by = username_for_created_by(request)
        if form is not None:
            if not change and obj.task_id and obj.quick_level_id is None:
                tl = TaskList.objects.filter(pk=obj.task_id).only("level_id").first()
                if tl:
                    obj.quick_level_id = tl.level_id
            elif (
                change
                and "task" in form.changed_data
                and "quick_level" not in form.changed_data
                and obj.task_id
            ):
                tl = TaskList.objects.filter(pk=obj.task_id).only("level_id").first()
                if tl:
                    obj.quick_level_id = tl.level_id
        super().save_model(request, obj, form, change)
        if obj.task_id and obj.quick_level_id is not None:
            TaskList.objects.filter(pk=obj.task_id).exclude(level_id=obj.quick_level_id).update(
                level_id=obj.quick_level_id
            )

    def task_template_preview(self, obj):
        raw = obj.task_template or ""
        plain = strip_tags(raw).strip() if raw else ""
        return (plain[:60] + "…") if len(plain) > 60 else plain
    task_template_preview.short_description = "Условие задачи"
    task_template_preview.admin_order_field = "task_template"

    def answer_preview(self, obj):
        raw = obj.answer or ""
        plain = strip_tags(raw).strip() if raw else ""
        return (plain[:50] + "…") if len(plain) > 50 else plain

    answer_preview.short_description = "Ответ"


@admin.register(SubTopic)
class SubTopicAdmin(admin.ModelAdmin):
    list_display = ("id", "task_list", "title", "order")
    list_filter = (
        ("task_list", admin.RelatedOnlyFieldListFilter),
        "task_list__subject",
        "task_list__level",
    )
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
    list_filter = (
        ("task__task", admin.RelatedOnlyFieldListFilter),
        "variant__var_subject",
        "variant__level",
    )
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



class TagOptionInline(admin.TabularInline):
    model = TagOption
    extra = 0
    fields = ("slug", "emoji", "title", "badge_style", "order", "is_active")


@admin.register(TagType)
class TagTypeAdmin(admin.ModelAdmin):
    list_display = ("id", "slug", "name", "order")
    list_editable = ("order",)
    search_fields = ("slug", "name")
    ordering = ("order", "id")
    inlines = (TagOptionInline,)


@admin.register(TagOption)
class TagOptionAdmin(admin.ModelAdmin):
    list_display = ("id", "tag_type", "slug", "emoji", "title", "badge_style", "order", "is_active")
    list_filter = ("tag_type", "badge_style", "is_active")
    list_editable = ("order", "is_active")
    search_fields = ("slug", "title", "emoji")
    ordering = ("tag_type", "order", "id")


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
    list_display = ("id", "info_preview", "subject", "level", "vpr_class")
    list_filter = ("subject", "level", "vpr_class")
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


@admin.register(Lesson)
class LessonAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "title",
        "subject",
        "grade",
        "level",
        "exam_type",
        "task_number",
        "difficulty",
        "access_level",
        "status",
        "updated_at",
    )
    list_filter = (
        "subject",
        "grade",
        "level",
        "exam_type",
        "difficulty",
        "access_level",
        "status",
    )
    search_fields = ("title", "slug", "topic", "subtopic", "short_description")
    prepopulated_fields = {"slug": ("title",)}
    list_editable = ("status", "access_level")
    ordering = ("-updated_at",)
    readonly_fields = ("created_at", "updated_at")


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


@admin.register(PedagogicalRecommendation)
class PedagogicalRecommendationAdmin(admin.ModelAdmin):
    list_display = (
        "subject",
        "exam_level",
        "topic",
        "subtopic",
        "skill_group",
        "is_active",
        "priority",
    )
    list_filter = ("subject", "exam_level", "skill_group", "is_active")
    search_fields = ("topic", "subtopic", "short_recommendation", "skill_group")
    ordering = ("subject", "exam_level", "priority", "id")


@admin.register(ReportConclusionTemplate)
class ReportConclusionTemplateAdmin(admin.ModelAdmin):
    list_display = (
        "result_level",
        "subject",
        "exam_level",
        "min_percent",
        "max_percent",
        "is_active",
    )
    list_filter = ("result_level", "subject", "exam_level", "is_active")
    search_fields = ("text_template",)


@admin.register(ReportNextStepTemplate)
class ReportNextStepTemplateAdmin(admin.ModelAdmin):
    list_display = ("condition_type", "subject", "exam_level", "priority", "is_active")
    list_filter = ("condition_type", "subject", "exam_level", "is_active")
    search_fields = ("text",)


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


