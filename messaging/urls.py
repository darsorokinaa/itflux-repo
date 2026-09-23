from django.urls import path

from .community_api import (
    CommunityCollectionView,
    CommunityDetailView,
    CommunityImageView,
    CommunityInviteCreateView,
    CommunityInviteRevokeView,
    CommunityLeaveView,
    CommunityMemberView,
    CommunityNotificationsView,
    ConversationFilesView,
    InviteAcceptView,
    InviteDeclineView,
    InvitePreviewView,
    MessagePinView,
    MessageReactionView,
    MessageReportView,
)
from .api import (
    AttachmentDownloadView,
    ContactSearchView,
    ConversationListView,
    MessageSearchView,
    DirectConversationView,
    LibraryFileView,
    MessageDeliveredView,
    MessageDetailView,
    MessageImportantView,
    MessageListCreateView,
    MessageReadView,
    SupportTicketCreateView,
    UnreadCountView,
)

urlpatterns = [
    path("conversations/", ConversationListView.as_view(), name="messaging_conversations"),
    path("search/", MessageSearchView.as_view(), name="messaging_search"),
    path("conversations/direct/", DirectConversationView.as_view(), name="messaging_direct"),
    path("contacts/", ContactSearchView.as_view(), name="messaging_contacts"),
    path("communities/", CommunityCollectionView.as_view(), name="messaging_communities"),
    path("community-invites/accept/", InviteAcceptView.as_view(), name="messaging_invite_accept"),
    path("community-invites/decline/", InviteDeclineView.as_view(), name="messaging_invite_decline"),
    path("community-invites/<str:token>/", InvitePreviewView.as_view(), name="messaging_invite_preview"),
    path("community-invites/<uuid:invite_id>/revoke/", CommunityInviteRevokeView.as_view(), name="messaging_invite_revoke"),
    path("unread-count/", UnreadCountView.as_view(), name="messaging_unread"),
    path("support/tickets/", SupportTicketCreateView.as_view(), name="messaging_support_ticket"),
    path(
        "conversations/<uuid:conversation_id>/community/",
        CommunityDetailView.as_view(),
        name="messaging_community_detail",
    ),
    path(
        "conversations/<uuid:conversation_id>/community-image/",
        CommunityImageView.as_view(),
        name="messaging_community_image",
    ),
    path(
        "conversations/<uuid:conversation_id>/invites/",
        CommunityInviteCreateView.as_view(),
        name="messaging_community_invites",
    ),
    path(
        "conversations/<uuid:conversation_id>/leave/",
        CommunityLeaveView.as_view(),
        name="messaging_community_leave",
    ),
    path(
        "conversations/<uuid:conversation_id>/notifications/",
        CommunityNotificationsView.as_view(),
        name="messaging_community_notifications",
    ),
    path(
        "conversations/<uuid:conversation_id>/members/<int:user_id>/",
        CommunityMemberView.as_view(),
        name="messaging_community_member",
    ),
    path(
        "conversations/<uuid:conversation_id>/files/",
        ConversationFilesView.as_view(),
        name="messaging_conversation_files",
    ),
    path(
        "conversations/<uuid:conversation_id>/messages/",
        MessageListCreateView.as_view(),
        name="messaging_messages",
    ),
    path(
        "conversations/<uuid:conversation_id>/messages/<int:message_id>/",
        MessageDetailView.as_view(),
        name="messaging_message_detail",
    ),
    path(
        "conversations/<uuid:conversation_id>/messages/<int:message_id>/reactions/",
        MessageReactionView.as_view(),
        name="messaging_reaction",
    ),
    path(
        "conversations/<uuid:conversation_id>/messages/<int:message_id>/pin/",
        MessagePinView.as_view(),
        name="messaging_pin",
    ),
    path(
        "conversations/<uuid:conversation_id>/messages/<int:message_id>/report/",
        MessageReportView.as_view(),
        name="messaging_report",
    ),
    path(
        "conversations/<uuid:conversation_id>/messages/<int:message_id>/important/",
        MessageImportantView.as_view(),
        name="messaging_message_important",
    ),
    path(
        "conversations/<uuid:conversation_id>/read/",
        MessageReadView.as_view(),
        name="messaging_read",
    ),
    path(
        "conversations/<uuid:conversation_id>/delivered/",
        MessageDeliveredView.as_view(),
        name="messaging_delivered",
    ),
    path(
        "library-files/<int:message_id>/<uuid:file_id>/",
        LibraryFileView.as_view(),
        name="messaging_library_file",
    ),
    path(
        "attachments/<uuid:attachment_id>/",
        AttachmentDownloadView.as_view(),
        name="messaging_attachment",
    ),
]
