const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { SELECTORS } = require("./dom");
const { performMeasuredStroke, runMeasuredStrokeSeries } = require("./board-session");

function el({
  displayed = true,
  existing = true,
  width = 390,
  height = 500,
  x = 10,
  y = 20,
  className = "",
  src = "",
  elementId = "el",
  pressed = "true",
} = {}) {
  return {
    elementId,
    isDisplayed: async () => displayed,
    isExisting: async () => existing,
    isEnabled: async () => true,
    getSize: async () => ({ width, height }),
    getLocation: async () => ({ x, y }),
    getAttribute: async (name) => {
      if (name === "class") return className;
      if (name === "src") return src;
      if (name === "aria-pressed" || name === "aria-checked") return pressed;
      return "";
    },
    waitForExist: async () => {},
    scrollIntoView: async () => {},
    click: async () => {},
    getText: async () => "",
  };
}

function mockBrowser({ strokeMs = 40 } = {}) {
  const canvas = el({ width: 390, height: 500 });
  const tool = el({ pressed: "true" });
  const missing = el({ displayed: false, existing: false, width: 0, height: 0 });
  const jitsi = el({
    elementId: "jitsi-1",
    className: "",
    src: "https://meet.jit.si/room",
    width: 120,
    height: 80,
  });
  const board = el({
    elementId: "board-1",
    className: "video-lesson-workspace__frame video-lesson-workspace__frame--board",
    src: "/cabinet/boards/12",
    width: 390,
    height: 500,
  });
  const strokeDurations = [];
  return {
    strokeDurations,
    switchFrame: async () => {},
    pause: async () => {},
    getUrl: async () => "https://itflux-academy.ru/cabinet/meetings/abc",
    $: async (selector) => {
      const sel = String(selector);
      if (sel === SELECTORS.excalidrawCanvas) return canvas;
      if (sel.includes(SELECTORS.toolFreedraw)) return tool;
      return missing;
    },
    $$: async (selector) => {
      const sel = String(selector);
      if (sel === SELECTORS.jitsiIframe || sel === "#jitsi-container iframe") return [jitsi];
      if (sel === "iframe") return [jitsi, board];
      return [];
    },
    action: () => {
      const chain = {
        move() { return chain; },
        down() { return chain; },
        pause() { return chain; },
        up() { return chain; },
        async perform() {
          const started = Date.now();
          await new Promise((resolve) => setTimeout(resolve, strokeMs));
          strokeDurations.push(Date.now() - started);
        },
      };
      return chain;
    },
  };
}

test("quick session is 3+3+3+1 strokes and 30s idle, not smoke 10+20+5", () => {
  const src = fs.readFileSync(path.join(__dirname, "board-session.js"), "utf8");
  assert.match(src, /async function runQuickBoardSession/);
  assert.match(src, /QUICK R1", 3/);
  assert.match(src, /QUICK R2", 3/);
  assert.match(src, /QUICK R3", 3/);
  assert.match(src, /idleKeepalive\(browser, 30_000\)/);
  assert.equal(/runMeasuredStrokeSeries\(browser, current, 10/.test(src.slice(src.indexOf("async function runQuickBoardSession"))), false);
});

test("board-session no longer uses a shared timeout for 10 strokes", () => {
  const src = fs.readFileSync(path.join(__dirname, "board-session.js"), "utf8");
  assert.equal(/count \* 4_000/.test(src), false);
  assert.equal(/10 normal strokes/.test(src), false);
  assert.match(src, /performMeasuredStroke/);
  assert.match(src, /stroke \$\{n\}\/\$\{count\} PASS/);
  assert.equal(/releaseActions/.test(src), false);
});

test("each measured stroke records its own duration and completes independently", async () => {
  const browser = mockBrowser({ strokeMs: 35 });
  const first = await performMeasuredStroke(browser, { navigation: "iframe" }, {
    index: 1,
    variant: "normal",
    successCount: 1,
  });
  assert.equal(first.index, 1);
  assert.equal(first.actionCompleted, true);
  assert.equal(first.canvasFoundBefore, true);
  assert.equal(first.canvasFoundAfter, true);
  assert.equal(first.canvasWidth, 390);
  assert.equal(first.canvasHeight, 500);
  assert.equal(first.error, null);
  assert.equal(typeof first.startedAt, "string");
  assert.ok(first.durationMs >= 35);
});

test("measured series logs per-stroke PASS and does not treat slow completes as freeze", async () => {
  const logs = [];
  const original = console.log;
  console.log = (...args) => logs.push(args.join(" "));
  try {
    const browser = mockBrowser({ strokeMs: 45 });
    const result = await runMeasuredStrokeSeries(browser, { navigation: "iframe" }, 3, "normal", 1, {
      logPrefix: "SMOKE",
    });
    assert.equal(result.count, 3);
    assert.equal(result.records.length, 3);
    assert.equal(result.records[0].index, 1);
    assert.equal(result.records[2].index, 3);
    assert.ok(result.stats.firstStrokeMs >= 45);
    assert.ok(result.stats.maxStrokeMs >= result.stats.firstStrokeMs);
    assert.match(logs[0], /^SMOKE stroke 1\/3 PASS \d+ms$/);
    assert.match(logs[1], /^SMOKE stroke 2\/3 PASS \d+ms$/);
    assert.match(logs[2], /^SMOKE stroke 3\/3 PASS \d+ms$/);
  } finally {
    console.log = original;
  }
});
