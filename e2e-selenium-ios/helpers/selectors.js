/**
 * Locators from production frontend (same contracts as e2e-real-devices).
 * Do not invent CSS classNames.
 */
const SELECTORS = {
  loginPath: "/cabinet/login",
  loginTab: "Вход",
  loginField: "Email или логин",
  passwordField: "Пароль",
  submitLogin: "Войти",
  authTitleLogin: "Вход в аккаунт",
  roomRoot: ".video-lesson-page",
  roomJoinError: "Не удалось войти во встречу",
  cameraPromptTitle: "Включить камеру?",
  cameraWithout: "Без камеры",
  startLesson: "Начать урок",
  screenModeTablist: "Режим экрана",
  tabCall: "Звонок",
  tabMaterials: "Материалы",
  headerMaterials: "Материалы",
  materialsAside: "Материалы урока",
  boardIframeSrc: 'iframe[src*="/cabinet/boards/"]',
  boardOpenButton: "Открыть",
  boardCreateButton: "Создать",
  boardCreateButtonAlt: "Создать новую",
  boardCreateModalTitle: "Создать доску",
  boardCreateTitleField: "Название доски",
  boardCreateSubmit: "Создать",
  jitsiContainer: "#jitsi-container",
  jitsiIframe: "#jitsi-container iframe",
  boardHost: ".cb-board-excalidraw-host",
  excalidrawCanvas: "canvas.excalidraw__canvas",
  toolFreedraw: "toolbar-freedraw",
  toolText: "toolbar-text",
  wysiwyg: "textarea.excalidraw-wysiwyg",
  boardSyncDebugKey: "itflux_board_sync_debug",
};

module.exports = { SELECTORS };
