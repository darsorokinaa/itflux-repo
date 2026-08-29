const { SELECTORS, displayed, waitFor, FlowError } = require("./dom");
const { writeJson, screenshot, redactSecrets } = require("./artifacts");
const { isWebDriverInfraError } = require("./classify");

const FRAME_SELECTORS = [
  SELECTORS.boardWorkspaceFrame,
  SELECTORS.boardIframeSrc,
  SELECTORS.boardWorkspaceFrameAny,
];

function boardFail(code, message, extras = {}) {
  return new FlowError(code, message, {
    productFailure: false,
    ...extras,
  });
}

function productFail(code, message, extras = {}) {
  return new FlowError(code, message, {
    productFailure: true,
    ...extras,
  });
}

async function leaveBoardFrame(browser) {
  if (typeof browser.switchFrame !== "function") {
    throw boardFail("BOARD = TEST INFRA BUG", "browser.switchFrame is not available", {
      classification: "TEST INFRA BUG",
      boardClick: "pending",
    });
  }
  try {
    await browser.switchFrame(null);
  } catch {
    /* already on default content */
  }
}

async function switchIntoFrame(browser, iframe) {
  await leaveBoardFrame(browser);
  if (typeof browser.switchFrame !== "function") {
    throw boardFail("BOARD = TEST INFRA BUG", "browser.switchFrame is not available", {
      classification: "TEST INFRA BUG",
    });
  }
  try {
    await browser.switchFrame(iframe);
  } catch (err) {
    throw boardFail(
      "BOARD = TEST INFRA BUG",
      `switchFrame failed: ${String((err && err.message) || err)}`,
      { classification: "TEST INFRA BUG", boardClick: "PASS" },
    );
  }
}

function isBoardSrc(src) {
  return /\/cabinet\/boards\//i.test(String(src || ""));
}

