import os
import sys
from pathlib import Path

from django.core.exceptions import ImproperlyConfigured
from dotenv import load_dotenv

# Build paths inside the project like this: BASE_DIR / 'subdir'.
BASE_DIR = Path(__file__).resolve().parent.parent

# override=True: значения из .env важнее уже экспортированных в shell
# (иначе старый TBANK_PASSWORD без "#..." может перекрыть файл)
load_dotenv(BASE_DIR / "Generator" / ".env", override=True)
load_dotenv(BASE_DIR / ".env", override=True)

_TESTING = "test" in sys.argv
_DEV_SECRET = "dev-insecure-secret-key-local-only"

# SECURITY WARNING: keep the secret key used in production secret!
_secret_env = (os.environ.get("DJANGO_SECRET_KEY") or os.environ.get("SECRET_KEY") or "").strip()
_debug_raw = (os.environ.get("DJANGO_DEBUG") or os.environ.get("DEBUG") or "0").strip()
DEBUG = _TESTING or _debug_raw.lower() in ("1", "true", "yes", "on")

if DEBUG:
    SECRET_KEY = _secret_env or _DEV_SECRET
else:
    if not _secret_env or _secret_env == _DEV_SECRET:
        raise ImproperlyConfigured(
            "Set DJANGO_SECRET_KEY (or SECRET_KEY) to a strong random value when DEBUG is off."
        )
    SECRET_KEY = _secret_env

# Тот же секрет, что в ЛК (02_lk_generator): POST /api/lesson/token/ → ссылка на /lesson/join/
LESSON_SECRET = os.environ.get("LESSON_SECRET", "").strip()
TASKS_GET_SECRET = (os.environ.get("LINK_SECRET_FOR_TASKS") or "").strip()
# Ссылка «Личный кабинет» в шаблоне урока; должен совпадать с origin из сборки фронта (VITE_LK_PUBLIC_URL).
LK_PUBLIC_URL = os.environ.get("LK_PUBLIC_URL", "https://itflux-academy.ru").rstrip("/")
LK_DASHBOARD_URL = os.environ.get("LK_DASHBOARD_URL", "").strip().rstrip("/")
# Опционально: явный URL вебхука ЛК при входе ученика в комнату (иначе LK_PUBLIC_URL + /api/lesson/student-joined/).
LK_LESSON_STUDENT_NOTIFY_URL = os.environ.get("LK_LESSON_STUDENT_NOTIFY_URL", "").strip()
LK_LESSON_NOTIFY_URL = os.environ.get("LK_LESSON_NOTIFY_URL", "").strip()
LESSON_WEBHOOK_SECRET = os.environ.get("LESSON_WEBHOOK_SECRET", "").strip()
# Прокси ДЗ → ЛК: ЛК по умолчанию не знает Bearer JWT; см. deploy/LK_ITFLUX_DEBUG.md
# Добавить ?token=… к URL (если на ЛК читают GET-параметр). Отключить: LK_HOMEWORK_APPEND_TOKEN_QUERY=0
_hw_q = os.environ.get("LK_HOMEWORK_APPEND_TOKEN_QUERY", "true").strip().lower()
LK_HOMEWORK_APPEND_TOKEN_QUERY = _hw_q not in ("0", "false", "no", "off")
LK_HOMEWORK_TOKEN_QUERY_PARAM = (os.environ.get("LK_HOMEWORK_TOKEN_QUERY_PARAM", "token") or "token").strip()
# Заголовок Authorization: Bearer <jwt> | Token <jwt> | пусто — не слать (только X-Lesson-Token + секрет).
LK_HOMEWORK_AUTHORIZATION_SCHEME = (os.environ.get("LK_HOMEWORK_AUTHORIZATION_SCHEME", "Bearer") or "Bearer").strip()
# Вместо GET /api/homework/assignment/<id>/ — POST сюда с JSON {"token","assignment_id"} (как teacher-joined).
LK_HOMEWORK_FETCH_URL = os.environ.get("LK_HOMEWORK_FETCH_URL", "").strip()

