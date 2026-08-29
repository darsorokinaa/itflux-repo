/**
 * Stable locators taken from production frontend source.
 * Do not add random CSS classNames when a role / testid / aria-label exists.
 */

const SELECTORS = {
  // CabinetAuthPage.jsx — route in App.jsx
  loginPath: "/cabinet/login",
  authTablist: { role: "tablist", name: "Режим авторизации" },
  loginTab: { role: "tab", name: "Вход" },
  loginField: "Email или логин",
  passwordField: "Пароль",
  submitLogin: { role: "button", name: "Войти" },
  authError: { role: "alert" },
  authChecking: "Проверяем сессию…",
  authTitleLogin: "Вход в аккаунт",
  logout: { role: "button", name: "Выйти" },
  openMenu: { role: "button", name: "Открыть меню" },
  closeMenu: { role: "button", name: "Закрыть меню" },
  cabinetNav: { role: "navigation", name: /Разделы кабинета/ },

  // VideoMeetingPage.jsx — route /cabinet/meetings/:meetingUuid
  roomRoot: ".video-lesson-page",
  roomHeader: "header.video-lesson-header",
  roomLoading: "Загрузка…",
  roomJoinError: "Не удалось войти во встречу",
  roomJoinErrorSubtitle: ".video-lesson-state__text",
  cameraPromptTitle: "Включить камеру?",
  cameraWithout: { role: "button", name: "Без камеры" },
  cameraWith: { role: "button", name: "С камерой" },
  startLesson: { role: "button", name: "Начать урок" },

  screenModeTablist: { role: "tablist", name: "Режим экрана" },
  tabCall: { role: "tab", name: "Звонок" },
  tabMaterials: { role: "tab", name: "Материалы" },
  headerMaterials: { role: "button", name: /Материалы/ },
  closeMaterial: { role: "button", name: "Закрыть материал" },
  closeMaterialsPanel: { role: "button", name: "Закрыть материалы" },
  fullscreen: { role: "button", name: /Полноэкранный режим|Выйти из полноэкранного режима/ },
  finishCall: { role: "button", name: "Завершить звонок" },

  materialsAside: { role: "complementary", name: "Материалы урока" },
  materialsTitle: "Материалы урока",
  workspace: { role: "region", name: "Просмотр материала" },
  boardIframeSrc: 'iframe[src*="/cabinet/boards/"]',
  boardOpenButton: { role: "button", name: "Открыть" },
  boardCreateButton: { role: "button", name: /^(Создать|Создать новую)$/ },
  boardCreateModalTitle: "Создать доску",
  boardCreateTitleField: "Название доски",
  boardCreateSubmit: { role: "button", name: "Создать" },

  // Compact/PiP call — <main class="video-lesson-content">
  callMain: "main.video-lesson-content",
  compactCallPage: ".video-lesson-page--compact",
  compactDrag: ".video-lesson-compact-drag",
  compactShowHide: { role: "button", name: /Показать|Скрыть/ },
  compactExpand: { role: "button", name: "На весь экран" },

  // Jitsi host — VideoMeetingPage.jsx id="jitsi-container"
  jitsiHost: ".video-lesson-jitsi-host",
  jitsiContainer: "#jitsi-container",
  jitsiIframe: "#jitsi-container iframe",

  // CabinetBoardEditorPage.tsx + BoardExcalidrawCanvas.tsx
  boardEditor: ".cb-board-editor",
  boardCanvasWrap: ".cb-board-editor__canvas",
  boardHost: ".cb-board-excalidraw-host",
  excalidrawCanvas: "canvas.excalidraw__canvas",
  boardTitle: { name: "Название доски" },
  canvasSettings: { role: "button", name: "Настройки холста" },
  boardLoading: "Загружаем доску…",

  // Excalidraw 0.18 — same data-testid family as boards.css
  toolFreedraw: "toolbar-freedraw",
  toolText: "toolbar-text",
  toolImage: "toolbar-image",
  toolEraser: "toolbar-eraser",
  toolSelection: "toolbar-selection",
  wysiwyg: "textarea.excalidraw-wysiwyg",
  fileInput: 'input[type="file"]',

  // Existing observability — boardCollab.ts / clientTelemetry.js
  boardSyncDebugKey: "itflux_board_sync_debug",
};

function errorText(err) {
  return String((err && err.message) || err || "");
}

function isTimeoutLikeError(err) {
  const name = String((err && err.name) || "");
  const msg = errorText(err);
  if (name === "TimeoutError") return true;
  if (/Timeout \d+ms exceeded/i.test(msg)) return true;
  if (/Test timeout of \d+ms exceeded/i.test(msg)) return true;
  if (/waitFor(Function|Timeout|URL|LoadState|Event)/i.test(msg) && /timeout/i.test(msg)) return true;
  if (/locator.*timeout/i.test(msg)) return true;
  if (/navigation timeout/i.test(msg)) return true;
  if (/Exceeded timeout/i.test(msg)) return true;
  if (/Element not found or stale/i.test(msg)) return true;
  if (/stale element/i.test(msg)) return true;
  if (/not attached to the (DOM|page)/i.test(msg)) return true;
  if (/element(?: is)? not visible/i.test(msg)) return true;
  if (/board (host|canvas).*(zero|0)/i.test(msg)) return true;
  if (/button not clickable/i.test(msg)) return true;
  if (/Room did not load/i.test(msg)) return true;
  if (/canvas missing/i.test(msg)) return true;
  return false;
}

function isBrowserStackInfraError(err) {
  if (isTimeoutLikeError(err)) return false;
  // Match the message only — BrowserStack hub URLs appear in TimeoutError stacks.
  const msg = errorText(err);
  return (
    /session not created/i.test(msg)
    || /Could not start a new session/i.test(msg)
    || /Failed to create (a )?session/i.test(msg)
    || /device is busy/i.test(msg)
    || /All parallel tests are currently in use/i.test(msg)
    || /No matching devices found/i.test(msg)
    || /unsupported device/i.test(msg)
    || /remote device (is )?(unavailable|offline)/i.test(msg)
    || /device (is )?(unavailable|offline)/i.test(msg)
    || /disconnected: not connected to DevTools/i.test(msg)
    || /Could not connect to BrowserStack/i.test(msg)
    || /BrowserStack.*(connect|connection).*(fail|error|refused|reset)/i.test(msg)
    || /BrowserStack.+(?:ECONNRESET|socket hang up|ENOTFOUND|ECONNREFUSED)/i.test(msg)
    || /ERROR_INVALID_CREDENTIALS/i.test(msg)
  );
}

module.exports = { SELECTORS, isTimeoutLikeError, isBrowserStackInfraError };
