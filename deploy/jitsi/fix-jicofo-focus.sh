#!/usr/bin/env bash
# Чинит service-unavailable / conferenceRequestFailed на focus.<domain>
# На сервере:
#   sudo bash /opt/itfluxacademy/itflux/deploy/jitsi/fix-jicofo-focus.sh
set -euo pipefail

DOMAIN="${1:-lesson.itflux-academy.ru}"
PROSODY_CFG="/etc/prosody/conf.d/${DOMAIN}.cfg.lua"
JICOFO_CFG="/etc/jitsi/jicofo/jicofo.conf"
SIP="/etc/jitsi/jicofo/sip-communicator.properties"

echo "==> services"
for s in prosody jicofo jitsi-videobridge2 nginx; do
  printf '  %-22s %s\n' "$s" "$(systemctl is-active "$s" 2>/dev/null || echo missing)"
done

echo
echo "==> focus / auth lines in Prosody"
grep -nE 'VirtualHost|Component|focus|authentication|jicofo' "$PROSODY_CFG" 2>/dev/null | head -60 || true

echo
echo "==> focus account"
prosodyctl status 2>&1 | head -20 || true
ls -la /var/lib/prosody/*/accounts/focus* 2>/dev/null | head -10 || true

echo
echo "==> jicofo recent log"
journalctl -u jicofo -n 80 --no-pager 2>/dev/null | tail -80 || true

echo
echo "==> Ensure focus user exists (auth.${DOMAIN})"
# Типичный пароль лежит в /etc/jitsi/jicofo/jicofo.conf или sip-communicator.properties
FOCUS_PASS=""
if [[ -f "$JICOFO_CFG" ]]; then
  FOCUS_PASS="$(grep -oE 'password\s*=\s*"[^"]+"' "$JICOFO_CFG" | head -1 | sed 's/.*"\([^"]*\)"/\1/' || true)"
fi
if [[ -z "$FOCUS_PASS" && -f "$SIP" ]]; then
  FOCUS_PASS="$(grep -E 'FOCUS_USER_PASSWORD|org.jitsi.jicofo.auth' "$SIP" | head -1 | cut -d= -f2- || true)"
fi

if [[ -n "$FOCUS_PASS" ]]; then
  echo "registering focus@auth.${DOMAIN}"
  prosodyctl register focus "auth.${DOMAIN}" "$FOCUS_PASS" 2>&1 || \
    prosodyctl passwd "focus@auth.${DOMAIN}" <<EOF || true
$FOCUS_PASS
$FOCUS_PASS
EOF
else
  echo "WARN: не удалось извлечь пароль focus — проверьте jicofo.conf вручную"
fi

echo
echo "==> restart jicofo + prosody"
systemctl restart prosody
sleep 1
systemctl restart jicofo
sleep 2
systemctl is-active prosody jicofo jitsi-videobridge2

echo
echo "==> jicofo after restart"
journalctl -u jicofo -n 40 --no-pager 2>/dev/null | tail -40 || true

echo
echo "Проверка: откройте в двух инкогнито"
echo "  https://${DOMAIN}/finaldirecttest20260720#config.prejoinPageEnabled=false&config.disableDeepLinking=true"
echo "В Console НЕ должно быть: service-unavailable / conferenceRequestFailed"
echo "Счётчик участников должен стать 2."
