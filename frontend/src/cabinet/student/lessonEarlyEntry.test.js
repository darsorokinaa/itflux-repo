import { describe, expect, it } from "vitest";
import { isEarlyEntryOpen, lessonMeetingHref } from "./StudentSectionUi";
import { resolveAuthenticatedMeetingNavigation } from "../meetingNavigation";

const start = Date.parse("2026-10-21T15:00:00Z");
const event = (vm) => ({ video_meeting: vm });
const early = {
  eligible: true,
  opensAt: "2026-10-21T14:45:00Z",
  closesAt: "2026-10-21T16:00:00Z",
};

describe("ранний вход ученика", () => {
  it("до окна ссылки нет", () => {
    const ev = event({ status: "scheduled", pageUrl: "/cabinet/meetings/u1", earlyEntry: early });
    expect(lessonMeetingHref(ev, start - 16 * 60000)).toBe("");
    expect(isEarlyEntryOpen(ev, start - 16 * 60000)).toBe(false);
  });

  it("за 15 минут — страница комнаты (экран ожидания)", () => {
    const ev = event({ status: "scheduled", pageUrl: "/cabinet/meetings/u1", earlyEntry: early });
    expect(lessonMeetingHref(ev, start - 15 * 60000)).toBe("/cabinet/meetings/u1");
  });

  it("комнаты ещё нет — переходник по eventId", () => {
    const ev = event({ uuid: null, status: "scheduled", pageUrl: "/cabinet/student/lessons/room/42", earlyEntry: early });
    expect(lessonMeetingHref(ev, start)).toBe("/cabinet/student/lessons/room/42");
    expect(resolveAuthenticatedMeetingNavigation("/cabinet/student/lessons/room/42")).toEqual({
      kind: "internal",
      href: "/cabinet/student/lessons/room/42",
    });
  });

  it("после конца урока ссылки нет", () => {
    const ev = event({ status: "scheduled", pageUrl: "/cabinet/meetings/u1", earlyEntry: early });
    expect(lessonMeetingHref(ev, Date.parse("2026-10-21T16:00:01Z"))).toBe("");
  });

  it("неподходящий урок (eligible=false) — как раньше, без ссылки", () => {
    const ev = event({ status: "scheduled", pageUrl: "/cabinet/meetings/u1", earlyEntry: { ...early, eligible: false } });
    expect(lessonMeetingHref(ev, start)).toBe("");
  });

  it("внешний URL в pageUrl не принимается", () => {
    const ev = event({ status: "scheduled", pageUrl: "https://evil.example/x", earlyEntry: early });
    expect(lessonMeetingHref(ev, start)).toBe("");
  });
});
