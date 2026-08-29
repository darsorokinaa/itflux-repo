const { SELECTORS } = require("./selectors");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function displayed(el) {
  try {
    return Boolean(el && await el.isDisplayed());
  } catch {
    return false;
  }
}

async function clickIfDisplayed(el) {
  if (await displayed(el)) {
    await el.click();
    return true;
  }
  return false;
}

async function waitFor(browser, fn, { timeoutMs = 30_000, intervalMs = 500, message = "waitFor timed out" } = {}) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeoutMs) {
    last = await fn();
    if (last) return last;
    await browser.pause(intervalMs);
  }
  throw new Error(message);
}

function xpathButton(name) {
  const q = JSON.stringify(name);
  return `xpath:(//button[normalize-space()=${q}] | //*[@role="button" and normalize-space()=${q}])`;
}

function xpathTab(name) {
  return `xpath://*[@role="tab" and normalize-space()=${JSON.stringify(name)}]`;
}

async function $(browser, selector) {
  return browser.$(selector);
}

async function loginIfNeeded(browser, { origin, login, password }) {
  const loginUrl = `${origin}${SELECTORS.loginPath}`;
  await browser.url(loginUrl);

  const loginInputXpath = `xpath://label[.//span[contains(., ${JSON.stringify(SELECTORS.loginField)})]]//input`;
  const appeared = await waitFor(browser, async () => {
    const url = String(await browser.getUrl());
    if (!url.includes("/cabinet/login")) return "already";
    const loginInput = await $(browser, loginInputXpath);
    if (await displayed(loginInput)) return "form";
    return false;
  }, { timeoutMs: 25_000, message: "Neither login form nor authenticated cabinet appeared" });

  if (appeared === "already") {
    return { alreadyAuthenticated: true };
  }

  const loginTab = await $(browser, xpathTab(SELECTORS.loginTab));
  await clickIfDisplayed(loginTab);

  const loginInput = await $(browser, loginInputXpath);
  await loginInput.waitForDisplayed({ timeout: 20_000 });
  await loginInput.click();
  await loginInput.setValue(login);

  const passwordInput = await $(browser, `xpath://label[.//span[contains(., ${JSON.stringify(SELECTORS.passwordField)})]]//input`);
  await passwordInput.click();
  await passwordInput.setValue(password);

  const submit = await $(browser, xpathButton(SELECTORS.submitLogin));
  await submit.click();

  await waitFor(browser, async () => {
    const stillLogin = String(await browser.getUrl()).includes("/cabinet/login");
    const form = await $(browser, loginInputXpath);
    if (!stillLogin) return true;
    return !(await displayed(form));
  }, { timeoutMs: 45_000, message: "Login did not leave /cabinet/login" });

  return { alreadyAuthenticated: false };
}

async function enableBoardDebug(browser) {
  await browser.execute((key) => {
    try {
      window.localStorage.setItem(key, "1");
    } catch {
      /* private mode */
    }
  }, SELECTORS.boardSyncDebugKey);
}

async function clickWithoutCamera(browser) {
  const btn = await $(browser, xpathButton(SELECTORS.cameraWithout));
  const shown = await waitFor(browser, async () => {
    if (await displayed(btn)) return "camera";
    const count = await jitsiIframeCount(browser);
    const tablist = await $(browser, `xpath://*[@role="tablist" and @aria-label=${JSON.stringify(SELECTORS.screenModeTablist)}]`);
    if (count >= 1 && await displayed(tablist)) return "already-live";
    return false;
  }, { timeoutMs: 60_000, message: "Neither «Без камеры» nor live room UI appeared" });
  if (shown === "already-live") return false;
  await btn.click();
  return true;
}

async function clickStartLessonIfWaiting(browser) {
  const btn = await $(browser, xpathButton(SELECTORS.startLesson));
  if (await displayed(btn)) {
    await btn.click();
    return true;
  }
  return false;
}

