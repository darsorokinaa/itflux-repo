#!/usr/bin/env bash
# На сервере: sudo bash /opt/itflux/deploy/jitsi/fix-jwt-prosody.sh
# Синхронизирует Prosody JWT с Django (JITSI_APP_ID / JITSI_APP_SECRET) и перезапускает prosody.
#
# Канонические значения для lesson.itflux-academy.ru:
#   JITSI_APP_ID=generator_test
#   JITSI_SUB=lesson.itflux-academy.ru
#   JITSI_APP_SECRET — тот же, что в Generator/.env
#
# По умолчанию allow_empty_token=false (иначе учитель входит анонимно → «Я организатор»).
# Диагностика: ALLOW_EMPTY_TOKEN=1 sudo bash deploy/jitsi/fix-jwt-prosody.sh
set -euo pipefail

DOMAIN="${1:-lesson.itflux-academy.ru}"
CFG="/etc/prosody/conf.d/${DOMAIN}.cfg.lua"
ALLOW_EMPTY_TOKEN="${ALLOW_EMPTY_TOKEN:-0}"
if [[ "$ALLOW_EMPTY_TOKEN" == "1" || "$ALLOW_EMPTY_TOKEN" == "true" ]]; then
  ALLOW_EMPTY_LUA="true"
else
  ALLOW_EMPTY_LUA="false"
fi

# Ищем Generator/.env рядом с репозиторием или в типовых путях.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CANDIDATE_ENVS=(
  "${JITSI_DJANGO_ENV:-}"
  "${SCRIPT_DIR}/../../Generator/.env"
  "${SCRIPT_DIR}/../../Generator/Generator/.env"
  "/opt/itflux/Generator/.env"
  "/opt/itfluxacademy/itflux/Generator/.env"
)

load_env_var() {
  local key="$1" file="$2"
  [[ -n "$file" && -f "$file" ]] || return 1
  local line
  line="$(grep -E "^${key}=" "$file" | tail -1 || true)"
  [[ -n "$line" ]] || return 1
  printf '%s' "${line#*=}"
}

DJANGO_ENV=""
for f in "${CANDIDATE_ENVS[@]}"; do
  [[ -n "$f" && -f "$f" ]] || continue
  DJANGO_ENV="$f"
  break
done

APP_ID="${JITSI_APP_ID:-}"
APP_SECRET="${JITSI_APP_SECRET:-}"

if [[ -z "$APP_ID" && -n "$DJANGO_ENV" ]]; then
  APP_ID="$(load_env_var JITSI_APP_ID "$DJANGO_ENV" || true)"
fi
if [[ -z "$APP_SECRET" && -n "$DJANGO_ENV" ]]; then
  APP_SECRET="$(load_env_var JITSI_APP_SECRET "$DJANGO_ENV" || true)"
fi

APP_ID="${APP_ID:-generator_test}"

if [[ -z "$APP_SECRET" ]]; then
  echo "ERROR: не задан JITSI_APP_SECRET."
  echo "Экспортируйте переменную или положите её в Generator/.env (рядом с manage.py)."
  echo "Найденный .env: ${DJANGO_ENV:-нет}"
  exit 1
fi

if [[ ! -f "$CFG" ]]; then
  echo "нет файла $CFG"
  ls -la /etc/prosody/conf.d/ || true
  exit 1
fi

# token_affiliation читает context.user.affiliation / moderator из JWT.
AFFILIATION_PLUGIN="/usr/share/jitsi-meet/prosody-plugins/mod_token_affiliation.lua"
if [[ ! -f "$AFFILIATION_PLUGIN" ]]; then
  echo "Installing mod_token_affiliation.lua → $AFFILIATION_PLUGIN"
  curl -fsSL -o "$AFFILIATION_PLUGIN" \
    "https://raw.githubusercontent.com/jitsi-contrib/prosody-plugins/main/token_affiliation/mod_token_affiliation.lua" \
    || echo "WARN: не удалось скачать token_affiliation — установите вручную"
fi

