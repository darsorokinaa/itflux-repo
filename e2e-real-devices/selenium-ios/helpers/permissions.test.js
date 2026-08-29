const test = require("node:test");
const assert = require("node:assert/strict");
const {
  ALLOW_SELECTORS,
  ANDROID_ALLOW_SELECTORS,
  isNativeContext,
  nativeContextName,
  webContextName,
} = require("./permissions");
const { SELECTORS } = require("./dom");

test("official iOS Allow locators come first and do not use coordinates", () => {
  assert.equal(ALLOW_SELECTORS[0], '[name="Allow"]');
  assert.equal(ALLOW_SELECTORS[1], "id=Allow");
  for (const selector of ALLOW_SELECTORS) {
    assert.equal(/tap|coordinate|\bx\s*:|\by\s*:/i.test(selector), false);
  }
});

test("Android Allow locators use resource-id / text, not iOS XCUI or coordinates", () => {
  assert.ok(ANDROID_ALLOW_SELECTORS.some((s) => s.includes("permission_allow_foreground_only_button")));
  assert.ok(ANDROID_ALLOW_SELECTORS.some((s) => /While using the app|При использовании приложения/.test(s)));
  for (const selector of ANDROID_ALLOW_SELECTORS) {
    assert.equal(/tap|coordinate|\bx\s*:|\by\s*:|XCUIElementType/i.test(selector), false);
  }
});

test("web context is chosen by name, not a hard-coded index", () => {
  const contexts = ["NATIVE_APP", "WEBVIEW_12345.1"];
  assert.equal(nativeContextName(contexts), "NATIVE_APP");
  assert.equal(webContextName(contexts), "WEBVIEW_12345.1");
  assert.equal(webContextName(["NATIVE_APP", "SAFARI"], "SAFARI"), "SAFARI");
  assert.equal(isNativeContext("NATIVE_APP"), true);
  assert.equal(isNativeContext("WEBVIEW_1"), false);
});

test("production room selectors", () => {
  assert.equal(SELECTORS.cameraWithout, "Без камеры");
  assert.equal(SELECTORS.tabCall, "Звонок");
  assert.equal(SELECTORS.tabMaterials, "Материалы");
  assert.equal(SELECTORS.boardIframeSrc, 'iframe[src*="/cabinet/boards/"]');
  assert.equal(SELECTORS.boardWorkspaceFrame, "iframe.video-lesson-workspace__frame--board");
  assert.equal(SELECTORS.boardSlot, ".vl-board-slot");
  assert.equal(SELECTORS.jitsiIframe, "#jitsi-container iframe");
  assert.equal(SELECTORS.boardHost, ".cb-board-excalidraw-host");
  assert.equal(SELECTORS.excalidrawCanvas, "canvas.excalidraw__canvas");
  assert.equal(SELECTORS.toolFreedraw, "toolbar-freedraw");
  assert.equal(SELECTORS.materialsPanel, "aside.video-lesson-aside");
});

test("materials success does not require role=complementary attribute", () => {
  const { classifyMaterialsClick } = require("./room");
  const before = { tabs: [{ text: "Материалы", ariaSelected: "false", className: "" }] };
  const after = {
    materialsTabSelected: true,
    mobileMaterialsClass: true,
    asidePresent: true,
    complementaryAttrPresent: false,
    asideStyle: { display: "flex", visibility: "visible", rect: { width: 390, height: 500 } },
    openText: [{ text: "Открыть", displayed: true }],
  };
  const verdict = classifyMaterialsClick(before, after);
  assert.equal(verdict.classification, "MATERIALS = SELECTOR BUG");
  assert.match(verdict.outcome, /A|B/);
});
