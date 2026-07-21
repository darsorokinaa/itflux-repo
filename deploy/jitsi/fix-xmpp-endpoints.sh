#!/usr/bin/env bash
# На сервере (скопируйте файл или вставьте команды ниже):
#   sudo bash deploy/jitsi/fix-xmpp-endpoints.sh
#
# Чинит типичный обрыв: Prosody отвечает 404 на /http-bind и /xmpp-websocket
# → в Jitsi «Присоединиться» не работает, участники не видят друг друга.
set -euo pipefail

DOMAIN="${1:-lesson.itflux-academy.ru}"
CFG="/etc/prosody/conf.d/${DOMAIN}.cfg.lua"
JS="/etc/jitsi/meet/${DOMAIN}-config.js"

echo "=== A) curl с Host (без Host Prosody часто даёт 404 — это нормально) ==="
curl -sS -o /dev/null -w "bosh+Host  %{http_code}\n" -X GET \
  -H "Host: ${DOMAIN}" "http://127.0.0.1:5280/http-bind" || true
curl -sS -o /dev/null -w "ws+Host    %{http_code}\n" -X GET \
  -H "Host: ${DOMAIN}" "http://127.0.0.1:5280/xmpp-websocket" || true
curl -sS -o /dev/null -w "bosh public %{http_code}\n" -X GET \
  "https://${DOMAIN}/http-bind" || true
curl -sS -o /dev/null -w "ws public   %{http_code}\n" -X GET \
  "https://${DOMAIN}/xmpp-websocket" || true

echo
echo "=== A2) BOSH features (если только ANONYMOUS — JWT не включён, Join ломается) ==="
BOSH_BODY="$(curl -sS -X POST "https://${DOMAIN}/http-bind" \
  -H 'Content-Type: text/xml' \
  --data "<body rid='1' xmlns='http://jabber.org/protocol/httpbind' to='${DOMAIN}' wait='60' hold='1' ver='1.6'/>" \
  || true)"
echo "$BOSH_BODY" | tr '>' '>\n' | grep -E 'mechanism|authentication|starttls' | head -20 || true
if echo "$BOSH_BODY" | grep -q 'ANONYMOUS' && ! echo "$BOSH_BODY" | grep -qiE 'JWT|token'; then
  echo "WARN: Prosody предлагает ANONYMOUS без JWT. Выполните: sudo bash deploy/jitsi/fix-jwt-prosody.sh"
fi

echo
echo "=== B) Последний бэкап Prosody ==="
ls -lt /etc/prosody/conf.d/${DOMAIN}.cfg.lua.bak-* 2>/dev/null | head -5 || echo "бэкапов нет"

echo
echo "=== C) Синтаксис Prosody ==="
prosodyctl check config 2>&1 | tail -40 || true

echo
echo "=== D) modules bosh/websocket в cfg ==="
grep -nE 'modules_enabled|\"bosh\"|\"websocket\"|consider_bosh|http_ports|http_interfaces' "$CFG" | head -40 || true

echo
echo "Дальше: если prosodyctl ругается на синтаксис — восстановите бэкап:"
echo "  sudo cp -a \$(ls -t ${CFG}.bak-* | head -1) $CFG && sudo systemctl restart prosody"
echo
echo "Чтобы применить авто-фикс модулей HTTP:"
echo "  sudo APPLY_FIX=1 bash $0"
echo

if [[ "${APPLY_FIX:-0}" != "1" ]]; then
  exit 0
fi

[[ -f "$CFG" ]] || { echo "нет $CFG"; exit 1; }
cp -a "$CFG" "${CFG}.bak-xmpp-$(date +%Y%m%d%H%M%S)"

python3 - <<PY
from pathlib import Path
import re
path = Path("$CFG")
text = path.read_text()

# Глобальные флаги для BOSH за HTTPS/nginx
def ensure_global(src: str, key: str, value: str) -> str:
    # value уже в lua-синтаксисе, напр. true
    pat = rf'(?m)^\s*{re.escape(key)}\s*='
    if re.search(pat, src):
        return re.sub(pat + r'[^\n]*', f'{key} = {value}', src, count=1)
    # вставить после VirtualHost domain или в начало файла
    insert = f"{key} = {value}\n"
    return insert + src

text = ensure_global(text, "consider_bosh_secure", "true")
text = ensure_global(text, "cross_domain_bosh", "true")
text = ensure_global(text, "cross_domain_websocket", "true")

# Убедиться, что в modules_enabled основного VirtualHost есть bosh и websocket
vh = 'VirtualHost "lesson.itflux-academy.ru"'
if vh in text:
    # найти блок modules_enabled после этого VirtualHost
    m = re.search(
        rf'{re.escape(vh)}.*?modules_enabled\s*=\s*\{{(.*?)\}}',
        text,
        flags=re.S,
    )
    if m:
        body = m.group(1)
        need = []
        if '"bosh"' not in body and "'bosh'" not in body:
            need.append('        "bosh";')
        if '"websocket"' not in body and "'websocket'" not in body:
            need.append('        "websocket";')
        if need:
            new_body = body.rstrip() + "\n" + "\n".join(need) + "\n"
            text = text[:m.start(1)] + new_body + text[m.end(1):]
            print("added modules:", need)
        else:
            print("bosh/websocket already in modules_enabled")
    else:
        print("WARN: modules_enabled not found under main VirtualHost — проверьте вручную")
else:
    print("WARN: main VirtualHost not found")

# Убрать сломанные строки от предыдущего скрипта (если есть мусор вида "elsosudo")
text = re.sub(r'(?m)^.*elsosudo.*\n?', '', text)
text = re.sub(r'(?m)^.*out\.append\(line if line\.startswith.*\n?', '', text)

path.write_text(text)
print("wrote", path)
PY

# Отключить JaaS symlink, если ещё активен
if [[ -L /etc/prosody/conf.d/jaas.cfg.lua ]]; then
  mv /etc/prosody/conf.d/jaas.cfg.lua /etc/prosody/conf.d/jaas.cfg.lua.off
  echo "disabled jaas.cfg.lua"
elif [[ -f /etc/prosody/conf.d/jaas.cfg.lua ]]; then
  mv /etc/prosody/conf.d/jaas.cfg.lua /etc/prosody/conf.d/jaas.cfg.lua.off
  echo "disabled jaas.cfg.lua"
fi

prosodyctl check config 2>&1 | tail -30
systemctl restart prosody jicofo
sleep 2
systemctl is-active prosody jicofo

echo
echo "=== повторная проверка с Host ==="
curl -sS -o /dev/null -w "bosh+Host  %{http_code}\n" -H "Host: ${DOMAIN}" "http://127.0.0.1:5280/http-bind" || true
curl -sS -o /dev/null -w "ws+Host    %{http_code}\n" -H "Host: ${DOMAIN}" "http://127.0.0.1:5280/xmpp-websocket" || true
curl -sS -o /dev/null -w "bosh public %{http_code}\n" "https://${DOMAIN}/http-bind" || true

echo "OK. Откройте https://${DOMAIN}/itfluxdiagnosticroom001 и нажмите Join в двух браузерах."