async function joinErrorVisible(browser) {
  const el = await $(browser, `xpath://*[normalize-space()=${JSON.stringify(SELECTORS.roomJoinError)}]`);
  return displayed(el);
}

async function jitsiIframeCount(browser) {
  const frames = await browser.$$(SELECTORS.jitsiIframe);
  return frames.length;
}

async function waitForSuccessfulJoin(browser, { timeoutMs = 60_000 } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await joinErrorVisible(browser)) {
      const subtitle = await $(browser, ".video-lesson-state__text");
      const text = await displayed(subtitle) ? await subtitle.getText() : "";
      throw new Error(`Join error screen: ${SELECTORS.roomJoinError} ${text}`.trim());
    }
    const root = await $(browser, SELECTORS.roomRoot);
    const iframeCount = await jitsiIframeCount(browser);
    const tablist = await $(browser, `xpath://*[@role="tablist" and @aria-label=${JSON.stringify(SELECTORS.screenModeTablist)}]`);
    const materials = await $(browser, xpathTab(SELECTORS.tabMaterials));
    const header = await $(browser, `xpath://button[contains(normalize-space(), ${JSON.stringify(SELECTORS.headerMaterials)})]`);
    const liveUi = (await displayed(tablist)) || (await displayed(materials)) || (await displayed(header));
    if ((await displayed(root)) && iframeCount >= 1 && liveUi) {
      return { iframeCount, waitedMs: Date.now() - started };
    }
    await browser.pause(1_000);
  }
  throw new Error("Jitsi conference join did not reach room UI after microphone Allow");
}

async function switchToCall(browser) {
  const tab = await $(browser, xpathTab(SELECTORS.tabCall));
  if (await displayed(tab)) {
    await tab.click();
    return;
  }
  const expand = await $(browser, xpathButton("На весь экран"));
  await clickIfDisplayed(expand);
}

async function switchToMaterials(browser) {
  const tab = await $(browser, xpathTab(SELECTORS.tabMaterials));
  if (await displayed(tab)) {
    await tab.click();
  } else {
    const header = await $(browser, `xpath://button[contains(normalize-space(), ${JSON.stringify(SELECTORS.headerMaterials)})]`);
    await header.click();
  }
  const aside = await $(browser, `xpath://*[@role="complementary" and @aria-label=${JSON.stringify(SELECTORS.materialsAside)}]`);
  await aside.waitForDisplayed({ timeout: 20_000 });
  return aside;
}

async function openExistingBoard(browser) {
  await switchToMaterials(browser);
  const openBtn = await $(browser, xpathButton(SELECTORS.boardOpenButton));
  await openBtn.waitForDisplayed({ timeout: 20_000 });
  await openBtn.click();
}

async function waitForBoardReady(browser) {
  const iframe = await $(browser, SELECTORS.boardIframeSrc);
  await iframe.waitForDisplayed({ timeout: 45_000 });
  await browser.switchToFrame(iframe);
  try {
    const host = await $(browser, SELECTORS.boardHost);
    const canvas = await $(browser, SELECTORS.excalidrawCanvas);
    await host.waitForDisplayed({ timeout: 45_000 });
    await canvas.waitForDisplayed({ timeout: 45_000 });
    const size = await browser.execute(() => {
      const h = document.querySelector(".cb-board-excalidraw-host");
      const c = document.querySelector("canvas.excalidraw__canvas");
      const hb = h && h.getBoundingClientRect();
      const cb = c && c.getBoundingClientRect();
      return {
        hostW: hb ? hb.width : 0,
        hostH: hb ? hb.height : 0,
        canvasW: cb ? cb.width : 0,
        canvasH: cb ? cb.height : 0,
      };
    });
    if (size.hostW < 2 || size.hostH < 2 || size.canvasW < 2 || size.canvasH < 2) {
      throw new Error(`board host/canvas zero size ${JSON.stringify(size)}`);
    }
    return size;
  } finally {
    await browser.switchToParentFrame();
  }
}

