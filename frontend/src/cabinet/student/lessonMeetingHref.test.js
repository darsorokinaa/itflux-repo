import { describe, expect, it } from "vitest";
import { lessonMeetingHref } from "./StudentSectionUi";

describe("PWA_SAME_ORIGIN_LESSON_ROOM student", () => {
  it("live lesson uses cabinet path even if meeting_url is Jitsi host", () => {
    const href = lessonMeetingHref({
      video_meeting: { status: "live", pageUrl: "/cabinet/meetings/abc-uuid" },
      meeting_url: "https://lesson.itflux-academy.ru/RoomName?jwt=secret",
    });
    expect(href).toBe("/cabinet/meetings/abc-uuid");
    const final = new URL(href, "https://itflux-academy.ru");
    expect(final.origin).toBe("https://itflux-academy.ru");
    expect(final.hostname).not.toBe("lesson.itflux-academy.ru");
  });

  it("does not use a raw Jitsi room URL as the connect href", () => {
    expect(
      lessonMeetingHref({
        video_meeting: { status: "live" },
        meeting_url: "https://lesson.itflux-academy.ru/RoomName?jwt=secret",
      }),
    ).toBe("");
  });
});