function isBoardRoute(url) {
  return /\/cabinet\/boards\/[^/?#]+/i.test(String(url || ""))
    && !/\/cabinet\/meetings\//i.test(String(url || ""));
}

function iframeSelectorHint(src, className) {
  const cls = String(className || "");
  const href = String(src || "");
  if (/\bvideo-lesson-workspace__frame--board\b/.test(cls)) return SELECTORS.boardWorkspaceFrame;
  if (isBoardSrc(href)) return SELECTORS.boardIframeSrc;
  if (/\bvideo-lesson-workspace__frame\b/.test(cls)) return SELECTORS.boardWorkspaceFrameAny;
  return "iframe";
}

function pickBoardIframe(iframes) {
  const list = Array.isArray(iframes) ? iframes : [];
  return list.find((f) => /\bvideo-lesson-workspace__frame--board\b/.test(f.className || ""))
    || list.find((f) => isBoardSrc(f.src) || isBoardSrc(f.currentSrc))
    || list.find((f) => /\bvideo-lesson-workspace__frame\b/.test(f.className || "") && !f.inJitsi)
    || null;
}

function iframeHasSize(frame) {
  const w = Number(frame && (frame.width != null ? frame.width : frame.rect && frame.rect.width));
  const h = Number(frame && (frame.height != null ? frame.height : frame.rect && frame.rect.height));
  return w > 1 && h > 1;
}

function classifyBoardOpen(before, after) {
  const urlAfter = String(after.url || "");
  const boardFrame = pickBoardIframe(after.iframes);
  const extraWindows = (after.windowHandles || []).length > (before.windowHandles || []).length;
  const route = isBoardRoute(urlAfter);

  if (route) {
    return {
      opened: true,
      navigation: "route",
      container: "document (full-page /cabinet/boards/:id)",
      classification: "TEST BUG",
      reason: "URL left the meeting room",
    };
  }

  if (boardFrame) {
    const hidden = !iframeHasSize(boardFrame);
    return {
      opened: true,
      navigation: "iframe",
      container: boardFrame.selectorHint || iframeSelectorHint(boardFrame.src, boardFrame.className),
      classification: hidden ? "PRODUCT BUG" : "TEST BUG",
      iframeHidden: hidden,
      reason: hidden ? "board iframe present with width/height 0" : "same-page workspace iframe",
    };
  }

  if (extraWindows) {
    return {
      opened: true,
      navigation: "other",
      container: "new window/tab",
      classification: "TEST BUG",
      reason: "Открыть spawned an extra window",
    };
  }

  const sameUrl = String(before.url || "") === urlAfter;
  const sameIframeCount = (before.iframes || []).length === (after.iframes || []).length;
  if (sameUrl && sameIframeCount) {
    return {
      opened: false,
      navigation: "none",
      container: null,
      classification: "PRODUCT BUG",
      reason: "click did not change URL or iframe set",
    };
  }

  return {
    opened: true,
    navigation: "other",
    container: SELECTORS.boardWorkspaceSection,
    classification: "TEST BUG",
    reason: "DOM changed after click without a board iframe/route",
  };
}

function withoutElements(snapshot) {
  return {
    url: snapshot && snapshot.url ? redactSecrets(String(snapshot.url)) : "",
    iframes: (snapshot && snapshot.iframes ? snapshot.iframes : []).map((f) => ({
      src: redactSecrets(String(f.src || "")),
      className: String(f.className || ""),
      displayed: Boolean(f.displayed),
      width: Number(f.width) || 0,
      height: Number(f.height) || 0,
      inJitsi: Boolean(f.inJitsi),
      selectorHint: String(f.selectorHint || ""),
    })),
    windowHandles: (snapshot && snapshot.windowHandles ? snapshot.windowHandles : []).map((h) => String(h)),
    diagnosticError: snapshot && snapshot.diagnosticError ? String(snapshot.diagnosticError) : null,
  };
}

async function listIframes(browser) {
  const jitsiIds = new Set();
  const jitsiFrames = await browser.$$("#jitsi-container iframe");
  for (const node of jitsiFrames) {
    if (node && node.elementId) jitsiIds.add(node.elementId);
  }
  const frames = await browser.$$("iframe");
  const out = [];
  for (const el of frames) {
    const src = String(await el.getAttribute("src").catch(() => "") || "");
    const className = String(await el.getAttribute("class").catch(() => "") || "");
    const size = await el.getSize().catch(() => ({ width: 0, height: 0 }));
    const inJitsi = Boolean(el.elementId && jitsiIds.has(el.elementId));
    out.push({
      el,
      src,
      currentSrc: src,
      className,
      displayed: await displayed(el),
      width: Number(size.width) || 0,
      height: Number(size.height) || 0,
      inJitsi,
      selectorHint: iframeSelectorHint(src, className),
    });
  }
  return out;
}

async function driverSnapshot(browser) {
  const url = String(await browser.getUrl());
  let windowHandles = [];
  try {
    if (typeof browser.getWindowHandles === "function") {
      windowHandles = await browser.getWindowHandles();
    }
  } catch {
    windowHandles = [];
  }
  const iframes = await listIframes(browser);
  return { url, iframes, windowHandles };
}

async function captureBoardDom(browser, artifactName) {
  try {
    const snap = await driverSnapshot(browser);
    const safe = withoutElements(snap);
    if (artifactName) writeJson(`${artifactName}.json`, safe);
    return snap;
  } catch (err) {
    const diagnosticError = String((err && err.message) || err);
    if (artifactName) writeJson(`${artifactName}.json`, { diagnosticError });
    await screenshot(browser, artifactName || "board-diagnostic").catch(() => {});
    return { url: "", iframes: [], windowHandles: [], diagnosticError };
  }
}

async function findBoardOpenButton(browser) {
  const slot = await browser.$(SELECTORS.boardSlot);
  if (await slot.isExisting()) {
    const inSlot = await slot.$("button*=Открыть");
    if (await displayed(inSlot) && await inSlot.isEnabled()) {
      return { el: inSlot, selector: ".vl-board-slot button*=Открыть" };
    }
  }

  const items = await browser.$$(".vl-mat-item");
  for (const item of items) {
    const itemText = String(await item.getText().catch(() => ""));
    if (!/Интерактивная доска/.test(itemText)) continue;
    const btn = await item.$("button*=Открыть");
    if (await displayed(btn) && await btn.isEnabled()) {
      return { el: btn, selector: ".vl-mat-item button*=Открыть (Интерактивная доска)" };
    }
  }

  throw boardFail(
    "BOARD = TEST SELECTOR BUG",
    "Visible enabled «Открыть» for .vl-board-slot / Интерактивная доска was not found",
    { boardClick: "pending", classification: "TEST BUG", navigation: "pending" },
  );
}

async function resolveFrameElement(browser) {
  await leaveBoardFrame(browser);
  const frames = await listIframes(browser);
  const picked = pickBoardIframe(frames);
  if (picked && picked.el) {
    return {
      el: picked.el,
      selector: picked.selectorHint,
      width: picked.width,
      height: picked.height,
      displayed: picked.displayed,
    };
  }
  return null;
}

function isFrameSwitchError(err) {
  return /switchFrame|switch to frame|no such frame|doesn't exist/i.test(String((err && err.message) || err || ""));
}

async function enterBoardFrame(browser, { timeoutMs = 25_000 } = {}) {
  try {
    return await waitFor(browser, async () => {
      await leaveBoardFrame(browser);
      const frame = await resolveFrameElement(browser);
      if (!frame || !frame.el) return false;
      try {
        await browser.switchFrame(frame.el);
        return {
          selector: frame.selector,
          width: frame.width,
          height: frame.height,
          displayed: frame.displayed,
        };
      } catch (err) {
        await leaveBoardFrame(browser);
        if (!isFrameSwitchError(err) && !isStaleElementError(err) && !isWebDriverInfraError(err)) {
          throw err;
        }
        return false;
      }
    }, {
      timeoutMs,
      intervalMs: 400,
      message: "could not switch into a freshly queried board iframe",
    });
  } catch (err) {
    if (err instanceof FlowError) throw err;
    throw boardFail(
      "BOARD = TEST INFRA BUG",
      String((err && err.message) || err),
      { classification: "TEST INFRA BUG", boardClick: "PASS" },
    );
  }
}

async function inBoardContext(browser, opened, fn) {
  if (opened && opened.navigation === "route") {
    return fn();
  }
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const entered = await enterBoardFrame(browser);
      try {
        return await fn(entered);
      } finally {
        await leaveBoardFrame(browser);
      }
    } catch (err) {
      lastErr = err;
      const retryable = isStaleElementError(err) || isFrameSwitchError(err) || isWebDriverInfraError(err);
      if (!retryable || attempt === 2) throw err;
      await leaveBoardFrame(browser);
      await browser.pause(350);
    }
  }
  throw lastErr;
}

