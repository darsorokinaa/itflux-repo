#!/usr/bin/env bash
# Скопируйте ВЕСЬ файл на сервер и выполните:
#   sudo bash FORCE-FIX-PASTE-ON-SERVER.sh
# Не требует git pull — самодостаточный.
set -euo pipefail

DOMAIN="lesson.itflux-academy.ru"
CFG="/etc/prosody/conf.d/${DOMAIN}.cfg.lua"
JS="/etc/jitsi/meet/${DOMAIN}-config.js"
JVB="/etc/jitsi/videobridge/jvb.conf"
PUBLIC_IP="$(curl -4 -s --max-time 5 ifconfig.me || echo 5.42.106.185)"

# Секрет из Django .env на ЭТОМ сервере
ENV_FILE=""
for f in \
  /opt/itfluxacademy/itflux/Generator/.env \
  /opt/itfluxacademy/itflux/.env \
  /opt/itflux/Generator/.env \
  /opt/itflux/.env
do
  [[ -f "$f" ]] && ENV_FILE="$f" && break
done

APP_ID="generator_test"
APP_SECRET=""
if [[ -n "$ENV_FILE" ]]; then
  APP_ID="$(grep -E '^JITSI_APP_ID=' "$ENV_FILE" | tail -1 | cut -d= -f2- || true)"
  APP_SECRET="$(grep -E '^JITSI_APP_SECRET=' "$ENV_FILE" | tail -1 | cut -d= -f2- || true)"
  APP_ID="${APP_ID:-generator_test}"
fi

if [[ -z "$APP_SECRET" ]]; then
  echo "ERROR: не найден JITSI_APP_SECRET. Укажите ENV:"
  echo "  sudo JITSI_APP_SECRET='...' bash $0"
  exit 1
fi

echo "ENV=$ENV_FILE"
echo "APP_ID=$APP_ID secret_len=${#APP_SECRET} PUBLIC_IP=$PUBLIC_IP"

[[ -f "$CFG" ]] || { echo "нет $CFG"; ls -la /etc/prosody/conf.d/; exit 1; }
cp -a "$CFG" "${CFG}.bak-force-$(date +%Y%m%d%H%M%S)"

python3 - <<PY
from pathlib import Path
import re
path = Path("$CFG")
text = path.read_text()
app_id = """$APP_ID"""
app_secret = """$APP_SECRET"""

# 1) main VH → token
m = re.search(
    r'(VirtualHost\s+"lesson\.itflux-academy\.ru"\s*\n)(.*?)(?=\nVirtualHost|\nComponent|\Z)',
    text,
    flags=re.S,
)
if not m:
    raise SystemExit("VirtualHost lesson.itflux-academy.ru не найден")
head, body = m.group(1), m.group(2)
if re.search(r'^\s*authentication\s*=', body, flags=re.M):
    body = re.sub(
        r'^\s*authentication\s*=\s*["\'][^"\']*["\']',
        '    authentication = "token"',
        body, count=1, flags=re.M,
    )
else:
    body = '    authentication = "token"\n' + body

def upsert(body: str, key: str, value: str) -> str:
    pat = rf'(?m)^\s*{re.escape(key)}\s*=\s*["\'][^"\']*["\']'
    line = f'    {key}="{value}"'
    if re.search(pat, body):
        return re.sub(pat, line, body, count=1)
    # после authentication
    return re.sub(
        r'(?m)^(\s*authentication\s*=\s*"token"\s*\n)',
        rf'\1{line}\n',
        body,
        count=1,
    )

body = upsert(body, "app_id", app_id)
body = upsert(body, "app_secret", app_secret)
if re.search(r'(?m)^\s*allow_empty_token\s*=', body):
    body = re.sub(r'(?m)^\s*allow_empty_token\s*=\s*\w+', '    allow_empty_token = true', body, count=1)
else:
    body = re.sub(
        r'(?m)^(\s*app_secret\s*=\s*["\'][^"\']*["\']\s*\n)',
        r'\1    allow_empty_token = true\n',
        body,
        count=1,
    )

text = text[:m.start()] + head + body + text[m.end():]

# 2) comment guest VH authentication
text = re.sub(
    r'(?m)^(\s*VirtualHost\s+"guest\.[^"]+"\s*\n(?:.*\n)*?)(^\s*authentication\s*=\s*"jitsi-anonymous")',
    r'\1-- force-fix: \2',
    text,
    count=1,
)

