#!/usr/bin/env bash
# Включает Jitsi remote-control на native / Docker deployment
# и ставит мост команд из кабинета (iframe API).
# На сервере: sudo bash deploy/jitsi/enable-remote-control.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="${SCRIPT_DIR}/itflux-remote-control-bridge.js"
MARKER="itflux-remote-control-bridge.js"
TAG="<script src=\"libs/${MARKER}\"></script>"
DOMAIN="${1:-lesson.itflux-academy.ru}"

if [[ ! -f "$SRC" ]]; then
  echo "missing $SRC" >&2
  exit 1
fi

upsert_config_key() {
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
        r'(var\s+config\s*=\s*\{\s*\n)',
        rf'\1    {key}: {value},\n',
        text,
        count=1,
    )
path.write_text(text, encoding="utf-8")
print(f"  {key}: {value}  ({path})")
PY
}

install_script() {
  local root="$1"
  local dest="${root}/libs/${MARKER}"
  local index="${root}/index.html"
  mkdir -p "${root}/libs"
  cp "$SRC" "$dest"
  if [[ -f "$index" ]] && ! grep -q "$MARKER" "$index"; then
    cp -a "$index" "${index}.bak-rc-$(date +%Y%m%d%H%M%S)"
    python3 - "$index" "$TAG" <<'PY'
from pathlib import Path
import sys
path = Path(sys.argv[1])
tag = sys.argv[2]
text = path.read_text(encoding="utf-8")
if "itflux-remote-control-bridge.js" not in text:
    text = text.replace("</body>", f"    {tag}\n</body>", 1)
    path.write_text(text, encoding="utf-8")
print("patched", path)
PY
  fi
}

patched=0
NATIVE_ROOT="/usr/share/jitsi-meet"
if [[ -d "$NATIVE_ROOT" ]]; then
  echo "==> native $NATIVE_ROOT"
  install_script "$NATIVE_ROOT"
  patched=1
fi

NATIVE_CONFIG="/etc/jitsi/meet/${DOMAIN}-config.js"
if [[ -f "$NATIVE_CONFIG" ]]; then
  echo "==> $NATIVE_CONFIG"
  upsert_config_key "$NATIVE_CONFIG" "disableRemoteControl" "false"
  patched=1
fi

if [[ "$patched" -eq 0 ]]; then
  echo "Jitsi web root / config не найдены. Скопируйте $SRC в /usr/share/jitsi-meet/libs/ и выставьте disableRemoteControl: false."
  exit 1
fi

nginx -t && systemctl reload nginx || true
echo "OK. Remote control: config.disableRemoteControl=false + iframe bridge."
echo "Native input работает только в desktop-клиенте (jitsi-meet-electron-sdk)."
