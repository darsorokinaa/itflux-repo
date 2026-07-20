#!/usr/bin/env bash
# На сервере: bash fix-jwt-prosody.sh
# Синхронизирует Prosody JWT с Django (generator_test) и перезапускает prosody.
set -euo pipefail

DOMAIN="${1:-lesson.itflux-academy.ru}"
CFG="/etc/prosody/conf.d/${DOMAIN}.cfg.lua"
APP_ID="${JITSI_APP_ID:-generator_test}"
APP_SECRET="${JITSI_APP_SECRET:-y4vz0t7pmGM8uppejoQwhGxIZv1vtWF3}"

if [[ ! -f "$CFG" ]]; then
  echo "нет файла $CFG"
  ls -la /etc/prosody/conf.d/ || true
  exit 1
fi

cp -a "$CFG" "${CFG}.bak-$(date +%Y%m%d%H%M%S)"

python3 - <<PY
from pathlib import Path
import re
path = Path("$CFG")
text = path.read_text()
app_id = "$APP_ID"
app_secret = "$APP_SECRET"

def set_assign(src: str, key: str, value: str) -> str:
    # app_id="..." или app_id = "..."
    pat = rf'(^\s*{re.escape(key)}\s*=\s*)(["\']).*\2'
    repl = rf'\1"{value}"'
    new, n = re.subn(pat, repl, src, count=1, flags=re.M)
    if n:
        return new
    # вставить после authentication = "token"
    pat2 = r'(^\s*authentication\s*=\s*"token"[^\n]*\n)'
    insert = rf'\1    {key}="{value}"\n'
    new, n = re.subn(pat2, insert, src, count=1, flags=re.M)
    if n:
        return new
    raise SystemExit(f"не удалось прописать {key}")

text = set_assign(text, "app_id", app_id)
text = set_assign(text, "app_secret", app_secret)

# для диагностики временно разрешаем вход без токена (потом можно вернуть false)
if re.search(r'^\s*allow_empty_token\s*=', text, flags=re.M):
    text = re.sub(r'^\s*allow_empty_token\s*=\s*\w+', '    allow_empty_token = true', text, count=1, flags=re.M)
else:
    text = re.sub(
        r'(^\s*app_secret\s*=\s*["\'][^"\']*["\']\s*\n)',
        rf'\1    allow_empty_token = true\n',
        text,
        count=1,
        flags=re.M,
    )

path.write_text(text)
print("updated", path)
for line in path.read_text().splitlines():
    if re.search(r'app_id|app_secret|allow_empty_token|authentication', line):
        print(line)
PY

prosodyctl check config 2>&1 | tail -20 || true
systemctl restart prosody
sleep 2
systemctl is-active prosody
echo "OK: Prosody JWT = ${APP_ID} / (secret len ${#APP_SECRET}), allow_empty_token=true"
echo "Проверьте урок снова. Когда заработает — поставьте allow_empty_token = false"
