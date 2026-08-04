from django.contrib import admin
from django.http import HttpResponseForbidden
from django.urls import path, include, re_path
from django.conf import settings
from django.views.static import serve

from . import views
from . import seasonal_theme_api
from Cabinet import homework_api
from Cabinet.subscription_api import PaymentWebhookView
from Cabinet.views import api_teacher_application, api_teacher_community_feedback


def media_serve(request, path):
    """Публичный media. Файлы досок и «Мои файлы» — только через авторизованный API."""
    normalized = (path or "").lstrip("/").replace("\\", "/")
    if (
        normalized.startswith("cabinet/boards/")
        or normalized.startswith("cabinet/boards_private/")
        or normalized.startswith("cabinet/my-files/")
    ):
        return HttpResponseForbidden("Доступ к файлу только через API.")
    return serve(request, path, document_root=settings.MEDIA_ROOT)


urlpatterns = [

    path("ckeditor5/", include("django_ckeditor_5.urls")),
    # Раньше срабатывал logout админки с LOGOUT_REDIRECT_URL='/' → на localhost при разработке.
    path("admin/logout/", views.admin_logout_to_public_home, name="generator_admin_logout"),
    path('admin/', admin.site.urls),

    path("api/csrf/", views.api_csrf, name="api_csrf"),
    path("api/teacher-applications/", api_teacher_application, name="api_teacher_applications"),
    path(
        "api/teacher-community-feedback/",
        api_teacher_community_feedback,
        name="api_teacher_community_feedback",
    ),
    path("api/catalog/", views.api_catalog, name="api_catalog"),
    path("api/generator/overview/", views.api_generator_overview, name="api_generator_overview"),
    path("api/platform-stats/", views.api_platform_stats, name="api_platform_stats"),
    path("api/site-config/", views.api_site_config, name="api_site_config"),
    path("api/vpr/subject-task-counts/", views.api_vpr_subject_task_counts, name="api_vpr_subject_task_counts"),
    path("api/<str:level>/subject-task-counts/", views.api_level_subject_task_counts, name="api_level_subject_task_counts"),
    path("api/<str:level>/subject-catalog/", views.api_level_subject_catalog, name="api_level_subject_catalog"),
    path("ckeditor/upload/", views.ckeditor_upload, name="ckeditor_upload"),
    path("api/lk-nav-unlock/", views.api_lk_nav_unlock, name="api_lk_nav_unlock"),
    path("api/cabinet/", include("Cabinet.urls")),
    path(
        "payments/webhook/<str:provider>/",
        PaymentWebhookView.as_view(),
        name="payment_webhook",
    ),
    path("api/video-meetings/", include("Cabinet.video_meeting_urls")),
    path(
        "api/homework/assignment/fetch-by-token/",
        homework_api.HomeworkAssignmentFetchByTokenView.as_view(),
        name="homework_assignment_fetch_by_token",
    ),
    path(
        "api/homework/assignment/<int:homework_id>/save-draft/",
        homework_api.HomeworkAssignmentSaveDraftView.as_view(),
        name="homework_assignment_save_draft",
    ),
    path(
        "api/homework/assignment/<int:homework_id>/submit/",
        homework_api.HomeworkAssignmentSubmitView.as_view(),
        name="homework_assignment_submit",
    ),
    path(
        "api/homework/assignment/<int:homework_id>/upload-answer/",
        homework_api.HomeworkAssignmentUploadAnswerView.as_view(),
        name="homework_assignment_upload_answer",
    ),
    path(
        "api/homework/assignment/<int:homework_id>/",
        homework_api.HomeworkAssignmentDetailView.as_view(),
        name="homework_assignment_detail",
    ),
    path(
        "api/lesson/homework/assignment/<int:aid>/save-draft/",
        views.api_lesson_homework_save_draft,
        name="lesson_homework_save_draft",
    ),
    path(
        "api/lesson/homework/assignment/<int:aid>/submit/",
        views.api_lesson_homework_submit,
        name="lesson_homework_submit",
    ),
    path(
        "api/lesson/homework/assignment/<int:aid>/upload-answer/",
        views.api_lesson_homework_upload_answer,
        name="lesson_homework_upload_answer",
    ),
    path(
        "api/lesson/homework/assignment/<int:aid>/",
        views.api_lesson_homework_assignment,
        name="lesson_homework_assignment",
    ),
    path("api/updates/", views.api_updates, name="api_updates"),
    path("api/announcements/", views.api_announcements, name="api_announcements"),
    path(
        "api/seasonal-theme/current/",
        seasonal_theme_api.SeasonalThemeCurrentView.as_view(),
        name="seasonal_theme_current",
    ),
    path(
        "api/seasonal-theme/preference/",
        seasonal_theme_api.SeasonalThemePreferenceView.as_view(),
        name="seasonal_theme_preference",
    ),
    path(
        "api/seasonal-theme/preview/start/",
        seasonal_theme_api.SeasonalThemePreviewStartView.as_view(),
        name="seasonal_theme_preview_start",
    ),
    path(
        "api/seasonal-theme/preview/stop/",
        seasonal_theme_api.SeasonalThemePreviewStopView.as_view(),
        name="seasonal_theme_preview_stop",
    ),
    path("api/lessons/", views.api_lessons, name="api_lessons"),
    path("api/lessons/<slug:slug>/view/", views.api_lesson_archive_view, name="api_lesson_archive_view"),
    path(
        "api/lessons/<slug:slug>/archive/<path:asset_path>",
        views.api_lesson_archive_asset,
        name="api_lesson_archive_asset",
    ),
    path("api/lessons/<slug:slug>/", views.api_lesson_detail, name="api_lesson_detail"),
    path("api/interesting/", views.api_interesting, name="api_interesting"),
    path("api/interesting/<slug:slug>/view/", views.api_interesting_view, name="api_interesting_view"),
    path(
        "api/interesting/<slug:slug>/archive/<path:asset_path>",
        views.api_interesting_archive_asset,
        name="api_interesting_archive_asset",
    ),
    path("api/interesting/<slug:slug>/", views.api_interesting_detail, name="api_interesting_detail"),
    path("api/admin/lessons/", views.api_admin_lessons, name="api_admin_lessons"),
    path("api/admin/lessons/<slug:slug>/", views.api_admin_lesson_detail, name="api_admin_lesson_detail"),
    path("api/search_task/", views.search_task, name="search_task"),
    path("api/search_variant/", views.search_variant, name="search_variant"),
    path("favicon.png", views.favicon),
    path("favicon.ico", views.favicon),
    path("sw.js", views.service_worker),
    path("manifest.webmanifest", views.web_manifest),
    path("version.json", views.app_version_json),
    path("robots.txt", views.robots_txt),
    path("sitemap.xml", views.sitemap_xml),
    re_path(r"^(?P<filename>yandex_[0-9a-f]+\.html)$", views.yandex_webmaster_verification),
    path("api/<str:level>/<str:subject>/tasks/", views.api_tasks),
    path("api/<str:level>/<str:subject>/subtopics/", views.api_subtopics),
    path("api/variant-lookup/<int:variant_id>/", views.api_variant_lookup),
    path(
        "api/variant/<int:variant_id>/check-answer/",
        views.api_variant_check_answer,
        name="api_variant_check_answer",
    ),
    path(
        "api/<str:level>/<str:subject>/task-bank-filters/",
        views.api_task_bank_filters,
        name="api_task_bank_filters",
    ),
    path("api/<str:level>/<str:subject>/task-bank/", views.api_task_bank, name="api_task_bank"),
    path("api/task-tags/", views.api_task_tags_catalog, name="api_task_tags_catalog"),
    path(
        "api/task-tags/<int:tag_id>/",
        views.api_task_tags_catalog_delete,
        name="api_task_tags_catalog_delete",
    ),
    path(
        "api/tasks/<int:task_id>/tags/",
        views.api_task_tags_set,
        name="api_task_tags_set",
    ),
    path("api/<str:level>/<str:subject>/variant-from-ids/", views.api_variant_from_ids, name="api_variant_from_ids"),
    path("api/<str:level>/<str:subject>/variant/", views.api_generate_variant),
    path("api/<str:level>/<str:subject>/variant/<int:variant_id>/", views.api_variant_detail),
    path("api/<str:level>/<str:subject>/support-info/", views.api_support_info),
    path("api/<str:level>/<str:subject>/criteria/", views.api_criteria),
    path("api/<str:level>/<str:subject>/score-conversion/", views.api_score_conversion),
    path("api/<str:level>/<str:subject>/report-pdf/", views.report_pdf),
    path("api/<str:level>/<str:subject>/report-error/", views.report_error),
    path("api/<str:level>/<str:subject>/variant/<int:variant_id>/pdf/", views.variant_pdf),
    path(
        "api/<str:level>/<str:subject>/variant/<int:variant_id>/pdf/cosmos",
        views.variant_pdfCosmos,
    ),
    # Совместимость со старым клиентом: /api/ege/math/ → тот же ответ, что tasks/
    path("api/<str:level>/<str:subject>/", views.api_tasks),

    path("api/<str:level>/<str:subject>/group-instances/", views.api_group_instances, name="api_group_instances"),

    path("", include("Board.urls")),

]

urlpatterns += [
    re_path(r'^media/(?P<path>.*)$', media_serve),
]

# PDF без префикса /api/ (старые закладки)
urlpatterns += [
    re_path(
        r"^(?P<level>[^/]+)/(?P<subject>[^/]+)/variant/(?P<variant_id>[0-9]+)/?$",
        views.variant_detail_short_url,
    ),
    re_path(
        r"^(?P<level>[^/]+)/(?P<subject>[^/]+)/variant/(?P<variant_id>[0-9]+)/pdf/cosmos/?$",
        views.variant_pdfCosmos,
    ),
    re_path(
        r"^(?P<level>[^/]+)/(?P<subject>[^/]+)/variant/(?P<variant_id>[0-9]+)/pdf/?$",
        views.variant_pdf,
    ),
]

urlpatterns += [
    re_path(r'^.*$', views.react_app, name='react_app'),
]
