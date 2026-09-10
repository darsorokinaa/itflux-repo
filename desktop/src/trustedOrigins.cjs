const TRUSTED_ORIGINS = Object.freeze([
  "https://itflux-academy.ru",
  "https://lesson.itflux-academy.ru",
]);

const ALLOWED_DESKTOP_PERMISSIONS = Object.freeze([
  "media",
  "display-capture",
  "fullscreen",
]);

function parseUrl(url) {
  try {
    return new URL(String(url || ""));
  } catch {
    return null;
  }
}

function isTrustedDesktopURL(url, { allowHttpLocalhost = false } = {}) {
  const parsed = parseUrl(url);
  if (!parsed) return false;
  if (parsed.username || parsed.password) return false;
  if (TRUSTED_ORIGINS.includes(parsed.origin)) return true;
  if (
    allowHttpLocalhost
    && parsed.protocol === "http:"
    && (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1")
  ) {
    return true;
  }
  return false;
}

function isSafeExternalHttpsURL(url) {
  const parsed = parseUrl(url);
  if (!parsed) return false;
  if (parsed.protocol !== "https:") return false;
  if (parsed.username || parsed.password) return false;
  return Boolean(parsed.hostname);
}

function isAllowedDesktopPermission(permission, requestingUrl, options) {
  if (!ALLOWED_DESKTOP_PERMISSIONS.includes(String(permission || ""))) return false;
  return isTrustedDesktopURL(requestingUrl, options);
}

function isUnpackagedElectronProcess() {
  if (typeof process === "undefined") return false;
  if (process.defaultApp) return true;
  return /[\\/]electron([.]exe)?$/i.test(String(process.execPath || ""));
}

module.exports = {
  TRUSTED_ORIGINS,
  ALLOWED_DESKTOP_PERMISSIONS,
  isTrustedDesktopURL,
  isSafeExternalHttpsURL,
  isAllowedDesktopPermission,
  isUnpackagedElectronProcess,
};
