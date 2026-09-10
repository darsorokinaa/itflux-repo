const { app, BrowserWindow, dialog, session, shell } = require("electron");
const path = require("node:path");

const { setupRemoteControlMain, setupScreenSharingMain } = require("@jitsi/electron-sdk/main");
const {
  isAllowedDesktopPermission,
  isSafeExternalHttpsURL,
  isTrustedDesktopURL,
} = require("./trustedOrigins.cjs");

const APP_NAME = "Цифровой поток";
const OSX_BUNDLE_ID = "ru.itflux.desktop";
const DEFAULT_URL = "https://itflux-academy.ru/cabinet/";

function allowHttpLocalhost() {
  return !app.isPackaged;
}

function trustedUrlOptions() {
  return { allowHttpLocalhost: allowHttpLocalhost() };
}

function resolveStartUrl(argv) {
  const explicit = argv.find((arg) => arg.startsWith("--url="));
  const candidate = explicit
    ? explicit.slice("--url=".length)
    : (argv.find((arg) => /^https?:\/\//.test(arg)) || process.env.ITFLUX_DESKTOP_URL || DEFAULT_URL);
  if (isTrustedDesktopURL(candidate, trustedUrlOptions())) {
    return candidate;
  }
  return DEFAULT_URL;
}

function createWindow() {
  const preload = path.join(__dirname, "..", "dist", "preload.cjs");
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: APP_NAME,
    webPreferences: {
      preload,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  setupScreenSharingMain(win, APP_NAME, OSX_BUNDLE_ID);
  setupRemoteControlMain(win, {
    async requestConsent() {
      const { response } = await dialog.showMessageBox(win, {
        type: "warning",
        buttons: ["Отклонить", "Разрешить"],
        defaultId: 0,
        cancelId: 0,
        message: "Разрешить удалённое управление вашим компьютером?",
        detail: "Участник текущего звонка сможет управлять мышью и клавиатурой на демонстрируемом экране. Имя в запросе конференции не является доказанной личностью. Вы в любой момент можете остановить управление клавишей Esc или кнопкой «Остановить управление».",
      });
      return response === 1;
    },
  });

  const blockUntrusted = (event, url) => {
    if (!isTrustedDesktopURL(url, trustedUrlOptions())) {
      event.preventDefault();
    }
  };
  win.webContents.on("will-navigate", blockUntrusted);
  win.webContents.on("will-redirect", blockUntrusted);

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalHttpsURL(url)) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });

  win.loadURL(resolveStartUrl(process.argv.slice(1)));
  return win;
}

app.setName(APP_NAME);

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    const requestingUrl = details?.requestingUrl || details?.securityOrigin || "";
    callback(isAllowedDesktopPermission(permission, requestingUrl, trustedUrlOptions()));
  });
  session.defaultSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin, details) => {
    const requestingUrl = details?.requestingUrl || requestingOrigin || "";
    return isAllowedDesktopPermission(permission, requestingUrl, trustedUrlOptions());
  });
  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
