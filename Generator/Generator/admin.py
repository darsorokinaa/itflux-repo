from django.contrib import admin
from django.db.models import Q
from django import forms
from django.utils.html import format_html, strip_tags
from django_ckeditor_5.widgets import CKEditor5Widget

from .models import (
    Announcement,
    Criteria,
    ErrorReport,
    InterestingItem,
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
    list_display = ("id", "subject_short", "subject_name", "background_color", "has_background_image")
    list_filter = ("subject_short",)
    search_fields = ("subject_short", "subject_name")
    list_per_page = 50
    show_full_result_count = False
    readonly_fields = ("background_image_preview",)
    fields = (
        "subject_short",
        "subject_name",
        "background_color",
        "background_image",
        "background_image_preview",
    )

    @admin.display(boolean=True, description="Фон (картинка)")
    def has_background_image(self, obj):
        return bool(obj.background_image)

    @admin.display(description="Превью фона")
    def background_image_preview(self, obj):
        if not obj.background_image:
            return "—"
        return format_html(
            '<img src="{}" style="max-width:320px;max-height:180px;border-radius:12px;" alt="">',
            obj.background_image.url,
        )


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
    fieldsets = (
        (
            None,
            {
                "fields": (
                    "title",
                    "slug",
                    "subject",
                    "grade",
                    "level",
                    "exam_type",
                    "task_number",
                    "topic",
                    "subtopic",
                    "duration_minutes",
                    "difficulty",
                    "status",
                    "access_level",
                )
            },
        ),
        (
            "Описание",
            {"fields": ("short_description", "teacher_goal", "student_result")},
        ),
        (
            "Файлы",
            {"fields": ("cover_image", "file", "archive")},
        ),
        (
            "Служебное",
            {"fields": ("created_at", "updated_at")},
        ),
    )


@admin.register(InterestingItem)
class InterestingItemAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "title",
        "tag",
        "status",
        "sort_order",
        "updated_at",
    )
    list_filter = ("status", "tag")
    search_fields = ("title", "slug", "short_description", "tag")
    prepopulated_fields = {"slug": ("title",)}
    list_editable = ("status", "sort_order")
    ordering = ("sort_order", "-updated_at")
    readonly_fields = ("created_at", "updated_at")
    fieldsets = (
        (
            None,
            {
                "fields": (
                    "title",
                    "slug",
                    "tag",
                    "accent_color",
                    "status",
                    "sort_order",
                )
            },
        ),
        ("Описание", {"fields": ("short_description",)}),
        ("Файлы", {"fields": ("cover_image", "file", "archive")}),
        ("Служебное", {"fields": ("created_at", "updated_at")}),
    )


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


# --- Сезонное / праздничное оформление ---

from .seasonal_theme_models import SeasonalTheme, SeasonalThemeDecoration  # noqa: E402
from .seasonal_theme_service import (  # noqa: E402
    PREVIEW_SESSION_KEY,
    PREVIEW_TOKEN_SESSION_KEY,
    invalidate_seasonal_theme_cache,
    make_preview_token,
)


class SeasonalThemeDecorationInline(admin.StackedInline):
    model = SeasonalThemeDecoration
    extra = 0
    classes = ("collapse",)
    verbose_name_plural = "Доп. декор (необязательно, редко нужно)"
    fields = (
        "name",
        "image",
        "zone",
        "position",
        "width",
        "opacity",
        "show_desktop",
        "show_mobile",
        "is_active",
    )
    show_change_link = True


