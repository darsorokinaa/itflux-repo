#!/usr/bin/env bash
# sudo bash /opt/itfluxacademy/itflux/deploy/jitsi/fix-join-loop.sh
# Чинит цикл: кнопка «Присоединиться» → тот же URL → в комнату не пускает.
set -euo pipefail
DOMAIN="${1:-lesson.itflux-academy.ru}"
JICOFO=/etc/jitsi/jicofo/jicofo.conf
JS=/etc/jitsi/meet/${DOMAIN}-config.js
PROSODY=/etc/prosody/conf.d/${DOMAIN}.cfg.lua

echo "===== BEFORE jicofo authentication ====="
grep -nA6 'authentication' "$JICOFO" || true

cp -a "$JICOFO" "${JICOFO}.bak-joinloop-$(date +%Y%m%d%H%M%S)"

# Вытащить password focus из текущего файла
PASS="$(python3 - <<'PY'
from pathlib import Path
import re
t = Path("/etc/jitsi/jicofo/jicofo.conf").read_text()
m = re.search(r'password:\s*"([^"]+)"', t)
print(m.group(1) if m else "")
PY
)"
if [[ -z "$PASS" ]]; then
  echo "ERROR: не нашёл password focus в jicofo.conf"
  exit 1
fi

# Чистая перезапись — один блок, authentication.enabled=false
cat > "$JICOFO" <<EOF
jicofo {
  xmpp: {
    client: {
      client-proxy: "focus.${DOMAIN}"
      xmpp-domain: "${DOMAIN}"
      domain: "auth.${DOMAIN}"
      username: "focus"
      resource: "focus"
      password: "${PASS}"
    }
    trusted-domains: [ "recorder.${DOMAIN}" ]
  }
  bridge: {
    brewery-jid: "JvbBrewery@internal.auth.${DOMAIN}"
  }
  authentication: {
    enabled: false
  }
  conference: {
    enable-auto-owner: true
  }
}
EOF

echo "===== AFTER jicofo.conf ====="
cat "$JICOFO"

# Prosody: allow empty token + JWT app
if [[ -f "$PROSODY" ]]; then
  cp -a "$PROSODY" "${PROSODY}.bak-joinloop-$(date +%Y%m%d%H%M%S)"
  sed -i -E 's/^([[:space:]]*)allow_empty_token[[:space:]]*=.*/\1allow_empty_token = true/' "$PROSODY" || true
fi

# config.js: deep link / prejoin off
if [[ -f "$JS" ]]; then
  cp -a "$JS" "${JS}.bak-joinloop-$(date +%Y%m%d%H%M%S)"
  python3 - <<PY
from pathlib import Path
import re
p = Path("$JS")
t = p.read_text()

def set_key(src, key, value):
    pat = rf'(?m)^(\s*){re.escape(key)}\s*:'
    if re.search(pat, src):
        return re.sub(pat + r'[^,\n]*', rf'\1{key}: {value}', src, count=1)
    return re.sub(r'(var\s+config\s*=\s*\{\s*\n)', rf'\1    {key}: {value},\n', src, count=1)

for k, v in [
    ("disableDeepLinking", "true"),
    ("prejoinPageEnabled", "false"),
    ("requireDisplayName", "false"),
    ("enableWelcomePage", "false"),
]:
    t = set_key(t, k, v)
t = re.sub(r'(?m)^(\s*)anonymousdomain\s*:', r'\1// anonymousdomain:', t)
p.write_text(t)
print("config.js keys:")
for line in p.read_text().splitlines():
    if any(x in line for x in ("disableDeepLinking", "prejoinPageEnabled", "requireDisplayName", "enableWelcomePage", "anonymousdomain")):
        print(line)
PY
fi

# Убрать JaaS
if [[ -e /etc/prosody/conf.d/jaas.cfg.lua ]]; then
  mv /etc/prosody/conf.d/jaas.cfg.lua /etc/prosody/conf.d/jaas.cfg.lua.off
  echo "disabled jaas"
fi

prosodyctl check config 2>&1 | tail -15 || true
systemctl restart prosody
systemctl stop jicofo
pkill -9 -f '/usr/share/jicofo' || true
sleep 1
systemctl start jicofo
sleep 3
systemctl is-active prosody jicofo

echo "===== jicofo auth line ====="
grep -A4 'authentication' /var/log/jitsi/jicofo.log | tail -20 || true
tail -n 5 /var/log/jitsi/jicofo.log | grep -E 'authentication|Registered|videobridge' || \
  grep -E 'authentication|Registered|videobridge' /var/log/jitsi/jicofo.log | tail -10

echo
echo "Откройте ИНКОГНИТО:"
echo "https://${DOMAIN}/itfluxdiagnosticroom001#config.disableDeepLinking=true&config.prejoinPageEnabled=false"
echo "Не должно быть кнопки Join / должна сразу идти загрузка комнаты."
