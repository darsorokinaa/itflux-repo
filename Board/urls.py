from django.urls import path
from .views import test_board

urlpatterns = [
    path("board/test/", test_board),
]
