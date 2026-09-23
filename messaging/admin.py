from django import forms
from django.contrib import admin

from .models import (
    Community,
    CommunityInvite,
    CommunityMember,
    ConsentPromptState,
    Conversation,
    Message,
    MessagingAccessLog,
    MessagingAuditLog,
    RetentionPolicy,
    SupportTicket,
    UserConsent,
    UserConsentLog,
)


class AppendOnlyAdmin(admin.ModelAdmin):
    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(Conversation)
class ConversationAdmin(admin.ModelAdmin):
    list_display = ("id", "subject_user", "kind", "pair_key", "updated_at")
    list_filter = ("kind",)
    search_fields = ("subject_user__username", "subject_user__email")
    raw_id_fields = ("subject_user",)


@admin.register(SupportTicket)
class SupportTicketAdmin(admin.ModelAdmin):
    list_display = ("id", "conversation", "category", "status", "priority", "created_at")
    list_filter = ("status", "category", "priority")
    raw_id_fields = ("conversation", "assigned_to")


class MessageAdminForm(forms.ModelForm):
    class Meta:
        model = Message
        fields = "__all__"

    def clean_text(self):
        from .safety import MessageBlocked, inspect_text
        text = self.cleaned_data.get("text") or ""
        decision = inspect_text(text)
        if decision.blocked:
            raise forms.ValidationError(MessageBlocked(decision.reason).message)
        return text


@admin.register(Message)
class MessageAdmin(admin.ModelAdmin):
    form = MessageAdminForm
    list_display = ("id", "conversation", "sender_type", "purpose", "is_important", "message_type", "created_at")
    list_filter = ("sender_type", "purpose", "message_type", "is_important")
    list_editable = ("is_important",)
    raw_id_fields = ("conversation", "ticket", "sender", "reply_to")


@admin.register(Community)
class CommunityAdmin(admin.ModelAdmin):
    list_display = ("name", "subject", "is_active", "is_archived", "messages_enabled", "created_at")
    search_fields = ("name", "subject", "slug")
    raw_id_fields = ("conversation", "created_by")


@admin.register(CommunityMember)
class CommunityMemberAdmin(admin.ModelAdmin):
    list_display = ("community", "user", "role", "is_banned", "left_at")
    raw_id_fields = ("community", "user")


@admin.register(CommunityInvite)
class CommunityInviteAdmin(admin.ModelAdmin):
    list_display = ("community", "invited_user", "is_active", "uses_count", "expires_at", "created_at")
    raw_id_fields = ("community", "invited_user", "created_by")


@admin.register(RetentionPolicy)
class RetentionPolicyAdmin(admin.ModelAdmin):
    list_display = ("object_kind", "retain_days", "updated_at")


@admin.register(UserConsent)
class UserConsentAdmin(admin.ModelAdmin):
    list_display = ("user", "channel", "granted", "consented_at", "revoked_at", "consent_text_version")
    raw_id_fields = ("user",)

    def has_add_permission(self, request):
        return False


@admin.register(UserConsentLog)
class UserConsentLogAdmin(AppendOnlyAdmin):
    list_display = ("id", "user", "channel", "action", "consent_text_version", "created_at")


@admin.register(ConsentPromptState)
class ConsentPromptStateAdmin(admin.ModelAdmin):
    list_display = ("user", "prompt_key", "shown_at", "decided_at", "consent_text_version")
    raw_id_fields = ("user",)

    def has_add_permission(self, request):
        return False


@admin.register(MessagingAuditLog)
class MessagingAuditLogAdmin(AppendOnlyAdmin):
    list_display = ("id", "actor", "action", "object_kind", "object_id", "created_at")


@admin.register(MessagingAccessLog)
class MessagingAccessLogAdmin(AppendOnlyAdmin):
    list_display = ("id", "actor", "action", "conversation", "attachment_id", "created_at")
