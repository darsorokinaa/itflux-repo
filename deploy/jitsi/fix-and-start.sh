#!/usr/bin/env bash
# Запуск на сервере: bash /opt/itfluxacademy/itflux/deploy/jitsi/fix-and-start.sh
# Чинит порты (не 8000/8080/8888 Django), права CONFIG, nginx → :8004
set -euo pipefail

JITSI_DIR="${JITSI_DIR:-/opt/jitsi/docker-jitsi-meet}"
DOMAIN="${JITSI_PUBLIC_DOMAIN:-lesson.itflux-academy.ru}"
PUBLIC_IP="${JITSI_PUBLIC_IP:-5.42.106.185}"
HTTP_PORT="${JITSI_HTTP_PORT:-8004}"
JVB_COLIBRI_PORT="${JVB_COLIBRI_PORT:-18080}"
JICOFO_REST_PORT="${JICOFO_REST_PORT:-18888}"
CFG="${CONFIG_DIR:-/root/.jitsi-meet-cfg}"
SECRET_FILE="/root/jitsi-jwt-secret.txt"

cd "$JITSI_DIR"

if [[ ! -f .env ]]; then
  cp env.example .env
  ./gen-passwords.sh || true
fi

if [[ -f "$SECRET_FILE" ]]; then
  SECRET="$(tr -d '\n' < "$SECRET_FILE")"
elif grep -q '^JWT_APP_SECRET=.\+' .env; then
  SECRET="$(grep '^JWT_APP_SECRET=' .env | head -1 | cut -d= -f2-)"
else
  SECRET="$(openssl rand -hex 32)"
fi
printf '%s\n' "$SECRET" > "$SECRET_FILE"
chmod 600 "$SECRET_FILE"

# Запись ключей через python (без ломаного sed)
python3 <<PY
from pathlib import Path
path = Path("$JITSI_DIR") / ".env"
text = path.read_text(encoding="utf-8")
keys = {
    "CONFIG": "$CFG",
    "TZ": "Europe/Moscow",
    "PUBLIC_URL": "https://$DOMAIN",
    "ENABLE_LETSENCRYPT": "0",
    "DISABLE_HTTPS": "1",
    "ENABLE_HTTP_REDIRECT": "0",
    "HTTP_PORT": "$HTTP_PORT",
    "HTTPS_PORT": "8443",
    "DOCKER_HOST_ADDRESS": "$PUBLIC_IP",
    "JVB_ADVERTISE_IPS": "$PUBLIC_IP",
    "JVB_COLIBRI_PORT": "$JVB_COLIBRI_PORT",
    "JICOFO_REST_PORT": "$JICOFO_REST_PORT",
    "ENABLE_AUTH": "1",
    "ENABLE_GUESTS": "0",
    "AUTH_TYPE": "jwt",
    "JWT_APP_ID": "generator_test",
    "JWT_APP_SECRET": """$SECRET""",
    "JWT_ACCEPTED_ISSUERS": "generator_test",
    "JWT_ACCEPTED_AUDIENCES": "jitsi",
}
lines = text.splitlines()
seen = set()
out = []
for line in lines:
    if not line.strip() or line.lstrip().startswith("#") or "=" not in line:
        out.append(line)
        continue
    k = line.split("=", 1)[0].strip()
    if k in keys:
        out.append(f"{k}={keys[k]}")
        seen.add(k)
    else:
        out.append(line)
for k, v in keys.items():
    if k not in seen:
        out.append(f"{k}={v}")
path.write_text("\n".join(out) + "\n", encoding="utf-8")
print("Updated", path)
for k in ("HTTP_PORT", "JVB_COLIBRI_PORT", "JICOFO_REST_PORT", "PUBLIC_URL", "JWT_APP_ID"):
    print(k, "=", keys[k])
PY

mkdir -p \
  "$CFG/web" \
  "$CFG/transcripts" \
  "$CFG/prosody/config" \
  "$CFG/prosody/prosody-plugins-custom" \
  "$CFG/jicofo" \
  "$CFG/jvb" \
  "$CFG/storage/prosody"
chown -R 1000:1000 "$CFG"

echo "==> docker compose down / up"
docker compose down || true
docker compose up -d
sleep 10
docker compose ps

echo "==> local Jitsi web"
curl -sI "http://127.0.0.1:${HTTP_PORT}/" | head -8 || true

echo "==> nginx vhost"
cat > "/etc/nginx/sites-available/${DOMAIN}" <<EOF
map \$http_upgrade \$connection_upgrade {
    default upgrade;
    '' close;
}

upstream jitsi_web {
    server 127.0.0.1:${HTTP_PORT};
    keepalive 32;
}

server {
    listen 80;
    server_name ${DOMAIN};
    location /.well-known/acme-challenge/ { root /var/www/html; }
    location / { return 301 https://\$host\$request_uri; }
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

ln -sf "/etc/nginx/sites-available/${DOMAIN}" "/etc/nginx/sites-enabled/${DOMAIN}"
nginx -t
systemctl reload nginx

echo "==> public"
curl -sI "https://${DOMAIN}/" | head -15 || true

echo
echo "JWT secret saved in $SECRET_FILE"
echo "Django: JITSI_DOMAIN=$DOMAIN JITSI_AUTH_MODE=jwt JITSI_APP_ID=generator_test JITSI_APP_SECRET=\$(cat $SECRET_FILE)"
