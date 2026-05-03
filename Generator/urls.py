"""
Устаревшая конфигурация URL.

Активный ROOT_URLCONF задаётся в settings.py как ``Generator.Generator.urls`` —
там все эндпоинты (в т.ч. ``subtopics/``, ``lesson/join/``, ``api/lesson/verify/``).

Этот файл не используется при стандартном запуске; оставлен, чтобы не ломать
импорты ``Generator.urls`` в старых скриптах.
"""

urlpatterns = []
