#!/usr/bin/env bash
# Проверка Prosody на отдельной комнате auditprobe*, без уроков платформы.
# В комнату не входит: только SASL, затем terminate. Токен и секрет не печатает.
#
# На сервере, когда нет реальных конференций в этой комнате:
#   sudo JITSI_JWT_PROBE=1 bash deploy/jitsi/probe-jwt-isolation.sh
# cron, systemd и deploy/update.sh этот файл не вызывают.
# С рабочей машины аудита не запускать: здесь нет секрета Prosody.
set -euo pipefail

DOMAIN="${1:-lesson.itflux-academy.ru}"
CFG="/etc/prosody/conf.d/${DOMAIN}.cfg.lua"

if [[ "${JITSI_JWT_PROBE:-0}" != "1" ]]; then
  echo "Сухой режим. Живой Prosody отсюда не вызывается."
  echo "На сервере: sudo JITSI_JWT_PROBE=1 bash $0"
  exit 0
fi

if [[ ! -f "$CFG" ]]; then
  echo "STOP: нет ${CFG}. Это не сервер Jitsi, проверку не начинаем."
  exit 1
fi

python3 - "$DOMAIN" "$CFG" <<'PY'
import base64, json, os, re, sys, time, urllib.request
from pathlib import Path

domain, cfg_path = sys.argv[1], sys.argv[2]
text = Path(cfg_path).read_text()

def lua_string(key):
    m = re.search(rf'(?m)^\s*{key}\s*=\s*"([^"]*)"', text)
    return m.group(1) if m else ""

secret = os.environ.get("JITSI_APP_SECRET", "").strip() or lua_string("app_secret")
app_id = os.environ.get("JITSI_APP_ID", "").strip() or lua_string("app_id") or "generator_test"
if not secret:
    print("STOP: app_secret не найден, токен не создаём")
    sys.exit(1)

def b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()

def sign(payload: dict, key: str) -> str:
    header = b64(json.dumps({"alg": "HS256", "typ": "JWT", "kid": app_id}).encode())
    body = b64(json.dumps(payload, separators=(",", ":")).encode())
    import hmac, hashlib
    sig = b64(hmac.new(key.encode(), f"{header}.{body}".encode(), hashlib.sha256).digest())
    return f"{header}.{body}.{sig}"

now = int(time.time())
room_ok = "auditprobe" + os.urandom(4).hex()
room_other = "auditprobe" + os.urandom(4).hex()

def claims(room, exp, moderator="false", drop=()):
    payload = {
        "aud": "jitsi",
        "iss": app_id,
        "sub": domain,
        "room": room,
        "iat": now - 10,
        "nbf": now - 30,
        "exp": exp,
        "context": {"user": {"id": "0", "name": "probe", "moderator": moderator, "affiliation": "member"}},
    }
    for key in drop:
        payload.pop(key, None)
    return payload

cases = [
    ("valid_room", sign(claims(room_ok, now + 300), secret), "auth_success"),
    ("other_room_token_still_sasl", sign(claims(room_other, now + 300), secret), "auth_success"),
    ("expired", sign(claims(room_ok, now - 600), secret), "reject"),
    ("bad_signature", sign(claims(room_ok, now + 300), "not-the-server-secret"), "reject"),
    ("missing_room", sign(claims(room_ok, now + 300, drop=("room",)), secret), "reject"),
    ("no_token", "", "reject"),
]

def post(url, xml):
    req = urllib.request.Request(
        url,
        data=xml.encode(),
        method="POST",
        headers={"Content-Type": "text/xml; charset=utf-8", "User-Agent": "itflux-jwt-probe"},
    )
    with urllib.request.urlopen(req, timeout=12) as res:
        return res.read(4000).decode("utf-8", "replace")

def classify(body: str) -> str:
    low = body.lower()
    if "<success" in low:
        return "auth_success"
    if "<failure" in low or "not-allowed" in low or "invalid" in low:
        return "reject"
    return "other"

failed = 0
for label, token, expected in cases:
    query = ("?token=" + token) if token else ""
    url = f"https://{domain}/http-bind{query}"
    rid = int(time.time() * 1000) % 1000000000
    first = (
        f"<body rid='{rid}' xmlns='http://jabber.org/protocol/httpbind' to='{domain}' "
        "xml:lang='en' wait='5' hold='1' ver='1.6' xmpp:version='1.0' "
        "xmlns:xmpp='urn:xmpp:xbosh'/>"
    )
    opened = post(url, first)
    sid_match = re.search(r"sid=['\"]([^'\"]+)", opened)
    if not sid_match:
        print(f"{label} BLOCKED no_sid")
        failed += 1
        continue
    sid = sid_match.group(1)
    rid += 1
    auth = (
        f"<body rid='{rid}' sid='{sid}' xmlns='http://jabber.org/protocol/httpbind'>"
        "<auth xmlns='urn:ietf:params:xml:ns:xmpp-sasl' mechanism='ANONYMOUS'/>"
        "</body>"
    )
    result = classify(post(url, auth))
    rid += 1
    post(url, f"<body rid='{rid}' sid='{sid}' type='terminate' xmlns='http://jabber.org/protocol/httpbind'/>")
    ok = result == expected
    print(f"{label} {result} expected={expected} {'PASS' if ok else 'FAIL'}")
    if not ok:
        failed += 1

print("room_claim_at_muc NOT_TESTED")
print("role_at_muc NOT_TESTED")
print("presence_not_sent")
sys.exit(1 if failed else 0)
PY
