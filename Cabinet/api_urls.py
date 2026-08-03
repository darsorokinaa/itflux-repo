from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import (
    ai_api,
    api_views,
    billing_api,
    boards_api,
    files_api,
    homework_attachments,
    journal_api,
    parent_api,
    push_api,
    schedule_api,
    student_api,
    subscription_api,
    telegram_api,
)

router = DefaultRouter()
router.register("students", api_views.StudentViewSet, basename="cabinet-students")
router.register("invitations", api_views.StudentInvitationViewSet, basename="cabinet-invitations")
router.register("groups", api_views.StudentGroupViewSet, basename="cabinet-groups")
router.register("lessons", api_views.LessonViewSet, basename="cabinet-lessons")
router.register("lesson-plans", api_views.LessonPlanViewSet, basename="cabinet-lesson-plans")
router.register("lesson-plan-items", api_views.LessonPlanItemViewSet, basename="cabinet-lesson-plan-items")
router.register("lesson-plan-enrollments", api_views.LessonPlanEnrollmentViewSet, basename="cabinet-lesson-plan-enrollments")
router.register("interactives", api_views.InteractiveViewSet, basename="cabinet-interactives")
router.register("interactive-assignments", api_views.InteractiveAssignmentViewSet, basename="cabinet-interactive-assignments")
router.register("interactive-attempts", api_views.InteractiveAttemptViewSet, basename="cabinet-interactive-attempts")
router.register(
    "interactive-boards",
    boards_api.InteractiveBoardViewSet,
    basename="cabinet-interactive-boards",
)
router.register("review", api_views.ReviewViewSet, basename="cabinet-review")
router.register("schedule", schedule_api.ScheduleEventViewSetExtended, basename="cabinet-schedule")
router.register("schedule-series", schedule_api.ScheduleSeriesViewSet, basename="cabinet-schedule-series")
router.register("notifications", schedule_api.NotificationViewSet, basename="cabinet-notifications")
router.register("materials", api_views.MaterialViewSet, basename="cabinet-materials")

