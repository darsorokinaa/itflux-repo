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
  loadDotEnvFile(path.join(__dirname, "..", ".env"));
  loadDotEnvFile(path.join(__dirname, "..", "..", "e2e-real-devices", ".env"));
}

loadDotEnv();

function requiredSecrets() {
  return {
    login: process.env.TEST_LOGIN || "",
    password: process.env.TEST_PASSWORD || "",
    lessonRoomUrl: process.env.LESSON_ROOM_URL || "",
    username: process.env.BROWSERSTACK_USERNAME || "",
    accessKey: process.env.BROWSERSTACK_ACCESS_KEY || "",
  };
}

function hasSecrets() {
  const s = requiredSecrets();
  return Boolean(s.login && s.password && s.lessonRoomUrl && s.username && s.accessKey);
}

function originFromLessonUrl() {
  const url = process.env.TEST_BASE_URL || process.env.LESSON_ROOM_URL || "";
  if (!url) return "";
  return new URL(url).origin;
}

module.exports = {
  loadDotEnv,
  requiredSecrets,
  hasSecrets,
  originFromLessonUrl,
};
