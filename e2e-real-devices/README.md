# E2E real devices — production validation of the lesson room

## PLAYWRIGHT iOS vs SELENIUM iOS

**PLAYWRIGHT iOS** не может нажать native Safari Allow. После «Без камеры» OS sheet блокирует join. Timeout 180s — это не production failure. Playwright на real iOS только **диагностика до permission**. Full-room specs (`01-basic-room`, `02-drawing`, `07-tab-cycles`, …) на iOS skip.

**SELENIUM iOS** (`selenium-ios/`) — настоящий тест комнаты: `safariAllowPopups: true` → `NATIVE_APP` → `$('[name="Allow"]')` / `By.id("Allow")` → web context → join → Звонок → Материалы → доска → штрих.

Документация: https://www.browserstack.com/docs/automate/selenium/handle-permission-pop-ups

### PLAYWRIGHT DIAGNOSTIC

```bash
cd e2e-real-devices
npm run test:browserstack:smoke
```

### SELENIUM FULL IOS

```bash
cd e2e-real-devices
npm run test:browserstack:ios-selenium
```

Для настоящего теста комнаты на real iPhone нужна **SELENIUM FULL IOS**.

### SELENIUM DEVICE MATRIX

Список устройств **не хардкодится**. Перед запуском: `GET https://api.browserstack.com/automate/browsers.json` (`real_mobile === true`). Параллельность берётся из `GET /automate/plan.json` (`parallel_sessions_max_allowed`), если не задан `DEVICE_CONCURRENCY`.

Ежедневный release smoke (~2–5 мин wall-clock при параллели):

```bash
cd e2e-real-devices
npm run test:quick
```

Сначала безопасная проверка на трёх устройствах:

```bash
cd e2e-real-devices
MAX_DEVICES=3 npm run test:browserstack:device-matrix
```

Полная матрица (все доступные real mobile, по одному session):

```bash
cd e2e-real-devices
MAX_DEVICES=0 DEVICE_OS=all DEVICE_KIND=all DEVICE_CONCURRENCY=1 npm run test:browserstack:device-matrix
```

Фильтры: `DEVICE_OS=ios|android|all`, `DEVICE_KIND=phone|tablet|all`. Точная модель: `DEVICE_NAME="iPhone 17" DEVICE_OS_VERSION="26"` (`iPhone 17` не матчит `iPhone 17 Pro`; несколько имён через запятую). Артефакты: `selenium-ios/artifacts/<device>/` и `device-matrix-summary.json` / `.csv`. `FREEZE=not_checked`, если smoke/stress не начались после DRAW.

`BOARD_TEST_MODE=smoke` (default) на каждом устройстве после первого DRAW: 10 strokes, 20 быстрых, 3 цикла Board→Call→Materials→Board, ещё 5 strokes, health/overflow/iframe checks. Зависание после того, как canvas уже работал → `BOARD FREEZE` / `PRODUCT_FAIL`. Stale WebDriver / unsupported actions / мёртвая session — не freeze.

Глубокий прогон (новый iPhone, старый iPhone, iPad, Pixel, Samsung, Android tablet; `TEST_MINUTES=60`; retry одного PRODUCT_FAIL):

Короткий реальный прогон (~3–5 мин на устройство, 10 strokes, без smoke/stress). По умолчанию 6 representatives. Первый FAIL не схлопывается в PASS после retry:

```bash
cd e2e-real-devices
npm run test:browserstack:quick
DEVICE_NAME="Google Pixel 11" npm run test:browserstack:quick
```

```bash
cd e2e-real-devices
BOARD_TEST_MODE=stress TEST_MINUTES=60 npm run test:browserstack:stress-matrix
```

Максимальный короткий (smoke на всех real mobile):

```bash
cd e2e-real-devices
BOARD_TEST_MODE=smoke MAX_DEVICES=0 DEVICE_OS=all DEVICE_KIND=all DEVICE_CONCURRENCY=1 npm run test:browserstack:device-matrix
```

---

Отдельный Playwright-пакет для проверки **живой комнаты урока** на физических iPhone / iPad / Android через BrowserStack Automate.

Production-код комнаты и доски **не меняется**. Для диагностики используется уже существующий флаг:

```
localStorage.itflux_board_sync_debug = "1"
```

Он включается **до** перехода в комнату и активирует штатную телеметрию `board_health_sample` (`frontend/src/utils/clientTelemetry.js`, `frontend/src/cabinet/boards/boardCollab.ts`). Вторая реализация telemetry не создаётся.

Пароли и BrowserStack credentials в репозиторий не попадают.

## Secrets

Скопируйте `.env.example` → `.env` **или** экспортируйте переменные в shell.

