#!/usr/bin/env bash
# Обёртка для cron/systemd: подхватывает production env и запускает manage.py.
#
# Использование:
#   deploy/run_management.sh send_lesson_reminders
#   deploy/run_management.sh notify_subscription_expiring
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${APP_DIR:-$(cd "${SCRIPT_DIR}/.." && pwd)}"
ENV_FILE="${ITFLUX_ENV_FILE:-/etc/itflux/itflux.env}"
# Fallback: .env рядом с приложением (как в checklist)
if [[ ! -f "$ENV_FILE" && -f "${APP_DIR}/.env" ]]; then
  ENV_FILE="${APP_DIR}/.env"
fi
if [[ ! -f "$ENV_FILE" && -f "${APP_DIR}/Generator/.env" ]]; then
  ENV_FILE="${APP_DIR}/Generator/.env"
fi

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

export DJANGO_SETTINGS_MODULE="${DJANGO_SETTINGS_MODULE:-Generator.settings}"

# Прод: venv/; локально часто .venv/
if [[ -d "${APP_DIR}/venv/bin" ]]; then
  VENV_BIN="${APP_DIR}/venv/bin"
elif [[ -d "${APP_DIR}/.venv/bin" ]]; then
  VENV_BIN="${APP_DIR}/.venv/bin"
else
  echo "ERROR: venv not found (${APP_DIR}/venv or ${APP_DIR}/.venv)" >&2
  exit 1
fi
export PATH="${VENV_BIN}:/usr/local/bin:/usr/bin:/bin:${PATH:-}"

PY="${VENV_BIN}/python3"
if [[ ! -x "$PY" ]]; then
  PY="${VENV_BIN}/python"
fi
if [[ ! -x "$PY" ]]; then
  echo "ERROR: python not found in ${VENV_BIN}" >&2
  exit 1
fi

MANAGE="${APP_DIR}/manage.py"
if [[ ! -f "$MANAGE" ]]; then
  MANAGE="${APP_DIR}/Generator/manage.py"
fi
if [[ ! -f "$MANAGE" ]]; then
  echo "ERROR: manage.py not found under ${APP_DIR}" >&2
  exit 1
fi

cd "$(dirname "$MANAGE")"
exec "$PY" "$(basename "$MANAGE")" "$@"
