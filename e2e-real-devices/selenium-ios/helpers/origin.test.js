const test = require("node:test");
const assert = require("node:assert/strict");
const {
  expectedAppOrigin,
  inspectLessonRoomTopLevelUrl,
  assertLessonRoomTopLevelOrigin,
} = require("../../helpers/lessonRoomOrigin");

test("LESSON_ROOM_TOP_LEVEL_ORIGIN: app origin strips lesson subdomain from room URL", () => {
  assert.equal(
    expectedAppOrigin({
      lessonRoomUrl: "https://lesson.itflux-academy.ru/SomeRoom?jwt=x",
    }),
    "https://itflux-academy.ru",
  );
  assert.equal(
    expectedAppOrigin({
      testBaseUrl: "https://itflux-academy.ru",
      lessonRoomUrl: "https://lesson.itflux-academy.ru/x",
    }),
    "https://itflux-academy.ru",
  );
});

test("LESSON_ROOM_TOP_LEVEL_ORIGIN: cabinet meeting path on main host passes", () => {
  const info = assertLessonRoomTopLevelOrigin(
    "https://itflux-academy.ru/cabinet/meetings/abc-uuid",
    { testBaseUrl: "https://itflux-academy.ru" },
  );
  assert.equal(info.origin, "https://itflux-academy.ru");
  assert.equal(info.isLessonSubdomain, false);
  assert.equal(info.isLoginPage, false);
});

test("LESSON_ROOM_TOP_LEVEL_ORIGIN: Jitsi host as top-level URL fails", () => {
  assert.throws(
    () => assertLessonRoomTopLevelOrigin(
      "https://lesson.itflux-academy.ru/RoomName?jwt=secret",
      { testBaseUrl: "https://itflux-academy.ru" },
    ),
    /LESSON_ROOM_TOP_LEVEL_ORIGIN/,
  );
});

test("LESSON_ROOM_TOP_LEVEL_ORIGIN: login page after join fails", () => {
  const info = inspectLessonRoomTopLevelUrl(
    "https://itflux-academy.ru/cabinet/login",
    { testBaseUrl: "https://itflux-academy.ru" },
  );
  assert.equal(info.isLoginPage, true);
  assert.throws(
    () => assertLessonRoomTopLevelOrigin(
      "https://itflux-academy.ru/cabinet/login",
      { testBaseUrl: "https://itflux-academy.ru" },
    ),
    /login page/,
  );
});
