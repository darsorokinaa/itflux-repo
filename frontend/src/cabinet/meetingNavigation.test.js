import { describe, expect, it } from "vitest";
import {
  STUDENT_HOME_ROUTE,
  cabinetMeetingPathFromHref,
  isCabinetMeetingHref,
  isJitsiMeetPageUrl,
  resolveAuthenticatedMeetingNavigation,
} from "./meetingNavigation";

describe("PWA_SAME_ORIGIN_LESSON_ROOM", () => {
  it("teacher и student входят по relative path, origin приложения не меняется", () => {
    expect(cabinetMeetingPathFromHref("/cabinet/meetings/abc-uuid")).toBe("/cabinet/meetings/abc-uuid");
    expect(
      cabinetMeetingPathFromHref("https://itflux-academy.ru/cabinet/meetings/abc-uuid?x=1"),
    ).toBe("/cabinet/meetings/abc-uuid");
    expect(resolveAuthenticatedMeetingNavigation("/cabinet/meetings/abc-uuid")).toEqual({
      kind: "internal",
      href: "/cabinet/meetings/abc-uuid",
    });
  });

  it("absolute URL на lesson.itflux-academy.ru/cabinet/meetings остаётся same-origin path", () => {
    expect(
      cabinetMeetingPathFromHref("https://lesson.itflux-academy.ru/cabinet/meetings/abc-uuid"),
    ).toBe("/cabinet/meetings/abc-uuid");
    expect(
      resolveAuthenticatedMeetingNavigation("https://lesson.itflux-academy.ru/cabinet/meetings/abc-uuid"),
    ).toEqual({ kind: "internal", href: "/cabinet/meetings/abc-uuid" });
  });

  it("прямой Jitsi room URL не является top-level destination", () => {
    const jitsi = "https://lesson.itflux-academy.ru/RoomName?jwt=secret";
    expect(isJitsiMeetPageUrl(jitsi)).toBe(true);
    expect(isCabinetMeetingHref(jitsi)).toBe(false);
    expect(resolveAuthenticatedMeetingNavigation(jitsi)).toEqual({
      kind: "jitsi-embed",
      href: "",
    });
    expect(jitsi).toMatch(/^https:\/\/lesson\./);
  });

  it("LESSON_ROOM_TOP_LEVEL_ORIGIN: teacher и student остаются на origin приложения", () => {
    const appOrigin = "https://itflux-academy.ru";
    const hrefs = [
      "/cabinet/meetings/meet-1",
      `${appOrigin}/cabinet/meetings/meet-1`,
      "https://lesson.itflux-academy.ru/cabinet/meetings/meet-1",
    ];
    for (const href of hrefs) {
      const nav = resolveAuthenticatedMeetingNavigation(href);
      expect(nav.kind).toBe("internal");
      const final = new URL(nav.href, appOrigin);
      expect(final.origin).toBe(appOrigin);
      expect(final.hostname).not.toBe("lesson.itflux-academy.ru");
      expect(final.pathname).toBe("/cabinet/meetings/meet-1");
    }
  });

  it("LESSON_ROOM_TOP_LEVEL_ORIGIN: публичный Telemost/invite не сводится к Jitsi host", () => {
    const telemost = "https://telemost.yandex.ru/j/123";
    expect(isJitsiMeetPageUrl(telemost)).toBe(false);
    expect(resolveAuthenticatedMeetingNavigation(telemost)).toEqual({
      kind: "external",
      href: telemost,
    });
  });

  it("student hangup stays on cabinet origin, not lesson.*", () => {
    const appOrigin = "https://itflux-academy.ru";
    const dest = new URL(STUDENT_HOME_ROUTE, appOrigin);
    expect(STUDENT_HOME_ROUTE).toBe("/cabinet/student");
    expect(dest.origin).toBe(appOrigin);
    expect(dest.hostname).not.toBe("lesson.itflux-academy.ru");
  });
});
