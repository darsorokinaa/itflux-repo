#!/usr/bin/env bash
# Canonical production Jitsi = native apt stack (Prosody/Jicofo/JVB + nginx → /usr/share/jitsi-meet).
# Leftover Docker Jitsi must stay stopped: its JVB cannot bind UDP 10000, but its
# docker bridge 172.18.0.1 is harvested by native JVB as an ICE host candidate.
#
# Usage on the server:
#   sudo bash /opt/itfluxacademy/itflux/deploy/jitsi/canonicalize-native-stack.sh
set -euo pipefail

DOMAIN="${1:-lesson.itflux-academy.ru}"
PUBLIC_IP="${PUBLIC_IP:-5.42.106.185}"
JVB_CONF="/etc/jitsi/videobridge/jvb.conf"
MEET_CONF="/etc/jitsi/meet/${DOMAIN}-config.js"
COMPOSE_DIR="${JITSI_DOCKER_DIR:-/opt/jitsi/docker-jitsi-meet}"
STAMP="$(date +%Y%m%d%H%M%S)"

echo "==> Canonicalize native Jitsi (no Docker) domain=${DOMAIN} ip=${PUBLIC_IP}"

if [[ -d "$COMPOSE_DIR" ]]; then
  echo "==> Stop leftover Docker Jitsi (native nginx does not proxy to it)"
  (cd "$COMPOSE_DIR" && docker compose stop) || true
fi

if [[ -f "$JVB_CONF" ]]; then
  cp -a "$JVB_CONF" "${JVB_CONF}.bak-${STAMP}"
  python3 - "$JVB_CONF" "$PUBLIC_IP" <<'PY'
import pathlib, re, sys
path = pathlib.Path(sys.argv[1])
public_ip = sys.argv[2]
text = path.read_text()
ice = f'''
ice4j {{
    harvest {{
        mapping {{
            aws {{ enabled = false }}
            stun {{ enabled = false }}
            static-mappings = [
                {{
                    local-address = "{public_ip}"
                    public-address = "{public_ip}"
                }}
            ]
        }}
    }}
}}
'''
text = re.sub(r'\nice4j\s*\{(?:[^{}]|\{[^{}]*\})*\}\s*', '\n', text, flags=re.S)
path.write_text(text.rstrip() + "\n" + ice)
print("patched", path)
PY
fi

if [[ -f "$MEET_CONF" ]]; then
  cp -a "$MEET_CONF" "${MEET_CONF}.bak-${STAMP}"
  python3 - "$MEET_CONF" <<'PY'
from pathlib import Path
import re, sys
p = Path(sys.argv[1])
text = p.read_text()
text, n = re.subn(
    r'(^    p2p:\s*\{[\s\S]*?^\s*enabled:\s*)true',
    r'\1false',
    text,
    count=1,
    flags=re.M,
)
if not re.search(r'^\s*preferBosh:\s*true\b', text, flags=re.M):
    text = text.replace("var config = {", "var config = {\n    preferBosh: true,", 1)
p.write_text(text)
print("patched", p, "p2p_disabled", n)
PY
fi

mkdir -p /etc/systemd/system/jicofo.service.d
cat > /etc/systemd/system/jicofo.service.d/killmode.conf <<'EOF'
[Service]
KillMode=control-group
TimeoutStopSec=30
EOF
systemctl daemon-reload

echo "==> Restart native JVB so ICE harvest no longer advertises 172.18.0.1"
systemctl restart jitsi-videobridge2

if [[ -d "$COMPOSE_DIR" ]]; then
  echo "==> Remove leftover Docker Jitsi project (native stack remains)"
  (cd "$COMPOSE_DIR" && docker compose down) || true
fi

echo "==> After compose down, bounce JVB once more if docker bridge disappeared"
systemctl restart jitsi-videobridge2
systemctl is-active prosody jicofo jitsi-videobridge2 nginx
ss -lunp | grep 10000 || echo "WARNING: UDP 10000 not listening"
echo "Done. Run: python manage.py audit_jitsi_health"
