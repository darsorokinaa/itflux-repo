#!/bin/bash
# Обновление приложения на сервере после push в git.
#
# Запуск от root (нужны systemctl, nginx, запись в /etc):
#   bash /opt/itflux/deploy/update.sh
#
# При необходимости (редко):
#   APP_DIR=/opt/itflux DEPLOY_BRANCH=main NGINX_SITE_NAME=itflux bash .../update.sh
#
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/itflux}"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-main}"
NGINX_SITE_NAME="${NGINX_SITE_NAME:-itflux}"

VENV_PY="${APP_DIR}/venv/bin/python3"
VENV_PIP="${APP_DIR}/venv/bin/pip"

echo "=== Обновление кода (ветка ${DEPLOY_BRANCH}) ==="
cd "$APP_DIR"
git fetch origin
git pull --ff-only origin "$DEPLOY_BRANCH"

echo "=== Сборка фронтенда ==="
cd "$APP_DIR/frontend"
rm -rf dist
npm ci
npm run build
test -f dist/index.html || { echo "Ошибка: нет frontend/dist/index.html после сборки"; exit 1; }

echo "=== Python-зависимости (requirements.txt) ==="
"$VENV_PIP" install -r "$APP_DIR/requirements.txt"

echo "=== Миграции и статика ==="
cd "$APP_DIR/Generator"
"$VENV_PY" manage.py migrate --noinput
"$VENV_PY" manage.py collectstatic --noinput

echo "=== Unit systemd (Daphne из репозитория) ==="
cp "$APP_DIR/deploy/gunicorn.service" /etc/systemd/system/itflux.service
systemctl daemon-reload

echo "=== Конфиг Nginx ==="
cp "$APP_DIR/deploy/nginx.conf" "/etc/nginx/sites-available/${NGINX_SITE_NAME}"
ln -sf "/etc/nginx/sites-available/${NGINX_SITE_NAME}" "/etc/nginx/sites-enabled/${NGINX_SITE_NAME}"
nginx -t && systemctl reload nginx

echo "=== Перезапуск Daphne (itflux) ==="
systemctl restart itflux

if [[ -x "$APP_DIR/deploy/jitsi/fix-jwt-prosody.sh" ]]; then
  echo "=== Синхронизация JWT Prosody (если Jitsi на этом сервере) ==="
  bash "$APP_DIR/deploy/jitsi/fix-jwt-prosody.sh" || echo "WARN: fix-jwt-prosody.sh не применился — проверьте вручную"
fi

echo "=== JITSI (текущие env процесса) ==="
systemctl show itflux -p Environment --no-pager 2>/dev/null | tr ' ' '\n' | grep -E '^JITSI_' || true

echo "Готово. Проверка: systemctl status itflux --no-pager"
