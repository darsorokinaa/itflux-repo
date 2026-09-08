#!/usr/bin/env bash
# Ставит helper геометрии screen share внутрь native / Docker Jitsi.
# На сервере: sudo bash deploy/jitsi/install-screenshare-geometry-bridge.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="${SCRIPT_DIR}/itflux-screenshare-geometry.js"
MARKER="itflux-screenshare-geometry.js"
TAG="<script src=\"libs/${MARKER}\"></script>"

if [[ ! -f "$SRC" ]]; then
  echo "missing $SRC" >&2
  exit 1
fi

install_native() {
  local root="/usr/share/jitsi-meet"
  local dest="${root}/libs/${MARKER}"
  local index="${root}/index.html"
  if [[ ! -d "$root" ]]; then
    return 1
  fi
  echo "==> native $dest"
  mkdir -p "${root}/libs"
  cp "$SRC" "$dest"
  if [[ -f "$index" ]] && ! grep -q "$MARKER" "$index"; then
    cp -a "$index" "${index}.bak-ss-geom-$(date +%Y%m%d%H%M%S)"
    if grep -q "</body>" "$index"; then
      python3 - "$index" "$TAG" <<'PY'
from pathlib import Path
import sys
path = Path(sys.argv[1])
tag = sys.argv[2]
text = path.read_text(encoding="utf-8")
if "itflux-screenshare-geometry.js" not in text:
    text = text.replace("</body>", f"    {tag}\n</body>", 1)
    path.write_text(text, encoding="utf-8")
print("patched", path)
PY
    fi
  fi
  return 0
}

install_docker() {
  local env_file="${JITSI_DIR:-/opt/jitsi/docker-jitsi-meet}/.env"
  local cfg=""
  if [[ -f "$env_file" ]]; then
    cfg="$(grep -E '^CONFIG=' "$env_file" | tail -1 | cut -d= -f2- || true)"
  fi
  cfg="${cfg:-${CONFIG_DIR:-/root/.jitsi-meet-cfg}}"
  local web="${cfg}/web"
  if [[ ! -d "$web" ]]; then
    return 1
  fi
  echo "==> docker $web/libs/${MARKER}"
  mkdir -p "${web}/libs"
  cp "$SRC" "${web}/libs/${MARKER}"
  local index="${web}/index.html"
  if [[ -f "$index" ]] && ! grep -q "$MARKER" "$index"; then
    python3 - "$index" "$TAG" <<'PY'
from pathlib import Path
import sys
path = Path(sys.argv[1])
tag = sys.argv[2]
text = path.read_text(encoding="utf-8")
if "itflux-screenshare-geometry.js" not in text:
    text = text.replace("</body>", f"    {tag}\n</body>", 1)
    path.write_text(text, encoding="utf-8")
print("patched", path)
PY
  fi
  if [[ -d "${JITSI_DIR:-/opt/jitsi/docker-jitsi-meet}" ]]; then
    (cd "${JITSI_DIR:-/opt/jitsi/docker-jitsi-meet}" && docker compose restart web) || true
  fi
  return 0
}

patched=0
install_native && patched=1 || true
install_docker && patched=1 || true

if [[ "$patched" -eq 0 ]]; then
  echo "Jitsi web root не найден. Скопируйте $SRC в /usr/share/jitsi-meet/libs/ и подключите в index.html."
  exit 1
fi

nginx -t && systemctl reload nginx || true
echo "OK. Обновите урок (лучше инкогнито). В DEV: localStorage itflux.ann.debug=1 — рамки geometry."