async function waitForBoardNavigation(browser, before) {
  return waitFor(browser, async () => {
    const after = await driverSnapshot(browser);
    const verdict = classifyBoardOpen(before, after);
    if (verdict.opened) return { after, verdict };
    return false;
  }, {
    timeoutMs: 25_000,
    intervalMs: 700,
    message: "board did not open after «Открыть»",
  });
}

async function openExistingBoard(browser, options = {}) {
  const quiet = Boolean(options.quiet);
  const prefix = String(options.artifactPrefix || "board");
  await leaveBoardFrame(browser);
  if (!quiet) await screenshot(browser, "materials-before-board");
  const before = await captureBoardDom(browser, quiet ? null : `${prefix}-before`);

  const { el, selector } = await findBoardOpenButton(browser);
  try {
    await el.scrollIntoView({ block: "center", inline: "nearest" });
  } catch {
    /* iOS may ignore scrollIntoView options */
  }
  const enabled = await el.isEnabled();
  if (!enabled) {
    throw productFail(
      "BOARD = PRODUCT MOBILE BUG",
      "Board «Открыть» is visible but disabled",
      { boardClick: "FAIL", classification: "PRODUCT BUG", navigation: "none" },
    );
  }
  await el.click();

  if (!quiet) await screenshot(browser, "board-after-open-click");
  const clicked = { boardClick: "PASS", clickedSelector: selector };

  let settled;
  try {
    settled = await waitForBoardNavigation(browser, before);
  } catch (err) {
    const after = await captureBoardDom(browser, quiet ? null : `${prefix}-after-open-click-state`);
    const verdict = classifyBoardOpen(before, after);
    if (!verdict.opened) {
      throw productFail(
        "BOARD = PRODUCT MOBILE BUG",
        `«Открыть» was enabled and clicked (${selector}) but URL/iframes did not change. ${String((err && err.message) || "")}`,
        {
          boardClick: "PASS",
          navigation: "none",
          container: null,
          classification: "PRODUCT BUG",
        },
      );
    }
    settled = { after, verdict };
  }

  await captureBoardDom(browser, quiet ? null : `${prefix}-after-settle`);
  if (!quiet) await screenshot(browser, "board-after-settle");

  const { verdict } = settled;
  if (verdict.iframeHidden) {
    throw productFail(
      "BOARD = PRODUCT MOBILE BUG",
      `board iframe found but width/height is 0 (${verdict.container})`,
      {
        boardClick: "PASS",
        navigation: verdict.navigation,
        container: verdict.container,
        classification: "PRODUCT BUG",
      },
    );
  }

  return {
    ...verdict,
    ...clicked,
    url: settled.after && settled.after.url,
  };
}

