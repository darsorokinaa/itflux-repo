#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Локальный запуск: ЛК (кабинет) + Генератор
#
#   Генератор Django  →  http://localhost:8000   (Daphne ASGI)
#   Генератор Vite    →  http://localhost:5000   ← открывать в браузере
#   ЛК Django         →  http://localhost:8001   (Daphne ASGI)
#   ЛК React          →  http://localhost:3000   ← открывать в браузере
#
# Поток «урок»:
#   ЛК (3000) → POST /api/lesson/token/ → ссылка http://localhost:5000/lesson/join/?token=...
#   Генератор (8000) проверяет токен тем же LESSON_SECRET → lesson_room.html
# ─────────────────────────────────────────────────────────────────────────────

set -e

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
LK_DIR="$(cd "$ROOT_DIR/../02_lk_generator" && pwd)"

log()  { echo "$(date '+%H:%M:%S') │ $*"; }
warn() { echo "$(date '+%H:%M:%S') ⚠  $*"; }
die()  { echo "ОШИБКА: $*" >&2; exit 1; }

# ── 0. Проверка наличия папок ─────────────────────────────────────────────────
[ -d "$ROOT_DIR" ]                  || die "Папка генератора не найдена: $ROOT_DIR"
[ -d "$LK_DIR" ]                    || die "Папка ЛК не найдена: $LK_DIR (ожидается ../02_lk_generator)"
[ -f "$LK_DIR/Cabinet/manage.py" ]  || die "ЛК manage.py не найден: $LK_DIR/Cabinet/manage.py"

# ── 0b. Освобождение портов (убиваем старые процессы) ────────────────────────
for PORT in 8000 8001 3000 5000 5001; do
    PIDS_ON_PORT=$(lsof -ti tcp:$PORT 2>/dev/null || true)
    if [ -n "$PIDS_ON_PORT" ]; then
        log "Освобождаем порт $PORT (pid: $PIDS_ON_PORT)…"
        kill $PIDS_ON_PORT 2>/dev/null || true
    fi
done
sleep 1

# ── 1. Виртуальные окружения ──────────────────────────────────────────────────
GEN_VENV="$ROOT_DIR/.venv"
LK_VENV="$LK_DIR/.venv"

log "Проверка venv генератора…"
if [ ! -f "$GEN_VENV/bin/python" ]; then
    log "Создаём venv генератора…"
    python3 -m venv "$GEN_VENV"
    "$GEN_VENV/bin/pip" install -q --upgrade pip
    "$GEN_VENV/bin/pip" install -q -r "$ROOT_DIR/requirements.txt"
fi
GEN_PY="$GEN_VENV/bin/python"

log "Проверка venv ЛК…"
if [ ! -f "$LK_VENV/bin/python" ]; then
    log "Создаём venv ЛК…"
    python3 -m venv "$LK_VENV"
    "$LK_VENV/bin/pip" install -q --upgrade pip
    "$LK_VENV/bin/pip" install -q -r "$LK_DIR/Cabinet/requirements.txt"
else
    # Проверим что python-dotenv установлен (добавили позже)
    "$LK_VENV/bin/pip" install -q python-dotenv 2>/dev/null || true
fi
LK_PY="$LK_VENV/bin/python"

# ── 2. Node-зависимости ───────────────────────────────────────────────────────
log "Проверка node_modules генератора…"
[ -d "$ROOT_DIR/frontend/node_modules" ] || (cd "$ROOT_DIR/frontend" && npm install --silent)

log "Проверка node_modules ЛК…"
[ -d "$LK_DIR/frontend/node_modules" ]   || (cd "$LK_DIR/frontend" && npm install --silent)

# ── 3. Миграции ───────────────────────────────────────────────────────────────
log "Миграции генератора…"
(cd "$ROOT_DIR/Generator" && "$GEN_PY" manage.py migrate --noinput 2>&1 | grep -v "^No migrations\|^Operations\|^Apply\|Applying")

log "Миграции ЛК…"
(cd "$LK_DIR/Cabinet" && "$LK_PY" manage.py migrate --noinput 2>&1 | grep -v "^No migrations\|^Operations\|^Apply\|Applying")

# ── 4. Запуск процессов ───────────────────────────────────────────────────────
PIDS=()
cleanup() {
    echo ""
    log "Остановка всех процессов…"
    for pid in "${PIDS[@]}"; do
        kill "$pid" 2>/dev/null || true
    done
    wait 2>/dev/null
}
trap cleanup EXIT INT TERM

# 4a. Генератор — Daphne на 8000
log "Запуск: Генератор Django → :8000"
(
  cd "$ROOT_DIR/Generator"
  LK_PUBLIC_URL=http://localhost:3000 \
  LK_LESSON_NOTIFY_URL=http://127.0.0.1:8001/api/lesson/teacher-joined/ \
  DJANGO_SETTINGS_MODULE=Generator.settings \
  CHANNEL_LAYER_BACKEND=inmemory \
  "$GEN_PY" -m daphne -b 127.0.0.1 -p 8000 Generator.asgi:application 2>&1 \
  | grep --line-buffered -v "^$\|HTTP/2 support\|Configuring endpoint\|Starting server" \
  | sed 's/^/\o033[36m[gen]\o033[0m /'
) &
PIDS+=($!)
sleep 2

# 4b. ЛК — Daphne на 8001
log "Запуск: ЛК Django → :8001"
(
  cd "$LK_DIR/Cabinet"
  DJANGO_SETTINGS_MODULE=Cabinet.settings \
  "$LK_PY" -m daphne -b 127.0.0.1 -p 8001 Cabinet.asgi:application 2>&1 \
  | grep --line-buffered -v "^$\|HTTP/2 support\|Configuring endpoint\|Starting server" \
  | sed 's/^/\o033[35m[lk]\o033[0m  /'
) &
PIDS+=($!)
sleep 1

# 4c. Генератор — Vite на 5000
log "Запуск: Генератор Vite → :5000"
(
  cd "$ROOT_DIR/frontend"
  npm run dev 2>&1 | sed 's/^/\o033[32m[vite]\o033[0m /'
) &
PIDS+=($!)

# 4d. ЛК — React CRA на 3000
log "Запуск: ЛК React → :3000"
(
  cd "$LK_DIR/frontend"
  PORT=3000 BROWSER=none WDS_SOCKET_PATH=/__wds__ npm start 2>&1 | sed 's/^/\o033[33m[cra]\o033[0m  /'
) &
PIDS+=($!)

# ── 5. Вывод ─────────────────────────────────────────────────────────────────
sleep 3
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Генератор  → http://localhost:5000"
echo "  ЛК         → http://localhost:3000"
echo ""
echo "  Тест /lesson/join/:"
echo "    1. Войти в ЛК (localhost:3000), создать урок"
echo "    2. Нажать «Начать урок» → ссылка вида:"
echo "       http://localhost:5000/lesson/join/?token=<JWT>"
echo "    3. Открыть в браузере — должна открыться комната урока"
echo ""
echo "  Проверка токена вручную:"
echo "    curl 'http://localhost:8000/api/lesson/verify/?token=<JWT>'"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
log "Ctrl+C для остановки"

wait
