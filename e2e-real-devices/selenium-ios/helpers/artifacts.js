const fs = require("fs");
const path = require("path");

const DEFAULT_ROOT = path.join(__dirname, "..", "artifacts");
let ROOT = DEFAULT_ROOT;
let SCREEN_DIR = path.join(ROOT, "screenshots");
let JSON_DIR = path.join(ROOT, "diagnostics");

function ensureDirs() {
  fs.mkdirSync(SCREEN_DIR, { recursive: true });
  fs.mkdirSync(JSON_DIR, { recursive: true });
}

function setArtifactRoot(dir) {
  ROOT = dir || DEFAULT_ROOT;
  SCREEN_DIR = path.join(ROOT, "screenshots");
  JSON_DIR = path.join(ROOT, "diagnostics");
  ensureDirs();
}

function resetArtifactRoot() {
  setArtifactRoot(DEFAULT_ROOT);
}

function writeJson(name, data) {
  ensureDirs();
  const file = path.join(JSON_DIR, name);
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  return file;
}

function writeText(name, text) {
  ensureDirs();
  const file = path.join(JSON_DIR, name);
  fs.writeFileSync(file, String(text || ""));
  return file;
}

function redactSecrets(value) {
  return String(value || "")
    .replace(/eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9._-]+/g, "[jwt]")
    .replace(/([?&#](?:jwt|token|access_token|accessKey|password)=)[^&\s"'<>]+/gi, "$1[redacted]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]");
}

async function screenshot(browser, name) {
  ensureDirs();
  const file = path.join(SCREEN_DIR, `${name}.png`);
  try {
    await browser.saveScreenshot(file);
  } catch {
    /* may be on NATIVE_APP */
  }
  return file;
}

async function markSession(browser, status, reason) {
  try {
    await browser.execute(`browserstack_executor: ${JSON.stringify({
      action: "setSessionStatus",
      arguments: {
        status,
        reason: String(reason || "").slice(0, 255),
      },
    })}`);
  } catch {
    /* session may already be gone */
  }
}

module.exports = {
  get ROOT() { return ROOT; },
  get SCREEN_DIR() { return SCREEN_DIR; },
  get JSON_DIR() { return JSON_DIR; },
  DEFAULT_ROOT,
  setArtifactRoot,
  resetArtifactRoot,
  writeJson,
  writeText,
  screenshot,
  markSession,
  redactSecrets,
};
