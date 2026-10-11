#!/usr/bin/env bash
# Готовит ограничение HTTP Jitsi Videobridge (порт 9090) локальным интерфейсом.
# Сам по себе ничего не перезапускает и порт не закрывает.
#
# Зависимость: браузер ходит в colibri через nginx :443,
#   location /colibri-ws/ → http://127.0.0.1:9090
# Медиа (UDP 10000) и BOSH (:443 /http-bind) этим портом не пользуются.
# Прямой доступ к :9090 из интернета уроку не нужен.
#
# Применить на сервере только после проверки nginx и только вручную:
#   sudo CONFIRM_RESTRICT_9090=1 bash deploy/jitsi/restrict-jvb-colibri-localhost.sh
# Скрипт не стоит в cron, systemd и deploy/update.sh.
set -euo pipefail

DOMAIN="${1:-lesson.itflux-academy.ru}"
NGINX_SITE="${NGINX_SITE:-/etc/nginx/sites-enabled/${DOMAIN}}"
JVB_CONF="${JVB_CONF:-/etc/jitsi/videobridge/jvb.conf}"

echo "Порт 9090 — HTTP Jetty у jitsi-videobridge2 (colibri websocket)."
echo "Клиенты должны попадать сюда только через nginx на 127.0.0.1."
echo "Не закрывайте 9090 на localhost: прокси colibri-ws перестанет работать."

if [[ ! -f "$NGINX_SITE" && -f /etc/nginx/sites-available/${DOMAIN} ]]; then
  NGINX_SITE="/etc/nginx/sites-available/${DOMAIN}"
fi

if [[ ! -f "$NGINX_SITE" ]]; then
  echo "STOP: не найден nginx site для ${DOMAIN}. Порт не трогаем."
  exit 1
fi

if ! grep -q '127.0.0.1:9090' "$NGINX_SITE"; then
  echo "STOP: в ${NGINX_SITE} нет proxy_pass на 127.0.0.1:9090."
  echo "Пока зависимость не подтверждена, внешний доступ не ограничиваем."
  exit 1
fi

echo "nginx проксирует colibri на 127.0.0.1:9090 — локальный порт нужен."

if [[ "${CONFIRM_RESTRICT_9090:-0}" != "1" ]]; then
  echo "Сухой прогон. Чтобы записать bind 127.0.0.1 в ${JVB_CONF} и перезапустить только jitsi-videobridge2:"
  echo "  sudo CONFIRM_RESTRICT_9090=1 bash $0"
  echo "ufw в этом скрипте не меняется."
  exit 0
fi

if [[ ! -f "$JVB_CONF" ]]; then
  echo "STOP: нет ${JVB_CONF}."
  exit 1
fi

cp -a "$JVB_CONF" "${JVB_CONF}.bak-bind9090-$(date +%Y%m%d%H%M%S)"
python3 - "$JVB_CONF" <<'PY'
from pathlib import Path
import re, sys
path = Path(sys.argv[1])
text = path.read_text()
if re.search(r'(?m)^\s*host\s*=', text):
    text = re.sub(r'(?m)^(\s*host\s*=\s*)"[^"]*"', r'\1"127.0.0.1"', text, count=1)
else:
    text = text.rstrip() + """

videobridge {
  http-servers {
    public {
      host = "127.0.0.1"
    }
  }
}
"""
path.write_text(text)
print("jvb http host = 127.0.0.1")
PY

systemctl restart jitsi-videobridge2
systemctl is-active jitsi-videobridge2
echo "Проверьте снаружи, что :9090 больше не отвечает, и что урок по-прежнему открывает colibri через :443."