# Яндекс Телемост — секреты только из env.
YANDEX_TELEMOST_CLIENT_ID = os.environ.get("YANDEX_TELEMOST_CLIENT_ID", "").strip()
YANDEX_TELEMOST_CLIENT_SECRET = os.environ.get("YANDEX_TELEMOST_CLIENT_SECRET", "").strip()
YANDEX_TELEMOST_OAUTH_TOKEN = os.environ.get("YANDEX_TELEMOST_OAUTH_TOKEN", "").strip()
YANDEX_TELEMOST_REFRESH_TOKEN = os.environ.get("YANDEX_TELEMOST_REFRESH_TOKEN", "").strip()
YANDEX_TELEMOST_AUTH_CODE = os.environ.get("YANDEX_TELEMOST_AUTH_CODE", "").strip()
YANDEX_TELEMOST_REDIRECT_URI = os.environ.get(
    "YANDEX_TELEMOST_REDIRECT_URI",
    "https://oauth.yandex.ru/verification_code",
).strip()
YANDEX_ACCOUNT_EMAIL = os.environ.get("YANDEX_ACCOUNT_EMAIL", "").strip()
YANDEX_TELEMOST_COHOST_EMAIL = os.environ.get(
    "YANDEX_TELEMOST_COHOST_EMAIL",
    os.environ.get("YANDEX_ACCOUNT_EMAIL", ""),
).strip()
YANDEX_TELEMOST_ALLOW_WEB_FALLBACK = os.environ.get(
    "YANDEX_TELEMOST_ALLOW_WEB_FALLBACK", "true"
).strip().lower() not in ("0", "false", "no", "off")
YANDEX_TELEMOST_WEB_FALLBACK_URL = os.environ.get(
    "YANDEX_TELEMOST_WEB_FALLBACK_URL",
    "https://telemost.yandex.ru/",
).strip()
YANDEX_OAUTH_SCOPES = os.environ.get("YANDEX_OAUTH_SCOPES", "").strip()
YANDEX_CALENDAR_ENABLED = os.environ.get(
    "YANDEX_CALENDAR_ENABLED", "false"
).strip().lower() not in ("0", "false", "no", "off")
YANDEX_CALENDAR_LAYER_IDS = os.environ.get("YANDEX_CALENDAR_LAYER_IDS", "").strip()
YANDEX_CALENDAR_TZ_ID = os.environ.get("YANDEX_CALENDAR_TZ_ID", "Europe/Moscow").strip()
YANDEX_CALENDAR_EMBED_URL = os.environ.get("YANDEX_CALENDAR_EMBED_URL", "").strip()
YANDEX_TELEMOST_AUTO_CREATE = os.environ.get(
    "YANDEX_TELEMOST_AUTO_CREATE", "true"
).strip().lower() not in ("0", "false", "no", "off")

# —— Jitsi Meet (видеоуроки в кабинете) ——
JITSI_DOMAIN = os.environ.get("JITSI_DOMAIN", "meet.jit.si").strip() or "meet.jit.si"
JITSI_AUTH_MODE = (os.environ.get("JITSI_AUTH_MODE", "none") or "none").strip().lower()
JITSI_APP_ID = os.environ.get("JITSI_APP_ID", "").strip()
JITSI_APP_SECRET = os.environ.get("JITSI_APP_SECRET", "").strip()
JITSI_SUB = os.environ.get("JITSI_SUB", "").strip()
JITSI_AUD = os.environ.get("JITSI_AUD", "jitsi").strip() or "jitsi"
try:
    JITSI_TOKEN_TTL_SECONDS = int(os.environ.get("JITSI_TOKEN_TTL_SECONDS", "7200") or "7200")
except ValueError:
    JITSI_TOKEN_TTL_SECONDS = 7200
try:
    JITSI_JOIN_BEFORE_MINUTES = int(os.environ.get("JITSI_JOIN_BEFORE_MINUTES", "15") or "15")
except ValueError:
    JITSI_JOIN_BEFORE_MINUTES = 15
try:
    JITSI_JOIN_AFTER_MINUTES = int(os.environ.get("JITSI_JOIN_AFTER_MINUTES", "30") or "30")