async function waitForBoardReady(browser, opened) {
  if (opened && opened.navigation === "route") {
    return waitFor(browser, async () => {
      const canvas = await lookupCanvas(browser);
      if (canvas && canvas.displayed && canvas.width > 0 && canvas.height > 0) {
        return { canvasW: canvas.width, canvasH: canvas.height, displayed: true };
      }
      return false;
    }, { timeoutMs: 45_000, intervalMs: 500, message: "canvas not ready on board route" });
  }

  let last = { entered: false, iframe: null, canvas: null, switchError: null };
  try {
    return await waitFor(browser, async () => {
      await leaveBoardFrame(browser);
      const frames = await listIframes(browser);
      const picked = pickBoardIframe(frames);
      last.iframe = picked
        ? {
          selector: picked.selectorHint,
          width: picked.width,
          height: picked.height,
          displayed: picked.displayed,
        }
        : null;
      if (!picked || !picked.el) return false;
      try {
        await browser.switchFrame(picked.el);
        last.entered = true;
        last.switchError = null;
        const canvas = await lookupCanvas(browser);
        last.canvas = canvas
          ? { width: canvas.width, height: canvas.height, displayed: canvas.displayed }
          : null;
        const ok = Boolean(canvas && canvas.displayed && canvas.width > 0 && canvas.height > 0);
        await leaveBoardFrame(browser);
        if (ok) {
          return { canvasW: canvas.width, canvasH: canvas.height, displayed: true };
        }
        return false;
      } catch (err) {
        last.entered = false;
        last.switchError = String((err && err.message) || err);
        await leaveBoardFrame(browser);
        return false;
      }
    }, {
      timeoutMs: 45_000,
      intervalMs: 500,
      message: "fresh board iframe/canvas not ready",
    });
  } catch (err) {
    if (last.entered && last.canvas && last.canvas.width < 1 && last.iframe && last.iframe.width > 1) {
      throw productFail(
        "CANVAS",
        `canvas not usable after fresh frame enter displayed=${last.canvas.displayed} size=${last.canvas.width}x${last.canvas.height} iframe=${JSON.stringify(last.iframe)}`,
        {
          boardClick: "PASS",
          navigation: opened && opened.navigation,
          container: "FAIL",
          classification: "PRODUCT BUG",
        },
      );
    }
    throw boardFail(
      "CANVAS = TEST INFRA BUG",
      `Could not enter a freshly queried board iframe/canvas. last=${JSON.stringify(last)} ${String((err && err.message) || err)}`,
      {
        boardClick: "PASS",
        navigation: opened && opened.navigation,
        container: opened && opened.container,
        classification: "TEST INFRA BUG",
      },
    );
  }
}

