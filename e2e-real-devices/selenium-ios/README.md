# Selenium real iOS — full lesson-room

BrowserStack **Selenium / WebdriverIO** (not Playwright). Session goes to Automate hub — no local Appium server.

Official iOS permission popup:
https://www.browserstack.com/docs/automate/selenium/handle-permission-pop-ups

W3C capability: **`appium:safariAllowPopups: true`**. Unprefixed `safariAllowPopups` is rejected by WebdriverIO (`Invalid or unsupported WebDriver capabilities`).

Then: `getContexts()` → `NATIVE_APP` by name → `$('[name="Allow"]')` / `id=Allow` → Safari web context by name.

`Automate testing time expired` is a **BrowserStack account quota** error, not a room/Jitsi failure.

Device: **iPhone 15 Pro Max / iOS 17 / Safari** (single proven session)

```bash
cd e2e-real-devices
npm run test:browserstack:ios-selenium
```

### Device matrix

Devices come from BrowserStack Automate `browsers.json` (`real_mobile === true`). Not hardcoded. Parallelism is `min(devices, plan.parallel_sessions_max_allowed)` unless `DEVICE_CONCURRENCY` is set.

```bash
cd e2e-real-devices
npm run test:quick          # 2 draws, representative devices, ROOM WORKS / ROOM BROKEN
npm run test:freeze         # reliability / freeze
npm run test:stress         # 20–50 strokes on 3 devices
npm run test:tabcycle
npm run test:full           # all unique catalog combos, same 2-draw flow
npm run test:permission     # stop after native Allow
npm run test:entry          # independent room-entry repeats
```

`BOARD_TEST_MODE=quick` is 2 real draws + one Call→Materials→Board restore. Not 10+20+5. First FAIL stays in the summary even if retry PASSes.

Default matrix mode is **core**. `ios-selenium` stays the short core flow unless `BOARD_TEST_MODE` is set.

This command does **not** start Playwright.
