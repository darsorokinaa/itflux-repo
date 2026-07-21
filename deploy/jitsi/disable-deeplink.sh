#!/usr/bin/env bash
# sudo bash deploy/jitsi/disable-deeplink.sh
set -euo pipefail
DOMAIN="${1:-lesson.itflux-academy.ru}"
JS="/etc/jitsi/meet/${DOMAIN}-config.js"

cp -a "$JS" "${JS}.bak-deeplink-$(date +%Y%m%d%H%M%S)"

python3 - <<PY
from pathlib import Path
import re
p = Path("$JS")
t = p.read_text()

def upsert(src: str, key: str, value: str) -> str:
    # value — уже JS-литерал, напр. true
    pat = rf'(?m)^(\s*){re.escape(key)}\s*:'
    if re.search(pat, src):
        return re.sub(pat + r'[^,\n]*', rf'\1{key}: {value}', src, count=1)
    # вставить после "var config = {"
    return re.sub(
        r'(var\s+config\s*=\s*\{\s*\n)',
        rf'\1    {key}: {value},\n',
        src,
        count=1,
    )

for key, val in [
    ("disableDeepLinking", "true"),
    ("prejoinPageEnabled", "false"),
    ("prejoinConfig", "{ enabled: false }"),
    ("requireDisplayName", "false"),
    ("enableWelcomePage", "false"),
]:
    t = upsert(t, key, val)

# anonymousdomain — закомментировать, если активен
t = re.sub(
    r'(?m)^(\s*)anonymousdomain\s*:',
    r'\1// anonymousdomain:',
    t,
)

p.write_text(t)
print("updated", p)
for line in p.read_text().splitlines():
    if any(k in line for k in (
        "disableDeepLinking", "prejoinPageEnabled", "prejoinConfig",
        "requireDisplayName", "enableWelcomePage", "anonymousdomain",
    )):
        print(line)
PY

nginx -t && systemctl reload nginx || true
echo "OK. Откройте в инкогнито:"
echo "https://${DOMAIN}/itfluxdiagnosticroom001#config.disableDeepLinking=true&config.prejoinPageEnabled=false"
