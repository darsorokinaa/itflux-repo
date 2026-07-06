from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import ai_api, api_views, schedule_api, student_api, subscription_api

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
router.register("review", api_views.ReviewViewSet, basename="cabinet-review")
router.register("schedule", schedule_api.ScheduleEventViewSetExtended, basename="cabinet-schedule")
router.register("schedule-series", schedule_api.ScheduleSeriesViewSet, basename="cabinet-schedule-series")
router.register("notifications", schedule_api.NotificationViewSet, basename="cabinet-notifications")
router.register("materials", api_views.MaterialViewSet, basename="cabinet-materials")

urlpatterns = [
    path("dashboard/", api_views.DashboardView.as_view(), name="cabinet_dashboard"),
    path("student/dashboard/", student_api.StudentDashboardView.as_view(), name="student_dashboard"),
    path("student/lessons/", student_api.StudentLessonsView.as_view(), name="student_lessons"),
    path("student/lessons/<int:assignment_id>/", student_api.StudentLessonDetailView.as_view(), name="student_lesson_detail"),
    path("student/assignments/", student_api.StudentAssignmentsView.as_view(), name="student_assignments"),
    path("student/assignments/<int:homework_id>/", student_api.StudentAssignmentDetailView.as_view(), name="student_assignment_detail"),
    path("student/interactives/", student_api.StudentInteractivesView.as_view(), name="student_interactives"),
    path("student/interactives/<int:assignment_id>/", student_api.StudentInteractiveDetailView.as_view(), name="student_interactive_detail"),
    path("student/schedule/", student_api.StudentScheduleView.as_view(), name="student_schedule"),
    path("student/schedule/<int:event_id>/", student_api.StudentScheduleEventDetailView.as_view(), name="student_schedule_detail"),
    path("student/progress/", student_api.StudentProgressView.as_view(), name="student_progress"),
    path("student/materials/", student_api.StudentMaterialsView.as_view(), name="student_materials"),
    path("student/profile/", student_api.StudentProfileView.as_view(), name="student_profile"),
    path("student/notifications/", student_api.StudentNotificationsView.as_view(), name="student_notifications"),
    path("student/notifications/<int:notification_id>/read/", student_api.StudentNotificationReadView.as_view(), name="student_notification_read"),
    path("student/notifications/read-all/", student_api.StudentNotificationsReadAllView.as_view(), name="student_notifications_read_all"),
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
    path("lesson-plans/subjects/", api_views.LessonPlanSubjectOptionsView.as_view(), name="cabinet_lesson_plan_subjects"),
    path("invitations/join/<str:token>/", api_views.InvitationPreviewView.as_view(), name="cabinet_invitation_preview"),
    path("invitations/join/<str:token>/accept/", api_views.InvitationAcceptView.as_view(), name="cabinet_invitation_accept"),
    # Тарифная система
    path("subscription/current/", subscription_api.SubscriptionCurrentView.as_view(), name="subscription_current"),
    path("subscription/usage/", subscription_api.SubscriptionUsageView.as_view(), name="subscription_usage"),
    path("subscription/plans/", subscription_api.SubscriptionPlansView.as_view(), name="subscription_plans"),
    path("subscription/change-plan/", subscription_api.SubscriptionChangePlanView.as_view(), name="subscription_change_plan"),
    path("subscription/create-payment/", subscription_api.SubscriptionCreatePaymentView.as_view(), name="subscription_create_payment"),
    path("subscription/apply-promo/", subscription_api.PromoCodeValidateView.as_view(), name="subscription_apply_promo"),
    # ИИ-помощник
    path("ai/usage/", ai_api.AIUsageView.as_view(), name="ai_usage"),
    path("ai/request/", ai_api.AIRequestView.as_view(), name="ai_request"),
    path("", include(router.urls)),
]
