#!/usr/bin/env bash
# sudo bash deploy/jitsi/check-join-button.sh
set -euo pipefail
DOMAIN="${1:-lesson.itflux-academy.ru}"
JS="/etc/jitsi/meet/${DOMAIN}-config.js"
CFG="/etc/prosody/conf.d/${DOMAIN}.cfg.lua"

echo "=== config.js: subdomain/subdir/prejoin/lobby ==="
grep -nE 'subdir|subdomain|prejoin|lobby|disableDeepLinking|requireDisplayName|anonymousdomain|hosts:|bosh:|websocket:|muc:' "$JS" | head -80

echo
echo "=== syntax smoke (node) ==="
if command -v node >/dev/null; then
  node -e "
const fs=require('fs');
let t=fs.readFileSync('$JS','utf8');
// грубая проверка скобок
let a=(t.match(/\{/g)||[]).length, b=(t.match(/\}/g)||[]).length;
console.log('braces', a, b, a===b?'OK':'MISMATCH');
" || true
else
  echo "node not installed, skip"
fi

echo
echo "=== jicofo / prosody recent errors ==="
journalctl -u jicofo -n 40 --no-pager 2>/dev/null | tail -40 || true
echo "---"
journalctl -u prosody -n 40 --no-pager 2>/dev/null | tail -40 || true

echo
echo "=== focus user ==="
prosodyctl status 2>&1 | head -20 || true
ls -la /var/lib/prosody/*/accounts/focus* 2>/dev/null | head -10 || true

echo
echo "=== test URL (без prejoin) ==="
echo "https://${DOMAIN}/itfluxdiagnosticroom001#config.prejoinPageEnabled=false&config.prejoinConfig.enabled=false&config.disableDeepLinking=true"