except ValueError:
    JITSI_JOIN_AFTER_MINUTES = 30
JITSI_EMBED_EXTRA_HOSTS = tuple(
    h.strip().lower()
    for h in os.environ.get("JITSI_EMBED_EXTRA_HOSTS", "").split(",")
    if h.strip()
)

# VK notifications (optional — mock when token not set)
VK_ACCESS_TOKEN = os.environ.get("VK_ACCESS_TOKEN", "").strip()
VK_GROUP_ID = os.environ.get("VK_GROUP_ID", "").strip()
VK_API_VERSION = os.environ.get("VK_API_VERSION", "5.131").strip()

# Telegram bot для уведомлений (кабинет: занятия, публикация оценок и т.д.)
TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
TELEGRAM_CHAT_ID = os.environ.get("TELEGRAM_CHAT_ID", "").strip()
# Для личных чатов топиков нет — оставляем None, чтобы не отправлять message_thread_id.
TELEGRAM_TOPIC_ID = os.environ.get("TELEGRAM_TOPIC_ID", "") or None
# Публичный username бота без @ — для deep-link t.me/<bot>?start=<token>
TELEGRAM_BOT_USERNAME = os.environ.get("TELEGRAM_BOT_USERNAME", "").strip().lstrip("@")
# Секрет для Telegram webhook (заголовок X-Telegram-Bot-Api-Secret-Token)
TELEGRAM_WEBHOOK_SECRET = os.environ.get("TELEGRAM_WEBHOOK_SECRET", "").strip()

_gen_home_outer = os.environ.get("ITFLUX_PUBLIC_HOME_URL", "https://itflux-academy.ru").strip().rstrip("/")
ITFLUX_PUBLIC_HOME_URL = f"{_gen_home_outer}/"
LOGOUT_REDIRECT_URL = ITFLUX_PUBLIC_HOME_URL

# SECURITY WARNING: don't run with debug turned on in production!
# DEBUG задаётся выше (DJANGO_DEBUG или test runner)

_hosts_raw = os.environ.get("DJANGO_ALLOWED_HOSTS", "")
_hosts_list = [h.strip() for h in _hosts_raw.split(",") if h.strip() and h.strip() != "*"]

if DEBUG or _TESTING:
    ALLOWED_HOSTS = _hosts_list or ["localhost", "127.0.0.1", "testserver"]
else:
    if not _hosts_list:
        raise ImproperlyConfigured(
            "Set DJANGO_ALLOWED_HOSTS to your domain(s), comma-separated, in production."
        )
    ALLOWED_HOSTS = _hosts_list

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
    "django_otp",
    "django_otp.plugins.otp_totp",
    "django_otp.plugins.otp_static",

    # your apps
    "Generator",
    "Board",
    "Cabinet",

    # third-party
    "corsheaders",
    "django_ckeditor_5",
    "rest_framework",
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
    "django_otp.middleware.OTPMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    # manage.py кладёт Generator/ в sys.path → пакет называется Generator (= Generator/Generator/)
    "Generator.middleware.NoStoreApiMiddleware",
    "Generator.middleware.MinimumClientVersionMiddleware",
]

# Django admin: требовать TOTP (настроить: python manage.py setup_admin_totp <user>)
_admin_otp = (os.environ.get("ADMIN_OTP_REQUIRED") or "").strip().lower()
if _admin_otp in ("1", "true", "yes", "on"):
    ADMIN_OTP_REQUIRED = True
elif _admin_otp in ("0", "false", "no", "off"):
    ADMIN_OTP_REQUIRED = False
else:
    ADMIN_OTP_REQUIRED = not DEBUG

# Временно: OTP-вход в /admin/ только для этих username.
# Снять ограничение: ADMIN_OTP_ALLOWED_USERNAMES=*
_admin_otp_users = (
    os.environ.get("ADMIN_OTP_ALLOWED_USERNAMES") or "admin_dasha,darsorokinaa"
).strip()
if _admin_otp_users.lower() in ("*", "all"):
    ADMIN_OTP_ALLOWED_USERNAMES = None
