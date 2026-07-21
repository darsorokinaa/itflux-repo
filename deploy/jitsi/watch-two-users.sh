#!/usr/bin/env bash
# На сервере: sudo bash deploy/jitsi/watch-two-users.sh
# Затем в двух инкогнито откройте diagnostic room и зайдите.
set -euo pipefail
DOMAIN="${1:-lesson.itflux-academy.ru}"

echo "=== config.js subdomain/subdir/muc ==="
python3 - <<PY
from pathlib import Path
import re
t = Path("/etc/jitsi/meet/${DOMAIN}-config.js").read_text()
for key in ("subdir", "subdomain", "hosts", "muc", "bosh", "websocket",
            "disableDeepLinking", "prejoinPageEnabled", "p2p", "anonymousdomain"):
    for line in t.splitlines():
        if key in line and not line.strip().startswith("//"):
            print(line[:200])
            break
# extract assigned subdir/subdomain near top
for m in re.finditer(r'(?m)^\s*(var\s+)?(subdir|subdomain)\s*=\s*([^;]+);', t):
    print("ASSIGN", m.group(2), "=", m.group(3).strip())
PY

echo
echo "=== JVB advertise / UDP ==="
sudo grep -REn 'server-id|APIS|advertise|ICE|ice4j|PORT|10000' /etc/jitsi/videobridge/ 2>/dev/null | head -40 || true
sudo ss -ulnp | grep 10000 || echo "UDP 10000 not listening"
sudo ufw status 2>/dev/null | grep 10000 || true

echo
echo "=== guest / jaas ==="
ls -la /etc/prosody/conf.d/jaas.cfg.lua* 2>&1 | head -5
sudo grep -n 'VirtualHost\|guest\.' /etc/prosody/conf.d/${DOMAIN}.cfg.lua | head -30

echo
echo "=== Следите за логом (Ctrl+C чтобы выйти) ==="
echo "Откройте ДВА инкогнито: https://${DOMAIN}/itfluxdiagnosticroom001#config.disableDeepLinking=true&config.prejoinPageEnabled=false"
echo "Нужны строки Member joined / Conference ... с ОДНИМ room и двумя участниками"
sudo tail -f /var/log/jitsi/jicofo.log /var/log/jitsi/jvb.log 2>/dev/null
