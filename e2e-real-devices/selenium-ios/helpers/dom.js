const { sleep, isRunAborted, currentLifecycle } = require("./lifecycle");

const SELECTORS = {
  loginPath: "/cabinet/login",
  loginTab: "Вход",
  loginField: "Email или логин",
  passwordField: "Пароль",
  submitLogin: "Войти",
  roomRoot: ".video-lesson-page",
  roomJoinError: "Не удалось войти во встречу",
  roomJoinErrorSubtitle: ".video-lesson-state__text",
  cameraPromptTitle: "Включить камеру?",
  cameraWithout: "Без камеры",
  startLesson: "Начать урок",
  screenModeTablist: "Режим экрана",
  tabCall: "Звонок",
  tabMaterials: "Материалы",
  headerMaterials: "Материалы",
  materialsAside: "Материалы урока",
  materialsPanel: "aside.video-lesson-aside",
  materialsPanelByLabel: 'aside[aria-label="Материалы урока"]',
  mobileSwitch: ".video-lesson-mobile-switch",
  mobileMaterialsPage: ".video-lesson-page--mobile-materials",
  boardIframeSrc: 'iframe[src*="/cabinet/boards/"]',
  boardWorkspaceFrame: "iframe.video-lesson-workspace__frame--board",
  boardWorkspaceFrameAny: "iframe.video-lesson-workspace__frame",
  boardSlot: ".vl-board-slot",
  boardWorkspaceSection: 'section.video-lesson-workspace, section[aria-label="Просмотр материала"]',
  boardOpenButton: "Открыть",
  jitsiContainer: "#jitsi-container",
  jitsiIframe: "#jitsi-container iframe",
  boardHost: ".cb-board-excalidraw-host",
  excalidrawCanvas: "canvas.excalidraw__canvas",
  toolFreedraw: "toolbar-freedraw",
  toolText: "toolbar-text",
  wysiwyg: "textarea.excalidraw-wysiwyg",
  boardSyncDebugKey: "itflux_board_sync_debug",
  cookieBanner: ".cookie-banner",
  cookieBannerText: ".cookie-banner-text",
  cookieAcceptBtn: ".cookie-banner-btn",
  cookieAccept: "Принять",
};

function xpathButton(name) {
  const q = JSON.stringify(name);
  return `xpath:(//button[normalize-space()=${q}] | //*[@role="button" and normalize-space()=${q}])`;
}

function xpathTab(name) {
  return `xpath://*[@role="tab" and normalize-space()=${JSON.stringify(name)}]`;
}

async function displayed(el) {
  try {
    return Boolean(el && await el.isDisplayed());
  } catch {
    return false;
  }
}

async function waitFor(browser, fn, { timeoutMs = 30_000, intervalMs = 500, message = "waitFor timed out", signal } = {}) {
  const started = Date.now();
  const life = currentLifecycle();
  while (Date.now() - started < timeoutMs) {
    if (isRunAborted(signal)) {
      const err = new Error(`${message}: device run aborted`);
      err.productFailure = false;
      err.classification = "TEST BUG";
      throw err;
    }
    const value = life ? await life.track(fn()) : await fn();
    if (value) return value;
    await sleep(intervalMs, signal);
  }
  throw new Error(message);
}

class FlowError extends Error {
  constructor(code, message, extras = {}) {
    super(message);
    this.name = "FlowError";
    this.code = code;
    if (Object.prototype.hasOwnProperty.call(extras, "productFailure")) {
      this.productFailure = Boolean(extras.productFailure);
    }
    this.classification = extras.classification || null;
    this.navigation = extras.navigation || null;
    this.container = extras.container || null;
    this.boardClick = extras.boardClick || null;
    if (Object.prototype.hasOwnProperty.call(extras, "strokeSucceededBefore")) {
      this.strokeSucceededBefore = Boolean(extras.strokeSucceededBefore);
    }
    if (extras.failedStep) this.failedStep = extras.failedStep;
  }
}

module.exports = {
  SELECTORS,
  xpathButton,
  xpathTab,
  displayed,
  waitFor,
  FlowError,
};
