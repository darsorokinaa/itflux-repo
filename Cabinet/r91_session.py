"""r91: «скользящая» сессия без записи в БД на каждый запрос.

Django продлевает срок сессии только при её сохранении. Сохраняем сессию авторизованного
пользователя не чаще раза в SESSION_ROLLING_REFRESH_SECONDS (по умолчанию сутки) —
так активный ученик не вылетает через 14 дней, а нагрузка ≈ 1 UPDATE в сутки на сессию.
"""
import time

from django.conf import settings

KEY = "_r91_touch"


class RollingSessionMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response
        age = int(getattr(settings, "SESSION_COOKIE_AGE", 1209600))
        self.interval = min(int(getattr(settings, "SESSION_ROLLING_REFRESH_SECONDS", 86400)), age // 2)

    def __call__(self, request):
        response = self.get_response(request)
        try:
            session = getattr(request, "session", None)
            user = getattr(request, "user", None)
            if session is not None and user is not None and user.is_authenticated and not session.is_empty():
                now = int(time.time())
                last = int(session.get(KEY) or 0)
                if now - last >= self.interval:
                    session[KEY] = now  # modified=True -> SessionMiddleware сохранит и обновит cookie
        except Exception:
            pass
        return response