echo "Django .env: ${DJANGO_ENV:-не найден (используются env/defaults)}"
echo "Prosody cfg: $CFG"
echo "APP_ID: $APP_ID (secret len ${#APP_SECRET})"
echo "allow_empty_token: $ALLOW_EMPTY_LUA"

cp -a "$CFG" "${CFG}.bak-$(date +%Y%m%d%H%M%S)"

python3 - <<PY
from pathlib import Path
import re
path = Path("$CFG")
text = path.read_text()
app_id = """$APP_ID"""
app_secret = """$APP_SECRET"""
allow_empty = """$ALLOW_EMPTY_LUA"""
domain = """$DOMAIN"""

def set_assign(src: str, key: str, value: str) -> str:
    pat = rf'(^\s*{re.escape(key)}\s*=\s*)(["\']).*\2'
    repl = rf'\1"{value}"'
    new, n = re.subn(pat, repl, src, count=1, flags=re.M)
    if n:
        return new
    pat2 = r'(^\s*authentication\s*=\s*"token"[^\n]*\n)'
    insert = rf'\1    {key}="{value}"\n'
    new, n = re.subn(pat2, insert, src, count=1, flags=re.M)
    if n:
        return new
    raise SystemExit(f"не удалось прописать {key}")

# Главный VirtualHost должен быть authentication = "token".
# Если остаётся anonymous — кабинет шлёт JWT, а Prosody его не принимает.
vh_pat = rf'VirtualHost\s+"{re.escape(domain)}"'
if re.search(vh_pat, text):
    m = re.search(
        rf'(VirtualHost\s+"{re.escape(domain)}"\s*\n)(.*?)(?=\nVirtualHost|\nComponent|\Z)',
        text,
        flags=re.S,
    )
    if m:
        head, body = m.group(1), m.group(2)
        if re.search(r'^\s*authentication\s*=', body, flags=re.M):
            body = re.sub(
                r'^\s*authentication\s*=\s*["\'][^"\']*["\']',
                '    authentication = "token"',
                body,
                count=1,
                flags=re.M,
            )
        else:
            body = '    authentication = "token"\n' + body
        text = text[:m.start()] + head + body + text[m.end():]
        print(f'set main VirtualHost authentication = "token"')
    else:
        print(f'WARN: не удалось найти блок VirtualHost {domain}')
else:
    print(f'WARN: VirtualHost "{domain}" не найден')

text = set_assign(text, "app_id", app_id)
text = set_assign(text, "app_secret", app_secret)

# false = JWT обязателен; true только для диагностики MUC (иначе «Я организатор»).
if re.search(r'^\s*allow_empty_token\s*=', text, flags=re.M):
    text = re.sub(
        r'^\s*allow_empty_token\s*=\s*\w+',
        f'    allow_empty_token = {allow_empty}',
        text,
        count=1,
        flags=re.M,
    )
else:
    text = re.sub(
        r'(^\s*app_secret\s*=\s*["\'][^"\']*["\']\s*\n)',
        rf'\1    allow_empty_token = {allow_empty}\n',
        text,
        count=1,
        flags=re.M,
    )

# Включить token_affiliation в MUC conference.* — иначе affiliation/moderator из JWT игнорируются.
muc_re = re.compile(
    rf'(Component\s+"conference\.{re.escape(domain)}"\s+"muc"\s*\n)(.*?)(?=\nComponent|\nVirtualHost|\Z)',
    flags=re.S,
)
muc_m = muc_re.search(text)
if muc_m:
    head, body = muc_m.group(1), muc_m.group(2)
    if "token_affiliation" not in body:
        if re.search(r'modules_enabled\s*=\s*\{', body):
            body = re.sub(
                r'(modules_enabled\s*=\s*\{)',
                r'\1\n        "token_affiliation";',
                body,
                count=1,
            )
            print("added token_affiliation to conference MUC modules_enabled")
        else:
            body = (
                '    modules_enabled = {\n'
                '        "token_verification";\n'
                '        "token_affiliation";\n'
                "    }\n"
            ) + body
            print("created modules_enabled with token_affiliation on conference MUC")
    if "wait_for_host_disable_auto_owners" not in body:
        body += "\n    wait_for_host_disable_auto_owners = true\n"
        print("set wait_for_host_disable_auto_owners = true")
    text = text[:muc_m.start()] + head + body + text[muc_m.end():]
