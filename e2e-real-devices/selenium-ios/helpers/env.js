const fs = require("fs");
const path = require("path");

function loadDotEnvFile(envPath) {
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] == null || process.env[key] === "") {
      process.env[key] = value;
    }
  }
}

function loadDotEnv() {
  loadDotEnvFile(path.join(__dirname, "..", "..", ".env"));
  loadDotEnvFile(path.join(process.cwd(), ".env"));
  loadDotEnvFile(path.join(process.cwd(), "e2e-real-devices", ".env"));
}

loadDotEnv();

const REQUIRED_ENV = [
  "BROWSERSTACK_USERNAME",
  "BROWSERSTACK_ACCESS_KEY",
  "TEST_LOGIN",
  "TEST_PASSWORD",
  "LESSON_ROOM_URL",
];

function missingEnvKeys() {
  return REQUIRED_ENV.filter((key) => !String(process.env[key] || "").trim());
}

function requireEnv() {
  const missing = missingEnvKeys();
  if (missing.length) {
    const err = new Error(
      `Missing required env: ${missing.join(", ")}. `
      + "Set them in the shell or in e2e-real-devices/.env (never commit that file).",
    );
    err.code = "MISSING_ENV";
    throw err;
  }
}

function secrets() {
  requireEnv();
  return {
    login: process.env.TEST_LOGIN,
    password: process.env.TEST_PASSWORD,
    lessonRoomUrl: process.env.LESSON_ROOM_URL,
    username: process.env.BROWSERSTACK_USERNAME,
    accessKey: process.env.BROWSERSTACK_ACCESS_KEY,
  };
}

function originFromLessonUrl() {
  const url = process.env.TEST_BASE_URL || process.env.LESSON_ROOM_URL || "https://itflux-academy.ru";
  return new URL(url).origin;
}

function loginUrl() {
  return `${originFromLessonUrl()}/cabinet/login`;
}

module.exports = {
  loadDotEnv,
  requireEnv,
  missingEnvKeys,
  secrets,
  originFromLessonUrl,
  loginUrl,
};