@admin.register(SeasonalTheme)
class SeasonalThemeAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "name",
        "status_display",
        "is_active",
        "start_at",
        "end_at",
        "animation_type",
        "has_button_icon",
    )
    list_filter = ("is_active", "is_draft", "animation_type", "force_active_for_testing")
    search_fields = ("name", "slug", "description")
    prepopulated_fields = {"slug": ("name",)}
    readonly_fields = (
        "created_at",
        "updated_at",
        "status_display",
        "preview_help",
        "button_icon_preview",
        "background_pattern_preview",
        "animation_image_preview",
        "hero_history_icon_preview",
        "hero_history_image_preview",
        "hero_history_corner_preview",
    )
    inlines = [SeasonalThemeDecorationInline]
    fieldsets = (
        (
            "1. Название и период",
            {
                "fields": (
                    "name",
                    "slug",
                    "description",
                    "status_display",
                    ("start_at", "end_at"),
                    ("is_draft", "is_active"),
                    "priority",
                )
            },
        ),
        (
            "1б. Стикер на главной",
            {
                "description": (
                    "Бумажка слева от синего баннера на главной, когда тема активна. "
                    "Текст и оформление задаются здесь. Клик открывает справку (блок 1в)."
                ),
                "fields": (
                    "hero_sticker_title",
                    "hero_sticker_text",
                    "hero_sticker_background_color",
                    "hero_sticker_title_color",
                    "hero_sticker_text_color",
                ),
            },
        ),
        (
            "1в. Историческая справка (модалка на главной)",
            {
                "description": (
                    "Всплывающее окно по клику на стикер или ссылку. "
                    "Текст и оформление (цвета, кнопка, углы) задаются в БД."
                ),
                "fields": (
                    "hero_history_title",
                    "hero_history_body",
                    "hero_history_link_label",
                    "hero_history_button_label",
                    "hero_history_icon",
                    "hero_history_icon_preview",
                    "hero_history_image",
                    "hero_history_image_preview",
                    "hero_history_background_color",
                    "hero_history_border_color",
                    "hero_history_title_color",
                    "hero_history_text_color",
                    "hero_history_button_color",
                    "hero_history_show_corners",
                    "hero_history_corner_image",
                    "hero_history_corner_preview",
                ),
            },
        ),
        (
            "2. Картинки оформления — просто загрузите файлы",
            {
                "description": (
                    "Одна тема = один набор картинок. Необязательные поля можно оставить пустыми."
                ),
                "fields": (
                    "background_color",
                    "background_pattern",
                    "background_pattern_preview",
                    "background_pattern_mobile",
                    "background_opacity",
                    "menu_background",
                    "card_pattern",
                    "card_pattern_opacity",
                    "card_border_color",
                    "header_decor",
                    "corner_image",
                    "accent_color",
                ),
            },
        ),
        (
            "3. Кнопка «Оформление» (левый нижний угол)",
            {
                "description": (
                    "На плавающей кнопке слева внизу: либо загруженная картинка, "
                    "либо смайлик с клавиатуры (🎄 🎃 🌸). Если есть картинка — она важнее смайлика."
                ),
                "fields": ("button_icon", "button_icon_preview", "button_emoji"),
            },
        ),
        (
            "4. Анимация",
            {
                "description": (
                    "Загрузите картинку элемента (листочек, снежинка…) — она будет сыпаться по экрану. "
                    "Тип анимации задаёт характер движения."
                ),
                "fields": (
                    "animation_type",
                    "animation_image",
                    "animation_image_preview",
                    "animation_intensity",
                    "animation_max_elements",
                ),
            },
        ),
        (
            "5. Права пользователя и тест",
            {
                "fields": (
                    "allow_user_disable",
                    "allow_manual_selection",
                    "force_active_for_testing",
                    "admin_only",
                    "preview_help",
                )
            },
        ),
        (
            "Дополнительно (обычно не трогать)",
            {
                "classes": ("collapse",),
                "fields": (
                    "timezone",
                    "is_default_seasonal_theme",
                    "background_repeat",
                    "background_size",
                    "background_position",
                    "background_overlay_color",
                    "background_overlay_opacity",
                    "disable_background_on_low_end",
                    "animation_fps_limit",
                    "include_routes",
                    "exclude_routes",
                    "surfaces",
                    "created_at",
                    "updated_at",
                ),
            },
        ),
    )
    actions = (
        "duplicate_themes",
        "activate_for_testing",
        "disable_testing_force",
        "start_preview",
    )

    @admin.display(boolean=True, description="Иконка кнопки")
    def has_button_icon(self, obj):
        return bool(obj.button_icon)

    @admin.display(description="Статус")
    def status_display(self, obj):
        labels = {
            "draft": "Черновик",
            "scheduled": "Запланирована",
            "active": "Активна",
            "finished": "Завершена",
            "disabled": "Отключена",
        }
        return labels.get(obj.compute_status(), obj.compute_status())

    @admin.display(description="Предпросмотр темы")
    def preview_help(self, obj):
        if not obj or not obj.pk:
            return "Сохраните тему, затем отметьте её в списке → действие «Предпросмотр темы»."
        return format_html(
            "Отметьте тему в списке → действие «Предпросмотр темы». "
            "Откройте сайт в той же сессии браузера — появится плашка предпросмотра."
        )

    @admin.display(description="Превью фона")
    def background_pattern_preview(self, obj):
        if not obj or not obj.background_pattern:
            return "—"
        return format_html(
            '<img src="{}" style="max-width:220px;max-height:120px;border-radius:8px;" alt="">',
            obj.background_pattern.url,
        )

    @admin.display(description="Превью иконки кнопки")
    def button_icon_preview(self, obj):
        if not obj or not obj.button_icon:
            return "—"
        return format_html(
            '<img src="{}" style="width:56px;height:56px;object-fit:contain;border-radius:12px;'
            'background:#f1f5f9;padding:6px;" alt="">',
            obj.button_icon.url,
        )

    @admin.display(description="Превью элемента анимации")
    def animation_image_preview(self, obj):
        if not obj or not obj.animation_image:
            return "—"
        return format_html(
            '<img src="{}" style="width:64px;height:64px;object-fit:contain;border-radius:12px;'
            'background:#f1f5f9;padding:6px;" alt="">',
            obj.animation_image.url,
        )

    @admin.display(description="Превью иконки справки")
    def hero_history_icon_preview(self, obj):
        if not obj or not obj.hero_history_icon:
            return "—"
        return format_html(
            '<img src="{}" style="width:48px;height:48px;object-fit:contain;border-radius:10px;'
            'background:#f8f1e3;padding:4px;" alt="">',
            obj.hero_history_icon.url,
        )

    @admin.display(description="Превью картинки справки")
    def hero_history_image_preview(self, obj):
        if not obj or not obj.hero_history_image:
            return "—"
        return format_html(
            '<img src="{}" style="max-width:220px;max-height:120px;object-fit:contain;'
            'border-radius:10px;background:#f8f1e3;padding:4px;" alt="">',
            obj.hero_history_image.url,
        )

    @admin.display(description="Превью декора углов")
    def hero_history_corner_preview(self, obj):
        if not obj or not obj.hero_history_corner_image:
            return "—"
        return format_html(
            '<img src="{}" style="width:56px;height:56px;object-fit:contain;border-radius:10px;'
            'background:#f8f1e3;padding:4px;" alt="">',
            obj.hero_history_corner_image.url,
        )

    @admin.action(description="Продублировать выбранные темы")
    def duplicate_themes(self, request, queryset):
        count = 0
        for theme in queryset:
            theme.duplicate()
            count += 1
        self.message_user(request, f"Создано копий: {count}")

    @admin.action(description="Принудительно активировать для теста")
    def activate_for_testing(self, request, queryset):
        updated = queryset.update(force_active_for_testing=True, is_active=True, is_draft=False)
        invalidate_seasonal_theme_cache()
        self.message_user(request, f"Включено для теста: {updated}")

    @admin.action(description="Снять принудительную активацию")
    def disable_testing_force(self, request, queryset):
        updated = queryset.update(force_active_for_testing=False)
        invalidate_seasonal_theme_cache()
        self.message_user(request, f"Снято: {updated}")

    @admin.action(description="Предпросмотр темы (сессия админа)")
    def start_preview(self, request, queryset):
        theme = queryset.first()
        if theme is None:
            self.message_user(request, "Выберите одну тему", level="error")
            return
        if queryset.count() > 1:
            self.message_user(request, "Выберите только одну тему", level="error")
            return
        token = make_preview_token(theme.id, request.user.id)
        request.session[PREVIEW_SESSION_KEY] = theme.id
        request.session[PREVIEW_TOKEN_SESSION_KEY] = token
        request.session.modified = True
        self.message_user(
            request,
            f"Предпросмотр «{theme.name}» включён. Откройте сайт в этой же сессии браузера.",
        )


@admin.register(SeasonalThemeDecoration)
class SeasonalThemeDecorationAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "theme",
        "name",
        "zone",
        "position",
        "show_desktop",
        "show_mobile",
        "is_active",
    )
    list_filter = ("zone", "is_active")
    search_fields = ("name", "theme__name", "theme__slug")
    list_select_related = ("theme",)
    autocomplete_fields = ("theme",)