else:
    ADMIN_OTP_ALLOWED_USERNAMES = frozenset(
        name.strip().lower()
        for name in _admin_otp_users.split(",")
        if name.strip()
    )

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
        'NAME': os.environ.get('PGDATABASE', 'itflux'),
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

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework.authentication.SessionAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
    ],
}

# CORS / CSRF — см. блок production hardening ниже
# Если CSRF_TRUSTED_ORIGINS не задан — строим доверенные origins из DJANGO_ALLOWED_HOSTS.
# Иначе Django 4+ отклоняет POST /admin/login/ (403 CSRF), даже если пользователь staff.
_csrf_extra = [o.strip() for o in os.environ.get("CSRF_TRUSTED_ORIGINS", "").split(",") if o.strip()]
if not _csrf_extra:
    for _h in _hosts_list:
        if _h and not _h.startswith("."):
            _csrf_extra.append(f"https://{_h}")
            _csrf_extra.append(f"http://{_h}")

CSRF_TRUSTED_ORIGINS = [
    "http://localhost:5000",
    "http://127.0.0.1:5000",
    "http://localhost:5001",
    "http://127.0.0.1:5001",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
] + _csrf_extra
CORS_ALLOW_CREDENTIALS = True

CSRF_COOKIE_SAMESITE = "Lax"
CSRF_COOKIE_HTTPONLY = False
SESSION_COOKIE_SAMESITE = "Lax"

# Production hardening (HTTPS behind nginx)
if not DEBUG:
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    SESSION_COOKIE_SECURE = os.environ.get("SESSION_COOKIE_SECURE", "true").lower() in (
        "1", "true", "yes", "on",
    )
    CSRF_COOKIE_SECURE = os.environ.get("CSRF_COOKIE_SECURE", "true").lower() in (
        "1", "true", "yes", "on",
    )
    if os.environ.get("SECURE_HSTS_SECONDS", "").strip().isdigit():
        SECURE_HSTS_SECONDS = int(os.environ["SECURE_HSTS_SECONDS"])
        SECURE_HSTS_INCLUDE_SUBDOMAINS = True

_cors_env = [o.strip() for o in os.environ.get("CORS_ALLOWED_ORIGINS", "").split(",") if o.strip()]
if _cors_env:
    CORS_ALLOW_ALL_ORIGINS = False
    CORS_ALLOWED_ORIGINS = _cors_env
elif DEBUG:
    CORS_ALLOWED_ORIGINS = [
        "http://localhost:5000",
        "http://127.0.0.1:5000",
        "http://localhost:5001",
        "http://127.0.0.1:5001",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]
    CORS_ALLOW_CREDENTIALS = True
else:
    CORS_ALLOW_ALL_ORIGINS = False
    CORS_ALLOWED_ORIGINS = []

# Тело JSON PATCH сцены доски (лимит сцены 15 МБ + обёртка + запас на вложенные поля).
# Без этого Django по умолчанию рвёт запрос на 2.5 МБ раньше SCENE_TOO_LARGE.
DATA_UPLOAD_MAX_MEMORY_SIZE = int(
    os.environ.get("DATA_UPLOAD_MAX_MEMORY_SIZE", str(32 * 1024 * 1024))
)

# Cabinet uploads
CABINET_MAX_UPLOAD_BYTES = int(os.environ.get("CABINET_MAX_UPLOAD_BYTES", str(20 * 1024 * 1024)))
CABINET_FILE_STORAGE_QUOTA_BYTES = int(
    os.environ.get("CABINET_FILE_STORAGE_QUOTA_BYTES", str(1024 * 1024 * 1024))
)
CABINET_FILE_TRASH_DAYS = int(os.environ.get("CABINET_FILE_TRASH_DAYS", "30"))

# Homework attachments (централизованные лимиты; fallback на cabinet upload)
HOMEWORK_ATTACHMENT_MAX_SIZE = int(
    os.environ.get("HOMEWORK_ATTACHMENT_MAX_SIZE", str(CABINET_MAX_UPLOAD_BYTES))
)
HOMEWORK_ATTACHMENT_MAX_COUNT = int(os.environ.get("HOMEWORK_ATTACHMENT_MAX_COUNT", "20"))
HOMEWORK_ALLOWED_ATTACHMENT_TYPES = None  # None → upload_validation.ALLOWED_UPLOAD_*


