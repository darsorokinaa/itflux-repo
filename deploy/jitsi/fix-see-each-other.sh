#!/usr/bin/env bash
# Один скрипт: «вошли, но не видят друг друга» / Join не пускает.
# На сервере:
#   sudo bash /opt/itflux/deploy/jitsi/fix-see-each-other.sh
#
# Делает:
#   1) Prosody authentication=token + app_id/secret из Django .env
#   2) ENABLE_GUESTS=0 / отключает guest VirtualHost (разные MUC)
#   3) prejoin/deeplink off в config.js
#   4) JVB public IP (native jvb.conf или Docker JVB_ADVERTISE_IPS)
#   5) ufw UDP 10000
#   6) restart nginx prosody jicofo jitsi-videobridge2
set -euo pipefail

DOMAIN="${1:-lesson.itflux-academy.ru}"
PUBLIC_IP="${PUBLIC_IP:-$(curl -4 -s --max-time 5 ifconfig.me || true)}"
PUBLIC_IP="${PUBLIC_IP:-5.42.106.185}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

echo "==> Domain=${DOMAIN} PUBLIC_IP=${PUBLIC_IP}"
echo "==> Repo=${REPO_ROOT}"

echo
echo "==> 0) Статус служб (native)"
for s in nginx prosody jicofo jitsi-videobridge2; do
  printf '  %-22s %s\n' "$s" "$(systemctl is-active "$s" 2>/dev/null || echo missing)"
done

echo
echo "==> 1) JWT + token auth (Prosody)"
bash "${SCRIPT_DIR}/fix-jwt-prosody.sh" "${DOMAIN}"

echo
echo "==> 2) Guest MUC / allow_empty (diagnose)"
APPLY_FIX=1 bash "${SCRIPT_DIR}/diagnose-and-fix-muc.sh" "${DOMAIN}" || true

echo
echo "==> 3) Deep link / prejoin off"
bash "${SCRIPT_DIR}/disable-deeplink.sh" "${DOMAIN}" || true

echo
echo "==> 4) Firewall UDP 10000"
if command -v ufw >/dev/null; then
  ufw allow 80/tcp || true
  ufw allow 443/tcp || true
  ufw allow 10000/udp || true
  ufw allow 3478/udp || true
  ufw reload || true
  ufw status verbose | grep -E '10000|443|80' || true
else
  echo "ufw нет — откройте UDP 10000 в панели хостинга вручную"
fi

echo
echo "==> 5) JVB advertise public IP (native)"
JVB_CONF="/etc/jitsi/videobridge/jvb.conf"
if [[ -f "$JVB_CONF" ]]; then
  cp -a "$JVB_CONF" "${JVB_CONF}.bak-see-$(date +%Y%m%d%H%M%S)"
  python3 - <<PY
from pathlib import Path
import re
p = Path("$JVB_CONF")
t = p.read_text()
public_ip = "$PUBLIC_IP"
# Узнать локальный IP интерфейса по умолчанию
import subprocess
local = ""
try:
    out = subprocess.check_output(["hostname", "-I"], text=True).split()
    local = next((x for x in out if not x.startswith("127.")), out[0] if out else "")
except Exception:
    local = ""
if not local:
    local = "10.0.0.1"
print(f"local-address={local} public-address={public_ip}")

block = f'''
ice4j {{
  harvest {{
    mapping {{
      static-mappings = [
        {{
          local-address = "{local}"
          public-address = "{public_ip}"
        }}
      ]
    }}
  }}
}}
'''
if "static-mappings" in t:
    # заменить public-address в существующем блоке
    t2, n = re.subn(
        r'public-address\s*=\s*"[^"]*"',
        f'public-address = "{public_ip}"',
        t,
        count=1,
    )
    if n:
        t = t2
        print("updated existing public-address")
    else:
        print("WARN: static-mappings есть, но public-address не найден — проверьте вручную")
elif re.search(r'(?m)^\s*ice4j\s*\{', t):
    print("WARN: ice4j блок есть без static-mappings — допишите вручную")
