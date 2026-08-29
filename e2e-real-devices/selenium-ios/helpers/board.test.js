const test = require("node:test");
const assert = require("node:assert/strict");
const { SELECTORS } = require("./dom");
const { classifyBoardOpen } = require("./board");

const meetingUrl = "https://itflux-academy.ru/cabinet/meetings/abc-uuid";

test("board iframe on room page is TEST BUG, not productFailure", () => {
  const before = {
    url: meetingUrl,
    pageClassName: "video-lesson-page video-lesson-page--mobile-materials",
    iframes: [{ className: "", src: "", rect: { width: 100, height: 80 } }],
    windowHandles: ["w1"],
  };
  const after = {
    url: meetingUrl,
    pageClassName: "video-lesson-page video-lesson-page--workspace video-lesson-page--compact",
    iframes: [{
      className: "video-lesson-workspace__frame video-lesson-workspace__frame--board",
      src: "/cabinet/boards/12",
      selectorHint: SELECTORS.boardWorkspaceFrame,
      display: "block",
      rect: { width: 390, height: 500 },
    }],
    windowHandles: ["w1"],
  };
  const verdict = classifyBoardOpen(before, after);
  assert.equal(verdict.opened, true);
  assert.equal(verdict.navigation, "iframe");
  assert.equal(verdict.container, SELECTORS.boardWorkspaceFrame);
  assert.equal(verdict.classification, "TEST BUG");
});

test("hidden board iframe with 0 size is PRODUCT BUG only after click opened it", () => {
  const before = { url: meetingUrl, pageClassName: "video-lesson-page", iframes: [], windowHandles: ["w1"] };
  const after = {
    url: meetingUrl,
    pageClassName: "video-lesson-page video-lesson-page--workspace",
    iframes: [{
      className: "video-lesson-workspace__frame--board",
      src: "/cabinet/boards/12",
      selectorHint: SELECTORS.boardWorkspaceFrame,
      width: 0,
      height: 0,
    }],
    windowHandles: ["w1"],
  };
  const verdict = classifyBoardOpen(before, after);
  assert.equal(verdict.opened, true);
  assert.equal(verdict.navigation, "iframe");
  assert.equal(verdict.classification, "PRODUCT BUG");
  assert.equal(verdict.iframeHidden, true);
});

test("full-page /cabinet/boards/ navigation is route TEST BUG", () => {
  const before = { url: meetingUrl, pageClassName: "video-lesson-page", iframes: [], windowHandles: ["w1"] };
  const after = {
    url: "https://itflux-academy.ru/cabinet/boards/12",
    pageClassName: "",
    iframes: [],
    windowHandles: ["w1"],
  };
  const verdict = classifyBoardOpen(before, after);
  assert.equal(verdict.opened, true);
  assert.equal(verdict.navigation, "route");
  assert.equal(verdict.classification, "TEST BUG");
});

test("execute serialize error is TEST INFRA, not product or board click", () => {
  const { isExecuteSerializeError, parseExecuteJson } = require("./execute-json");
  assert.equal(
    isExecuteSerializeError({ message: 'WebDriverError: Recursive object cannot be transferred when running "execute/sync"' }),
    true,
  );
  assert.equal(
    isExecuteSerializeError({ message: "Expected ',' or '}' after property value in JSON at position 3213" }),
    true,
  );
  assert.equal(isExecuteSerializeError({ message: "element not found" }), false);
  assert.deepEqual(parseExecuteJson('{"a":1,"b":true}', "t"), { a: 1, b: true });
  assert.deepEqual(parseExecuteJson({ a: 2 }, "t"), { a: 2 });
});

test("click with no DOM/route change is PRODUCT BUG classification", () => {
  const snap = {
    url: meetingUrl,
    pageClassName: "video-lesson-page video-lesson-page--mobile-materials",
    iframes: [{ className: "", src: "about:blank", rect: { width: 10, height: 10 } }],
    windowHandles: ["w1"],
  };
  const verdict = classifyBoardOpen(snap, { ...snap });
  assert.equal(verdict.opened, false);
  assert.equal(verdict.navigation, "none");
  assert.equal(verdict.classification, "PRODUCT BUG");
});