urlpatterns = [
    path(
        "student/interactive-boards/",
        boards_api.StudentInteractiveBoardsView.as_view(),
        name="student_interactive_boards",
    ),

    # Мои файлы (учитель)
    path("files/", files_api.FilesListView.as_view(), name="cabinet_files_list"),
    path("files/quota/", files_api.FilesQuotaView.as_view(), name="cabinet_files_quota"),
    path("files/folders/", files_api.FilesFolderCreateView.as_view(), name="cabinet_files_folder_create"),
    path("files/folders/<uuid:folder_id>/", files_api.FolderDetailView.as_view(), name="cabinet_files_folder_detail"),
    path("files/folders/<uuid:folder_id>/restore/", files_api.FolderRestoreView.as_view(), name="cabinet_files_folder_restore"),
    path("files/upload/", files_api.FilesUploadView.as_view(), name="cabinet_files_upload"),
    path("files/move/", files_api.FilesMoveBatchView.as_view(), name="cabinet_files_move"),
    path("files/trash/empty/", files_api.FilesEmptyTrashView.as_view(), name="cabinet_files_empty_trash"),
    path("files/relations/<uuid:relation_id>/", files_api.FileRelationDeleteView.as_view(), name="cabinet_files_relation_delete"),
    path("files/<uuid:file_id>/", files_api.FilesDetailView.as_view(), name="cabinet_files_detail"),
    path("files/<uuid:file_id>/download/", files_api.FilesDownloadView.as_view(), name="cabinet_files_download"),
    path("files/<uuid:file_id>/preview/", files_api.FilesPreviewView.as_view(), name="cabinet_files_preview"),
    path("files/<uuid:file_id>/trash/", files_api.FilesTrashView.as_view(), name="cabinet_files_trash"),
    path("files/<uuid:file_id>/restore/", files_api.FilesRestoreView.as_view(), name="cabinet_files_restore"),
    path("files/<uuid:file_id>/copy/", files_api.FilesCopyView.as_view(), name="cabinet_files_copy"),
    path("files/<uuid:file_id>/attach/", files_api.FilesAttachView.as_view(), name="cabinet_files_attach"),
    path("files/<uuid:file_id>/assign/", files_api.FilesAssignView.as_view(), name="cabinet_files_assign"),

    # Мои файлы (ученик)
    path("student/files/", files_api.StudentFilesListView.as_view(), name="student_files_list"),
    path("student/files/quota/", files_api.StudentFilesQuotaView.as_view(), name="student_files_quota"),
    path("student/files/folders/", files_api.StudentFilesFolderCreateView.as_view(), name="student_files_folder_create"),
    path("student/files/folders/<uuid:folder_id>/", files_api.StudentFolderDetailView.as_view(), name="student_files_folder_detail"),
    path("student/files/upload/", files_api.StudentFilesUploadView.as_view(), name="student_files_upload"),
    path("student/files/shared/<uuid:file_id>/download/", files_api.StudentSharedFileDownloadView.as_view(), name="student_files_shared_download"),
    path("student/files/shared/<uuid:file_id>/preview/", files_api.StudentSharedFilePreviewView.as_view(), name="student_files_shared_preview"),
    path("student/files/<uuid:file_id>/", files_api.StudentFilesDetailView.as_view(), name="student_files_detail"),
    path("student/files/<uuid:file_id>/download/", files_api.StudentFilesDownloadView.as_view(), name="student_files_download"),
    path("student/files/<uuid:file_id>/preview/", files_api.StudentFilesPreviewView.as_view(), name="student_files_preview"),
    path("student/files/<uuid:file_id>/trash/", files_api.StudentFilesTrashView.as_view(), name="student_files_trash"),
    path("student/files/<uuid:file_id>/restore/", files_api.StudentFilesRestoreView.as_view(), name="student_files_restore"),

    path("dashboard/", api_views.DashboardView.as_view(), name="cabinet_dashboard"),
    path("nav-counts/", api_views.NavCountsView.as_view(), name="cabinet_nav_counts"),
    path("student/dashboard/", student_api.StudentDashboardView.as_view(), name="student_dashboard"),
    path("student/lessons/", student_api.StudentLessonsView.as_view(), name="student_lessons"),
    path("student/lessons/<int:assignment_id>/", student_api.StudentLessonDetailView.as_view(), name="student_lesson_detail"),
    path("student/assignments/", student_api.StudentAssignmentsView.as_view(), name="student_assignments"),
    path("student/assignments/<int:homework_id>/", student_api.StudentAssignmentDetailView.as_view(), name="student_assignment_detail"),
    path(
        "student/assignments/<int:homework_id>/attached-file/",
        student_api.StudentAssignmentAttachedFileView.as_view(),
        name="student_assignment_attached_file",
    ),
    path("student/interactives/", student_api.StudentInteractivesView.as_view(), name="student_interactives"),
    path("student/interactives/<int:assignment_id>/", student_api.StudentInteractiveDetailView.as_view(), name="student_interactive_detail"),
    path("student/schedule/", student_api.StudentScheduleView.as_view(), name="student_schedule"),
    path("student/schedule/<int:event_id>/", student_api.StudentScheduleEventDetailView.as_view(), name="student_schedule_detail"),
    path("student/progress/", student_api.StudentProgressView.as_view(), name="student_progress"),
    path("student/materials/", student_api.StudentMaterialsView.as_view(), name="student_materials"),
    path("student/subjects/", student_api.StudentSubjectsView.as_view(), name="student_subjects"),
    path("student/profile/", student_api.StudentProfileView.as_view(), name="student_profile"),
    path("student/notifications/", student_api.StudentNotificationsView.as_view(), name="student_notifications"),
    path("student/notifications/<int:notification_id>/read/", student_api.StudentNotificationReadView.as_view(), name="student_notification_read"),
    path("student/notifications/read-all/", student_api.StudentNotificationsReadAllView.as_view(), name="student_notifications_read_all"),
    path("student/notifications/clear/", student_api.StudentNotificationsClearView.as_view(), name="student_notifications_clear"),
    path("student/results/", journal_api.StudentResultsListView.as_view(), name="student_results"),
    path("student/results/<int:record_id>/", journal_api.StudentResultDetailView.as_view(), name="student_result_detail"),
    # Журнал успеваемости
    path("journal/", journal_api.JournalOverviewView.as_view(), name="journal_overview"),
    path("journal/gradebook/", journal_api.JournalGradebookView.as_view(), name="journal_gradebook"),
    path("journal/entries/", journal_api.JournalEntriesView.as_view(), name="journal_entries"),
    path("journal/lessons/", journal_api.JournalLessonsListView.as_view(), name="journal_lessons"),
    path("journal/lessons/<int:lesson_id>/", journal_api.JournalLessonDetailView.as_view(), name="journal_lesson_detail"),
    path(
        "journal/lessons/<int:lesson_id>/topics/",
        journal_api.JournalLessonTopicsView.as_view(),
        name="journal_lesson_topics",
    ),
    path("journal/lessons/<int:lesson_id>/complete/", journal_api.JournalLessonCompleteView.as_view(), name="journal_lesson_complete"),
    path("journal/lessons/<int:lesson_id>/publish/", journal_api.JournalLessonPublishView.as_view(), name="journal_lesson_publish"),
    path("journal/lessons/<int:lesson_id>/bulk/", journal_api.JournalLessonBulkView.as_view(), name="journal_lesson_bulk"),
    path("journal/students/", journal_api.JournalStudentsSummaryView.as_view(), name="journal_students_summary"),
    path("journal/students/<int:student_id>/", journal_api.JournalStudentView.as_view(), name="journal_student"),
    path("journal/groups/<int:group_id>/", journal_api.JournalGroupView.as_view(), name="journal_group"),
    path("journal/attendance/", journal_api.JournalAttendanceView.as_view(), name="journal_attendance"),
    path("journal/analytics/", journal_api.JournalAnalyticsView.as_view(), name="journal_analytics"),
    path("journal/criteria/", journal_api.JournalCriteriaView.as_view(), name="journal_criteria"),
    path("journal/criteria/<int:criterion_id>/", journal_api.JournalCriterionDetailView.as_view(), name="journal_criterion_detail"),
    path("journal/templates/", journal_api.JournalTemplatesView.as_view(), name="journal_templates"),
    path("journal/templates/<int:template_id>/", journal_api.JournalTemplateDetailView.as_view(), name="journal_template_detail"),
    path("journal/tags/", journal_api.JournalTagsView.as_view(), name="journal_tags"),
    path("journal/settings/", journal_api.JournalSettingsView.as_view(), name="journal_settings"),
    path("journal/topics/", journal_api.JournalTopicsView.as_view(), name="journal_topics"),
    path("journal/attention/", journal_api.JournalAttentionView.as_view(), name="journal_attention"),
    path("journal/export/", journal_api.JournalExportView.as_view(), name="journal_export"),
    path(
        "interactive-appearance/",
        api_views.InteractiveAppearanceView.as_view(),
        name="cabinet_interactive_appearance",
    ),
    path("reports/overview/", api_views.ReportsOverviewView.as_view(), name="cabinet_reports_overview"),
    path("reports/student/<int:student_id>/", api_views.ReportsStudentView.as_view(), name="cabinet_reports_student"),
    path("reports/group/<int:group_id>/", api_views.ReportsGroupView.as_view(), name="cabinet_reports_group"),
    path("reports/lesson/<int:lesson_id>/", api_views.ReportsLessonView.as_view(), name="cabinet_reports_lesson"),
    path("reports/topics/", api_views.ReportsTopicsView.as_view(), name="cabinet_reports_topics"),
    path("reports/parent-summary/", api_views.ReportsParentSummaryView.as_view(), name="cabinet_reports_parent_summary"),
    path("homework/<int:homework_id>/", api_views.HomeworkDetailView.as_view(), name="cabinet_homework_detail"),
    path(
        "homework/<int:homework_id>/attachments/",
        homework_attachments.HomeworkAttachmentsView.as_view(),
        name="cabinet_homework_attachments",
    ),
    path(
        "homework/<int:homework_id>/attachments/<uuid:attachment_id>/",
        homework_attachments.HomeworkAttachmentDetailView.as_view(),
        name="cabinet_homework_attachment_detail",
    ),
    path(
        "homework/<int:homework_id>/tasks/",
        api_views.HomeworkTasksAddView.as_view(),
        name="cabinet_homework_tasks_add",
    ),
    path(
        "homework/<int:homework_id>/copy/",
        api_views.HomeworkCopyView.as_view(),
        name="cabinet_homework_copy",
    ),
    path(
        "homework/submissions/<int:submission_id>/attached-file/",
        api_views.HomeworkSubmissionAttachedFileView.as_view(),
        name="cabinet_homework_submission_attached_file",
    ),
    path("direct-materials/", api_views.DirectMaterialAssignView.as_view(), name="direct_materials"),
    path("direct-materials/<int:pk>/", api_views.DirectMaterialAssignView.as_view(), name="direct_materials_delete"),
    path("lesson-plans/subjects/", api_views.LessonPlanSubjectOptionsView.as_view(), name="cabinet_lesson_plan_subjects"),
    path("lesson-plans/levels/", api_views.LessonPlanLevelOptionsView.as_view(), name="cabinet_lesson_plan_levels"),
    path("invitations/join/<str:token>/", api_views.InvitationPreviewView.as_view(), name="cabinet_invitation_preview"),
    path("invitations/join/<str:token>/accept/", api_views.InvitationAcceptView.as_view(), name="cabinet_invitation_accept"),

    # Родители: приглашение из карточки ученика + кабинет
    path(
        "students/<int:student_id>/parents/",
        parent_api.StudentParentsAccessView.as_view(),
        name="student_parents_access",
    ),
    path(
        "students/<int:student_id>/parents/invite/",
        parent_api.StudentParentInviteCreateView.as_view(),
        name="student_parent_invite",
    ),
    path(
        "students/<int:student_id>/parents/invitations/<int:invitation_id>/revoke/",
        parent_api.StudentParentInviteRevokeView.as_view(),
        name="student_parent_invite_revoke",
    ),
    path(
        "students/<int:student_id>/parents/relationships/<int:relationship_id>/",
        parent_api.StudentParentAccessUpdateView.as_view(),
        name="student_parent_access_update",
    ),
    path(
        "parent/invite/<str:token>/",
        parent_api.ParentInvitePreviewView.as_view(),
        name="parent_invite_preview",
    ),
    path(
        "parent/invite/<str:token>/accept/",
        parent_api.ParentInviteAcceptView.as_view(),
        name="parent_invite_accept",
    ),
    path("parent/children/", parent_api.ParentChildrenView.as_view(), name="parent_children"),
    path("parent/dashboard/", parent_api.ParentDashboardView.as_view(), name="parent_dashboard"),
    path("parent/homework/", parent_api.ParentHomeworkView.as_view(), name="parent_homework"),
    path("parent/journal/", parent_api.ParentJournalView.as_view(), name="parent_journal"),
    path("parent/schedule/", parent_api.ParentScheduleView.as_view(), name="parent_schedule"),
    path("parent/billing/", parent_api.ParentBillingView.as_view(), name="parent_billing"),
    path("parent/billing/claim/", parent_api.ParentPaymentClaimView.as_view(), name="parent_billing_claim"),
    path("telegram/status/", telegram_api.TelegramStatusView.as_view(), name="cabinet_telegram_status"),
    path("telegram/connect-link/", telegram_api.TelegramConnectLinkView.as_view(), name="cabinet_telegram_connect_link"),
    path("telegram/disconnect/", telegram_api.TelegramDisconnectView.as_view(), name="cabinet_telegram_disconnect"),
    path("telegram/test/", telegram_api.TelegramTestNotificationView.as_view(), name="cabinet_telegram_test"),
    path("telegram/webhook/", telegram_api.telegram_bot_webhook, name="cabinet_telegram_webhook"),
    path("push/vapid-public-key/", push_api.PushVapidPublicKeyView.as_view(), name="cabinet_push_vapid"),
    path("push/subscribe/", push_api.PushSubscribeView.as_view(), name="cabinet_push_subscribe"),
    path("push/unsubscribe/", push_api.PushUnsubscribeView.as_view(), name="cabinet_push_unsubscribe"),
    path("push/devices/", push_api.PushDevicesView.as_view(), name="cabinet_push_devices"),
    path("push/test/", push_api.PushTestView.as_view(), name="cabinet_push_test"),
    path(
        "settings/notifications/",
        telegram_api.NotificationPreferencesView.as_view(),
        name="cabinet_notification_preferences",
    ),
    # Учёт оплат репетитора (не SaaS)
    path("billing/dashboard/", billing_api.BillingDashboardView.as_view(), name="billing_dashboard"),
    path("billing/settings/", billing_api.TeacherBillingSettingsView.as_view(), name="billing_settings"),
    path("billing/accounts/", billing_api.BillingAccountsView.as_view(), name="billing_accounts"),
    path("billing/accounts/<int:account_id>/", billing_api.BillingAccountDetailView.as_view(), name="billing_account_detail"),
    path(
        "billing/accounts/<int:account_id>/settings/",
        billing_api.BillingAccountSettingsView.as_view(),
        name="billing_account_settings",
    ),
    path(
        "billing/students/<int:student_id>/account/",
        billing_api.BillingAccountByStudentView.as_view(),
        name="billing_account_by_student",
    ),
    path("billing/transactions/", billing_api.BillingTransactionsView.as_view(), name="billing_transactions"),
    path("billing/payments/", billing_api.BillingPaymentsView.as_view(), name="billing_payments"),
    path("billing/refunds/", billing_api.BillingRefundsView.as_view(), name="billing_refunds"),
    path("billing/adjustments/", billing_api.BillingAdjustmentsView.as_view(), name="billing_adjustments"),
    path(
        "billing/transactions/<uuid:tx_id>/reverse/",
        billing_api.BillingTransactionReverseView.as_view(),
        name="billing_transaction_reverse",
    ),
    path("billing/packages/", billing_api.BillingPackagesView.as_view(), name="billing_packages"),
    path("billing/packages/<uuid:package_id>/", billing_api.BillingPackageDetailView.as_view(), name="billing_package_detail"),
    path(
        "billing/packages/<uuid:package_id>/freeze/",
        billing_api.BillingPackageFreezeView.as_view(),
        name="billing_package_freeze",
    ),
    path(
        "billing/packages/<uuid:package_id>/unfreeze/",
        billing_api.BillingPackageUnfreezeView.as_view(),
        name="billing_package_unfreeze",
    ),
    path(
        "billing/packages/<uuid:package_id>/extend/",
        billing_api.BillingPackageExtendView.as_view(),
        name="billing_package_extend",
    ),
    path(
        "billing/packages/<uuid:package_id>/adjust/",
        billing_api.BillingPackageAdjustView.as_view(),
        name="billing_package_adjust",
    ),
    path(
        "billing/packages/<uuid:package_id>/settle-unpaid/",
        billing_api.BillingPackageSettleUnpaidView.as_view(),
        name="billing_package_settle_unpaid",
    ),
    path(
        "billing/accounts/<int:account_id>/charge-from-package/",
        billing_api.BillingAccountChargeFromPackageView.as_view(),
        name="billing_account_charge_from_package",
    ),
    path(
        "billing/event-billing/<uuid:record_id>/charge-from-package/",
        billing_api.BillingEventBillingChargeFromPackageView.as_view(),
        name="billing_event_billing_charge_from_package",
    ),
    path(
        "billing/event-billing/<uuid:record_id>/refund-package/",
        billing_api.BillingEventBillingRefundPackageView.as_view(),
        name="billing_event_billing_refund_package",
    ),
    path(
        "billing/event-billing/<uuid:record_id>/mark-paid/",
        billing_api.BillingEventBillingMarkPaidView.as_view(),
        name="billing_event_billing_mark_paid",
    ),
    path(
        "billing/unresolved-lessons/",
        billing_api.BillingUnresolvedLessonsView.as_view(),
        name="billing_unresolved_lessons",
    ),
    path(
        "billing/events/<int:event_id>/preview/",
        billing_api.BillingEventPreviewView.as_view(),
        name="billing_event_preview",
    ),
    path(
        "billing/events/<int:event_id>/finalize/",
        billing_api.BillingEventFinalizeView.as_view(),
        name="billing_event_finalize",
    ),
    path(
        "billing/events/<int:event_id>/unfinalize/",
        billing_api.BillingEventUnfinalizeView.as_view(),
        name="billing_event_unfinalize",
    ),
    path(
        "billing/lessons/<int:event_id>/finalize/",
        billing_api.BillingEventFinalizeView.as_view(),
        name="billing_lesson_finalize",
    ),
    path(
        "billing/events/<int:event_id>/cancel-finance/",
        billing_api.BillingEventCancelFinanceView.as_view(),
        name="billing_event_cancel_finance",
    ),
    path(
        "billing/events/<int:event_id>/no-show/",
        billing_api.BillingEventNoShowView.as_view(),
        name="billing_event_no_show",
    ),
    path(
        "billing/events/<int:event_id>/badge/",
        billing_api.BillingEventBadgeView.as_view(),
        name="billing_event_badge",
    ),
    path(
        "billing/lessons/bulk-finalize/",
        billing_api.BillingBulkFinalizeView.as_view(),
        name="billing_bulk_finalize",
    ),
    path("billing/plan-check/", billing_api.BillingPlanCheckView.as_view(), name="billing_plan_check"),
    path("billing/reports/", billing_api.BillingReportsView.as_view(), name="billing_reports"),
    path("billing/export/", billing_api.BillingExportView.as_view(), name="billing_export"),
    path(
        "billing/reminders/preview/",
        billing_api.BillingReminderPreviewView.as_view(),
        name="billing_reminder_preview",
    ),
    path(
        "billing/reminders/",
        billing_api.BillingReminderSendView.as_view(),
        name="billing_reminder_send",
    ),
    path(
        "billing/legacy-backfill/",
        billing_api.BillingLegacyBackfillView.as_view(),
        name="billing_legacy_backfill",
    ),
    path("billing/student/", billing_api.StudentBillingView.as_view(), name="billing_student"),
    # Тарифная система
    path("subscription/current/", subscription_api.SubscriptionCurrentView.as_view(), name="subscription_current"),
    path("subscription/usage/", subscription_api.SubscriptionUsageView.as_view(), name="subscription_usage"),
    path("subscription/plans/", subscription_api.SubscriptionPlansView.as_view(), name="subscription_plans"),
    path("pricing/plans/", subscription_api.PublicPricingPlansView.as_view(), name="pricing_plans_public"),
    path("library/new-this-month/", subscription_api.LibraryNewThisMonthView.as_view(), name="library_new_this_month"),
    path("usage/workbook/", subscription_api.WorkbookUsageTrackView.as_view(), name="usage_workbook_track"),
    path("usage/variant-check/", subscription_api.VariantUsageCheckView.as_view(), name="usage_variant_check"),
    path("content/access-check/", subscription_api.ContentAccessCheckView.as_view(), name="content_access_check"),
    path("subscription/change-plan/", subscription_api.SubscriptionChangePlanView.as_view(), name="subscription_change_plan"),
    path("subscription/manage/", subscription_api.SubscriptionManageView.as_view(), name="subscription_manage"),
    path("subscription/create-payment/", subscription_api.SubscriptionCreatePaymentView.as_view(), name="subscription_create_payment"),
    path("subscription/apply-promo/", subscription_api.PromoCodeValidateView.as_view(), name="subscription_apply_promo"),
    path("subscription/referral-link/", subscription_api.SubscriptionReferralLinkView.as_view(), name="subscription_referral_link"),

    # ИИ-помощник
    path("ai/usage/", ai_api.AIUsageView.as_view(), name="ai_usage"),
    path("ai/request/", ai_api.AIRequestView.as_view(), name="ai_request"),
    path("", include(router.urls)),
]