| Переменная | Назначение |
|---|---|
| `TEST_LOGIN` | Email или логин кабинета |
| `TEST_PASSWORD` | Пароль |
| `LESSON_ROOM_URL` | Полный URL живой комнаты, например `https://<host>/cabinet/meetings/<uuid>` |
| `TEST_BASE_URL` | Опционально, origin. По умолчанию origin от `LESSON_ROOM_URL` |
| `TEST_MINUTES` | Длительность TEST 5. По умолчанию `60` |
| `BROWSERSTACK_USERNAME` | BrowserStack Automate |
| `BROWSERSTACK_ACCESS_KEY` | BrowserStack Automate |
| `DEVICE_OS` | Matrix: `all` (default), `ios`, `android` |
| `DEVICE_KIND` | Matrix: `all` (default), `phone`, `tablet` |
| `MAX_DEVICES` | Matrix cap after sort. `0` (default) = all. `3` = first 3 runs |
| `DEVICE_CONCURRENCY` | Parallel BrowserStack sessions. Default `1` |
| `BOARD_TEST_MODE` | `core` (default), `quick` (3–5 min, 10 strokes), `smoke`, `stress` |
| `TEST_MINUTES` | Stress duration. Default `60` |

Логин открывается на `{origin}/cabinet/login`.

## Установка

```bash
cd e2e-real-devices
npm install
npx playwright install chromium
```

## Локальный запуск (Chromium)

Smoke без production secrets (проверка файлов и selectors):

```bash
cd e2e-real-devices
npm run test:local -- tests/00-suite-ready.spec.js
```

Smoke комнаты (нужны `TEST_LOGIN`, `TEST_PASSWORD`, `LESSON_ROOM_URL`):

```bash
cd e2e-real-devices
npm run test:local:smoke
```

Все тесты локально. TEST 5 по умолчанию идёт 60 минут — для короткой проверки:

```bash
TEST_MINUTES=1 npm run test:local
```

## BrowserStack real devices

```bash
export BROWSERSTACK_USERNAME="..."
export BROWSERSTACK_ACCESS_KEY="..."
export TEST_LOGIN="..."
export TEST_PASSWORD="..."
export LESSON_ROOM_URL="https://<host>/cabinet/meetings/<uuid>"

cd e2e-real-devices
npm run test:browserstack:smoke
```

Это **диагностика** до native microphone sheet. Не гоняет `01-basic-room` / `02-drawing` / `07-tab-cycles`.

Настоящий full-room тест на iPhone 15 Pro Max / iOS 17 / Safari:

```bash
npm run test:browserstack:ios-selenium
```

Изоляция входа в комнату (LOGIN → PREJOIN → MIC → live UI). **Без** доски, draw и smoke. Каждая попытка — новая BrowserStack session, отдельный PASS/FAIL (retry внутри run не схлопывается в PASS):

```bash
ROOM_ENTRY_REPEAT=20 \
DEVICE_NAME="iPad Air 11 2026" \
DEVICE_OS_VERSION=26 \
npm run test:browserstack:room-entry-repeat
```

Артефакты: `selenium-ios/artifacts/entry-repeat/summary.json` и `…/<device>-entry-NN/` (screenshot + DOM/network snapshot). Классификация flake: `INTERMITTENT_PRODUCTION_SUSPECT` до двух независимых одинаковых UI-fail. Production не менять до FIRST DIVERGENCE.

Полный Playwright-набор (на iOS full-room specs skip):

```bash
npm run test:browserstack
```

Расширенная матрица (после успешного smoke):

```bash
npm run test:browserstack:extended
```

SDK читает `browserstack.yml` из этой директории (для extended — `BROWSERSTACK_CONFIG_FILE=browserstack.extended.yml`). Credentials подставляются из env (`${BROWSERSTACK_USERNAME}` / `${BROWSERSTACK_ACCESS_KEY}`).

## Устройства

### Smoke (`browserstack.yml`)