else:
    print(f'WARN: Component "conference.{domain}" "muc" не найден — добавьте token_affiliation вручную')

# Гостевой VirtualHost + JWT часто даёт «каждый один в комнате» (auth vs guest MUC).
text = re.sub(
    r'(^\s*VirtualHost\s+"guest\.[^"]+"\s*\n(?:.*\n)*?)(^\s*authentication\s*=\s*"jitsi-anonymous")',
    r'\1-- disabled to keep JWT users in one MUC:\n    -- \2',
    text,
    count=1,
    flags=re.M,
)

path.write_text(text)
print("updated", path)
for line in path.read_text().splitlines():
    if re.search(r'app_id|allow_empty_token|authentication|VirtualHost|token_affiliation|wait_for_host', line) and "app_secret" not in line:
        print(line)
    elif re.search(r'^\s*app_secret\s*=', line):
        print('    app_secret="***"')
PY

# Docker Jitsi: выключить гостей в .env, иначе JWT-учитель и «guest»-ученик в разных MUC.
for COMPOSE_ENV in /opt/jitsi/docker-jitsi-meet/.env /opt/docker-jitsi-meet/.env; do
  if [[ -f "$COMPOSE_ENV" ]]; then
    echo "Docker env: $COMPOSE_ENV"
    if grep -qE '^ENABLE_GUESTS=' "$COMPOSE_ENV"; then
      sed -i 's/^ENABLE_GUESTS=.*/ENABLE_GUESTS=0/' "$COMPOSE_ENV"
    else
      echo 'ENABLE_GUESTS=0' >> "$COMPOSE_ENV"
    fi
    if grep -qE '^JWT_APP_ID=' "$COMPOSE_ENV"; then
      sed -i "s/^JWT_APP_ID=.*/JWT_APP_ID=${APP_ID}/" "$COMPOSE_ENV"
    else
      echo "JWT_APP_ID=${APP_ID}" >> "$COMPOSE_ENV"
    fi
    if grep -qE '^JWT_APP_SECRET=' "$COMPOSE_ENV"; then
      sed -i "s/^JWT_APP_SECRET=.*/JWT_APP_SECRET=${APP_SECRET}/" "$COMPOSE_ENV"
    else
      echo "JWT_APP_SECRET=${APP_SECRET}" >> "$COMPOSE_ENV"
    fi
    (cd "$(dirname "$COMPOSE_ENV")" && docker compose up -d) || true
  fi
done

# Роль организатора из JWT: Jicofo не должен сам назначать первого вошедшего owner'ом.
if command -v hocon >/dev/null 2>&1 && [[ -f /etc/jitsi/jicofo/jicofo.conf ]]; then
  hocon -f /etc/jitsi/jicofo/jicofo.conf set jicofo.conference.enable-auto-owner false || true
  echo "jicofo.conference.enable-auto-owner = false"
fi

prosodyctl check config 2>&1 | tail -20 || true
systemctl restart prosody 2>/dev/null || true
systemctl restart jicofo 2>/dev/null || true
sleep 2
systemctl is-active prosody 2>/dev/null || true
systemctl is-active jicofo 2>/dev/null || true
echo "OK: Prosody JWT app_id=${APP_ID} синхронизирован с Django."
echo "Важно: JITSI_APP_SECRET в Generator/.env платформы = app_secret Prosody."
echo "В Generator/.env должно быть:"
echo "  JITSI_DOMAIN=${DOMAIN}"
echo "  JITSI_AUTH_MODE=jwt"
echo "  JITSI_APP_ID=${APP_ID}"
echo "  JITSI_SUB=${DOMAIN}"
echo "Затем: sudo systemctl restart itflux"
if [[ "$ALLOW_EMPTY_LUA" == "true" ]]; then
  echo "WARN: allow_empty_token=true — после проверки снова запустите скрипт без ALLOW_EMPTY_TOKEN."
fi
