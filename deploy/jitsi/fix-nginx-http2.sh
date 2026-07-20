#!/bin/bash
# Минимальный фикс: убрать неподдерживаемую директиву и включить http2 в listen.
# Запуск: bash fix-nginx-http2.sh
set -euo pipefail
F=/etc/nginx/sites-available/lesson.itflux-academy.ru
test -f "$F"
# убрать строку "http2 on;"
sed -i '/^[[:space:]]*http2 on;/d' "$F"
# если listen без http2 — добавить
sed -i 's/listen 443 ssl;/listen 443 ssl http2;/' "$F"
# не дублировать http2
sed -i 's/listen 443 ssl http2 http2;/listen 443 ssl http2;/' "$F"
grep -n 'listen 443\|http2\|colibri' "$F" || true
nginx -t
systemctl reload nginx
echo OK
curl -sk -D- -o /tmp/cws -m 5 -H 'Host: lesson.itflux-academy.ru' https://127.0.0.1/colibri-ws/default-id/test | head -15
echo BODY:; head -c 80 /tmp/cws; echo
file /tmp/cws
