"""Настройки только для стенда e2e-video. Рабочий процесс их не загружает."""

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
# Как manage.py: каталог Generator/ первым, чтобы пакет Generator был вложенным.
for path in (str(ROOT), str(ROOT / "Generator")):
    if path not in sys.path:
        sys.path.insert(0, path)

from Generator.settings import *  # noqa: F403

E2E_DB_NAME = "itflux_video_e2e"
if E2E_DB_NAME in {"", "itflux", "postgres"}:
    raise RuntimeError("unsafe e2e database name")

DATABASES["default"]["NAME"] = E2E_DB_NAME  # noqa: F405
if DATABASES["default"]["NAME"] != E2E_DB_NAME:  # noqa: F405
    raise RuntimeError("database override failed")

# Рабочий manage.py загружает вложенный Generator/Generator/settings.py.
# В нём нет переключателя видеосвязи и LiveKit, поэтому стенд задаёт их сам.
VIDEO_FAILOVER_ENABLED = True
VIDEO_FAILOVER_MODE = (os.environ.get("VIDEO_FAILOVER_MODE") or "auto").strip().lower() or "auto"
VIDEO_FAILOVER_REQUIRE_HEALTH = False
LIVEKIT_URL = (os.environ.get("LIVEKIT_URL") or "").strip()
LIVEKIT_HTTP_URL = (os.environ.get("LIVEKIT_HTTP_URL") or "").strip()
LIVEKIT_API_KEY = (os.environ.get("LIVEKIT_API_KEY") or "").strip()
LIVEKIT_API_SECRET = (os.environ.get("LIVEKIT_API_SECRET") or "").strip()
try:
    LIVEKIT_TOKEN_TTL_SECONDS = int(os.environ.get("LIVEKIT_TOKEN_TTL_SECONDS") or "900")
except ValueError:
    LIVEKIT_TOKEN_TTL_SECONDS = 900

for origin in ("http://127.0.0.1:5011", "http://localhost:5011"):
    if origin not in CSRF_TRUSTED_ORIGINS:  # noqa: F405
        CSRF_TRUSTED_ORIGINS.append(origin)  # noqa: F405
    if origin not in CORS_ALLOWED_ORIGINS:  # noqa: F405
        CORS_ALLOWED_ORIGINS.append(origin)  # noqa: F405
