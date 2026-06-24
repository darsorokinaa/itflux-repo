from django.urls import path, include

from . import views

urlpatterns = [
    path("me/", views.api_me, name="cabinet_api_me"),
    path("login/", views.api_login, name="cabinet_api_login"),
    path("register/", views.api_register, name="cabinet_api_register"),
    path("referral/<str:code>/preview/", views.api_referral_preview, name="cabinet_api_referral_preview"),
    path("logout/", views.api_logout, name="cabinet_api_logout"),
    path("telemost/status/", views.api_telemost_status, name="cabinet_api_telemost_status"),
    path("telemost/start/", views.api_telemost_start, name="cabinet_api_telemost_start"),
    path("calendar/status/", views.api_calendar_status, name="cabinet_api_calendar_status"),
    path("calendar/events/", views.api_calendar_events, name="cabinet_api_calendar_events"),
    path("schedule/events/", views.api_schedule_events, name="cabinet_api_schedule_events"),
    path("schedule/events/create/", views.api_schedule_create, name="cabinet_api_schedule_create"),
    path("schedule/events/<str:event_id>/", views.api_schedule_update, name="cabinet_api_schedule_update"),
    path("schedule/events/<str:event_id>/delete/", views.api_schedule_delete, name="cabinet_api_schedule_delete"),
    path("schedule/check-conflicts/", views.api_schedule_check_conflicts, name="cabinet_api_schedule_check_conflicts"),
    path("", include("Cabinet.api_urls")),
]