# 3) disable jaas if present as file
path.write_text(text)
print("Prosody updated")
for line in path.read_text().splitlines():
    if "app_secret" in line:
        print('    app_secret="***"')
    elif any(k in line for k in ("VirtualHost", "authentication", "app_id", "allow_empty")):
        print(line)
PY

if [[ -L /etc/prosody/conf.d/jaas.cfg.lua ]] || [[ -f /etc/prosody/conf.d/jaas.cfg.lua ]]; then
  mv /etc/prosody/conf.d/jaas.cfg.lua "/etc/prosody/conf.d/jaas.cfg.lua.off-$(date +%Y%m%d%H%M%S)" || true
  echo "disabled jaas.cfg.lua"
fi

# 4) config.js — prejoin/deeplink off, anonymousdomain off
if [[ -f "$JS" ]]; then
  cp -a "$JS" "${JS}.bak-force-$(date +%Y%m%d%H%M%S)"
  python3 - <<PY
from pathlib import Path
import re
p = Path("$JS")
t = p.read_text()

def upsert(src, key, value):
    pat = rf'(?m)^(\s*){re.escape(key)}\s:'
    if re.search(pat, src):
        return re.sub(pat + r'[^,\n]*', rf'\1{key}: {value}', src, count=1)
    return re.sub(r'(var\s+config\s*=\s*\{\s*\n)', rf'\1    {key}: {value},\n', src, count=1)

for k,v in [
    ("disableDeepLinking", "true"),
    ("prejoinPageEnabled", "false"),
    ("enableWelcomePage", "false"),
    ("requireDisplayName", "false"),
]:
    t = upsert(t, k, v)
t = re.sub(r'(?m)^(\s*)anonymousdomain\s*:', r'\1// anonymousdomain:', t)
p.write_text(t)
print("config.js updated")
PY
fi

# 5) JVB public IP
if [[ -f "$JVB" ]]; then
  cp -a "$JVB" "${JVB}.bak-force-$(date +%Y%m%d%H%M%S)"
  LOCAL_IP="$(hostname -I | awk '{print $1}')"
  python3 - <<PY
from pathlib import Path
import re
p = Path("$JVB")
t = p.read_text()
pub = "$PUBLIC_IP"
local = "$LOCAL_IP" or "10.0.0.1"
block = f'''
ice4j {{
  harvest {{
    mapping {{
      static-mappings = [
        {{
          local-address = "{local}"
          public-address = "{pub}"
        }}
      ]
    }}
  }}
}}
'''
if "public-address" in t:
    t = re.sub(r'public-address\s*=\s*"[^"]*"', f'public-address = "{pub}"', t, count=1)
    print("jvb public-address updated")
elif "static-mappings" not in t:
    t = t.rstrip() + "\n" + block
    print("jvb ice4j block appended")
p.write_text(t)
PY
fi

# 6) firewall
ufw allow 10000/udp || true
ufw allow 443/tcp || true
ufw reload || true

# 7) restart
prosodyctl check config 2>&1 | tail -30 || true
systemctl restart prosody jicofo jitsi-videobridge2
systemctl reload nginx || true
sleep 2
systemctl is-active nginx prosody jicofo jitsi-videobridge2

echo
echo "=== authentication in cfg ==="
grep -nE 'VirtualHost|authentication|app_id|allow_empty' "$CFG" | head -40

echo
echo "=== BOSH mechanisms (JWT/token setup may still show ANONYMOUS — важно authentication=token в cfg) ==="
curl -sS -X POST "https://${DOMAIN}/http-bind" \
  -H 'Content-Type: text/xml' \
  --data "<body rid='1' xmlns='http://jabber.org/protocol/httpbind' to='${DOMAIN}' wait='60' hold='1' ver='1.6'/>" \
  | tr '>' '>\n' | grep mechanism | head || true

echo
echo "=== UDP 10000 ==="
ss -ulnp | grep 10000 || echo "NOT LISTENING"

echo
echo "TEST (2 incognito):"
echo "https://${DOMAIN}/itfluxdiagnosticroom001#config.prejoinPageEnabled=false&config.disableDeepLinking=true"