Комбинации из [документации Playwright на iOS](https://www.browserstack.com/docs/automate/playwright/playwright-ios/nodejs):

| deviceName | osVersion | browser |
|---|---|---|
| iPhone 15 Pro Max | 17 | safari |
| iPhone 14 | 18 | safari |
| iPhone 12 Pro | 14 | safari |

### Extended (`browserstack.extended.yml`)

Только имена из Playwright iOS/Android docs и [списка Automate](https://www.browserstack.com/list-of-browsers-and-platforms/automate):

| deviceName | osVersion | browser | роль |
|---|---|---|---|
| iPhone SE 2022 | 15 | safari | маленький iPhone |
| iPhone 16 Pro Max | 18 | safari | современный iPhone |
| iPad 9th | 18 | safari | iPad |
| iPad Pro 11 2024 | 17 | safari | iPad |
| Samsung Galaxy S25 Ultra | 15.0 | chrome | Android |
| Google Pixel 10 | 16.0 | chrome | Android |

Playwright на iOS **не умеет** менять `deviceOrientation`. iPad стартует в portrait по умолчанию — отдельный landscape-прогон на iOS через SDK недоступен.

## Тесты

| Файл | Что проверяет |
|---|---|
| `00-suite-ready.spec.js` | Assets, helpers, контракт selectors |
| `01-ios-permission-diagnostic.spec.js` | Playwright iOS: login → «Без камеры» → screenshot native mic stage → stop. Join не ждёт |
| `01-basic-room.spec.js` | Вход в комнату, «Без камеры», `.video-lesson-page`, вкладка Звонок, Jitsi ≤ 1, Материалы, layout. На real iOS skip |
| `02-drawing.spec.js` | Открыть существующую доску через «Открыть», host/canvas внутри iframe, штрихи. На real iOS skip |
| `03-text.spec.js` | `toolbar-text` → клик по canvas → «BrowserStack iPhone test». На real iOS skip |
| `04-image.spec.js` | `toolbar-image` + file chooser. На real iOS skip |
| `05-long-session.spec.js` | `TEST_MINUTES` long session. На real iOS skip |
| `06-responsive.spec.js` | overflow, board, PiP, Jitsi ≤ 1. На real iOS skip |
| `07-tab-cycles.spec.js` | Циклы доска → Звонок → Материалы. На real iOS skip |
| `08-error-capture.spec.js` | Screenshots, HTTP 4xx/5xx. На real iOS skip |
| `09-create-board.spec.js` | «Создать» доску. На real iOS skip |
| `selenium-ios/run.js` | Selenium full room + native Allow на iPhone 15 Pro Max |
| `selenium-ios/entry-repeat.js` | Независимые LOGIN→PREJOIN→live repeats; `ROOM_ENTRY_REPEAT` |

Smoke (`test:browserstack:smoke`) запускает только `00` и `01-ios-permission-diagnostic`. Drawing / tab cycles на iOS Playwright не гоняются.

Рисование **не** вызывает Excalidraw JS API (`updateScene` / `addFiles`). Только UI.

## Selectors (из production-кода)

Не выдуманы. Источники:

- Логин: `frontend/src/pages/CabinetAuthPage.jsx`, маршрут `/cabinet/login` в `App.jsx`
- Комната: `frontend/src/cabinet/pages/VideoMeetingPage.jsx`, маршрут `/cabinet/meetings/:meetingUuid`
- Доска: iframe `src` содержит `/cabinet/boards/` (`SyncedMaterialWorkspace.jsx` / workspace iframe)
- Контейнер Excalidraw: `.cb-board-excalidraw-host` (`BoardExcalidrawCanvas.tsx`)
- Canvas: `canvas.excalidraw__canvas`
- Инструменты: `data-testid="toolbar-freedraw|toolbar-text|toolbar-image"` (то же семейство, что уже используется в `boards.css`)
- Jitsi: `#jitsi-container iframe`
- Вкладки: `role=tablist` `aria-label="Режим экрана"` → «Звонок» / «Материалы». Доска открывается из панели `aria-label="Материалы урока"` кнопкой «Открыть» / строкой «Доска»
- PiP звонка: `main.video-lesson-content` при `.video-lesson-page--compact`

## Что нельзя проверить автоматически на iOS (BrowserStack Playwright)

На real iOS **не поддерживаются**:

- `playwrightLogs`
- `consoleLogs`
- `resolution`
- `geoLocation`
- смена ориентации (`deviceOrientation`)

Поэтому iOS-диагностика **не** строится на console logs. Используются:

- визуальные assertions и screenshots
- Playwright trace (`retain-on-failure`) — это не `playwrightLogs` BrowserStack
- существующая телеметрия `board_health_sample` при `itflux_board_sync_debug=1`

Ограничения input на iOS Safari:

- нативный file picker может не отдавать Playwright `filechooser` — TEST 4 помечает шаг как unsupported infrastructure capability и продолжает проверки комнаты
- **Native Safari microphone dialog — BROWSERSTACK AUTOMATION LIMITATION.** После «Без камеры» Jitsi iframe создаётся, iOS показывает `Would Like to Access the Microphone` / Allow. Playwright real iOS **не умеет** auto-Allow этот OS prompt. `context.grantPermissions(['microphone'])` — не real-Safari TCC. Selenium `driver.context('NATIVE_APP')` + click Allow — [Selenium-only](https://www.browserstack.com/docs/automate/selenium/handle-permission-pop-ups), не Playwright. Appium `autoAcceptAlerts` — [native apps](https://www.browserstack.com/docs/app-automate/appium/advanced-features/handle-permission-pop-ups), не Playwright Safari. [Playwright iOS capabilities](https://www.browserstack.com/docs/automate/playwright/playwright-ios/nodejs) не содержат permission grant. Пока Allow не нажат, ждать `videoConferenceJoined` некорректно; FAIL с iframe + неотвеченным mic prompt **не** классифицируется как production Jitsi failure.
- WebRTC/камера: тест нажимает in-app «Без камеры»; системный диалог Safari тест не закрывает
- `page.mouse` эмулирует pointer; это не стилус Apple Pencil

Ошибка инфраструктуры BrowserStack (device busy, session not created, disconnect) помечается skip и **не** считается дефектом комнаты.

## Артефакты

- `test-results/` — screenshots, traces, `capture/timing.json`, `capture/http-failures.json`
- `playwright-report/` — HTML отчёт Playwright
- BrowserStack dashboard — video сессии (не console на iOS)

## Важно

TEST 5 держит сессию до часа. В `browserstack.yml` стоит `idleTimeout: 300`, а во время пауз тест периодически читает `document.title`, чтобы сессия не умерла по idle.
