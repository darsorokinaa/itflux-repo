const test = require("node:test");
const assert = require("node:assert/strict");
const {
  ALLOW_SELECTORS,
  isNativeContext,
  nativeContextName,
  webContextName,
} = require("./permission");
const { SELECTORS } = require("./selectors");

test("official iOS Allow locators come first and do not use coordinates", () => {
  assert.equal(ALLOW_SELECTORS[0], '[name="Allow"]');
  assert.equal(ALLOW_SELECTORS[1], "id=Allow");
  assert.ok(ALLOW_SELECTORS.includes("~Allow"));
  for (const selector of ALLOW_SELECTORS) {
    assert.equal(/tap|coordinate|x:|y:/i.test(selector), false);
  }
});

test("NATIVE_APP is contexts[0] when unnamed, WEBVIEW is contexts[1]", () => {
  const contexts = ["NATIVE_APP", "WEBVIEW_12345.1"];
  assert.equal(nativeContextName(contexts), "NATIVE_APP");
  assert.equal(webContextName(contexts), "WEBVIEW_12345.1");
  assert.equal(isNativeContext("NATIVE_APP"), true);
  assert.equal(isNativeContext("WEBVIEW_1"), false);
});

test("lesson-room selectors match production contracts", () => {
  assert.equal(SELECTORS.loginPath, "/cabinet/login");
  assert.equal(SELECTORS.cameraWithout, "Без камеры");
  assert.equal(SELECTORS.tabCall, "Звонок");
  assert.equal(SELECTORS.tabMaterials, "Материалы");
  assert.equal(SELECTORS.boardOpenButton, "Открыть");
  assert.equal(SELECTORS.jitsiIframe, "#jitsi-container iframe");
  assert.equal(SELECTORS.boardHost, ".cb-board-excalidraw-host");
  assert.equal(SELECTORS.excalidrawCanvas, "canvas.excalidraw__canvas");
  assert.equal(SELECTORS.toolFreedraw, "toolbar-freedraw");
  assert.equal(SELECTORS.toolText, "toolbar-text");
});