function isStaleElementError(err) {
  return /stale element reference/i.test(String((err && err.message) || err || ""));
}

async function lookupCanvas(browser) {
  const canvas = await browser.$(SELECTORS.excalidrawCanvas);
  const exists = await canvas.isExisting().catch(() => false);
  if (!exists) return null;
  const vis = await displayed(canvas);
  const size = await canvas.getSize().catch(() => ({ width: 0, height: 0 }));
  const loc = await canvas.getLocation().catch(() => ({ x: 0, y: 0 }));
  return {
    displayed: vis,
    width: Number(size.width) || 0,
    height: Number(size.height) || 0,
    x: Number(loc.x) || 0,
    y: Number(loc.y) || 0,
  };
}

function isReleaseActionsUnsupported(err) {
  const message = String((err && err.message) || err || "");
  return /when running "actions" with method "DELETE"/i.test(message)
    || (/mapped resource/i.test(message) && /DELETE/i.test(message) && /actions/i.test(message));
}

async function performTouchStroke(browser, startX, startY, endX, endY, { pauseMs = 80, moveMs = 450 } = {}) {
  const action = browser.action("pointer", { parameters: { pointerType: "touch" } })
    .move({ duration: 0, origin: "viewport", x: startX, y: startY })
    .down()
    .pause(pauseMs)
    .move({ duration: moveMs, origin: "viewport", x: endX, y: endY })
    .up();
  try {
    await action.perform(true);
  } catch (err) {
    if (isReleaseActionsUnsupported(err)) return;
    throw err;
  }
}

function strokePoints(canvas, index, variant) {
  const i = Number(index) || 0;
  if (variant === "fast") {
    const startX = Math.round(canvas.x + canvas.width * (0.22 + (i % 5) * 0.1));
    const startY = Math.round(canvas.y + canvas.height * (0.28 + Math.floor(i / 5) * 0.08));
    return {
      startX,
      startY,
      endX: startX + 28,
      endY: startY + 10,
      pauseMs: 20,
      moveMs: 90,
    };
  }
  const startX = Math.round(canvas.x + canvas.width * (0.22 + (i % 4) * 0.08));
  const startY = Math.round(canvas.y + canvas.height * (0.32 + (i % 3) * 0.08));
  return {
    startX,
    startY,
    endX: Math.round(canvas.x + canvas.width * 0.72),
    endY: Math.round(startY + canvas.height * 0.12),
    pauseMs: 80,
    moveMs: 450,
  };
}

async function selectFreedrawTool(browser, { focusTap = true } = {}) {
  if (focusTap) {
    const fresh = await lookupCanvas(browser);
    if (fresh && fresh.width > 0) {
      const x = Math.round(fresh.x + fresh.width * 0.5);
      const y = Math.round(fresh.y + fresh.height * 0.5);
      try {
        await performTouchStroke(browser, x, y, x + 1, y + 1, { pauseMs: 20, moveMs: 20 });
      } catch {
        /* focus tap; ignore infra */
      }
      await browser.pause(200);
    }
  }
  const tool = await browser.$(`[data-testid="${SELECTORS.toolFreedraw}"]`);
  try {
    await tool.waitForExist({ timeout: 20_000 });
  } catch (err) {
    throw boardFail("DRAW", `freedraw tool not in board document: ${String((err && err.message) || err)}`, {
      classification: "TEST BUG",
      boardClick: "PASS",
    });
  }
  const pressed = String(await tool.getAttribute("aria-pressed").catch(() => "") || "");
  const checked = String(await tool.getAttribute("aria-checked").catch(() => "") || "");
  if (pressed === "true" || checked === "true") return;
  try {
    await tool.scrollIntoView({ block: "center" });
  } catch {
    /* iOS may ignore */
  }
  await tool.click();
}

