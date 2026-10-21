from django.contrib import admin

from .models import VkFunnelContact, VkFunnelLog


@admin.register(VkFunnelContact)
class VkFunnelContactAdmin(admin.ModelAdmin):
    list_display = ("vk_user_id", "topic", "first_message_at", "gift_sent_at", "followup1_sent_at", "followup2_sent_at", "messages_denied", "left_group")
    search_fields = ("vk_user_id",)


@admin.register(VkFunnelLog)
class VkFunnelLogAdmin(admin.ModelAdmin):
    list_display = ("created_at", "vk_user_id", "kind", "ok", "detail")
    list_filter = ("kind", "ok")
