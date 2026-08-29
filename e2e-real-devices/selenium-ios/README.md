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

Devices come from BrowserStack Automate `browsers.json` (`real_mobile === true`). Not hardcoded. Default sequential.

```bash
cd e2e-real-devices
DEVICE_NAME="iPhone 17,iPhone 17 Pro,iPhone 17 Pro Max" DEVICE_OS_VERSION="26" BOARD_TEST_MODE=smoke DEVICE_CONCURRENCY=1 npm run test:browserstack:device-matrix
```

Do **not** run `MAX_DEVICES=0` until these three either PASS or have a confirmed PRODUCT_FAIL (same UI defect twice).

`BOARD_TEST_MODE=quick` (~3–5 min / device, 10 strokes, 30s idle): `npm run test:browserstack:quick`. First FAIL stays in the summary even if retry PASSes.

Default matrix mode is **core**. `ios-selenium` stays the short core flow unless `BOARD_TEST_MODE` is set.

This command does **not** start Playwright.
