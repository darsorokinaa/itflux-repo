#!/bin/bash
# Обновление приложения на сервере после push в git.
#
# Запуск от root (нужны systemctl, nginx, запись в /etc):
#   bash /opt/itfluxacademy/itflux/deploy/update.sh
#
# При необходимости (редко):
#   APP_DIR=/opt/itfluxacademy/itflux DEPLOY_BRANCH=main NGINX_SITE_NAME=itflux bash .../update.sh
#
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/itfluxacademy/itflux}"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-main}"
NGINX_SITE_NAME="${NGINX_SITE_NAME:-itflux}"

VENV_PY="${APP_DIR}/venv/bin/python3"
VENV_PIP="${APP_DIR}/venv/bin/pip"

echo "=== Обновление кода (ветка ${DEPLOY_BRANCH}) ==="
cd "$APP_DIR"
git fetch origin
git pull --ff-only origin "$DEPLOY_BRANCH"

echo "=== Сборка фронтенда (атомарно в dist-next) ==="
cd "$APP_DIR/frontend"
rm -rf dist-next
npm ci
npm run build -- --outDir dist-next
test -f dist-next/index.html || { echo "Ошибка: нет frontend/dist-next/index.html после сборки"; exit 1; }
test -f dist-next/sw.js || { echo "Ошибка: нет frontend/dist-next/sw.js после сборки"; exit 1; }
test -f dist-next/version.json || { echo "Ошибка: нет frontend/dist-next/version.json после сборки"; exit 1; }
# Не оставляем плейсхолдер версии в SW
if grep -q '__ITFLUX_APP_VERSION__' dist-next/sw.js; then
  echo "Ошибка: в dist-next/sw.js не подставлена версия сборки"
  exit 1
fi
# Хэшированные чанки обязаны содержать content-hash в имени
js_count="$(find dist-next/assets -maxdepth 1 -type f -name 'main-*.js' | wc -l | tr -d ' ')"
test "$js_count" -ge 1 || { echo "Ошибка: нет hashed main-*.js в dist-next/assets"; exit 1; }
# public/interesting/ → dist/interesting/ ломает SPA: nginx 403 на /interesting/
if [[ -d dist-next/interesting ]]; then
  echo "Ошибка: dist-next/interesting/ не должен попадать в сборку (nginx 403 на /interesting/)"
  exit 1
fi

# Сохраняем старые hashed-чанки на период открытых вкладок (не перезаписываем новые)
if [[ -d dist/assets ]]; then
  mkdir -p dist-next/assets
  # cp -n: не затирать файлы новой сборки
  cp -n dist/assets/* dist-next/assets/ 2>/dev/null || true
fi

# Атомарное переключение release directory
rm -rf dist-prev
if [[ -d dist ]]; then
  mv dist dist-prev
fi
mv dist-next dist
echo "Frontend version: $(cat dist/version.json)"

echo "=== Python-зависимости (requirements.txt) ==="
"$VENV_PIP" install -r "$APP_DIR/requirements.txt"

echo "=== Миграции и статика ==="
cd "$APP_DIR"
"$VENV_PY" manage.py migrate --noinput
# Не используем --clear: старые hashed-чанки могут ещё запрашиваться открытыми вкладками
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

echo "=== Установка cron (напоминания, ДЗ, подписка) ==="
chmod +x "$APP_DIR/deploy/run_management.sh" "$APP_DIR/deploy/install_cron.sh"
APP_DIR="$APP_DIR" bash "$APP_DIR/deploy/install_cron.sh" || echo "WARN: cron не установился — запустите вручную deploy/install_cron.sh"

if [[ -x "$APP_DIR/deploy/jitsi/fix-jwt-prosody.sh" ]]; then
  echo "=== Синхронизация JWT Prosody (если Jitsi на этом сервере) ==="
  bash "$APP_DIR/deploy/jitsi/fix-jwt-prosody.sh" || echo "WARN: fix-jwt-prosody.sh не применился — проверьте вручную"
fi

echo "=== JITSI (текущие env процесса) ==="
systemctl show itflux -p Environment --no-pager 2>/dev/null | tr ' ' '\n' | grep -E '^JITSI_' || true

echo "=== Проверка новой сборки ==="
curl -fsS -o /dev/null -w "version.json HTTP %{http_code}\n" "https://test.itflux.ru/version.json" || echo "WARN: version.json недоступен по https (проверьте вручную)"
curl -fsS -o /dev/null -w "sw.js HTTP %{http_code}\n" "https://test.itflux.ru/sw.js" || true

echo "Готово. Проверка: systemctl status itflux --no-pager"
echo "Cron: crontab -l | grep itflux-cron"
echo "Версия: cat ${APP_DIR}/frontend/dist/version.json"