async function strokeOnceInFrame(browser, { variant = "normal", index = 0, screenshotName = null } = {}) {
  await selectFreedrawTool(browser);
  if (variant !== "fast") await browser.pause(200);

  const fresh = await lookupCanvas(browser);
  if (!fresh || !fresh.displayed || fresh.width < 1 || fresh.height < 1) {
    throw productFail("DRAW", "canvas missing after freedraw tool click", {
      classification: "PRODUCT BUG",
      boardClick: "PASS",
    });
  }

  const pts = strokePoints(fresh, index, variant);
  await performTouchStroke(browser, pts.startX, pts.startY, pts.endX, pts.endY, {
    pauseMs: pts.pauseMs,
    moveMs: pts.moveMs,
  });

  const after = await lookupCanvas(browser);
  if (!after || !after.displayed || after.width < 1 || after.height < 1) {
    throw productFail("DRAW", "canvas gone after stroke", {
      classification: "PRODUCT BUG",
      boardClick: "PASS",
    });
  }
  if (screenshotName) await screenshot(browser, screenshotName);
  return {
    stroke: true,
    skipRelease: true,
    variant,
    start: { x: pts.startX, y: pts.startY },
    end: { x: pts.endX, y: pts.endY },
    canvas: { width: after.width, height: after.height, displayed: after.displayed },
  };
}

function wrapDrawError(err, { firstDraw = false, strokeSucceededBefore = false } = {}) {
  const proven = strokeSucceededBefore && !firstDraw;
  if (err instanceof FlowError && err.classification === "BOARD FREEZE" && proven) return err;
  if (isStaleElementError(err) || isReleaseActionsUnsupported(err) || isFrameSwitchError(err) || isWebDriverInfraError(err)) {
    return boardFail("DRAW", String((err && err.message) || err), {
      classification: /TEST INFRA/i.test(String((err && err.code) || "")) ? "TEST INFRA BUG" : "TEST BUG",
      boardClick: "PASS",
    });
  }
  if (!proven) {
    return boardFail("DRAW", String((err && err.message) || err), {
      classification: (err && err.classification) || "TEST BUG",
      boardClick: "PASS",
    });
  }
  if (err instanceof FlowError) return err;
  return boardFail("DRAW", String((err && err.message) || err), {
    classification: "TEST BUG",
    boardClick: "PASS",
  });
}

async function drawStroke(browser, opened, opts = {}) {
  const wrapOpts = { firstDraw: Boolean(opts.firstDraw), strokeSucceededBefore: Boolean(opts.strokeSucceededBefore) };
  return inBoardContext(browser, opened || { navigation: "iframe" }, async () => {
    try {
      return await strokeOnceInFrame(browser, {
        variant: opts.variant || "normal",
        index: opts.index || 0,
        screenshotName: opts.screenshot === false ? null : (opts.screenshotName || "board-after-draw"),
      });
    } catch (err) {
      throw wrapDrawError(err, wrapOpts);
    }
  });
}

