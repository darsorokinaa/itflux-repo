#!/usr/bin/env bash
# Запускать НА СЕРВЕРЕ (SSH), от пользователя с sudo.
# Ставит Docker Jitsi + nginx vhost lesson.itflux-academy.ru (не Django).
set -euo pipefail

DOMAIN="${JITSI_PUBLIC_DOMAIN:-lesson.itflux-academy.ru}"
PUBLIC_IP="${JITSI_PUBLIC_IP:-5.42.106.185}"
JITSI_HTTP_PORT="${JITSI_HTTP_PORT:-8000}"
JITSI_DIR="${JITSI_DIR:-/opt/jitsi/docker-jitsi-meet}"
REPO_NGINX="${REPO_NGINX:-/opt/itflux/deploy/jitsi/nginx-lesson.conf}"

echo "==> Домен: $DOMAIN  IP: $PUBLIC_IP  Docker HTTP: $JITSI_HTTP_PORT"

if [[ "$(id -u)" -eq 0 ]]; then
  echo "Запускайте обычным пользователем с sudo, не под root (для ~/.jitsi-meet-cfg)."
  exit 1
fi

echo "==> 1. Docker"
if ! command -v docker >/dev/null 2>&1; then
  sudo apt update
  sudo apt install -y docker.io docker-compose-v2 git openssl
  sudo usermod -aG docker "$USER" || true
  echo "Выйдите из SSH и зайдите снова (группа docker), затем повторите скрипт."
  exit 0
fi

echo "==> 2. Клон docker-jitsi-meet"
sudo mkdir -p /opt/jitsi
sudo chown "$USER:$USER" /opt/jitsi
if [[ ! -d "$JITSI_DIR/.git" ]]; then
  git clone https://github.com/jitsi/docker-jitsi-meet.git "$JITSI_DIR"
fi
cd "$JITSI_DIR"

if [[ ! -f .env ]]; then
  cp env.example .env
  ./gen-passwords.sh
fi

SECRET="$(openssl rand -hex 32)"
if grep -q '^JWT_APP_SECRET=' .env; then
  # не перезаписываем существующий секрет
  SECRET="$(grep '^JWT_APP_SECRET=' .env | head -1 | cut -d= -f2-)"
else
  echo "JWT_APP_SECRET=$SECRET" >> .env
fi

# идемпотентно выставляем ключи
set_env() {
  local key="$1" val="$2"
  if grep -q "^${key}=" .env; then
    sed -i.bak "s|^${key}=.*|${key}=${val}|" .env
  else
    echo "${key}=${val}" >> .env
  fi
}

set_env PUBLIC_URL "https://${DOMAIN}"
set_env ENABLE_LETSENCRYPT "0"
set_env DISABLE_HTTPS "1"
set_env ENABLE_HTTP_REDIRECT "0"
set_env HTTP_PORT "${JITSI_HTTP_PORT}"
set_env HTTPS_PORT "8443"
set_env TZ "Europe/Moscow"
set_env DOCKER_HOST_ADDRESS "${PUBLIC_IP}"
set_env JVB_ADVERTISE_IPS "${PUBLIC_IP}"
set_env ENABLE_AUTH "1"
# Гости + JWT → рассинхрон MUC («каждый один в комнате»). Оба участника с JWT.
set_env ENABLE_GUESTS "0"
set_env AUTH_TYPE "jwt"
set_env JWT_APP_ID "generator_test"
set_env JWT_ACCEPTED_ISSUERS "generator_test"
set_env JWT_ACCEPTED_AUDIENCES "jitsi"
set_env JWT_APP_SECRET "$SECRET"

mkdir -p "$HOME/.jitsi-meet-cfg"
echo "==> 3. docker compose up"
docker compose up -d
sleep 3
curl -sI "http://127.0.0.1:${JITSI_HTTP_PORT}/" | head -5 || {
  echo "Jitsi web не отвечает на :${JITSI_HTTP_PORT}. Смотрите: docker compose logs --tail=80"
  exit 1
}

echo "==> 4. SSL сертификат для ${DOMAIN}"
if [[ ! -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]]; then
  sudo apt install -y certbot python3-certbot-nginx
  sudo certbot certonly --nginx -d "$DOMAIN" --non-interactive --agree-tos \
    --register-unsafely-without-email || \
  sudo certbot certonly --standalone -d "$DOMAIN" --non-interactive --agree-tos \
    --register-unsafely-without-email --preferred-challenges http || true
fi

if [[ ! -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]]; then
  echo "Не удалось получить сертификат. Выпустите вручную:"
  echo "  sudo certbot certonly --nginx -d ${DOMAIN}"
  exit 1
fi

echo "==> 5. nginx vhost (Jitsi, НЕ Django)"
TMP_CONF="$(mktemp)"
cat > "$TMP_CONF" << EOF
map \$http_upgrade \$connection_upgrade {
    default upgrade;
    '' close;
}

upstream jitsi_web {
    server 127.0.0.1:${JITSI_HTTP_PORT};
    keepalive 32;
}

server {
    listen 80;
    server_name ${DOMAIN};
    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl http2;
    server_name ${DOMAIN};

    ssl_certificate     /etc/letsencrypt/live/${DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${DOMAIN}/privkey.pem;

    client_max_body_size 20M;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;

    location = /xmpp-websocket {
        proxy_pass http://jitsi_web;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location /colibri-ws/ {
        proxy_pass http://jitsi_web;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location / {
        proxy_pass http://jitsi_web;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \$connection_upgrade;
    }
}
EOF

sudo cp "$TMP_CONF" /etc/nginx/sites-available/${DOMAIN}
sudo ln -sf /etc/nginx/sites-available/${DOMAIN} /etc/nginx/sites-enabled/${DOMAIN}
rm -f "$TMP_CONF"

# Убрать редирект lesson → academy из default, если мешает (только подсказка)
echo "==> Проверьте, что нет другого server_name ${DOMAIN} с proxy на Django / return 301 на academy."

sudo nginx -t
sudo systemctl reload nginx

echo "==> 6. Firewall UDP 10000"
sudo ufw allow 10000/udp || true

echo
echo "=============================="
echo "Jitsi должен открываться: https://${DOMAIN}"
echo "Секрет для Django (JITSI_APP_SECRET):"
echo "$SECRET"
echo
echo "В gunicorn / .env платформы:"
echo "  JITSI_DOMAIN=${DOMAIN}"
echo "  JITSI_AUTH_MODE=jwt"
echo "  JITSI_APP_ID=generator_test"
echo "  JITSI_APP_SECRET=${SECRET}"
echo "  JITSI_SUB=${DOMAIN}"
echo "  JITSI_AUD=jitsi"
echo "  JITSI_EMBED_EXTRA_HOSTS=${DOMAIN}"
echo "=============================="
