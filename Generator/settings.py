from logging import DEBUG
from pathlib import Path
import os

# Build paths inside the project like this: BASE_DIR / 'subdir'.
BASE_DIR = Path(__file__).resolve().parent.parent

# SECURITY WARNING: keep the secret key used in production secret!
# Лучше: хранить в переменной окружения
SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "dev-insecure-secret-key")

# Тот же секрет, что в ЛК (02_lk_generator): POST /api/lesson/token/ → ссылка на /lesson/join/
LESSON_SECRET = os.environ.get("LESSON_SECRET", "").strip()
TASKS_GET_SECRET = os.environ.get("LINK_SECRET_FOR_TASKS").strip()
# Ссылка «Личный кабинет» в шаблоне урока; должен совпадать с origin из сборки фронта (VITE_LK_PUBLIC_URL).
LK_PUBLIC_URL = os.environ.get("LK_PUBLIC_URL", "http://lk.genurok.tw1.ru").rstrip("/")
LK_DASHBOARD_URL = os.environ.get("LK_DASHBOARD_URL", "").strip().rstrip("/")
# Опционально: явный URL вебхука ЛК при входе ученика в комнату (иначе LK_PUBLIC_URL + /api/lesson/student-joined/).
LK_LESSON_STUDENT_NOTIFY_URL = os.environ.get("LK_LESSON_STUDENT_NOTIFY_URL", "").strip()
LK_LESSON_NOTIFY_URL = os.environ.get("LK_LESSON_NOTIFY_URL", "").strip()
LESSON_WEBHOOK_SECRET = os.environ.get("LESSON_WEBHOOK_SECRET", "").strip()
# Прокси ДЗ → ЛК: ЛК по умолчанию не знает Bearer JWT; см. deploy/LK_GENUROK_DEBUG.md
# Добавить ?token=… к URL (если на ЛК читают GET-параметр). Отключить: LK_HOMEWORK_APPEND_TOKEN_QUERY=0
_hw_q = os.environ.get("LK_HOMEWORK_APPEND_TOKEN_QUERY", "true").strip().lower()
LK_HOMEWORK_APPEND_TOKEN_QUERY = _hw_q not in ("0", "false", "no", "off")
LK_HOMEWORK_TOKEN_QUERY_PARAM = (os.environ.get("LK_HOMEWORK_TOKEN_QUERY_PARAM", "token") or "token").strip()
# Заголовок Authorization: Bearer <jwt> | Token <jwt> | пусто — не слать (только X-Lesson-Token + секрет).
LK_HOMEWORK_AUTHORIZATION_SCHEME = (os.environ.get("LK_HOMEWORK_AUTHORIZATION_SCHEME", "Bearer") or "Bearer").strip()
# Вместо GET /api/homework/assignment/<id>/ — POST сюда с JSON {"token","assignment_id"} (как teacher-joined).
LK_HOMEWORK_FETCH_URL = os.environ.get("LK_HOMEWORK_FETCH_URL", "").strip()
_gen_home_outer = os.environ.get("GENUROK_PUBLIC_HOME_URL", "http://genurok.ru").strip().rstrip("/")
GENUROK_PUBLIC_HOME_URL = f"{_gen_home_outer}/"
LOGOUT_REDIRECT_URL = GENUROK_PUBLIC_HOME_URL

# SECURITY WARNING: don't run with debug turned on in production!
# DEBUG = os.environ.get("DJANGO_DEBUG", "1") == "1"
DEBUG = False

# Для Replit домен не localhost, поэтому либо "*" (для демо), либо конкретный домен repl
ALLOWED_HOSTS = os.environ.get("DJANGO_ALLOWED_HOSTS", "*").split(",")

# Application definition
INSTALLED_APPS = [
    "daphne",
    "channels",
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",

    # your apps
    "Generator",
    "Board",

    # third-party
    "corsheaders",
    "django_ckeditor_5",
]

CKEDITOR_5_CONFIGS = {
    "default": {
        "toolbar": [
            "bold", "italic", "link", "bulletedList", "numberedList",
            "imageUpload", "undo", "redo"
        ],
        "image": {
            "toolbar":
            ["imageTextAlternative", "imageStyle:full", "imageStyle:side"]
        },
    }
}

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

# Разрешаем iframe на том же origin (урок встраивает страницу варианта).
X_FRAME_OPTIONS = "SAMEORIGIN"

# Полные маршруты API (tasks/, subtopics/, lesson/join/, verify, …) — во вложенном приложении.
ROOT_URLCONF = "Generator.Generator.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",

        # ВАЖНО: тут лежит React dist/index.html
        "DIRS": [BASE_DIR / "frontend" / "dist"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "Generator.wsgi.application"
ASGI_APPLICATION = "Generator.asgi.application"

CHANNEL_LAYERS = {
    "default": {
        "BACKEND": "channels.layers.InMemoryChannelLayer"
    }
}

# # Database (те же параметры, что в Generator/Generator/settings.py — одна БД для дампа)
DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.postgresql',
        'NAME': 'generatordb',
        'USER': os.environ.get('PGUSER', 'postgres'),
        'PASSWORD': os.environ.get('PGPASSWORD', 'postgres'),
        'HOST': os.environ.get('PGHOST', 'localhost'),
        'PORT': os.environ.get('PGPORT', ''),
    }
}

# Password validation
AUTH_PASSWORD_VALIDATORS = [
    {
        "NAME":
        "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"
    },
    {
        "NAME":
        "django.contrib.auth.password_validation.MinimumLengthValidator"
    },
    {
        "NAME":
        "django.contrib.auth.password_validation.CommonPasswordValidator"
    },
    {
        "NAME":
        "django.contrib.auth.password_validation.NumericPasswordValidator"
    },
]

LANGUAGE_CODE = "ru-ru"
TIME_ZONE = "Europe/Moscow"
USE_I18N = True
USE_TZ = True

# Static files (CSS, JavaScript, Images)
# Vite с base: '/static/' отдаёт /static/assets/xxx.css — нужна структура dist целиком
STATIC_URL = "/static/"
STATICFILES_DIRS = [
    BASE_DIR / "frontend" / "dist",
]
STATIC_ROOT = BASE_DIR / "staticfiles"

# Media (если используется)
MEDIA_URL = "/media/"
MEDIA_ROOT = BASE_DIR / "media"

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# CORS / CSRF
# В варианте "Django раздаёт React" обычно CORS вообще не нужен для фронта,
# потому что фронт и бэк на одном домене.
# Но если вы ещё локально разрабатываете через vite dev server, оставляем.
CORS_ALLOWED_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]
CORS_ALLOW_CREDENTIALS = True

CSRF_TRUSTED_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]

CSRF_COOKIE_SAMESITE = "Lax"
CSRF_COOKIE_HTTPONLY = False
SESSION_COOKIE_SAMESITE = "Lax"
