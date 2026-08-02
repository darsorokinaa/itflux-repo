#!/usr/bin/env bash
# Устанавливает crontab фоновых задач itflux.
# Запуск (от root на сервере):
#   bash /opt/itfluxacademy/itflux/deploy/install_cron.sh
#
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/itfluxacademy/itflux}"
CRON_SRC="${APP_DIR}/deploy/crontab.itflux"
MARKER_BEGIN="# BEGIN itflux-cron"
MARKER_END="# END itflux-cron"
LOG_DIR="${LOG_DIR:-/var/log/itflux}"

if [[ ! -f "$CRON_SRC" ]]; then
  echo "ERROR: нет ${CRON_SRC}" >&2
  exit 1
fi

chmod +x "${APP_DIR}/deploy/run_management.sh" "${APP_DIR}/deploy/install_cron.sh" || true
mkdir -p "$LOG_DIR"

# Подставляем фактический APP_DIR и каталог логов
TMP="$(mktemp)"
sed \
  -e "s|/opt/itfluxacademy/itflux|${APP_DIR}|g" \
  -e "s|/var/log/itflux|${LOG_DIR}|g" \
  "$CRON_SRC" > "$TMP"

BLOCK="$(
  printf '%s\n' "$MARKER_BEGIN"
  cat "$TMP"
  printf '%s\n' "$MARKER_END"
)"
rm -f "$TMP"

EXISTING="$(crontab -l 2>/dev/null || true)"
# Удаляем предыдущий блок itflux-cron, остальное сохраняем
CLEANED="$(
  printf '%s\n' "$EXISTING" | awk -v b="$MARKER_BEGIN" -v e="$MARKER_END" '
    $0 == b {skip=1; next}
    $0 == e {skip=0; next}
    !skip {print}
  '
)"

{
  printf '%s\n' "$CLEANED" | sed -e '${/^$/d;}'
  printf '\n%s\n' "$BLOCK"
} | crontab -

echo "=== crontab установлен (маркер ${MARKER_BEGIN}) ==="
crontab -l | sed -n "/${MARKER_BEGIN}/,/${MARKER_END}/p"

echo ""
echo "Проверка одной команды (dry):"
APP_DIR="$APP_DIR" "${APP_DIR}/deploy/run_management.sh" notify_subscription_expiring || {
  echo "WARN: команда завершилась с ошибкой — проверьте EnvironmentFile (/etc/itflux/itflux.env) и БД" >&2
  exit 0
}
echo "OK: notify_subscription_expiring отработала"
