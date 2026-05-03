from django.contrib import admin
from .models import (
    Level,
    LinkedTaskGroup,
    Part,
    Subject,
    Task,
    TaskGroup,
    TaskGroupMember,
    TaskList,
    Variant,
    VariantContent,
)

admin.site.register(Subject)
admin.site.register(TaskList)
admin.site.register(Level)
admin.site.register(Task)
admin.site.register(Variant)
admin.site.register(VariantContent)
admin.site.register(Part)


@admin.register(LinkedTaskGroup)
class LinkedTaskGroupAdmin(admin.ModelAdmin):
    list_display = ("subject", "level", "task_numbers")
    list_filter = ("subject", "level")


class TaskGroupMemberInline(admin.TabularInline):
    model = TaskGroupMember
    extra = 0
    raw_id_fields = ("task",)


@admin.register(TaskGroup)
class TaskGroupAdmin(admin.ModelAdmin):
    list_display = ("id", "subject", "level")
    list_filter = ("subject", "level")
    inlines = (TaskGroupMemberInline,)
from .models import Mark, Tag, TagsList, Tags

admin.site.register(Mark)
admin.site.register(Tag)
admin.site.register(TagsList)
admin.site.register(Tags)
