const path = require("path");
const fs = require("fs");

function loadDotEnv() {
  const envPath = path.join(__dirname, "..", "..", ".env");
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] == null || process.env[key] === "") {
      process.env[key] = value;
    }
  }
}

loadDotEnv();

function requiredSecrets() {
  return {
    login: process.env.TEST_LOGIN || "",
    password: process.env.TEST_PASSWORD || "",
    lessonRoomUrl: process.env.LESSON_ROOM_URL || "",
  };
}

function hasProductionSecrets() {
  const s = requiredSecrets();
  return Boolean(s.login && s.password && s.lessonRoomUrl);
}

function originFromLessonUrl() {
  const url = process.env.TEST_BASE_URL || process.env.LESSON_ROOM_URL || "";
  if (!url) return "";
  return new URL(url).origin;
}

function testMinutes() {
  const n = Number(process.env.TEST_MINUTES);
  if (Number.isFinite(n) && n > 0) return n;
  return 60;
}

function skipIfNoSecrets(test) {
  test.skip(!hasProductionSecrets(), "Set TEST_LOGIN, TEST_PASSWORD and LESSON_ROOM_URL");
}

module.exports = {
  loadDotEnv,
  requiredSecrets,
  hasProductionSecrets,
  originFromLessonUrl,
  testMinutes,
  skipIfNoSecrets,
};
