#!/bin/sh
# Готовит конфиг LiveKit на ОТДЕЛЬНОМ VPS и по явному --apply запускает compose.
# Секреты не печатает. Firewall и DNS этот скрипт не меняет.
set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
ENV_FILE=${LIVEKIT_ENV_FILE:-/etc/livekit/livekit.env}
OUT=${LIVEKIT_CONFIG_OUT:-/etc/livekit/livekit.yaml}
DJANGO_HOST_IP=5.42.106.185
APPLY=0

if [ "${1:-}" = "--apply" ]; then
  APPLY=1
elif [ -n "${1:-}" ]; then
  echo "Использование: sudo sh deploy/livekit/install.sh [--apply]" >&2
  exit 2
fi

if [ -f /etc/systemd/system/itflux.service ] || [ -d /opt/itflux ]; then
  echo "На этом хосте признаки сервера Django. LiveKit сюда не ставим." >&2
  exit 1
fi

if [ ! -f "$ENV_FILE" ]; then
  echo "Нет $ENV_FILE. Скопируйте deploy/livekit/livekit.env.example и заполните его." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

: "${LIVEKIT_PUBLIC_IP:?LIVEKIT_PUBLIC_IP пуст}"
: "${LIVEKIT_DOMAIN:?LIVEKIT_DOMAIN пуст}"
: "${LIVEKIT_KEYS:?LIVEKIT_KEYS пуст}"

case "$LIVEKIT_PUBLIC_IP" in
  "$DJANGO_HOST_IP"|127.0.0.1|0.0.0.0|__PUBLIC_IP__)
    echo "LIVEKIT_PUBLIC_IP не подходит для отдельного узла." >&2
    exit 1
    ;;
esac

printf '%s\n' "$LIVEKIT_PUBLIC_IP" | grep -Eq '^[0-9]{1,3}(\.[0-9]{1,3}){3}$' || {
  echo "LIVEKIT_PUBLIC_IP должен быть IPv4." >&2
  exit 1
}
printf '%s\n' "$LIVEKIT_DOMAIN" | grep -Eq '^[A-Za-z0-9.-]+$' || {
  echo "LIVEKIT_DOMAIN содержит недопустимые символы." >&2
  exit 1
}

case "$LIVEKIT_DOMAIN" in
  *__TURN_DOMAIN__*|example.*|*example.ru*|localhost|"")
    echo "LIVEKIT_DOMAIN всё ещё пример. Подставьте постоянный домен видео." >&2
    exit 1
    ;;
esac

KEY_NAME=${LIVEKIT_KEYS%%:*}
KEY_SECRET=${LIVEKIT_KEYS#*:}
if [ "$KEY_NAME" = "$LIVEKIT_KEYS" ] || [ "${#KEY_SECRET}" -lt 32 ]; then
  echo "LIVEKIT_KEYS должен быть вида ключ: секрет, секрет не короче 32 символов." >&2
  exit 1
fi

if [ ! -s /etc/livekit/turn.crt ] || [ ! -s /etc/livekit/turn.key ]; then
  echo "Нет /etc/livekit/turn.crt или turn.key. TURN/TLS без своих сертификатов не включаем." >&2
  exit 1
fi

umask 077
mkdir -p /etc/livekit
sed \
  -e "s/__PUBLIC_IP__/${LIVEKIT_PUBLIC_IP}/g" \
  -e "s/__TURN_DOMAIN__/${LIVEKIT_DOMAIN}/g" \
  "$ROOT/livekit.yaml" > "$OUT"
chmod 644 "$OUT"
chmod 600 "$ENV_FILE" /etc/livekit/turn.key || true
unset LIVEKIT_KEYS KEY_SECRET KEY_NAME

echo "Конфиг записан в $OUT. Домен и IP подставлены, ключ в файл не попал."
echo "Проверьте, что в $OUT нет строки __PUBLIC_IP__ и нет секрета."
echo
echo "Firewall на этом VPS, вручную, после проверки адреса:"
echo "  ufw default deny incoming"
echo "  ufw allow 22/tcp"
echo "  ufw allow 443/tcp"
echo "  ufw allow 80/tcp"
echo "  ufw allow 7881/tcp"
echo "  ufw allow 50000:50200/udp"
echo "  ufw allow 3478/udp"
echo "  ufw allow 5349/tcp"
echo "  ufw deny 7880/tcp"
echo "  ufw deny 6789/tcp"
echo "Порт 7880 и метрики 6789 снаружи должны быть закрыты."
echo
echo "После старта: ss -ulpn | awk 'NR==1 || /:500/ {print}'"
echo "UDP 50000 должен слушать 0.0.0.0 или *, не только 127.0.0.1."
echo "sh $ROOT/healthcheck.sh"

if [ "$APPLY" -ne 1 ]; then
  echo
  echo "Контейнер не запущен. Повтор с --apply поднимет compose на этом хосте."
  exit 0
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "docker не установлен. Контейнер не запущен." >&2
  exit 1
fi

cd "$ROOT"
docker compose --env-file "$ENV_FILE" up -d
echo "compose up выполнен. Health: sh $ROOT/healthcheck.sh"