else:
    t = t.rstrip() + "\n" + block + "\n"
    print("appended ice4j static-mappings")
p.write_text(t)
PY
else
  echo "нет $JVB_CONF — возможно Docker-only"
fi

echo
echo "==> 5b) Docker JVB_ADVERTISE_IPS (если есть)"
for COMPOSE_ENV in /opt/jitsi/docker-jitsi-meet/.env /opt/docker-jitsi-meet/.env; do
  if [[ -f "$COMPOSE_ENV" ]]; then
    echo "  $COMPOSE_ENV"
    grep -qE '^JVB_ADVERTISE_IPS=' "$COMPOSE_ENV" \
      && sed -i "s/^JVB_ADVERTISE_IPS=.*/JVB_ADVERTISE_IPS=${PUBLIC_IP}/" "$COMPOSE_ENV" \
      || echo "JVB_ADVERTISE_IPS=${PUBLIC_IP}" >> "$COMPOSE_ENV"
    grep -qE '^DOCKER_HOST_ADDRESS=' "$COMPOSE_ENV" \
      && sed -i "s/^DOCKER_HOST_ADDRESS=.*/DOCKER_HOST_ADDRESS=${PUBLIC_IP}/" "$COMPOSE_ENV" \
      || echo "DOCKER_HOST_ADDRESS=${PUBLIC_IP}" >> "$COMPOSE_ENV"
    grep -qE '^ENABLE_GUESTS=' "$COMPOSE_ENV" \
      && sed -i 's/^ENABLE_GUESTS=.*/ENABLE_GUESTS=0/' "$COMPOSE_ENV" \
      || echo 'ENABLE_GUESTS=0' >> "$COMPOSE_ENV"
    (cd "$(dirname "$COMPOSE_ENV")" && docker compose up -d) || true
  fi
done

echo
echo "==> 6) Restart native stack"
systemctl restart prosody jicofo jitsi-videobridge2 2>/dev/null || true
systemctl reload nginx 2>/dev/null || true
sleep 2
for s in nginx prosody jicofo jitsi-videobridge2; do
  printf '  %-22s %s\n' "$s" "$(systemctl is-active "$s" 2>/dev/null || echo missing)"
done

echo
echo "==> 7) Проверки"
echo "--- UDP 10000 listen ---"
ss -ulnp | grep 10000 || echo "FAIL: UDP 10000 not listening"
echo "--- BOSH mechanisms ---"
BODY="$(curl -sS -X POST "https://${DOMAIN}/http-bind" \
  -H 'Content-Type: text/xml' \
  --data "<body rid='1' xmlns='http://jabber.org/protocol/httpbind' to='${DOMAIN}' wait='60' hold='1' ver='1.6'/>" || true)"
echo "$BODY" | tr '>' '>\n' | grep -i mechanism | head -10 || true
if echo "$BODY" | grep -q 'ANONYMOUS' && ! grep -q 'authentication = "token"' "/etc/prosody/conf.d/${DOMAIN}.cfg.lua" 2>/dev/null; then
  echo "WARN: всё ещё anonymous — откройте /etc/prosody/conf.d/${DOMAIN}.cfg.lua и проверьте VirtualHost"
fi
echo "--- Prosody auth lines ---"
grep -nE 'VirtualHost|authentication|app_id|allow_empty' "/etc/prosody/conf.d/${DOMAIN}.cfg.lua" 2>/dev/null | head -40 || true

echo
echo "OK. Откройте в ДВУХ инкогнито:"
echo "  https://${DOMAIN}/itfluxdiagnosticroom001#config.prejoinPageEnabled=false&config.disableDeepLinking=true"
echo "Если там друг друга видно — повторите урок в кабинете."
echo "Если нет — смотрите: sudo journalctl -u jitsi-videobridge2 -n 100 --no-pager"
echo "И откройте UDP 10000 во внешнем firewall хостинга (не только ufw)."