async function inBoardFrame(browser, fn) {
  const iframe = await $(browser, SELECTORS.boardIframeSrc);
  await iframe.waitForDisplayed({ timeout: 20_000 });
  await browser.switchToFrame(iframe);
  try {
    return await fn();
  } finally {
    await browser.switchToParentFrame();
  }
}

async function drawStroke(browser) {
  await inBoardFrame(browser, async () => {
    const tool = await $(browser, `[data-testid="${SELECTORS.toolFreedraw}"]`);
    await tool.waitForDisplayed({ timeout: 20_000 });
    await tool.click();
    const canvas = await $(browser, `${SELECTORS.excalidrawCanvas}.interactive, ${SELECTORS.excalidrawCanvas}`);
    await canvas.waitForDisplayed({ timeout: 10_000 });
    const size = await canvas.getSize();
    await browser.action("pointer", { parameters: { pointerType: "touch" } })
      .move({ duration: 0, origin: canvas, x: Math.round(-size.width * 0.2), y: Math.round(-size.height * 0.1) })
      .down()
      .pause(40)
      .move({ duration: 400, origin: canvas, x: Math.round(size.width * 0.15), y: Math.round(size.height * 0.08) })
      .up()
      .perform();
  });
}

async function addText(browser, text) {
  await inBoardFrame(browser, async () => {
    const tool = await $(browser, `[data-testid="${SELECTORS.toolText}"]`);
    await tool.waitForDisplayed({ timeout: 20_000 });
    await tool.click();
    const canvas = await $(browser, `${SELECTORS.excalidrawCanvas}.interactive, ${SELECTORS.excalidrawCanvas}`);
    await canvas.click();
    const editor = await $(browser, SELECTORS.wysiwyg);
    await editor.waitForDisplayed({ timeout: 10_000 });
    await editor.setValue(text);
    await browser.keys(["Escape"]);
  });
}

async function assertNoHorizontalOverflow(browser) {
  const box = await browser.execute(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  if (box.scrollWidth > box.clientWidth + 2) {
    throw new Error(`horizontal overflow scrollWidth=${box.scrollWidth} clientWidth=${box.clientWidth}`);
  }
}

async function tryCreateBoard(browser, title) {
  try {
    await switchToMaterials(browser);
    let createBtn = await $(browser, xpathButton(SELECTORS.boardCreateButton));
    if (!(await displayed(createBtn))) {
      createBtn = await $(browser, xpathButton(SELECTORS.boardCreateButtonAlt));
    }
    if (!(await displayed(createBtn))) {
      return { created: false, reason: "create-board control not visible" };
    }
    await createBtn.click();
    const q = JSON.stringify(SELECTORS.boardCreateTitleField);
    const titleField = await $(browser, `xpath:(//label[contains(., ${q})]//input | //input[@aria-label=${q}])`);
    await titleField.waitForDisplayed({ timeout: 15_000 });
    await titleField.setValue(title);
    const submit = await $(browser, xpathButton(SELECTORS.boardCreateSubmit));
    await submit.click();
    await browser.pause(1_500);
    const openBtn = await $(browser, xpathButton(SELECTORS.boardOpenButton));
    await openBtn.waitForDisplayed({ timeout: 30_000 });
    await openBtn.click();
    await waitForBoardReady(browser);
    await drawStroke(browser);
    return { created: true, title };
  } catch (err) {
    return { created: false, reason: String((err && err.message) || err) };
  }
}

module.exports = {
  sleep,
  displayed,
  waitFor,
  loginIfNeeded,
  enableBoardDebug,
  clickWithoutCamera,
  clickStartLessonIfWaiting,
  joinErrorVisible,
  jitsiIframeCount,
  waitForSuccessfulJoin,
  switchToCall,
  switchToMaterials,
  openExistingBoard,
  waitForBoardReady,
  drawStroke,
  addText,
  assertNoHorizontalOverflow,
  tryCreateBoard,
};