async function drawStrokes(browser, opened, count, opts = {}) {
  const variant = opts.variant || "normal";
  const results = [];
  const wrapOpts = { firstDraw: false, strokeSucceededBefore: Boolean(opts.strokeSucceededBefore) };
  return inBoardContext(browser, opened || { navigation: "iframe" }, async () => {
    try {
      for (let i = 0; i < count; i += 1) {
        results.push(await strokeOnceInFrame(browser, {
          variant,
          index: i,
          screenshotName: null,
        }));
      }
      return { count: results.length, variant, last: results[results.length - 1] || null };
    } catch (err) {
      throw wrapDrawError(err, wrapOpts);
    }
  });
}

async function insertTextIfSupported(browser, opened) {
  return inBoardContext(browser, opened || { navigation: "iframe" }, async () => {
    try {
      const tool = await browser.$(`[data-testid="${SELECTORS.toolText}"]`);
      if (!(await tool.isExisting().catch(() => false)) || !(await displayed(tool))) {
        return { skipped: true, reason: "text tool missing" };
      }
      await tool.click();
      const fresh = await lookupCanvas(browser);
      if (!fresh || !fresh.displayed) return { skipped: true, reason: "canvas missing" };
      const x = Math.round(fresh.x + fresh.width * 0.4);
      const y = Math.round(fresh.y + fresh.height * 0.35);
      await performTouchStroke(browser, x, y, x + 2, y + 2, { pauseMs: 40, moveMs: 40 });
      const wysiwyg = await browser.$(SELECTORS.wysiwyg);
      if (!(await displayed(wysiwyg).catch(() => false))) {
        return { skipped: true, reason: "wysiwyg not shown" };
      }
      await wysiwyg.setValue("itflux");
      return { skipped: false };
    } catch (err) {
      if (isStaleElementError(err) || isReleaseActionsUnsupported(err)) {
        return { skipped: true, reason: String((err && err.message) || err).slice(0, 180) };
      }
      return { skipped: true, reason: String((err && err.message) || err).slice(0, 180) };
    }
  });
}

async function panZoomIfSupported(browser, opened) {
  return inBoardContext(browser, opened || { navigation: "iframe" }, async () => {
    try {
      const fresh = await lookupCanvas(browser);
      if (!fresh || !fresh.displayed) return { skipped: true, reason: "canvas missing" };
      const x = Math.round(fresh.x + fresh.width * 0.5);
      const y = Math.round(fresh.y + fresh.height * 0.5);
      await performTouchStroke(browser, x - 50, y, x + 40, y + 12, { pauseMs: 40, moveMs: 280 });
      const after = await lookupCanvas(browser);
      if (!after || !after.displayed || after.width < 1 || after.height < 1) {
        throw productFail("DRAW", "canvas gone after pan", {
          classification: "PRODUCT BUG",
          boardClick: "PASS",
        });
      }
      return { skipped: false, canvas: { width: after.width, height: after.height } };
    } catch (err) {
      if (err instanceof FlowError) throw err;
      if (isStaleElementError(err) || isReleaseActionsUnsupported(err)) {
        return { skipped: true, reason: String((err && err.message) || err).slice(0, 180) };
      }
      return { skipped: true, reason: String((err && err.message) || err).slice(0, 180) };
    }
  });
}

function countBoardIframes(iframes) {
  return (iframes || []).filter((frame) => {
    if (frame.inJitsi) return false;
    return /\bvideo-lesson-workspace__frame--board\b/.test(String(frame.className || ""))
      || isBoardSrc(frame.src);
  }).length;
}

module.exports = {
  leaveBoardFrame,
  openExistingBoard,
  waitForBoardReady,
  drawStroke,
  drawStrokes,
  insertTextIfSupported,
  panZoomIfSupported,
  captureBoardDom,
  classifyBoardOpen,
  pickBoardIframe,
  listIframes,
  lookupCanvas,
  inBoardContext,
  enterBoardFrame,
  resolveFrameElement,
  countBoardIframes,
  isStaleElementError,
  isReleaseActionsUnsupported,
  wrapDrawError,
  selectFreedrawTool,
  performTouchStroke,
  strokePoints,
  isFrameSwitchError,
};
