/**
 * Top-level browser URL after joining a lesson must stay on the app origin.
 * Jitsi (lesson.*) is an iframe/script host, not window.location.
 */

function expectedAppOrigin({
  testBaseUrl = process.env.TEST_BASE_URL,
  lessonRoomUrl = process.env.LESSON_ROOM_URL,
} = {}) {
  if (testBaseUrl) return new URL(testBaseUrl).origin;
  if (lessonRoomUrl) {
    const parsed = new URL(lessonRoomUrl);
    if (/^lesson\./i.test(parsed.hostname)) {
      return `${parsed.protocol}//${parsed.hostname.replace(/^lesson\./i, "")}`;
    }
    return parsed.origin;
  }
  return "https://itflux-academy.ru";
}

function inspectLessonRoomTopLevelUrl(href, options) {
  const url = new URL(href);
  const expectedOrigin = expectedAppOrigin(options);
  const loginVisible = /\/cabinet\/login\/?$/i.test(url.pathname);
  return {
    href: url.href,
    origin: url.origin,
    hostname: url.hostname,
    pathname: url.pathname,
    expectedOrigin,
    isLessonSubdomain: /^lesson\./i.test(url.hostname),
    isCabinetMeeting: /^\/cabinet\/meetings\//.test(url.pathname),
    isLoginPage: loginVisible,
  };
}

function assertLessonRoomTopLevelOrigin(href, options) {
  const info = inspectLessonRoomTopLevelUrl(href, options);
  if (info.isLessonSubdomain) {
    throw new Error(
      `LESSON_ROOM_TOP_LEVEL_ORIGIN: hostname is ${info.hostname}; `
      + `expected ${info.expectedOrigin} (Jitsi host must not be the top-level URL)`,
    );
  }
  if (info.origin !== info.expectedOrigin) {
    throw new Error(
      `LESSON_ROOM_TOP_LEVEL_ORIGIN: origin ${info.origin} !== ${info.expectedOrigin}`,
    );
  }
  if (info.isLoginPage) {
    throw new Error(
      `LESSON_ROOM_TOP_LEVEL_ORIGIN: landed on login page ${info.pathname}`,
    );
  }
  if (!info.isCabinetMeeting) {
    throw new Error(
      `LESSON_ROOM_TOP_LEVEL_ORIGIN: pathname ${info.pathname} is not /cabinet/meetings/...`,
    );
  }
  return info;
}

module.exports = {
  expectedAppOrigin,
  inspectLessonRoomTopLevelUrl,
  assertLessonRoomTopLevelOrigin,
};
