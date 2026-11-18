"""Админка статистики звонков: только чтение, фильтр по встрече."""

from django.contrib import admin
from django.db.models import Avg, Count, Max, Min

from .call_stats_models import CallStatsSample


@admin.register(CallStatsSample)
class CallStatsSampleAdmin(admin.ModelAdmin):
    list_display = (
        "created_at",
        "meeting_number",
        "user_number",
        "role",
        "provider",
        "rtt_ms",
        "loss_in_pct",
        "loss_out_pct",
        "jitter_ms",
        "bitrate_in_kbps",
        "bitrate_out_kbps",
        "audio_out_kbps",
        "share_direction",
        "share_fps",
        "share_resolution",
        "quality_limitation",
        "connection_type",
        "transport",
        "reconnects",
    )
    list_filter = (
        "provider",
        "role",
        "connection_type",
        "quality_limitation",
        "share_direction",
    )
    search_fields = ("=meeting__id", "=user__id")
    date_hierarchy = "created_at"
    list_per_page = 100
    list_select_related = False
    show_full_result_count = False

    def get_readonly_fields(self, request, obj=None):
        return [field.name for field in self.model._meta.fields]

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    @admin.display(description="Встреча", ordering="meeting_id")
    def meeting_number(self, obj):
        return obj.meeting_id

    @admin.display(description="Пользователь", ordering="user_id")
    def user_number(self, obj):
        return obj.user_id

    @admin.display(description="Размер экрана")
    def share_resolution(self, obj):
        if not obj.share_width or not obj.share_height:
            return ""
        return f"{obj.share_width}×{obj.share_height}"

    def changelist_view(self, request, extra_context=None):
        response = super().changelist_view(request, extra_context=extra_context)
        try:
            queryset = response.context_data["cl"].queryset
        except (AttributeError, KeyError):
            return response
        response.context_data["call_stats_totals"] = queryset.aggregate(
            samples=Count("id"),
            rtt_avg=Avg("rtt_ms"),
            loss_in_avg=Avg("loss_in_pct"),
            loss_out_avg=Avg("loss_out_pct"),
            share_fps_min=Min("share_fps"),
            reconnects=Max("reconnects"),
        )
        return response
