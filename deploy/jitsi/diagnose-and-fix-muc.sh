#!/usr/bin/env bash
# На сервере: sudo bash deploy/jitsi/diagnose-and-fix-muc.sh
# Диагностика «каждый видит только себя» + безопасные правки guest/JaaS/websocket.
set -euo pipefail

DOMAIN="${1:-lesson.itflux-academy.ru}"
PROSODY_CFG="/etc/prosody/conf.d/${DOMAIN}.cfg.lua"
JITSI_CFG="/etc/jitsi/meet/${DOMAIN}-config.js"
NGINX_SITE="/etc/nginx/sites-enabled/${DOMAIN}"
JAAS_CFG="/etc/prosody/conf.d/jaas.cfg.lua"

echo "=== 1) Сервисы ==="
for s in nginx prosody jicofo jitsi-videobridge2; do
  printf '%-22s %s\n' "$s" "$(systemctl is-active "$s" 2>/dev/null || echo missing)"
done

echo
echo "=== 2) Prosody VirtualHost / authentication ==="
if [[ -f "$PROSODY_CFG" ]]; then
  awk '
    /^VirtualHost|^Component/ { h=$0 }
    /authentication|app_id|allow_empty|asap_|muc_mapper|token_verification/ {
      print h " :: " $0
    }
  ' "$PROSODY_CFG"
else
  echo "НЕТ ФАЙЛА $PROSODY_CFG"
  ls -la /etc/prosody/conf.d/ || true
fi

echo
echo "=== 3) JaaS (часто ломает комнаты) ==="
if [[ -f "$JAAS_CFG" ]]; then
  echo "НАЙДЕН $JAAS_CFG — при проблемах с MUC его лучше отключить:"
  echo "  sudo mv $JAAS_CFG ${JAAS_CFG}.off && sudo systemctl restart prosody"
  wc -l "$JAAS_CFG"
  grep -E 'VirtualHost|Component|authentication|app_id' "$JAAS_CFG" | head -40 || true
else
  echo "jaas.cfg.lua нет — ок"
fi

echo
echo "=== 4) config.js hosts / websocket / bosh ==="
if [[ -f "$JITSI_CFG" ]]; then
  grep -E 'hosts:|domain:|anonymousdomain|muc:|bosh:|websocket:|enableWelcomePage|p2p' "$JITSI_CFG" | head -60 || true
else
  echo "НЕТ $JITSI_CFG"
fi

echo
echo "=== 5) Локальные эндпоинты Prosody ==="
curl -sS -o /dev/null -w "http-bind 127.0.0.1:5280  -> %{http_code}\n" \
  -X POST "http://127.0.0.1:5280/http-bind" -d '' || echo "http-bind FAIL"
curl -sS -o /dev/null -w "xmpp-websocket (http)   -> %{http_code}\n" \
  "http://127.0.0.1:5280/xmpp-websocket" || echo "websocket FAIL"
curl -sS -o /dev/null -w "public /http-bind       -> %{http_code}\n" \
  -X POST "https://${DOMAIN}/http-bind" -d '' || echo "public bosh FAIL"
curl -sS -o /dev/null -w "public /config.js       -> %{http_code}\n" \
  "https://${DOMAIN}/config.js" || echo "config.js FAIL"

echo
echo "=== 6) nginx site ==="
if [[ -e "$NGINX_SITE" ]]; then
  ls -la "$NGINX_SITE"
  grep -E 'server_name|xmpp-websocket|http-bind|colibri|proxy_pass|root ' "$NGINX_SITE" | head -40 || true
else
  echo "Нет $NGINX_SITE — ищем lesson*:"
  ls /etc/nginx/sites-enabled/ | grep -i lesson || ls /etc/nginx/sites-enabled/
fi

echo
echo "=== 7) Авто-правки (guest + allow_empty_token) ==="
if [[ "${APPLY_FIX:-0}" != "1" ]]; then
  echo "Только диагностика. Чтобы применить правки:"
  echo "  sudo APPLY_FIX=1 bash deploy/jitsi/diagnose-and-fix-muc.sh"
  exit 0
fi

[[ -f "$PROSODY_CFG" ]] || { echo "нет prosody cfg"; exit 1; }
cp -a "$PROSODY_CFG" "${PROSODY_CFG}.bak-$(date +%Y%m%d%H%M%S)"

python3 - <<PY
from pathlib import Path
import re
path = Path("$PROSODY_CFG")
text = path.read_text()

# allow_empty_token для диагностики
if re.search(r'^\s*allow_empty_token\s*=', text, flags=re.M):
    text = re.sub(r'^\s*allow_empty_token\s*=\s*\w+', '    allow_empty_token = true', text, count=1, flags=re.M)

# Комментируем guest VirtualHost целиком (частая причина «по одному»).
def comment_guest_block(src: str) -> str:
    lines = src.splitlines(keepends=True)
    out = []
    i = 0
    while i < len(lines):
        line = lines[i]
        if re.match(r'^\s*VirtualHost\s+"guest\.', line):
            out.append("-- DISABLED by diagnose-and-fix-muc.sh (guest MUC split)\n")
            out.append("-- " + line if not line.startswith("--") else line)
            i += 1
            # до следующего VirtualHost/Component на том же уровне или EOF
            while i < len(lines):
                nxt = lines[i]
                if re.match(r'^(VirtualHost|Component)\b', nxt):
                    break
                if nxt.startswith("--"):
                    out.append(nxt)
                else:
                    out.append("-- " + nxt if nxt.strip() else nxt)
                i += 1
            continue
        out.append(line)
        i += 1
    return "".join(out)

text2 = comment_guest_block(text)
path.write_text(text2)
print("updated", path)
PY

if [[ -f "$JITSI_CFG" ]]; then
  cp -a "$JITSI_CFG" "${JITSI_CFG}.bak-$(date +%Y%m%d%H%M%S)"
  # Убираем anonymousdomain из config.js (гости → отдельный MUC)
  python3 - <<PY
from pathlib import Path
import re
p = Path("$JITSI_CFG")
t = p.read_text()
t2, n = re.subn(
    r'^(\s*)anonymousdomain:\s*[\'"][^\'"]*[\'"],?\s*$',
    r'\1// anonymousdomain disabled by diagnose-and-fix-muc.sh',
    t,
    flags=re.M,
)
p.write_text(t2)
print(f"config.js anonymousdomain lines commented: {n}")
PY
fi

if [[ -f "$JAAS_CFG" && "${DISABLE_JAAS:-1}" == "1" ]]; then
  mv "$JAAS_CFG" "${JAAS_CFG}.off"
  echo "moved jaas.cfg.lua -> jaas.cfg.lua.off"
fi

prosodyctl check config 2>&1 | tail -30 || true
systemctl restart prosody jicofo
sleep 2
systemctl is-active prosody jicofo
echo "OK: правки применены. Перезайдите в урок (hard refresh у обоих)."
echo "Проверка без кабинета: https://${DOMAIN}/itfluxdiagnosticroom001"