LESSON_PLAN_CATALOG_PUBLISHER_EMAILS = tuple(
    email.strip().lower()
    for email in os.environ.get(
        "LESSON_PLAN_CATALOG_PUBLISHER_EMAILS",
        "dv_sorokina@mail.ru",
    ).split(",")
    if email.strip()
)

# Usernames that can edit task tags on «Все задачи».
TASK_TAG_EDITOR_USERNAMES = tuple(
    name.strip().lower()
    for name in os.environ.get(
        "TASK_TAG_EDITOR_USERNAMES",
        "darsorokinaa,admin_dasha",
    ).split(",")
    if name.strip()
)

# Cache for rate limiting (LocMem — один процесс; в prod лучше Redis)
CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
        "LOCATION": "itflux-cabinet-rl",
    }
}

if not DEBUG and not _TESTING and not LESSON_SECRET:
    import warnings
    warnings.warn(
        "LESSON_SECRET is not set — JWT for homework/lesson links will not be issued.",
        stacklevel=1,
    )

# —— Подписка платформы (SaaS). Не путать с биллингом учеников.
# Оплата тарифов: PAYMENTS_ENABLED=true|false (см. Generator/.env).
_PAYMENTS_ENABLED_RAW = (os.environ.get("PAYMENTS_ENABLED") or "false").strip().lower()
PAYMENTS_ENABLED = _PAYMENTS_ENABLED_RAW in ("1", "true", "yes", "on")
PAYMENT_PROVIDER = (os.environ.get("PAYMENT_PROVIDER") or "mock").strip()
PAYMENT_SECRET_KEY = (os.environ.get("PAYMENT_SECRET_KEY") or "").strip()
PAYMENT_SHOP_ID = (os.environ.get("PAYMENT_SHOP_ID") or "").strip()
def _env_cred(value: str) -> str:
    value = (value or "").strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
        return value[1:-1].strip()
    return value

TBANK_TERMINAL_KEY = _env_cred(os.environ.get("TBANK_TERMINAL_KEY") or PAYMENT_SHOP_ID or "")
TBANK_PASSWORD = _env_cred(os.environ.get("TBANK_PASSWORD") or PAYMENT_SECRET_KEY or "")
TBANK_API_URL = (os.environ.get("TBANK_API_URL") or "https://securepay.tinkoff.ru/v2").rstrip("/")
TBANK_SUCCESS_URL = (os.environ.get("TBANK_SUCCESS_URL") or "").strip()
TBANK_FAIL_URL = (os.environ.get("TBANK_FAIL_URL") or "").strip()
TBANK_NOTIFICATION_URL = (os.environ.get("TBANK_NOTIFICATION_URL") or "").strip()
_TBANK_VERIFY_RAW = (os.environ.get("TBANK_VERIFY_SSL") or "true").strip().lower()
TBANK_VERIFY_SSL = _TBANK_VERIFY_RAW not in ("0", "false", "no", "off")
# Чек (Receipt) в Init: СНО и НДС — как в ЛК кассы
TBANK_TAXATION = (os.environ.get("TBANK_TAXATION") or "usn_income").strip().lower()
TBANK_VAT = (os.environ.get("TBANK_VAT") or "none").strip().lower()
TBANK_FFD_VERSION = (os.environ.get("TBANK_FFD_VERSION") or "1.05").strip()
TBANK_RECEIPT_EMAIL = (os.environ.get("TBANK_RECEIPT_EMAIL") or "").strip()
ANON_VARIANTS_MONTHLY_LIMIT = int(os.environ.get("ANON_VARIANTS_MONTHLY_LIMIT", "5"))
ANON_WORKBOOKS_MONTHLY_LIMIT = int(os.environ.get("ANON_WORKBOOKS_MONTHLY_LIMIT", "3"))
