#!/usr/bin/env bash
# Скрывает логотип/надпись Jitsi в видеокомнате.
# На сервере: sudo bash deploy/jitsi/hide-branding.sh
set -euo pipefail

DOMAIN="${1:-lesson.itflux-academy.ru}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CUSTOM_IFACE="${SCRIPT_DIR}/custom-interface_config.js"
APP_NAME="${JITSI_APP_NAME:-Цифровой поток}"

upsert_js_key() {
  python3 - "$1" "$2" "$3" <<'PY'
from pathlib import Path
import re
import sys

path = Path(sys.argv[1])
key = sys.argv[2]
value = sys.argv[3]
text = path.read_text(encoding="utf-8")
pat = rf'(?m)^(\s*){re.escape(key)}\s*:'
if re.search(pat, text):
    text = re.sub(pat + r'[^,\n]*', rf'\1{key}: {value}', text, count=1)
else:
    text = re.sub(
        r'(var\s+interfaceConfig\s*=\s*\{\s*\n)',
        rf'\1    {key}: {value},\n',
        text,
        count=1,
    )
path.write_text(text, encoding="utf-8")
print(f"  {key}: {value}  ({path})")
PY
}

patched=0

NATIVE_IFACE="/usr/share/jitsi-meet/interface_config.js"
if [[ -f "$NATIVE_IFACE" ]]; then
  cp -a "$NATIVE_IFACE" "${NATIVE_IFACE}.bak-branding-$(date +%Y%m%d%H%M%S)"
  echo "==> native $NATIVE_IFACE"
  upsert_js_key "$NATIVE_IFACE" "SHOW_JITSI_WATERMARK" "false"
  upsert_js_key "$NATIVE_IFACE" "SHOW_WATERMARK_FOR_GUESTS" "false"
  upsert_js_key "$NATIVE_IFACE" "SHOW_BRAND_WATERMARK" "false"
  upsert_js_key "$NATIVE_IFACE" "SHOW_POWERED_BY" "false"
  upsert_js_key "$NATIVE_IFACE" "APP_NAME" "'${APP_NAME}'"
  upsert_js_key "$NATIVE_IFACE" "NATIVE_APP_NAME" "'${APP_NAME}'"
  upsert_js_key "$NATIVE_IFACE" "PROVIDER_NAME" "'${APP_NAME}'"
  upsert_js_key "$NATIVE_IFACE" "DEFAULT_LOGO_URL" "''"
  upsert_js_key "$NATIVE_IFACE" "DEFAULT_WELCOME_PAGE_LOGO_URL" "''"
  upsert_js_key "$NATIVE_IFACE" "JITSI_WATERMARK_LINK" "''"
  patched=1
fi

NATIVE_CONFIG="/etc/jitsi/meet/${DOMAIN}-config.js"
if [[ -f "$NATIVE_CONFIG" ]]; then
  python3 - "$NATIVE_CONFIG" <<'PY'
from pathlib import Path
import re
import sys

p = Path(sys.argv[1])
t = p.read_text(encoding="utf-8")
key, value = "defaultLogoUrl", "''"
pat = rf'(?m)^(\s*){re.escape(key)}\s*:'
if re.search(pat, t):
    t = re.sub(pat + r'[^,\n]*', rf'\1{key}: {value}', t, count=1)
else:
    t = re.sub(
        r'(var\s+config\s*=\s*\{\s*\n)',
        rf'\1    {key}: {value},\n',
        t,
        count=1,
    )
p.write_text(t, encoding="utf-8")
print("updated", p, "defaultLogoUrl")
PY
  patched=1
fi

DOCKER_ENV="${JITSI_DIR:-/opt/jitsi/docker-jitsi-meet}/.env"
CFG_DIR=""
if [[ -f "$DOCKER_ENV" ]]; then
  CFG_DIR="$(grep -E '^CONFIG=' "$DOCKER_ENV" | tail -1 | cut -d= -f2- || true)"
fi
CFG_DIR="${CFG_DIR:-${CONFIG_DIR:-/root/.jitsi-meet-cfg}}"
DOCKER_WEB="${CFG_DIR}/web"
if [[ -d "$DOCKER_WEB" && -f "$CUSTOM_IFACE" ]]; then
  echo "==> docker $DOCKER_WEB/custom-interface_config.js"
  cp "$CUSTOM_IFACE" "$DOCKER_WEB/custom-interface_config.js"
  if [[ -f "$DOCKER_WEB/interface_config.js" ]]; then
    if ! grep -q "SHOW_JITSI_WATERMARK = false" "$DOCKER_WEB/interface_config.js"; then
      cat "$CUSTOM_IFACE" >> "$DOCKER_WEB/interface_config.js"
    fi
  fi
  if [[ -d "${JITSI_DIR:-/opt/jitsi/docker-jitsi-meet}" ]]; then
    (cd "${JITSI_DIR:-/opt/jitsi/docker-jitsi-meet}" && docker compose restart web) || true
  fi
  patched=1
fi

if [[ "$patched" -eq 0 ]]; then
  echo "Не найден ни native interface_config.js, ни Docker CONFIG/web."
  echo "Положите custom-interface_config.js в ~/.jitsi-meet-cfg/web/ и перезапустите web."
  exit 1
fi

nginx -t && systemctl reload nginx || true
echo "OK. Обновите страницу урока (лучше инкогнито) — логотип Jitsi должен пропасть."
